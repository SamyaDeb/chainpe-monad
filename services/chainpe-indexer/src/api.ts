/** REST query API over the indexed data — discovery + payment-backed reputation. */
import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import type { Db } from './db.js'
import {
  listActiveServices,
  getFeedbackForAgents,
  listFeedback,
  getCursor,
  counts,
  type ServiceRecord,
  type FeedbackRecord
} from './store.js'
import { normalizeValue, rankServices, scoreReputation, type RankMode, type ReputationDetail, type ScoringOptions } from './core.js'
import { formatUnits } from 'viem'
import { getIndexerHead } from './indexer.js'

export interface ApiOptions extends ScoringOptions {
  network: string
  /** Express `trust proxy` (Railway: 1) so rate limits apply per client, not per proxy. */
  trustProxy: number | boolean
  rateLimitPerMinute?: number
}

interface ServiceDto {
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
  /** `{count, score}` of the ranking in use (paid by default) — what SDK clients read. */
  reputation: { count: number; score: number | null } | null
  reputationDetail: ReputationDetail | null
}

/** One rating as the feed shows it: who rated, how much, and whether a payment backs it. */
interface FeedbackDto {
  agentId: string
  /** The registered service linked to this agentId, if any. */
  service: { id: string; name: string } | null
  rater: string
  /** Rating clamped to 0–100 (what scoring uses). */
  value: number
  /** On-chain int128 value + decimals, as posted. */
  rawValue: string
  valueDecimals: number
  /** `paid` = backed by a verified x402 settlement; `unpaid` = excluded (see `unpaidReason`); `pending` = not verified yet. */
  status: 'paid' | 'unpaid' | 'pending'
  paid: boolean
  unpaidReason: string | null
  revoked: boolean
  /** USDC paid by the rater in the settlement (decimal string), when paid. */
  paidAmount: string | null
  payer: string | null
  /** The `NewFeedback` tx. */
  feedbackTxHash: string | null
  /** The settlement (x402 receipt) tx that backs this rating — only when paid. */
  receiptTxHash: string | null
  /** The `feedbackHash` the rater cited (may be reused / missing / not a payment). */
  citedHash: string | null
  feedbackUri: string | null
  tags: string[]
  endpoint: string | null
  block: string
  blockTime: string | null
}

function usdc(atomic: string | number | null): string | null {
  if (atomic == null) return null
  try {
    return formatUnits(BigInt(String(atomic)), 6)
  } catch {
    return null
  }
}

function tagsToArray(tags: string): string[] {
  return tags
    .split(',')
    .map(t => t.trim())
    .filter(Boolean)
}

/** Express 4 does not catch rejected promises — route them to the error handler. */
const route =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next)

