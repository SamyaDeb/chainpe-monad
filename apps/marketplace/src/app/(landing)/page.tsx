import type { Metadata } from 'next'
import Link from 'next/link'
import CodeTabs from '@/components/landing/CodeTabs'
import CountUp from '@/components/landing/CountUp'
import Nav from '@/components/landing/Nav'
import Sphere from '@/components/landing/Sphere'
import { getLiveStatus, type Health } from '@/lib/status'

export const revalidate = 60

export const metadata: Metadata = {
  title: 'ChainPe · x402 payment infrastructure for Monad',
  description:
    'Pay any API in USDC, rate any agent on-chain, settle on Monad in under a second. Fund agents with on-chain spending mandates and rank services by reputation that only counts settled payments. No receipt, no rating.'
}

const REPO = 'https://github.com/SamyaDeb/chainpe-monad'
const DOCS = `${REPO}/tree/main/docs`
const SELLER = 'https://seller-production-ea9b.up.railway.app/stats'

const CAPS = [
  { t: 'x402 Payment Protocol', d: 'Any HTTP endpoint returns 402 Payment Required with a USDC price. Consumers auto-pay with a signed EIP-3009 transfer, a facilitator settles it on Monad, and the API answers 200.' },
  { t: 'Paid Reputation (ERC-8004)', d: 'After a paid call the client rates the service on Monad’s canonical Reputation Registry, citing the settlement tx as feedbackHash. Agents discover services ranked by paid reputation.' },
  { t: 'Spending Mandates (PolicyVault)', d: 'An owner funds a PolicyVault and gives the agent only a session key. The vault enforces per-call, daily and total caps, expiry and a recipient allowlist on every x402 call.' },
  { t: 'No Receipt, No Rating', d: 'The ChainPe indexer counts a rating only if the cited tx is a successful USDC payment from the rater to that agent’s payTo. Reused receipts, self-payments and ratings with no receipt are excluded.' }
]

const ICONS = [
  <svg key="a" viewBox="0 0 80 64" width="80" height="64" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="6" y="4" width="68" height="46" rx="2" /><path d="M16 16h48M16 24h48M16 32h30" strokeWidth="3" /><circle cx="40" cy="58" r="1.6" fill="currentColor" /></svg>,
  <svg key="b" viewBox="0 0 80 64" width="80" height="64" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="40" cy="32" r="7" fill="currentColor" />{[[40, 6], [14, 20], [66, 20], [14, 44], [66, 44], [40, 58]].map(([x, y]) => <g key={`${x}${y}`}><line x1="40" y1="32" x2={x} y2={y} /><circle cx={x} cy={y} r="4" fill="var(--lp-bg)" /></g>)}</svg>,
  <svg key="c" viewBox="0 0 80 64" width="80" height="64" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="6" y="20" width="22" height="28" rx="2" /><rect x="52" y="20" width="22" height="28" rx="2" /><path d="M28 34h24" /><text x="17" y="39" fontSize="11" fill="currentColor" stroke="none" textAnchor="middle">A</text><text x="63" y="39" fontSize="11" fill="currentColor" stroke="none" textAnchor="middle">B</text><circle cx="17" cy="12" r="4" /><circle cx="63" cy="12" r="4" /></svg>,
  <svg key="d" viewBox="0 0 80 64" width="80" height="64" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M40 4 66 14v18c0 14-11 24-26 28C25 56 14 46 14 32V14z" /><rect x="31" y="30" width="18" height="14" rx="2" fill="currentColor" /><path d="M34 30v-5a6 6 0 0 1 12 0v5" /></svg>
]

const STEPS = [
  { n: 'I', t: 'Wrap your API', d: 'Monetize any HTTP endpoint with one command. The chainpe proxy returns 402 Payment Required with a USDC price on Monad.' },
  { n: 'II', t: 'Agent pays & uses', d: 'On 402, cp.pay signs a USDC payment (EIP-3009) up to maxPerCall, the facilitator settles it on Monad, and the API answers 200.' },
  { n: 'III', t: 'Rate with the receipt', d: 'The agent rates the service citing its settlement tx. The indexer verifies the receipt on-chain, and only then does the rating count toward paid reputation.' }
]

const ECOSYSTEM = [
  ['Vercel AI SDK', 'AI Framework'], ['LangChain', 'AI Framework'], ['Claude MCP', 'AI Assistant'], ['Monad', 'Blockchain'], ['USDC (Circle)', 'Stablecoin'],
  ['PostgreSQL', 'Database'], ['Railway', 'Hosting'], ['Hardhat', 'Development'], ['Sourcify', 'Verification'], ['x402 v2', 'Payment Protocol']
]

