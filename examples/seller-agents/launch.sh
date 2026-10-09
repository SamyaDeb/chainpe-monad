#!/usr/bin/env bash
#
# Launch the agent-to-agent marketplace demo:
#   1. starts both LLM seller agents (each = LLM backend + ChainPe x402 proxy)
#   2. waits for them to be healthy
#   3. (REGISTER=1) registers each on-chain with its ERC-8004 agentId
#   4. (ORCHESTRATE=1) runs the buyer orchestrator that hires + pays both
#
# Prereqs: build the workspace packages once from the repo root
#   (npm install && npm run build), then `npm install` here, and fill in .env.
#
# Mint the seller identities first (one-time), then put the ids in .env:
#   SELLER_KEY=$RESEARCH_PAYTO_KEY node mint-identity.mjs   # → RESEARCH_AGENT_ID
#   SELLER_KEY=$DIGEST_PAYTO_KEY   node mint-identity.mjs   # → DIGEST_AGENT_ID
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] && set -a && . ./.env && set +a

RESEARCH_PROXY_PORT="${RESEARCH_PROXY_PORT:-4501}"
DIGEST_PROXY_PORT="${DIGEST_PROXY_PORT:-4502}"
PRICE_PROXY_PORT="${PRICE_PROXY_PORT:-4503}"
NEWS_PROXY_PORT="${NEWS_PROXY_PORT:-4504}"
ANALYSIS_PROXY_PORT="${ANALYSIS_PROXY_PORT:-4505}"
DEX_PROXY_PORT="${DEX_PROXY_PORT:-4506}"

