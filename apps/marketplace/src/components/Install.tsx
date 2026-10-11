'use client'

import { useState } from 'react'

type Tab = 'clone' | 'consumer' | 'provider'

const COMMANDS: Record<Tab, string> = {
  clone: 'git clone https://github.com/SamyaDeb/chainpe-monad && cd chainpe-monad && npm ci && npm run build',
  consumer: "const cp = new ChainPe({ privateKey, network: 'monad-testnet' }); await cp.pay(url)",
  provider: 'npx chainpe init && npx chainpe start   # puts any API behind x402 in USDC'
}

/** Tabbed copyable commands for the landing hero (ported from the legacy install box). */
export default function Install() {
  const [tab, setTab] = useState<Tab>('clone')
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(COMMANDS[tab])
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard not available
    }
  }
  return (
    <div className="hero-install">
      <div className="install-tabs">
        {(Object.keys(COMMANDS) as Tab[]).map(t => (
          <button key={t} className={`install-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="install-code">
        <code>{COMMANDS[tab]}</code>
        <button className="copy-btn" onClick={copy} aria-label="Copy to clipboard">
          {copied ? '✓' : 'copy'}
        </button>
      </div>
    </div>
  )
}
