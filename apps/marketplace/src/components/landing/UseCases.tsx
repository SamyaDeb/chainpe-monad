'use client'

import { useEffect, useState } from 'react'

const SLIDES = [
  { q: 'Put any HTTP API behind x402 with one command. Agents pay per call in USDC and it lands in your payTo.', who: 'API seller', sub: 'Provider, chainpe start', cap: 'One-command monetization', i: 'S' },
  { q: 'Give the agent a session key, not a wallet. The PolicyVault enforces per-call and daily caps on every payment.', who: 'Agent developer', sub: 'Mandate mode, PolicyVault', cap: 'On-chain spending caps', i: 'A' },
  { q: 'Rank services by ratings someone paid for. Unpaid ratings stay visible as raw, but never count toward paid.', who: 'Agent marketplace', sub: 'Discovery, paid reputation', cap: 'No receipt, no rating', i: 'M' },
  { q: 'Read paid and raw reputation from one API, and see exactly which ratings were excluded and why.', who: 'Trust auditor', sub: 'Indexer API, ERC-8004', cap: 'Receipt-verified scores', i: 'T' }
] as const

/** The use-cases carousel: a large serif quote, who it is for, and the capability it relies on. */
export default function UseCases() {
  const [n, setN] = useState(0)
  const [hold, setHold] = useState(false)
  useEffect(() => {
    if (hold || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t = setInterval(() => setN(v => (v + 1) % SLIDES.length), 6500)
    return () => clearInterval(t)
  }, [hold])
  const s = SLIDES[n]
  return (
    <div className="lp-uc" onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)}>
      <p className="lp-uc-top"><span>Use cases</span><i /><span>0{n + 1} / 0{SLIDES.length}</span></p>
      <blockquote key={n}>&quot;{s.q}&quot;</blockquote>
      <div className="lp-uc-who">
        <span className="lp-uc-av">{s.i}</span>
        <div><b>{s.who}</b><small>{s.sub}</small></div>
      </div>
      <div className="lp-uc-cap"><small>Key capability</small><h3>{s.cap}</h3></div>
      <div className="lp-uc-dots" role="tablist" aria-label="Use cases">
        {SLIDES.map((x, i) => (
          <button key={x.who} role="tab" aria-selected={i === n} aria-label={x.who} className={i === n ? 'on' : undefined} onClick={() => setN(i)} />
        ))}
      </div>
    </div>
  )
}
