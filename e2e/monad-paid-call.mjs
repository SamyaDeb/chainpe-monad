#!/usr/bin/env node
/**
 * End-to-end paid call on Monad: tiny API → ChainPe proxy → SDK pays in USDC.
 * Prints the settlement tx link and the 402 → paid → 200 latency.
 *
 *   BUYER_PRIVATE_KEY=0x…  SELLER_ADDRESS=0x…  node e2e/monad-paid-call.mjs
 *
 * Env:
 *   BUYER_PRIVATE_KEY   wallet holding USDC on the target network (required)
 *   SELLER_ADDRESS      payTo address (required; must be registered or allow-listed
 *                       on the facilitator if it enforces that)
 *   NETWORK             monad-testnet (default) | monad
 *   CHAINPE_FACILITATOR_URL  defaults to Monad's public testnet facilitator on testnet;
 *                       required on mainnet (run services/chainpe-facilitator)
 *   PRICE               USDC per call (default 0.01)
 *   CALLS               number of paid calls (default 1) — reports p50/p95
 *   AGENT_ID            seller's ERC-8004 agent id (advertised on the 402)
 *   FEEDBACK            0–100: after paying, post receipt-backed ERC-8004 feedback for
 *                       AGENT_ID on the canonical Reputation Registry, with the first
 *                       settlement tx as feedbackHash (the buyer needs a little MON for gas)
 *
 * Build first:  npm run build
 */
import express from 'express'
import { ChainPe, explorerTxUrl, isChainPeNetwork } from '@chainpemonad/sdk'
import { createProxyServer, resolveFacilitatorUrl } from '@chainpemonad/cli'

const need = name => process.env[name] || (console.error(`Missing ${name}`), process.exit(1))
const key = need('BUYER_PRIVATE_KEY')
const seller = need('SELLER_ADDRESS')
const network = process.env.NETWORK ?? 'monad-testnet'
if (!isChainPeNetwork(network)) (console.error(`Unknown NETWORK ${network}`), process.exit(1))
const price = process.env.PRICE ?? '0.01'
const calls = Number(process.env.CALLS ?? 1)

const config = {
  serviceName: 'ChainPe e2e',
  serviceDescription: 'e2e',
  tags: ['e2e'],
  targetUrl: '',
  pricePerRequest: price,
  paymentToken: 'USDC',
  walletAddress: seller,
  proxyPort: 0,
  network,
  ...(process.env.AGENT_ID ? { agentId: process.env.AGENT_ID } : {})
}
if (!resolveFacilitatorUrl(config)) {
  console.error(`No facilitator for ${network}: set CHAINPE_FACILITATOR_URL`)
  process.exit(1)
}

const listen = app => new Promise(res => {
  const s = app.listen(0, () => res({ s, url: `http://127.0.0.1:${s.address().port}` }))
})

const backend = express()
backend.get('/hello', (_req, res) => res.json({ hello: 'monad', at: new Date().toISOString() }))
const be = await listen(backend)
const px = await listen(createProxyServer({ config: { ...config, targetUrl: be.url } }))

const cp = new ChainPe({ privateKey: key, network, maxPerCall: price, registryAddress: '0x000000000000000000000000000000000000dEaD' })
console.log(`buyer ${cp.getAddress()} on ${network}`)
console.log('balances', await cp.balance())

const times = []
let firstTx
for (let i = 0; i < calls; i++) {
  const t0 = performance.now()
  const r = await cp.pay(`${px.url}/hello`)
  const ms = Math.round(performance.now() - t0)
  times.push(ms)
  console.log(`#${i + 1} HTTP ${r.status} in ${ms} ms`, r.data)
  firstTx ??= r.payment?.txHash
  if (r.payment?.txHash) console.log(`   paid ${r.payment.amount} USDC → ${explorerTxUrl(network, r.payment.txHash)}`)
  else console.log('   (no settlement tx reported)')
}
times.sort((a, b) => a - b)
const q = p => times[Math.min(times.length - 1, Math.floor(p * times.length))]
console.log(`\n${calls} paid call(s): p50 ${q(0.5)} ms, p95 ${q(0.95)} ms`)

if (process.env.FEEDBACK !== undefined) {
  const agentId = need('AGENT_ID')
  if (!firstTx) (console.error('No settlement tx — no receipt, no rating.'), process.exit(1))
  const feedbackTx = await cp.giveFeedback({
    agentId,
    value: Number(process.env.FEEDBACK),
    paymentTxHash: firstTx,
    endpoint: `${px.url}/hello`,
    waitConfirm: true
  })
  console.log(`receipt-backed feedback ${process.env.FEEDBACK}/100 for agent ${agentId} (feedbackHash = ${firstTx})`)
  console.log(`   → ${explorerTxUrl(network, feedbackTx)}`)
}
be.s.close()
px.s.close()
