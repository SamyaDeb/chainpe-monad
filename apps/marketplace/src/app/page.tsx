import type { Metadata } from 'next'
import Link from 'next/link'
import Install from '@/components/Install'
import './landing.css'

export const metadata: Metadata = {
  title: 'ChainPe · the trust layer for x402 on Monad',
  description:
    'Fund an AI agent with an on-chain spending mandate, let it pay any x402 API in USDC on Monad, and rank services by ERC-8004 reputation that only counts settled payments. No receipt, no rating.'
}

const LOOP = [
  { n: '1', t: 'Fund', d: 'The owner sets a spending mandate in a PolicyVault: per-call, daily and total caps, an allowlist, an expiry.' },
  { n: '2', t: 'Discover', d: 'The agent finds services in the on-chain registry, ranked by payment-backed reputation.' },
  { n: '3', t: 'Pay', d: 'x402 v2: the agent gets an HTTP 402, signs a USDC payment, and the facilitator settles it on Monad.' },
  { n: '4', t: 'Receipt', d: 'The settlement transaction hash is the receipt. It is a real USDC transfer to the service.' },
  { n: '5', t: 'Rate', d: 'The payer rates the service on the canonical ERC-8004 Reputation Registry, citing that receipt.' },
  { n: '6', t: 'Rank', d: 'The indexer counts only ratings whose receipt checks out, so the ranking cannot be farmed for free.' }
]

const FEATURES = [
  { t: 'x402 v2 on Monad', d: 'Standard HTTP 402 payments in USDC (eip155:143 and eip155:10143). Any x402 client can pay a ChainPe seller.' },
  { t: 'No receipt, no rating', d: 'A rating is "paid" only if it cites a settled USDC payment from the rater to that service. Unpaid ratings stay visible as raw, never in the paid score.' },
  { t: 'Mandate mode', d: 'An agent holds only a session key. The PolicyVault enforces per-call and daily caps, the allowlist and revocation on every call, on-chain.' },
  { t: 'Canonical ERC-8004', d: 'Identity and reputation use Monad’s own registries. Nothing to migrate: services and agents plug in as they are.' },
  { t: 'Non-custodial settlement', d: 'The facilitator only pays gas. It settles to registered services, and funds go straight from payer to seller.' },
  { t: 'Safe by default', d: 'Offers that are not exact USDC on the right network, or above the per-call cap, are refused before anything is signed.' }
]

const STATS = [
  { n: '591 ms', l: 'p50, 402 → settled → 200', s: 'testnet, 30 paid calls, via Monad’s public facilitator' },
  { n: '0.001', l: 'USDC per call', s: 'the smallest price on the demo sellers' },
  { n: '~137k', l: 'gas per settlement', s: 'measured on Monad testnet, tight gas limit' }
]

const USES = [
  { t: 'Research agents', d: 'An agent buys a thousand summaries and pays per call, instead of a monthly subscription.' },
  { t: 'Trading bots', d: 'A bot pays several data providers per request and keeps the ones whose paid ratings hold up.' },
  { t: 'Agent marketplaces', d: 'Rank sellers by what paying customers said, not by ratings anyone can post for free.' },
  { t: 'API providers', d: 'Put an existing API behind x402 in one command and get paid in USDC straight to your wallet.' },
  { t: 'Auditors and trust tools', d: 'Read payment-backed reputation through one API and compare it with the raw registry score.' },
  { t: 'Funded agents', d: 'Give an agent a budget it cannot exceed. The contract, not the agent, enforces the limit.' }
]

