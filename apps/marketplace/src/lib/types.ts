/** Shapes served by the ChainPe indexer API (services/chainpe-indexer/src/api.ts). */

export type RankMode = 'paid' | 'raw'

export interface ReputationDetail {
  /** Receipt-backed: weighted by payment, per-payer capped. count = distinct payers. */
  paid: { score: number | null; count: number; volume: string }
  /** Every live rating, unweighted. count = distinct raters. */
  raw: { score: number | null; count: number }
}

export interface Service {
  id: string
  key: string
  name: string
  description: string
  tags: string[]
  endpoint: string
  pricePerRequest: string
  paymentToken: string
  walletAddress: string
  developer: string
  network: string
  agentId?: string
  reputation: { count: number; score: number | null } | null
  reputationDetail: ReputationDetail | null
}

export type FeedbackStatus = 'paid' | 'unpaid' | 'pending'

export interface FeedbackItem {
  agentId: string
  service: { id: string; name: string } | null
  rater: string
  value: number
  rawValue: string
  valueDecimals: number
  status: FeedbackStatus
  paid: boolean
  unpaidReason: string | null
  revoked: boolean
  paidAmount: string | null
  payer: string | null
  feedbackTxHash: string | null
  receiptTxHash: string | null
  citedHash: string | null
  feedbackUri: string | null
  tags: string[]
  endpoint: string | null
  block: string
  blockTime: string | null
}

/** Totals for ChainPe-registered agents (the canonical registry also holds other agents' ratings). */
export interface Stats {
  services: number
  /** Ratings on agents linked to a ChainPe service. */
  ratings: number
  /** …of which backed by a verified x402 payment receipt. */
  paid: number
  /** Ratings on the canonical registry for agents not registered with ChainPe (not shown). */
  otherAgents: number
}

/** Where a page's data came from — always shown on the page. */
export type Source =
  | { kind: 'live'; network: string; indexerUrl: string; lastIndexedBlock: string | null }
  | { kind: 'snapshot'; network: string; at: string; reason: string }

/** The committed fallback (written by scripts/snapshot.mjs from a live indexer). */
export interface Snapshot {
  at: string
  network: string
  label: string
  lastIndexedBlock: string | null
  stats: Stats
  services: Record<RankMode, Service[]>
  feedback: FeedbackItem[]
}
