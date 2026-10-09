/**
 * Phase 5 spike: can @x402/core 2.28 carry a custom scheme end to end?
 * client (SchemeNetworkClient) → @x402/express middleware (SchemeNetworkServer)
 * → x402Facilitator (SchemeNetworkFacilitator), all with scheme "spike-scheme".
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import express from 'express'
import { paymentMiddleware } from '@x402/express'
import { x402ResourceServer } from '@x402/core/server'
import { x402Facilitator } from '@x402/core/facilitator'
import { x402Client, x402HTTPClient } from '@x402/core/client'
import type {
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkClient,
  SchemeNetworkFacilitator,
  SchemeNetworkServer
} from '@x402/core/types'
import { privateKeyToAccount } from 'viem/accounts'
import { verifyTypedData } from 'viem'

const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const account = privateKeyToAccount(KEY)
const NET = 'eip155:10143' as const
const SELLER = '0x1111111111111111111111111111111111111111'
const TYPES = { Msg: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }] } as const

class SpikeClient implements SchemeNetworkClient {
  readonly scheme = 'spike-scheme'
  async createPaymentPayload(x402Version: number, req: PaymentRequirements) {
    const signature = await account.signTypedData({
      types: TYPES, primaryType: 'Msg', message: { to: req.payTo as `0x${string}`, amount: BigInt(req.amount) }
    })
    return { x402Version, payload: { from: account.address, signature } }
  }
}

class SpikeServer implements SchemeNetworkServer {
  readonly scheme = 'spike-scheme'
  readonly defaultAssetTransferMethod = 'default'
  readonly paymentFlows = { default: { supported: ['upfront'] as const, default: 'upfront' as const } }
  async parsePrice(price: unknown) {
    return price as { amount: string; asset: string; extra?: Record<string, unknown> }
  }
  async enhancePaymentRequirements(r: PaymentRequirements) {
    return r
  }
}

const settled: string[] = []
class SpikeFacilitator implements SchemeNetworkFacilitator {
  readonly scheme = 'spike-scheme'
  readonly caipFamily = 'eip155:*'
  getExtra() {
    return undefined
  }
  getSigners() {
    return []
  }
  async verify(p: PaymentPayload, r: PaymentRequirements) {
    const { from, signature } = p.payload as { from: `0x${string}`; signature: `0x${string}` }
    const ok = await verifyTypedData({
      address: from, types: TYPES, primaryType: 'Msg', message: { to: r.payTo as `0x${string}`, amount: BigInt(r.amount) }, signature
    })
    return ok ? { isValid: true, payer: from } : { isValid: false, invalidReason: 'bad_sig', payer: from }
  }
  async settle(p: PaymentPayload) {
    const tx = '0x' + 'cd'.repeat(32)
    settled.push(tx)
    return { success: true, transaction: tx, network: NET, payer: (p.payload as { from: string }).from }
  }
}

let server: Server
let base: string
beforeAll(async () => {
  const facilitator = new x402Facilitator().register(NET, new SpikeFacilitator())
  const app = express()
  const resources = new x402ResourceServer({
    getSupported: async () => facilitator.getSupported(),
    verify: (p, r) => facilitator.verify(p, r),
    settle: (p, r) => facilitator.settle(p, r)
  } as never).register(NET, new SpikeServer() as never)
  app.use(paymentMiddleware({
    'GET /x': { accepts: { scheme: 'spike-scheme', network: NET, payTo: SELLER, price: { asset: '0x534b2f3A21130d7a60830c2Df862319e593943A3', amount: '10000' } }, description: 'spike' }
  } as never, resources))
  app.get('/x', (_req, res) => res.json({ ok: true }))
  await new Promise<void>(r => {
    server = app.listen(0, () => {
      const a = server.address()
      base = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`
      r()
    })
  })
})
afterAll(() => server?.close())

describe('x402 v2 custom scheme (spike)', () => {
  it('client signs → express middleware → custom facilitator verify + settle', async () => {
    const first = await fetch(`${base}/x`)
    expect(first.status).toBe(402)
    const http = new x402HTTPClient(new x402Client().register(NET, new SpikeClient()).setSpendControls(false))
    const required = http.getPaymentRequiredResponse(n => first.headers.get(n), undefined)
    expect(required.accepts[0].scheme).toBe('spike-scheme')
    const payload = await http.createPaymentPayload(required)
    const paid = await fetch(`${base}/x`, { headers: http.encodePaymentSignatureHeader(payload) })
    expect(paid.status).toBe(200)
    expect(await paid.json()).toEqual({ ok: true })
    expect(http.getPaymentSettleResponse(n => paid.headers.get(n)).transaction).toBe(settled[0])
  })
})
