/**
 * The one place the wallet pays an x402 resource. Everything goes through the
 * SDK's `paidFetch`, which only signs an offer that is `exact`, on our CAIP-2
 * network, in that network's USDC, and within the cap passed here. The cap is
 * min(per-call limit, what is left of today's budget), so an offer that would
 * break the budget is refused before anything is signed.
 */
import { formatUnits, parseUnits } from 'viem'
import { paidFetch, explorerTxUrl, USDC_DECIMALS, type PaidRequest } from '@chainpemonad/sdk'
import type { AppConfig } from './types.js'
import type { SpendingTracker } from './spending.js'
import { getAccount } from './clients.js'

export interface PaidRequestInput {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
  /** Optional lower cap (decimal USDC) for this call only. */
  maxAmount?: string
  timeoutMs?: number
}

export interface WalletPayment {
  amount: string
  recipient: string
  network: string
  txHash?: string
  explorerUrl?: string
  settlement?: unknown
}

export interface WalletPaidResult {
  response: Response
  payment?: WalletPayment
  agentId?: string
}

// Paid calls run one at a time so two concurrent calls cannot both be checked
// against the same remaining daily budget.
let queue: Promise<unknown> = Promise.resolve()
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.catch(() => undefined)
  return run
}

export function makePaidRequest(
  config: AppConfig,
  spending: SpendingTracker,
  input: PaidRequestInput
): Promise<WalletPaidResult> {
  return exclusive(async () => {
    const account = getAccount(config)

    let cap = spending.maxAllowedAtomic()
    if (input.maxAmount) {
      const requested = parseUnits(input.maxAmount, USDC_DECIMALS)
      if (requested < cap) cap = requested
    }
    if (cap <= 0n) {
      throw new Error(`Daily budget of $${spending.getSummary().limits.maxPerDay} USDC is used up.`)
    }

    const method = input.method ?? 'GET'
    const init: RequestInit = { method, headers: input.headers ?? {} }
    if (input.body && method !== 'GET') init.body = input.body

    const paid: PaidRequest = await paidFetch({
      url: input.url,
      init,
      network: config.network,
      account,
      maxPerCallAtomic: cap,
      timeoutMs: input.timeoutMs
    })

    let payment: WalletPayment | undefined
    if (paid.payment) {
      const p = paid.payment
      spending.record(p.amount, p.recipient, config.network, p.txHash)
      payment = {
        amount: p.amount,
        recipient: p.recipient,
        network: config.network,
        txHash: p.txHash,
        explorerUrl: p.txHash ? explorerTxUrl(config.network, p.txHash) : undefined,
        settlement: p.settlement
      }
    }
    return { response: paid.response, payment, agentId: paid.agentId }
  })
}

export const atomicToUsdc = (atomic: bigint) => formatUnits(atomic, USDC_DECIMALS)