const SECURITY = [
  { t: 'Non-custodial Settlement', d: 'The facilitator never holds funds. Payers sign EIP-3009 authorizations; the facilitator submits them and pays gas.' },
  { t: 'On-chain Spending Caps', d: 'PolicyVault enforces per-call, daily and total caps, expiry and a recipient allowlist on-chain. Overspends revert.' },
  { t: 'Receipt-verified Ratings', d: 'Reused receipts, self-payments and ratings with no receipt are excluded. Paid scores are weighted by USDC paid, capped per receipt and per payer.' },
  { t: 'Strict payTo Policy', d: 'ChainPe’s facilitator only settles to a service’s registered payTo. It is not an open gas relay.' }
]

const USES = [
  { t: 'Research agents', d: 'Buy a thousand summaries and pay per call, not a monthly subscription.' },
  { t: 'API providers', d: 'Put an existing API behind x402 in one command and get paid in USDC.' },
  { t: 'Agent marketplaces', d: 'Rank sellers by what paying customers said, not by free ratings.' },
  { t: 'Funded agents', d: 'Give an agent a budget it cannot exceed; the contract enforces it.' }
]

function Dot({ s }: { s: Health }) {
  return <span className={`lp-dot ${s}`} aria-hidden="true" />
}
const label = (s: Health) => (s === 'live' ? 'Live' : s === 'degraded' ? 'Degraded' : 'Unreachable')

