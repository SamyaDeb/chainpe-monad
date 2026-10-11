#!/usr/bin/env node
/**
 * Pay an existing (non-ChainPe) x402 v2 service on Monad with the ChainPe SDK —
 * Phase 6 step 5. Default target: Nansen's smart-money holdings endpoint, which
 * offers `exact` USDC on Monad mainnet (eip155:143).
 *
 *   # look only: fetch the 402, decode PAYMENT-REQUIRED, run the SDK's offer checks
 *   DRY_RUN=1 NETWORK=monad node e2e/pay-external.mjs
 *
 *   # pay (needs mainnet USDC on the buyer)
 *   BUYER_PRIVATE_KEY=0x… NETWORK=monad MAX_PER_CALL=0.05 node e2e/pay-external.mjs
 *
 * Env:
 *   TARGET_URL        x402 endpoint (default Nansen smart-money holdings)
 *   METHOD            HTTP method (default POST for the default target, else GET)
 *   BODY              JSON request body (default: Nansen holdings query on Monad)
 *   NETWORK           monad (default) | monad-testnet
 *   MAX_PER_CALL      USDC cap per call — the SDK refuses a dearer offer (default 0.05)
 *   BUYER_PRIVATE_KEY wallet holding USDC on NETWORK (not needed with DRY_RUN=1)
 *   DRY_RUN=1         never sign; only show the offers and whether the SDK would pay
 *   OUT               append the receipt to this JSON file (default e2e/external-payments.json)
 *
 * The settlement is verified on-chain (receipt status 1 + a USDC Transfer from the
 * buyer to the offer's payTo) before it is recorded. Paying an external service from a
 * team wallet is an integration check, not traction.
 *
 * Build first:  npm run build
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, http, parseUnits, formatUnits, parseEventLogs, erc20Abi } from 'viem'
import {
  ChainPe,
  checkOffer,
  chainFor,
  rpcUrlFor,
  getNetwork,
  explorerTxUrl,
  isChainPeNetwork
} from '@chainpemonad/sdk'

const NANSEN = 'https://api.nansen.ai/api/v1/smart-money/holdings'
const target = process.env.TARGET_URL ?? NANSEN
const method = process.env.METHOD ?? (target === NANSEN ? 'POST' : 'GET')
const body =
  process.env.BODY ?? (target === NANSEN ? JSON.stringify({ chains: ['monad'], pagination: { page: 1, per_page: 10 } }) : undefined)
const network = process.env.NETWORK ?? 'monad'
if (!isChainPeNetwork(network)) (console.error(`Unknown NETWORK ${network}`), process.exit(1))
const maxPerCall = process.env.MAX_PER_CALL ?? '0.05'
const maxAtomic = parseUnits(maxPerCall, 6)
const dryRun = process.env.DRY_RUN === '1'
const here = path.dirname(fileURLToPath(import.meta.url))
const out = process.env.OUT ?? path.join(here, 'external-payments.json')

const init = {
  method,
  headers: body ? { 'content-type': 'application/json' } : {},
  ...(body ? { body } : {})
}

// 1. Look at the 402 ourselves so the offers are on record even when we don't pay.
const probe = await fetch(target, init)
console.log(`${method} ${target} → HTTP ${probe.status}`)
if (probe.status !== 402) {
  console.error('Expected 402 Payment Required — nothing to pay.')
  console.error((await probe.text()).slice(0, 500))
  process.exit(1)
}
const header = probe.headers.get('payment-required')
if (!header) (console.error('402 without a PAYMENT-REQUIRED header (not x402 v2).'), process.exit(1))
const required = JSON.parse(Buffer.from(header, 'base64').toString('utf8'))
const offers = required.accepts ?? []
console.log(`x402 v${required.x402Version}, ${offers.length} offer(s):`)
for (const o of offers) {
  const check = checkOffer(o, network, maxAtomic)
  const amount = /^\d+$/.test(o.amount ?? '') ? `${formatUnits(BigInt(o.amount), 6)} (atomic ${o.amount})` : o.amount
  console.log(`  ${o.scheme} ${o.network} asset ${o.asset} amount ${amount} payTo ${o.payTo}`)
  console.log(`    → ${check.ok ? 'SDK would pay' : `SDK refuses: ${check.reason}`}`)
}
const payable = offers.find(o => checkOffer(o, network, maxAtomic).ok)
if (!payable) (console.error(`No offer the SDK will pay on ${network} within ${maxPerCall} USDC.`), process.exit(1))
if (dryRun) (console.log('DRY_RUN=1 — not paying.'), process.exit(0))

// 2. Pay through the SDK (same exact / network / USDC / maxPerCall checks).
const key = process.env.BUYER_PRIVATE_KEY || (console.error('Missing BUYER_PRIVATE_KEY'), process.exit(1))
const cp = new ChainPe({
  privateKey: key,
  network,
  maxPerCall,
  autoFeedback: false,
  registryAddress: '0x000000000000000000000000000000000000dEaD'
})
const buyer = cp.getAddress()
console.log(`buyer ${buyer}`, await cp.balance())
const t0 = performance.now()
const r = await cp.pay(target, init)
const ms = Math.round(performance.now() - t0)
console.log(`HTTP ${r.status} in ${ms} ms`)
console.log(JSON.stringify(r.data)?.slice(0, 400))
const txHash = r.payment?.txHash
if (!txHash) (console.error('No settlement tx reported — not recorded.'), process.exit(1))

// 3. Verify the settlement on-chain before recording it.
const net = getNetwork(network)
const client = createPublicClient({ chain: chainFor(network), transport: http(rpcUrlFor(network)) })
const receipt = await client.waitForTransactionReceipt({ hash: txHash })
const transfer = parseEventLogs({ abi: erc20Abi, logs: receipt.logs, eventName: 'Transfer' }).find(
  l =>
    l.address.toLowerCase() === net.usdc.address.toLowerCase() &&
    l.args.from.toLowerCase() === buyer.toLowerCase() &&
    l.args.to.toLowerCase() === payable.payTo.toLowerCase()
)
if (receipt.status !== 'success' || !transfer) {
  console.error(`Settlement ${txHash} did not move USDC ${buyer} → ${payable.payTo}`)
  process.exit(1)
}
const record = {
  at: new Date().toISOString(),
  label: 'integration check from a team wallet — not traction',
  target,
  method,
  network,
  status: r.status,
  latencyMs: ms,
  payer: buyer,
  payTo: payable.payTo,
  amountUsdc: formatUnits(transfer.args.value, 6),
  txHash,
  explorer: explorerTxUrl(network, txHash)
}
const log = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : []
log.push(record)
fs.writeFileSync(out, JSON.stringify(log, null, 2) + '\n')
console.log(`paid ${record.amountUsdc} USDC → ${record.explorer} (recorded in ${path.relative(process.cwd(), out)})`)
