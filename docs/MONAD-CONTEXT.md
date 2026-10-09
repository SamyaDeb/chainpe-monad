# ChainPe on Monad — research context

Everything we know that shapes the Monad build: the hackathon, the judges, the
competition, and the Monad technical facts. Collected 2026-10-09.

**Confidence labels.** `verified` = checked directly (npm package contents, on-disk
code, official post text). `likely` = consistent across several independent sources,
mostly other teams' captures of the login-gated hackathon portal. `unverified` = a
single secondary source. **Re-check every `likely` item in the portal before relying
on it.**

---

## 1. Hackathon: Monad Metropolis

| | |
|---|---|
| Build window | 2026-09-01 → 2026-10-13 |
| Submission deadline | **Tue Oct 13, 11:59 PM ET** = Wed Oct 14 03:59 UTC = **Wed Oct 14 09:29 IST** (`likely`) |
| Judging / winners | Oct 14–27 / Nov 3 (`likely`) |
| Format | Online, global, teams of 1–5, one project per person, one track per project (`likely`) |

### Tracks and prizes (`likely`)
1. Onchain Finance & Trading
2. Consumer Products & Payments
3. Social, Attention & Culture
4. **Trust, Identity & AI Infrastructure** ← ChainPe's track

Each track: **$30K split evenly between 3 teams ($10K each)**. Grand Champion **$25K**
across all tracks. Sponsor bounties stack on top of the track prize; track-locked
bounties only pair with their track. Top teams are invited to a residency.

### Track 4 framing (`likely`, portal capture)
"Protocol-level primitives for trust, provenance, and user-owned data." Best fit: the
primary output is a **protocol, primitive or infrastructure layer other apps build on**,
not a standalone consumer product. Named Monad building blocks: P256 precompile
(WebAuthn/passkeys), **ERC-8004 as a first-class trustless agent registry**, BTX
encrypted mempools. The public marketing page names "agent identity and reputation under
ERC-8004".

### Rubrics — plan for both (`likely`)
**Track 4 page rubric**

| Criterion | Weight | Guiding question |
|---|---|---|
| Founder & Market Readiness | 25% | Which apps/devs adopt this primitive, and why wouldn't they build it themselves? |
| Technical Execution | 20% | Is the primitive implemented correctly and securely? |
| Design & Craft | 20% | Can developers build on it — docs, clean API (DX, not visuals) |
| Traction & Path Forward | 20% | Evidence of developer interest — "even one other team integrating during the hackathon" |
| Originality & Track Insight | 15% | Privacy-preserving, not capturable by a single platform |

**Rules §5.2:** Product Quality & Completeness, Technical Excellence, **Monad
Integration**, Track Fit & Problem Relevance, Innovation & Impact — 20% each.
**Sponsor bounties:** requirements 40%, technical 30%, Monad integration 20%, innovation 10%.

### Required deliverables (`likely`)
- Public, OSI-licensed GitHub repo, shared with `metropolis@hackathon.monad.xyz`
- **Technical demo video ≤ 3 min** (YouTube/Loom/Vimeo) showing the *live working
  product* — no slides, no code walkthrough
- **Pitch video ≤ 2 min** (team, problem, why you)
- Logo ≤ 3 MB
- Live product link (mainnet or testnet) with judge instructions + test credentials
- Contract addresses / tx hashes + a "why Monad" explanation
- Optional 30-second ad (not judged)

### Rules that matter for ChainPe (`likely`)
- "The **substantial majority** of the work" must be built in the window and the commit
  history must cover it. Pre-existing code may be a foundation **only if identified in
  the README**. → see `PRIOR_WORK.md`.
- **AI coding tools must be disclosed** in the README.
- **Wash trading or fake volume is grounds for disqualification.** Payments between our
  own demo agents must never be presented as traction.
- Submissions are non-confidential.