export default async function Landing() {
  const live = await getLiveStatus()
  const all = live.indexer === 'live' && live.facilitator === 'live'
  const rows: [string, string, string, Health | null][] = [
    ['Monad Testnet', 'eip155:10143 · Primary settlement', '591ms', null],
    ['Monad x402 Facilitator', 'Public · p50 over 30 calls', '591ms', null],
    ['ChainPe Facilitator', 'Strict payTo · p50 over 20 calls', '897ms', null],
    ['PolicyVault.spend', 'Mandate mode · caps on-chain', '~252k gas', null],
    ['Railway (Facilitator)', 'Settlement service', '', live.facilitator],
    ['Railway (Indexer)', 'Paid reputation API', '', live.indexer]
  ]
  return (
    <>
      <Nav />

      <section className="lp-hero">
        <Sphere />
        <div className="lp-hero-in">
          <p className="lp-eyebrow"><span />x402 payment infrastructure for Monad</p>
          <h1>The layer<br />to <u>settle</u></h1>
          <p className="lp-sub">Pay any API in USDC, rate any agent on‑chain, settle on Monad in under a second. All in 3 lines of code.</p>
          <div className="lp-cta">
            <Link href="/try" className="lp-pill lp-pill-dark">Start integrating <i>→</i></Link>
            <a href={DOCS} target="_blank" rel="noreferrer" className="lp-pill">Read the docs</a>
          </div>
        </div>
        <div className="lp-strip">
          <div><b>591ms</b><span>p50 paid call, 402 → 200<em>Monad testnet</em></span></div>
          <div><b>~137k</b><span>gas per settlement<em>EIP-3009</em></span></div>
          <div><b>0.001</b><span>USDC per benchmark call<em>x402 v2</em></span></div>
        </div>
      </section>

      <section className="lp-sec" id="features">
        <p className="lp-label"><span />Capabilities</p>
        <h2>One core, many surfaces.<br /><em>All on Monad.</em></h2>
        <div className="lp-caps">
          {CAPS.map((c, i) => (
            <article key={c.t}>
              <small>0{i + 1}</small>
              <div><h3>{c.t}</h3><p>{c.d}</p></div>
              <div className="lp-icon">{ICONS[i]}</div>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-dark" id="how">
        <div className="lp-wrap">
          <p className="lp-label"><span />Process</p>
          <h2>Three lines.<br /><em>Infinite possibilities.</em></h2>
          <div className="lp-process">
            <ol>
              {STEPS.map(s => (
                <li key={s.n}><small>{s.n}</small><div><h3>{s.t}</h3><p>{s.d}</p></div></li>
              ))}
            </ol>
            <div className="lp-window">
              <div className="lp-window-bar"><i /><i /><i /><span>chainpe.ts</span></div>
              <pre><code>{`const res = await cp.pay(
  '${SELLER}'
)
// 402 → sign USDC → settled → 200

console.log(res.payment.txHash)`}</code></pre>
              <div className="lp-window-foot"><span className="lp-dot live" />Ready — Monad Testnet</div>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-sec">
        <p className="lp-label"><span />Infrastructure</p>
        <h2>Monad‑native<br />by design.</h2>
        <p className="lp-lead">Sub-second settlement, Circle USDC on Monad and canonical ERC-8004 registries put a payment and a receipt inside every agent request. Tight gas limits on every settlement, because Monad bills the gas limit.</p>
        <div className="lp-nums">
          <div><b>591ms</b><span>p50, 402 → 200</span></div>
          <div><b>755ms</b><span>p95, 30 calls</span></div>
          <div><b>~137k</b><span>Gas per settlement</span></div>
        </div>
        <div className="lp-table">
          <div className="lp-table-head"><span>Network Status</span><span><Dot s={all ? 'live' : 'degraded'} />{all ? 'All operational' : 'Check services'}</span></div>
          {rows.map(([n, d, v, h]) => (
            <div key={n} className="lp-row">
              <div><Dot s={h ?? 'live'} /><b>{n}</b><small>{d}</small></div>
              <span>{h ? label(h) : v}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-sec lp-metrics" id="metrics">
        <p className="lp-label"><span />Live metrics</p>
        <h2>Built to prove<br />it works.</h2>
        <p className="lp-note"><Dot s={all ? 'live' : 'degraded'} />Live on Testnet</p>
        <div className="lp-metric-list">
          <div><b><CountUp to={30} /></b><span>Paid calls benchmarked on testnet</span></div>
          <div><b><CountUp to={591} suffix="ms" /></b><span>p50 from 402 to settled 200</span></div>
          <div><b><CountUp to={3} /></b><span>Lines to integrate payments</span></div>
          <div><b><CountUp to={live.services ?? 13} /></b><span>Demo services registered (ERC-8004 agents)</span></div>
        </div>
      </section>

      <section className="lp-sec lp-eco">
        <p className="lp-label lp-center"><span />Ecosystem<span /></p>
        <h2 className="lp-center">Works with everything<br />you already use.</h2>
        <p className="lp-lead lp-center">Drop-in tools for Vercel AI SDK, LangChain, Claude MCP, and any x402 v2 client.</p>
        <div className="lp-logos">
          {ECOSYSTEM.map(([n, k]) => (<div key={n}><b>{n}</b><small>{k}</small></div>))}
        </div>
      </section>

      <section className="lp-sec lp-tint" id="security">
        <p className="lp-label"><span />Security</p>
        <h2>Trust is<br />non‑negotiable.</h2>
        <p className="lp-lead">Non-custodial by design. On-chain spending caps. Ratings that only count with a settled payment behind them. Every layer is built for trustless agent interactions.</p>
        <div className="lp-tags">{['EIP-3009', 'ERC-8004', 'EIP-712', 'UUPS', 'OpenZeppelin'].map(t => <span key={t}>{t}</span>)}</div>
        <div className="lp-cards">
          {SECURITY.map(s => (<div key={s.t}><h3>{s.t}</h3><p>{s.d}</p></div>))}
        </div>
      </section>

      <section className="lp-sec" id="developers">
        <p className="lp-label"><span />For developers</p>
        <h2>Built for devs.<br /><em>By a dev.</em></h2>
        <p className="lp-lead">A thoughtfully designed SDK that gets out of your way. Three lines to payments. Works with any x402 v2 service on Monad.</p>
        <div className="lp-devgrid">
          <div className="lp-devlist">
            <div><b>TypeScript native</b><span>Full type safety, Monad constants in networks.ts.</span></div>
            <div><b>Drop-in fetch</b><span>cp.fetch works like native fetch with auto-pay.</span></div>
            <div><b>AI framework tools</b><span>Vercel AI SDK + LangChain integrations.</span></div>
            <div><b>Claude MCP wallet</b><span>Pay from Claude with spending caps.</span></div>
          </div>
          <div>
            <CodeTabs />
            <p className="lp-links"><a href={DOCS} target="_blank" rel="noreferrer">Read the docs</a><a href={REPO} target="_blank" rel="noreferrer">View on GitHub</a><Link href="/services">Marketplace</Link></p>
          </div>
        </div>
        <div className="lp-uses">
          <p className="lp-label"><span />Use cases<em>04 / 04</em></p>
          <div>{USES.map(u => (<article key={u.t}><h3>{u.t}</h3><p>{u.d}</p></article>))}</div>
        </div>
      </section>

      <section className="lp-sec lp-tint" id="pricing">
        <p className="lp-label"><span />Pricing</p>
        <h2>Pay per request.<br /><em>No subscriptions.</em></h2>
        <p className="lp-lead">A sustainable model for the agent economy. Only pay when your agents successfully transact.</p>
        <div className="lp-plans">
          <div>
            <small>01</small><h3>Testnet</h3><p className="lp-plan-sub">For development and testing</p>
            <p className="lp-price">Free <span>/forever</span></p>
            <ul>{['Monad testnet (eip155:10143)', 'Unlimited testnet transactions', 'Faucet MON + Circle test USDC', 'Public + ChainPe facilitators', 'Full indexer API access'].map(x => <li key={x}>{x}</li>)}</ul>
            <Link href="/try" className="lp-pill lp-block">Start building →</Link>
          </div>
          <div className="lp-featured">
            <em>Mainnet next</em>
            <small>02</small><h3>Production</h3><p className="lp-plan-sub">Pay-as-you-go on Monad mainnet</p>
            <p className="lp-price">Soon <span>/per settlement</span></p>
            <ul>{['Monad mainnet (eip155:143)', 'Native Circle USDC settlement', 'Non-custodial processing', 'Paid reputation (ERC-8004)', 'PolicyVault spending mandates', 'Hosted paid-ranking API'].map(x => <li key={x}>{x}</li>)}</ul>
            <a href={`${REPO}/blob/main/docs/MAINNET-RUNBOOK.md`} target="_blank" rel="noreferrer" className="lp-pill lp-pill-dark lp-block">Mainnet runbook →</a>
          </div>
          <div>
            <small>03</small><h3>Self-Hosted</h3><p className="lp-plan-sub">Run your own infrastructure</p>
            <p className="lp-price">Open <span>/source</span></p>
            <ul>{['Everything in Production', 'Zero facilitator fees', 'Host your own indexer (Postgres)', 'Docker Compose deploy', 'Direct smart contract access', 'Self-managed RPC endpoints'].map(x => <li key={x}>{x}</li>)}</ul>
            <a href={REPO} target="_blank" rel="noreferrer" className="lp-pill lp-block">View GitHub →</a>
          </div>
        </div>
        <p className="lp-fine">Note: network gas fees on Monad still apply, billed on the gas limit. <a href={`${REPO}/blob/main/docs/WHY-MONAD.md`} target="_blank" rel="noreferrer">Read fee mechanics</a></p>
      </section>

      <section className="lp-sec" id="get-started">
        <div className="lp-final">
          <h2>Ready to monetize<br />your agents?</h2>
          <p className="lp-lead">Join the Monad agent economy. One SDK, three lines of code, sub-second settlement.</p>
          <div className="lp-cta">
            <a href={DOCS} target="_blank" rel="noreferrer" className="lp-pill lp-pill-dark">Read the docs →</a>
            <a href={REPO} target="_blank" rel="noreferrer" className="lp-pill">View GitHub</a>
          </div>
          <code>git clone github.com/SamyaDeb/chainpe-monad</code>
        </div>
      </section>

      <footer className="lp-foot">
        <div className="lp-foot-in">
          <div className="lp-foot-brand">
            <b className="lp-logo">ChainPe</b>
            <p>Payment and reputation infrastructure for the Monad agent economy. Monetize any API with sub-second settlement.</p>
          </div>
          <div><h4>Product</h4><a href="#features">Features</a><a href="#how">How it works</a><a href="#metrics">Live metrics</a><a href="#security">Security</a></div>
          <div><h4>Developers</h4><a href={DOCS} target="_blank" rel="noreferrer">Documentation</a><a href={REPO} target="_blank" rel="noreferrer">GitHub</a><Link href="/services">Marketplace</Link><a href={`${REPO}/blob/main/docs/DEPLOYMENTS.md`} target="_blank" rel="noreferrer">Testnet deployments</a></div>
          <div><h4>Ecosystem</h4><a href="https://testnet.monadvision.com" target="_blank" rel="noreferrer">MonadVision</a><a href="https://faucet.monad.xyz" target="_blank" rel="noreferrer">Monad Faucet</a><a href="https://faucet.circle.com" target="_blank" rel="noreferrer">Circle USDC</a></div>
          <div><h4>Legal</h4><a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer">MIT License</a><a href={`${REPO}/blob/main/contracts/SECURITY.md`} target="_blank" rel="noreferrer">Contract security</a><a href={`${REPO}/blob/main/PRIOR_WORK.md`} target="_blank" rel="noreferrer">Prior work &amp; AI disclosure</a></div>
        </div>
        <div className="lp-foot-bar"><span>© 2026 ChainPe. Built for the Monad ecosystem. Demo traffic on testnet, not traction.</span><span><Dot s="live" />Smart contracts live on Monad Testnet</span></div>
      </footer>
    </>
  )
}
