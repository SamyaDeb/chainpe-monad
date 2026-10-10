# Quickstart: pay any x402 API on Monad (consumer)

Build the repo first (`npm ci && npm run build`; the Monad SDK runs from the workspace).
Use a throwaway testnet wallet with a little MON (https://faucet.monad.xyz) and testnet
USDC (https://faucet.circle.com, choose Monad Testnet).

## Three lines

```ts
import { ChainPe } from '@chainpeavax/sdk'
const cp = new ChainPe({ privateKey: process.env.CHAINPE_PRIVATE_KEY!, network: 'monad-testnet' })
const res = await cp.pay('http://localhost:4402/')   // 402 → sign USDC → settled → 200
```

`res.data` is the parsed body and `res.payment.txHash` the settlement on
`https://testnet.monadvision.com/tx/…`. `cp.fetch(url)` does the same and returns a plain
`Response`.

The SDK signs only an x402 v2 `exact` offer on the wallet's own Monad network, for that
network's USDC, up to `maxPerCall` (default `"1"` USDC). Anything else is refused before
signing.

## Rate it — with the receipt

```ts
await cp.giveFeedback({ agentId: '2107', value: 90, paymentTxHash: res.payment!.txHash! })
```

The settlement tx becomes the ERC-8004 `feedbackHash`, so the ChainPe indexer can check
that you paid that service before it counts the rating. `autoFeedback: true` in the
constructor does this after every paid call.

## Find services ranked by paid reputation

```ts
const services = await cp.discover('monad')   // on-chain registry + ERC-8004 reputation
```

or, from an indexer: `GET /services?rank=paid` (see `docs/INDEXER-API.md`).

## Spending mandate (optional)

With a PolicyVault mandate the agent holds only a session key, and the vault contract
enforces per-call / daily / total caps and a recipient allowlist on every x402 call:

```ts
const agent = new ChainPe({
  privateKey: SESSION_KEY, network: 'monad-testnet',
  policyVault: { owner: OWNER_ADDRESS }
})
```

The owner sets it up with `PolicyVaultClient` (see `e2e/monad-vault-demo.mjs`).

## CLI

```bash
CHAINPE_PRIVATE_KEY=0x… npx chainpe fetch http://localhost:4402/ --max 0.01
```

Any other x402 v2 client (e.g. `@x402/fetch` + `@x402/evm`) can pay a ChainPe provider too;
`examples/seller-agents/standard-client.mjs` does it without the ChainPe SDK.
