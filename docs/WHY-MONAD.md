# Why Monad

ChainPe makes a rating count only when a payment backs it. That needs a payment, and a
receipt, for every single API call an agent makes, so settlement has to be fast and cheap
enough to sit inside the agent's request loop. This page lists what we measured on Monad
testnet and what of Monad's own stack ChainPe builds on. Every number here is measured by
us; where we haven't measured something, we say so.

## Measured: one paid x402 call, end to end

`examples/monad-bench`: the SDK requests a ChainPe-proxied API, gets the `402`, signs a
USDC payment, the facilitator settles it on Monad testnet, and the API answers `200`.
Timed from the `402` to the `200`, so it includes the on-chain settlement.

| Facilitator | Calls | 402 → settled → 200 | Results |
|---|---|---|---|
| Monad's public x402 facilitator | 30 | **p50 591 ms · p95 755 ms** | `examples/monad-bench/results-monad-testnet.json` |
| ChainPe's own facilitator (strict payTo policy) | 20 | **p50 897 ms**, one 3.98 s outlier (= the p95 of 20) | `examples/monad-bench/results-monad-testnet-own-facilitator.json` |

Caveats: testnet, run from a cloud build sandbox through an HTTP proxy, 0.001 USDC per call,
small samples. Mainnet and a well-placed client may differ; we have not measured mainnet.
Every settlement hash is in the results files (demo traffic between team wallets).

## Measured: gas per settlement

- x402 `exact` (EIP-3009 `transferWithAuthorization`): ~137k gas, with the gas limit set
  to what the call uses. Monad bills the gas **limit**, so the facilitator sets tight limits
  instead of a padded default.
- Mandate mode (`PolicyVault.spend`, caps checked on-chain): ~252k gas billed incl. 10%
  headroom (~309k for an owner's first spend, cold storage).

## What ChainPe uses from Monad

- **Canonical ERC-8004 registries on Monad.** Agents are minted on the canonical Identity
  Registry and rated on the canonical Reputation Registry; ChainPe adds no registry of its
  own for reputation. It reads the same ratings everyone else sees and decides which
  ones a payment backs. Any agent already on those registries can be ranked this way.
- **x402 v2 on `eip155:10143` / `eip155:143`.** Standard `exact` USDC payments
  (`@x402/*` 2.28), so a ChainPe provider can be paid by any x402 v2 client, and ChainPe
  clients can pay any x402 v2 service on Monad. Our sellers settled both through Monad's
  public facilitator and through our own.
- **Circle USDC on Monad** (EIP-3009), so the payer signs and the facilitator only pays gas.

## Monad constraints we designed around

- Gas billed on the limit → explicit, tight gas limits on every settlement and contract call.
- Public RPC caps `eth_getLogs` at ~100 blocks → the indexer walks 100-block chunks from the
  registry's deploy block.
- 10 MON reserve balance → only transactions that send MON value are affected; USDC
  settlements and deploys are gas-only.

Status: everything above is on Monad **testnet**. Mainnet is not deployed yet.
