import { describe, it, expect } from 'vitest'
import {
  summaryToScore,
  getReputation,
  giveFeedback,
  buildFeedbackArgs,
  paymentFeedbackUri,
  verifyPaymentReceipt
} from '../src/reputation.js'

describe('summaryToScore', () => {
  it('applies the on-chain decimals', () => {
    expect(summaryToScore(95n, 0)).toBe(95)
    expect(summaryToScore(9500n, 2)).toBe(95)
    expect(summaryToScore(0n, 0)).toBe(0)
  })
})

describe('getReputation guards', () => {
  it('returns null for unlinked agents (id 0 / empty)', async () => {
    const reg = '0x89476DfEf9c72a668fa5E86f154B73EDB053aFe4' as const
    expect(await getReputation('monad-testnet', reg, '0')).toBeNull()
    expect(await getReputation('monad-testnet', reg, '')).toBeNull()
  })

  it('returns null when no reputation registry is configured', async () => {
    expect(await getReputation('monad-testnet', undefined, '5')).toBeNull()
  })
})

describe('buildFeedbackArgs (receipt-backed feedback)', () => {
  const tx = '0x544876CF98bee1166e31473641c25528c4fe42b677754352fd042460fe9e0c28'

  it('uses the settlement tx as feedbackHash with x402 tags and URI', () => {
    const args = buildFeedbackArgs('monad-testnet', {
      agentId: '42',
      value: 87,
      paymentTxHash: tx,
      endpoint: 'https://seller.example/api'
    })
    expect(args).toEqual([
      42n,
      87n,
      0,
      'x402',
      'paid-call',
      'https://seller.example/api',
      `x402:eip155:10143:${tx.toLowerCase()}`,
      tx.toLowerCase()
    ])
    expect(paymentFeedbackUri('monad', tx)).toBe(`x402:eip155:143:${tx.toLowerCase()}`)
  })

  it('clamps and rounds the value to 0–100', () => {
    expect(buildFeedbackArgs('monad-testnet', { agentId: '1', value: 1e30, paymentTxHash: tx })[1]).toBe(100n)
    expect(buildFeedbackArgs('monad-testnet', { agentId: '1', value: -5, paymentTxHash: tx })[1]).toBe(0n)
    expect(buildFeedbackArgs('monad-testnet', { agentId: '1', value: 49.6, paymentTxHash: tx })[1]).toBe(50n)
    expect(() => buildFeedbackArgs('monad-testnet', { agentId: '1', value: NaN, paymentTxHash: tx })).toThrow()
  })

  it('refuses feedback without a payment receipt', () => {
    for (const paymentTxHash of ['', '0x1234', 'not-a-hash', `${tx}00`]) {
      expect(() => buildFeedbackArgs('monad-testnet', { agentId: '1', value: 90, paymentTxHash })).toThrow(/receipt/)
    }
  })

  it('refuses an invalid agent id', () => {
    for (const agentId of ['0', '', 'abc', '-1']) {
      expect(() => buildFeedbackArgs('monad-testnet', { agentId, value: 90, paymentTxHash: tx })).toThrow(/agentId/)
    }
  })

  it('giveFeedback rejects before any RPC when the receipt is missing', async () => {
    const reg = '0x8004B663056A597Dffe9eCcC1965A193B7388713' as const
    const key = '0x' + '11'.repeat(32)
    await expect(giveFeedback('monad-testnet', reg, key, { agentId: '1', value: 90, paymentTxHash: '' })).rejects.toThrow(
      /receipt/
    )
  })
})

describe('verifyPaymentReceipt', () => {
  it('rejects a malformed hash without an RPC call', async () => {
    const r = await verifyPaymentReceipt('monad-testnet', '0xabc', '0x0000000000000000000000000000000000000001')
    expect(r).toEqual({ ok: false, amount: 0n, reason: 'not a tx hash' })
  })
})
