/**
 * What this facilitator is willing to pay gas for.
 *
 * A facilitator that settles any valid authorization is an open gas relay:
 * anyone could make it pay for transfers between their own wallets. We only
 * settle USDC `exact` payments on our network, above a minimum, to a payTo that
 * is allow-listed or registered in the ChainPe registry (via the indexer).
 */
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types'

export type PolicyResult = { ok: true } | { ok: false; reason: string }

export interface PolicyContext {
  caip2: string
  usdc: string
  minAmountAtomic: bigint
  isPayToAllowed(payTo: string): boolean
}

export function checkPayment(
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  ctx: PolicyContext
): PolicyResult {
  if (requirements.scheme !== 'exact') return { ok: false, reason: 'unsupported_scheme' }
  if (requirements.network !== ctx.caip2) return { ok: false, reason: 'unsupported_network' }
  if (requirements.asset?.toLowerCase() !== ctx.usdc.toLowerCase()) {
    return { ok: false, reason: 'unsupported_asset' }
  }
  if (!/^\d+$/.test(requirements.amount ?? '')) return { ok: false, reason: 'invalid_amount' }
  if (BigInt(requirements.amount) < ctx.minAmountAtomic) return { ok: false, reason: 'amount_below_minimum' }
  if (!requirements.payTo || !ctx.isPayToAllowed(requirements.payTo)) {
    return { ok: false, reason: 'payto_not_registered' }
  }

  // The payer signed `accepted`; it must be the same offer we're asked to settle.
  const a = payload.accepted
  if (
    !a ||
    a.scheme !== requirements.scheme ||
    a.network !== requirements.network ||
    a.asset?.toLowerCase() !== requirements.asset.toLowerCase() ||
    a.amount !== requirements.amount ||
    a.payTo?.toLowerCase() !== requirements.payTo.toLowerCase()
  ) {
    return { ok: false, reason: 'accepted_requirements_mismatch' }
  }
  return { ok: true }
}

/**
 * payTo allowlist: static addresses from env plus the payTo of every service
 * registered in the ChainPe registry (refreshed from the indexer).
 */
export class PayToAllowlist {
  private registered = new Set<string>()
  private lastRefresh = 0

  constructor(
    private readonly staticList: Set<string>,
    private readonly requireRegistered: boolean,
    private readonly indexerUrl?: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  isAllowed(payTo: string): boolean {
    const a = payTo.toLowerCase()
    if (this.staticList.has(a) || this.registered.has(a)) return true
    return !this.requireRegistered
  }

  get registeredCount(): number {
    return this.registered.size
  }

  get lastRefreshedAt(): number {
    return this.lastRefresh
  }

  /** Reloads registered payTo addresses from the indexer. Keeps the old set on failure. */
  async refresh(): Promise<void> {
    if (!this.indexerUrl) return
    const next = new Set<string>()
    const limit = 100
    for (let offset = 0; ; offset += limit) {
      const res = await this.fetchImpl(`${this.indexerUrl}/services?limit=${limit}&offset=${offset}`)
      if (!res.ok) throw new Error(`indexer responded ${res.status}`)
      const body = (await res.json()) as { total: number; items: { walletAddress?: string }[] }
      for (const s of body.items ?? []) if (s.walletAddress) next.add(s.walletAddress.toLowerCase())
      if (offset + limit >= (body.total ?? 0) || (body.items ?? []).length === 0) break
    }
    this.registered = next
    this.lastRefresh = Date.now()
  }
}
