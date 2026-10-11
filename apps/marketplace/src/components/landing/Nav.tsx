'use client'

import Link from 'next/link'
import { useState } from 'react'

const DOCS = 'https://github.com/SamyaDeb/chainpe-monad/tree/main/docs'

export default function Nav() {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  return (
    <header className="lp-nav">
      <div className="lp-nav-in">
        <Link href="/" className="lp-logo">ChainPe</Link>
        <nav className={open ? 'open' : undefined}>
          <a href="#features" onClick={close}>Features</a>
          <a href="#how" onClick={close}>How it works</a>
          <a href="#developers" onClick={close}>Developers</a>
          <a href="#pricing" onClick={close}>Pricing</a>
          <a href={DOCS} target="_blank" rel="noreferrer" onClick={close}>Docs</a>
          <Link href="/services" onClick={close}>Marketplace</Link>
        </nav>
        <Link href="/try" className="lp-pill lp-pill-dark lp-nav-cta">Get started</Link>
        <button className="lp-burger" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span /><span />
        </button>
      </div>
    </header>
  )
}
