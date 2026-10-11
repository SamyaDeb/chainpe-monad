# Claude Desktop pays a Monad testnet service — demo runbook

Claude Desktop is a GUI app on your own machine, so it cannot be driven from the cloud build
session. Everything it needs is verified here; these are the steps to run it and record it.

**Already verified (2026-10-11, live on Monad testnet):** the same MCP server that the
extension runs, driven over stdio (`examples/seller-agents/mcp-buyer.mjs`): `search_bazaar` →
`pay` (HTTP 200, settled on-chain) → `give_feedback` with the settlement as receipt;
an offer above `MAX_PER_CALL` was refused before signing. Hashes: `examples/seller-agents/receipts-monad-testnet.json`.
The `.mcpb` builds (`npm run build:mcpb -w chainpe-wallet-mcp` → `packages/chainpe-wallet/chainpe.mcpb`).

## Steps (on your machine, Node 22)

```bash
git clone <this repo> && cd chainpe-monad && npm ci && npm run build
npm run build:mcpb -w chainpe-wallet-mcp            # → packages/chainpe-wallet/chainpe.mcpb

# 1. sellers + funded buyer (testnet; needs a funded testnet DEPLOYER_PRIVATE_KEY, 0x-prefixed)
cd examples/seller-agents
node gen-wallets.mjs && node fund.mjs && node setup.mjs   # writes .env.sellers (git-ignored)
node run-sellers.mjs                                      # leave running: 4 services on :4601-4604
```

2. Double-click `chainpe.mcpb`. In the form set: private key = `BUYER_KEY` from
   `.env.sellers`, network `monad-testnet`, `MAX_PER_CALL` `0.01`, `MAX_PER_DAY` `0.05`.
3. In Claude Desktop ask: *"Search ChainPe for a Monad network stats service, pay for one
   call, then rate it using the payment receipt."*
4. Expected tool calls: `search_bazaar` → `pay` (shows a testnet.monadvision.com settlement link)
   → `give_feedback` (needs `paymentTxHash`). Open the link on screen for the demo video.

Notes: the sellers run on your machine (`localhost`), which Claude Desktop can reach because
it runs there too. Without `CHAINPE_INDEXER_URL`, `search_bazaar` reads the registry on-chain.
Payments between team wallets are demo traffic, not traction.
