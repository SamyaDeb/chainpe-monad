// Latency benchmark: N paid x402 calls, p50/p95 of 402 → settled → 200.
//   BUYER_PRIVATE_KEY=0x… SELLER_ADDRESS=0x… N=20 NETWORK=monad-testnet node bench.mjs
// Demo traffic between team-controlled wallets. Reports the 402 leg and the pay+settle+200 leg separately.
import express from 'express'
import { ChainPe, explorerTxUrl } from '@chainpeavax/sdk'
import { createProxyServer, resolveFacilitatorUrl } from '@chainpeavax/cli'

const need = n => process.env[n] || (console.error(`Missing ${n}`), process.exit(1))
const network = process.env.NETWORK ?? 'monad-testnet'
const N = Number(process.env.N ?? 20)
const price = process.env.PRICE ?? '0.001'
const config = { serviceName: 'bench', serviceDescription: 'bench', tags: ['bench'], targetUrl: '', pricePerRequest: price,
  paymentToken: 'USDC', walletAddress: need('SELLER_ADDRESS'), proxyPort: 0, network,
  ...(process.env.CHAINPE_FACILITATOR_URL ? { facilitatorUrl: process.env.CHAINPE_FACILITATOR_URL } : {}) }
if (!resolveFacilitatorUrl(config)) (console.error('Set CHAINPE_FACILITATOR_URL'), process.exit(1))
const listen = app => new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${s.address().port}`)) })
const be = express(); be.get('/ping', (_q, r) => r.json({ ok: true }))
const px = await listen(createProxyServer({ config: { ...config, targetUrl: await listen(be) } }))
const cp = new ChainPe({ privateKey: need('BUYER_PRIVATE_KEY'), network, maxPerCall: price, facilitatorUrl: config.facilitatorUrl })
console.log(`network ${network} buyer ${cp.getAddress()}`, await cp.balance())

const q = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))]
const t402 = [], total = [], txs = []
for (let i = 0; i < N; i++) {
  let t = performance.now()
  const probe = await fetch(`${px}/ping`)            // leg 1: request → 402
  t402.push(performance.now() - t)
  if (probe.status !== 402) throw new Error(`expected 402, got ${probe.status}`)
  t = performance.now()
  const r = await cp.pay(`${px}/ping`)               // 402 → sign → settle on-chain → 200
  total.push(performance.now() - t)
  if (r.status !== 200 || !r.payment?.txHash) throw new Error(`call ${i} failed: ${r.status}`)
  txs.push(r.payment.txHash)
  console.log(`#${i + 1} 402 ${Math.round(t402.at(-1))} ms · paid ${Math.round(total.at(-1))} ms · ${r.payment.txHash}`)
}
const f = a => `p50 ${Math.round(q(a, 0.5))} ms · p95 ${Math.round(q(a, 0.95))} ms · max ${Math.round(Math.max(...a))} ms`
console.log(`\n${N} paid calls on ${network}`)
console.log(`  request → 402:                 ${f(t402)}`)
console.log(`  402 → settled → 200 (paid):    ${f(total)}`)
console.log('  first/last settlement:', explorerTxUrl(network, txs[0]), explorerTxUrl(network, txs.at(-1)))
console.log(JSON.stringify({ network, n: N, t402Ms: { p50: q(t402, .5), p95: q(t402, .95) }, paidMs: { p50: q(total, .5), p95: q(total, .95) }, txs }))
process.exit(0)
