/**
 * ChainPe x402 Proxy — Railway deployment (Avalanche C-Chain)
 *
 * A minimal, self-contained x402 payment proxy built on Coinbase's x402-express.
 * All configuration comes from environment variables:
 *
 *   TARGET_URL        The backend API to proxy (required)
 *   WALLET_ADDRESS    EVM address (0x) that receives payments (required)
 *   PRICE             Price per request in USDC, e.g. "0.02" (default: "0.02")
 *   NETWORK           "fuji" or "avalanche" (default: "fuji")
 *   FACILITATOR_URL   x402 facilitator that verifies + settles payments (required
 *                     for settlement on Avalanche; the public Coinbase facilitator
 *                     only covers Base)
 *   SERVICE_NAME      Display name (default: "ChainPe Service")
 *   PORT              HTTP port (Railway injects this automatically)
 *
 * Payments are USDC via x402 (EIP-3009). The payer signs the authorization; the
 * facilitator submits it on-chain and pays the gas.
 */

import express from 'express'
import cors from 'cors'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { paymentMiddleware } from 'x402-express'

// ── Config from environment ────────────────────────────────────────────────

const TARGET_URL = process.env.TARGET_URL
const WALLET_ADDRESS = process.env.WALLET_ADDRESS
const PRICE = process.env.PRICE ?? '0.02'
const NETWORK = process.env.NETWORK ?? 'fuji'
const FACILITATOR_URL = process.env.FACILITATOR_URL
const SERVICE_NAME = process.env.SERVICE_NAME ?? 'ChainPe Service'
const PORT = parseInt(process.env.PORT ?? '4402', 10)

if (!TARGET_URL) {
  console.error('Missing env: TARGET_URL')
  process.exit(1)
}
if (!WALLET_ADDRESS) {
  console.error('Missing env: WALLET_ADDRESS')
  process.exit(1)
}

const X402_NETWORK = NETWORK === 'avalanche' ? 'avalanche' : 'avalanche-fuji'

// ── Server ───────────────────────────────────────────────────────────────────

const app = express()
app.use(cors())

// Health check (not gated)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: SERVICE_NAME, network: NETWORK })
})

// x402 payment gate — USDC on Avalanche. "/*" gates every proxied path.
app.use(
  paymentMiddleware(
    WALLET_ADDRESS,
    {
      '/*': {
        price: `$${PRICE}`,
        network: X402_NETWORK,
        config: { description: `Pay ${PRICE} USDC per request` }
      }
    },
    FACILITATOR_URL ? { url: FACILITATOR_URL } : undefined,
    { appName: SERVICE_NAME }
  )
)

// Reverse proxy to the backend
app.use('/', createProxyMiddleware({ target: TARGET_URL, changeOrigin: true }))

app.listen(PORT, () => {
  console.log(`ChainPe proxy "${SERVICE_NAME}" listening on :${PORT}`)
  console.log(`  → proxying ${TARGET_URL}`)
  console.log(`  → ${PRICE} USDC per request on ${NETWORK} (${X402_NETWORK})`)
  if (!FACILITATOR_URL) {
    console.warn('  ⚠ FACILITATOR_URL not set — payments cannot be settled on Avalanche.')
  }
})