### Judges (`likely`)
Main-track panel is VC-heavy: Paradigm, Dragonfly, Pantera, Electric Capital, Galaxy,
CoinFund, IOSG, Castle Island, Prelude — plus Keone Hon, Eunice Giarta, Tina Qi (Monad
Foundation), Alex Svanevik (Nansen CEO), Ajit Tripathi (Eigen), Max Tang (Auros), Zeel
Patel (Layer3). Bounty judges include Envio's founder, Alchemy, Dynamic, Category Labs
(Mera). Spotlighted judge (`verified`): Francesco Andreoli, MetaMask DevRel — "agentic
wallets, scoped delegation… trust boundaries between AI agents and money".

### Sponsor bounties relevant to ChainPe (`likely`)

| Bounty | Prize | Scope | Fit |
|---|---|---|---|
| Best Use of **Envio** | $1K | all tracks | HyperIndex/HyperSync powering a core feature → our indexer |
| Best Use of **Nansen** | $5K pool (2K/1.5K/1K/500) | all tracks | product on Nansen data "beyond raw data" → payer-provenance filter for reputation |
| **Privy** | $5K | all tracks | "beyond authentication" → server wallet + policy engine for the MCP buyer. Conflicting reports on Privy x402 Monad support — verify |
| Dynamic | $5K | all tracks | agent wallets / signing (alternative to Privy) |
| Chainlink CRE | $3K | all tracks | stretch only |
| Qwen credits | $5K credits | top-3 Track 4 | auto if agentic with Qwen |
| MetaMask Agent Wallet plugin | $2.5K | **Track 1 only** | not eligible |
| Agora (×2) | $10K each | Tracks 1/2 | not a fit |

---

## 2. What Monad is championing now

- Monad Foundation joined the **x402 Foundation as a governing board member** (2026-06-29)
  alongside Stripe, Visa, Mastercard, Google, Cloudflare. Message: speed and low fees are
  the baseline; what matters is what happens to value after it arrives. (`likely`)
- Blog "The Rise of the Machine Economy": 8,000+ agents on Monad; an **"Agent Funding
  Gap"** section — agents can spend via x402, but getting funded safely is the hard part.
  (`likely`)
- **Monad API Hub** (~Sep 8 2026, apihub.run): 66 x402 USDC data services incl. 83 Nansen
  endpoints, $0.01–$7.50/call, settled through the Monad x402 facilitator. → "x402
  marketplace" is **taken**; we position as the trust layer *for* it. (`likely`)
- Nansen accepts x402 USDC on Monad mainnet at $0.01 / $0.05 per call; label endpoints
  excluded from x402; public display of labels prohibited. (`likely`)
- Sept 2026 stats: TVL > $1.01B, 4.3M wallets, 860M txs, 170+ apps, stablecoins > $684M.
- Monad Foundation acquired the Ponder indexing team (Feb 2026) — indexing is a priority.
- Past-winner pattern (`unverified`): consumer/visible projects usually beat pure infra;
  agent projects are saturated (413 of 742 projects in 2026 hackathons were agentic).

---

## 3. Competitive landscape (Track 4)

80+ public "Monad Metropolis" repos; **30+ target agent trust/identity/payments**.

**Crowded:** agent spend limits / kill switches / passkey guardrails (12+ teams);
ERC-8004 review auditing (5+); ERC-8004 Validation registries (8+); agent job boards with
escrow; MetaMask Agent Wallet plugins (8+). npm SDKs + MCP servers are table stakes.

**Under-served (our opening):**
- Seller side: x402 in front of **any** existing HTTP API with no code changes.
- An open, chain-wide x402 **service registry + discovery** ranked by **payment-backed**
  reputation.
- **Standard x402 v2, real USDC, Monad mainnet**, with on-chain spend caps.
- The **whole loop**: fund → discover → pay → receipt → only payers rate → rank → capped.

