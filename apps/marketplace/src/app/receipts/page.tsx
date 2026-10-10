import Link from 'next/link'
import FeedbackTable from '@/components/FeedbackTable'
import SourceBadge from '@/components/SourceBadge'
import { getFeed, type FeedFilter } from '@/lib/data'

export const dynamic = 'force-dynamic'

const FILTERS: { key: FeedFilter; label: string }[] = [
  { key: 'paid', label: 'Paid calls' },
  { key: 'excluded', label: 'Excluded' },
  { key: 'all', label: 'All ratings' }
]

export default async function Receipts({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const show = (await searchParams).show
  const filter: FeedFilter = show === 'all' || show === 'excluded' ? show : 'paid'
  const { source, items, total, stats } = await getFeed(filter, 100)

  return (
    <>
      <h1>Receipts feed</h1>
      <p className="lead">
        The latest ERC-8004 ratings on Monad testnet for agents registered with ChainPe. A paid call is an x402 settlement
        (USDC from the rater to the service) followed by a rating that cites it. Each settlement and rating links to
        MonadVision.
      </p>
      <SourceBadge source={source} />
      <div className="filters" style={{ marginTop: 12 }}>
        <div className="toggle" role="tablist" aria-label="Filter">
          {FILTERS.map(f => (
            <Link
              key={f.key}
              href={`/receipts?show=${f.key}`}
              className={filter === f.key ? 'on' : undefined}
              aria-selected={filter === f.key}
              role="tab"
            >
              {f.label}
            </Link>
          ))}
        </div>
        <span className="muted small">
          {stats.paid} paid · {stats.ratings - stats.paid} excluded · {stats.ratings} total
        </span>
      </div>
      <FeedbackTable items={items} network={source.network} showService />
      {total > items.length && (
        <p className="small muted" style={{ marginTop: 8 }}>
          Showing the latest {items.length} of {total}.
        </p>
      )}
    </>
  )
}
