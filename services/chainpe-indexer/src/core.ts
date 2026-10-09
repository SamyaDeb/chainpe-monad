/**
 * Pure indexing logic: event args → DB rows, payment verification of feedback
 * ("no receipt, no rating"), and reputation scoring/ranking. No DB or RPC here,
 * so all of it is unit-testable.
 */
import { formatUnits } from 'viem'

const USDC_DECIMALS = 6
const ZERO_HASH = '0x' + '0'.repeat(64)

export interface ServiceRow {
  key: string
  developer: string
  name: string
  description: string
  tags: string
  endpoint: string
  pricePerRequest: string
  paymentToken: string
  payTo: string
  agentId: string | null
  active: boolean
  updatedBlock: bigint
}

export interface FeedbackRow {
  agentId: string
  client: string
  feedbackIndex: bigint
  /** int128 as a decimal string (stored as NUMERIC). */
  value: string
  valueDecimals: number
  tag1: string | null
  tag2: string | null
  endpoint: string | null
  feedbackUri: string | null
  feedbackHash: string | null
  revoked: boolean
  block: bigint
  logIndex: number
  txHash: string | null
}

export interface ServiceEventArgs {
  key: string
  developer: string
  name: string
  endpoint: string
  pricePerRequest: string
  paymentToken: string
  payTo: string
  agentId: bigint
}

export interface FeedbackEventArgs {
  agentId: bigint
  clientAddress: string
  feedbackIndex: bigint
  value: bigint
  valueDecimals: number
  tag1: string
  tag2: string
  endpoint?: string
  feedbackURI?: string
  feedbackHash?: string
}

/**
 * ServiceRegistered / ServiceUpdated → a `services` row (active). The events
 * omit description + tags, so the indexer passes them in via `extra` (read from
 * the registry's `getService` view).
 */
export function serviceRowFromArgs(
  args: ServiceEventArgs,
  block: bigint,
  extra?: { description?: string; tags?: string }
): ServiceRow {
  return {
    key: args.key,
    developer: args.developer,
    name: args.name,
    description: extra?.description ?? '',
    tags: extra?.tags ?? '',
    endpoint: args.endpoint,
    pricePerRequest: args.pricePerRequest,
    paymentToken: args.paymentToken || 'USDC',
    payTo: args.payTo,
    agentId: args.agentId > 0n ? args.agentId.toString() : null,
    active: true,
    updatedBlock: block
  }
}

/** NewFeedback → a `feedback` row. The int128 value stays exact (string). */
export function feedbackRowFromArgs(
  args: FeedbackEventArgs,
  block: bigint,
  meta: { logIndex?: number; txHash?: string | null } = {}
): FeedbackRow {
  const hash = args.feedbackHash?.toLowerCase()
  return {
    agentId: args.agentId.toString(),
    client: args.clientAddress,
    feedbackIndex: args.feedbackIndex,
    value: args.value.toString(),
    valueDecimals: Number(args.valueDecimals),
    tag1: args.tag1 || null,
    tag2: args.tag2 || null,
    endpoint: args.endpoint || null,
    feedbackUri: args.feedbackURI || null,
    feedbackHash: hash && hash !== ZERO_HASH ? hash : null,
    revoked: false,
    block,
    logIndex: meta.logIndex ?? 0,
    txHash: meta.txHash ?? null
  }
}

/**
 * A feedback value (int128 + decimals) as a score clamped to 0–100. Compared in
 * bigint first, so 1e30 or ±2^127 neither throws nor overflows to Infinity.
 */
export function normalizeValue(value: string | number | bigint, decimals: number): number {
  const d = Math.max(0, Math.min(77, Math.trunc(decimals) || 0))
  let v: bigint
  try {
    v = typeof value === 'bigint' ? value : BigInt(value)
  } catch {
    // Not an integer string (e.g. "1.7e+38" from a driver that parsed NUMERIC
    // into a float): fall back to floating point, still clamped.
    const f = Number(value) / 10 ** d
    return Number.isNaN(f) ? 0 : Math.min(100, Math.max(0, f))
  }
  const scale = 10n ** BigInt(d)
  if (v <= 0n) return 0
  if (v >= 100n * scale) return 100
  return Number(v) / Number(scale)
}

// ─── Payment verification ("no receipt, no rating") ─────────────────────────

export interface TokenTransfer {
  token: string
  from: string
  to: string
  value: bigint
}

