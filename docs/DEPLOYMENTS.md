# Deployments

Monad **testnet** only. Mainnet is not deployed (runbook: `docs/MAINNET-RUNBOOK.md`).
## Hosted services (Railway, Monad testnet) — live 2026-10-11

| Service | URL |
|---|---|
| Indexer (paid-reputation API) | https://indexer-production-50cd.up.railway.app |
| Facilitator (x402 v2: `exact` + `chainpe-vault`, strict payTo policy) | https://facilitator-production-8cc9.up.railway.app |
| Marketplace (Vercel, reads the hosted indexer live) | https://chainpe-monad-marketplace.vercel.app |
| Seller `monad-network-stats` (agent #2133, 0.001 USDC/call) | https://seller-production-ea9b.up.railway.app/stats |

The seller was verified through the hosted stack: a paid call returned HTTP 200 and was settled
on-chain by the hosted facilitator ([0x8096d313…](https://testnet.monadvision.com/tx/0x8096d31353ee9e7f731ba82502bb9e55c5aac16da1f276ba24eac0a2237c49cb)).
Its registry entry points at the public URL ([tx](https://testnet.monadvision.com/tx/0xc9dc5d78778e402e2d1b4f85b607efb2d37f2d59f5befb390306eb93d78ac807)).
Demo traffic between team-controlled wallets — not traction. Re-deploy with `Dockerfile.seller`
(seller, repo-root context) and each service's own Dockerfile.

## Contracts — Monad testnet (`eip155:10143`)

| Contract | Address | Source |
|---|---|---|
| ChainPeRegistry (UUPS proxy) | [`0xe41CEcC51A61921dDFCeCAa9807856C446867CA4`](https://testnet.monadvision.com/address/0xe41CEcC51A61921dDFCeCAa9807856C446867CA4) | `contracts/deployments/monadTestnet.json` (impl `0x996A3FA1EC7A323EF173cd7DC8e076BA6358885C`), deploy block 69,658,414 |
| PolicyVault (UUPS proxy) | [`0x1Eb25cDD00bCCEC89782Aaf12600Ac5eFeEeAB65`](https://testnet.monadvision.com/address/0x1Eb25cDD00bCCEC89782Aaf12600Ac5eFeEeAB65) | `contracts/deployments/monadTestnet-policyvault.json` (impl `0xa4120C7C6b74CF20dc39979919687Cb9396C458f`) |
| ERC-8004 Identity Registry (canonical) | [`0x8004A818BFB912233c491871b3d84c89A494BD9e`](https://testnet.monadvision.com/address/0x8004A818BFB912233c491871b3d84c89A494BD9e) | not ours |
| ERC-8004 Reputation Registry (canonical) | [`0x8004B663056A597Dffe9eCcC1965A193B7388713`](https://testnet.monadvision.com/address/0x8004B663056A597Dffe9eCcC1965A193B7388713) | not ours |
| USDC (Circle) | [`0x534b2f3A21130d7a60830c2Df862319e593943A3`](https://testnet.monadvision.com/address/0x534b2f3A21130d7a60830c2Df862319e593943A3) | not ours |

Both ChainPe contracts were deployed 2026-10-09 and verified (Sourcify). The SDK's
defaults (`packages/chainpe-sdk/src/networks.ts`) point at them.

## Demo agents — Monad testnet

ERC-8004 agentIds on the canonical Identity Registry, each with a service in the
ChainPeRegistry. All ratings and payments for them are **demo traffic from team wallets,
not traction**.

| Agent | Service | Notes |
|---|---|---|
| #2099 | monad-weather-demo | Phase 4 "no receipt, no rating" demo: paid 95 vs raw 98.33 (two unpaid ratings excluded) |
| #2101 | monad-network-stats | seller agents, settled through Monad's public facilitator |
| #2102 | mon-price-quote | 〃 |
| #2103 | monad-ecosystem-digest | 〃 |
| #2104 | agent-trust-report | 〃 |
| #2107 | monad-network-stats | seller agents, settled through ChainPe's own facilitator |
| #2108 | mon-price-quote | 〃 |
| #2109 | monad-ecosystem-digest | 〃 |
| #2110 | agent-trust-report | 〃 |

Except #2133 (hosted, above), their endpoints ran inside our build session and are not publicly reachable. Every
settlement and rating hash: `examples/seller-agents/receipts-monad-testnet.json`; the
indexer's view: `apps/marketplace/data/snapshot-monad-testnet.json`.

## Run the indexer + facilitator (Docker Compose)

`deploy/docker-compose.yml` runs Postgres, the indexer (`:4600`) and the facilitator
(`:4500`) from the same Dockerfiles Railway builds.

```bash
cp deploy/.env.example deploy/.env
# set FACILITATOR_PRIVATE_KEY: a throwaway testnet key with some MON (it only pays gas)
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
curl localhost:4600/health        # indexer: catches up from the registry deploy block
curl localhost:4500/supported     # facilitator: exact (+ chainpe-vault) on eip155:10143
```

Testnet needs no addresses: the services default to the deployments above. The facilitator
reads registered payTo addresses from the indexer (`CHAINPE_INDEXER_URL=http://indexer:4600`)
for its payTo policy. Compose needs `FACILITATOR_PRIVATE_KEY` even to start only the
indexer, so for a read-only setup use the next section.

## Run only the indexer (no keys)

```bash
docker run -d --name chainpe-pg -e POSTGRES_PASSWORD=pg -p 5432:5432 postgres:16-alpine
npm ci --prefix services/chainpe-indexer
NETWORK=monad-testnet DATABASE_URL=postgres://postgres:pg@localhost:5432/postgres \
  npm run dev --prefix services/chainpe-indexer
```

From the registry deploy block it caught up to the testnet head in about 8 minutes over
the public RPC (100-block `eth_getLogs` chunks). Behind an HTTP proxy, Node needs
`NODE_USE_ENV_PROXY=1`. API: `docs/INDEXER-API.md`.

## Run the marketplace

```bash
npm ci && npm run build      # repo root
NEXT_PUBLIC_CHAINPE_INDEXER_URL=http://localhost:4600 npm run start -w @chainpemonad/marketplace   # :3000
```

Without a reachable indexer it serves the committed snapshot and says so on every page.

## Not done yet

- Public hosting of the indexer, facilitator and marketplace (Railway configs and
  Dockerfiles are ready; `docs/MAINNET-RUNBOOK.md` §2).
- Anything on Monad mainnet.
