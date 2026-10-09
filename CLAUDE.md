# ChainPe on Monad — working notes for coding sessions

ChainPe is x402 USDC payment + ERC-8004 reputation infrastructure for AI agents, being
ported from Avalanche to **Monad** for the Monad Metropolis hackathon (Track 4: Trust,
Identity & AI Infrastructure). Deadline: **Tue Oct 13 2026, 11:59 PM ET**.

- **Plan (phases, steps, done-criteria):** `docs/MONAD-PLAN.md` — follow it in order.
- **Research context (rules, judges, competitors, Monad facts):** `docs/MONAD-CONTEXT.md`
- **Prior-work disclosure:** `PRIOR_WORK.md` · **Build log:** `docs/METROPOLIS.md`

## Rules
- **Port, don't import.** The pre-existing Avalanche code is a local, git-ignored
  reference in `legacy/` (source: `SamyaDeb/ChainPeAvax@cb3904e`). Bring a module in,
  adapt it to Monad in the same change, and say `port …` in the commit message. Never
  commit unported Avalanche code, and never remove or weaken the prior-work disclosure.
- Add a dated line to `docs/METROPOLIS.md` for every meaningful change.
- **Monad only:** networks `monad` / `monad-testnet`. No Avalanche/Fuji/AVAX/Snowtrace/ICM.
- **x402 v2 only** (`@x402/core`, `@x402/evm`, `@x402/express`, `@x402/fetch` @ `2.28.x`).
  The v1 packages (`x402`, `x402-fetch`, `x402-express`) do not support Monad.
- Default network in code is `monad-testnet`; mainnet is opt-in.
- Never present demo-agent payments as traction (wash-trading rule).
- Commit as the team member who owns that work (default SamyaDeb), and keep the
  `Co-Authored-By: Claude` trailer:
  - SamyaDeb — `git -c user.name=SamyaDeb -c user.email=sammodeb28@gmail.com commit …`
  - saxux2 — `git -c user.name=saxux2 -c user.email=skybiswas0722@gmail.com commit …`

## If `legacy/` is missing (fresh clone)
```bash
git clone https://github.com/SamyaDeb/ChainPeAvax /tmp/chainpeavax   # private repo
git -C /tmp/chainpeavax archive cb3904ead82e6e5442e9bda53b49f9ca8d9dfe2c | tar -x -C legacy
```

## Monad constants (single source of truth: `packages/chainpe-sdk/src/networks.ts`)

| | `monad` (mainnet) | `monad-testnet` |
|---|---|---|
| Chain id / CAIP-2 | `143` / `eip155:143` | `10143` / `eip155:10143` |
| viem chain | `monad` (`viem/chains`, viem ≥ 2.57) | `monadTestnet` |
| RPC (env override) | `https://rpc.monad.xyz` (`MONAD_RPC_URL`) | `https://testnet-rpc.monad.xyz` (`MONAD_TESTNET_RPC_URL`) |
| USDC (6 dp, EIP-712 `"USDC"` v`"2"`) | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` | `0x534b2f3A21130d7a60830c2Df862319e593943A3` |
| ERC-8004 Identity | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x8004A818BFB912233c491871b3d84c89A494BD9e` (unverified) |
| ERC-8004 Reputation | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` (unverified) |
| ChainPeRegistry / PolicyVault | not deployed yet → `contracts/deployments/` | not deployed yet |
| Explorer | `https://monadvision.com` | `https://testnet.monadvision.com` |
| Native token | MON (18 dp) | MON |
| x402 facilitator | ours (`CHAINPE_FACILITATOR_URL`) | ours, or `https://x402-facilitator.molandak.org` |

Monad behaviour to respect: gas is billed on the **gas limit** (set tight limits);
keep gas-paying keys above the **10 MON reserve balance**; public RPC caps `eth_getLogs`
at ~100 blocks; no global mempool.

## Target layout (mirrors `legacy/` so modules port 1:1)
```
contracts/                    Hardhat: ChainPeRegistryUpgradeable, PolicyVaultUpgradeable (no ICM)
services/chainpe-facilitator  x402 v2 verify/settle for Monad (Railway)
services/chainpe-indexer      registry + canonical ERC-8004 events → Postgres → REST, paid reputation
packages/chainpe-sdk          ChainPe client (fetch/pay/discover/reputation/PolicyVault) + networks.ts
packages/chainpe              CLI + x402 payment proxy (`chainpe start/register`)
packages/chainpe-wallet       Claude MCP wallet (.mcpb)
packages/chainpe-agent        LLM agent CLI
packages/chainpe-ai-tools     Vercel AI SDK + LangChain tools
examples/                     seller-agents (Monad themes), weather-api, policy-vault, monad-bench
apps/marketplace              Next.js marketplace (new)
e2e/                          monad-testnet / mainnet end-to-end scripts
```

## Commands (once ported)
- Root workspaces: `npm install`, `npm run build`, `npm run typecheck`, `npm test`
- Contracts: `cd contracts && npm install && npx hardhat test`
- Services: `cd services/<name> && npm install && npm test`

## Environment notes (Claude Code cloud sandbox)
npm and GitHub are reachable. **Monad RPCs, monad.xyz docs and
`binaries.soliditylang.org` are blocked**, so Hardhat can't download solc and nothing
can touch the chain from the sandbox. Run contract tests, deployments and live payments
on a developer machine (or point Hardhat at a locally installed `solc` npm build).

## Known legacy issues to fix while porting
See `docs/MONAD-CONTEXT.md` §5 (indexer int128 poison pill, gameable reputation, missing
agentId owner check, `trust proxy`, open gas relay, unchecked `asset`, in-memory budget,
failing facilitator test, unguarded async routes, duplicated constants).
