/**
 * Data for the pages: the live indexer API (`NEXT_PUBLIC_CHAINPE_INDEXER_URL`),
 * or — when it is unset or does not answer — the committed snapshot, labelled
 * with its date. Nothing here makes data up: every number comes from one of the two.
 */
import snapshotJson from '../../data/snapshot-monad-testnet.json'
import type { FeedbackItem, RankMode, Service, Snapshot, Source, Stats } from './types'

export interface DataDeps {
  indexerUrl?: string
  fetchImpl?: typeof fetch
  snapshot?: Snapshot
  timeoutMs?: number
}

const defaultSnapshot = snapshotJson as unknown as Snapshot

function resolve(deps: DataDeps = {}) {
  const raw = deps.indexerUrl ?? process.env.NEXT_PUBLIC_CHAINPE_INDEXER_URL ?? ''
  return {
    indexerUrl: raw.trim().replace(/\/+$/, ''),
    fetchImpl: deps.fetchImpl ?? fetch,
    snapshot: deps.snapshot ?? defaultSnapshot,
    timeoutMs: deps.timeoutMs ?? 5_000
  }
}

class IndexerError extends Error {}

type Ctx = ReturnType<typeof resolve>

/** GET a JSON path; `allow404` returns null instead of throwing on 404. */
async function get<T>(ctx: Ctx, path: string, allow404 = false): Promise<T | null> {
  let res: Response
  try {
    res = await ctx.fetchImpl(`${ctx.indexerUrl}${path}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(ctx.timeoutMs)
    } as RequestInit)
  } catch (err) {
    throw new IndexerError(`indexer unreachable (${(err as Error).message})`)
  }
  if (allow404 && res.status === 404) return null
  if (!res.ok) throw new IndexerError(`indexer answered HTTP ${res.status}`)
  return (await res.json()) as T
}

/** Runs `live` against the indexer; on any failure (or no URL) runs `fallback` on the snapshot. */
async function withSource<T>(
  deps: DataDeps | undefined,
  live: (ctx: Ctx) => Promise<T>,
  fallback: (snap: Snapshot) => T
): Promise<T & { source: Source }> {
  const ctx = resolve(deps)
  const snapshotSource = (reason: string): Source => ({
    kind: 'snapshot',
    network: ctx.snapshot.network,
    at: ctx.snapshot.at,
    reason
  })
  if (!ctx.indexerUrl) return { ...fallback(ctx.snapshot), source: snapshotSource('NEXT_PUBLIC_CHAINPE_INDEXER_URL is not set') }
  try {
    const health = await get<{ network: string; lastIndexedBlock: string | null }>(ctx, '/health')
    const value = await live(ctx)
    return {
      ...value,
      source: {
        kind: 'live',
        network: health?.network ?? ctx.snapshot.network,
        indexerUrl: ctx.indexerUrl,
        lastIndexedBlock: health?.lastIndexedBlock ?? null
      }
    }
  } catch (err) {
    if (!(err instanceof IndexerError)) throw err
    return { ...fallback(ctx.snapshot), source: snapshotSource(err.message) }
  }
}

interface FeedPage {
  total: number
  items: FeedbackItem[]
}

/** Totals from `/stats` + two counts of the ChainPe-agent feed. */
async function liveStats(ctx: Ctx): Promise<Stats> {
  const [all, reg, paid] = await Promise.all([
    get<{ services: number; feedback: number }>(ctx, '/stats'),
    get<FeedPage>(ctx, '/feedback?registered=true&limit=1'),
    get<FeedPage>(ctx, '/feedback?registered=true&paid=true&limit=1')
  ])
  return { services: all!.services, ratings: reg!.total, paid: paid!.total, otherAgents: all!.feedback - reg!.total }
}

// ─── Pages ───────────────────────────────────────────────────────────────────

export interface HomeData {
  stats: Stats
  rank: RankMode
  services: Service[]
  /** Registered services left out of `services` because nobody outside the build session can call them. */
  hidden: number
}

/**
 * True when a judge or agent could actually call the endpoint: https on a public host.
 * Old demo entries registered `http://localhost:<port>` and only ever ran inside a build session.
 */
export function isCallable(endpoint: string | null | undefined): boolean {
  if (!endpoint) return false
  let u: URL
  try {
    u = new URL(endpoint)
  } catch {
    return false
  }
  if (u.protocol !== 'https:') return false
  const h = u.hostname.toLowerCase()
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.example')) return false
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false
  return h.includes('.') || h.includes(':')
}

const split = (services: Service[], showAll: boolean) => {
  const kept = showAll ? services : services.filter(s => isCallable(s.endpoint))
  return { services: kept, hidden: services.length - kept.length }
}

/** Services ranked by paid (default) or raw reputation, plus totals. */
export function getHome(rank: RankMode, deps?: DataDeps, showAll = false) {
  return withSource<HomeData>(
    deps,
    async ctx => {
      const [stats, list] = await Promise.all([
        liveStats(ctx),
        get<{ items: Service[] }>(ctx, `/services?rank=${rank}&limit=100`)
      ])
      return { stats: stats!, rank, ...split(list!.items, showAll) }
    },
    snap => ({ stats: snap.stats, rank, ...split(snap.services[rank], showAll) })
  )
}

export interface ServiceData {
  service: Service | null
  feedback: FeedbackItem[]
  feedbackTotal: number
}

const sameId = (s: Service, id: string) => {
  const l = id.toLowerCase()
  return s.id.toLowerCase() === l || s.key.toLowerCase() === l
}

/** One service (by `developer:name` or key) and its ratings, newest first. */
export function getService(id: string, deps?: DataDeps) {
  return withSource<ServiceData>(
    deps,
    async ctx => {
      const enc = encodeURIComponent(id)
      const service = await get<Service>(ctx, `/services/${enc}`, true)
      if (!service) return { service: null, feedback: [], feedbackTotal: 0 }
      const fb = await get<FeedPage>(ctx, `/services/${enc}/feedback?limit=100`)
      return { service, feedback: fb!.items, feedbackTotal: fb!.total }
    },
    snap => {
      const service = snap.services.paid.find(s => sameId(s, id)) ?? null
      const feedback = service?.agentId ? snap.feedback.filter(f => f.agentId === service.agentId) : []
      return { service, feedback, feedbackTotal: feedback.length }
    }
  )
}

export type FeedFilter = 'all' | 'paid' | 'excluded'

export interface FeedData {
  stats: Stats
  filter: FeedFilter
  items: FeedbackItem[]
  total: number
}

/** The ratings feed for ChainPe-registered agents, newest first: all, receipt-backed only, or excluded only. */
export function getFeed(filter: FeedFilter, limit = 100, deps?: DataDeps) {
  const paidParam = filter === 'paid' ? '&paid=true' : filter === 'excluded' ? '&paid=false' : ''
  return withSource<FeedData>(
    deps,
    async ctx => {
      const [stats, fb] = await Promise.all([
        liveStats(ctx),
        get<FeedPage>(ctx, `/feedback?registered=true&limit=${limit}${paidParam}`)
      ])
      return { stats: stats!, filter, items: fb!.items, total: fb!.total }
    },
    snap => {
      const all = snap.feedback.filter(f => (filter === 'paid' ? f.paid : filter === 'excluded' ? !f.paid : true))
      return { stats: snap.stats, filter, items: all.slice(0, limit), total: all.length }
    }
  )
}
