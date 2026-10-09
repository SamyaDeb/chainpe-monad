# ChainPe Facilitator

A standalone, **non-custodial** x402 facilitator for USDC payments on Avalanche
C-Chain. It verifies payment authorizations and settles them on-chain (paying
the gas), so ChainPe providers don't have to run their own.

## Non-custodial by design

The facilitator key **only pays gas and relays the payer's already-signed
EIP-3009 `transferWithAuthorization`**. It never holds user funds and cannot move
money the payer did not authorize. Worst case if the key leaks: an attacker can
waste the gas balance — user funds are never at risk.

## Endpoints (x402 facilitator contract)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness + facilitator address + gas balance |
| GET | `/supported` | Advertised scheme/network (`exact` on Avalanche) |
| POST | `/verify` | Verify a signed payment payload |
| POST | `/settle` | Submit the authorization on-chain (pays gas) |

## Run locally

```bash
cp .env.example .env   # set FACILITATOR_PRIVATE_KEY (a funded gas wallet)
npm install
npm run build
npm start              # listens on :4500
```

## Point a provider at it

```bash
# provider proxy uses this facilitator for settlement
CHAINPE_FACILITATOR_URL=http://localhost:4500 chainpe start
```

Or set `facilitatorUrl` in `~/.chainpe/config.json`.

## Deploy on Railway

The included `railway.json` builds and starts the service with a `/health`
check. Set the env vars (`FACILITATOR_PRIVATE_KEY`, `NETWORK`) in the Railway
dashboard; Railway injects `PORT`. Fund the facilitator address with AVAX for
gas. A `Dockerfile` is also provided for other platforms.

## Env

| Var | Default | Notes |
|---|---|---|
| `FACILITATOR_PRIVATE_KEY` | — | required; gas-paying settlement key |
| `NETWORK` | `avalanche` | `avalanche` or `fuji` |
| `RPC_URL` | public RPC | optional override |
| `PORT` | `4500` | Railway injects this |
