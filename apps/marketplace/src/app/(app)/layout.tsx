import Link from 'next/link'
import Header from '@/components/Header'

// Chrome for the data pages (services, receipts, try it). The landing page has its own layout.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
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
    </>
  )
}
