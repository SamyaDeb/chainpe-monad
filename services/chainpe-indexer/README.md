# ChainPe indexer (Monad)

Watches the **ChainPeRegistry** and the **canonical ERC-8004 Reputation Registry**
on Monad into Postgres, decides which feedback is backed by an x402 payment, and
serves discovery ranked by **paid** reputation — "no receipt, no rating".

```
ChainPeRegistry ──┐                                   ┌─ GET /services?rank=paid|raw
                  ├─ getLogs (100-block chunks) ─► PG ─┼─ GET /services/:id
ERC-8004 Rep ─────┘        │                          ├─ GET /services/:id/reputation
                           └─ verifier: feedbackHash  ├─ GET /feedback · /services/:id/feedback
                              → settlement receipt    └─ GET /stats · /health
```

## Paid reputation

ChainPe clients post feedback with `feedbackHash` = the x402 **settlement tx
hash**, tags `x402` / `paid-call`, `feedbackURI` = `x402:eip155:<chainId>:<txHash>`
(see `giveFeedback` in `@chainpeavax/sdk`).

**Verification** (`verifyFeedbackPayment` in `src/core.ts`, worker in `src/verify.ts`):
a feedback is *paid* only if its `feedbackHash` is a successful tx whose receipt holds
a USDC `Transfer` **from the feedback's client** **to the payTo of a registered
ChainPe service linked to that agentId**, of at least `MIN_PAID_AMOUNT` — or, for x402
`chainpe-vault` payments (mandate mode), a `PolicyVault.Spent(owner, to, amount, relayer,
nonce)` from our vault (`POLICY_VAULT_ADDRESS`) to that payTo, where the client is the
vault **owner** or the **session key that signed the spend** (recovered from the `spend`
calldata with the event's nonce; no archive state needed). A vault owned by an insider is
self-dealing whoever rates. A receipt
backs at most one feedback (the earliest; also a partial unique index). Payments by
the service developer, the payTo, the agent owner or the agentWallet are ignored
(self-dealing). Everything else is stored as `unpaid` with a reason
(`no_receipt`, `receipt_reused`, `self_dealing`, `tx_not_found`, …).

**Scoring** (`scoreReputation`): values are clamped to 0–100 (an int128 `1e30`
rating counts as 100, never overflows), each receipt weighs `min(amount,
WEIGHT_CAP_AMOUNT)`, and no single payer holds more than `PAYER_SHARE_CAP` (25%)
of the total weight (with fewer than 4 payers, payers weigh equally). `paid.count`
= distinct verified payers; `paid.volume` = USDC paid. `raw` (unweighted mean over
all live feedback) is kept for comparison.

Limits, stated plainly: a seller who funds fresh wallets to pay itself still gets
"paid" ratings (the money returns to it, minus gas); the per-receipt cap and the
per-payer cap bound how much such wallets can move the score, and a provenance
filter (first funder = agent owner) is future work.

## Fixes over the pre-existing indexer (see `PRIOR_WORK.md`)
- `feedback.value` is `NUMERIC` (on-chain `int128`); the old `INTEGER` column let one
  large value stall the indexer forever.
- New columns: `feedback_hash`, `feedback_uri`, `endpoint`, `payer`, `paid_status`,
  `paid_verified`, `paid_amount`, `paid_reason`, `log_index`, `tx_hash`.
- Every route is wrapped (DB errors → 500, not a crash); `trust proxy` set so rate
  limits are per client behind Railway.

## Run locally

```bash
cp .env.example .env          # set DATABASE_URL
npm install
npm run dev                   # watcher + API on :4600
curl 'localhost:4600/services?rank=paid'
curl 'localhost:4600/services/<key or developer:name>/reputation'
```

## API

| Endpoint | Returns |
|---|---|
| `GET /services?rank=paid\|raw&query=&tag=&maxPrice=&limit=&offset=` | active services, each with `reputation` (`{count, score}` of the chosen rank) and `reputationDetail` (`{paid, raw}`), ranked best-first (default `paid`) |
| `GET /services/:id` | one service (`:id` = `key` or `developer:name`) |
| `GET /services/:id/reputation` | `{ agentId, paid: {score, count, volume}, raw: {score, count} }` |
| `GET /feedback?agentId=&paid=true\|false&limit=&offset=` | the ratings feed, newest first (block, log index): `{ total, offset, limit, paid, network, items }`. Default `limit` 50, max 100. `paid=true` = receipt-backed only, `paid=false` = everything else |
| `GET /services/:id/feedback?paid=&limit=&offset=` | the same feed for one service's agentId (404 if the service is unknown) |
| `GET /stats` | `{ services, feedback, paidFeedback }` |
| `GET /health` | liveness + `lastIndexedBlock` / `chainHead` |

### Feedback items

Each rating in `/feedback` says whether a payment backs it ("no receipt, no rating"):

```jsonc
{
  "agentId": "2099",
  "service": { "id": "0x5e45…:monad-weather-demo", "name": "monad-weather-demo" }, // null if no service links the agentId
  "rater": "0x…",              // the ERC-8004 clientAddress
  "value": 95,                 // clamped to 0–100, as scoring uses it
  "rawValue": "95", "valueDecimals": 0,
  "status": "paid",            // paid | unpaid (excluded) | pending (not verified yet)
  "paid": true,
  "unpaidReason": null,        // no_receipt, receipt_reused, self_dealing, tx_not_found, tx_reverted,
                               // no_matching_transfer, below_minimum, no_registered_service
  "revoked": false,            // revoked ratings stay listed but no longer count
  "paidAmount": "0.01",        // USDC the rater paid in the settlement (paid only)
  "payer": "0x…",
  "feedbackTxHash": "0x…",     // the NewFeedback tx
  "receiptTxHash": "0x…",      // the x402 settlement that backs it (paid only)
  "citedHash": "0x…",          // the feedbackHash the rater cited, whatever it is
  "feedbackUri": "x402:eip155:10143:0x…",
  "tags": ["x402", "paid-call"],
  "endpoint": "…",
  "block": "69700000",
  "blockTime": "2026-10-09T…Z" // block timestamp; null if the block read failed
}
```

`blockTime` is read once per block while indexing (new column `feedback.block_time`,
added in place on existing databases; rows indexed before it stay `null`).

## Tests

`npm test` — pure verification/scoring tests plus a store → verifier → API test on
pg-mem. Set `TEST_DATABASE_URL=postgres://…` to run the latter on a real Postgres
(it uses a throwaway `indexer_test` schema).
