# Phase 0 close-out — eligibility, funding, naming (testnet scope)

Decided 2026-10-11 by the owner: **stay on Monad testnet** (no mainnet), and publish the
packages under the **`@chainpemonad/*`** npm scope.

## 1. Metropolis portal — needs the owner (login-gated, cannot be done from the build session)

- [ ] Register / confirm the team on the Metropolis portal.
- [ ] Choose **Track 4 — Trust, Identity & AI Infrastructure**.
- [ ] Open the official rules page and tick each item below against the exact wording.
  Everything here is `likely` (from `docs/MONAD-CONTEXT.md` §1, second-hand captures of the portal)
  until the owner confirms it.

| Rule | What we believe | Confirmed in portal? | What it means for us |
|---|---|---|---|
| Deadline | Tue **Oct 13, 11:59 PM ET** = Wed Oct 14 09:29 IST | [ ] | Code freeze Oct 13 12:00 ET; submit by 18:00 ET |
| Open source | Public, OSI-licensed repo, shared with `metropolis@hackathon.monad.xyz` | [ ] | Repo has an OSI `LICENSE`; make it public and share before submitting |
| "Substantial majority" | Most of the work must be built in the window; older code is allowed as a foundation only if identified in the README | [ ] | Disclosed in `PRIOR_WORK.md` + README; every Monad change is dated in `docs/METROPOLIS.md` |
| AI tools | Must be disclosed in the README | [ ] | Disclosed in `PRIOR_WORK.md`; README must repeat it (Phase 8) |
| Live product | Mainnet **or testnet** link with judge instructions | [ ] | Testnet is allowed if the rules say so — confirm this line first |
| Deliverables | Demo video ≤ 3 min, pitch video ≤ 2 min, logo ≤ 3 MB | [ ] | Phase 8 |

If the portal says mainnet is **required**, tell us before Oct 12: the mainnet runbook
(`docs/MAINNET-RUNBOOK.md`) is ready, but it needs ~25 MON and ~10 USDC.

## 2. Funding plan — testnet (replaces the mainnet plan of ~25 MON + ~10 USDC)

Testnet MON and USDC have no value; the only constraint is faucet rate limits, so fund early.

| Wallet | Needs | Source |
|---|---|---|
| `DEPLOYER` (contract owner) | MON for gas | `https://faucet.monad.xyz` |
| `FACILITATOR` (pays settlement gas) | MON for gas (~137k gas per `exact`, ~252k per vault settlement) | `https://faucet.monad.xyz` |
| `BUYER` (agent) | MON for gas + testnet USDC `0x534b…43A3` | MON faucet + Circle faucet (testnet USDC) |
| `SELLER_1..4` | A little MON for the ERC-8004 mint + registry registration | `examples/seller-agents/fund.mjs` tops them up from the deployer |
| Mandate demo owner | ~1 USDC | Circle faucet |

Existing wallets and agent ids (#2099, #2101–#2104, #2107–#2110) are already funded; new
funding is only needed if the keys are recreated. Keep keys in git-ignored `.env` files.

## 3. npm scope — decided: `@chainpemonad/*`

| Old name (Avalanche) | New name (Monad) |
|---|---|
| `@chainpeavax/sdk` | `@chainpemonad/sdk` |
| `@chainpeavax/cli` | `@chainpemonad/cli` |
| `@chainpeavax/agent` | `@chainpemonad/agent` |
| `@chainpeavax/ai-tools` | `@chainpemonad/ai-tools` |
| (new) `@chainpeavax/marketplace` | `@chainpemonad/marketplace` |

Done in the repo: package names, imports, docs, tests and the lockfile; build and all tests
pass. **Not done (owner):** create the `chainpemonad` org on npm and `npm publish
--access public` for each package. Until then the packages run from this repository
(workspace install). The old `@chainpeavax/*` npm releases stay as Avalanche-only history.
