#!/usr/bin/env node
// One-command live demo for the video (Monad testnet, hosted stack). Each step prints what it did and a
// MonadVision link. Needs a throwaway testnet key with a little MON and USDC:
//   KEY=0x… node e2e/demo-live.mjs        (from the repo root, after `npm ci && npm run build`)
// Demo traffic between team wallets — not traction.
import { ChainPe } from '@chainpemonad/sdk'

const SELLER = process.env.SELLER_URL ?? 'https://seller-production-ea9b.up.railway.app'
const INDEXER = process.env.CHAINPE_INDEXER_URL ?? 'https://indexer-production-50cd.up.railway.app'
const AGENT_ID = process.env.AGENT_ID ?? '2133'
const EXPLORER = 'https://testnet.monadvision.com/tx/'
const key = process.env.KEY ?? process.env.CHAINPE_PRIVATE_KEY
if (!key) { console.error('Set KEY to a throwaway testnet private key (MON for gas, a little testnet USDC).'); process.exit(1) }

const pause = ms => new Promise(r => setTimeout(r, ms))
const say = (n, t) => console.log(`\n\x1b[1m${n}  ${t}\x1b[0m`)
const rep = async () => (await fetch(`${INDEXER}/services/${AGENT_ID}/reputation`)).json()

say('1/5', `Ask the API for data, no payment: GET ${SELLER}/stats`)
const r = await fetch(`${SELLER}/stats`)
const offer = JSON.parse(Buffer.from(r.headers.get('payment-required') ?? '', 'base64').toString() || '{}')
const a = offer.accepts?.[0] ?? {}
console.log(`  HTTP ${r.status} Payment Required — ${a.scheme} on ${a.network}, ${Number(a.amount ?? a.maxAmountRequired ?? 0) / 1e6} USDC, payTo ${a.payTo}`)
await pause(1500)

say('2/5', 'Reputation before (paid = only ratings backed by a settled payment)')
const before = await rep()
console.log(`  paid ${JSON.stringify(before.paid)}   raw ${JSON.stringify(before.raw)}`)
await pause(1500)

say('3/5', 'Pay it in three lines: cp.pay(url) signs USDC, the facilitator settles on Monad, the API answers 200')
const cp = new ChainPe({ privateKey: key, network: 'monad-testnet', maxPerCall: '0.01' })
const t0 = Date.now()
const res = await cp.pay(`${SELLER}/stats`)
console.log(`  HTTP ${res.status} in ${Date.now() - t0} ms`)
console.log(`  settlement  ${EXPLORER}${res.payment.txHash}`)
console.log(`  data        ${JSON.stringify(res.data).slice(0, 110)}…`)
await pause(1500)

say('4/5', 'Rate it, citing the settlement as the receipt (feedbackHash = settlement tx)')
const fb = await cp.giveFeedback({ agentId: AGENT_ID, value: 90, paymentTxHash: res.payment.txHash })
console.log(`  rating tx   ${EXPLORER}${typeof fb === 'string' ? fb : (fb.txHash ?? fb.hash ?? JSON.stringify(fb))}`)
await pause(1500)

say('5/5', 'The indexer verifies the receipt on-chain, then the rating counts as paid')
for (let i = 0; i < 20; i++) {
  const now = await rep()
  if (now.raw?.count > before.raw?.count || i === 19) {
    console.log(`  paid ${JSON.stringify(now.paid)}   raw ${JSON.stringify(now.raw)}`)
    break
  }
  await pause(3000)
}
console.log('\nNo receipt, no rating. See it ranked: https://chainpemonad.vercel.app/services\n')
