/**
 * Verification worker: decides for each new feedback whether it is backed by
 * an x402 payment (see `verifyFeedbackPayment` in core.ts for the rule).
 */
import {
  decodeFunctionData,
  parseEventLogs,
  recoverTypedDataAddress,
  TransactionReceiptNotFoundError,
  type PublicClient
} from 'viem'
import { IDENTITY_READ_ABI, TRANSFER_EVENT, VAULT_SPEND_FN, VAULT_SPEND_TYPES, VAULT_SPENT_EVENT } from './abi.js'
import { verifyFeedbackPayment, type SettlementReceipt, type VaultSpend } from './core.js'
import { pendingFeedback, receiptClaimed, recordVerdict, servicesForAgent } from './store.js'
import type { Db } from './db.js'

export interface VerifierDeps {
  db: Db
  client: PublicClient
  usdc: `0x${string}`
  identity: `0x${string}`
  minPaidAtomic: bigint
  /** PolicyVault whose `Spent` events count as x402 payments (`chainpe-vault`). */
  vault?: `0x${string}`
}

/** The receipt of `hash` reduced to its token transfers (+ vault spends); null when no such tx exists. */
export async function readSettlement(
  client: PublicClient,
  hash: `0x${string}`,
  vault?: `0x${string}`
): Promise<SettlementReceipt | null> {
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
  const vaultSpends = vault ? await readVaultSpends(client, hash, vault, receipt.logs) : []
  return { status: receipt.status, transfers, vaultSpends }
}

/**
 * `Spent` events of our vault in a receipt. The session key that signed each
 * spend is recovered from the `spend(...)` calldata (EIP-712 Spend with the
 * event's nonce), so no historical state read is needed.
 */
async function readVaultSpends(
  client: PublicClient,
  hash: `0x${string}`,
  vault: `0x${string}`,
  logs: Parameters<typeof parseEventLogs>[0]['logs']
): Promise<VaultSpend[]> {
  const spent = parseEventLogs({ abi: VAULT_SPENT_EVENT, eventName: 'Spent', logs, strict: true }).filter(
    l => l.address.toLowerCase() === vault.toLowerCase()
  )
  if (spent.length === 0) return []
  let call: { owner: string; to: string; amount: bigint; deadline: bigint; sig: `0x${string}`; chainId: number } | null = null
  const tx = await client.getTransaction({ hash })
  if (tx.to?.toLowerCase() === vault.toLowerCase()) {
    try {
      const { args } = decodeFunctionData({ abi: VAULT_SPEND_FN, data: tx.input })
      call = { owner: args[0], to: args[1], amount: args[2], deadline: args[3], sig: args[4], chainId: Number(tx.chainId ?? client.chain?.id) }
    } catch {
      /* not a direct spend() call — session key unknown */
    }
  }
  return Promise.all(
    spent.map(async l => {
      let sessionKey: string | null = null
      const a = l.args
      if (call && call.owner.toLowerCase() === a.owner.toLowerCase() && call.to.toLowerCase() === a.to.toLowerCase() && call.amount === a.amount) {
        sessionKey = await recoverTypedDataAddress({
          domain: { name: 'ChainPePolicyVault', version: '1', chainId: call.chainId, verifyingContract: vault },
          types: VAULT_SPEND_TYPES,
          primaryType: 'Spend',
          message: { owner: a.owner, to: a.to, amount: a.amount, nonce: a.nonce, deadline: call.deadline },
          signature: call.sig
        }).catch(() => null)
      }
      return { vault: l.address, owner: a.owner, to: a.to, amount: a.amount, sessionKey }
    })
  )
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
      hash ? readSettlement(deps.client, hash, deps.vault) : Promise.resolve(null),
      servicesForAgent(deps.db, row.agentId),
      readAgent(deps, row.agentId),
      hash ? receiptClaimed(deps.db, hash, row.id) : Promise.resolve(false)
    ])
    const verdict = verifyFeedbackPayment({
      feedback: { agentId: row.agentId, client: row.client, feedbackHash: hash },
      receipt,
      usdc: deps.usdc,
      vault: deps.vault,
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
