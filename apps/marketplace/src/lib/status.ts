// Live status for the landing page: reads the hosted services' /health on the server (cached 60 s).
const INDEXER = process.env.NEXT_PUBLIC_CHAINPE_INDEXER_URL || 'https://indexer-production-50cd.up.railway.app'
const FACILITATOR = process.env.CHAINPE_FACILITATOR_URL || 'https://facilitator-production-8cc9.up.railway.app'

export type Health = 'live' | 'degraded' | 'down'

async function health(url: string): Promise<Health> {
  try {
    const r = await fetch(`${url}/health`, { next: { revalidate: 60 }, signal: AbortSignal.timeout(4000) })
    if (!r.ok) return 'down'
    const j = (await r.json()) as { status?: string }
    return j.status === 'ok' ? 'live' : 'degraded'
  } catch {
    return 'down'
  }
}

async function serviceCount(): Promise<number | null> {
  try {
    const r = await fetch(`${INDEXER}/services?limit=1`, { next: { revalidate: 120 }, signal: AbortSignal.timeout(4000) })
    if (!r.ok) return null
    const j = (await r.json()) as { total?: number }
    return typeof j.total === 'number' ? j.total : null
  } catch {
    return null
  }
}

export async function getLiveStatus() {
  const [indexer, facilitator, services] = await Promise.all([health(INDEXER), health(FACILITATOR), serviceCount()])
  return { indexer, facilitator, services }
}
