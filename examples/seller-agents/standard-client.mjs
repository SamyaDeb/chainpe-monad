// Interop check: pay a ChainPe seller with the stock x402 v2 client (@x402/fetch + @x402/evm),
// no ChainPe SDK involved — any x402 agent can buy from a ChainPe service.
//   node standard-client.mjs      (needs run-sellers.mjs running; ONLY=STATS by default)
// Demo traffic between team-controlled wallets — labelled in receipts, not traction.
import fs from 'node:fs'
import path from 'node:path'
import { wrapFetchWithPayment, x402Client } from '@x402/fetch'
import { ExactEvmScheme } from '@x402/evm/exact/client'
import { privateKeyToAccount } from 'viem/accounts'
import { getCaip2, explorerTxUrl } from '@chainpemonad/sdk'
import { dir, network, loadEnv, SERVICES } from './lib.mjs'

const env = loadEnv()
const s = SERVICES.find(x => x.id === (process.env.ONLY ?? 'STATS'))
const account = privateKeyToAccount(env.BUYER_KEY)
const client = new x402Client().register(getCaip2(network), new ExactEvmScheme(account))
const pay = wrapFetchWithPayment(fetch, client)

const url = `http://localhost:${s.port}${s.path}`
const t0 = performance.now()
const res = await pay(url)
const ms = Math.round(performance.now() - t0)
const header = res.headers.get('payment-response')
const settle = header ? JSON.parse(Buffer.from(header, 'base64').toString('utf8')) : null
console.log(`stock @x402/fetch → ${s.name} HTTP ${res.status} in ${ms} ms`)
console.log('   body', (await res.text()).slice(0, 200))
if (!settle?.transaction) (console.error('no settlement in PAYMENT-RESPONSE'), process.exit(1))
const link = explorerTxUrl(network, settle.transaction)
console.log(`   settled ${settle.transaction} → ${link}`)

const file = path.join(dir, `receipts-${network}.json`)
const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []
prev.push({ via: 'stock @x402/fetch client', service: s.name, status: res.status, ms, tx: settle.transaction, link,
  label: 'demo traffic (team wallets), not traction' })
fs.writeFileSync(file, JSON.stringify(prev, null, 2))
