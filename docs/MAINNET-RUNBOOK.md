# Phase 6 runbook: ChainPe on Monad mainnet

These are the steps, in order, to take ChainPe from testnet to **Monad mainnet** (`monad`, chain 143).
Each step says what it needs and how to check it worked. Everything here is opt-in: code
still defaults to `monad-testnet`.

**Funding (from `MONAD-PLAN.md` Phase 0 step 5):** about 25 MON split between `DEPLOYER`
and `FACILITATOR`, about 10 USDC on `BUYER`, and a little MON on each seller wallet for the
mint and register txs. Deploys and settlements send no MON value, so the 10 MON reserve
rule doesn't affect them. Wallets that *send* MON (e.g. `fund.mjs`) must stay above 10 MON.

All commands run from the repo root after `npm ci && npm run build`. Keys go in environment
variables only. Never put them in files that get committed.

---

## 1. Contracts (Registry + PolicyVault)

```bash
cd contracts && npm ci
export DEPLOYER_PRIVATE_KEY=0x…            # mainnet deployer (fresh key)
export OWNER_ADDRESS=0x…                   # Safe, if Safe is live on Monad; otherwise:
# export ALLOW_DEPLOYER_OWNER=true         # …and disclose it in the README
npm run preflight:mainnet                  # chain id, balance, USDC + ERC-8004 code checks
npm run deploy:mainnet                     # → deployments/monad.json (incl. deployBlock)
npm run deploy:policyvault:mainnet         # → deployments/monad-policyvault.json
npm run postcheck:mainnet
npm run verify:mainnet                     # Sourcify / MonadVision (Monadscan if ETHERSCAN_API_KEY)
```

**Check:** both proxies show as verified on `https://monadvision.com/address/<proxy>`.

**Record the addresses** (one commit, `deploy registry + PolicyVault to Monad mainnet`):
- `packages/chainpe-sdk/src/networks.ts`: set `chainPeRegistry` and `policyVault` for `monad`.
- `services/chainpe-indexer/src/config.ts`: set `registry`, `policyVault` and
  `registryDeployBlock` (= `deployBlock` from `deployments/monad.json`) for `monad`.
- `services/chainpe-facilitator/src/config.ts`: set `policyVault` for `monad`.
- The constants table in `CLAUDE.md`, plus `docs/METROPOLIS.md` with the tx links.

Until those defaults land, pass the same values as env (`CHAINPE_REGISTRY_ADDRESS`,
`POLICY_VAULT_ADDRESS`, `START_BLOCK`). On mainnet the indexer refuses to start without a
start block, because otherwise it would scan from genesis.

## 2. Hosting: indexer + facilitator

Both services build from their own `Dockerfile` (the same image locally and on Railway).

### Option A: Railway
1. New project → **Add Postgres**.
2. **Indexer** service: deploy from this repo, root directory `services/chainpe-indexer`
   (it picks up `railway.json` and the Dockerfile). Variables:
   `NETWORK=monad`, `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `CHAINPE_REGISTRY_ADDRESS`,
   `POLICY_VAULT_ADDRESS`, `START_BLOCK`, optionally `RPC_URL` (a paid RPC; the public
   one caps `getLogs` at about 100 blocks). Generate a public domain.
3. **Facilitator** service: root directory `services/chainpe-facilitator`. Variables:
   `NETWORK=monad`, `FACILITATOR_PRIVATE_KEY`, `CHAINPE_INDEXER_URL=https://<indexer domain>`,
   `POLICY_VAULT_ADDRESS`, optionally `RPC_URL`. Leave `REQUIRE_REGISTERED_PAYTO` unset:
   mainnet is strict by default, so only payTo addresses registered in ChainPeRegistry get
   settled. Generate a public domain.

### Option B: any Docker host
```bash
cp deploy/.env.example deploy/.env        # NETWORK=monad, key, registry, START_BLOCK, vault
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```
This was verified on testnet settings in the cloud sandbox: Postgres, indexer and facilitator start,
`/health` and `/supported` answer, and both services retry with backoff when the RPC is
unreachable instead of crashing.

**Check:**
```bash
curl https://<facilitator>/health      # status ok, network monad, caip2 eip155:143
curl https://<facilitator>/supported   # exact (+ chainpe-vault) on eip155:143
curl https://<indexer>/health          # lastIndexedBlock climbing toward chainHead
```
Fund the facilitator gas key (about 1 MON covers hundreds of settlements at about 137k gas
each). `/health` reports `degraded` below `LOW_GAS_MON`.

## 3. Seller agents on mainnet

```bash
cd examples/seller-agents
export NETWORK=monad CHAINPE_FACILITATOR_URL=https://<facilitator> CHAINPE_INDEXER_URL=https://<indexer>
export CHAINPE_REGISTRY_ADDRESS=0x…       # until networks.ts has the mainnet default
node gen-wallets.mjs                      # new mainnet keys → .env.sellers (git-ignored)
# fund each seller with a little MON by hand from a >10 MON wallet (fund.mjs is testnet only)
ENDPOINT_BASE=https://<public host> node setup.mjs   # mint ERC-8004 agentIds (canonical mainnet registry) + register
node run-sellers.mjs
```
**Check:** the services appear in `GET https://<indexer>/services`. The facilitator picks up
their payTo addresses within 60 s.

## 4. Buyer: real USDC + receipt-backed feedback

```bash
ROUNDS=3 node orchestrator.mjs            # ≥10 paid calls → receipts-monad.json
```
Claude Desktop: install the MCP wallet (`.mcpb`) with network `monad`, a per-call cap, a
daily budget, the indexer URL and (until the SDK default lands) the registry address, then
ask it to call one of the services and rate it.
**Label all of this as demo traffic.** Payments between team wallets are not traction.

## 5. External x402 service (Nansen)

```bash
DRY_RUN=1 NETWORK=monad node e2e/pay-external.mjs                       # check the live offer first
BUYER_PRIVATE_KEY=0x… NETWORK=monad MAX_PER_CALL=0.05 node e2e/pay-external.mjs
```
The script decodes Nansen's `PAYMENT-REQUIRED` and shows which offer the SDK would sign
(exact, `eip155:143`, Monad USDC, within the cap). It pays through the SDK, verifies the
USDC `Transfer` buyer → payTo on-chain, and appends the receipt to
`e2e/external-payments.json`. `TARGET_URL` / `METHOD` / `BODY` point it at any other x402
service (e.g. an API Hub seller).
Then send the outreach in `docs/OUTREACH-DRAFTS.md` (the owner reviews and sends it).

## 6. Benchmark on mainnet

```bash
cd examples/monad-bench
BUYER_PRIVATE_KEY=0x… SELLER_ADDRESS=0x… NETWORK=monad CHAINPE_FACILITATOR_URL=https://<facilitator> N=20 node bench.mjs
```
Quote only the numbers this run measures (p50/p95 of 402 → settled → 200).

---

**Phase 6 is done when:** at least 10 mainnet paid calls with receipts (labelled demo traffic),
at least 1 external x402 service paid, and mainnet latency measured. Every tx link goes in
`docs/METROPOLIS.md`.
