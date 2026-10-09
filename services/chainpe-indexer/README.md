# ChainPe indexer

Watches the **ChainPeRegistry** + **ERC-8004 Reputation** contracts on Avalanche
into Postgres and serves an **O(1) discovery + reputation REST API** — so clients
and the dashboard don't have to paginate the registry or scan feedback on-chain.

```
ChainPeRegistry ─┐                          ┌─ GET /services        (ranked by ⭐)
                 ├─ getLogs poll → Postgres ─┼─ GET /services/:id
ERC-8004 Rep ────┘                          ├─ GET /services/:id/reputation
                                            └─ GET /stats · /health
```

## How it works

- **Watcher** (`indexer.ts`): polls `getLogs` for `ServiceRegistered/Updated/
  Deregistered` and `NewFeedback/FeedbackRevoked`, in block-range chunks, advancing
  a cursor in `indexer_state` so restarts resume where they left off. Service rows
  are enriched with description + tags via a `getService` read (the events omit them).
- **Store** (`store.ts` + Drizzle/`schema.ts`): `services`, `feedback`,
  `indexer_state`. Schema is created idempotently on boot.
- **API** (`api.ts`): aggregates feedback into reputation (`aggregateReputation`,
  mirroring ERC-8004 `getSummary`) and ranks services (`rankServices`).

## Run locally

```bash
cp .env.example .env          # set DATABASE_URL (a local/Railway Postgres)
npm install
npm run dev                   # watcher + API on :4600
curl localhost:4600/services  # ranked services with reputation
```

## Deploy (Railway)

```bash
cd services/chainpe-indexer
railway init
railway add --database postgres        # provisions DATABASE_URL
railway variables --set NETWORK=avalanche --set START_BLOCK=<registry-deploy-block>
railway up
railway domain
```

`START_BLOCK` should be the registry's deploy block for a fast cold start (0 works
but back-scans from genesis, which is slow on public RPCs).

## API

| Endpoint | Returns |
|---|---|
| `GET /services?query=&tag=&maxPrice=` | active services + reputation, ranked best-first |
| `GET /services/:id` | one service (`:id` = `key` or `developer:name`) |
| `GET /services/:id/reputation` | `{ count, score }` aggregate |
| `GET /stats` | row counts |
| `GET /health` | liveness + `lastIndexedBlock` / `chainHead` |

## Tests

`npm test` covers the pure core (event→row mapping, reputation aggregation,
ranking) — no DB required.
