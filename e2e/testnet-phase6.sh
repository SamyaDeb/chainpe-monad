#!/usr/bin/env bash
# Phase 6 on Monad TESTNET with our own stack: indexer + facilitator + 4 seller agents, paid by
# the SDK orchestrator, the Claude MCP wallet and a stock @x402/fetch client; then the indexer's
# paid-reputation ranking is snapshotted and latency is benchmarked through our facilitator.
#
#   npm ci && npm run build                     # repo root, once
#   bash e2e/testnet-phase6.sh
#
# Needs:
#   examples/seller-agents/.env.sellers  BUYER/FACILITATOR/STATS/PRICE/DIGEST/TRUST keys and
#     *_AGENT_ID from an earlier gen-wallets + setup run. If it is missing and
#     DEPLOYER_PRIVATE_KEY is set (a testnet deployer with MON), the script creates and funds the
#     wallets and registers the agents. The BUYER still needs testnet USDC (Circle faucet).
#   Postgres: DATABASE_URL, or Docker (a postgres:16 container is started).
# Env: ROUNDS (orchestrator rounds, default 3 → 12 calls), BENCH_N (default 20), MONAD_TESTNET_RPC_URL.
# Writes: examples/seller-agents/receipts-monad-testnet.json (appended),
#         examples/seller-agents/indexer-snapshot-monad-testnet.json,
#         examples/monad-bench/results-monad-testnet-own-facilitator.json
# All payments are between team-controlled wallets: demo traffic, not traction.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SA="$ROOT/examples/seller-agents"
LOGS="$(mktemp -d)"
export NETWORK=monad-testnet
# Cloud sandbox: Node's fetch only uses the proxy with this flag.
if [[ -n "${HTTPS_PROXY:-${https_proxy:-}}" ]]; then export NODE_USE_ENV_PROXY=1 NODE_NO_WARNINGS=1; fi
IDX=http://localhost:4600
FAC=http://localhost:4500
PIDS=()
PG_CONTAINER=""
cleanup() {
  for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done
  [[ -n "$PG_CONTAINER" ]] && docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
  echo "logs: $LOGS"
}
trap cleanup EXIT
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
envvar() { grep -E "^$1=" "$SA/.env.sellers" | cut -d= -f2-; }
wait_http() { for _ in $(seq 1 60); do curl -sf "$1" >/dev/null && return 0; sleep 1; done; echo "timeout: $1"; return 1; }

step "0. wallets + agents"
cd "$SA"
if [[ ! -f .env.sellers ]]; then
  [[ -n "${DEPLOYER_PRIVATE_KEY:-}" ]] || { echo "No $SA/.env.sellers and no DEPLOYER_PRIVATE_KEY"; exit 1; }
  node gen-wallets.mjs
  node fund.mjs
  node setup.mjs
fi
for k in BUYER_KEY FACILITATOR_KEY STATS_KEY STATS_AGENT_ID; do
  [[ -n "$(envvar $k)" ]] || { echo "$k missing in .env.sellers (run setup.mjs)"; exit 1; }
done

step "1. Postgres"
if [[ -z "${DATABASE_URL:-}" ]]; then
  PG_CONTAINER="chainpe-phase6-pg-$$"
  # Docker Hub rate-limits anonymous pulls; fall back to Google's mirror.
  docker image inspect postgres:16-alpine >/dev/null 2>&1 || docker pull -q postgres:16-alpine >/dev/null 2>&1 || \
    { docker pull -q mirror.gcr.io/library/postgres:16-alpine >/dev/null && docker tag mirror.gcr.io/library/postgres:16-alpine postgres:16-alpine; }
  docker run -d --name "$PG_CONTAINER" -e POSTGRES_PASSWORD=chainpe -e POSTGRES_DB=chainpe_indexer \
    -p 55432:5432 postgres:16-alpine >/dev/null
  export DATABASE_URL=postgres://postgres:chainpe@localhost:55432/chainpe_indexer
  for _ in $(seq 1 30); do docker exec "$PG_CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
fi

step "2. indexer (from the registry deploy block)"
(cd "$ROOT/services/chainpe-indexer" && { [[ -d node_modules ]] || npm ci --silent; })
(cd "$ROOT/services/chainpe-indexer" && npm run build --silent >/dev/null && TRUST_PROXY=false exec node dist/server.js >"$LOGS/indexer.log" 2>&1) &
PIDS+=($!)
wait_http "$IDX/health"
caught_up() {
  curl -s "$IDX/health" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const h=JSON.parse(s);const last=BigInt(h.lastIndexedBlock??0),head=BigInt(h.chainHead??0);console.log(`indexed ${last} / head ${head}`);process.exit(head>0n&&last+50n>=head?0:1)})'
}
until caught_up; do sleep 10; done

