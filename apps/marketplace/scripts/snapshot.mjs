#!/usr/bin/env node
/**
 * Writes data/snapshot-monad-testnet.json — the marketplace's fallback when the
 * indexer is unset or unreachable — from a live indexer API. Real data only:
 * everything in the file is what the indexer served at `at`.
 *
 *   NEXT_PUBLIC_CHAINPE_INDEXER_URL=http://localhost:4600 npm run snapshot
 */
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const base = (process.argv[2] ?? process.env.NEXT_PUBLIC_CHAINPE_INDEXER_URL ?? 'http://localhost:4600').replace(/\/+$/, '')
const out = fileURLToPath(new URL('../data/snapshot-monad-testnet.json', import.meta.url))

async function get(path) {
  const res = await fetch(base + path)
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return res.json()
}

const health = await get('/health')
if (health.network !== 'monad-testnet') throw new Error(`indexer is on ${health.network}, expected monad-testnet`)
if (BigInt(health.lastIndexedBlock ?? 0) < BigInt(health.chainHead ?? 0) - 1000n) {
  throw new Error(`indexer still catching up (${health.lastIndexedBlock} / ${health.chainHead})`)
}
const all = await get('/stats')
const paid = await get('/services?rank=paid&limit=100')
const raw = await get('/services?rank=raw&limit=100')
// Ratings on ChainPe-registered agents only (the canonical registry is shared with other agents).
const feedback = []
for (let offset = 0; ; offset += 100) {
  const page = await get(`/feedback?registered=true&limit=100&offset=${offset}`)
  feedback.push(...page.items)
  if (feedback.length >= page.total || page.items.length === 0) break
}

const snapshot = {
  at: new Date().toISOString(),
  network: health.network,
  label: 'demo traffic from team wallets, not traction',
  lastIndexedBlock: health.lastIndexedBlock,
  // Same totals as the live pages (src/lib/data.ts liveStats): ChainPe agents only.
  stats: {
    services: all.services,
    ratings: feedback.length,
    paid: feedback.filter(f => f.paid).length,
    otherAgents: all.feedback - feedback.length
  },
  services: { paid: paid.items, raw: raw.items },
  feedback
}
await writeFile(out, JSON.stringify(snapshot, null, 2) + '\n')
console.log(`wrote ${out}: ${paid.items.length} services, ${feedback.length} ratings, block ${health.lastIndexedBlock}`)
