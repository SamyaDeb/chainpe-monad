import { pgTable, text, boolean, integer, bigint, numeric, timestamp, serial, uniqueIndex } from 'drizzle-orm/pg-core'

export const services = pgTable('services', {
  key: text('key').primaryKey(),
  developer: text('developer').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  tags: text('tags').notNull().default(''),
  endpoint: text('endpoint').notNull(),
  pricePerRequest: text('price_per_request').notNull(),
  paymentToken: text('payment_token').notNull(),
  payTo: text('pay_to').notNull(),
  agentId: text('agent_id'),
  active: boolean('active').notNull().default(true),
  updatedBlock: bigint('updated_block', { mode: 'bigint' }).notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
})

/**
 * One row per ERC-8004 `NewFeedback`. `value` is NUMERIC: the on-chain field is
 * int128, so an INTEGER column let anyone stall the indexer with one large value.
 *
 * Payment verification: `paid_status` is `pending` until the verifier has
 * looked at `feedback_hash`, then `paid` (an x402 settlement this client made
 * to the agent's registered service) or `unpaid` (with `paid_reason`).
 */
export const feedback = pgTable(
  'feedback',
  {
    id: serial('id').primaryKey(),
    agentId: text('agent_id').notNull(),
    client: text('client').notNull(),
    feedbackIndex: bigint('feedback_index', { mode: 'bigint' }).notNull(),
    value: numeric('value').notNull(),
    valueDecimals: integer('value_decimals').notNull(),
    tag1: text('tag1'),
    tag2: text('tag2'),
    endpoint: text('endpoint'),
    feedbackUri: text('feedback_uri'),
    feedbackHash: text('feedback_hash'),
    revoked: boolean('revoked').notNull().default(false),
    block: bigint('block', { mode: 'bigint' }).notNull(),
    logIndex: integer('log_index').notNull().default(0),
    txHash: text('tx_hash'),
    paidStatus: text('paid_status').notNull().default('pending'),
    paidVerified: boolean('paid_verified').notNull().default(false),
    paidAmount: numeric('paid_amount'),
    payer: text('payer'),
    paidReason: text('paid_reason')
  },
  t => ({
    uniq: uniqueIndex('feedback_agent_client_index').on(t.agentId, t.client, t.feedbackIndex)
  })
)

export const indexerState = pgTable('indexer_state', {
  id: integer('id').primaryKey(),
  lastBlock: bigint('last_block', { mode: 'bigint' }).notNull()
})

/** Idempotent DDL run on boot (avoids shipping a separate migration tool). */
export const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS services (
  key TEXT PRIMARY KEY,
  developer TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  endpoint TEXT NOT NULL,
  price_per_request TEXT NOT NULL,
  payment_token TEXT NOT NULL,
  pay_to TEXT NOT NULL,
  agent_id TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_block BIGINT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS services_agent_id ON services (agent_id);
CREATE TABLE IF NOT EXISTS feedback (
  id SERIAL PRIMARY KEY,
  agent_id TEXT NOT NULL,
  client TEXT NOT NULL,
  feedback_index BIGINT NOT NULL,
  value NUMERIC NOT NULL,
  value_decimals INTEGER NOT NULL,
  tag1 TEXT,
  tag2 TEXT,
  endpoint TEXT,
  feedback_uri TEXT,
  feedback_hash TEXT,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  block BIGINT NOT NULL,
  log_index INTEGER NOT NULL DEFAULT 0,
  tx_hash TEXT,
  paid_status TEXT NOT NULL DEFAULT 'pending',
  paid_verified BOOLEAN NOT NULL DEFAULT FALSE,
  paid_amount NUMERIC,
  payer TEXT,
  paid_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS feedback_agent_client_index
  ON feedback (agent_id, client, feedback_index);
CREATE INDEX IF NOT EXISTS feedback_agent_id ON feedback (agent_id);
CREATE INDEX IF NOT EXISTS feedback_hash ON feedback (feedback_hash);
CREATE INDEX IF NOT EXISTS feedback_paid_status ON feedback (paid_status);
CREATE TABLE IF NOT EXISTS indexer_state (
  id INTEGER PRIMARY KEY,
  last_block BIGINT NOT NULL
);
`

/**
 * One receipt backs at most one paid feedback — enforced by the verifier and,
 * on real Postgres, by this partial unique index too.
 */
export const PAID_RECEIPT_DDL = `
CREATE UNIQUE INDEX IF NOT EXISTS feedback_one_paid_per_receipt
  ON feedback (feedback_hash) WHERE paid_verified;
`
