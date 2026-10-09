import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Server } from 'node:http'
import express from 'express'
import { paymentMiddleware } from '@x402/express'
import { x402ResourceServer } from '@x402/core/server'
import { ExactEvmScheme as ExactServerScheme } from '@x402/evm/exact/server'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { NETWORKS } from '@chainpeavax/sdk'
import { privateKeyToAccount } from 'viem/accounts'
import { createMcpServer } from '../src/server.js'
import { SpendingTracker } from '../src/spending.js'
import type { AppConfig } from '../src/types.js'

// Public Hardhat test key — not a secret.
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const account = privateKeyToAccount(KEY)
const SELLER = '0x1111111111111111111111111111111111111111'
const TX = '0x' + 'ab'.repeat(32)
const OTHER_TOKEN = '0x0000000000000000000000000000000000000001'
const net = NETWORKS['monad-testnet']

// ─── a real x402 v2 resource server with a stub facilitator ─────────────────
const facilitatorClient = {
  getSupported: async () => ({
    kinds: [{ x402Version: 2, scheme: 'exact', network: net.caip2 }],
    extensions: [],
    signers: {}
  }),
  verify: async () => ({ isValid: true, payer: account.address }),
  settle: async () => ({ success: true, transaction: TX, network: net.caip2, payer: account.address })
}

let server: Server
let base: string
let paidHits = 0

