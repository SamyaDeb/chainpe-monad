/**
 * Pure indexing logic: map decoded contract-event args → DB row shapes, and
 * aggregate/rank reputation. No DB or RPC here, so it's all unit-testable.
 */

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
  value: number
  valueDecimals: number
  tag1: string | null
  tag2: string | null
  revoked: boolean
  block: bigint
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

/** NewFeedback → a `feedback` row. */
export function feedbackRowFromArgs(args: FeedbackEventArgs, block: bigint): FeedbackRow {
  return {
    agentId: args.agentId.toString(),
    client: args.clientAddress,
    feedbackIndex: args.feedbackIndex,
    value: Number(args.value),
    valueDecimals: Number(args.valueDecimals),
    tag1: args.tag1 || null,
    tag2: args.tag2 || null,
    revoked: false,
    block
  }
}

export interface ReputationSummary {
  count: number
  score: number | null
}

/**
 * Aggregates a provider agent's feedback into a summary, mirroring the on-chain
 * ERC-8004 `getSummary`: `count` = distinct clients with live feedback, `score`
 * = mean feedback value (decimals applied). Revoked feedback is excluded.
 */
export function aggregateReputation(
  rows: Pick<FeedbackRow, 'value' | 'valueDecimals' | 'client' | 'revoked'>[]
): ReputationSummary {
  const live = rows.filter(r => !r.revoked)
  if (live.length === 0) return { count: 0, score: null }
  const clients = new Set(live.map(r => r.client.toLowerCase()))
  const sum = live.reduce((acc, r) => acc + r.value / 10 ** r.valueDecimals, 0)
  return { count: clients.size, score: Math.round((sum / live.length) * 100) / 100 }
}

export interface RankableService {
  pricePerRequest: string
  reputation: ReputationSummary | null
}

/** Ranks services: scored first, higher score, more reviews, then cheaper. */
export function rankServices<T extends RankableService>(services: T[]): T[] {
  return [...services].sort((a, b) => {
    const sa = a.reputation?.score ?? null
    const sb = b.reputation?.score ?? null
    const aHas = sa != null
    const bHas = sb != null
    if (aHas !== bHas) return aHas ? -1 : 1
    if (aHas && bHas && sa !== sb) return sb - sa
    const ca = a.reputation?.count ?? 0
    const cb = b.reputation?.count ?? 0
    if (ca !== cb) return cb - ca
    return parseFloat(a.pricePerRequest) - parseFloat(b.pricePerRequest)
  })
}
