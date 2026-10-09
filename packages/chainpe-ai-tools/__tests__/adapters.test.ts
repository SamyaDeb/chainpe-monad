import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import express from 'express'
import { paymentMiddleware } from '@x402/express'
import { x402ResourceServer } from '@x402/core/server'
import { ExactEvmScheme as ExactServerScheme } from '@x402/evm/exact/server'
import { privateKeyToAccount } from 'viem/accounts'
import { ChainPe, NETWORKS } from '@chainpeavax/sdk'
import { createChainPeTools } from '../src/vercel.js'
import { createChainPeLangChainTools } from '../src/langchain.js'

// Public Hardhat test key — not a secret.
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const account = privateKeyToAccount(KEY)
const SELLER = '0x1111111111111111111111111111111111111111'
const TX = '0x' + 'ef'.repeat(32)
const net = NETWORKS['monad-testnet']
// Placeholder registry: discovery is not exercised here, payments are.
const REGISTRY = '0x000000000000000000000000000000000000dEaD'

let server: Server
let base: string
let hits = 0

beforeAll(async () => {
  const facilitator = {
    getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: 'exact', network: net.caip2 }], extensions: [], signers: {} }),
    verify: async () => ({ isValid: true, payer: account.address }),
    settle: async () => ({ success: true, transaction: TX, network: net.caip2, payer: account.address })
  }
  const app = express()
  const resources = new x402ResourceServer(facilitator as never).register(net.caip2, new ExactServerScheme())
  const route = (amount: string, asset = net.usdc.address) => ({
    accepts: { scheme: 'exact', network: net.caip2, payTo: SELLER, price: { asset, amount, extra: { name: 'USDC', version: '2' } } },
    description: 'test'
  })
  app.use(
    paymentMiddleware(
      { 'GET /summary': route('10000'), 'GET /fake-token': route('10000', '0x0000000000000000000000000000000000000001') } as never,
      resources
    )
  )
  app.get('/summary', (_req, res) => {
    hits++
    res.json({ summary: 'Monad is fast.' })
  })
  app.get('/fake-token', (_req, res) => {
    hits++
    res.json({})
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

const client = () => new ChainPe({ privateKey: KEY, registryAddress: REGISTRY })
const opts = { toolCallId: 't', messages: [] } as never

describe('Vercel AI SDK tools', () => {
  it('exposes chainpeFetch + discoverService', () => {
    const tools = createChainPeTools({ client: client() })
    expect(Object.keys(tools).sort()).toEqual(['chainpeFetch', 'discoverService'])
    expect(tools.chainpeFetch.description).toMatch(/Monad/)
  })

  it('chainpeFetch pays a real x402 v2 402 in Monad USDC (testnet by default)', async () => {
    const tools = createChainPeTools({ client: client() })
    const out = await tools.chainpeFetch.execute!({ url: `${base}/summary` }, opts)
    expect(out).toMatchObject({
      status: 200,
      ok: true,
      data: { summary: 'Monad is fast.' },
      payment: {
        amount: '0.01',
        recipient: SELLER,
        network: 'monad-testnet',
        txHash: TX,
        explorerUrl: `https://testnet.monadvision.com/tx/${TX}`
      }
    })
  })

  it('chainpeFetch refuses a non-USDC offer without paying', async () => {
    hits = 0
    const tools = createChainPeTools({ privateKey: KEY, registryAddress: REGISTRY })
    await expect(tools.chainpeFetch.execute!({ url: `${base}/fake-token` }, opts)).rejects.toThrow(/not monad-testnet USDC/)
    expect(hits).toBe(0)
  })
})

describe('LangChain tools', () => {
  it('exposes chainpe_fetch + discover_service returning JSON strings', async () => {
    const { chainpeFetchTool, discoverServiceTool } = createChainPeLangChainTools({ client: client() })
    expect(chainpeFetchTool.name).toBe('chainpe_fetch')
    expect(discoverServiceTool.name).toBe('discover_service')
    const raw = await chainpeFetchTool.invoke({ url: `${base}/summary` })
    expect(JSON.parse(raw as string).payment.txHash).toBe(TX)
  })
})
