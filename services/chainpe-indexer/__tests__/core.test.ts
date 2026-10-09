import { describe, it, expect } from 'vitest'
import {
  serviceRowFromArgs,
  feedbackRowFromArgs,
  normalizeValue,
  verifyFeedbackPayment,
  capWeights,
  scoreReputation,
  rankServices,
  type ServiceEventArgs,
  type FeedbackEventArgs,
  type VerifyInput,
  type ScoringRow
} from '../src/core.js'

const USDC = '0x534b2f3A21130d7a60830c2Df862319e593943A3'
const OTHER_TOKEN = '0x00000000000000000000000000000000000000aa'
const DEV = '0xD000000000000000000000000000000000000001'
const PAYTO = '0xA000000000000000000000000000000000000002'
const OWNER = '0x0000000000000000000000000000000000000003'
const AGENT_WALLET = '0x0000000000000000000000000000000000000004'
const BUYER = '0xB000000000000000000000000000000000000005'
const TX = '0x' + 'ab'.repeat(32)
const INT128_MAX = (1n << 127n) - 1n

const svcArgs: ServiceEventArgs = {
  key: '0xabc',
  developer: DEV,
  name: 'translate',
  endpoint: 'https://t/translate',
  pricePerRequest: '0.01',
  paymentToken: '',
  payTo: PAYTO,
  agentId: 5n
}

describe('serviceRowFromArgs', () => {
  it('maps args + merges description/tags from extra; defaults token to USDC', () => {
    const row = serviceRowFromArgs(svcArgs, 100n, { description: 'd', tags: 'ai,nlp' })
    expect(row).toMatchObject({ key: '0xabc', agentId: '5', paymentToken: 'USDC', description: 'd', tags: 'ai,nlp', active: true })
    expect(row.updatedBlock).toBe(100n)
  })

  it('treats agentId 0 as null and missing extra as empty', () => {
    const row = serviceRowFromArgs({ ...svcArgs, agentId: 0n }, 1n)
    expect(row.agentId).toBeNull()
    expect(row.description).toBe('')
  })
})

describe('feedbackRowFromArgs', () => {
  const args: FeedbackEventArgs = {
    agentId: 5n,
    clientAddress: BUYER,
    feedbackIndex: 2n,
    value: 90n,
    valueDecimals: 0,
    tag1: 'x402',
    tag2: 'paid-call',
    endpoint: 'https://t',
    feedbackURI: `x402:eip155:10143:${TX}`,
    feedbackHash: TX.toUpperCase().replace('0X', '0x')
  }

  it('keeps the receipt fields and lower-cases the hash', () => {
    const row = feedbackRowFromArgs(args, 50n, { logIndex: 3, txHash: '0xfeed' })
    expect(row).toMatchObject({
      agentId: '5',
      value: '90',
      tag1: 'x402',
      tag2: 'paid-call',
      endpoint: 'https://t',
      feedbackUri: `x402:eip155:10143:${TX}`,
      feedbackHash: TX,
      logIndex: 3,
      txHash: '0xfeed'
    })
  })

  it('stores an int128-sized value exactly (no Number overflow) and nulls a zero hash', () => {
    const row = feedbackRowFromArgs({ ...args, value: INT128_MAX, feedbackHash: '0x' + '0'.repeat(64) }, 1n)
    expect(row.value).toBe(INT128_MAX.toString())
    expect(row.feedbackHash).toBeNull()
  })
})

describe('normalizeValue', () => {
  it('clamps to 0–100 and applies decimals', () => {
    expect(normalizeValue('90', 0)).toBe(90)
    expect(normalizeValue('9050', 2)).toBe(90.5)
    expect(normalizeValue('101', 0)).toBe(100)
    expect(normalizeValue('-5', 0)).toBe(0)
  })

  it('does not crash on 1e30, int128 extremes or junk', () => {
    expect(normalizeValue((10n ** 30n).toString(), 0)).toBe(100)
    expect(normalizeValue(INT128_MAX.toString(), 18)).toBe(100)
    expect(normalizeValue((-INT128_MAX).toString(), 0)).toBe(0)
    expect(normalizeValue('not-a-number', 0)).toBe(0)
    expect(normalizeValue('1.7014118346046923e+38', 0)).toBe(100)
    expect(normalizeValue(1e30, 0)).toBe(100)
    expect(normalizeValue('-1e30', 0)).toBe(0)
    expect(normalizeValue('9050.0', 2)).toBe(90.5)
    expect(normalizeValue('50', 255)).toBeCloseTo(0) // absurd decimals: tiny but finite
  })
})

