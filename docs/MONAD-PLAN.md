# ChainPe on Monad — phase-by-phase build plan

**Goal:** a Track 4 (Trust, Identity & AI Infrastructure) winning submission for Monad
Metropolis, live on Monad mainnet, submitted before **Tue Oct 13, 11:59 PM ET**
(= Wed Oct 14 09:29 IST). Context and sources: `docs/MONAD-CONTEXT.md`.

---

## The product we are shipping

> **ChainPe — the trust layer for x402 on Monad.**
> Fund an agent with an on-chain spending mandate, let it pay any x402 API in USDC on
> Monad, and rank services by ERC-8004 reputation that **only counts settled payments**.
>
> Tagline: **"No receipt, no rating."**

The loop, end to end on mainnet with standard x402 v2:

```
 Fund ──► Discover ──► Pay ──► Receipt ──► Rate ──► Rank
 (mandate)  (registry,   (x402 v2,  (settlement  (only payers,  (paid reputation
            paid rank)   USDC)      tx hash)     ERC-8004)      feeds discovery)
```

### How we represent it for Monad
- **Primitive, not a marketplace.** Monad already has the API Hub (66 x402 services).
  ChainPe is the trust + spend-control layer *any* x402 seller or agent plugs into.
- **Use Monad's own words:** x402 Foundation (Monad is a governing board member) ·
  "Agent Funding Gap" (our mandate closes it) · canonical ERC-8004 registries on Monad ·
  sub-second settlement (quote **our measured** number only).
- **Show the insight:** Monad's canonical reputation registry is reportedly farmed; ours
  only counts ratings backed by a real settlement. (Recompute the numbers ourselves.)
- **Avoid:** "first/only", payment-volume claims (wash-trading rule), unmeasured speed
  claims, calling it a marketplace.

**"Why Monad" paragraph for the submission form (draft):**
> Pay-per-call agent commerce needs every request to settle before the agent's next
> step. On Monad an x402 USDC payment settles in [measured] ms at a fraction of a cent, so
> a receipt — and a reputation update — can exist for every single call. ChainPe builds on
> Monad's canonical ERC-8004 registries and x402 v2 (`eip155:143`), so any agent or API
> Hub seller on Monad can adopt it without migrating.

---

## Ground rules for every phase

1. **Port, don't import.** The Avalanche code lives in `legacy/` (git-ignored). Copy a
   module in, adapt it to Monad in the same change, then commit with a message that
   says `port …`. Never commit unported Avalanche code.
2. **Log it.** Every meaningful change gets a dated line in `docs/METROPOLIS.md`.
3. **Monad only.** Networks are `monad` (143) and `monad-testnet` (10143). No Avalanche,
   Fuji, AVAX, Snowtrace, ICM or Teleporter anywhere in ported code.
4. **x402 v2 only** (`@x402/*@2.28.x`). The v1 `x402*` packages cannot target Monad.
5. **Testnet first, mainnet in Phase 6.** Default network in code: `monad-testnet`.
6. **No fake traction.** Demo-agent payments are labelled as demo traffic, always.
7. **Constants live in one place:** `packages/chainpe-sdk/src/networks.ts` (services that
   deploy separately keep a copy and must match it — see the table in `CLAUDE.md`).

---

## Schedule at a glance

| Phase | When (2026) | Outcome | Cuttable? |
|---|---|---|---|
| 0 Setup & eligibility | Fri Oct 9 night | Repo, docs, wallets, portal registration | No |
| 1 Chain foundation | Sat Oct 10 AM | Contracts on Monad testnet | No |
| 2 Payments on x402 v2 | Sat Oct 10 | First testnet x402 payment settles | No |
| 3 Agent clients | Sat night–Sun AM | Claude MCP wallet pays on testnet | Partly |
| 4 Payment-backed reputation | Sun Oct 11 | "No receipt, no rating" works | **No (headline)** |
| 5 Mandate mode | Sun Oct 11 night | PolicyVault enforces caps inside x402 | **Yes, first cut** |
| 6 Mainnet + ecosystem | Mon Oct 12 | Real USDC loop + external x402 service paid | No |
| 7 Product surface | Mon Oct 12 evening | Marketplace page + docs | Polish is cuttable |
| 8 Submission | Tue Oct 13 | Videos, README, submitted by 18:00 ET | No |

