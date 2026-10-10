# Quickstart: sell an API over x402 on Monad (provider)

`chainpe start` runs a payment proxy in front of any HTTP API. Unpaid requests get
`402 Payment Required` with an x402 v2 `exact` USDC offer on Monad; paid ones are verified
and settled by a facilitator, then forwarded to your backend. Testnet first.

## 1. Build (the Monad builds run from this repo)

```bash
git clone https://github.com/SamyaDeb/chainpe-monad && cd chainpe-monad
npm ci && npm run build
```

The `@chainpeavax/*` packages on npm are older, pre-Monad releases; use the workspace
build (`npx chainpe …` from the repo root).

## 2. Configure once

```bash
npx chainpe init
```

It asks for the backend URL, service name, description, tags, price per request (USDC),
the wallet that receives payments, the network (`monad-testnet`) and the proxy port
(default 4402), and writes `~/.chainpe/config.json`.

## 3. Start — one command

```bash
CHAINPE_FACILITATOR_URL=https://x402-facilitator.molandak.org npx chainpe start
```

That is Monad's public facilitator (supports `exact` on `eip155:10143` and `eip155:143`).
To use ChainPe's own facilitator instead, run `services/chainpe-facilitator` (see
`docs/DEPLOYMENTS.md`) and point `CHAINPE_FACILITATOR_URL` at it; it also accepts mandate-mode
(`chainpe-vault`) payments, which the proxy then offers automatically.

Check it: `curl -i localhost:4402/` → `402` with a `PAYMENT-REQUIRED` header.

## 4. Get listed and rated (optional)

Ratings attach to an ERC-8004 agent. Mint an agentId on the canonical Identity Registry
(`0x8004A818BFB912233c491871b3d84c89A494BD9e` on testnet; `examples/seller-agents/setup.mjs`
shows how), add `"agentId"` to `~/.chainpe/config.json`, then register the service in the
ChainPeRegistry (the registry checks you own the agentId):

```bash
CHAINPE_PUBLIC_URL=https://your-public-proxy.example \
CHAINPE_PRIVATE_KEY=0x…   npx chainpe register     # a testnet key with a little MON for gas
```

The proxy advertises the agentId on its 402, so buyers can rate you with their
settlement as the receipt. Only those ratings count toward your **paid** reputation.

Testnet funds: MON https://faucet.monad.xyz · USDC https://faucet.circle.com (Monad Testnet).
