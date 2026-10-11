# ChainPe on Monad

**The trust layer for x402 on Monad.** Let an AI agent pay any x402 API in USDC on Monad,
within an on-chain spending mandate, and rank services by ERC-8004 reputation that only
counts ratings backed by a settled payment.

> **No receipt, no rating.**

Built for **Monad Metropolis, Track 4 (Trust, Identity & AI Infrastructure)**. It is live on
**Monad testnet**; mainnet is not deployed (see [Status and limits](#status-and-limits)).
Every payment and rating shown anywhere in this repo is **demo traffic from team wallets,
not traction**.

## Live demo (Monad testnet)

| | |
|---|---|
| **Marketplace + landing** | https://chainpemonad.vercel.app |
| Indexer (paid-reputation API) | https://indexer-production-50cd.up.railway.app |
| Facilitator (x402 v2, `exact` + `chainpe-vault`) | https://facilitator-production-8cc9.up.railway.app |
| Demo sellers (4 services, one host) | https://seller-production-ea9b.up.railway.app: `/stats` · `/quote?amountUsdc=10` · `/digest` · `/report?agentId=2133` |
| Contracts, agents, transactions | [`docs/DEPLOYMENTS.md`](docs/DEPLOYMENTS.md) |
| Explorer | https://testnet.monadvision.com |

No login, wallet or install is needed to look around. To pay and rate yourself, see the
[judge guide](#judge-guide).

## The problem

Agents are starting to pay for APIs per call with x402, and they need reputation to choose
what to pay. Monad has canonical ERC-8004 registries for that. But anyone can post a
rating: a fresh wallet that never used a service can give it 100/100, as often as it likes,
so a raw average can be bought for the price of gas. And nothing stops an agent that holds
a wallet from spending more than its owner intended.

## What ChainPe does

ChainPe is not another marketplace. It is a layer that any x402 seller or agent on Monad
can plug into, with nothing to migrate:

- **Pay:** an SDK, CLI, Claude MCP wallet and agent tools that pay x402 v2 `exact` USDC
  offers on Monad. Per-call and daily caps are checked **before** anything is signed, and
  offers that are not exact USDC on the right network are refused.
- **Sell:** `chainpe start` puts any HTTP API behind x402 in one command.
- **Rate with a receipt:** after a paid call the client posts its ERC-8004 rating with the
  x402 **settlement tx hash** as `feedbackHash`.
- **Rank by paid reputation:** the indexer reads the canonical Reputation Registry and
  counts a rating only if the cited tx is a successful USDC payment **from the rater to
  that agent's registered payTo**. Reused receipts, self-payments and ratings with no
  receipt are excluded, each with a reason. Scores are weighted by USDC paid, capped per
  receipt and per payer.
- **Spend within a mandate (optional):** an owner funds a PolicyVault and gives the agent
  only a session key. The vault enforces per-call, daily and total caps, expiry, an
  allowlist and revocation on every x402 call (the `chainpe-vault` scheme).

**Example, live on testnet:** agent #2133's paid score comes only from receipt-backed ratings
(check `/services/2133/reputation`: `paid.count` is distinct payers, and every rating counted
cites a real USDC settlement). Agent #2099 has a paid score of **95** (one payer, 0.01 USDC) and a
raw score of **98.33**: the gap is two 100/100 ratings from a wallet that never paid, one
with no receipt and one citing the real buyer's receipt, which already backs the buyer's
own rating.

## How the loop works

```
 Fund ──────► Discover ──────► Pay ──────────► Receipt ────────► Rate ──────────► Rank
 PolicyVault   registry +       x402 v2 exact    settlement tx     ERC-8004 rating   indexer: only
 mandate       paid ranking     USDC on Monad    on Monad          feedbackHash =    receipt-backed
 (optional)    (indexer/SDK)    (or vault spend)                   settlement tx     ratings count
```

1. A provider runs `chainpe start` in front of its API and registers it in the
   ChainPeRegistry, linked to its ERC-8004 agentId (the registry checks that the caller
   owns that agentId).
2. An agent discovers services ranked by paid reputation (indexer API, SDK, or the MCP
   `search_bazaar` tool).
3. It requests the API, gets `402 Payment Required`, signs a USDC authorization, and the
   facilitator settles it on Monad. The API answers `200` with the settlement in
   `PAYMENT-RESPONSE`.
4. The agent posts a rating on the canonical Reputation Registry citing that settlement.
5. The indexer verifies the receipt on-chain and updates the paid score. Ratings without a
   valid receipt stay visible, but do not count.

## Judge guide

Pick any depth. Each step says what you should see.

**1. Two minutes, nothing to install**
1. Open https://chainpemonad.vercel.app. The landing page's *Network Status*
   table reads the hosted indexer and facilitator live.
2. Open **Services**: the four callable demo sellers, ranked by paid reputation. Flip the
   **paid ↔ raw** toggle. The note under the table says how many older demo entries are
   hidden and why; **Show them** reveals them.
3. Open a service page: each rating, whether it counted as paid, and its settlement on
   MonadVision. **Receipts** is the feed of all of them.
4. See the payment wall yourself:
   ```bash
   curl -i https://seller-production-ea9b.up.railway.app/stats
   # HTTP 402, with a PAYMENT-REQUIRED header (base64 x402 v2 offer: exact, 0.001 USDC, eip155:10143)
   curl https://indexer-production-50cd.up.railway.app/services/2133/reputation
   # {"agentId":"2133","paid":{...},"raw":{...}}
   ```

**2. Ten minutes: pay and rate with a throwaway testnet wallet**
```bash
git clone https://github.com/SamyaDeb/chainpe-monad && cd chainpe-monad
npm ci && npm run build
```
Fund a **throwaway** key: MON from https://faucet.monad.xyz and USDC from
https://faucet.circle.com (choose Monad Testnet). Then:
```js
import { ChainPe } from '@chainpemonad/sdk'
const cp = new ChainPe({ privateKey: process.env.KEY, network: 'monad-testnet' })
const res = await cp.pay('https://seller-production-ea9b.up.railway.app/stats') // 402 → sign → settle → 200
await cp.giveFeedback({ agentId: '2133', value: 90, paymentTxHash: res.payment.txHash })
```
Reload the service page (or the receipts feed): your rating appears as **paid**, linked to
your settlement. Rate without paying (or cite someone else's receipt) and it shows as
**excluded**, with the reason. No test credentials are needed; a rating needs a key only
because it is an on-chain transaction.

**3. Claude pays for you (MCP wallet)**: [`docs/DESKTOP-DEMO.md`](docs/DESKTOP-DEMO.md) and
[`docs/quickstart/mcp.md`](docs/quickstart/mcp.md). Build the `.mcpb`, add a throwaway
testnet key and a per-call cap, then ask Claude to find a Monad stats service, pay for one
call, and rate it with the receipt. An offer above your cap is refused before signing.

**4. Mandate mode (PolicyVault inside x402)**: `e2e/monad-vault-demo.mjs` (needs a funded
testnet key). The agent holds only a session key; an over-cap call and a non-allowlisted
call are refused and revert on-chain; after the owner revokes the session, the next call
fails. Transaction links are in [`docs/METROPOLIS.md`](docs/METROPOLIS.md).

**Tests** (all green when last run):

| Suite | Result |
|---|---|
| Contracts (`cd contracts && npm ci && npx hardhat test`) | 84 passing |
| Indexer (`cd services/chainpe-indexer && npm ci && npm test`) | 49 passing |
| Facilitator (`cd services/chainpe-facilitator && npm ci && npm test`) | 53 passing (+17 local-chain settlement tests that need a built Hardhat artifact) |
| SDK, proxy CLI, agent, AI tools, MCP wallet, marketplace (`npm test` at the root) | 175 passing |

## Architecture

```
 Buyer (agent)                     Seller                         Monad (testnet)
 ─────────────                     ──────                         ───────────────
 chainpe-sdk / MCP wallet  ──x402──► chainpe proxy ──► your API
 agent / ai-tools          ◄─402──   (`chainpe start`)
        │ signed USDC auth                 │ verify / settle
        │                                  ▼
        │                          chainpe-facilitator ─────────► USDC transfer (settlement)
        │                                                          PolicyVault.spend (mandate)
        └─ rating, feedbackHash = settlement ─────────────────────► ERC-8004 Reputation (canonical)
                                                                   ChainPeRegistry ↔ ERC-8004 Identity
                                                                          │ events + receipts
 apps/marketplace ◄── REST ── chainpe-indexer (Postgres) ◄────────────────┘
 (landing, paid ↔ raw ranking,  paid / raw scores,
  ratings + receipts)           ratings feed
```

| Path | What it is |
|---|---|
| `contracts/` | ChainPeRegistry (services ↔ ERC-8004 agentIds, ownership-checked) and PolicyVault (spending mandates). Hardhat, UUPS |
| `services/chainpe-facilitator` | x402 v2 verify/settle for Monad: `exact` + `chainpe-vault`, strict payTo policy, serialized settlements; not an open gas relay |
| `services/chainpe-indexer` | registry + canonical ERC-8004 events → Postgres → paid/raw reputation, ratings feed (REST) |
| `packages/chainpe-sdk` | client: pay, discover, rate with receipt, PolicyVault. Monad constants in `networks.ts` |
| `packages/chainpe` | CLI + x402 payment proxy (`chainpe init / start / register / fetch / discover`) |
| `packages/chainpe-wallet` | Claude MCP wallet (`.mcpb`) with persisted spending caps |
| `packages/chainpe-agent`, `packages/chainpe-ai-tools` | LLM agent CLI; Vercel AI SDK + LangChain tools |
| `apps/marketplace` | landing page (the team's Claude Design export, see `design/`), ranking with paid ↔ raw toggle, ratings with receipts, try-it page (Next.js) |
| `examples/` | Monad demo sellers and buyers, latency bench |
| `e2e/` | testnet end-to-end scripts (paid call, reputation demo, mandate demo, full run) |
| `deploy/`, `Dockerfile.seller` | Docker Compose for Postgres + indexer + facilitator; hosted seller image |

## Why Monad

Rating only counts when a payment backs it, so every API call needs a payment and a receipt
inside the agent's request loop. That is only practical if settlement is fast and cheap.
Measured on Monad testnet (from a cloud sandbox, through a proxy):

- **p50 591 ms / p95 755 ms** from `402` to a settled `200` over 30 paid calls through
  Monad's public facilitator; **p50 897 ms** over 20 calls through ChainPe's own facilitator.
- About **137k gas** per `exact` settlement and about **252k** per vault spend, using tight
  gas limits because Monad bills the gas limit.

ChainPe builds on Monad's own stack rather than a copy of it: the canonical ERC-8004
Identity and Reputation registries, Circle USDC, and x402 v2 on `eip155:143` / `eip155:10143`.
It settles through Monad's public facilitator as well as its own, and it handles the public
RPC's ~100-block `getLogs` limit. Details and every number: [`docs/WHY-MONAD.md`](docs/WHY-MONAD.md).

## Testnet deployment

| | Monad testnet (`eip155:10143`) |
|---|---|
| ChainPeRegistry (proxy) | `0xe41CEcC51A61921dDFCeCAa9807856C446867CA4` |
| PolicyVault (proxy) | `0x1Eb25cDD00bCCEC89782Aaf12600Ac5eFeEeAB65` |
| ERC-8004 Identity / Reputation (canonical) | `0x8004A818BFB912233c491871b3d84c89A494BD9e` / `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| USDC | `0x534b2f3A21130d7a60830c2Df862319e593943A3` |
| Hosted demo agents | #2133 `/stats` · #2134 `/quote` · #2135 `/digest` · #2136 `/report` |
| Earlier demo agents | #2099, #2101–#2104, #2107–#2110 (their endpoints only ran inside our build session) |

Both ChainPe contracts are Sourcify-verified on MonadVision. Transaction hashes, run
instructions and the Docker Compose stack: [`docs/DEPLOYMENTS.md`](docs/DEPLOYMENTS.md).
Other docs: [indexer API](docs/INDEXER-API.md) · quickstarts
([provider](docs/quickstart/provider.md) · [consumer](docs/quickstart/consumer.md) ·
[Claude MCP wallet](docs/quickstart/mcp.md)) · [x402 v2 notes](docs/X402-V2-NOTES.md).

## Status and limits

- **Testnet only.** Mainnet contracts, real-USDC calls and paying an external Monad x402
  service are prepared ([`docs/MAINNET-RUNBOOK.md`](docs/MAINNET-RUNBOOK.md),
  `e2e/pay-external.mjs`) but not done. Nothing on this site claims otherwise.
- **No customers or volume yet.** All payments, ratings and agents are team wallets (demo
  traffic). We make no traction claim.
- **Hosting:** the indexer, facilitator and demo sellers run on Railway's free tier and the
  marketplace on Vercel. If one is down, `deploy/docker-compose.yml` runs the backend
  locally (instructions in [`docs/DEPLOYMENTS.md`](docs/DEPLOYMENTS.md)).
- **Paid reputation can still be gamed with money.** A seller who funds fresh wallets to
  pay itself earns "paid" ratings (the money returns to it, minus gas). The per-receipt and
  per-payer caps limit how far that moves a score; funding-provenance checks are future work.
- **Older demo entries** that point at `localhost` are hidden in the marketplace by default
  (display filter only; nothing is deleted on-chain).
- The packages are named `@chainpemonad/*` and are **not published to npm yet**; run them
  from this repo.

## What was built when (prior work and AI disclosure)

ChainPe was first built in June 2026, on Avalanche, before the hackathon window
(2026-09-01 → 2026-10-13). That snapshot (`SamyaDeb/ChainPeAvax@cb3904e`) is the **starting
point only**, and is the first commit in this repository's history. It had the registry and
vault contracts, a v1 x402 facilitator, an indexer, SDK, CLI/proxy, MCP wallet, agent, AI
tools, example sellers and marketing sites. **None of it targeted Monad.**

Built during the hackathon, with every change dated in [`docs/METROPOLIS.md`](docs/METROPOLIS.md):

- the Monad port of all of the above (contracts deployed and verified, network config, x402
  **v2** facilitator, proxy, SDK, MCP wallet, agent, AI tools, indexer);
- the canonical-ERC-8004 ownership check in the registry;
- **payment-backed reputation**: receipts in the SDK and wallet, on-chain receipt
  verification, scoring and exclusion reasons in the indexer, the `paid` / `raw` API;
- **mandate mode**: the PolicyVault as an x402 payment scheme (`chainpe-vault`);
- the marketplace and landing page, hosting, and the Monad seller agents, benchmarks and
  end-to-end scripts.

Full disclosure: [`PRIOR_WORK.md`](PRIOR_WORK.md). **AI tools:** development was assisted by
Claude Code (Anthropic); commits it co-authored carry a `Co-Authored-By: Claude` trailer.

## Contributors

- **Samya Deb** ([@SamyaDeb](https://github.com/SamyaDeb))
- **saxux2** ([@saxux2](https://github.com/saxux2))

## License

[MIT](LICENSE)
