import { describe, expect, it, vi } from 'vitest'
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types'
import { checkPayment, PayToAllowlist } from '../src/policy.js'

const USDC = '0x754704Bc059F8C67012fEd69BC8A327a5aafb603'
const SELLER = '0x1111111111111111111111111111111111111111'

const requirements = (over: Partial<PaymentRequirements> = {}): PaymentRequirements => ({
  scheme: 'exact',
  network: 'eip155:143',
  asset: USDC,
  amount: '10000',
  payTo: SELLER,
  maxTimeoutSeconds: 60,
  extra: { name: 'USDC', version: '2' },
  ...over
})

const payloadFor = (r: PaymentRequirements): PaymentPayload => ({
  x402Version: 2,
  accepted: { ...r },
  payload: {}
})

const ctx = {
  caip2: 'eip155:143',
  usdc: USDC,
  minAmountAtomic: 1000n,
  isPayToAllowed: (a: string) => a.toLowerCase() === SELLER
}

describe('checkPayment', () => {
  it('accepts a USDC exact payment to an allowed payTo', () => {
    const r = requirements()
    expect(checkPayment(payloadFor(r), r, ctx)).toEqual({ ok: true })
  })

  it.each([
    ['unsupported_scheme', { scheme: 'upto' }],
    ['unsupported_network', { network: 'eip155:8453' }],
    ['unsupported_asset', { asset: '0x0000000000000000000000000000000000000001' }],
    ['invalid_amount', { amount: '1.5' }],
    ['amount_below_minimum', { amount: '999' }],
    ['payto_not_registered', { payTo: '0x2222222222222222222222222222222222222222' }]
  ] as const)('rejects %s', (reason, over) => {
    const r = requirements(over as Partial<PaymentRequirements>)
    expect(checkPayment(payloadFor(r), r, ctx)).toEqual({ ok: false, reason })
  })

  it('matches the asset case-insensitively', () => {
    const r = requirements({ asset: USDC.toLowerCase() })
    expect(checkPayment(payloadFor(r), r, ctx).ok).toBe(true)
  })

  it('rejects when the signed offer differs from the requirements to settle', () => {
    const r = requirements()
    const signed = payloadFor(requirements({ amount: '20000' }))
    expect(checkPayment(signed, r, ctx)).toEqual({ ok: false, reason: 'accepted_requirements_mismatch' })
    const otherPayTo = payloadFor(requirements({ payTo: '0x3333333333333333333333333333333333333333' }))
    expect(checkPayment(otherPayTo, r, ctx)).toEqual({ ok: false, reason: 'accepted_requirements_mismatch' })
  })
})

describe('PayToAllowlist', () => {
  const page = (items: string[], total: number) =>
    new Response(JSON.stringify({ total, items: items.map(walletAddress => ({ walletAddress })) }))

  it('allows everything when registration is not required', () => {
    const list = new PayToAllowlist(new Set(), false)
    expect(list.isAllowed(SELLER)).toBe(true)
  })

  it('allows only static + registered payTo when required', async () => {
    const fetchImpl = vi.fn(async () => page(['0xAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaa'], 1))
    const list = new PayToAllowlist(new Set([SELLER]), true, 'http://indexer', fetchImpl as unknown as typeof fetch)
    expect(list.isAllowed('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false)
    await list.refresh()
    expect(list.isAllowed('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(true)
    expect(list.isAllowed(SELLER.toUpperCase().replace('0X', '0x'))).toBe(true)
    expect(list.isAllowed('0x4444444444444444444444444444444444444444')).toBe(false)
    expect(fetchImpl).toHaveBeenCalledWith('http://indexer/services?limit=100&offset=0')
  })

  it('pages through the indexer', async () => {
    const addr = (i: number) => `0x${i.toString(16).padStart(40, '0')}`
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, i) => addr(i + 1)), 150))
      .mockResolvedValueOnce(page(Array.from({ length: 50 }, (_, i) => addr(i + 101)), 150))
    const list = new PayToAllowlist(new Set(), true, 'http://indexer', fetchImpl as unknown as typeof fetch)
    await list.refresh()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(list.registeredCount).toBe(150)
  })

  it('keeps the previous set when a refresh fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(page([SELLER], 1))
      .mockResolvedValueOnce(new Response('down', { status: 503 }))
    const list = new PayToAllowlist(new Set(), true, 'http://indexer', fetchImpl as unknown as typeof fetch)
    await list.refresh()
    await expect(list.refresh()).rejects.toThrow(/503/)
    expect(list.isAllowed(SELLER)).toBe(true)
  })
})
