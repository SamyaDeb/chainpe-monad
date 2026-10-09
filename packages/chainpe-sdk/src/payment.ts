/**
 * The x402 v2 client flow: request → 402 → pick an offer we are willing to pay →
 * sign → retry with `PAYMENT-SIGNATURE` → read `PAYMENT-RESPONSE`.
 *
 * We run the loop ourselves (rather than `wrapFetchWithPayment`) so we can
 * enforce ChainPe's own safety rules and report the settlement tx hash and
 * payTo, which payment-backed reputation needs.
 *
 * An offer is only paid when ALL of these hold:
 *   - scheme `exact` — or, in mandate mode (`vault` set), `chainpe-vault` naming
 *     our PolicyVault (see vaultScheme.ts)
 *   - on our network (CAIP-2)
 *   - in that network's USDC (a server cannot make us sign for another token)
 *   - amount ≤ maxPerCall
 *
 * Mandate mode: the session key signs a PolicyVault spend and the vault pays,
 * so its on-chain caps and allowlist apply to every call. `exact` offers are
 * then ignored unless `vault.fallbackToExact` is set.
 */
import { x402Client, x402HTTPClient } from '@x402/core/client'
import type { PaymentRequired, PaymentRequirements } from '@x402/core/types'
import { ExactEvmScheme } from '@x402/evm/exact/client'
import { formatUnits, getAddress } from 'viem'
import type { LocalAccount } from 'viem/accounts'
import { getNetwork, publicClientFor, type ChainPeNetwork } from './networks.js'
import { VAULT_SCHEME, VaultEvmClientScheme, withVaultLock } from './vaultScheme.js'
import { ChainPePaymentError, type PaymentInfo } from './types.js'

export interface PaidRequest {
  /** Final live (unconsumed) response. */
  response: Response
  /** Present when a payment was made. */
  payment?: PaymentInfo
  /** The offer we paid, when a payment was made. */
  accepted?: PaymentRequirements
  /** Provider's ERC-8004 agent id, advertised on the 402. */
  agentId?: string
}

/** Mandate mode: pay through a PolicyVault with the policy's session key. */
export interface VaultPaymentOptions {
  /** PolicyVault proxy address. */
  vaultAddress: string
  /** Vault owner whose balance pays. */
  owner: string
  /** The policy's session key. */
  sessionKey: LocalAccount
  /** Pay `exact` offers from `account` when no vault offer is acceptable (default false). */
  fallbackToExact?: boolean
  /** Reads the owner's current vault nonce (defaults to an RPC read). */
  readNonce?: () => Promise<bigint>
}

export interface PaidFetchOptions {
  url: string
  init?: RequestInit
  network: ChainPeNetwork
  account: LocalAccount
  maxPerCallAtomic: bigint
  timeoutMs?: number
  fetchImpl?: typeof fetch
  vault?: VaultPaymentOptions
}

export type OfferCheck = { ok: true } | { ok: false; reason: string }

/**
 * Decides whether we will sign for an offer. Pure. Without `vaultAddress` only
 * `exact` offers pass; with it only `chainpe-vault` offers for that vault.
 */
export function checkOffer(
  offer: PaymentRequirements,
  network: ChainPeNetwork,
  maxPerCallAtomic: bigint,
  vaultAddress?: string
): OfferCheck {
  const net = getNetwork(network)
  const scheme = vaultAddress ? VAULT_SCHEME : 'exact'
  if (offer.scheme !== scheme) return { ok: false, reason: `scheme "${offer.scheme}" is not supported` }
  if (vaultAddress && String(offer.extra?.vault ?? '').toLowerCase() !== vaultAddress.toLowerCase()) {
    return { ok: false, reason: `vault ${String(offer.extra?.vault ?? '(none)')} is not ${vaultAddress}` }
  }
  if (offer.network !== net.caip2) return { ok: false, reason: `network ${offer.network} is not ${net.caip2}` }
  if (offer.asset?.toLowerCase() !== net.usdc.address.toLowerCase()) {
    return { ok: false, reason: `asset ${offer.asset} is not ${network} USDC` }
  }
  if (!/^\d+$/.test(offer.amount ?? '')) return { ok: false, reason: `invalid amount "${offer.amount}"` }
  if (BigInt(offer.amount) > maxPerCallAtomic) {
    return {
      ok: false,
      reason: `${formatUnits(BigInt(offer.amount), net.usdc.decimals)} USDC exceeds maxPerCall ${formatUnits(maxPerCallAtomic, net.usdc.decimals)} USDC`
    }
  }
  return { ok: true }
}

function withTimeout(fetchImpl: typeof fetch, timeoutMs: number) {
  return (input: string, init?: RequestInit) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    return fetchImpl(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer))
  }
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.clone().json()
  } catch {
    return undefined
  }
}