pids=()
cleanup() {
  echo ""
  echo "Shutting down seller agents…"
  for pid in "${pids[@]:-}"; do kill "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT INT TERM

wait_healthy() {
  local url="$1" name="$2"
  for _ in $(seq 1 30); do
    if curl -fsS "$url/health" >/dev/null 2>&1; then echo "  ✓ $name healthy"; return 0; fi
    sleep 1
  done
  echo "  ✗ $name did not become healthy at $url" >&2
  return 1
}

echo "Starting seller agents…"
node research-agent.mjs &
pids+=($!)
node news-digest-agent.mjs &
pids+=($!)

# Investment agents (launched when INVEST=1 or INVEST_AGENTS=1)
if [ "${INVEST:-0}" = "1" ] || [ "${INVEST_AGENTS:-0}" = "1" ]; then
  node avax-price-agent.mjs &
  pids+=($!)
  node avax-news-agent.mjs &
  pids+=($!)
  node avax-analysis-agent.mjs &
  pids+=($!)
  node avax-dex-agent.mjs &
  pids+=($!)
fi

wait_healthy "http://localhost:${RESEARCH_PROXY_PORT}" "research-agent"
wait_healthy "http://localhost:${DIGEST_PROXY_PORT}" "news-digest-agent"
if [ "${INVEST:-0}" = "1" ] || [ "${INVEST_AGENTS:-0}" = "1" ]; then
  wait_healthy "http://localhost:${PRICE_PROXY_PORT}"    "avax-price-agent"
  wait_healthy "http://localhost:${NEWS_PROXY_PORT}"     "avax-news-agent"
  wait_healthy "http://localhost:${ANALYSIS_PROXY_PORT}" "avax-analysis-agent"
  wait_healthy "http://localhost:${DEX_PROXY_PORT}"      "avax-dex-agent"
fi

if [ "${REGISTER:-0}" = "1" ]; then
  echo ""
  echo "Registering sellers on-chain…"
  SELLER_KEY="${RESEARCH_PAYTO_KEY:?set RESEARCH_PAYTO_KEY to register}" \
  SELLER_NAME="${RESEARCH_NAME:-Research Agent}" \
  SELLER_ENDPOINT="${RESEARCH_PUBLIC_URL:-http://localhost:${RESEARCH_PROXY_PORT}}" \
  SELLER_PAYTO="${RESEARCH_PAYTO}" SELLER_TAGS="ai,research,agent" \
  SELLER_PRICE="${RESEARCH_PRICE:-0.01}" \
    node register-seller.mjs

  SELLER_KEY="${DIGEST_PAYTO_KEY:?set DIGEST_PAYTO_KEY to register}" \
  SELLER_NAME="${DIGEST_NAME:-News Digest Agent}" \
  SELLER_ENDPOINT="${DIGEST_PUBLIC_URL:-http://localhost:${DIGEST_PROXY_PORT}}" \
  SELLER_PAYTO="${DIGEST_PAYTO}" SELLER_TAGS="ai,news,summarize,agent" \
  SELLER_PRICE="${DIGEST_PRICE:-0.01}" \
    node register-seller.mjs

  # Register investment agents if INVEST=1
  if [ "${INVEST:-0}" = "1" ] || [ "${INVEST_AGENTS:-0}" = "1" ]; then
    SELLER_KEY="${PRICE_PAYTO_KEY:?set PRICE_PAYTO_KEY}" \
    SELLER_NAME="${PRICE_NAME:-AVAX Price Agent}" \
    SELLER_ENDPOINT="${PRICE_PUBLIC_URL:-http://localhost:${PRICE_PROXY_PORT}}" \
    SELLER_PAYTO="${PRICE_PAYTO}" SELLER_TAGS="avax,price,defi,data" \
    SELLER_PRICE="${PRICE_PRICE:-0.005}" \
      node register-seller.mjs

    SELLER_KEY="${NEWS_PAYTO_KEY:?set NEWS_PAYTO_KEY}" \
    SELLER_NAME="${NEWS_NAME:-AVAX News Agent}" \
    SELLER_ENDPOINT="${NEWS_PUBLIC_URL:-http://localhost:${NEWS_PROXY_PORT}}" \
    SELLER_PAYTO="${NEWS_PAYTO}" SELLER_TAGS="avax,news,avalanche,research" \
    SELLER_PRICE="${NEWS_PRICE:-0.02}" \
      node register-seller.mjs

    SELLER_KEY="${ANALYSIS_PAYTO_KEY:?set ANALYSIS_PAYTO_KEY}" \
    SELLER_NAME="${ANALYSIS_NAME:-AVAX Analysis Agent}" \
    SELLER_ENDPOINT="${ANALYSIS_PUBLIC_URL:-http://localhost:${ANALYSIS_PROXY_PORT}}" \
    SELLER_PAYTO="${ANALYSIS_PAYTO}" SELLER_TAGS="avax,analysis,trading,ai" \
    SELLER_PRICE="${ANALYSIS_PRICE:-0.05}" \
      node register-seller.mjs

    SELLER_KEY="${DEX_PAYTO_KEY:?set DEX_PAYTO_KEY}" \
    SELLER_NAME="${DEX_NAME:-AVAX DEX Agent}" \
    SELLER_ENDPOINT="${DEX_PUBLIC_URL:-http://localhost:${DEX_PROXY_PORT}}" \
    SELLER_PAYTO="${DEX_PAYTO}" SELLER_TAGS="avax,dex,swap,trading" \
    SELLER_PRICE="${DEX_PRICE:-0.01}" \
      node register-seller.mjs
  fi
fi

echo ""
echo "Sellers are live:"
echo "  research → http://localhost:${RESEARCH_PROXY_PORT}/research"
echo "  digest   → http://localhost:${DIGEST_PROXY_PORT}/summarize"
if [ "${INVEST:-0}" = "1" ] || [ "${INVEST_AGENTS:-0}" = "1" ]; then
  echo "  price    → http://localhost:${PRICE_PROXY_PORT}/price"
  echo "  news     → http://localhost:${NEWS_PROXY_PORT}/news"
  echo "  analysis → http://localhost:${ANALYSIS_PROXY_PORT}/analyze"
  echo "  dex      → http://localhost:${DEX_PROXY_PORT}/swap"
fi

if [ "${ORCHESTRATE:-0}" = "1" ]; then
  echo ""
  echo "Running buyer orchestrator…"
  node orchestrator.mjs "${TOPIC:-On-chain agent payments on Avalanche in 2026}"
elif [ "${INVEST:-0}" = "1" ]; then
  echo ""
  echo "Running investment orchestrator (live swaps)…"
  SIM_FLAG=""
  [ "${SIM:-0}" = "1" ] && SIM_FLAG="--sim"
  node investment-orchestrator.mjs ${SIM_FLAG} --cycles "${INVEST_CYCLES:-1}"
else
  echo ""
  echo "Run a buyer (in another shell):"
  echo "  npm run orchestrate -- \"your topic\"      # original demo"
  echo "  npm run invest                            # AVAX investment loop (real swaps)"
  echo "  SIM=1 npm run invest                      # AVAX investment loop (simulation only)"
  echo "Press Ctrl+C to stop the sellers."
  wait
fi
