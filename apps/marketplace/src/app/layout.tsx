import type { Metadata } from 'next'
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
      <body>{children}</body>
    </html>
  )
}