export function createApi(db: Db, opts: ApiOptions) {
  const app = express()
  app.set('trust proxy', opts.trustProxy)
  app.use(cors())
  app.use(
    rateLimit({
      windowMs: 60_000,
      max: opts.rateLimitPerMinute ?? 120,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'rate_limit_exceeded' }
    })
  )

  async function reputationByAgent(records: ServiceRecord[]): Promise<Map<string, ReputationDetail>> {
    const agentIds = [...new Set(records.map(s => s.agentId).filter((id): id is string => !!id))]
    const rows = await getFeedbackForAgents(db, agentIds)
    const grouped = new Map<string, FeedbackRecord[]>()
    for (const r of rows) grouped.set(r.agentId, [...(grouped.get(r.agentId) ?? []), r])
    const map = new Map<string, ReputationDetail>()
    for (const id of agentIds) map.set(id, scoreReputation(grouped.get(id) ?? [], opts))
    return map
  }

  function toDto(s: ServiceRecord, detail: ReputationDetail | null, mode: RankMode): ServiceDto {
    const pick = detail?.[mode]
    return {
      id: `${s.developer}:${s.name}`,
      key: s.key,
      name: s.name,
      description: s.description,
      tags: tagsToArray(s.tags),
      endpoint: s.endpoint,
      pricePerRequest: s.pricePerRequest,
      paymentToken: s.paymentToken,
      walletAddress: s.payTo,
      developer: s.developer,
      network: opts.network,
      agentId: s.agentId ?? undefined,
      reputation: pick ? { count: pick.count, score: pick.score } : null,
      reputationDetail: detail
    }
  }

  function feedbackDto(r: FeedbackRecord, byAgent: Map<string, ServiceRecord>): FeedbackDto {
    const svc = byAgent.get(r.agentId)
    const status = r.paidStatus === 'paid' || r.paidStatus === 'unpaid' ? r.paidStatus : 'pending'
    return {
      agentId: r.agentId,
      service: svc ? { id: `${svc.developer}:${svc.name}`, name: svc.name } : null,
      rater: r.client,
      value: normalizeValue(r.value, r.valueDecimals),
      rawValue: String(r.value),
      valueDecimals: r.valueDecimals,
      status,
      paid: r.paidVerified,
      unpaidReason: r.paidReason,
      revoked: r.revoked,
      paidAmount: r.paidVerified ? usdc(r.paidAmount) : null,
      payer: r.payer,
      feedbackTxHash: r.txHash,
      receiptTxHash: r.paidVerified ? r.feedbackHash : null,
      citedHash: r.feedbackHash,
      feedbackUri: r.feedbackUri,
      tags: [r.tag1, r.tag2].filter((t): t is string => !!t),
      endpoint: r.endpoint,
      block: String(r.block),
      blockTime: r.blockTime ? new Date(r.blockTime).toISOString() : null
    }
  }

  /** Parses `paid` / `limit` / `offset`; null = bad `paid` value. */
  function feedbackQuery(req: Request): { paid?: boolean; limit: number; offset: number } | null {
    const MAX_PAGE = 100
    const p = req.query.paid as string | undefined
    if (p !== undefined && p !== 'true' && p !== 'false') return null
    const offset = Math.max(0, parseInt((req.query.offset as string) ?? '0', 10) || 0)
    const limit = Math.min(MAX_PAGE, Math.max(1, parseInt((req.query.limit as string) ?? '50', 10) || 50))
    return { paid: p === undefined ? undefined : p === 'true', limit, offset }
  }

  async function feedbackPage(res: Response, q: { paid?: boolean; limit: number; offset: number }, agentIds?: string[]) {
    const records = await listActiveServices(db)
    const byAgent = new Map<string, ServiceRecord>()
    for (const s of records) if (s.agentId && !byAgent.has(s.agentId)) byAgent.set(s.agentId, s)
    const { total, rows } = await listFeedback(db, { ...q, agentIds })
    res.json({
      total,
      offset: q.offset,
      limit: q.limit,
      paid: q.paid ?? null,
      network: opts.network,
      items: rows.map(r => feedbackDto(r, byAgent))
    })
  }

  async function findService(id: string): Promise<ServiceRecord | undefined> {
    const records = await listActiveServices(db)
    const lower = id.toLowerCase()
    return records.find(s => s.key.toLowerCase() === lower || `${s.developer}:${s.name}`.toLowerCase() === lower)
  }

  app.get(
    '/health',
    route(async (_req, res) => {
      const cursor = await getCursor(db).catch(() => null)
      res.json({
        status: 'ok',
        service: 'chainpe-indexer',
        network: opts.network,
        lastIndexedBlock: cursor != null ? cursor.toString() : null,
        chainHead: getIndexerHead().toString()
      })
    })
  )

  app.get(
    '/stats',
    route(async (_req, res) => {
      const c = await counts(db)
      res.json({ ...c, network: opts.network })
    })
  )

  app.get(
    '/services',
    route(async (req, res) => {
      const MAX_PAGE = 100
      const rank = (req.query.rank as string | undefined) ?? 'paid'
      if (rank !== 'paid' && rank !== 'raw') return res.status(400).json({ error: 'rank must be "paid" or "raw"' })

      const records = await listActiveServices(db)
      const repMap = await reputationByAgent(records)
      let items = records.map(s => toDto(s, s.agentId ? (repMap.get(s.agentId) ?? null) : null, rank))

      const query = (req.query.query as string | undefined)?.toLowerCase()
      if (query) {
        items = items.filter(
          s =>
            s.name.toLowerCase().includes(query) ||
            s.description.toLowerCase().includes(query) ||
            s.tags.some(t => t.toLowerCase().includes(query))
        )
      }
      const tag = req.query.tag as string | undefined
      if (tag) items = items.filter(s => s.tags.some(t => t.toLowerCase() === tag.toLowerCase()))
      const maxPrice = req.query.maxPrice as string | undefined
      if (maxPrice) {
        const max = parseFloat(maxPrice)
        items = items.filter(s => parseFloat(s.pricePerRequest) <= max)
      }

      const ranked = rankServices(items, rank)
      const offset = Math.max(0, parseInt((req.query.offset as string) ?? '0', 10) || 0)
      const limit = Math.min(
        MAX_PAGE,
        Math.max(1, parseInt((req.query.limit as string) ?? String(MAX_PAGE), 10) || MAX_PAGE)
      )
      res.json({ total: ranked.length, offset, limit, rank, items: ranked.slice(offset, offset + limit) })
    })
  )

  app.get(
    '/services/:id',
    route(async (req, res) => {
      const match = await findService(String(req.params.id))
      if (!match) return res.status(404).json({ error: 'service not found' })
      const repMap = await reputationByAgent([match])
      res.json(toDto(match, match.agentId ? (repMap.get(match.agentId) ?? null) : null, 'paid'))
    })
  )

  app.get(
    '/services/:id/reputation',
    route(async (req, res) => {
      const match = await findService(String(req.params.id))
      if (!match) return res.status(404).json({ error: 'service not found' })
      const empty = scoreReputation([], opts)
      if (!match.agentId) return res.json({ agentId: null, ...empty })
      const rows = await getFeedbackForAgents(db, [match.agentId])
      res.json({ agentId: match.agentId, ...scoreReputation(rows, opts) })
    })
  )

  app.get(
    '/feedback',
    route(async (req, res) => {
      const q = feedbackQuery(req)
      if (!q) return res.status(400).json({ error: 'paid must be "true" or "false"' })
      const agentId = req.query.agentId as string | undefined
      if (agentId !== undefined && !/^\d+$/.test(agentId)) return res.status(400).json({ error: 'agentId must be a number' })
      await feedbackPage(res, q, agentId !== undefined ? [agentId] : undefined)
    })
  )

  app.get(
    '/services/:id/feedback',
    route(async (req, res) => {
      const q = feedbackQuery(req)
      if (!q) return res.status(400).json({ error: 'paid must be "true" or "false"' })
      const match = await findService(String(req.params.id))
      if (!match) return res.status(404).json({ error: 'service not found' })
      await feedbackPage(res, q, match.agentId ? [match.agentId] : [])
    })
  )

  app.use((_req: Request, res: Response) => res.status(404).json({ error: 'not found' }))
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('api error:', err)
    res.status(500).json({ error: 'internal_error' })
  })

  return app
}