step "3. facilitator (strict: registered payTo only)"
(cd "$ROOT/services/chainpe-facilitator" && { [[ -d node_modules ]] || npm ci --silent; })
(cd "$ROOT/services/chainpe-facilitator" && npm run build --silent >/dev/null && \
  FACILITATOR_PRIVATE_KEY="$(envvar FACILITATOR_KEY)" CHAINPE_INDEXER_URL=$IDX REQUIRE_REGISTERED_PAYTO=true \
  TRUST_PROXY=false exec node dist/server.js >"$LOGS/facilitator.log" 2>&1) &
PIDS+=($!)
wait_http "$FAC/health"
curl -s "$FAC/health"; echo
curl -s "$FAC/supported"; echo

step "4. seller agents behind ChainPe proxies → our facilitator"
(cd "$SA" && CHAINPE_FACILITATOR_URL=$FAC CHAINPE_INDEXER_URL=$IDX exec node run-sellers.mjs >"$LOGS/sellers.log" 2>&1) &
PIDS+=($!)
# The proxies gate every path (402), so wait for any HTTP answer from the last one.
for _ in $(seq 1 60); do [[ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:4604/)" != 000 ]] && break; sleep 1; done
grep '✓' "$LOGS/sellers.log" || { cat "$LOGS/sellers.log"; exit 1; }

step "5. SDK orchestrator: ${ROUNDS:-3} rounds, pay + receipt-backed feedback"
(cd "$SA" && ROUNDS="${ROUNDS:-3}" CHAINPE_FACILITATOR_URL=$FAC node orchestrator.mjs)

step "6. Claude MCP wallet: search_bazaar → pay → give_feedback"
(cd "$SA" && CHAINPE_INDEXER_URL=$IDX node mcp-buyer.mjs)

step "7. stock @x402/fetch client (no ChainPe SDK) pays a ChainPe seller"
(cd "$SA" && node standard-client.mjs)

step "8. our facilitator refuses an unregistered payTo"
RANDOM_PAYTO=0x$(openssl rand -hex 20)
if (cd "$ROOT" && BUYER_PRIVATE_KEY="$(envvar BUYER_KEY)" SELLER_ADDRESS=$RANDOM_PAYTO CHAINPE_FACILITATOR_URL=$FAC \
    node e2e/monad-paid-call.mjs >"$LOGS/unregistered.log" 2>&1); then
  echo "UNEXPECTED: payment to unregistered $RANDOM_PAYTO went through"; exit 1
fi
grep -o 'payto_not_registered[^"]*' "$LOGS/unregistered.log" | head -1 || tail -3 "$LOGS/unregistered.log"

step "9. latency through our facilitator (${BENCH_N:-20} calls)"
STATS_ADDR=$(node -e "import('viem/accounts').then(m=>console.log(m.privateKeyToAccount(process.argv[1]).address))" "$(envvar STATS_KEY)")
(cd "$ROOT/examples/monad-bench" && BUYER_PRIVATE_KEY="$(envvar BUYER_KEY)" SELLER_ADDRESS=$STATS_ADDR \
  CHAINPE_FACILITATOR_URL=$FAC N="${BENCH_N:-20}" node bench.mjs | tee "$LOGS/bench.log")
tail -1 "$LOGS/bench.log" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify({...JSON.parse(s),facilitator:"ChainPe (own, strict payTo)",label:"demo traffic (team wallets), not traction"},null,2)))' \
  > "$ROOT/examples/monad-bench/results-monad-testnet-own-facilitator.json"

step "10. paid-reputation ranking from the indexer"
sleep 15; until caught_up; do sleep 5; done
node --input-type=module -e '
import fs from "node:fs"
const idx = process.argv[1], out = process.argv[2]
const get = p => fetch(idx + p).then(r => r.json())
const paid = await get("/services?rank=paid"), raw = await get("/services?rank=raw")
const reputation = {}
for (const s of paid.items) reputation[s.id] = await get(`/services/${encodeURIComponent(s.id)}/reputation`)
fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), network: "monad-testnet",
  label: "ratings from team-controlled demo wallets, not traction", paid, raw, reputation }, null, 2) + "\n")
for (const s of paid.items) console.log(`${(s.agentId ?? "-").padStart(5)} ${s.name.padEnd(24)} paid ${JSON.stringify(s.reputationDetail?.paid)}  raw ${JSON.stringify(s.reputationDetail?.raw)}`)
' "$IDX" "$SA/indexer-snapshot-monad-testnet.json"

step "done"
echo "receipts:  $SA/receipts-monad-testnet.json"
echo "snapshot:  $SA/indexer-snapshot-monad-testnet.json"
echo "bench:     $ROOT/examples/monad-bench/results-monad-testnet-own-facilitator.json"
