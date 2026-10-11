import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import express from 'express'
import { ChainPe, NETWORKS } from '@chainpemonad/sdk'
import { privateKeyToAccount } from 'viem/accounts'
import { createProxyServer, priceToAtomic, createRoutesConfig } from '../src/index.js'
import type { ChainPeConfig, PaymentEvent } from '../src/index.js'

// Public Hardhat test key — not a secret.
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const payer = privateKeyToAccount(KEY).address
const SELLER = '0x1111111111111111111111111111111111111111'
const TX = '0x' + 'cd'.repeat(32)
const net = NETWORKS['monad-testnet']

const config: ChainPeConfig = {
  serviceName: 'Weather Test',
  serviceDescription: 'test',
  tags: ['weather'],
  targetUrl: '',
  pricePerRequest: '0.01',
  paymentToken: 'USDC',
  walletAddress: SELLER,
  proxyPort: 0,
  network: 'monad-testnet',
  agentId: '42'
}

const settled: unknown[] = []
const facilitatorClient = {
  getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: 'exact', network: net.caip2 }], extensions: [], signers: {} }),
  verify: async () => ({ isValid: true, payer }),
  settle: async (_p: unknown, requirements: unknown) => {
    settled.push(requirements)
    return { success: true, transaction: TX, network: net.caip2, payer }
  }
}

let backend: Server
let proxy: Server
let base: string
const payments: PaymentEvent[] = []
let backendHits = 0

const listen = (app: express.Express) =>
  new Promise<{ server: Server; url: string }>(resolve => {
    const server = app.listen(0, () => {
      const a = server.address()
      resolve({ server, url: `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}` })
    })
  })

beforeAll(async () => {
  const b = express()
  b.get('/weather', (req, res) => {
    backendHits++
    res.json({ city: req.query.city ?? 'none', tempC: 21, sawPaymentHeader: Boolean(req.headers['payment-signature']) })
  })
  const be = await listen(b)
  backend = be.server
  const app = createProxyServer({
    config: { ...config, targetUrl: be.url },
    facilitatorClient: facilitatorClient as never,
    onPayment: e => payments.push(e)
  })
  const px = await listen(app)
  proxy = px.server
  base = px.url
})
afterAll(() => {
  backend?.close()
  proxy?.close()
})

describe('priceToAtomic', () => {
  it('converts human USDC to atomic units', () => {
    expect(priceToAtomic('0.01')).toBe('10000')
    expect(priceToAtomic('$1')).toBe('1000000')
    expect(priceToAtomic('0.000001')).toBe('1')
  })
  it('rejects bad prices', () => {
    expect(() => priceToAtomic('abc')).toThrow(/Invalid USDC price/)
    expect(() => priceToAtomic('0.0000001')).toThrow(/Invalid USDC price/)
    expect(() => priceToAtomic('0')).toThrow(/greater than 0/)
  })
})

describe('route config', () => {
  it('always prices in the network USDC with the EIP-712 domain', () => {
    const routes = createRoutesConfig(config) as Record<string, { accepts: { network: string; payTo: string; price: { asset: string; amount: string; extra: Record<string, unknown> } } }>
    const r = routes['/*'].accepts
    expect(r.network).toBe('eip155:10143')
    expect(r.payTo).toBe(SELLER)
    expect(r.price).toMatchObject({ asset: net.usdc.address, amount: '10000', extra: { name: 'USDC', version: '2', agentId: '42' } })
  })
})

describe('proxy + SDK end to end', () => {
  it('serves /health and the admin config without payment', async () => {
    expect((await (await fetch(`${base}/health`)).json()).status).toBe('ok')
    expect((await (await fetch(`${base}/chainpe-admin/config`)).json()).walletAddress).toBe(SELLER)
    expect(backendHits).toBe(0)
  })

  it('answers an unpaid request with a v2 402 and does not touch the backend', async () => {
    const res = await fetch(`${base}/weather?city=Paris`)
    expect(res.status).toBe(402)
    expect(res.headers.get('payment-required')).toBeTruthy()
    expect(res.headers.get('x-chainpe-agent-id')).toBe('42')
    expect(backendHits).toBe(0)
  })

  it('lets the SDK pay, then forwards to the backend without payment headers leaking', async () => {
    const cp = new ChainPe({ privateKey: KEY, network: 'monad-testnet', registryAddress: '0x000000000000000000000000000000000000dEaD' })
    const result = await cp.pay<{ city: string; tempC: number }>(`${base}/weather?city=Paris`)
    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({ city: 'Paris', tempC: 21, sawPaymentHeader: false })
    expect(result.payment).toMatchObject({ amount: '0.01', recipient: SELLER, txHash: TX })
    expect(backendHits).toBe(1)
    expect(settled).toHaveLength(1)
    expect(payments).toHaveLength(1)
    expect(payments[0]).toMatchObject({ payer, txId: TX, success: true })
  })

  it('exposes the agent id the SDK reads for payment-backed feedback', async () => {
    const { paidFetch } = await import('@chainpemonad/sdk')
    const r = await paidFetch({
      url: `${base}/weather`,
      network: 'monad-testnet',
      account: privateKeyToAccount(KEY),
      maxPerCallAtomic: 1_000_000n
    })
    expect(r.agentId).toBe('42')
  })

  it('refuses to pay more than maxPerCall', async () => {
    const cp = new ChainPe({ privateKey: KEY, network: 'monad-testnet', registryAddress: '0x000000000000000000000000000000000000dEaD', maxPerCall: '0.001' })
    await expect(cp.fetch(`${base}/weather`)).rejects.toThrow(/exceeds maxPerCall/)
  })
})
