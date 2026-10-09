import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Server } from 'node:http'
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types'
import { parseEther } from 'viem'
import { createApp, type AppDeps } from '../src/app.js'

const USDC = '0x754704Bc059F8C67012fEd69BC8A327a5aafb603'
const SELLER = '0x1111111111111111111111111111111111111111'
const FACILITATOR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

const requirements: PaymentRequirements = {
  scheme: 'exact',
  network: 'eip155:143',
  asset: USDC,
  amount: '10000',
  payTo: SELLER,
  maxTimeoutSeconds: 60,
  extra: { name: 'USDC', version: '2' }
}
const payload: PaymentPayload = { x402Version: 2, accepted: requirements, payload: { signature: '0x' } }

const facilitator = {
  verify: vi.fn(async () => ({ isValid: true, payer: '0xpayer' })),
  settle: vi.fn(async () => ({
    success: true,
    transaction: '0x' + 'ab'.repeat(32),
    network: 'eip155:143' as const,
    payer: '0xpayer'
  })),
  getSupported: vi.fn(() => ({
    kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:143' as const }],
    extensions: [],
    signers: { 'eip155:*': [FACILITATOR] }
  }))
}

let gas: bigint | null = parseEther('50')
const deps: AppDeps = {
  network: 'monad',
  caip2: 'eip155:143',
  usdc: USDC,
  minAmountAtomic: 1000n,
  facilitatorAddress: FACILITATOR,
  facilitator: facilitator as unknown as AppDeps['facilitator'],
  isPayToAllowed: a => a.toLowerCase() === SELLER,
  gasBalance: () => gas,
  lowGasThresholdWei: parseEther('11'),
  allowedOrigins: [],
  trustProxy: 1,
  rateLimitPerMinute: 1000,
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as AppDeps['log']
}

let server: Server
let base: string

beforeAll(async () => {
  await new Promise<void>(resolve => {
    server = createApp(deps).listen(0, () => {
      const addr = server.address()
      base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
      resolve()
    })
  })
})
afterAll(() => server?.close())

const post = (path: string, body: unknown) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('facilitator HTTP contract', () => {
  it('GET /health is a chain-free liveness check', async () => {
    const res = await fetch(`${base}/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'ok', caip2: 'eip155:143', custodial: false, facilitator: FACILITATOR })
  })

  it('GET /health reports degraded when the gas key is low', async () => {
    gas = parseEther('5')
    const body = await (await fetch(`${base}/health`)).json()
    gas = parseEther('50')
    expect(body).toMatchObject({ status: 'degraded', warning: 'low_gas' })
  })

  it('GET /supported returns the facilitator kinds', async () => {
    const body = await (await fetch(`${base}/supported`)).json()
    expect(body.kinds).toEqual([{ x402Version: 2, scheme: 'exact', network: 'eip155:143' }])
  })

  it('POST /verify passes a policy-compliant payment to the facilitator', async () => {
    const res = await post('/verify', { x402Version: 2, paymentPayload: payload, paymentRequirements: requirements })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ isValid: true, payer: '0xpayer' })
    expect(facilitator.verify).toHaveBeenCalledOnce()
  })

  it('POST /verify rejects a malformed body with 400', async () => {
    const res = await post('/verify', { paymentPayload: {}, paymentRequirements: {} })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ isValid: false, invalidReason: 'invalid_request' })
  })

  it('POST /verify refuses an unregistered payTo without calling the facilitator', async () => {
    facilitator.verify.mockClear()
    const other = { ...requirements, payTo: '0x2222222222222222222222222222222222222222' }
    const res = await post('/verify', { x402Version: 2, paymentPayload: { ...payload, accepted: other }, paymentRequirements: other })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ isValid: false, invalidReason: 'payto_not_registered' })
    expect(facilitator.verify).not.toHaveBeenCalled()
  })

  it('POST /settle returns the settlement tx', async () => {
    const res = await post('/settle', { x402Version: 2, paymentPayload: payload, paymentRequirements: requirements })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.transaction).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('POST /settle refuses a non-USDC asset without paying gas', async () => {
    facilitator.settle.mockClear()
    const other = { ...requirements, asset: '0x0000000000000000000000000000000000000001' }
    const res = await post('/settle', { x402Version: 2, paymentPayload: { ...payload, accepted: other }, paymentRequirements: other })
    expect(await res.json()).toMatchObject({ success: false, errorReason: 'unsupported_asset' })
    expect(facilitator.settle).not.toHaveBeenCalled()
  })

  it('POST /settle maps a facilitator crash to a 500', async () => {
    facilitator.settle.mockRejectedValueOnce(new Error('rpc down'))
    const res = await post('/settle', { x402Version: 2, paymentPayload: payload, paymentRequirements: requirements })
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ success: false, errorReason: 'settle_error' })
  })

  it('GET /metrics exposes counters in Prometheus format', async () => {
    const text = await (await fetch(`${base}/metrics`)).text()
    expect(text).toContain('chainpe_settle_total{result="success"} 1')
    expect(text).toContain('chainpe_verify_total{result="policy_rejected"} 1')
  })
})