| Competitor | What | Threat | Their gap |
|---|---|---|---|
| **Xorv** (nickthelegend/xorv-monad) | x402 v2 AI-compute marketplace, payer-only ERC-8004 ratings, Privy MCP buyer, Envio, Nansen, CRE | Functional twin | Testnet only; many TODO(deploy) on Oct 9; one vertical; sprawling |
| **Leash** (iamrobertmoore/leash) | Passkey (P256) account, per-agent caps, MCP, Envio, mainnet | Most polished | tUSD not USDC; custom "x402-style" gate (not x402-compatible); no discovery |
| **Tab** (EmadQureshiKhi/Tab) | Post-paid agent credit, ERC-8004 entry per settlement | Close | Not x402; credit-based |
| monad-agent-trust / prooflines, MonadTrust, Headwater, Merit | Audit/filter ERC-8004 reviews (funding provenance, heuristics) | Same problem | Analytics only — no payment path, no enforcement |
| AgentPass, AgentCard, Countersign, trustset, MoneySwitch, Chancela, ÆGIS | Spend limits / policy gates | Crowded niche | Mostly testnet; not x402 |
| attest8004, witness-8004, Talidator, AgentTrace, POD | Validation registries | Low overlap | Crowded |
| monapi, agentmarket, agent-pay-monad | x402 monetization / buyer agents | Partial | No trust layer |

**Key data point (`likely`, 2 independent READMEs):** Monad mainnet's canonical ERC-8004
Reputation Registry is heavily farmed — agent #182 has **7,665 ratings from 7,665 wallets
its owner funded**; only **16 of 9,296** ratings survive owner-funding + paid-before-rating
filters. Any raw-average ranking (what legacy ChainPe does) would rank farmed agents
first. **Recompute this ourselves before using it in the demo.**

---

## 4. Monad technical facts

| Fact | Confidence |
|---|---|
| Mainnet chain id **143** (`eip155:143`), testnet **10143** (`eip155:10143`); native token **MON** (18 decimals) | verified (viem) |
| RPC mainnet `https://rpc.monad.xyz` (+ `rpc1`), testnet `https://testnet-rpc.monad.xyz` | verified (viem) |
| Explorers: `monadvision.com`, `monadscan.com` (mainnet); `testnet.monadvision.com` | verified (viem / docs) |
| Block time ~400 ms (viem `blockTime: 400`); finality ~800 ms (third-party) | verified / unverified |
| **USDC** mainnet `0x754704Bc059F8C67012fEd69BC8A327a5aafb603`, testnet `0x534b2f3A21130d7a60830c2Df862319e593943A3`; 6 decimals; EIP-712 domain name **"USDC"**, version **"2"**; EIP-3009 supported | verified (`@x402/evm@2.28.0`) |
| **x402 v1 packages (`x402@1.2.0`, `x402-fetch`, `x402-express`) do NOT support Monad** | verified |
| `@x402/core`, `@x402/evm`, `@x402/express`, `@x402/fetch` **v2.28.0** support `monad` / `monad-testnet`; `@x402/evm` ships `exact` (EIP-3009 + Permit2 proxy fallback), `upto`, `batch-settlement`, `auth-capture`, and a v1-compat `ExactEvmSchemeV1` | verified |
| viem **2.57.4** ships `monad` and `monadTestnet` chains | verified |
| Canonical **ERC-8004** mainnet: Identity `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`, Reputation `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | likely |
| ERC-8004 testnets (CREATE2): Identity `0x8004A818BFB912233c491871b3d84c89A494BD9e`, Reputation `0x8004B663056A597Dffe9eCcC1965A193B7388713` — contract code present on Monad testnet (eth_getCode, 2026-10-09) | verified |
| ERC-8004 **Validation** Registry not canonically deployed on Monad ("coming soon") | likely |
| Monad x402 facilitator `https://x402-facilitator.molandak.org` (v2; exact, upto, batch-settlement; 143 + 10143) — `/supported` and a `/verify` of a ChainPe-signed payment checked 2026-10-09 | verified |
| **Gas is charged on the gas LIMIT, not gas used** → set tight explicit limits | likely (official docs, status wording varies) |
| Reserve balance: default **10 MON**; txs that dip below can be included and still revert (and pay gas) | likely |
| No global mempool; `eth_maxPriorityFeePerGas` returns hardcoded 2 gwei; max contract size 128 KB; no blob txs; EIP-7702 supported | likely |
| Public RPC caps **`eth_getLogs` at ~100 blocks** | likely |
| P256 precompile at `0x0100` (~6,900 gas) | likely |
| Testnet faucet `https://faucet.monad.xyz` | likely |

