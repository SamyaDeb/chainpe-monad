import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import express from 'express'
import { paymentMiddleware } from '@x402/express'
import { x402ResourceServer } from '@x402/core/server'
import { ExactEvmScheme as ExactServerScheme } from '@x402/evm/exact/server'
import { privateKeyToAccount } from 'viem/accounts'
import { checkOffer, paidFetch } from '../src/payment.js'
import { ChainPe } from '../src/chainpe.js'
import { ChainPePaymentError } from '../src/types.js'
import { NETWORKS } from '../src/networks.js'

// Public Hardhat test key — not a secret.
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const account = privateKeyToAccount(KEY)
const SELLER = '0x1111111111111111111111111111111111111111'
const TX = '0x' + 'ab'.repeat(32)
const net = NETWORKS['monad-testnet']

describe('checkOffer', () => {
  const offer = (over: Record<string, unknown> = {}) => ({
    scheme: 'exact',
    network: net.caip2,
    asset: net.usdc.address,
    amount: '10000',
    payTo: SELLER,
    maxTimeoutSeconds: 60,
    extra: {},
    ...over
  })

  it('accepts USDC exact on our network within the cap', () => {
    expect(checkOffer(offer() as never, 'monad-testnet', 1_000_000n)).toEqual({ ok: true })
  })

  it.each([
    [{ scheme: 'upto' }, /scheme/],
    [{ network: 'eip155:143' }, /network/],
    [{ asset: '0x0000000000000000000000000000000000000001' }, /USDC/],
    [{ amount: '1.5' }, /invalid amount/],
    [{ amount: '2000000' }, /exceeds maxPerCall/]
  ])('refuses %j', (over, reason) => {
    const r = checkOffer(offer(over) as never, 'monad-testnet', 1_000_000n)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toMatch(reason)
  })
})

// A real x402 v2 resource server (express middleware) with a stub facilitator,
// so the client is tested against the actual wire format.
let facilitatorMode: 'ok' | 'reject' = 'ok'
const facilitatorClient = {
  getSupported: async () => ({
    kinds: [{ x402Version: 2, scheme: 'exact', network: net.caip2 }],
    extensions: [],
    signers: {}
  }),
  verify: async () =>
    facilitatorMode === 'ok'
      ? { isValid: true, payer: account.address }
      : { isValid: false, invalidReason: 'insufficient_funds', payer: account.address },
  settle: async () => ({ success: true, transaction: TX, network: net.caip2, payer: account.address })
}

let server: Server
let base: string
let hits = 0

beforeAll(async () => {
  const app = express()
  const resources = new x402ResourceServer(facilitatorClient as never).register(net.caip2, new ExactServerScheme())
  const route = (amount: string) => ({
    accepts: { scheme: 'exact', network: net.caip2, payTo: SELLER, price: { asset: net.usdc.address, amount, extra: { name: 'USDC', version: '2' } } },
    description: 'test'
  })
  app.use(
    paymentMiddleware(
      { 'GET /cheap': route('10000'), 'GET /pricey': route('5000000') } as never,
      resources
    )
  )
  app.get('/free', (_req, res) => res.json({ free: true }))
  app.get('/cheap', (_req, res) => {
    hits++
    res.setHeader('x-chainpe-agent-id', '7')
    res.json({ data: 'paid content' })
  })
  app.get('/pricey', (_req, res) => res.json({ data: 'expensive' }))
  await new Promise<void>(resolve => {
    server = app.listen(0, () => {
      const a = server.address()
      base = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`
      resolve()
    })
  })
})
afterAll(() => server?.close())

describe('paidFetch against a real x402 v2 server', () => {
  const opts = (path: string, max = 1_000_000n) => ({
    url: `${base}${path}`,
    network: 'monad-testnet' as const,
    account,
    maxPerCallAtomic: max
  })

  it('passes non-402 responses straight through without paying', async () => {
    const r = await paidFetch(opts('/free'))
    expect(r.payment).toBeUndefined()
    expect(await r.response.json()).toEqual({ free: true })
  })

  it('pays a 402 and returns the settlement tx + payTo', async () => {
    const r = await paidFetch(opts('/cheap'))
    expect(r.response.status).toBe(200)
    expect(await r.response.json()).toEqual({ data: 'paid content' })
    expect(hits).toBe(1)
    expect(r.payment).toMatchObject({ amount: '0.01', recipient: SELLER, network: 'monad-testnet', txHash: TX })
    expect(r.accepted?.payTo).toBe(SELLER)
  })

  it('refuses an offer above maxPerCall without signing', async () => {
    await expect(paidFetch(opts('/pricey'))).rejects.toThrow(/exceeds maxPerCall/)
    await expect(paidFetch(opts('/pricey'))).rejects.toBeInstanceOf(ChainPePaymentError)
  })

  it('surfaces the server’s reason when payment is rejected', async () => {
    facilitatorMode = 'reject'
    try {
      await expect(paidFetch(opts('/cheap'))).rejects.toThrow(/not accepted/)
    } finally {
      facilitatorMode = 'ok'
    }
  })
})

describe('ChainPe client', () => {
  it('fetch() pays and returns the live response', async () => {
    const cp = new ChainPe({ privateKey: KEY, registryAddress: '0x000000000000000000000000000000000000dEaD' })
    expect(cp.network).toBe('monad-testnet')
    expect(cp.config.address).toBe(account.address)
    const res = await cp.fetch(`${base}/cheap`)
    expect(res.status).toBe(200)
  })

  it('pay() returns parsed data and the payment receipt', async () => {
    const cp = new ChainPe({ privateKey: KEY, registryAddress: '0x000000000000000000000000000000000000dEaD' })
    const r = await cp.pay<{ data: string }>(`${base}/cheap`)
    expect(r.ok).toBe(true)
    expect(r.data).toEqual({ data: 'paid content' })
    expect(r.payment?.txHash).toBe(TX)
  })

  it('honours the maxPerCall option', async () => {
    const cp = new ChainPe({ privateKey: KEY, registryAddress: '0x000000000000000000000000000000000000dEaD', maxPerCall: '0.005' })
    await expect(cp.fetch(`${base}/cheap`)).rejects.toThrow(/exceeds maxPerCall/)
  })

  it('requires a private key', () => {
    expect(() => new ChainPe({ privateKey: '' })).toThrow(/privateKey/)
  })
})
