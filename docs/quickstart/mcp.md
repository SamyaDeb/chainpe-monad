# Quickstart: give Claude a Monad wallet (MCP)

`packages/chainpe-wallet` is an MCP server (and Claude Desktop extension) with tools to
discover services ranked by paid reputation (`search_bazaar`), pay x402 APIs in USDC
(`pay`, `x402_fetch`), rate them with the receipt (`give_feedback`), and check spending
(`check_balance`, `spending_report`). Per-call and daily USDC caps are enforced before
anything is signed. Full tool list: `packages/chainpe-wallet/README.md`.

Use a dedicated testnet wallet: MON from https://faucet.monad.xyz, USDC from
https://faucet.circle.com (Monad Testnet).

## Claude Desktop extension

```bash
npm ci && npm run build                      # repo root
npm run build:mcpb -w chainpe-wallet-mcp     # → packages/chainpe-wallet/chainpe.mcpb
```

Double-click `chainpe.mcpb`, then fill in the private key, network (`monad-testnet`),
`MAX_PER_CALL` and `MAX_PER_DAY` in the extension form.

## Any MCP client (config file)

```json
{
  "mcpServers": {
    "chainpe-wallet": {
      "command": "node",
      "args": ["/absolute/path/to/chainpe-monad/packages/chainpe-wallet/dist/index.js"],
      "env": {
        "CHAINPE_PRIVATE_KEY": "0x… (throwaway testnet key)",
        "NETWORK": "monad-testnet",
        "MAX_PER_CALL": "0.05",
        "MAX_PER_DAY": "1.00",
        "CHAINPE_INDEXER_URL": "http://localhost:4600"
      }
    }
  }
}
```

`CHAINPE_INDEXER_URL` is optional: without it `search_bazaar` reads the registry on-chain.

## Try it

Ask Claude: *"Find a Monad network-stats service, pay for one call, and rate it."* It
should call `search_bazaar` → `pay` (showing the settlement link) → `give_feedback` with
that settlement as `paymentTxHash`. An offer above `MAX_PER_CALL` is refused before signing.

The same flow, scripted over stdio: `examples/seller-agents/mcp-buyer.mjs`.
