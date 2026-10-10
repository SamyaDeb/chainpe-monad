import type { Source } from '@/lib/types'
import { snapshotDate } from '@/lib/format'

/** Says where the numbers on the page come from: the live indexer, or the dated snapshot. */
export default function SourceBadge({ source }: { source: Source }) {
  if (source.kind === 'live') {
    return (
      <div className="source" title={source.indexerUrl}>
        <span className="dot" />
        Live from the ChainPe indexer · {source.network}
        {source.lastIndexedBlock && <> · block {Number(source.lastIndexedBlock).toLocaleString('en-US')}</>}
      </div>
    )
  }
  return (
    <div className="source snapshot" title={source.reason}>
      <span className="dot" />
      Snapshot of {snapshotDate(source.at)} · {source.network} · live data unavailable: {source.reason}
    </div>
  )
}
