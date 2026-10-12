import Link from 'next/link'
import type { FeedbackItem } from '@/lib/types'
import { addressUrl, reasonText, short, txUrl, usdc, when } from '@/lib/format'

function Status({ f }: { f: FeedbackItem }) {
  return (
    <>
      {f.status === 'paid' && <span className="badge paid">paid</span>}
      {f.status === 'unpaid' && <span className="badge unpaid">excluded</span>}
      {f.status === 'pending' && <span className="badge pending">pending</span>}
      {f.revoked && (
        <>
          {' '}
          <span className="badge revoked">revoked</span>
        </>
      )}
    </>
  )
}

/** Ratings, each marked paid (with its settlement on MonadVision) or excluded (with the reason). */
export default function FeedbackTable({
  items,
  network,
  showService = false
}: {
  items: FeedbackItem[]
  network: string
  showService?: boolean
}) {
  if (items.length === 0) return <p className="muted">No ratings indexed yet.</p>
  return (
    <div className="table-wrap">
      <table className="stack-sm">
        <thead>
          <tr>
            <th>Time (block)</th>
            {showService && <th>Service</th>}
            <th>Rater</th>
            <th className="num">Rating</th>
            <th>Counts?</th>
            <th>Payment receipt / reason</th>
            <th className="hide-sm">Rating tx</th>
          </tr>
        </thead>
        <tbody>
          {items.map(f => (
            <tr key={`${f.agentId}:${f.rater}:${f.feedbackTxHash ?? f.block}:${f.value}`}>
              <td data-label="Time">
                {when(f.blockTime)}
                <div className="muted small">#{Number(f.block).toLocaleString('en-US')}</div>
              </td>
              {showService && (
                <td data-label="Service">
                  {f.service ? (
                    <Link href={`/services/${encodeURIComponent(f.service.id)}`}>{f.service.name}</Link>
                  ) : (
                    <span className="muted">—</span>
                  )}
                  <div className="muted small">agent #{f.agentId}</div>
                </td>
              )}
              <td data-label="Rater">
                <a href={addressUrl(network, f.rater)} target="_blank" rel="noreferrer">
                  {short(f.rater)}
                </a>
              </td>
              <td className="num" data-label="Rating">{f.value}</td>
              <td data-label="Counts?">
                <Status f={f} />
              </td>
              <td data-label="Receipt / reason">
                {f.paid && f.receiptTxHash ? (
                  <>
                    {usdc(f.paidAmount)} settled{' '}
                    <a href={txUrl(network, f.receiptTxHash)} target="_blank" rel="noreferrer">
                      {short(f.receiptTxHash, 10, 6)}
                    </a>
                  </>
                ) : (
                  <>
                    <span className="gap">{reasonText(f.unpaidReason)}</span>
                    {f.citedHash && /^0x[0-9a-fA-F]{64}$/.test(f.citedHash) && (
                      <div className="muted small">
                        cites{' '}
                        <a href={txUrl(network, f.citedHash)} target="_blank" rel="noreferrer">
                          {short(f.citedHash, 10, 6)}
                        </a>
                      </div>
                    )}
                  </>
                )}
              </td>
              <td className="hide-sm" data-label="Rating tx">
                {f.feedbackTxHash ? (
                  <a href={txUrl(network, f.feedbackTxHash)} target="_blank" rel="noreferrer">
                    {short(f.feedbackTxHash, 10, 6)}
                  </a>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
