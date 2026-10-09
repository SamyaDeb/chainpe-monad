/**
 * Store + verifier + API against an in-memory Postgres (pg-mem): NUMERIC values
 * survive int128-sized input, verification marks only receipt-backed feedback
 * as paid, and the API ranks by paid reputation (raw on request).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { newDb } from 'pg-mem'
import pg from 'pg'
import { ensureSchema } from '../src/db.js'
import { drizzle } from 'drizzle-orm/node-postgres'
import { encodeAbiParameters, encodeEventTopics, type PublicClient } from 'viem'
import * as schema from '../src/schema.js'
import type { Db } from '../src/db.js'
import { TRANSFER_EVENT } from '../src/abi.js'
import { feedbackRowFromArgs, serviceRowFromArgs } from '../src/core.js'
import { insertFeedback, upsertService, revokeFeedback } from '../src/store.js'
import { verifyPending } from '../src/verify.js'
import { createApi } from '../src/api.js'

const USDC = '0x534b2f3A21130d7a60830c2Df862319e593943A3' as const
const IDENTITY = '0x8004A818BFB912233c491871b3d84c89A494BD9e' as const
const DEV = '0xd000000000000000000000000000000000000001'
const PAYTO = '0xa000000000000000000000000000000000000002'
const PAYTO2 = '0xa000000000000000000000000000000000000022'
const OWNER = '0x0000000000000000000000000000000000000003'
const BUYER = '0xb000000000000000000000000000000000000005'
const STRANGER = '0xc000000000000000000000000000000000000006'
const STRANGER2 = '0xc000000000000000000000000000000000000007'
const tx = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as const
const INT128_MAX = (1n << 127n) - 1n

function transferLog(from: string, to: string, value: bigint, token: string = USDC) {
  return {
    address: token,
    topics: encodeEventTopics({ abi: TRANSFER_EVENT, eventName: 'Transfer', args: { from: from as `0x${string}`, to: to as `0x${string}` } }),
    data: encodeAbiParameters([{ type: 'uint256' }], [value]),
    blockNumber: 1n,
    blockHash: tx(999),
    transactionHash: tx(1),
    transactionIndex: 0,
    logIndex: 0,
    removed: false
  }
}

// Chain stub: settlement receipts by hash + the identity registry views.
const receipts: Record<string, { status: 'success' | 'reverted'; logs: ReturnType<typeof transferLog>[] }> = {
  [tx(1)]: { status: 'success', logs: [transferLog(BUYER, PAYTO, 10_000n)] },
  [tx(2)]: { status: 'success', logs: [transferLog(STRANGER2, PAYTO2, 50_000n)] },
  [tx(3)]: { status: 'success', logs: [transferLog(OWNER, PAYTO2, 50_000n)] }
}
const client = {
  getTransactionReceipt: async ({ hash }: { hash: string }) => {
    const r = receipts[hash]
    if (!r) {
      const { TransactionReceiptNotFoundError } = await import('viem')
      throw new TransactionReceiptNotFoundError({ hash: hash as `0x${string}` })
    }
    return r
  },
  readContract: async ({ functionName }: { functionName: string }) => (functionName === 'ownerOf' ? OWNER : '0x0000000000000000000000000000000000000000')
} as unknown as PublicClient

let db: Db
let server: Server
let base: string

/** Real Postgres when TEST_DATABASE_URL is set (a fresh schema per run), else pg-mem. */
const REAL_PG = process.env.TEST_DATABASE_URL
let realPool: pg.Pool | undefined

