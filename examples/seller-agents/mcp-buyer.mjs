// Buyer via the Claude MCP wallet: spawns the real `chainpe-wallet-mcp` server over stdio (the
// same way Claude Desktop runs it) and drives its tools: search_bazaar → pay → give_feedback.
//   node mcp-buyer.mjs        (needs run-sellers.mjs running; CHAINPE_INDEXER_URL optional)
// Demo traffic between team-controlled wallets — labelled in receipts, not traction.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { dir, network, loadEnv, SERVICES } from './lib.mjs'

const env = loadEnv()
const only = (process.env.ONLY ?? 'STATS,TRUST').split(',')
const rating = Number(process.env.FEEDBACK ?? 92)
const server = createRequire(import.meta.url).resolve('chainpe-wallet-mcp/dist/index.js')
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chainpe-mcp-'))

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [server],
  env: {
    PATH: process.env.PATH,
    CHAINPE_PRIVATE_KEY: env.BUYER_KEY,
    NETWORK: network,
    MAX_PER_CALL: '0.01',
    MAX_PER_DAY: '0.05',
    CHAINPE_HOME: home,
    CHAINPE_SPENDING_PATH: path.join(home, 'spending.json'),
    ...(process.env.CHAINPE_INDEXER_URL ? { CHAINPE_INDEXER_URL: process.env.CHAINPE_INDEXER_URL } : {}),
    ...(process.env.MONAD_TESTNET_RPC_URL ? { MONAD_TESTNET_RPC_URL: process.env.MONAD_TESTNET_RPC_URL } : {}),
    ...(process.env.NODE_USE_ENV_PROXY ? { NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: process.env.HTTPS_PROXY ?? '' } : {})
  },
  stderr: 'inherit'
})
const client = new Client({ name: 'chainpe-mcp-buyer', version: '1' })
await client.connect(transport)
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args })
  const text = r.content?.[0]?.text ?? ''
  if (r.isError) throw new Error(`${name}: ${text}`)
  try { return JSON.parse(text) } catch { return text }
}

console.log('tools:', (await client.listTools()).tools.map(t => t.name).join(', '))
console.log('balance:', JSON.stringify(await call('check_balance')))
try {
  const found = await call('search_bazaar', { query: 'monad' })
  console.log('search_bazaar("monad"):', (typeof found === 'string' ? found : JSON.stringify(found)).slice(0, 300))
} catch (err) {
  console.warn(`search_bazaar failed (continuing with the known endpoints): ${String(err.message).split('\n')[0]}`)
}

const out = []
for (const s of SERVICES.filter(s => only.includes(s.id))) {
  const url = `http://localhost:${s.port}${s.path}`
  const t0 = performance.now()
  const r = await call('pay', { url, maxAmount: s.price })
  const ms = Math.round(performance.now() - t0)
  const row = { via: 'mcp-wallet', service: s.name, status: r.status, ms, amount: r.payment?.amount,
    tx: r.payment?.txHash, link: r.payment?.explorerUrl ?? r.payment?.link, label: 'demo traffic (team wallets), not traction' }
  const agentId = r.agentId ?? env[`${s.id}_AGENT_ID`]
  if (r.ok && r.payment?.txHash && agentId) {
    row.feedbackTx = await call('give_feedback', { agentId: String(agentId), score: rating, paymentTxHash: r.payment.txHash, endpoint: url })
      .then(fb => fb.txHash ?? fb)
      .catch(e => `feedback failed: ${e.message}`)
  }
  out.push(row)
  console.log(`${s.name} HTTP ${r.status} ${ms} ms tx ${row.tx ?? '-'}${row.feedbackTx ? `\n   feedback ${JSON.stringify(row.feedbackTx)}` : ''}`)
}
// The over-budget guard, live: a call above the per-call cap must be refused before signing.
const dear = SERVICES.filter(s => only.includes(s.id)).sort((a, b) => Number(b.price) - Number(a.price))[0]
const refused = await client.callTool({ name: 'pay', arguments: { url: `http://localhost:${dear.port}${dear.path}`, maxAmount: (Number(dear.price) / 2).toFixed(6) } })
console.log(`over-cap call refused: ${!!refused.isError} — ${refused.content?.[0]?.text?.slice(0, 160)}`)
console.log('spending_report:', JSON.stringify(await call('spending_report')))
await client.close()

const file = path.join(dir, `receipts-${network}.json`)
const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []
fs.writeFileSync(file, JSON.stringify([...prev, ...out], null, 2))
console.log(`${out.filter(o => o.status === 200 && o.tx).length}/${out.length} MCP paid calls OK → ${file}`)
fs.rmSync(home, { recursive: true, force: true })
