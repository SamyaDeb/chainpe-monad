# Prior work disclosure

ChainPe on Monad is a **port and extension** of ChainPe, which was first built for
Avalanche C-Chain in June 2026, before the **Monad Metropolis** hackathon
(build window 2026-09-01 → 2026-10-13).

## Pre-existing work (built before Metropolis)

| | |
|---|---|
| Source repository | `SamyaDeb/ChainPeAvax` |
| Source commit | `cb3904ead82e6e5442e9bda53b49f9ca8d9dfe2c` (2026-06-18) |
| Built | 2026-06-13 → 2026-06-18, on Avalanche C-Chain (Fuji + mainnet) |
| Published packages | `@chainpeavax/sdk`, `@chainpeavax/cli`, `@chainpeavax/agent`, `@chainpeavax/ai-tools` (npm) |

That codebase contains the Avalanche versions of: the service registry and PolicyVault
contracts, an x402 **v1** facilitator, the event indexer, the SDK, the CLI/payment proxy,
the Claude MCP wallet, the LLM agent, the Vercel AI / LangChain tools, example seller
agents and marketing/docs sites. None of it targets Monad.

## How this repository is built

The Avalanche code is **not** imported wholesale. It is kept outside version control
(a local, git-ignored `legacy/` folder) and brought into this repository one module at a
time, as each module is ported to Monad. Commits that adapt pre-existing code say so in
their message ("port …"). Everything else — the Monad port itself, x402 v2, the
payment-backed reputation system, mandate-mode payments, the indexer changes, the
marketplace and the Monad deployments — is new work done during the hackathon.

`docs/METROPOLIS.md` is the dated, itemised log of what was built during Metropolis.

## AI tooling disclosure

Development in this repository is assisted by Claude Code (Anthropic). Commits it
co-authored carry a `Co-Authored-By: Claude` trailer.
