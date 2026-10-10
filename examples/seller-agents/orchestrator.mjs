// Buyer: pays every service with real USDC, posts receipt-backed feedback, logs receipts.
//   ROUNDS=3 FEEDBACK=90 node orchestrator.mjs      (needs run-sellers.mjs running)
// Demo traffic between team-controlled wallets — labelled in receipts.json, not traction.
import fs from 'node:fs'
import path from 'node:path'
import { ChainPe, explorerTxUrl } from '@chainpeavax/sdk'
import { dir, network, loadEnv, SERVICES } from './lib.mjs'

const env = loadEnv()
const rounds = Number(process.env.ROUNDS ?? 1)
const rating = process.env.FEEDBACK === undefined ? 90 : Number(process.env.FEEDBACK)
const cp = new ChainPe({ privateKey: env.BUYER_KEY, network, maxPerCall: '0.05', facilitatorUrl: process.env.CHAINPE_FACILITATOR_URL })
console.log('buyer', cp.getAddress(), await cp.balance())
const out = []
for (let i = 0; i < rounds; i++)
  for (const s of SERVICES) {
    const t0 = performance.now()
    const r = await cp.pay(`http://localhost:${s.port}${s.path}`)
    const ms = Math.round(performance.now() - t0)
    const row = { service: s.name, status: r.status, ms, amount: r.payment?.amount, tx: r.payment?.txHash,
      link: r.payment?.txHash && explorerTxUrl(network, r.payment.txHash), label: 'demo traffic (team wallets), not traction' }
    if (r.ok && r.payment?.txHash && env[`${s.id}_AGENT_ID`] && rating >= 0)
      row.feedbackTx = await cp.giveFeedback({ agentId: env[`${s.id}_AGENT_ID`], value: rating, paymentTxHash: r.payment.txHash })
        .catch(e => `feedback failed: ${e.message}`)
    out.push(row)
    console.log(`${s.name} HTTP ${r.status} ${ms} ms ${row.link ?? ''}${row.feedbackTx ? '\n   feedback ' + row.feedbackTx : ''}`)
  }
const file = path.join(dir, `receipts-${network}.json`)
const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []
fs.writeFileSync(file, JSON.stringify([...prev, ...out], null, 2))
console.log(`${out.filter(o => o.status === 200).length}/${out.length} paid calls OK → ${file}`)
