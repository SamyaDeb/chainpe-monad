# Prior work disclosure

This repository is the Monad build of ChainPe for the **Monad Metropolis** hackathon
(build window 2026-09-01 → 2026-10-13).

## Pre-existing foundation (built before Metropolis)

The first commit of this repository imports, unchanged, a snapshot of ChainPe as it
existed on Avalanche C-Chain:

| | |
|---|---|
| Source repository | `SamyaDeb/ChainPeAvax` |
| Source commit | `cb3904ead82e6e5442e9bda53b49f9ca8d9dfe2c` (2026-06-18) |
| Built | 2026-06-13 → 2026-06-18, on Avalanche C-Chain (Fuji + mainnet) |
| Published packages | `@chainpeavax/sdk`, `@chainpeavax/cli`, `@chainpeavax/agent`, `@chainpeavax/ai-tools` (npm) |

That snapshot contains the Avalanche versions of the registry and PolicyVault contracts,
the x402 v1 facilitator, the indexer, the SDK, the CLI/proxy, the MCP wallet, the agent,
the AI-framework tools, the example seller agents and the marketing/docs sites. **None of
it targets Monad**, and none of it was written during the hackathon. It is the foundation
only.

## Built during Metropolis

Everything after the foundation commit was built during the hackathon window. See
`git log` (every commit is dated) and `docs/METROPOLIS.md` for the itemised list.

## AI tooling disclosure

Development in this repository was assisted by Claude Code (Anthropic). Commits it
co-authored carry a `Co-Authored-By: Claude` trailer.