export async function paidFetch(opts: PaidFetchOptions): Promise<PaidRequest> {
  const { url, init = {}, network, account, maxPerCallAtomic } = opts
  const net = getNetwork(network)
  const doFetch = withTimeout(opts.fetchImpl ?? fetch, opts.timeoutMs ?? 30_000)

  const initial = await doFetch(url, init)
  if (initial.status !== 402) return { response: initial }

  const vault = opts.vault
  let vaultNonce = 0n
  const client = new x402Client().register(net.caip2, new ExactEvmScheme(account)).setSpendControls(false)
  if (vault) {
    client.register(
      net.caip2,
      new VaultEvmClientScheme({
        sessionKey: vault.sessionKey,
        owner: vault.owner,
        vault: vault.vaultAddress,
        chainId: net.chainId,
        nonce: () => vaultNonce
      })
    )
  }
  const http = new x402HTTPClient(client)

  let required: PaymentRequired
  try {
    required = http.getPaymentRequiredResponse(name => initial.headers.get(name), await readJson(initial))
  } catch (err) {
    throw new ChainPePaymentError(`x402: could not read the payment requirements — ${(err as Error).message}`, {
      reason: 'invalid_402'
    })
  }

  const offers = required.accepts ?? []
  const checks = offers.map(o => ({ offer: o, check: checkOffer(o, network, maxPerCallAtomic, vault?.vaultAddress) }))
  let chosen = checks.find(c => c.check.ok)?.offer
  if (!chosen && vault?.fallbackToExact) {
    const exact = offers.map(o => ({ offer: o, check: checkOffer(o, network, maxPerCallAtomic) }))
    checks.push(...exact)
    chosen = exact.find(c => c.check.ok)?.offer
  }
  if (!chosen) {
    const why = checks.map(c => (c.check.ok ? '' : c.check.reason)).filter(Boolean).join('; ') || 'no offers'
    throw new ChainPePaymentError(`x402: no acceptable payment offer for ${url} (${why}).`, {
      reason: 'no_acceptable_offer'
    })
  }

  const offer = chosen
  const payAndSend = () => sendPayment({ url, init, network, offer, required, http, doFetch })
  let result: { response: Response; payment: PaymentInfo }
  if (offer.scheme === VAULT_SCHEME && vault) {
    const owner = getAddress(vault.owner)
    const readNonce =
      vault.readNonce ??
      (() =>
        publicClientFor(network).readContract({
          address: getAddress(vault.vaultAddress),
          abi: VAULT_NONCES_ABI,
          functionName: 'nonces',
          args: [owner]
        }) as Promise<bigint>)
    result = await withVaultLock(
      { chainId: net.chainId, vault: vault.vaultAddress, owner, readNonce },
      async (nonce, settled) => {
        vaultNonce = nonce
        const r = await payAndSend()
        // A reported settlement tx means the spend consumed this nonce.
        if (r.payment.txHash) settled()
        return r
      }
    )
    result.payment.owner = owner
  } else {
    result = await payAndSend()
  }
  const { response: paid, payment } = result

  const agentId =
    initial.headers.get('x-chainpe-agent-id') ??
    (required.extensions?.chainpe as { agentId?: string } | undefined)?.agentId ??
    (chosen.extra?.agentId as string | undefined)

  return { response: paid, payment, accepted: chosen, agentId: agentId ?? undefined }
}

const VAULT_NONCES_ABI = [
  {
    type: 'function',
    name: 'nonces',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  }
] as const

/** Signs `chosen`, retries the request with `PAYMENT-SIGNATURE`, reads the settlement. */
async function sendPayment(args: {
  url: string
  init: RequestInit
  network: ChainPeNetwork
  offer: PaymentRequirements
  required: PaymentRequired
  http: x402HTTPClient
  doFetch: (input: string, init?: RequestInit) => Promise<Response>
}): Promise<{ response: Response; payment: PaymentInfo }> {
  const { url, init, network, offer: chosen, required, http, doFetch } = args
  const net = getNetwork(network)
  let headers: Record<string, string>
  try {
    const payload = await http.createPaymentPayload({ ...required, accepts: [chosen] })
    headers = http.encodePaymentSignatureHeader(payload)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new ChainPePaymentError(`x402: failed to sign payment — ${msg}`, { reason: msg })
  }

  const retryHeaders = new Headers(init.headers)
  for (const [k, v] of Object.entries(headers)) retryHeaders.set(k, v)
  const paid = await doFetch(url, { ...init, headers: retryHeaders })

  const amount = formatUnits(BigInt(chosen.amount), net.usdc.decimals)
  if (paid.status === 402) {
    let detail = 'the server did not accept the payment'
    try {
      detail = http.getPaymentRequiredResponse(name => paid.headers.get(name), await readJson(paid)).error ?? detail
    } catch {
      /* keep the generic detail */
    }
    throw new ChainPePaymentError(
      `x402: payment signed but not accepted (${detail}). Attempted ${amount} USDC → ${chosen.payTo}.`,
      { reason: 'settlement_rejected', detail }
    )
  }

  const payment: PaymentInfo = { amount, recipient: chosen.payTo, network, scheme: chosen.scheme }
  try {
    const settle = http.getPaymentSettleResponse(name => paid.headers.get(name))
    payment.settlement = settle
    if (settle.transaction) payment.txHash = settle.transaction
  } catch {
    /* provider did not return a settlement header — keep the payment info we have */
  }

  return { response: paid, payment }
}
