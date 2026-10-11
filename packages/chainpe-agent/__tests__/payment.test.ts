import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Server } from 'node:http'
import express from 'express'
import { paymentMiddleware } from '@x402/express'
import { x402ResourceServer } from '@x402/core/server'
import { ExactEvmScheme as ExactServerScheme } from '@x402/evm/exact/server'
import { NETWORKS } from '@chainpemonad/sdk'
import { privateKeyToAccount } from 'viem/accounts'

vi.mock('../src/keychain.js', () => ({ getPrivateKey: vi.fn(async () => null) }))

const { PaymentClient } = await import('../src/payment.js')

// Public Hardhat test key — not a secret.
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const account = privateKeyToAccount(KEY)
const SELLER = '0x1111111111111111111111111111111111111111'
const TX = '0x' + 'cd'.repeat(32)
const net = NETWORKS['monad-testnet']

const facilitatorClient = {
  getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: 'exact', network: net.caip2 }], extensions: [], signers: {} }),
  verify: async () => ({ isValid: true, payer: account.address }),
  settle: async () => ({ success: true, transaction: TX, network: net.caip2, payer: account.address })
}

let server: Server
let base: string
let hits = 0

beforeAll(async () => {
  const app = express()
  const resources = new x402ResourceServer(facilitatorClient as never).register(net.caip2, new ExactServerScheme())
  const route = (amount: string, asset = net.usdc.address) => ({
    accepts: { scheme: 'exact', network: net.caip2, payTo: SELLER, price: { asset, amount, extra: { name: 'USDC', version: '2' } } },
    description: 'test'
  })
  app.use(
    paymentMiddleware(
      {
        'GET /weather': route('20000'),
        'GET /pricey': route('5000000'),
        'GET /fake-token': route('20000', '0x0000000000000000000000000000000000000001')
      } as never,
      resources
    )
  )
  const handler = (_req: express.Request, res: express.Response) => {
    hits++
    res.json({ city: 'London', tempC: 14 })
  }
  app.get('/weather', handler)
  app.get('/pricey', handler)
  app.get('/fake-token', handler)
  app.get('/free', (_req, res) => res.json({ free: true }))
  await new Promise<void>(resolve => {
    server = app.listen(0, () => {
      const a = server.address()
      base = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`
      resolve()
    })
  })
})
afterAll(() => server?.close())

const service = () => ({
  id: '0xdev:Weather',
  name: 'Weather',
  description: 'weather',
  tags: ['weather'],
  endpoint: base,
  pricePerRequest: '0.02',
  paymentToken: 'USDC' as const,
  walletAddress: SELLER,
  network: 'monad-testnet' as const
})

describe('PaymentClient (x402 v2 via the SDK)', () => {
  it('defaults to monad-testnet', () => {
    expect(new PaymentClient({ privateKey: KEY }).getNetwork()).toBe('monad-testnet')
  })

  it('passes free endpoints through without a receipt', async () => {
    const pc = new PaymentClient({ privateKey: KEY })
    const r = await pc.fetch(`${base}/free`)
    expect(r).toMatchObject({ status: 200, paid: false, data: { free: true } })
    expect(pc.getTransactionCount()).toBe(0)
  })

  it('pays a service and keeps a real receipt (amount, payTo, tx, MonadVision link)', async () => {
    const onPayment = vi.fn()
    const pc = new PaymentClient({ privateKey: KEY, onPayment })
    const r = await pc.callService(service(), '/weather?city=London')
    expect(r.status).toBe(200)
    expect(r.data).toEqual({ city: 'London', tempC: 14 })
    expect(r.paid).toBe(true)
    expect(r.paymentReceipt).toMatchObject({
      amount: '0.02',
      token: 'USDC',
      recipient: SELLER,
      txId: TX,
      explorerUrl: `https://testnet.monadvision.com/tx/${TX}`,
      network: 'monad-testnet',
      service: 'Weather',
      path: '/weather'
    })
    expect(onPayment).toHaveBeenCalledOnce()
    expect(pc.getTotalSpent()).toEqual({ USDC: '0.02' })
  })

  it('sums spend across payments exactly', async () => {
    const pc = new PaymentClient({ privateKey: KEY })
    for (let i = 0; i < 3; i++) await pc.fetch(`${base}/weather`)
    expect(pc.getTotalSpent()).toEqual({ USDC: '0.06' })
    expect(pc.getTransactionCount()).toBe(3)
    pc.reset()
    expect(pc.getTotalSpent()).toEqual({ USDC: '0' })
  })

  it('refuses an offer above maxPerPayment without paying', async () => {
    hits = 0
    const pc = new PaymentClient({ privateKey: KEY, maxPerPayment: '1' })
    await expect(pc.fetch(`${base}/pricey`)).rejects.toThrow(/exceeds maxPerCall/)
    expect(hits).toBe(0)
    expect(pc.getTransactionCount()).toBe(0)
  })

  it('refuses a non-USDC offer', async () => {
    hits = 0
    const pc = new PaymentClient({ privateKey: KEY })
    await expect(pc.fetch(`${base}/fake-token`)).rejects.toThrow(/not monad-testnet USDC/)
    expect(hits).toBe(0)
  })

  it('refuses an offer on the other Monad network', async () => {
    const pc = new PaymentClient({ privateKey: KEY, network: 'monad' })
    await expect(pc.fetch(`${base}/weather`)).rejects.toThrow(/network eip155:10143 is not eip155:143/)
  })
})
