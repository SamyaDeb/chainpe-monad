/**
 * The marketplace's data layer: live indexer when it answers, the committed
 * snapshot (labelled with its date and the reason) when it is unset or down.
 */
import { describe, expect, it } from 'vitest'
import { getFeed, getHome, getService } from '../src/lib/data'
import snapshotJson from '../data/snapshot-monad-testnet.json'
import type { Snapshot } from '../src/lib/types'

const snapshot = snapshotJson as unknown as Snapshot
const URL_ = 'http://indexer.test'

/** A stub indexer: path → JSON body (or a status code). Records the paths asked for. */
function stub(routes: Record<string, unknown>) {
  const calls: string[] = []
  const fetchImpl = (async (input: string) => {
    const path = input.slice(URL_.length)
    calls.push(path)
    const body = routes[path]
    if (body === undefined) return new Response('{"error":"not found"}', { status: 404 })
    if (typeof body === 'number') return new Response('{}', { status: body })
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

const svc = snapshot.services.paid[0]
const health = { status: 'ok', network: 'monad-testnet', lastIndexedBlock: '123', chainHead: '123' }
const counts = {
  '/stats': { services: 1, feedback: 10, paidFeedback: 2 },
  '/feedback?registered=true&limit=1': { total: 3, items: [] },
  '/feedback?registered=true&paid=true&limit=1': { total: 2, items: [] }
}

describe('snapshot', () => {
  it('is real indexer output for Monad testnet, labelled as demo traffic', () => {
    expect(snapshot.network).toBe('monad-testnet')
    expect(snapshot.label).toMatch(/demo traffic from team wallets/)
    expect(new Date(snapshot.at).getTime()).not.toBeNaN()
    expect(snapshot.services.paid.length).toBe(snapshot.stats.services)
    expect(snapshot.feedback.length).toBe(snapshot.stats.ratings)
    expect(snapshot.feedback.filter(f => f.paid).length).toBe(snapshot.stats.paid)
    // Only ChainPe-registered agents, each paid rating with its settlement.
    expect(snapshot.feedback.every(f => f.service !== null)).toBe(true)
    expect(snapshot.feedback.filter(f => f.paid).every(f => /^0x[0-9a-f]{64}$/.test(f.receiptTxHash ?? ''))).toBe(true)
    expect(snapshot.feedback.filter(f => !f.paid).every(f => !!f.unpaidReason)).toBe(true)
  })
})

describe('fallback', () => {
  it('uses the snapshot when no indexer URL is set, and says why', async () => {
    const { fetchImpl, calls } = stub({})
    const home = await getHome('paid', { indexerUrl: '', fetchImpl })
    expect(calls).toEqual([])
    expect(home.source).toEqual({
      kind: 'snapshot',
      network: 'monad-testnet',
      at: snapshot.at,
      reason: 'NEXT_PUBLIC_CHAINPE_INDEXER_URL is not set'
    })
    expect(home.services).toEqual(snapshot.services.paid)
    expect(home.stats).toEqual(snapshot.stats)
  })

  it('uses the snapshot when the indexer is unreachable or errors', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const a = await getHome('raw', { indexerUrl: URL_, fetchImpl: down })
    expect(a.source).toMatchObject({ kind: 'snapshot', reason: 'indexer unreachable (fetch failed)' })
    expect(a.services).toEqual(snapshot.services.raw)

    const { fetchImpl } = stub({
      '/health': health,
      ...counts,
      '/stats': 500,
      '/feedback?registered=true&limit=100': { total: 0, items: [] }
    })
    const b = await getFeed('all', 100, { indexerUrl: URL_, fetchImpl })
    expect(b.source).toMatchObject({ kind: 'snapshot', reason: 'indexer answered HTTP 500' })
    expect(b.items).toEqual(snapshot.feedback.slice(0, 100))
  })

  it('serves a service and its ratings from the snapshot', async () => {
    const r = await getService(svc.id, { indexerUrl: '' })
    expect(r.service?.key).toBe(svc.key)
    expect(r.feedback.every(f => f.agentId === svc.agentId)).toBe(true)
    expect(r.feedbackTotal).toBe(snapshot.feedback.filter(f => f.agentId === svc.agentId).length)
    expect((await getService(svc.key.toUpperCase().replace('0X', '0x'), { indexerUrl: '' })).service?.id).toBe(svc.id)
    expect((await getService('nobody:nothing', { indexerUrl: '' })).service).toBeNull()
  })

  it('filters the snapshot feed into paid and excluded', async () => {
    const paid = await getFeed('paid', 100, { indexerUrl: '' })
    const excluded = await getFeed('excluded', 100, { indexerUrl: '' })
    expect(paid.items.every(f => f.paid)).toBe(true)
    expect(excluded.items.every(f => !f.paid)).toBe(true)
    expect(paid.total + excluded.total).toBe(snapshot.feedback.length)
  })
})

describe('live', () => {
  it('reads the ranked services and ChainPe-only totals from the indexer', async () => {
    const { fetchImpl, calls } = stub({ '/health': health, ...counts, '/services?rank=raw&limit=100': { items: [svc] } })
    const home = await getHome('raw', { indexerUrl: `${URL_}/`, fetchImpl })
    expect(home.source).toEqual({ kind: 'live', network: 'monad-testnet', indexerUrl: URL_, lastIndexedBlock: '123' })
    expect(home.services).toEqual([svc])
    expect(home.stats).toEqual({ services: 1, ratings: 3, paid: 2, otherAgents: 7 })
    expect(calls).toContain('/services?rank=raw&limit=100')
  })

  it('reads a service (URL-encoded id) and its ratings; a 404 is "not found", not a fallback', async () => {
    const enc = encodeURIComponent(svc.id)
    const items = snapshot.feedback.filter(f => f.agentId === svc.agentId)
    const { fetchImpl } = stub({
      '/health': health,
      [`/services/${enc}`]: svc,
      [`/services/${enc}/feedback?limit=100`]: { total: items.length, items }
    })
    const r = await getService(svc.id, { indexerUrl: URL_, fetchImpl })
    expect(r.source.kind).toBe('live')
    expect(r.service).toEqual(svc)
    expect(r.feedback).toEqual(items)
    const missing = await getService('nobody:nothing', { indexerUrl: URL_, fetchImpl })
    expect(missing.source.kind).toBe('live')
    expect(missing.service).toBeNull()
  })

  it('asks the indexer for ChainPe agents only, filtered by paid', async () => {
    const { fetchImpl, calls } = stub({
      '/health': health,
      ...counts,
      '/feedback?registered=true&limit=20&paid=false': { total: 0, items: [] }
    })
    const r = await getFeed('excluded', 20, { indexerUrl: URL_, fetchImpl })
    expect(r.source.kind).toBe('live')
    expect(calls).toContain('/feedback?registered=true&limit=20&paid=false')
  })
})