/** A `PolicyVault.Spent` in the receipt: the vault paid `to` on the owner's behalf (x402 `chainpe-vault`). */
export interface VaultSpend {
  vault: string
  owner: string
  to: string
  amount: bigint
  /** Session key that signed the spend (recovered from the `spend` calldata), when known. */
  sessionKey: string | null
}

export interface SettlementReceipt {
  status: 'success' | 'reverted'
  transfers: TokenTransfer[]
  vaultSpends?: VaultSpend[]
}

export interface VerifyInput {
  feedback: { agentId: string; client: string; feedbackHash: string | null }
  /** Receipt of the tx named by `feedbackHash`; null when there is no such tx. */
  receipt: SettlementReceipt | null
  usdc: string
  /** The PolicyVault whose `Spent` events count as payments (mandate mode), if any. */
  vault?: string | null
  /** Registered ChainPe services linked to the feedback's agentId. */
  services: { payTo: string; developer: string }[]
  agentOwner?: string | null
  agentWallet?: string | null
  minAmountAtomic: bigint
  /** True when another feedback already counts this receipt as paid. */
  receiptAlreadyUsed: boolean
}

export type Verdict =
  | { paid: true; amount: bigint; payer: string }
  | { paid: false; reason: UnpaidReason }

export type UnpaidReason =
  | 'no_receipt'
  | 'receipt_reused'
  | 'no_registered_service'
  | 'self_dealing'
  | 'tx_not_found'
  | 'tx_reverted'
  | 'no_matching_transfer'
  | 'below_minimum'

const lc = (a: string | null | undefined) => (a ?? '').toLowerCase()

/**
 * A feedback is PAID only if its feedbackHash is a successful tx whose receipt
 * holds a payment to the payTo of a registered service linked to that agentId,
 * worth at least the minimum, made by the feedback's client:
 *   - a USDC Transfer from the client (x402 `exact`), or
 *   - a `PolicyVault.Spent` from our vault (x402 `chainpe-vault`) whose owner is
 *     the client, or whose signing session key is the client.
 * A receipt backs at most one feedback, and the developer / payTo / agent owner
 * / agentWallet paying themselves (directly or through a vault) does not count.
 */
export function verifyFeedbackPayment(input: VerifyInput): Verdict {
  const { feedback, receipt } = input
  const hash = lc(feedback.feedbackHash)
  if (!/^0x[0-9a-f]{64}$/.test(hash) || hash === ZERO_HASH) return { paid: false, reason: 'no_receipt' }
  if (input.receiptAlreadyUsed) return { paid: false, reason: 'receipt_reused' }
  if (input.services.length === 0) return { paid: false, reason: 'no_registered_service' }

  const client = lc(feedback.client)
  const payTos = new Set(input.services.map(s => lc(s.payTo)))
  const insiders = new Set([
    ...payTos,
    ...input.services.map(s => lc(s.developer)),
    lc(input.agentOwner),
    lc(input.agentWallet)
  ])
  insiders.delete('')
  insiders.delete('0x0000000000000000000000000000000000000000')
  if (insiders.has(client)) return { paid: false, reason: 'self_dealing' }

  if (!receipt) return { paid: false, reason: 'tx_not_found' }
  if (receipt.status !== 'success') return { paid: false, reason: 'tx_reverted' }

  const usdc = lc(input.usdc)
  let amount = 0n
  let payer = feedback.client
  for (const t of receipt.transfers) {
    if (lc(t.token) === usdc && lc(t.from) === client && payTos.has(lc(t.to))) amount += t.value
  }
  const vault = lc(input.vault)
  if (vault) {
    for (const s of receipt.vaultSpends ?? []) {
      if (lc(s.vault) !== vault || !payTos.has(lc(s.to))) continue
      if (lc(s.owner) !== client && lc(s.sessionKey) !== client) continue
      if (insiders.has(lc(s.owner))) return { paid: false, reason: 'self_dealing' }
      amount += s.amount
      payer = s.owner // the vault owner is who paid
    }
  }
  if (amount === 0n) return { paid: false, reason: 'no_matching_transfer' }
  if (amount < input.minAmountAtomic) return { paid: false, reason: 'below_minimum' }
  return { paid: true, amount, payer }
}

// ─── Scoring ────────────────────────────────────────────────────────────────

export interface ScoringRow {
  client: string
  value: string | number
  valueDecimals: number
  revoked: boolean
  paidVerified: boolean
  paidAmount: string | null
}

