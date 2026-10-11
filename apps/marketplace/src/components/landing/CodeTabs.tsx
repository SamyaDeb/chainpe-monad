'use client'

import { useState } from 'react'

const SELLER = 'https://seller-production-ea9b.up.railway.app/stats'
const TABS = {
  Install: `git clone https://github.com/SamyaDeb/chainpe-monad
cd chainpe-monad
npm ci && npm run build

# Monad packages: @chainpemonad/*`,
  Pay: `import { ChainPe } from '@chainpemonad/sdk'

const cp = new ChainPe({ privateKey, network: 'monad-testnet' })
const res = await cp.pay('${SELLER}')
console.log(res.payment.txHash)`,
  Discover: `const services = await cp.discover({})
// ranked by payment-backed reputation
console.log(services[0].name, services[0].reputation)`
} as const

export default function CodeTabs() {
  const [tab, setTab] = useState<keyof typeof TABS>('Install')
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(TABS[tab])
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // clipboard not available
    }
  }
  return (
    <div className="lp-codebox">
      <div className="lp-codetabs">
        {(Object.keys(TABS) as (keyof typeof TABS)[]).map(t => (
          <button key={t} className={t === tab ? 'on' : undefined} onClick={() => setTab(t)}>{t}</button>
        ))}
        <button className="lp-copy" onClick={copy} aria-label="Copy code">{copied ? 'copied' : 'copy'}</button>
      </div>
      <pre><code>{TABS[tab]}</code></pre>
    </div>
  )
}
