/**
 * ChainPe indexer entrypoint: starts the REST API and the watcher loop.
 *
 * The watcher polls `getLogs` for ChainPeRegistry + canonical ERC-8004
 * Reputation events on Monad into Postgres and verifies which feedback is
 * backed by an x402 payment; the API serves discovery ranked by paid
 * reputation (or raw, for comparison).
 */
import { createPublicClient, http, type PublicClient } from 'viem'
import { loadConfig } from './config.js'
import { createDb, ensureSchema } from './db.js'
import { runIndexer } from './indexer.js'
import { createApi } from './api.js'

async function main() {
  const cfg = loadConfig()
  const { pool, db } = createDb(cfg.databaseUrl)
  await ensureSchema(pool)

  const client = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl) }) as PublicClient

  createApi(db, {
    network: cfg.network,
    trustProxy: cfg.trustProxy,
    weightCapAtomic: cfg.weightCapAtomic,
    payerShareCap: cfg.payerShareCap
  }).listen(cfg.port, () => {
    console.log(`ChainPe indexer API on :${cfg.port}`)
    console.log(`  network:     ${cfg.network}`)
    console.log(`  registry:    ${cfg.registry}`)
    console.log(`  reputation:  ${cfg.reputation}`)
    console.log(`  vault:       ${cfg.policyVault ?? 'off'} (PolicyVault Spent = payment receipt)`)
    console.log(`  start block: ${cfg.startBlock} (chunk ${cfg.logChunk})`)
    console.log('  endpoints:   GET /health · /stats · /services?rank=paid|raw · /services/:id · /services/:id/reputation')
  })

  runIndexer({
    db,
    client,
    registry: cfg.registry,
    reputation: cfg.reputation,
    identity: cfg.identity,
    usdc: cfg.usdc,
    vault: cfg.policyVault,
    minPaidAtomic: cfg.minPaidAtomic,
    startBlock: cfg.startBlock,
    chunk: cfg.logChunk,
    pollIntervalMs: cfg.pollIntervalMs
  }).catch(err => {
    console.error('indexer loop crashed:', err)
    process.exit(1)
  })
}

if (process.env.NODE_ENV !== 'test') {
  main().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
