# ChainPe Facilitator (Monad)

A standalone, **non-custodial** x402 **v2** facilitator for USDC payments on Monad. It
verifies payment authorizations and settles them on-chain (paying the gas), so ChainPe
providers don't have to run their own.

## Non-custodial by design

The facilitator key only pays gas and relays the payer's already-signed EIP-3009
`transferWithAuthorization`. It never holds user funds and cannot move money the payer did
not authorize. Worst case if the key leaks: an attacker can waste its MON.

## Not an open gas relay

It only pays gas for payments that are:
- scheme `exact` on its own network (`eip155:143` or `eip155:10143`),
- in Monad **USDC**,
- at least `MIN_AMOUNT_ATOMIC` (default 0.001 USDC),
- to a **payTo registered in the ChainPe registry** (read from the indexer every 60 s) or
  listed in `PAYTO_ALLOWLIST` — strict by default on mainnet,
- and the payer's signed offer (`accepted`) must match the requirements being settled.

Anything else is answered with `isValid: false` / `success: false` before any RPC call.

## Monad specifics

- Settlements are submitted **one at a time** with a local nonce manager, so concurrent
  requests can't collide on a nonce (a reverted tx still pays its full gas limit on Monad).
- `/health` turns `degraded` below `LOW_GAS_MON` (default 1 MON). Settlements send no MON
  value, so Monad's 10 MON reserve-balance rule does not apply to this key.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness (no RPC) + facilitator address; `degraded` on low gas |
| GET | `/status` | Cached gas balance in MON |
| GET | `/supported` | x402 v2 supported kinds (`exact` on this network) |
| GET | `/metrics` | Prometheus counters |
| POST | `/verify` | `{ x402Version, paymentPayload, paymentRequirements }` → `VerifyResponse` |
| POST | `/settle` | same body → `SettleResponse` (`transaction` = settlement tx hash) |

## Run

```bash
cp .env.example .env   # FACILITATOR_PRIVATE_KEY (funded with MON), NETWORK
npm install
npm test
npm run build && npm start   # :4500
```

Point a provider at it with `CHAINPE_FACILITATOR_URL=http://localhost:4500`.

## Deploy (Railway)

`railway.json` + `Dockerfile` are included; Railway injects `PORT`. Set
`FACILITATOR_PRIVATE_KEY`, `NETWORK`, `CHAINPE_INDEXER_URL`, then generate a domain and
check `curl https://<domain>/health`. One instance serves one network.