describe('verifyFeedbackPayment', () => {
  const base = (over: Partial<VerifyInput> = {}): VerifyInput => ({
    feedback: { agentId: '5', client: BUYER, feedbackHash: TX },
    receipt: { status: 'success', transfers: [{ token: USDC, from: BUYER, to: PAYTO, value: 10_000n }] },
    usdc: USDC,
    services: [{ payTo: PAYTO, developer: DEV }],
    agentOwner: OWNER,
    agentWallet: AGENT_WALLET,
    minAmountAtomic: 1_000n,
    receiptAlreadyUsed: false,
    ...over
  })

  it('accepts a USDC transfer from the client to the agent service payTo', () => {
    expect(verifyFeedbackPayment(base())).toEqual({ paid: true, amount: 10_000n, payer: BUYER })
  })

  it('is case-insensitive on addresses', () => {
    const v = verifyFeedbackPayment(
      base({ feedback: { agentId: '5', client: BUYER.toLowerCase(), feedbackHash: TX }, usdc: USDC.toLowerCase() })
    )
    expect(v.paid).toBe(true)
  })

  it('unpaid feedback never counts as paid', () => {
    const cases: [Partial<VerifyInput>, string][] = [
      [{ feedback: { agentId: '5', client: BUYER, feedbackHash: null } }, 'no_receipt'],
      [{ feedback: { agentId: '5', client: BUYER, feedbackHash: '0x' + '0'.repeat(64) } }, 'no_receipt'],
      [{ feedback: { agentId: '5', client: BUYER, feedbackHash: '0x1234' } }, 'no_receipt'],
      [{ receipt: null }, 'tx_not_found'],
      [{ receipt: { status: 'reverted', transfers: [{ token: USDC, from: BUYER, to: PAYTO, value: 10_000n }] } }, 'tx_reverted'],
      [{ receipt: { status: 'success', transfers: [] } }, 'no_matching_transfer'],
      [{ receipt: { status: 'success', transfers: [{ token: OTHER_TOKEN, from: BUYER, to: PAYTO, value: 10_000n }] } }, 'no_matching_transfer'],
      [{ receipt: { status: 'success', transfers: [{ token: USDC, from: OWNER, to: PAYTO, value: 10_000n }] } }, 'no_matching_transfer'],
      [{ receipt: { status: 'success', transfers: [{ token: USDC, from: BUYER, to: BUYER, value: 10_000n }] } }, 'no_matching_transfer'],
      [{ receipt: { status: 'success', transfers: [{ token: USDC, from: BUYER, to: PAYTO, value: 999n }] } }, 'below_minimum'],
      [{ services: [] }, 'no_registered_service'],
      [{ receiptAlreadyUsed: true }, 'receipt_reused']
    ]
    for (const [over, reason] of cases) {
      expect(verifyFeedbackPayment(base(over)), reason).toEqual({ paid: false, reason })
    }
  })

  it('ignores self-payment by the developer, payTo, agent owner or agentWallet', () => {
    for (const insider of [DEV, PAYTO, OWNER, AGENT_WALLET]) {
      const v = verifyFeedbackPayment(
        base({
          feedback: { agentId: '5', client: insider, feedbackHash: TX },
          receipt: { status: 'success', transfers: [{ token: USDC, from: insider, to: PAYTO, value: 10_000n }] }
        })
      )
      expect(v, insider).toEqual({ paid: false, reason: 'self_dealing' })
    }
  })

  it('a payment to another agent’s payTo does not back this agent', () => {
    const v = verifyFeedbackPayment(
      base({ receipt: { status: 'success', transfers: [{ token: USDC, from: BUYER, to: '0x' + '99'.repeat(20), value: 10_000n }] } })
    )
    expect(v).toEqual({ paid: false, reason: 'no_matching_transfer' })
  })
})

describe('capWeights', () => {
  const share = (w: number[]) => {
    const t = w.reduce((a, b) => a + b, 0)
    return Math.max(...w) / t
  }

  it('leaves balanced weights alone', () => {
    expect(capWeights([1, 1, 1, 1, 1], 0.25)).toEqual([1, 1, 1, 1, 1])
  })

  it('caps a whale so no payer exceeds 25%', () => {
    const out = capWeights([100, 1, 1, 1, 1, 1], 0.25)
    expect(share(out)).toBeLessThanOrEqual(0.25 + 1e-9)
    expect(out.slice(1)).toEqual([1, 1, 1, 1, 1])
  })

  it('caps several heavy payers', () => {
    const out = capWeights([50, 40, 1, 1, 1, 1, 1, 1], 0.25)
    expect(share(out)).toBeLessThanOrEqual(0.25 + 1e-9)
  })

  it('falls back to equal weights when fewer than 1/share payers exist', () => {
    expect(capWeights([5, 1], 0.25)).toEqual([1, 1])
    expect(capWeights([3], 0.25)).toEqual([3])
  })
})

