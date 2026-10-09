/**
 * ERC-8004 reputation — read aggregate scores + post feedback.
 *
 * A provider's score is the aggregate of feedback left by paying clients on the
 * ERC-8004 Reputation Registry. `getSummary` reverts on an empty client list, so
 * we always enumerate clients via `getClients` first (empty ⇒ unscored). The
 * registry blocks self-feedback, so a provider can't inflate its own score.
 */
import { createWalletClient, erc20Abi, http, parseEventLogs, type Hex, type WalletClient } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  publicClientFor,
  rpcUrlFor,
  chainFor,
  getCaip2,
  getUsdcAddress,
  normalizeKey
} from './networks.js'
import type { ChainPeNetwork, ReputationSummary } from './types.js'

const REPUTATION_ABI = [
  {
    type: 'function',
    name: 'giveFeedback',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'value', type: 'int128' },
      { name: 'valueDecimals', type: 'uint8' },
      { name: 'tag1', type: 'string' },
      { name: 'tag2', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'feedbackURI', type: 'string' },
      { name: 'feedbackHash', type: 'bytes32' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'getSummary',
    stateMutability: 'view',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'clientAddresses', type: 'address[]' },
      { name: 'tag1', type: 'string' },
      { name: 'tag2', type: 'string' }
    ],
    outputs: [
      { name: 'count', type: 'uint64' },
      { name: 'summaryValue', type: 'int128' },
      { name: 'summaryValueDecimals', type: 'uint8' }
    ]
  },
  {
    type: 'function',
    name: 'getClients',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address[]' }]
  }
] as const

/** Converts the on-chain (value, decimals) summary into a human score. Pure. */
export function summaryToScore(summaryValue: bigint, decimals: number): number {
  return Number(summaryValue) / 10 ** decimals
}

/**
 * Reads a provider agent's aggregate reputation. Returns null when the agent is
 * unlinked (`agentId` 0/empty) or no registry is configured; `count: 0` when the
 * agent exists but has no feedback yet.
 */
export async function getReputation(
  network: ChainPeNetwork,
  registry: `0x${string}` | undefined,
  agentId: string
): Promise<ReputationSummary | null> {
  if (!agentId || agentId === '0') return null
  if (!registry) return null

  try {
    const client = publicClientFor(network)
    const id = BigInt(agentId)
    const clients = (await client.readContract({
      address: registry,
      abi: REPUTATION_ABI,
      functionName: 'getClients',
      args: [id]
    })) as readonly `0x${string}`[]

    if (clients.length === 0) return { count: 0, score: null }

    const [count, summaryValue, decimals] = (await client.readContract({
      address: registry,
      abi: REPUTATION_ABI,
      functionName: 'getSummary',
      args: [id, clients as `0x${string}`[], '', '']
    })) as readonly [bigint, bigint, number]

    return {
      count: Number(count),
      score: summaryToScore(summaryValue, Number(decimals))
    }
  } catch {
    return null
  }
}

/** Matches a 32-byte tx hash. */
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/

/** ERC-8004 tags every ChainPe receipt-backed feedback carries. */
export const FEEDBACK_TAG1 = 'x402'
export const FEEDBACK_TAG2 = 'paid-call'

/** `x402:eip155:<chainId>:<txHash>` — the feedbackURI that names the payment. */
export function paymentFeedbackUri(network: ChainPeNetwork, paymentTxHash: string): string {
  return `x402:${getCaip2(network)}:${paymentTxHash.toLowerCase()}`
}

export interface GiveFeedbackParams {
  agentId: string
  /** Score 0–100 (valueDecimals 0). Rounded and clamped to 0–100. */
  value: number
  /**
   * Settlement tx hash of the x402 payment this rating is about. Required:
   * it becomes the ERC-8004 `feedbackHash`, which the ChainPe indexer checks
   * against the on-chain USDC transfer ("no receipt, no rating").
   */
  paymentTxHash: string
  endpoint?: string
  /** Await the receipt before returning. Defaults to false. */
  waitConfirm?: boolean
}

