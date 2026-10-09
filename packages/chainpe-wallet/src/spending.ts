/**
 * Spending budget — per-call and per-UTC-day USDC limits, persisted to
 * ~/.chainpe/spending.json so a restart of the MCP server (or Claude Desktop)
 * cannot reset the day's allowance. Amounts are bigint atomic USDC internally.
 *
 * The file is re-read on every operation, so several processes sharing a
 * wallet see each other's spend. (Writes are atomic but not locked: two
 * processes recording at the exact same instant can lose one entry.)
 */
import fs from 'node:fs'
import path from 'node:path'
import { formatUnits, parseUnits } from 'viem'
import { USDC_DECIMALS } from '@chainpeavax/sdk'
import type { BudgetConfig, SpendingRecord } from './types.js'
import { chainpeDir } from './wallet-store.js'

const MAX_HISTORY = 100

interface SpendingState {
  /** UTC day the `spentToday` counter belongs to (YYYY-MM-DD). */
  date: string
  /** Atomic USDC spent on `date`. Stored as a string (bigint). */
  spentToday: string
  history: SpendingRecord[]
}

export function getSpendingPath(): string {
  return process.env.CHAINPE_SPENDING_PATH?.trim() || path.join(chainpeDir(), 'spending.json')
}

export interface SpendingOptions {
  filePath?: string
  now?: () => Date
}

function toAtomic(amountUsdc: string): bigint {
  if (!/^\d+(\.\d+)?$/.test(amountUsdc.trim())) throw new Error(`Invalid USDC amount "${amountUsdc}"`)
  return parseUnits(amountUsdc.trim(), USDC_DECIMALS)
}

const fmt = (atomic: bigint) => Number(formatUnits(atomic, USDC_DECIMALS)).toFixed(USDC_DECIMALS)

export class SpendingTracker {
  private readonly perCall: bigint
  private readonly perDay: bigint
  private readonly file: string
  private readonly now: () => Date
  private spentSession = 0n

  constructor(
    private readonly config: BudgetConfig,
    options: SpendingOptions = {}
  ) {
    this.perCall = toAtomic(config.maxPerCall)
    this.perDay = toAtomic(config.maxPerDay)
    this.file = options.filePath ?? getSpendingPath()
    this.now = options.now ?? (() => new Date())
  }

  /** Throws when `amountUsdc` breaks the per-call or remaining daily budget. */
  check(amountUsdc: string): void {
    const amount = toAtomic(amountUsdc)
    const state = this.load()
    if (amount > this.perCall) {
      throw new Error(`Amount $${amountUsdc} exceeds per-call limit of $${this.config.maxPerCall}`)
    }
    if (BigInt(state.spentToday) + amount > this.perDay) {
      throw new Error(
        `Payment would exceed daily limit of $${this.config.maxPerDay} (spent today: $${fmt(BigInt(state.spentToday))})`
      )
    }
  }

  /**
   * The most USDC (atomic) a single payment may be right now:
   * min(per-call limit, what is left of today's budget). Pass it to the SDK as
   * `maxPerCallAtomic` so an over-budget offer is never signed.
   */
  maxAllowedAtomic(): bigint {
    const left = this.remainingDailyAtomic()
    const allowed = left < this.perCall ? left : this.perCall
    return allowed > 0n ? allowed : 0n
  }

  /** What is left of today's budget (atomic USDC). */
  remainingDailyAtomic(): bigint {
    const left = this.perDay - BigInt(this.load().spentToday)
    return left > 0n ? left : 0n
  }

  record(amountUsdc: string, recipient: string, network: string, txHash?: string): void {
    const amount = toAtomic(amountUsdc)
    const state = this.load()
    state.spentToday = (BigInt(state.spentToday) + amount).toString()
    state.history.push({
      recipient,
      amount: amountUsdc,
      network,
      timestamp: this.now().toISOString(),
      ...(txHash ? { txHash } : {})
    })
    state.history = state.history.slice(-MAX_HISTORY)
    this.spentSession += amount
    this.save(state)
  }

  getSummary() {
    const state = this.load()
    return {
      spentToday: fmt(BigInt(state.spentToday)),
      spentSession: fmt(this.spentSession),
      limits: { maxPerCall: this.config.maxPerCall, maxPerDay: this.config.maxPerDay },
      recentPayments: state.history.slice(-10),
      storedAt: this.file
    }
  }

  // ─── persistence ───────────────────────────────────────────────────────────

  private today(): string {
    return this.now().toISOString().slice(0, 10)
  }

  private fresh(): SpendingState {
    return { date: this.today(), spentToday: '0', history: [] }
  }

  private load(): SpendingState {
    let raw: string
    try {
      raw = fs.readFileSync(this.file, 'utf-8')
    } catch {
      return this.fresh() // no file yet
    }
    let state: SpendingState
    try {
      const parsed = JSON.parse(raw) as Partial<SpendingState>
      if (typeof parsed.date !== 'string' || !/^\d+$/.test(String(parsed.spentToday ?? ''))) {
        throw new Error('malformed')
      }
      state = {
        date: parsed.date,
        spentToday: String(parsed.spentToday),
        history: Array.isArray(parsed.history) ? parsed.history : []
      }
    } catch {
      // Never fail open silently: keep the bad file for inspection and say so.
      try {
        fs.renameSync(this.file, `${this.file}.corrupt`)
      } catch {
        /* best effort */
      }
      process.stderr.write(`chainpe-wallet: ${this.file} was unreadable; moved aside and starting a fresh budget.\n`)
      return this.fresh()
    }
    if (state.date !== this.today()) {
      state.date = this.today() // resets at UTC midnight
      state.spentToday = '0'
    }
    return state
  }

  private save(state: SpendingState): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 })
    const tmp = `${this.file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 })
    fs.renameSync(tmp, this.file)
  }
}