beforeAll(async () => {
  const app = express()
  const resources = new x402ResourceServer(facilitatorClient as never).register(net.caip2, new ExactServerScheme())
  const route = (amount: string, asset = net.usdc.address) => ({
    accepts: { scheme: 'exact', network: net.caip2, payTo: SELLER, price: { asset, amount, extra: { name: 'USDC', version: '2' } } },
    description: 'test'
  })
  // Like the ChainPe proxy, advertise the provider's agent id on the 402 too.
  app.use('/cheap', (_req, res, next) => {
    res.setHeader('x-chainpe-agent-id', '7')
    next()
  })
  app.use(
    paymentMiddleware(
      {
        'GET /cheap': route('10000'), // 0.01 USDC
        'GET /pricey': route('5000000'), // 5 USDC
        'GET /fake-token': route('10000', OTHER_TOKEN) // cheap, but not USDC
      } as never,
      resources
    )
  )
  app.get('/free', (_req, res) => res.json({ free: true }))
  app.get('/cheap', (_req, res) => {
    paidHits++
    res.json({ data: 'paid content' })
  })
  app.get('/pricey', (_req, res) => {
    paidHits++
    res.json({ data: 'expensive' })
  })
  app.get('/fake-token', (_req, res) => {
    paidHits++
    res.json({ data: 'fake' })
  })
  await new Promise<void>(resolve => {
    server = app.listen(0, () => {
      const a = server.address()
      base = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`
      resolve()
    })
  })
})
afterAll(() => server?.close())

// ─── harness: the real MCP server behind an in-memory client ────────────────
let dir: string
let spendingFile: string
const clients: Client[] = []

function makeConfig(over: Partial<AppConfig> = {}): AppConfig {
  return {
    privateKey: KEY,
    network: 'monad-testnet',
    budget: { maxPerCall: '0.10', maxPerDay: '0.25' },
    canPay: true,
    mode: 'MONAD',
    reload: () => {},
    ...over
  }
}

async function connect(config = makeConfig()) {
  const tracker = new SpendingTracker(config.budget, { filePath: spendingFile })
  const mcp = createMcpServer(config, tracker)
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '1' })
  await Promise.all([mcp.connect(a), client.connect(b)])
  clients.push(client)
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] }
    return { isError: !!r.isError, text: r.content[0].text, json: () => JSON.parse(r.content[0].text) }
  }
  return { client, call, tracker }
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chainpe-wallet-'))
  spendingFile = path.join(dir, 'spending.json')
  paidHits = 0
})
afterEach(async () => {
  await Promise.all(clients.splice(0).map(c => c.close()))
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('MCP server', () => {
  it('registers all 9 tools', async () => {
    const { client } = await connect()
    const names = (await client.listTools()).tools.map(t => t.name).sort()
    expect(names).toEqual(
      [
        'check_balance',
        'give_feedback',
        'pay',
        'request_funding',
        'search_bazaar',
        'spending_report',
        'transfer_mon',
        'transfer_usdc',
        'x402_fetch'
      ].sort()
    )
  })

  it('read-only wallet cannot pay or transfer', async () => {
    const { call } = await connect(makeConfig({ privateKey: undefined, canPay: false, mode: 'READ_ONLY' }))
    for (const [name, args] of [
      ['x402_fetch', { url: `${base}/cheap` }],
      ['pay', { url: `${base}/cheap` }],
      ['check_balance', {}],
      ['transfer_mon', { to: SELLER, amount: '1' }],
      ['transfer_usdc', { to: SELLER, amount: '1' }],
      ['request_funding', { amount: '1' }],
      ['give_feedback', { agentId: '5', score: 90 }]
    ] as const) {
      const r = await call(name, args)
      expect(r.isError, name).toBe(true)
      expect(r.text, name).toContain('No wallet configured')
    }
    expect(paidHits).toBe(0)
  })
})

describe('x402_fetch (via the SDK)', () => {
  it('passes a free URL through without paying', async () => {
    const { call, tracker } = await connect()
    const r = await call('x402_fetch', { url: `${base}/free` })
    expect(r.isError).toBe(false)
    expect(r.json()).toMatchObject({ status: 200, bodyEncoding: 'text' })
    expect(JSON.parse(r.json().body)).toEqual({ free: true })
    expect(r.json().payment).toBeUndefined()
    expect(tracker.getSummary().spentToday).toBe('0.000000')
  })

  it('pays a 402 in Monad USDC and returns the receipt', async () => {
    const { call, tracker } = await connect()
    const r = await call('x402_fetch', { url: `${base}/cheap` })
    expect(r.isError).toBe(false)
    const out = r.json()
    expect(out.status).toBe(200)
    expect(JSON.parse(out.body)).toEqual({ data: 'paid content' })
    expect(out.payment).toMatchObject({
      amount: '0.01 USDC',
      recipient: SELLER,
      network: 'monad-testnet',
      txHash: TX,
      explorerUrl: `https://testnet.monadvision.com/tx/${TX}`
    })
    expect(paidHits).toBe(1)
    expect(tracker.getSummary().spentToday).toBe('0.010000')
  })

  it('refuses an over-cap offer without signing or spending', async () => {
    const { call, tracker } = await connect()
    const r = await call('x402_fetch', { url: `${base}/pricey` })
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/no acceptable payment offer/)
    expect(r.text).toMatch(/exceeds maxPerCall/)
    expect(paidHits).toBe(0) // the paid handler never ran: nothing was signed
    expect(tracker.getSummary().spentToday).toBe('0.000000')
  })

  it('refuses a cheap offer for a non-USDC asset', async () => {
    const { call, tracker } = await connect()
    const r = await call('x402_fetch', { url: `${base}/fake-token` })
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/is not monad-testnet USDC/)
    expect(paidHits).toBe(0)
    expect(tracker.getSummary().spentToday).toBe('0.000000')
  })

  it('refuses an offer on the other Monad network', async () => {
    // wallet on mainnet, server offers testnet USDC on eip155:10143
    const { call } = await connect(makeConfig({ network: 'monad' }))
    const r = await call('x402_fetch', { url: `${base}/cheap` })
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/network eip155:10143 is not eip155:143/)
    expect(paidHits).toBe(0)
  })

  it('stops paying once the daily budget is used, and the budget persists across restarts', async () => {
    const first = await connect() // 0.25/day, 0.01 per call
    for (let i = 0; i < 25; i++) expect((await first.call('x402_fetch', { url: `${base}/cheap` })).isError).toBe(false)
    expect(paidHits).toBe(25)

    const over = await first.call('x402_fetch', { url: `${base}/cheap` })
    expect(over.isError).toBe(true)
    expect(over.text).toMatch(/Daily budget/)
    expect(paidHits).toBe(25)

    // "restart": a brand-new server + tracker reading the same file
    const restarted = await connect()
    const again = await restarted.call('x402_fetch', { url: `${base}/cheap` })
    expect(again.isError).toBe(true)
    expect(again.text).toMatch(/Daily budget/)
    expect(paidHits).toBe(25)

    const report = (await restarted.call('spending_report')).json()
    expect(report.summary.spentToday).toBe('$0.250000 USDC')
    expect(report.summary.spentThisSession).toBe('$0.000000 USDC')
    expect(report.summary.remainingDailyBudget).toBe('$0.000000 USDC')
    expect(report.recentPayments[0]).toMatchObject({ recipient: SELLER, txHash: TX })
  })

  it('caps the offer at what is left of today’s budget, not just the per-call limit', async () => {
    const { call } = await connect(makeConfig({ budget: { maxPerCall: '0.10', maxPerDay: '0.015' } }))
    expect((await call('x402_fetch', { url: `${base}/cheap` })).isError).toBe(false) // 0.01 of 0.015
    const r = await call('x402_fetch', { url: `${base}/cheap` }) // 0.01 > 0.005 left
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/exceeds maxPerCall 0\.005/)
    expect(paidHits).toBe(1)
  })
})