export interface ScoringOptions {
  weightCapAtomic: bigint
  payerShareCap: number
}

export interface ReputationDetail {
  /** Receipt-backed: weighted by payment, per-payer capped. count = distinct payers. */
  paid: { score: number | null; count: number; volume: string }
  /** Every live feedback, values clamped to 0–100, unweighted. */
  raw: { score: number | null; count: number }
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Caps each weight so no entry exceeds `share` of the capped total. Finds the
 * largest cap c with c = share × Σ min(wᵢ, c). When there are too few entries
 * for that to exist (n × share ≤ 1), everyone gets equal weight — the most even
 * split possible.
 */
export function capWeights(weights: number[], share: number): number[] {
  const n = weights.length
  if (n === 0) return []
  if (share >= 1) return [...weights]
  if (n * share <= 1) {
    const min = Math.min(...weights)
    return weights.map(() => min)
  }
  const sorted = [...weights].sort((a, b) => b - a)
  const total = sorted.reduce((a, b) => a + b, 0)
  let rest = total
  for (let k = 0; k < n; k++) {
    // k = number of top entries capped at c.
    if (k > 0) rest -= sorted[k - 1]
    const denom = 1 - k * share
    if (denom <= 0) break
    const c = (share * rest) / denom
    const topOk = k === 0 || c <= sorted[k - 1]
    const nextOk = c >= sorted[k]
    if (topOk && nextOk) return weights.map(w => Math.min(w, c))
  }
  const min = Math.min(...weights)
  return weights.map(() => min)
}

/** Raw + paid reputation for one agent's feedback rows. */
export function scoreReputation(rows: ScoringRow[], opts: ScoringOptions): ReputationDetail {
  const live = rows.filter(r => !r.revoked)

  const rawClients = new Set(live.map(r => lc(r.client)))
  const rawScore = live.length
    ? round2(live.reduce((acc, r) => acc + normalizeValue(r.value, r.valueDecimals), 0) / live.length)
    : null

  // Paid: per payer, a weighted mean of their ratings and a total weight.
  const byPayer = new Map<string, { weight: number; weighted: number }>()
  let volume = 0n
  for (const r of live) {
    if (!r.paidVerified || !r.paidAmount) continue
    let amount: bigint
    try {
      amount = BigInt(r.paidAmount)
    } catch {
      continue
    }
    if (amount <= 0n) continue
    volume += amount
    const capped = amount < opts.weightCapAtomic ? amount : opts.weightCapAtomic
    const w = Number(capped) / 10 ** USDC_DECIMALS
    const p = byPayer.get(lc(r.client)) ?? { weight: 0, weighted: 0 }
    p.weight += w
    p.weighted += w * normalizeValue(r.value, r.valueDecimals)
    byPayer.set(lc(r.client), p)
  }

  const payers = [...byPayer.values()].filter(p => p.weight > 0)
  let paidScore: number | null = null
  if (payers.length) {
    const capped = capWeights(
      payers.map(p => p.weight),
      opts.payerShareCap
    )
    const totalW = capped.reduce((a, b) => a + b, 0)
    const sum = payers.reduce((acc, p, i) => acc + capped[i] * (p.weighted / p.weight), 0)
    paidScore = totalW > 0 ? round2(sum / totalW) : null
  }

  return {
    paid: { score: paidScore, count: payers.length, volume: formatUnits(volume, USDC_DECIMALS) },
    raw: { score: rawScore, count: rawClients.size }
  }
}

export type RankMode = 'paid' | 'raw'

export interface RankableService {
  pricePerRequest: string
  reputationDetail: ReputationDetail | null
}

/** Ranks services by the chosen score: scored first, higher score, more raters, then cheaper. */
export function rankServices<T extends RankableService>(services: T[], mode: RankMode = 'paid'): T[] {
  const pick = (s: T) => s.reputationDetail?.[mode] ?? null
  return [...services].sort((a, b) => {
    const sa = pick(a)?.score ?? null
    const sb = pick(b)?.score ?? null
    if ((sa != null) !== (sb != null)) return sa != null ? -1 : 1
    if (sa != null && sb != null && sa !== sb) return sb - sa
    const ca = pick(a)?.count ?? 0
    const cb = pick(b)?.count ?? 0
    if (ca !== cb) return cb - ca
    return parseFloat(a.pricePerRequest) - parseFloat(b.pricePerRequest)
  })
}
