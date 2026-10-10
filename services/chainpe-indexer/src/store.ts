/** Database operations (writes from the indexer + verifier, reads for the API). */
import { and, asc, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm'
import type { Db } from './db.js'
import { services, feedback, indexerState } from './schema.js'
import type { ServiceRow, FeedbackRow, Verdict } from './core.js'

export async function upsertService(db: Db, row: ServiceRow): Promise<void> {
  const values = {
    developer: row.developer,
    name: row.name,
    description: row.description,
    tags: row.tags,
    endpoint: row.endpoint,
    pricePerRequest: row.pricePerRequest,
    paymentToken: row.paymentToken,
    payTo: row.payTo,
    agentId: row.agentId,
    active: true,
    updatedBlock: row.updatedBlock,
    updatedAt: new Date()
  }
  await db
    .insert(services)
    .values({ key: row.key, ...values })
    .onConflictDoUpdate({ target: services.key, set: values })
}

export async function deactivateService(db: Db, key: string, block: bigint): Promise<void> {
  await db
    .update(services)
    .set({ active: false, updatedBlock: block, updatedAt: new Date() })
    .where(eq(services.key, key))
}

export async function insertFeedback(db: Db, row: FeedbackRow): Promise<void> {
  await db
    .insert(feedback)
    .values({ ...row, client: row.client.toLowerCase(), revoked: false, paidStatus: 'pending', paidVerified: false })
    .onConflictDoNothing()
}

export async function revokeFeedback(db: Db, agentId: string, client: string, feedbackIndex: bigint): Promise<void> {
  await db
    .update(feedback)
    .set({ revoked: true })
    .where(
      and(
        eq(feedback.agentId, agentId),
        eq(feedback.client, client.toLowerCase()),
        eq(feedback.feedbackIndex, feedbackIndex)
      )
    )
}

export async function getCursor(db: Db): Promise<bigint | null> {
  const rows = await db.select().from(indexerState).where(eq(indexerState.id, 1))
  return rows[0]?.lastBlock ?? null
}

export async function setCursor(db: Db, lastBlock: bigint): Promise<void> {
  await db
    .insert(indexerState)
    .values({ id: 1, lastBlock })
    .onConflictDoUpdate({ target: indexerState.id, set: { lastBlock } })
}

// ─── Payment verification ───────────────────────────────────────────────────

export type FeedbackRecord = typeof feedback.$inferSelect
export type ServiceRecord = typeof services.$inferSelect

/** Feedback awaiting verification, oldest first (earlier feedback claims a receipt first). */
export async function pendingFeedback(db: Db, limit = 50): Promise<FeedbackRecord[]> {
  return db
    .select()
    .from(feedback)
    .where(eq(feedback.paidStatus, 'pending'))
    .orderBy(asc(feedback.block), asc(feedback.logIndex))
    .limit(limit)
}

/** All services (active or not) ever linked to an agentId — a payment made while registered counts. */
export async function servicesForAgent(db: Db, agentId: string): Promise<ServiceRecord[]> {
  return db.select().from(services).where(eq(services.agentId, agentId))
}

/** True when a different feedback already counts `hash` as its paid receipt. */
export async function receiptClaimed(db: Db, hash: string, exceptId: number): Promise<boolean> {
  const rows = await db
    .select({ id: feedback.id })
    .from(feedback)
    .where(and(eq(feedback.feedbackHash, hash), eq(feedback.paidVerified, true), ne(feedback.id, exceptId)))
    .limit(1)
  return rows.length > 0
}

export async function recordVerdict(db: Db, id: number, verdict: Verdict): Promise<void> {
  await db
    .update(feedback)
    .set(
      verdict.paid
        ? {
            paidStatus: 'paid',
            paidVerified: true,
            paidAmount: verdict.amount.toString(),
            payer: verdict.payer.toLowerCase(),
            paidReason: null
          }
        : { paidStatus: 'unpaid', paidVerified: false, paidAmount: null, payer: null, paidReason: verdict.reason }
    )
    .where(eq(feedback.id, id))
}

// ─── Reads for the API ───────────────────────────────────────────────────────

export async function listActiveServices(db: Db): Promise<ServiceRecord[]> {
  return db.select().from(services).where(eq(services.active, true))
}

export async function getFeedbackForAgents(db: Db, agentIds: string[]): Promise<FeedbackRecord[]> {
  if (agentIds.length === 0) return []
  return db.select().from(feedback).where(inArray(feedback.agentId, agentIds))
}

export interface FeedbackQuery {
  agentIds?: string[]
  /** true = receipt-backed only; false = everything not (yet) receipt-backed. */
  paid?: boolean
  limit: number
  offset: number
}

/** Ratings newest first (block, then log index), with the total for paging. */
export async function listFeedback(db: Db, q: FeedbackQuery): Promise<{ total: number; rows: FeedbackRecord[] }> {
  const conds: SQL[] = []
  if (q.agentIds) {
    if (q.agentIds.length === 0) return { total: 0, rows: [] }
    conds.push(inArray(feedback.agentId, q.agentIds))
  }
  if (q.paid !== undefined) conds.push(eq(feedback.paidVerified, q.paid))
  const where = conds.length ? and(...conds) : undefined
  const [t] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(feedback)
    .where(where)
  const rows = await db
    .select()
    .from(feedback)
    .where(where)
    .orderBy(desc(feedback.block), desc(feedback.logIndex), desc(feedback.id))
    .limit(q.limit)
    .offset(q.offset)
  return { total: Number(t?.n ?? 0), rows }
}

export async function counts(db: Db): Promise<{ services: number; feedback: number; paidFeedback: number }> {
  const [s] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(services)
    .where(eq(services.active, true))
  const [f] = await db.select({ n: sql<number>`count(*)::int` }).from(feedback)
  const [p] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(feedback)
    .where(eq(feedback.paidVerified, true))
  return { services: Number(s?.n ?? 0), feedback: Number(f?.n ?? 0), paidFeedback: Number(p?.n ?? 0) }
}