### Environment notes (Claude Code cloud sandbox)
- Reachable: npm registry, GitHub. **Blocked:** `monad.xyz`, `docs.monad.xyz`, the Monad
  RPCs, and `binaries.soliditylang.org` (Hardhat cannot download solc here).
- → Contract compile/tests and any on-chain work (deploys, live payments) must run on a
  developer machine, or Hardhat must be pointed at a locally installed `solc` npm build.

---

## 5. Legacy code review findings (to fix during the port)

1. **Indexer poison pill** — `feedback.value` is Postgres `INTEGER` but on-chain `int128`;
   anyone can post a 3e9 value and the indexer retries the same block range forever.
   (`legacy/services/chainpe-indexer/src/schema.ts`, `core.ts`)
2. **Reputation is gameable** — raw unbounded average from any wallet; `register()` never
   checks the caller owns the linked `agentId`.
   (`legacy/contracts/contracts/ChainPeRegistryUpgradeable.sol` register)
3. **Rate limits effectively global** — no `trust proxy` behind Railway.
4. **Facilitator is an open gas relay** — settles any valid authorization; no payTo
   allowlist / minimum.
5. **Clients sign any `asset`** — no USDC check in SDK/wallet 402 handling.
6. **PolicyVault not wired into x402**; MCP wallet budget is in-memory.
7. Facilitator test asserts `verify_error`, server returns `verify_failed`.
8. Indexer `/services/:id` and `/stats` have no try/catch (DB error → crash).
9. Network constants duplicated in ~6 files; the 402→sign→retry flow is hand-written in 4.
10. Docs drift (fee 0.1 vs 1 USDC, facilitator URL mismatch); no frontend reads the indexer.

---

## 6. Sources
- Metropolis page: https://monad.xyz/developers/hackathons/metropolis · https://monad.xyz/metropolis
- Portal captures: https://raw.githubusercontent.com/Blockchain-Oracle/senryo/main/context/01-tracks/trust-identity-ai.md · https://raw.githubusercontent.com/Blockchain-Oracle/senryo/main/context/00-hackathon/overview.md · https://raw.githubusercontent.com/nickthelegend/juno-monad/main/docs/METROPOLIS.md · https://raw.githubusercontent.com/EndPx/kairos/main/sources/TRACKS_RAW.txt · https://raw.githubusercontent.com/vaibhav0xq/turnstile/main/research/monad-metropolis-report.md
- Judge spotlight: https://x.com/monad_dev/status/2097682107321700819
- Monad blog: https://blog.monad.xyz/blog/monad-foundation-joins-x402-foundation · https://blog.monad.xyz/blog/rise-of-machine-economy · https://monad.xyz/blog/monad-ecosystem-highlights-september-2026
- API Hub: https://cryptobriefing.com/monad-api-hub-usdc-pay-per-request/
- Monad docs: https://docs.monad.xyz/guides/x402 · https://docs.monad.xyz/developer-essentials/gas-on-monad · https://docs.monad.xyz/getting-started/network-information
- x402 networks: https://docs.x402.org/core-concepts/network-and-token-support
- ERC-8004: https://github.com/erc-8004/erc-8004-contracts · https://erc-8004.quicknode.com/docs/contracts
- Competitors: https://github.com/nickthelegend/xorv-monad · https://github.com/iamrobertmoore/leash · https://github.com/EmadQureshiKhi/Tab · https://github.com/ColinkaMir/monad-agent-trust · https://github.com/Dare0x/monadtrust · https://github.com/norbert351/merit
