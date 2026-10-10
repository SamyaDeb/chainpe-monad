import type { Metadata } from 'next'
import Link from 'next/link'
import Header from '@/components/Header'
import './globals.css'

export const metadata: Metadata = {
  title: 'ChainPe · the trust layer for x402 on Monad',
  description:
    'x402 services on Monad ranked by ERC-8004 reputation that only counts ratings backed by a settled USDC payment. No receipt, no rating.'
}

// Ported from the legacy dashboard: apply the saved / system theme before paint.
const themeScript = `
  try {
    var saved = localStorage.getItem('chainpe-theme');
    if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  } catch (e) {}
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Header />
        <div className="banner">
          <div className="container">
            <strong>Monad testnet.</strong> Every payment and rating shown here is demo traffic from team wallets, not
            traction.
          </div>
        </div>
        <main>
          <div className="container">{children}</div>
        </main>
        <footer className="footer">
          <div className="container">
            ChainPe on Monad · testnet only · reputation from the canonical ERC-8004 registries · payments via x402 v2
            (USDC) · <Link href="/try">try it</Link>
          </div>
        </footer>
      </body>
    </html>
  )
}