If two people: **Builder A** — Phases 1, 2 (facilitator), 4, 5 (contracts/backend).
**Builder B** — Phases 2 (SDK/proxy), 3, 6 (agents), 7, 8 (product/video).

---

## Phase 0 — Setup & eligibility (Fri Oct 9, tonight)

**Steps**
1. ✅ Create `SamyaDeb/chainpe-monad`; keep the Avalanche snapshot in `legacy/`
   (git-ignored); write `PRIOR_WORK.md`, `docs/MONAD-CONTEXT.md`, this plan, `CLAUDE.md`.
2. Register on the Metropolis portal; choose **Track 4**. Read the official rules and
   confirm every `likely` item in `MONAD-CONTEXT.md` §1 (deadline, deliverables, the
   "substantial majority" wording, open-source requirement, bounty eligibility).
3. Create fresh keys (never reuse Avalanche keys):
   `DEPLOYER` (contract owner), `FACILITATOR` (gas), `BUYER` (agent), `SELLER_1..3`.
4. Fund testnet: MON from `https://faucet.monad.xyz`, testnet USDC
   (`0x534b…43A3`; find the faucet — Circle's faucet may list Monad testnet).
5. Plan mainnet funding for Phase 6: ~25 MON for DEPLOYER + FACILITATOR (keep each
   gas key **above the 10 MON reserve balance**) and ~10 USDC for BUYER.
6. Decide: npm scope for the Monad packages (keep `@chainpeavax/*` or publish a new
   scope) and the product name (default: ChainPe).
7. Monorepo skeleton: root `package.json` (workspaces `packages/*`), `tsconfig.json`,
   `.env.example` with Monad variables, `.nvmrc` (Node 22).

**Done when:** repo pushed with docs + skeleton; portal registration done.

---

## Phase 1 — Chain foundation: config + contracts (Sat Oct 10, morning)

**Steps**
1. **Network config** — create `packages/chainpe-sdk/src/networks.ts` with the Monad
   table from `CLAUDE.md` (chain ids, CAIP-2 ids, RPCs, USDC, explorers, canonical
   ERC-8004 addresses, `viem/chains` `monad` / `monadTestnet`).
2. **Port `contracts/`** from `legacy/contracts`, leaving out:
   `contracts/icm/*`, `scripts/deploy-icm.ts`, `scripts/configure-icm.ts`,
   `test/ChainPeICM.test.ts`, `test/E2E.mainnet-fork.test.ts` (Avalanche fork),
   all `deployments/*.json`, and `scripts/deploy-erc8004.ts` usage (Monad has the
   canonical registries; keep the vendored ERC-8004 sources only for tests).
3. **`hardhat.config.ts`** — networks `monadTestnet` (10143, `MONAD_TESTNET_RPC_URL`)
   and `monad` (143, `MONAD_RPC_URL`); verification via Monadscan (Etherscan v2 API,
   chain 143) or Sourcify/MonadVision — check which works; remove Snowtrace/Routescan.
4. **Registry hardening** (`ChainPeRegistryUpgradeable.sol`): in `register` and
   `update`, when `agentId != 0 && identityRegistry != 0`, require the caller is the
   owner of / approved for that agentId on the ERC-721 identity registry
   (`ownerOf`, `getApproved`, `isApprovedForAll`). New error `NotAgentOwner`.
   Document that agentId `0` means "unlinked" (canonical agent #0 cannot be linked).
5. **Tests** — add: linking someone else's agentId reverts; own agentId works; agentId 0
   works. Keep the existing registry and PolicyVault suites green.
   *(Cloud sandbox can't download solc — run `npx hardhat test` locally.)*
6. **Deploy scripts** (`deploy.ts`, `deploy-policyvault.ts`): default USDC for 143/10143;
   `IDENTITY_REGISTRY` defaults to the canonical Identity Registry per chain;
   registration fee from env (**recommend 0** during the hackathon to invite adoption);
   keep the mainnet "refuse deployer-EOA owner" guard (use a Safe if Safe is live on
   Monad, else `ALLOW_DEPLOYER_OWNER=true` and disclose it).
7. Deploy Registry + PolicyVault to **Monad testnet**; save
   `contracts/deployments/monad-testnet*.json`; verify on the explorer.

**Status (Oct 9):** steps 1–6 done (84 contract tests green, scripts smoke-tested on
Hardhat). Step 7 (testnet deploy + verify) needs a funded key and RPC access, so it runs
on a developer machine: `npm run preflight:testnet && npm run deploy:testnet &&
npm run deploy:policyvault:testnet && npm run postcheck:testnet && npm run verify:testnet`.

**Done when:** contracts verified on Monad testnet, tests green.
**Commit:** `port contracts to Monad: networks, canonical ERC-8004 owner check, drop ICM`.

---

## Phase 2 — Payments on x402 v2 (Sat Oct 10)

**Steps**
1. **Learn the v2 API (≤45 min).** Read the type definitions of `@x402/core`,
   `@x402/evm` (`/exact/client`, `/exact/server`, `/exact/facilitator`), `@x402/express`,
   `@x402/fetch`. Record in `docs/X402-V2-NOTES.md`: request/response header names and
   payload shape for v2, how schemes and networks are registered, how to point a server
   at a custom facilitator URL, and what the settle response contains (tx hash).
2. **Port the facilitator** (`services/chainpe-facilitator`):
   - v2 `exact` facilitator for `eip155:143` / `eip155:10143` (one instance per `NETWORK`);
     `/supported` in v2 format; keep `/health`, `/status`, `/metrics`.
   - Hardening: `app.set('trust proxy', 1)`; only settle to registered `payTo`
     addresses (refresh from the indexer/registry every 60 s) and above `MIN_AMOUNT`;
     **serialize settlements** (one in-flight tx per gas key — avoids nonce races);
     explicit, tight gas limit (Monad bills the limit); low-gas alarm measured in MON and
     aware of the 10 MON reserve.
   - Fix the legacy test (`verify_error` vs `verify_failed`); Dockerfile uses `npm ci`.
3. **Port the payment proxy / CLI** (`packages/chainpe`): `chains.ts` → Monad;
   `proxy/server.ts` → `@x402/express` v2 middleware; `proxy/localFacilitator.ts` → v2;
   keep the `X-CHAINPE-AGENT-ID` header and expose the v2 payment-response header via
   CORS; `wallet-connect-browser.ts` → `wallet_addEthereumChain` params for Monad
   (chainId `0x8f` / `0x279f`, MON, RPC, MonadVision).
4. **Port the SDK** (`packages/chainpe-sdk`): `ChainPeNetwork = 'monad' | 'monad-testnet'`
   (default `monad-testnet`); `execute()` → v2 client flow; **reject** offers whose
   scheme isn't `exact`, whose network ≠ ours, whose `asset` ≠ USDC for the network, or
   whose amount > `maxPerCall`; decode the settlement → `payment.txHash`; tests.
5. **E2E on testnet** — `e2e/monad-testnet.mjs`: start `examples/weather-api` behind the
   proxy → SDK pays → 200 → print tx link + latency.
6. **Interop check** — the same seller settles through Monad's facilitator
   (`x402-facilitator.molandak.org`) too.

**Status (Oct 9):** steps 1–4 done. Proven here: a real x402 v2 round trip (backend → proxy →
SDK) and real on-chain settlement on a local chain (USDC moves, replays refused, concurrent
settlements OK). Remaining, needs Monad network access: run `e2e/monad-paid-call.mjs` on
testnet and confirm interop with Monad's public facilitator (steps 5–6).

**Done when:** a real testnet x402 payment settles end-to-end and prints a MonadVision link.
**Commits:** `port facilitator to x402 v2 on Monad (+ hardening)`,
`port payment proxy to x402 v2 on Monad`, `port SDK to Monad + x402 v2`.

---

## Phase 3 — Agent clients (Sat night → Sun morning)

**Steps**
1. **MCP wallet** (`packages/chainpe-wallet`): route `x402_fetch` and `pay` through the
   SDK (delete the duplicated x402 flow); config/types → Monad; `transfer_avax` →
   **`transfer_mon`**; `check_balance` shows MON + USDC; `request_funding` links the
   Monad faucets; **persist the budget** to `~/.chainpe/spending.json` (no more
   in-memory reset); `give_feedback` requires a payment receipt (Phase 4);
   `manifest.json` + tests.
2. **Agent CLI** (`packages/chainpe-agent`): payments via the SDK; config/wallet/
   registry/reputation → Monad. Optional: a Qwen provider (Qwen credit pool goes to
   agentic Track 4 winners).
3. **AI tools** (`packages/chainpe-ai-tools`): network types, README examples.

**Status (Oct 9):** steps 1–3 done; all three packages build, typecheck and test in the root
workspace (wallet 49, agent 17, ai-tools 10 tests). The MCP wallet serves the 9 tools over stdio
(also from the packed `.mcpb`). `x402_fetch`/`pay`/agent/ai-tools all pay through the SDK, and
tests against a real x402 v2 server prove it refuses over-cap, non-USDC and wrong-network
offers. The budget persists in `~/.chainpe/spending.json` across restarts. Still open: the
receipt requirement on `give_feedback` (Phase 4). The done-criterion (Claude Desktop paying a
**testnet** service) needs the Phase 1 step 7 registry deploy, a funded wallet and a running
facilitator + seller.

**Done when:** Claude Desktop (MCP) pays a testnet ChainPe service and shows the tx link.
**Commits:** one `port … to Monad` commit per package.

---

## Phase 4 — Payment-backed reputation (Sun Oct 11) — the headline

**Design**
- **Receipt.** After a settled payment, the payer posts ERC-8004 feedback on the
  *canonical* Reputation Registry:
  `giveFeedback(agentId, value 0–100, decimals 0, tag1 "x402", tag2 "paid-call",
  endpoint, feedbackURI "x402:eip155:143:<txHash>", feedbackHash = <settlement txHash>)`.
  The settlement tx hash is 32 bytes, so it fits `feedbackHash` exactly.
- **Verification (indexer).** A feedback is *paid* only if its `feedbackHash` is a
  settlement tx whose receipt contains a USDC `Transfer(from = feedback client,
  to = payTo of a registered service linked to that agentId, value ≥ MIN)`.
  Each settlement tx backs at most one feedback. Self-dealing is excluded
  (payer = service developer, payTo, agent owner or agentWallet).
- **Scoring.** `paidScore` = weighted mean of values clamped to 0–100 over verified
  feedback; weight per receipt = `min(amount, CAP)`; any single payer contributes at most
  `PAYER_SHARE_CAP` (e.g. 25%) of total weight. `count` = distinct verified payers.
  Keep `rawScore` for the side-by-side comparison.

**Steps**
1. SDK: `giveFeedback({ agentId, value, paymentTxHash })` builds the receipt fields;
   `autoFeedback` passes the settlement hash. MCP `give_feedback` refuses without one.
2. **Port the indexer** (`services/chainpe-indexer`): Monad config (canonical Reputation
   default, registry from env, `START_BLOCK` = registry deploy block, `LOG_CHUNK=100`
   for the public RPC); schema — `value NUMERIC` (fixes the poison pill),
   `feedback_hash`, `feedback_uri`, `endpoint`, `paid_verified`, `paid_amount`, `payer`;
   try/catch on every route; `trust proxy`.
3. Verification worker (step above) + scoring in `core.ts` with unit tests: a 1e30 value
   doesn't crash or dominate; unpaid feedback never enters `paid`; self-payment ignored;
   one payer can't exceed the cap.
4. API: `GET /services?rank=paid` (default) | `raw`;
   `GET /services/:id/reputation` → `{ paid: {score,count,volume}, raw: {score,count} }`.
5. **Envio decision.** If we backfill canonical Reputation history (since Feb 2026) for
   the "farmed registry" comparison, use Envio HyperIndex/HyperSync (also the $1K Envio
   bounty). Otherwise the polling indexer from the registry deploy block is enough.
   Recommended: Envio for `NewFeedback`/`FeedbackRevoked` + registry events.
6. **Farm analysis script** (`scripts/farm-report.mjs`): reproduce the "agent #182"
   numbers from chain data. Only numbers we computed go in the demo.
7. *(Bounty, optional)* Nansen provenance filter: exclude payers whose first funder is
   the agent owner; pay Nansen per call over x402 **with our own SDK**.

**Done when:** an unpaid rating shows in `raw` but not `paid`; a receipt-backed rating
moves the `paid` ranking; the indexer survives a 1e30 value.
**Commits:** `payment-backed reputation: receipts in SDK + MCP`,
`port indexer to Monad + paid-reputation verification`.

---

## Phase 5 — Mandate mode: PolicyVault inside x402 (Sun night) — first to cut

**Design:** a ChainPe x402 scheme `chainpe-vault` on Monad. Payload
`{owner, to, amount, nonce, deadline, signature}` (the PolicyVault EIP-712 `Spend`).
Facilitator **verify** = recovered signer is the policy's session key and
`previewSpend(owner, to, amount)` passes; **settle** = `PolicyVault.spend(...)`, which pays
the seller straight from the vault, so per-call / daily / total caps and the allowlist are
enforced by the contract on every call.

**Steps**
1. Confirm `@x402/core` lets us register a custom scheme (client, server, facilitator).
2. Implement the scheme in the facilitator, the proxy (advertise `exact` **and**
   `chainpe-vault`) and the SDK (prefer the vault when configured with
   `{ vaultAddress, owner }`).
3. Indexer accepts `PolicyVault.Spent(owner, to, amount, relayer, nonce)` as a receipt.
4. Demo: an over-cap and a non-allowlisted call revert on-chain; the owner revokes the
   session and the agent can't pay.

**Fallback if cut:** demo PolicyVault standalone (`examples/policy-vault`) and keep the
persisted client-side budget from Phase 3.
**Commit:** `mandate mode: PolicyVault as an x402 payment scheme`.

---

## Phase 6 — Mainnet launch + ecosystem integration (Mon Oct 12)

**Steps**
1. Deploy Registry + PolicyVault to **Monad mainnet**; verify; save
   `contracts/deployments/monad*.json`.
2. Deploy the facilitator (Railway, `NETWORK=monad`) and the indexer (Railway + Postgres,
   or Envio hosted). Fund the gas key above the reserve.
3. **Seller agents** (`examples/seller-agents`, port with Monad themes): mint agentIds on
   the canonical Identity Registry and register 3–4 services behind `chainpe start`, e.g.
   Monad network stats, MON price / DEX quotes, Monad ecosystem news digest, and an
   "agent trust report" that sells our paid-reputation data.
4. **Buyer:** Claude via the MCP wallet + the orchestrator agent, paying real USDC and
   posting receipt-backed feedback.
5. **Traction:** pay at least one *existing* Monad x402 service (API Hub / Nansen / Proof
   of Reason) with the SDK and keep the tx hashes. Contact 2–3 Metropolis teams
   (MonadTrust, Headwater, prooflines, monapi) offering our paid-reputation API or a
   registry listing — one real integration is worth 20% of the score.
6. **Benchmark** (`examples/monad-bench`): N paid calls, report p50/p95 of
   402 → settled → 200.

**Done when:** ≥10 real mainnet paid calls with receipts (labelled demo traffic), ≥1
external x402 service paid, latency measured.

---

## Phase 7 — Product surface (Mon Oct 12, evening)

**Steps**
1. `apps/marketplace` (Next.js, new): services ranked by paid reputation with a
   **raw ↔ paid** toggle; service detail with receipts; live receipts feed with
   MonadVision links; a judge-friendly "try it" path on testnet.
2. Docs: `README.md` (Monad), `docs/WHY-MONAD.md`, `docs/DEPLOYMENTS.md`, quickstarts
   (provider: 1 command; consumer: 3 lines; MCP install), indexer API reference.
3. Do **not** port: the generated Docusaurus HTML, the Avalanche marketing/landing sites,
   ICM docs, `WHY-AVALANCHE.md`.

---

## Phase 8 — Submission (Tue Oct 13)

| Time (ET) | Time (IST) | Step |
|---|---|---|
| 12:00 | 21:30 | **Code freeze** |
| 12:00–15:00 | 21:30–00:30 | README final: pitch, why Monad, architecture, addresses + tx hashes, judge guide + test credentials, prior-work + AI disclosure, `METROPOLIS.md` log |
| 15:00–17:00 | 00:30–02:30 | Record demo video (≤3 min, live product) + pitch video (≤2 min); logo ≤3 MB |
| by 18:00 | by 03:30 (Wed) | **Submit**: Track 4 + bounties (Envio, Nansen, Privy if built); share repo with `metropolis@hackathon.monad.xyz` |
| 23:59 | 09:29 (Wed) | Hard deadline |

### Demo video (≤ 3 min, live product only)
1. **0:00–0:15** Hook: the canonical registry's top agent and its farmed ratings
   (our computed numbers).
2. **0:15–0:45** Owner funds a mandate (e.g. 5 USDC, $0.05/call, $1/day) — tx on MonadVision.
3. **0:45–1:30** Claude (MCP) discovers services ranked by paid reputation, pays,
   gets a 200 — on-screen timer + receipt link.
4. **1:30–2:00** The rating lands, ranking updates; an unpaid wallet's rating is ignored;
   an over-cap payment reverts.
5. **2:00–2:30** Seller side: `chainpe start` puts an existing API behind x402 in one command.
6. **2:30–3:00** The same SDK pays a live Monad x402 service; close on addresses.

### Pitch video (≤ 2 min)
Problem (agent funding gap + fake reputation) → what ChainPe is (one sentence) → why us
(shipped real-USDC agent payments + 4 npm packages before, disclosed) → who adopts it
(API Hub sellers, agent frameworks, trust auditors) → business model (settlement fee
bps / listing fee / premium reputation API) → ask.

---

## Cut list (in order) and never-cut list

**Cut in this order if behind:** Privy integration → Phase 5 mandate mode → Nansen
filter → agent CLI + AI-tools ports → Envio backfill (keep polling indexer) →
marketplace polish.

**Never cut:** a real mainnet paid call · payment-backed reputation · the disclosure
(`PRIOR_WORK.md`, AI tools) · the demo video.

## Top risks

| Risk | Mitigation |
|---|---|
| Six-week rule ("substantial majority" in-window) | Full disclosure; port-not-import history; large volume of new work (x402 v2, reputation, mandate, indexer, marketplace, mainnet) |
| Xorv / Leash outshine us | Win on mainnet + real USDC + standard x402 + the full loop + discovery |
| x402 v2 API surprises | Phase 2 step 1 first; fallback `ExactEvmSchemeV1` keeps the old wire format |
| Monad RPC limits (`getLogs` ~100 blocks) | `LOG_CHUNK=100`, start at deploy block, or Envio HyperSync; paid RPC (Alchemy credits) |
| Self-dealing still games paid reputation | Per-payer cap, self-payment exclusion, optional provenance filter — say so openly |
| Gas/nonce issues in the facilitator | Serialized settlements, tight gas limit, reserve-aware funding |
| Unverified numbers in the pitch | Only quote what we measured or computed |

## Open questions to verify early
- Official rules: exact deadline, open-source requirement, "substantial majority" text.
- ERC-8004 canonical addresses on **Monad testnet**.
- Monad testnet USDC faucet.
- Contract verification endpoint for Monad (Monadscan API vs Sourcify).
- Whether Safe is deployed on Monad (for the contract owner).
- `@x402/core` custom-scheme extensibility (Phase 5).
- Privy x402 support on Monad (only if attempting the Privy bounty).
