import Link from 'next/link'
import SourceBadge from '@/components/SourceBadge'
import { getHome } from '@/lib/data'
import { score, usdc } from '@/lib/format'
import type { RankMode, Service } from '@/lib/types'

export const dynamic = 'force-dynamic'

/** Paid minus raw, when both exist and differ. */
function gap(s: Service): number | null {
  const d = s.reputationDetail
  if (d?.paid.score == null || d.raw.score == null) return null
  const g = Math.round((d.raw.score - d.paid.score) * 100) / 100
  return g === 0 ? null : g
}

export default async function Home({ searchParams }: { searchParams: Promise<{ rank?: string; all?: string }> }) {
  const q = await searchParams
  const rank: RankMode = q.rank === 'raw' ? 'raw' : 'paid'
  const showAll = q.all === '1'
  const { source, stats, services, hidden } = await getHome(rank, undefined, showAll)
  const keep = showAll ? '&all=1' : ''

  // The service whose raw score is furthest from its paid score: the clearest example of what "paid" removes.
  const example = services
    .filter(s => gap(s) != null)
    .sort((a, b) => Math.abs(gap(b)!) - Math.abs(gap(a)!))[0]

  return (
    <>
      <h1>x402 services, ranked by ratings someone paid for.</h1>
      <p className="lead">
        ChainPe is the trust layer for x402 on Monad. A rating on the ERC-8004 Reputation Registry counts only when the
        rater cites an x402 settlement in which they paid that service in USDC, checked on-chain by the ChainPe indexer.{' '}
        <strong>No receipt, no rating.</strong>
      </p>
      <SourceBadge source={source} />

      <div className="stats">
        <div className="stat">
          <div className="n">{stats.services}</div>
          <div className="l">registered services</div>
        </div>
        <div className="stat">
          <div className="n">{stats.ratings}</div>
          <div className="l">ERC-8004 ratings on these agents</div>
        </div>
        <div className="stat">
          <div className="n">{stats.paid}</div>
          <div className="l">backed by a payment receipt</div>
        </div>
        <div className="stat">
          <div className="n">{stats.ratings - stats.paid}</div>
          <div className="l">excluded from paid scores</div>
        </div>
      </div>

      {example && (
        <div className="callout">
          <p>
            <strong>
              {example.name} (agent #{example.agentId})
            </strong>
            : paid score <strong>{score(example.reputationDetail!.paid.score)}</strong> vs raw{' '}
            <strong>{score(example.reputationDetail!.raw.score)}</strong>. The raw average includes ratings with no valid
            payment receipt. <Link href={`/services/${encodeURIComponent(example.id)}`}>See which ones and why →</Link>
          </p>
        </div>
      )}

      <div className="filters">
        <div className="toggle" role="tablist" aria-label="Ranking">
          <Link href={`/services?rank=paid${keep}`} className={rank === 'paid' ? 'on' : undefined} aria-selected={rank === 'paid'} role="tab">
            Paid reputation
          </Link>
          <Link href={`/services?rank=raw${keep}`} className={rank === 'raw' ? 'on' : undefined} aria-selected={rank === 'raw'} role="tab">
            Raw (every rating)
          </Link>
        </div>
        <span className="muted small">
          {rank === 'paid'
            ? 'Receipt-backed ratings only, weighted by USDC paid (capped per receipt and per payer).'
            : 'Unweighted mean of every live rating: what the registry shows without ChainPe.'}
        </span>
      </div>

      <div className="table-wrap">
        <table className="stack-sm">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Service</th>
              <th className="num">{rank === 'paid' ? 'Paid score' : 'Raw score'}</th>
              <th className="num">{rank === 'paid' ? 'Raw score' : 'Paid score'}</th>
              <th className="num">Distinct payers</th>
              <th className="num">Paid volume</th>
              <th className="num hide-sm">Raters</th>
              <th className="num hide-sm">Price / call</th>
            </tr>
          </thead>
          <tbody>
            {services.map((s, i) => {
              const d = s.reputationDetail
              const main = rank === 'paid' ? d?.paid.score : d?.raw.score
              const other = rank === 'paid' ? d?.raw.score : d?.paid.score
              const g = gap(s)
              return (
                <tr key={s.key}>
                  <td className="num" data-label="Rank">{i + 1}</td>
                  <td className="svc-cell" data-label="">
                    <Link href={`/services/${encodeURIComponent(s.id)}`} className="svc-name">
                      {s.name}
                    </Link>
                    <div className="muted small">
                      {s.agentId ? `ERC-8004 agent #${s.agentId}` : 'no ERC-8004 agent linked'}
                    </div>
                    {g != null && (
                      <div className="gap">
                        raw is {g > 0 ? '+' : ''}
                        {g} vs paid: unpaid ratings counted
                      </div>
                    )}
                  </td>
                  <td className="num score-main" data-label={rank === 'paid' ? 'Paid score' : 'Raw score'}>{score(main)}</td>
                  <td className="num" data-label={rank === 'paid' ? 'Raw score' : 'Paid score'}>{score(other)}</td>
                  <td className="num" data-label="Distinct payers">{d?.paid.count ?? 0}</td>
                  <td className="num" data-label="Paid volume">{usdc(d?.paid.volume ?? '0')}</td>
                  <td className="num hide-sm" data-label="Raters">{d?.raw.count ?? 0}</td>
                  <td className="num hide-sm" data-label="Price / call">{usdc(s.pricePerRequest)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>
        Scores are 0–100. Payers and raters are distinct wallets. Paid volume is the testnet USDC the raters paid in the
        settlements their ratings cite. The canonical ERC-8004 Reputation Registry is shared by every agent; the{' '}
        {stats.otherAgents} ratings it holds for agents not registered with ChainPe are not counted here.
      </p>
      {(hidden > 0 || showAll) && (
        <p className="small muted" style={{ marginTop: 10 }}>
          {showAll ? (
            <>
              Showing every registered service, including older demo entries whose endpoints only ran inside our build
              session (<code>localhost</code>), which you cannot call.{' '}
              <Link href={`/services?rank=${rank}`}>Show only callable services</Link>
            </>
          ) : (
            <>
              {hidden} older demo {hidden === 1 ? 'entry is' : 'entries are'} hidden: their endpoints only ran inside our
              build session (<code>localhost</code>), so nobody else can call them. Their ratings still count in the
              totals above. <Link href={`/services?rank=${rank}&all=1`}>Show them</Link>
            </>
          )}
        </p>
      )}
    </>
  )
}