describe('pay (via the SDK)', () => {
  it('returns structured data, the receipt and the provider agent id', async () => {
    const { call } = await connect()
    const r = await call('pay', { url: `${base}/cheap` })
    expect(r.isError).toBe(false)
    expect(r.json()).toMatchObject({
      paid: true,
      status: 200,
      ok: true,
      data: { data: 'paid content' },
      agentId: '7',
      payment: { amount: '0.01 USDC', recipient: SELLER, txHash: TX }
    })
  })

  it('honours a tighter per-call maxAmount', async () => {
    const { call } = await connect()
    const r = await call('pay', { url: `${base}/cheap`, maxAmount: '0.005' })
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/exceeds maxPerCall 0\.005/)
    expect(paidHits).toBe(0)
  })

  it('refuses over-cap and non-USDC offers', async () => {
    const { call } = await connect()
    expect((await call('pay', { url: `${base}/pricey` })).text).toMatch(/exceeds maxPerCall/)
    expect((await call('pay', { url: `${base}/fake-token` })).text).toMatch(/not monad-testnet USDC/)
    expect(paidHits).toBe(0)
  })
})

describe('funding + balance tools', () => {
  it('request_funding returns EIP-681 URIs and the Monad faucets', async () => {
    const { call } = await connect()
    const usdc = (await call('request_funding', { currency: 'USDC', amount: '5' })).json()
    expect(usdc.chainId).toBe(10143)
    expect(usdc.paymentUri).toBe(
      `ethereum:${net.usdc.address}@10143/transfer?address=${account.address}&uint256=5000000`
    )
    expect(usdc.faucets).toEqual({ MON: 'https://faucet.monad.xyz', USDC: 'https://faucet.circle.com' })

    const mon = (await call('request_funding', { currency: 'MON', amount: '1' })).json()
    expect(mon.paymentUri).toBe(`ethereum:${account.address}@10143?value=1000000000000000000`)
  })

  it('request_funding on mainnet has no faucet links', async () => {
    const { call } = await connect(makeConfig({ network: 'monad' }))
    const r = (await call('request_funding', { amount: '5' })).json()
    expect(r.chainId).toBe(143)
    expect(r.faucets).toBeUndefined()
  })

  it('check_balance reports MON and USDC', async () => {
    const rpc = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const req = JSON.parse(String(init?.body))
      const one = (r: { id: number; method: string }) => ({
        jsonrpc: '2.0',
        id: r.id,
        result: r.method === 'eth_getBalance' ? '0xde0b6b3a7640000' /* 1 MON */ : '0x' + (2_500_000).toString(16).padStart(64, '0')
      })
      const body = Array.isArray(req) ? req.map(one) : one(req)
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
    })
    try {
      const { call } = await connect()
      const r = (await call('check_balance')).json()
      expect(r).toMatchObject({ address: account.address, network: 'monad-testnet', usdc: '2.5 USDC', mon: '1 MON' })
    } finally {
      rpc.mockRestore()
    }
  })
})

describe('give_feedback', () => {
  it('rejects a missing / zero agent id before touching the chain', async () => {
    const { call } = await connect()
    for (const agentId of ['0', 'abc', '']) {
      const r = await call('give_feedback', { agentId, score: 90 })
      expect(r.isError).toBe(true)
      expect(r.text).toContain('no valid ERC-8004 agent id')
    }
  })
})
