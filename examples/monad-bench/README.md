# monad-bench

Port of `legacy/examples/avalanche-bench`, rewritten to measure **real** x402 payments on Monad:
N paid calls through a local ChainPe proxy and a facilitator; reports p50/p95 of `request → 402`
and `402 → settled → 200`. Run on testnet and mainnet to compare. Calls are demo traffic between
team-controlled wallets — not traction. Usage: see the header of `bench.mjs`.
