// Shared helpers for the Monad seller-agent demo (port of legacy/examples/seller-agents).
// Demo traffic between team-controlled wallets — never traction.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isChainPeNetwork } from '@chainpeavax/sdk'

export const dir = path.dirname(fileURLToPath(import.meta.url))
export const envFile = path.join(dir, '.env.sellers') // git-ignored (.env.*)
export const network = process.env.NETWORK ?? 'monad-testnet'
if (!isChainPeNetwork(network)) throw new Error(`Unknown NETWORK ${network}`)

export function loadEnv() {
  const env = {}
  if (fs.existsSync(envFile))
    for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m) env[m[1]] = m[2].trim()
    }
  return { ...env, ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k in env)) }
}
export function saveVar(name, value) {
  const lines = (fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8').split('\n') : []).filter(
    l => l && !l.startsWith(`${name}=`)
  )
  fs.writeFileSync(envFile, [...lines, `${name}=${value}`, ''].join('\n'), { mode: 0o600 })
}

// The four Monad-themed services. `port` is the public x402 proxy port, backend is port+100.
export const SERVICES = [
  { id: 'STATS', name: 'monad-network-stats', port: 4601, price: '0.001', path: '/stats', tags: ['monad', 'stats', 'data'],
    description: 'Live Monad network stats: head block, block time, gas price, recent tx throughput.' },
  { id: 'PRICE', name: 'mon-price-quote', port: 4602, price: '0.001', path: '/quote?amountUsdc=10', tags: ['monad', 'price', 'dex'],
    description: 'MON/USD spot price and an indicative USDC→MON quote (reference price, not an on-chain swap).' },
  { id: 'DIGEST', name: 'monad-ecosystem-digest', port: 4603, price: '0.002', path: '/digest', tags: ['monad', 'ecosystem', 'news'],
    description: 'Digest of what is live on Monad: x402 services registered in ChainPe, ranked by paid reputation.' },
  { id: 'TRUST', name: 'agent-trust-report', port: 4604, price: '0.005', path: '/report?agentId=1', tags: ['erc-8004', 'reputation', 'trust'],
    description: 'ERC-8004 agent trust report: raw vs payment-backed reputation (paid-reputation data from ChainPe).' }
]
