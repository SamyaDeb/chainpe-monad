/**
 * Verification worker: decides for each new feedback whether it is backed by
 * an x402 payment (see `verifyFeedbackPayment` in core.ts for the rule).
 */
import { parseEventLogs, TransactionReceiptNotFoundError, type PublicClient } from 'viem'
import { IDENTITY_READ_ABI, TRANSFER_EVENT } from './abi.js'
import { verifyFeedbackPayment, type SettlementReceipt } from './core.js'
import { pendingFeedback, receiptClaimed, recordVerdict, servicesForAgent } from './store.js'
import type { Db } from './db.js'

export interface VerifierDeps {
  db: Db
  client: PublicClient
  usdc: `0x${string}`
  identity: `0x${string}`
  minPaidAtomic: bigint
}

/** The receipt of `hash` reduced to its token transfers; null when no such tx exists. */
export async function readSettlement(client: PublicClient, hash: `0x${string}`): Promise<SettlementReceipt | null> {
  let receipt
  try {
    receipt = await client.getTransactionReceipt({ hash })
  } catch (err) {
    if (err instanceof TransactionReceiptNotFoundError) return null
    throw err // RPC trouble: leave the feedback pending and retry later
  }
  const transfers = parseEventLogs({ abi: TRANSFER_EVENT, eventName: 'Transfer', logs: receipt.logs, strict: true }).map(
    l => ({ token: l.address, from: l.args.from, to: l.args.to, value: l.args.value })
  )
  return { status: receipt.status, transfers }
}

async function readAgent(deps: VerifierDeps, agentId: string) {
  const id = BigInt(agentId)
  const read = (functionName: 'ownerOf' | 'getAgentWallet') =>
    deps.client
      .readContract({ address: deps.identity, abi: IDENTITY_READ_ABI, functionName, args: [id] })
      .catch(() => null) as Promise<string | null>
  const [owner, wallet] = await Promise.all([read('ownerOf'), read('getAgentWallet')])
  return { owner, wallet }
}

/** Verifies up to `limit` pending feedback rows. Returns how many were decided. */
export async function verifyPending(deps: VerifierDeps, limit = 50): Promise<number> {
  const rows = await pendingFeedback(deps.db, limit)
  let decided = 0
  for (const row of rows) {
    const hash = row.feedbackHash as `0x${string}` | null
    const [receipt, services, agent, used] = await Promise.all([
      hash ? readSettlement(deps.client, hash) : Promise.resolve(null),
      servicesForAgent(deps.db, row.agentId),
      readAgent(deps, row.agentId),
      hash ? receiptClaimed(deps.db, hash, row.id) : Promise.resolve(false)
    ])
    const verdict = verifyFeedbackPayment({
      feedback: { agentId: row.agentId, client: row.client, feedbackHash: hash },
      receipt,
      usdc: deps.usdc,
      services,
      agentOwner: agent.owner,
      agentWallet: agent.wallet,
      minAmountAtomic: deps.minPaidAtomic,
      receiptAlreadyUsed: used
    })
    await recordVerdict(deps.db, row.id, verdict)
    decided++
  }
  return decided
}