describe('scoreReputation', () => {
  const opts = { weightCapAtomic: 1_000_000n, payerShareCap: 0.25 }
  const row = (client: string, value: string | number, paidAmount: string | null, extra: Partial<ScoringRow> = {}): ScoringRow => ({
    client,
    value: String(value),
    valueDecimals: 0,
    revoked: false,
    paidVerified: paidAmount != null,
    paidAmount,
    ...extra
  })
  const payer = (i: number) => '0x' + i.toString(16).padStart(40, '0')

  it('is empty without feedback', () => {
    expect(scoreReputation([], opts)).toEqual({ paid: { score: null, count: 0, volume: '0' }, raw: { score: null, count: 0 } })
  })

  it('a 1e30 value neither crashes nor dominates', () => {
    const rows = [row(payer(1), 10, '10000'), row(payer(2), 10, '10000'), row(payer(3), (10n ** 30n).toString(), null)]
    const r = scoreReputation(rows, opts)
    expect(r.raw.score).toBe(40) // (10 + 10 + 100) / 3 — clamped, not 3.3e29
    expect(r.paid.score).toBe(10) // unpaid giant value is not in paid at all
  })

  it('unpaid feedback shows in raw but not in paid', () => {
    const r = scoreReputation([row(payer(1), 20, '10000'), row(payer(2), 100, null)], opts)
    expect(r.raw).toEqual({ score: 60, count: 2 })
    expect(r.paid).toEqual({ score: 20, count: 1, volume: '0.01' })
  })

  it('ignores revoked feedback', () => {
    const r = scoreReputation([row(payer(1), 20, '10000', { revoked: true }), row(payer(2), 80, '10000')], opts)
    expect(r.paid.score).toBe(80)
    expect(r.raw.count).toBe(1)
  })

  it('weights by payment, capped per receipt', () => {
    const big = scoreReputation(
      [row(payer(1), 0, '1000000000'), row(payer(2), 100, '1000000'), row(payer(3), 100, '1000000'), row(payer(4), 100, '1000000')],
      opts
    )
    // $1000 is capped to $1 → four equal weights.
    expect(big.paid.score).toBe(75)
    expect(big.paid.volume).toBe('1003')
  })

  it('one payer cannot exceed 25% of the paid weight, however many receipts', () => {
    const rows = [
      ...Array.from({ length: 50 }, () => row(payer(99), 0, '1000000')), // farm: 50 receipts at $1, rates 0
      row(payer(1), 100, '1000000'),
      row(payer(2), 100, '1000000'),
      row(payer(3), 100, '1000000'),
      row(payer(4), 100, '1000000'),
      row(payer(5), 100, '1000000'),
      row(payer(6), 100, '1000000')
    ]
    const r = scoreReputation(rows, opts)
    // Uncapped the farmer would hold 50/56 ≈ 89% of the weight. Capped at 25%: score = 75.
    expect(r.paid.count).toBe(7)
    expect(r.paid.score).toBe(75)
  })
})

describe('rankServices', () => {
  const s = (name: string, paid: number | null, raw: number | null, price = '0.01') => ({
    name,
    pricePerRequest: price,
    reputationDetail: { paid: { score: paid, count: paid == null ? 0 : 1, volume: '0' }, raw: { score: raw, count: raw == null ? 0 : 1 } }
  })

  it('ranks by paid score by default and by raw on request', () => {
    const list = [s('farmed', null, 100), s('honest', 80, 80), s('mixed', 60, 90)]
    expect(rankServices(list).map(x => x.name)).toEqual(['honest', 'mixed', 'farmed'])
    expect(rankServices(list, 'raw').map(x => x.name)).toEqual(['farmed', 'mixed', 'honest'])
  })

  it('breaks ties by count, then price; unscored last', () => {
    const list = [{ name: 'none', pricePerRequest: '0.001', reputationDetail: null }, s('b', 80, 80, '0.05'), s('a', 80, 80, '0.01')]
    expect(rankServices(list).map(x => x.name)).toEqual(['a', 'b', 'none'])
  })
})
