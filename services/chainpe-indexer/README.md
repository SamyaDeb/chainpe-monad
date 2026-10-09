# ChainPe indexer (Monad)

Watches the **ChainPeRegistry** and the **canonical ERC-8004 Reputation Registry**
on Monad into Postgres, decides which feedback is backed by an x402 payment, and
serves discovery ranked by **paid** reputation — "no receipt, no rating".

```
ChainPeRegistry ──┐                                   ┌─ GET /services?rank=paid|raw
                  ├─ getLogs (100-block chunks) ─► PG ─┼─ GET /services/:id
ERC-8004 Rep ─────┘        │                          ├─ GET /services/:id/reputation
                           └─ verifier: feedbackHash  └─ GET /stats · /health
                              → settlement receipt
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
| `GET /stats` | `{ services, feedback, paidFeedback }` |
| `GET /health` | liveness + `lastIndexedBlock` / `chainHead` |

## Tests

`npm test` — pure verification/scoring tests plus a store → verifier → API test on
pg-mem. Set `TEST_DATABASE_URL=postgres://…` to run the latter on a real Postgres
(it uses a throwaway `indexer_test` schema).
