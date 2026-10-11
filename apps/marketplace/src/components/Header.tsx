'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV = [
  { href: '/services', label: 'Services' },
  { href: '/receipts', label: 'Receipts' },
  { href: '/try', label: 'Try it' }
]

export default function Header() {
  const path = usePathname()

  const toggleTheme = () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
    try {
      localStorage.setItem('chainpe-theme', isDark ? 'light' : 'dark')
    } catch {
      // storage blocked: the toggle still works for this page view
    }
    if (isDark) document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', 'dark')
  }

  return (
    <header className="header">
      <div className="container header-inner">
        <Link href="/" className="logo">
          <img src="/icon.png" alt="" />
          <span>
            chain<span className="logo-accent">pe</span>
          </span>
        </Link>
        <nav className="nav">
          {NAV.map(n => {
            const active = path.startsWith(n.href)
            return (
              <Link key={n.href} href={n.href} className={active ? 'active' : undefined}>
                {n.label}
              </Link>
            )
          })}
        </nav>
        <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle dark mode">
          <svg className="icon-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
          <svg className="icon-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        </button>
      </div>
    </header>
  )
}
