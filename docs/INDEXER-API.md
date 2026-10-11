# ChainPe indexer API reference

The indexer (`services/chainpe-indexer`) watches the ChainPeRegistry and the canonical
ERC-8004 Reputation Registry on Monad, decides which ratings are backed by an x402
payment, and serves this read-only JSON API (CORS on, 120 requests/min per client by
default). How payments are verified and scores computed: `services/chainpe-indexer/README.md`.

Base URL: wherever you run it (default `http://localhost:4600`). There is no public
hosted instance yet; see `docs/DEPLOYMENTS.md`.

Errors are JSON: `400 {"error": "<what is wrong>"}`, `404 {"error": "service not found"}`,
`429 {"error": "rate_limit_exceeded"}`, `500 {"error": "internal_error"}`.

## `GET /health`

```json
{ "status": "ok", "service": "chainpe-indexer", "network": "monad-testnet",
  "lastIndexedBlock": "69846405", "chainHead": "69846405" }
```

## `GET /stats`

```json
{ "services": 9, "feedback": 109, "paidFeedback": 32, "network": "monad-testnet" }
```

`services` = active registered services. `feedback` counts every rating on the canonical
Reputation Registry since the start block, **including agents not registered with
ChainPe**; `paidFeedback` = ratings backed by a verified payment receipt.

## `GET /services`

| Query | Default | |
|---|---|---|
| `rank` | `paid` | `paid` (receipt-backed, payment-weighted) or `raw` (every rating, unweighted) |
| `query` | | substring of name, description or a tag |
| `tag` | | exact tag |
| `maxPrice` | | max USDC per request |
| `limit`, `offset` | 100, 0 | max 100 |

```jsonc
{
  "total": 9, "offset": 0, "limit": 100, "rank": "paid",
  "items": [{
    "id": "0x5e45…5227:monad-weather-demo",   // developer:name
    "key": "0x3f0e…d13a",                      // registry key
    "name": "monad-weather-demo",
    "description": "…", "tags": ["weather", "demo"],
    "endpoint": "https://…", "pricePerRequest": "0.01", "paymentToken": "USDC",
    "walletAddress": "0x5e45…5227",            // payTo
    "developer": "0x5e45…5227", "network": "monad-testnet",
    "agentId": "2099",                         // ERC-8004 agent, if linked
    "reputation": { "count": 1, "score": 95 }, // of the chosen rank
    "reputationDetail": {
      "paid": { "score": 95, "count": 1, "volume": "0.01" },  // count = distinct payers, volume = USDC
      "raw":  { "score": 98.33, "count": 2 }                   // count = distinct raters
    }
  }]
}
```

Ranking: services with a score first, then higher score, more payers/raters, cheaper.

## `GET /services/:id`

One service, `:id` = `key`, `developer:name` (case-insensitive) or the numeric ERC-8004 `agentId` linked to it (e.g. `/services/2133`). Same shape as an item
above, ranked fields for `paid`. 404 if unknown or deregistered.

## `GET /services/:id/reputation`

```json
{ "agentId": "2099", "paid": { "score": 95, "count": 1, "volume": "0.01" },
  "raw": { "score": 98.33, "count": 2 } }
```

## `GET /feedback`

The ratings feed, newest first (block, then log index).

| Query | Default | |
|---|---|---|
| `agentId` | | one ERC-8004 agent (digits) |
| `paid` | | `true` = receipt-backed only; `false` = everything else |
| `registered` | | `true` = only agents linked to an active ChainPe service; `false` = only the others |
| `limit`, `offset` | 50, 0 | max 100 |

```jsonc
{
  "total": 34, "offset": 0, "limit": 50, "paid": null, "registered": true,
  "network": "monad-testnet",
  "items": [{
    "agentId": "2099",
    "service": { "id": "0x5e45…5227:monad-weather-demo", "name": "monad-weather-demo" },
    "rater": "0xf045…3c09",
    "value": 100, "rawValue": "100", "valueDecimals": 0,
    "status": "unpaid",                 // paid | unpaid (excluded) | pending (not verified yet)
    "paid": false,
    "unpaidReason": "receipt_reused",
    "revoked": false,
    "paidAmount": null, "payer": null,  // USDC + payer, when paid
    "feedbackTxHash": "0xaef3…b3ab",    // the NewFeedback tx
    "receiptTxHash": null,              // the x402 settlement backing it, when paid
    "citedHash": "0x4356…a943",         // the feedbackHash the rater cited
    "feedbackUri": "x402:eip155:10143:0x4356…a943",
    "tags": ["x402", "paid-call"], "endpoint": null,
    "block": "69664669", "blockTime": "2026-10-09T22:59:59.000Z"
  }]
}
```

`unpaidReason` values:

| Reason | Meaning |
|---|---|
| `no_receipt` | no (well-formed) settlement tx hash cited |
| `receipt_reused` | the cited settlement already backs an earlier rating |
| `no_registered_service` | the agent has no service in the ChainPe registry |
| `self_dealing` | the rater (or the vault owner who paid) is the agent owner, agent wallet, developer or payTo |
| `tx_not_found` | the cited tx does not exist |
| `tx_reverted` | the cited tx reverted |
| `no_matching_transfer` | no USDC transfer (or PolicyVault spend) from the rater to the service's payTo in it |
| `below_minimum` | the payment is below `MIN_PAID_AMOUNT` |

## `GET /services/:id/feedback`

The same feed for one service's agentId (`paid`, `limit`, `offset` as above). 404 if the
service is unknown; an empty list if it has no agentId.

## Examples

```bash
curl 'localhost:4600/services?rank=raw'
curl 'localhost:4600/feedback?registered=true&paid=true&limit=10'
curl 'localhost:4600/feedback?agentId=2099'
curl "localhost:4600/services/$(node -p 'encodeURIComponent(process.argv[1])' '0x5e45B6025Dc9621ed3eef4BFEAD2041D7E475227:monad-weather-demo')/feedback"
```