async function openDb(): Promise<Db> {
  if (REAL_PG) {
    realPool = new pg.Pool({ connectionString: REAL_PG })
    await realPool.query('DROP SCHEMA IF EXISTS indexer_test CASCADE; CREATE SCHEMA indexer_test')
    realPool.on('connect', c => void c.query('SET search_path TO indexer_test'))
    await realPool.query('SET search_path TO indexer_test')
    await ensureSchema({ query: (q: string) => realPool!.query(`SET search_path TO indexer_test; ${q}`) } as never)
    return drizzle(realPool, { schema }) as unknown as Db
  }
  const mem = newDb()
  const { Pool } = mem.adapters.createPg()
  const pool = new Pool()
  // pg-mem supports neither drizzle's per-query `types` override (it returns
  // typed values anyway) nor `rowMode: 'array'` — emulate the latter.
  const query = pool.query.bind(pool) as (...a: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>
  pool.query = (async (cfg: unknown, ...rest: unknown[]) => {
    if (!cfg || typeof cfg !== 'object') return query(cfg, ...rest)
    const { types: _types, rowMode, ...plain } = cfg as Record<string, unknown>
    const res = await query(plain, ...rest)
    return rowMode === 'array' ? { ...res, rows: res.rows.map(r => Object.values(r)) } : res
  }) as unknown as typeof pool.query
  await pool.query(schema.SCHEMA_DDL)
  return drizzle(pool, { schema }) as unknown as Db
}

beforeAll(async () => {
  db = await openDb()

  // Agent 5 → "honest" (payTo PAYTO); agent 6 → "farmed" (payTo PAYTO2).
  await upsertService(db, serviceRowFromArgs({ key: '0x01', developer: DEV, name: 'honest', endpoint: 'https://h', pricePerRequest: '0.01', paymentToken: 'USDC', payTo: PAYTO, agentId: 5n }, 1n))
  await upsertService(db, serviceRowFromArgs({ key: '0x02', developer: DEV, name: 'farmed', endpoint: 'https://f', pricePerRequest: '0.01', paymentToken: 'USDC', payTo: PAYTO2, agentId: 6n }, 1n))

  const fb = (agentId: bigint, client: string, index: bigint, value: bigint, hash: string | undefined, logIndex: number) =>
    insertFeedback(db, feedbackRowFromArgs({ agentId, clientAddress: client, feedbackIndex: index, value, valueDecimals: 0, tag1: 'x402', tag2: 'paid-call', feedbackHash: hash }, 10n, { logIndex }))

  await fb(5n, BUYER, 1n, 80n, tx(1), 0) // paid, 80
  await fb(5n, STRANGER, 1n, 10n ** 30n, undefined, 1) // 1e30, no receipt
  await fb(5n, STRANGER2, 1n, 20n, tx(1), 2) // reuses BUYER's receipt
  await fb(6n, STRANGER, 1n, INT128_MAX, undefined, 3) // int128 max, no receipt
  await fb(6n, STRANGER, 2n, 100n, tx(77), 4) // hash of a tx that does not exist
  await fb(6n, OWNER, 1n, 100n, tx(3), 5) // owner paying itself
  await fb(6n, STRANGER2, 1n, 30n, tx(2), 6) // paid, 30

  const app = createApi(db, { network: 'monad-testnet', trustProxy: 1, weightCapAtomic: 1_000_000n, payerShareCap: 0.25 })
  server = app.listen(0)
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  server?.close()
  await realPool?.end()
})

describe('verifier', () => {
  it('marks only receipt-backed feedback as paid', async () => {
    const decided = await verifyPending({ db, client, usdc: USDC, identity: IDENTITY, minPaidAtomic: 1_000n })
    expect(decided).toBe(7)
    const rows = await db.select().from(schema.feedback)
    const byKey = Object.fromEntries(rows.map(r => [`${r.agentId}:${r.client}:${r.feedbackIndex}`, r]))
    expect(byKey[`5:${BUYER}:1`]).toMatchObject({ paidStatus: 'paid', paidVerified: true, payer: BUYER })
    expect(Number(byKey[`5:${BUYER}:1`].paidAmount)).toBe(10_000)
    expect(byKey[`5:${STRANGER}:1`]).toMatchObject({ paidStatus: 'unpaid', paidReason: 'no_receipt' })
    expect(byKey[`5:${STRANGER2}:1`]).toMatchObject({ paidStatus: 'unpaid', paidReason: 'receipt_reused' })
    expect(byKey[`6:${STRANGER}:1`]).toMatchObject({ paidReason: 'no_receipt' })
    expect(byKey[`6:${STRANGER}:2`]).toMatchObject({ paidReason: 'tx_not_found' })
    expect(byKey[`6:${OWNER}:1`]).toMatchObject({ paidReason: 'self_dealing' })
    expect(byKey[`6:${STRANGER2}:1`]).toMatchObject({ paidStatus: 'paid' })
    // The int128-sized value is stored — exactly on real Postgres (pg-mem keeps NUMERIC as a float).
    const big = byKey[`6:${STRANGER}:1`].value
    if (REAL_PG) expect(big).toBe(INT128_MAX.toString())
    else expect(Number(big)).toBe(Number(INT128_MAX))
    expect(await verifyPending({ db, client, usdc: USDC, identity: IDENTITY, minPaidAtomic: 1_000n })).toBe(0)
  })
})

describe('API', () => {
  it('ranks by paid reputation by default', async () => {
    const body = await (await fetch(`${base}/services`)).json()
    expect(body.rank).toBe('paid')
    expect(body.items.map((s: { name: string }) => s.name)).toEqual(['honest', 'farmed'])
    expect(body.items[0].reputation).toEqual({ count: 1, score: 80 })
    expect(body.items[1].reputation).toEqual({ count: 1, score: 30 })
  })

  it('ranks by raw on request — the unpaid ratings lift "farmed"', async () => {
    const body = await (await fetch(`${base}/services?rank=raw`)).json()
    expect(body.items.map((s: { name: string }) => s.name)).toEqual(['farmed', 'honest'])
    expect(body.items[0].reputation).toEqual({ count: 3, score: 82.5 })
  })

  it('serves the paid/raw breakdown', async () => {
    const r = await (await fetch(`${base}/services/0x01/reputation`)).json()
    expect(r).toEqual({ agentId: '5', paid: { score: 80, count: 1, volume: '0.01' }, raw: { score: 66.67, count: 3 } })
    expect((await fetch(`${base}/services/nope/reputation`)).status).toBe(404)
    expect((await fetch(`${base}/services?rank=bogus`)).status).toBe(400)
  })

  it('a revoked paid rating leaves the paid score', async () => {
    await revokeFeedback(db, '5', BUYER, 1n)
    const r = await (await fetch(`${base}/services/${DEV}:honest/reputation`)).json()
    expect(r.paid).toEqual({ score: null, count: 0, volume: '0' })
  })

  it('stats and health answer', async () => {
    expect(await (await fetch(`${base}/stats`)).json()).toMatchObject({ services: 2, feedback: 7, paidFeedback: 2 })
    expect((await fetch(`${base}/health`)).status).toBe(200)
  })

  it('a database error is a 500, not a crash', async () => {
    const broken = new Proxy({} as Db, { get: () => () => { throw new Error('db down') } })
    const s = createApi(broken, { network: 'monad-testnet', trustProxy: 1, weightCapAtomic: 1n, payerShareCap: 0.25 }).listen(0)
    const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}`
    try {
      for (const p of ['/services', '/services/x', '/services/x/reputation', '/stats']) {
        const res = await fetch(url + p)
        expect(res.status, p).toBe(500)
        expect(await res.json()).toEqual({ error: 'internal_error' })
      }
    } finally {
      s.close()
    }
  })
})
