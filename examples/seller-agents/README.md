# Monad seller agents (demo)

Port of `legacy/examples/seller-agents` (Avalanche) with Monad themes. Four services, each an
ERC-8004 agent registered in ChainPeRegistry and served behind the ChainPe x402 gateway:
`monad-network-stats`, `mon-price-quote`, `monad-ecosystem-digest`, `agent-trust-report`.

**All payments between our own wallets are demo traffic, not traction.**

```bash
npm run build                                   # repo root
cd examples/seller-agents
node gen-wallets.mjs                            # keys → .env.sellers (git-ignored), prints addresses only
DEPLOYER_PRIVATE_KEY=0x… node fund.mjs          # testnet MON for gas
# get testnet USDC for the BUYER address from the Circle faucet
node setup.mjs                                  # mint agentIds + register services
CHAINPE_FACILITATOR_URL=… node run-sellers.mjs  # defaults to Monad's public testnet facilitator
ROUNDS=3 node orchestrator.mjs                  # pay + receipt-backed feedback → receipts-<network>.json
```
`NETWORK=monad` for mainnet (needs `CHAINPE_FACILITATOR_URL`; payTo must be registered).

Notes: a brand-new wallet's first contract call can be rejected with "insufficient balance" until it has sent one plain transaction (seen on Monad testnet); `setup.mjs` retries and accepts `ONLY=PRICE,DIGEST`. Monad's 10 MON reserve can also make a wallet below 10 MON fail when it sends MON value — fund the wallets from the faucet or a >10 MON wallet.
