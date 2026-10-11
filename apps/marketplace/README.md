# ChainPe marketplace (Monad testnet)

Next.js (App Router) front end for the ChainPe indexer: x402 services ranked by
**payment-backed** ERC-8004 reputation, with the ratings and receipts behind each score.

| Page | What it shows |
|---|---|
| `/` | landing page: pitch, how the loop works, numbers, use cases, FAQ |
| `/services` (`?rank=paid\|raw`) | registered services ranked by paid reputation, with a paid ↔ raw toggle; score, distinct payers, paid volume, and the gap when unpaid ratings inflate the raw score |
| `/services/<developer:name>` | description, price, endpoint, ERC-8004 agentId, both scores, and every rating marked **paid** (settlement on MonadVision) or **excluded** (with the reason) |
| `/receipts` (`?show=paid\|excluded\|all`) | latest paid calls and ratings, linked to `testnet.monadvision.com/tx/…` |
| `/try` | judge path: faucets, provider in one command, consumer in three lines, MCP wallet |

Every payment and rating on testnet is demo traffic from team wallets; the site says so on every page.

## Data source

Pages render on the server from `NEXT_PUBLIC_CHAINPE_INDEXER_URL` (`/health`, `/stats`,
`/services`, `/services/:id/feedback`, `/feedback?registered=true`). If it is unset or does
not answer within 5 s, they use `data/snapshot-monad-testnet.json` and show
"Snapshot of <date> · live data unavailable: <reason>". The snapshot is real indexer
output, refreshed with:

```bash
NEXT_PUBLIC_CHAINPE_INDEXER_URL=http://localhost:4600 npm run snapshot
```

## Run

```bash
npm ci && npm run build                     # repo root (builds the SDK this app uses)
cp apps/marketplace/.env.example apps/marketplace/.env.local
npm run dev -w @chainpemonad/marketplace     # http://localhost:3000
npm test -w @chainpemonad/marketplace        # data layer: live vs snapshot fallback
```

The indexer is `services/chainpe-indexer` (see its README, or `docs/DEPLOYMENTS.md`).

Ported from the pre-existing ChainPe dashboard (`apps/dashboard` in commit `8659c44`, see `PRIOR_WORK.md`):
the theme toggle, header, copy box, security headers and the mono design tokens. The
marketing pages, Docusaurus docs and browser register flow were not ported.
