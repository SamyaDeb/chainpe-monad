# Built during Monad Metropolis

Dated log of the work done in this repository during the hackathon window
(2026-09-01 → 2026-10-13). Pre-existing work is described in `PRIOR_WORK.md`.

| Date (UTC) | Work |
|---|---|
| 2026-10-09 | Created the Monad repository; research on the Metropolis rules, judges, competitors and Monad's x402 / ERC-8004 stack (`docs/MONAD-CONTEXT.md`); phase-by-phase Monad build plan (`docs/MONAD-PLAN.md`); prior-work and AI-tooling disclosure (`PRIOR_WORK.md`). |
| 2026-10-09 | **Phase 1 — contracts on Monad.** Ported the service registry and PolicyVault (UUPS) to Monad: Hardhat networks for Monad mainnet (143) and testnet (10143) with Monadscan verification; dropped the Avalanche-only ICM contracts and non-upgradeable duplicates; registry now only accepts an ERC-8004 `agentId` the caller owns or is approved for (new `NotAgentOwner` check + tests); deploy scripts default to Monad USDC and the canonical ERC-8004 IdentityRegistry, refuse an identity registry without code, and default the registration fee to 0; new generic preflight / postcheck / verify scripts; fixed the ownership-transfer script (PolicyVault ownership is single-step); re-pointed the full registry and vault test suites at the proxies (84 tests); solcjs fallback for offline compilation. |
| 2026-10-09 | **Phase 1 — Monad network config.** New `@chainpeavax/sdk` networks module: the single source of truth for Monad chain ids, CAIP-2 ids, RPCs (env-overridable), Circle USDC + EIP-712 domain, canonical ERC-8004 registries and explorers (11 tests). Monorepo workspace skeleton and Monad `.env.example`. |
