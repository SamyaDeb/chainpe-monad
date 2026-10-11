# ChainPe on Monad

**The trust layer for x402 on Monad.** Let an AI agent pay any x402 API in USDC on Monad,
within an on-chain spending mandate, and rank services by ERC-8004 reputation that only
counts ratings backed by a settled payment.

> **No receipt, no rating.**

Built for Monad Metropolis, Track 4 (Trust, Identity & AI Infrastructure). Live on
**Monad testnet**; mainnet is not deployed yet. All payments and ratings shown anywhere
in this repo are demo traffic from team wallets, not traction.

| | |
|---|---|
| Judge guide | [below](#judge-guide-10-minutes-testnet) · in the app: `/try` |
| Testnet addresses + demo agents | [`docs/DEPLOYMENTS.md`](docs/DEPLOYMENTS.md) |
| Why Monad (measured numbers) | [`docs/WHY-MONAD.md`](docs/WHY-MONAD.md) |
| Quickstarts | [provider](docs/quickstart/provider.md) · [consumer](docs/quickstart/consumer.md) · [Claude MCP wallet](docs/quickstart/mcp.md) |
| Indexer API | [`docs/INDEXER-API.md`](docs/INDEXER-API.md) |
| Built during Metropolis (dated log) | [`docs/METROPOLIS.md`](docs/METROPOLIS.md) |
| Prior work & AI disclosure | [`PRIOR_WORK.md`](PRIOR_WORK.md) |
| Build plan · research context | [`docs/MONAD-PLAN.md`](docs/MONAD-PLAN.md) · [`docs/MONAD-CONTEXT.md`](docs/MONAD-CONTEXT.md) |

## The problem

Agents are starting to pay for APIs per call with x402. To choose a service they need
reputation, and Monad has canonical ERC-8004 registries for it. But anyone can post a
rating: a fresh wallet that never used a service can give it 100/100, as many times as it
likes. A raw average of those ratings can be bought for the price of gas.

## What ChainPe does

ChainPe is not another marketplace. It is a layer any x402 seller or agent on Monad can
plug into:

- **Pay:** an SDK, CLI, Claude MCP wallet and agent tools that pay x402 v2 `exact` USDC
  offers on Monad, with per-call and daily caps checked before signing.
- **Sell:** `chainpe start` puts any HTTP API behind x402 in one command.
- **Rate with a receipt:** after a paid call the client posts its ERC-8004 rating with the
  x402 **settlement tx hash** as `feedbackHash`.
- **Rank by paid reputation:** the ChainPe indexer reads the canonical Reputation Registry
  and counts a rating only if the cited tx is a successful USDC payment **from the rater
  to that agent's registered payTo**. Reused receipts, self-payments and ratings with no
  receipt are excluded, each with a reason. Paid scores are weighted by USDC paid, capped
  per receipt and per payer.
- **Spend within a mandate (optional):** an owner funds a PolicyVault and gives the agent
  only a session key; the vault enforces per-call, daily and total caps, expiry and a
  recipient allowlist on every x402 call (`chainpe-vault` scheme).

Example on testnet: agent **#2099** has a paid score of **95** (one payer, 0.01 USDC) and a
raw score of **98.33**. The difference is two 100/100 ratings from a wallet that never
paid: one cited no receipt, the other cited the real buyer's receipt, which already backs
the buyer's rating.

## How the loop works

```
 Fund ──────► Discover ──────► Pay ──────────► Receipt ────────► Rate ──────────► Rank
 PolicyVault   registry +       x402 v2 exact    settlement tx     ERC-8004 rating   indexer: only
 mandate       paid ranking     USDC on Monad    on Monad          feedbackHash =    receipt-backed
 (optional)    (indexer/SDK)    (or vault spend)                   settlement tx     ratings count
```

1. A provider runs `chainpe start` in front of its API and registers it in the
   ChainPeRegistry, linked to its ERC-8004 agentId (the registry checks ownership).
2. An agent discovers services ranked by paid reputation (indexer API, SDK or MCP
   `search_bazaar`).
3. It requests the API, gets `402 Payment Required`, signs a USDC authorization, and the
   facilitator settles it on Monad; the API answers `200` with the settlement in
   `PAYMENT-RESPONSE`.
4. The agent posts a rating on the canonical Reputation Registry citing that settlement.
5. The indexer verifies the receipt on-chain and updates the paid score; ratings without a
   valid receipt stay visible but don't count.

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
 (paid ↔ raw ranking,          paid / raw scores,
  ratings + receipts)          ratings feed
```


| Path | What it is |
|---|---|
| `contracts/` | ChainPeRegistry (services ↔ ERC-8004 agentIds) and PolicyVault (spending mandates), Hardhat, UUPS |
| `services/chainpe-facilitator` | x402 v2 verify/settle for Monad: `exact` + `chainpe-vault`, payTo policy, not an open gas relay |
| `services/chainpe-indexer` | registry + canonical ERC-8004 events → Postgres → paid/raw reputation, ratings feed (REST) |
| `packages/chainpe-sdk` | client: pay, discover, rate with receipt, PolicyVault; Monad constants in `networks.ts` |
| `packages/chainpe` | CLI + x402 payment proxy (`chainpe init / start / register / fetch / discover`) |
| `packages/chainpe-wallet` | Claude MCP wallet (`.mcpb`) with spending caps |
| `packages/chainpe-agent`, `packages/chainpe-ai-tools` | LLM agent CLI; Vercel AI SDK + LangChain tools |
| `apps/marketplace` | services ranked by paid reputation, paid ↔ raw toggle, ratings with receipts, try-it page |
| `examples/` | Monad seller agents + buyers, latency bench |
| `e2e/` | testnet end-to-end scripts (paid call, reputation demo, mandate demo, full Phase 6 run) |
| `deploy/` | Docker Compose for Postgres + indexer + facilitator |

## Testnet deployment

| | Monad testnet (`eip155:10143`) |
|---|---|
| ChainPeRegistry | `0xe41CEcC51A61921dDFCeCAa9807856C446867CA4` |
| PolicyVault | `0x1Eb25cDD00bCCEC89782Aaf12600Ac5eFeEeAB65` |
| ERC-8004 Identity / Reputation (canonical) | `0x8004A818BFB912233c491871b3d84c89A494BD9e` / `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| USDC | `0x534b2f3A21130d7a60830c2Df862319e593943A3` |
| Demo agents | #2099, #2101–#2104, #2107–#2110 |
| Explorer | https://testnet.monadvision.com |

Details, transaction hashes and how to run the backend: [`docs/DEPLOYMENTS.md`](docs/DEPLOYMENTS.md).

Measured on testnet (from a cloud sandbox, via a proxy): one paid call, 402 → settled →
200, **p50 591 ms / p95 755 ms** over 30 calls through Monad's public facilitator, and
**p50 897 ms** over 20 calls through ChainPe's own (one 3.98 s outlier). See
[`docs/WHY-MONAD.md`](docs/WHY-MONAD.md).

## Judge guide (10 minutes, testnet)

Everything runs locally; no keys needed to look, a throwaway testnet key to pay.

```bash
git clone https://github.com/SamyaDeb/chainpe-monad && cd chainpe-monad
npm ci && npm run build

# See the ranking — the marketplace on the committed snapshot of the testnet indexer
npm run start -w @chainpemonad/marketplace            # http://localhost:3000
```

1. **Home:** services ranked by paid reputation. Flip the **paid ↔ raw** toggle and watch
   #2099 go from 95 to 98.33.
2. **#2099's page:** its three ratings, the paid one linked to its settlement on
   MonadVision, the two excluded ones with their reasons.
3. **Receipts:** every paid call and rating for ChainPe agents, linked to MonadVision.
4. **Live data:** run the indexer against Monad testnet ([no keys](docs/DEPLOYMENTS.md#run-only-the-indexer-no-keys))
   and restart the marketplace with `NEXT_PUBLIC_CHAINPE_INDEXER_URL=http://localhost:4600`.
   The badge switches from "Snapshot of …" to "Live from the ChainPe indexer · block N".
5. **Pay and rate yourself:** MON from https://faucet.monad.xyz, USDC from
   https://faucet.circle.com (Monad Testnet), then follow `/try` in the app: start a
   provider (`chainpe start`), pay it in three lines of SDK (or from Claude via the MCP
   wallet), rate it, and see your rating counted as paid. Rate without paying and it
   shows up as excluded.

Tests: `npm test` (workspaces), `cd services/chainpe-indexer && npm ci && npm test`,
`cd services/chainpe-facilitator && npm ci && npm test`, `cd contracts && npm ci && npx hardhat test`.

## Status and limits

- Testnet only. Mainnet contracts, real-USDC calls and paying an external Monad x402
  service are prepared (`docs/MAINNET-RUNBOOK.md`, `e2e/pay-external.mjs`) but not done.
- The indexer, facilitator and one demo seller are hosted on Railway (testnet, URLs in `docs/DEPLOYMENTS.md`); the marketplace is at https://chainpe-monad-marketplace.vercel.app.
- A seller who funds fresh wallets to pay itself still earns "paid" ratings (the money
  returns to it, minus gas). The per-receipt and per-payer caps limit how far that moves
  a score; funding-provenance checks are future work.
- The Monad packages are named `@chainpemonad/*` and are not published to npm yet; the Monad builds run
  from this repo.

## Prior work and AI disclosure

ChainPe on Monad is a port and extension of ChainPe, first built in June 2026 before the
hackathon. Pre-existing code is brought in module by module as it is ported to Monad
(commits say `port …`); everything else is new work logged in
[`docs/METROPOLIS.md`](docs/METROPOLIS.md). Full disclosure: [`PRIOR_WORK.md`](PRIOR_WORK.md).
Development is assisted by Claude Code (Anthropic); commits it co-authored carry a
`Co-Authored-By: Claude` trailer.

## Contributors

- **Samya Deb** ([@SamyaDeb](https://github.com/SamyaDeb))
- **saxux2** ([@saxux2](https://github.com/saxux2))

## License

[MIT](LICENSE)