/** The canonical `giveFeedback` arguments for a receipt-backed rating. Pure. */
export function buildFeedbackArgs(
  network: ChainPeNetwork,
  params: GiveFeedbackParams
): readonly [bigint, bigint, number, string, string, string, string, Hex] {
  if (!/^\d+$/.test(params.agentId) || params.agentId === '0') {
    throw new Error(`Invalid ERC-8004 agentId "${params.agentId}"`)
  }
  if (!params.paymentTxHash || !TX_HASH_RE.test(params.paymentTxHash)) {
    throw new Error('A payment receipt (settlement tx hash) is required to give feedback')
  }
  if (!Number.isFinite(params.value)) throw new Error('Feedback value must be a number')
  const value = Math.min(100, Math.max(0, Math.round(params.value)))
  const hash = params.paymentTxHash.toLowerCase() as Hex
  return [
    BigInt(params.agentId),
    BigInt(value),
    0,
    FEEDBACK_TAG1,
    FEEDBACK_TAG2,
    params.endpoint ?? '',
    paymentFeedbackUri(network, hash),
    hash
  ] as const
}

/**
 * Posts receipt-backed ERC-8004 feedback for a provider agent on the canonical
 * Reputation Registry: `feedbackHash` = the x402 settlement tx hash, tags
 * `x402` / `paid-call`, `feedbackURI` = `x402:eip155:<chainId>:<txHash>`.
 * Returns the feedback tx hash.
 */
export async function giveFeedback(
  network: ChainPeNetwork,
  registry: `0x${string}` | undefined,
  privateKey: string,
  params: GiveFeedbackParams
): Promise<string> {
  if (!registry) throw new Error('Reputation registry address not configured')
  const args = buildFeedbackArgs(network, params)

  const account = privateKeyToAccount(normalizeKey(privateKey))
  const wallet: WalletClient = createWalletClient({
    account,
    chain: chainFor(network),
    transport: http(rpcUrlFor(network))
  })

  const hash = await wallet.writeContract({
    account,
    chain: chainFor(network),
    address: registry,
    abi: REPUTATION_ABI,
    functionName: 'giveFeedback',
    args
  })

  if (params.waitConfirm) {
    await publicClientFor(network).waitForTransactionReceipt({ hash })
  }
  return hash
}

export interface PaymentReceiptCheck {
  ok: boolean
  /** Total USDC (atomic) moved from `payer` (to `payTo`, when given) in the tx. */
  amount: bigint
  reason?: string
}

/**
 * Checks that `paymentTxHash` is a successful tx on `network` containing a USDC
 * `Transfer` from `payer` (and to `payTo`, when given). Used by the MCP wallet
 * to refuse feedback that is not backed by a payment the wallet made.
 */
export async function verifyPaymentReceipt(
  network: ChainPeNetwork,
  paymentTxHash: string,
  payer: string,
  payTo?: string
): Promise<PaymentReceiptCheck> {
  if (!TX_HASH_RE.test(paymentTxHash)) return { ok: false, amount: 0n, reason: 'not a tx hash' }
  let receipt
  try {
    receipt = await publicClientFor(network).getTransactionReceipt({ hash: paymentTxHash as Hex })
  } catch {
    return { ok: false, amount: 0n, reason: 'transaction not found' }
  }
  if (receipt.status !== 'success') return { ok: false, amount: 0n, reason: 'transaction reverted' }
  const usdc = getUsdcAddress(network).toLowerCase()
  const transfers = parseEventLogs({ abi: erc20Abi, eventName: 'Transfer', logs: receipt.logs })
  let amount = 0n
  for (const t of transfers) {
    if (t.address.toLowerCase() !== usdc) continue
    if (t.args.from.toLowerCase() !== payer.toLowerCase()) continue
    if (payTo && t.args.to.toLowerCase() !== payTo.toLowerCase()) continue
    amount += t.args.value
  }
  return amount > 0n
    ? { ok: true, amount }
    : { ok: false, amount: 0n, reason: 'no USDC transfer from this wallet in that transaction' }
}
