import Link from 'next/link'
import CodeBlock from '@/components/CodeBlock'
import { addressUrl, contracts } from '@/lib/format'

export const metadata = { title: 'Try it · ChainPe on Monad testnet' }

const CLONE = `git clone https://github.com/SamyaDeb/chainpe-monad && cd chainpe-monad
npm ci && npm run build`

const CONSUMER = `import { ChainPe } from '@chainpemonad/sdk'
const cp = new ChainPe({ privateKey: process.env.CHAINPE_PRIVATE_KEY, network: 'monad-testnet' })
const res = await cp.pay('http://localhost:4402/')   // 402 → signs USDC → settled → 200`

const RATE = `// optional: rate it. The settlement tx is the receipt, so this rating counts as paid.
await cp.giveFeedback({ agentId: '<your agentId>', value: 90, paymentTxHash: res.payment.txHash })`

const PROVIDER_INIT = `npx chainpe init     # once: backend URL, price in USDC, payTo wallet, monad-testnet`

const PROVIDER = `CHAINPE_FACILITATOR_URL=https://x402-facilitator.molandak.org npx chainpe start`

const MCP_BUILD = `npm run build:mcpb -w chainpe-wallet-mcp   # → packages/chainpe-wallet/chainpe.mcpb`

const MCP_JSON = `{
  "mcpServers": {
    "chainpe-wallet": {
      "command": "node",
      "args": ["/absolute/path/to/chainpe-monad/packages/chainpe-wallet/dist/index.js"],
      "env": {
        "CHAINPE_PRIVATE_KEY": "0x… (a throwaway testnet key)",
        "NETWORK": "monad-testnet",
        "MAX_PER_CALL": "0.05",
        "MAX_PER_DAY": "1.00",
        "CHAINPE_INDEXER_URL": "http://localhost:4600"
      }
    }
  }
}`

const RUN_LOCAL = `# from the repo root, in two terminals
docker run -d --name chainpe-pg -e POSTGRES_PASSWORD=pg -p 5432:5432 postgres:16-alpine
npm ci --prefix services/chainpe-indexer
NETWORK=monad-testnet DATABASE_URL=postgres://postgres:pg@localhost:5432/postgres \\
  npm run dev --prefix services/chainpe-indexer            # :4600, catches up from the registry deploy block
NEXT_PUBLIC_CHAINPE_INDEXER_URL=http://localhost:4600 npm run dev -w @chainpemonad/marketplace   # :3000`

export default function Try() {
  const c = contracts('monad-testnet')
  return (
    <>
      <h1>Try it on Monad testnet</h1>
      <p className="lead">
        Testnet funds only. You pay an x402 API in USDC, rate it with the settlement as the receipt,
        and watch the rating count as <span className="badge paid">paid</span> in the <Link href="/receipts">receipts
        feed</Link>. Use a throwaway wallet; never paste a key with real funds anywhere.
      </p>

      <ol className="steps" style={{ marginTop: 28 }}>
        <li>
          <h3>Get testnet funds</h3>
          <ul className="plain">
            <li>
              MON for gas: <a href="https://faucet.monad.xyz" target="_blank" rel="noreferrer">faucet.monad.xyz</a>
            </li>
            <li>
              Testnet USDC: <a href="https://faucet.circle.com" target="_blank" rel="noreferrer">Circle faucet</a>{' '}
              (choose Monad Testnet). A paid call costs 0.001–0.01 USDC.
            </li>
          </ul>
        </li>

        <li>
          <h3>Build ChainPe</h3>
          <p>
            The Monad builds of the SDK, CLI and MCP wallet run from this repository; the Monad packages are named{' '}
            <code>@chainpemonad/*</code> and are not on npm yet (the older <code>@chainpeavax</code> releases are Avalanche-only).
          </p>
          <CodeBlock lang="sh" code={CLONE} />
        </li>

        <li>
          <h3>Provider: put an API behind x402 with one command</h3>
          <p>
            <code>chainpe start</code> runs a payment proxy in front of your backend: unpaid requests get{' '}
            <code>402 Payment Required</code> with a USDC offer on <code>eip155:10143</code>, paid ones are settled
            through the facilitator and forwarded. After a one-time <code>chainpe init</code>:
          </p>
          <CodeBlock lang="sh" code={PROVIDER_INIT} />
          <CodeBlock lang="sh" code={PROVIDER} />
          <p className="small muted">
            This uses Monad&apos;s public x402 facilitator; ChainPe&apos;s own facilitator
            (<code>services/chainpe-facilitator</code>) works the same way. To be listed and rated, mint an ERC-8004
            agentId and run <code>CHAINPE_PRIVATE_KEY=… npx chainpe register</code> with your public URL in{' '}
            <code>CHAINPE_PUBLIC_URL</code>.
          </p>
        </li>

        <li>
          <h3>Consumer: pay any x402 API in three lines</h3>
          <CodeBlock lang="ts" code={CONSUMER} />
          <CodeBlock lang="ts" code={RATE} />
          <p className="small muted">
            The SDK signs only <code>exact</code> USDC offers on the wallet&apos;s own Monad network, up to{' '}
            <code>maxPerCall</code> (default 1 USDC). Any x402 v2 client (e.g. <code>@x402/fetch</code>) can pay a
            ChainPe provider too.
          </p>
        </li>

        <li>
          <h3>Claude: the MCP wallet</h3>
          <p>
            Gives Claude a Monad wallet with per-call and daily USDC caps: <code>search_bazaar</code> (services ranked
            by paid reputation), <code>pay</code>, <code>give_feedback</code>, <code>spending_report</code> and more.
            Build the Claude Desktop extension and double-click it:
          </p>
          <CodeBlock lang="sh" code={MCP_BUILD} />
          <p>Or add it to any MCP client config (e.g. Claude Desktop&apos;s <code>claude_desktop_config.json</code>):</p>
          <CodeBlock lang="json" code={MCP_JSON} />
        </li>

        <li>
          <h3>See it counted</h3>
          <p>
            Run the indexer and this site locally (no keys needed) and your rating shows up in the{' '}
            <Link href="/receipts?show=all">feed</Link> as paid, linked to its settlement. Rate without paying and it
            shows up as excluded, with the reason. The full stack with our own facilitator is in{' '}
            <code>docs/DEPLOYMENTS.md</code>.
          </p>
          <CodeBlock lang="sh" code={RUN_LOCAL} />
        </li>
      </ol>

      <h2>Testnet contracts</h2>
      <dl className="facts">
        <dt>ChainPeRegistry</dt>
        <dd>
          <a href={addressUrl('monad-testnet', c.registry!)} target="_blank" rel="noreferrer">
            {c.registry}
          </a>
        </dd>
        <dt>ERC-8004 Identity</dt>
        <dd>
          <a href={addressUrl('monad-testnet', c.identity)} target="_blank" rel="noreferrer">
            {c.identity}
          </a>
        </dd>
        <dt>ERC-8004 Reputation</dt>
        <dd>
          <a href={addressUrl('monad-testnet', c.reputation)} target="_blank" rel="noreferrer">
            {c.reputation}
          </a>
        </dd>
      </dl>
    </>
  )
}