const FAQ = [
  { q: 'What is ChainPe?', a: 'ChainPe is a trust and spend-control layer for x402 on Monad. Agents pay APIs in USDC, a PolicyVault can cap what they spend, and ERC-8004 reputation is weighted by whether the rater actually paid.' },
  { q: 'What does "No receipt, no rating" mean?', a: 'A rating counts toward the paid score only if its feedback hash is a settlement transaction in which the rater sent USDC to that service. Each receipt backs one rating, and the service’s own wallets and developer cannot rate themselves into the paid score.' },
  { q: 'Why not just use Stripe?', a: 'Card fees include a fixed per-transaction charge, which is bigger than a five-cent API call. USDC on Monad settles in well under a second at a fraction of a cent, and the agent signs the payment itself, with no account to open.' },
  { q: 'Why Monad?', a: 'Pay-per-call needs each request to settle before the agent’s next step. We measured about 0.6 s from 402 to a settled 200 on testnet. Monad also hosts the canonical x402 and ERC-8004 infrastructure, so there is nothing to migrate.' },
  { q: 'How do providers get paid?', a: 'Directly to their wallet. The facilitator pays gas and settles USDC from the payer to the provider; it never holds the funds.' },
  { q: 'What prevents an agent overspending?', a: 'The SDK refuses any offer above the per-call cap before signing. In mandate mode the PolicyVault also enforces per-call, daily and total limits on-chain, and the owner can revoke the session key at any time.' },
  { q: 'Is this live?', a: 'It is live on Monad testnet, and every payment and rating shown on this site is demo traffic between team wallets, not traction. Mainnet is prepared but not deployed.' }
]

export default function Landing() {
  return (
    <div className="landing">
      <section className="hero">
        <div className="hero-badge">
          <span className="badge-new">Live</span>
          <span>Monad testnet · x402 v2 · ERC-8004</span>
        </div>
        <h1 className="hero-title">
          The trust layer for <span className="highlight">x402</span> on Monad
        </h1>
        <p className="hero-subtitle">
          Fund an AI agent with an on-chain spending mandate, let it pay any x402 API in USDC, and rank services by
          reputation that only counts settled payments. <strong>No receipt, no rating.</strong>
        </p>
        <div className="hero-cta">
          <Link href="/services" className="btn btn-primary">See ranked services →</Link>
          <Link href="/try" className="btn">Try it</Link>
        </div>
        <Install />
      </section>

      <section className="section" id="loop">
        <h2>How it works</h2>
        <p className="section-description">One loop, end to end, on Monad with standard x402 v2.</p>
        <ol className="loop">
          {LOOP.map(s => (
            <li key={s.n}>
              <span className="loop-n">{s.n}</span>
              <div>
                <strong>{s.t}</strong>
                <span>{s.d}</span>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="section" id="problem">
        <h2>The problem</h2>
        <p className="section-description">
          Agents can now pay for APIs, but two things are still missing. Nothing stops an agent from spending more than
          its owner meant, and a reputation score anyone can post to for free tells you little about a service. A paid
          call is cheap to prove and costly to fake, so ChainPe ties reputation to payment and spending to a mandate the
          contract enforces.
        </p>
      </section>

      <section className="section" id="what">
        <h2>What is ChainPe?</h2>
        <p className="section-description">
          A primitive for any x402 seller or agent on Monad, not another marketplace to migrate to.
        </p>
        <div className="features-list">
          {FEATURES.map(f => (
            <div className="feature-item" key={f.t}>
              <span className="feature-star">[★]</span>
              <div>
                <strong>{f.t}</strong>
                <span className="feature-desc">{f.d}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="section" id="numbers">
        <h2>Why Monad + x402</h2>
        <div className="stats-grid">
          {STATS.map(s => (
            <div className="stat-card" key={s.l}>
              <span className="stat-number">{s.n}</span>
              <span className="stat-label">{s.l}</span>
              <span className="stat-sub">{s.s}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="section" id="use-cases">
        <h2>Who it is for</h2>
        <div className="use-cases-grid">
          {USES.map(u => (
            <div className="use-case-card" key={u.t}>
              <h3>{u.t}</h3>
              <p>{u.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section" id="faq">
        <h2>FAQ</h2>
        <div className="faq-list">
          {FAQ.map(f => (
            <details className="faq-item" key={f.q}>
              <summary className="faq-question">{f.q}</summary>
              <p className="faq-answer">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="section section-cta" id="get-started">
        <h2>See it working</h2>
        <p className="section-description">
          Browse the live ranking, read the receipts behind each rating, or pay a demo seller yourself with testnet
          funds. Everything here is Monad testnet demo traffic.
        </p>
        <div className="hero-cta">
          <Link href="/services" className="btn btn-primary">Ranked services</Link>
          <Link href="/receipts" className="btn">Receipts feed</Link>
          <Link href="/try" className="btn">Try it</Link>
        </div>
      </section>
    </div>
  )
}
