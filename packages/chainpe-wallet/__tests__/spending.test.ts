import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SpendingTracker } from '../src/spending.js'

let dir: string
let file: string
let clock: Date
const now = () => clock
const tracker = (maxPerCall: string, maxPerDay: string) =>
  new SpendingTracker({ maxPerCall, maxPerDay }, { filePath: file, now })

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chainpe-spend-'))
  file = path.join(dir, 'nested', 'spending.json')
  clock = new Date('2026-10-09T12:00:00Z')
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('SpendingTracker', () => {
  it('allows spending within the per-call limit', () => {
    expect(() => tracker('1.00', '10.00').check('0.50')).not.toThrow()
  })

  it('rejects spending over the per-call limit', () => {
    expect(() => tracker('0.10', '10.00').check('0.50')).toThrow(/per-call limit/)
  })

  it('rejects spending over the daily limit', () => {
    const t = tracker('5.00', '1.00')
    t.record('0.80', '0xABC', 'monad-testnet')
    expect(() => t.check('0.30')).toThrow(/daily limit/)
    expect(() => t.check('0.20')).not.toThrow()
  })

  it('rejects malformed and negative amounts', () => {
    const t = tracker('1', '1')
    expect(() => t.check('-1')).toThrow(/Invalid USDC amount/)
    expect(() => t.check('abc')).toThrow(/Invalid USDC amount/)
  })

  it('records spending in history with the tx hash', () => {
    const t = tracker('10.00', '100.00')
    t.record('1.00', '0xABC', 'monad-testnet', '0xhash')
    t.record('2.00', '0xDEF', 'monad-testnet')
    const s = t.getSummary()
    expect(s.recentPayments).toHaveLength(2)
    expect(s.recentPayments[0]).toMatchObject({ recipient: '0xABC', amount: '1.00', txHash: '0xhash' })
    expect(s.recentPayments[1].recipient).toBe('0xDEF')
    expect(s.spentToday).toBe('3.000000')
  })

  it('returns a correct summary', () => {
    const t = tracker('1.00', '20.00')
    t.record('0.05', '0xABC', 'monad-testnet')
    const s = t.getSummary()
    expect(s.limits).toEqual({ maxPerCall: '1.00', maxPerDay: '20.00' })
    expect(s.spentToday).toBe('0.050000')
    expect(s.spentSession).toBe('0.050000')
  })

  it('shows the 10 most recent payments', () => {
    const t = tracker('10.00', '1000.00')
    for (let i = 0; i < 15; i++) t.record('0.01', `addr-${i}`, 'monad-testnet')
    const s = t.getSummary()
    expect(s.recentPayments).toHaveLength(10)
    expect(s.recentPayments[9].recipient).toBe('addr-14')
  })

  it('maxAllowedAtomic is min(per-call, remaining daily)', () => {
    const t = tracker('0.50', '0.70')
    expect(t.maxAllowedAtomic()).toBe(500_000n)
    t.record('0.40', '0xABC', 'monad-testnet')
    expect(t.maxAllowedAtomic()).toBe(300_000n)
    t.record('0.30', '0xABC', 'monad-testnet')
    expect(t.maxAllowedAtomic()).toBe(0n)
  })
})

describe('budget persistence (~/.chainpe/spending.json)', () => {
  it('survives a restart: a new tracker sees the day’s spend and history', () => {
    const first = tracker('1.00', '1.00')
    first.record('0.90', '0xABC', 'monad-testnet', '0xhash')

    const restarted = tracker('1.00', '1.00')
    expect(restarted.getSummary().spentToday).toBe('0.900000')
    expect(restarted.getSummary().spentSession).toBe('0.000000') // session is per-process
    expect(restarted.getSummary().recentPayments[0].txHash).toBe('0xhash')
    expect(() => restarted.check('0.20')).toThrow(/daily limit/)
  })

  it('writes the file with 0600 permissions under a created directory', () => {
    tracker('1', '1').record('0.10', '0xABC', 'monad-testnet')
    expect(JSON.parse(fs.readFileSync(file, 'utf-8')).spentToday).toBe('100000')
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
  })

  it('resets the daily counter at UTC midnight but keeps history', () => {
    clock = new Date('2026-10-09T23:59:59Z')
    const t = tracker('1.00', '1.00')
    t.record('1.00', '0xABC', 'monad-testnet')
    expect(() => t.check('0.10')).toThrow(/daily limit/)

    clock = new Date('2026-10-10T00:00:00Z')
    expect(() => t.check('0.10')).not.toThrow()
    expect(tracker('1.00', '1.00').getSummary().spentToday).toBe('0.000000')
    expect(t.getSummary().recentPayments).toHaveLength(1)
  })

  it('does not reset on restart within the same UTC day', () => {
    clock = new Date('2026-10-09T00:00:01Z')
    tracker('1', '1').record('0.50', '0xABC', 'monad-testnet')
    clock = new Date('2026-10-09T23:59:00Z')
    expect(tracker('1', '1').getSummary().spentToday).toBe('0.500000')
  })

  it('moves a corrupt file aside instead of crashing', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '{not json')
    const t = tracker('1', '1')
    expect(t.getSummary().spentToday).toBe('0.000000')
    expect(fs.existsSync(`${file}.corrupt`)).toBe(true)
  })
})
