import Link from 'next/link'
import FeedbackTable from '@/components/FeedbackTable'
import SourceBadge from '@/components/SourceBadge'
import { getService } from '@/lib/data'
import { addressUrl, contracts, score, usdc } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function ServicePage({ params }: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id)
  const { source, service, feedback, feedbackTotal } = await getService(id)

  if (!service) {
    return (
      <>
        <h1>Service not found</h1>
        <SourceBadge source={source} />
        <p>
          No active service <code>{id}</code> in the ChainPe registry. <Link href="/services">Back to all services</Link>
        </p>
      </>
    )
  }

  const d = service.reputationDetail
  const paid = feedback.filter(f => f.paid && !f.revoked)
  const excluded = feedback.filter(f => !f.paid)
  const c = contracts(source.network)

  return (
    <>
      <p className="small">
        <Link href="/services">← all services</Link>
      </p>
      <h1>{service.name}</h1>
      <p className="lead">{service.description || <span className="muted">No description registered.</span>}</p>
      {service.tags.length > 0 && (
        <div className="tags">
          {service.tags.map(t => (
            <span key={t} className="tag">
              {t}
            </span>
          ))}
        </div>
      )}
      <SourceBadge source={source} />

      <div className="cards">
        <div className="card paid">
          <div className="muted small">Paid reputation (what ChainPe ranks by)</div>
          <div className="big">{score(d?.paid.score)}</div>
          <div className="small">
            {d?.paid.count ?? 0} distinct payer{d?.paid.count === 1 ? '' : 's'} · {usdc(d?.paid.volume ?? '0')} paid
          </div>
        </div>
        <div className="card">
          <div className="muted small">Raw reputation (every rating, unweighted)</div>
          <div className="big">{score(d?.raw.score)}</div>
          <div className="small">
            {d?.raw.count ?? 0} distinct rater{d?.raw.count === 1 ? '' : 's'}
          </div>
        </div>
      </div>
      {excluded.length > 0 && (
        <div className="callout">
          <p>
            {excluded.length} of {feedbackTotal} rating{feedbackTotal === 1 ? '' : 's'} for this agent{' '}
            {excluded.length === 1 ? 'is' : 'are'} excluded from the paid score: no valid x402 payment receipt backs{' '}
            {excluded.length === 1 ? 'it' : 'them'}. The reason is next to each one below.
          </p>
        </div>
      )}

      <h2>Service</h2>
      <dl className="facts">
        <dt>Price</dt>
        <dd>
          {usdc(service.pricePerRequest)} per call (x402 v2, <code>exact</code>)
        </dd>
        <dt>Endpoint</dt>
        <dd>
          <code>{service.endpoint}</code>
        </dd>
        <dt>ERC-8004 agent</dt>
        <dd>
          {service.agentId ? (
            <>
              #{service.agentId} on the canonical Identity Registry{' '}
              <a href={addressUrl(source.network, c.identity)} target="_blank" rel="noreferrer">
                {c.identity}
              </a>
            </>
          ) : (
            'none linked'
          )}
        </dd>
        <dt>Pays to</dt>
        <dd>
          <a href={addressUrl(source.network, service.walletAddress)} target="_blank" rel="noreferrer">
            {service.walletAddress}
          </a>
        </dd>
        <dt>Developer</dt>
        <dd>{service.developer}</dd>
        <dt>Registry key</dt>
        <dd>{service.key}</dd>
        <dt>Network</dt>
        <dd>{service.network}</dd>
      </dl>
      {/^https?:\/\/(localhost|127\.)/.test(service.endpoint) && (
        <p className="small muted">
          This demo seller ran inside our build session, so its endpoint is not reachable from the internet. To make a
          paid call yourself, run a provider: see <Link href="/try">Try it</Link>.
        </p>
      )}

      <h2>
        Ratings ({feedbackTotal}){' '}
        <span className="muted small">
          {paid.length} paid · {excluded.length} excluded · newest first
        </span>
      </h2>
      <FeedbackTable items={feedback} network={source.network} />
      {feedbackTotal > feedback.length && (
        <p className="small muted" style={{ marginTop: 8 }}>
          Showing the latest {feedback.length} of {feedbackTotal}.
        </p>
      )}
    </>
  )
}
