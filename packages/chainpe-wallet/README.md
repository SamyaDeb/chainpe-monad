# ChainPe Wallet (MCP)

> Give Claude a **Monad** wallet that discovers services in the ChainPe registry,
> ranked by ERC-8004 reputation, and pays for them with **x402 v2** USDC.

ChainPe Wallet is a [Model Context Protocol](https://modelcontextprotocol.io) server,
packaged as a Claude Desktop extension (`.mcpb`). Add a wallet key, set spending limits,
and Claude can find paid APIs, pay for them within your budget, and show you the
settlement transaction on MonadVision.

## Tools

| Tool | What it does |
|---|---|
| `search_bazaar` | Lists registered services (price, tags, endpoint, ERC-8004 score), best reputation first. Uses the indexer API when `CHAINPE_INDEXER_URL` is set, else reads the ChainPeRegistry on Monad. |
| `x402_fetch` | Fetches a URL; on `402 Payment Required` it signs a USDC payment and retries. Returns the raw response plus the receipt. |
| `pay` | Same payment path, structured result: parsed `data`, receipt (`txHash`, `explorerUrl`) and the provider `agentId`. Optional tighter `maxAmount`. |
| `check_balance` | USDC and MON balances. |
| `transfer_usdc` | ERC-20 USDC transfer (counts against the daily budget). |
| `transfer_mon` | Native MON transfer. |
| `spending_report` | Spent today (UTC) / this session, remaining budget, recent payments with tx hashes. |
| `request_funding` | EIP-681 top-up URI; on testnet also the MON faucet (https://faucet.monad.xyz) and the Circle USDC faucet (https://faucet.circle.com, choose Monad Testnet). |
| `give_feedback` | Posts a 0–100 score to the canonical ERC-8004 Reputation Registry (costs a little MON gas). |

## Payment safety

Both `x402_fetch` and `pay` go through the ChainPe SDK (`paidFetch`). An offer is
signed only when **all** of these hold:

- scheme `exact`
- the wallet's own Monad network (`eip155:10143` testnet / `eip155:143` mainnet)
- that network's Circle USDC (a server cannot make the wallet sign for another token)
- amount ≤ min(`MAX_PER_CALL`, what is left of `MAX_PER_DAY` today)

Anything else is refused before signing. Paid calls are serialized so concurrent calls
cannot overspend the remaining budget.

The budget is stored in `~/.chainpe/spending.json` (mode 0600). Restarting the server or
Claude Desktop does not reset it. The daily counter resets at UTC midnight.

## Configuration

Set these in the Claude Desktop extension form, or as env vars when you run it directly:

| Field | Env var | Default |
|---|---|---|
| Private key (0x…) | `CHAINPE_PRIVATE_KEY` (or `privateKey` in `~/.chainpe/wallet.json`) | none (read-only) |
| Network | `NETWORK` (`monad-testnet` / `monad`) | `monad-testnet` |
| Max USDC per payment | `MAX_PER_CALL` | `0.10` |
| Max USDC per UTC day | `MAX_PER_DAY` | `20.00` |
| Indexer API | `CHAINPE_INDEXER_URL` | none (on-chain discovery) |
| Registry override | `CHAINPE_REGISTRY_ADDRESS` | SDK default for the network |
| Reputation registry override | `ERC8004_REPUTATION_REGISTRY` | canonical ERC-8004 registry |
| RPC overrides | `MONAD_RPC_URL`, `MONAD_TESTNET_RPC_URL` | public Monad RPCs |
| Auto-feedback after a paid call | `CHAINPE_AUTO_FEEDBACK=1` | off (it costs gas) |

Use a dedicated wallet with a small balance. The key is never logged.

## Build

```bash
npm install          # from the monorepo root
npm run build        # tsup → dist/index.js (the SDK is bundled in)
npm test             # vitest
npm run build:mcpb   # produces chainpe.mcpb (double-click to install in Claude Desktop)
```

## Run against a local MCP client

```bash
CHAINPE_PRIVATE_KEY=0x… node dist/index.js   # speaks MCP over stdio
```

Connect with the MCP Inspector, or with `@modelcontextprotocol/sdk`'s `Client` +
`StdioClientTransport`, and call `tools/list`: it should show 9 tools.
