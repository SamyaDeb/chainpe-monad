/**
 * `chainpe-vault` — an x402 v2 payment scheme paid BY the PolicyVault.
 *
 * Instead of an EIP-3009 authorization from the agent's own wallet, the agent's
 * policy SESSION KEY signs the PolicyVault EIP-712 `Spend`
 * `{owner, to, amount, nonce, deadline}`; the facilitator settles it with
 * `PolicyVault.spend(...)`, which pays the seller straight from the owner's
 * vault balance. The contract enforces per-call / daily / total caps, expiry,
 * revocation and the recipient allowlist on every call.
 *
 * Wire format (`PaymentRequirements` for this scheme):
 *   scheme  "chainpe-vault"
 *   network eip155:143 | eip155:10143
 *   asset   the network's USDC (the vault's token)
 *   amount  atomic USDC; payTo = the seller (= Spend.to)
 *   extra   { vault, name: "ChainPePolicyVault", version: "1", agentId? }
 * Payload: { owner, to, amount, nonce, deadline, signature } (decimal strings).
 *
 * Vault nonces are sequential per owner, so signing is serialized per owner
 * (see {@link withVaultLock}) and a nonce is never handed to two in-flight spends.
 */
import { getAddress, isAddress, type Hex } from 'viem'
import type { LocalAccount } from 'viem/accounts'
import type {
  Network,
  PaymentRequirements,
  Price,
  AssetAmount,
  SchemeNetworkClient,
  SchemeNetworkServer,
  SupportedKind
} from '@x402/core/types'

export const VAULT_SCHEME = 'chainpe-vault'
export const VAULT_EIP712_NAME = 'ChainPePolicyVault'
export const VAULT_EIP712_VERSION = '1'

export const SPEND_TYPES = {
  Spend: [
    { name: 'owner', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' }
  ]
} as const

/** The `payload` of a `chainpe-vault` PaymentPayload. */
export interface VaultSpendPayload {
  owner: string
  to: string
  amount: string
  nonce: string
  deadline: string
  signature: Hex
}

export function vaultDomain(chainId: number, vault: string) {
  return {
    name: VAULT_EIP712_NAME,
    version: VAULT_EIP712_VERSION,
    chainId,
    verifyingContract: getAddress(vault)
  } as const
}

/** Longest a signed spend stays valid, whatever the server asks for. */
export const MAX_VAULT_AUTH_SECONDS = 300

// ─── per-owner serialization + nonce tracking ────────────────────────────────

interface OwnerState {
  tail: Promise<unknown>
  /** Lowest nonce not yet consumed by a spend we saw settle. */
  nextNonce: bigint
}
const owners = new Map<string, OwnerState>()

function ownerKey(chainId: number, vault: string, owner: string) {
  return `${chainId}:${vault.toLowerCase()}:${owner.toLowerCase()}`
}

/**
 * Runs `task` while holding the lock for (chain, vault, owner): one vault spend
 * per owner is signed + settled at a time in this process. `task` gets the nonce
 * to sign — max(on-chain nonce, last settled + 1), which survives an RPC node
 * that has not seen the last spend yet — and reports back whether the spend
 * settled, so the next one moves past it.
 */
export function withVaultLock<T>(
  params: { chainId: number; vault: string; owner: string; readNonce: () => Promise<bigint> },
  task: (nonce: bigint, settled: () => void) => Promise<T>
): Promise<T> {
  const key = ownerKey(params.chainId, params.vault, params.owner)
  const state = owners.get(key) ?? { tail: Promise.resolve(), nextNonce: 0n }
  owners.set(key, state)
  const run = async () => {
    const onchain = await params.readNonce()
    const nonce = onchain > state.nextNonce ? onchain : state.nextNonce
    return task(nonce, () => {
      if (nonce + 1n > state.nextNonce) state.nextNonce = nonce + 1n
    })
  }
  const result = state.tail.then(run, run)
  state.tail = result.catch(() => undefined)
  return result
}

/** Test helper: forget all per-owner nonce state. */
export function resetVaultNonces(): void {
  owners.clear()
}

// ─── client side ─────────────────────────────────────────────────────────────

export interface VaultClientSchemeOptions {
  /** The policy's session key (signs spends; needs no funds). */
  sessionKey: LocalAccount
  /** Vault owner whose balance pays. */
  owner: string
  vault: string
  chainId: number
  /** Nonce to sign the next spend with (set by the caller under {@link withVaultLock}). */
  nonce: () => bigint
  now?: () => number
}

/** x402 client mechanism: signs a PolicyVault `Spend` for the offer. */
export class VaultEvmClientScheme implements SchemeNetworkClient {
  readonly scheme = VAULT_SCHEME

  constructor(private readonly opts: VaultClientSchemeOptions) {}

  async createPaymentPayload(x402Version: number, req: PaymentRequirements) {
    const { opts } = this
    const vault = String(req.extra?.vault ?? '')
    if (!isAddress(vault) || vault.toLowerCase() !== opts.vault.toLowerCase()) {
      throw new Error(`chainpe-vault offer names vault ${vault || '(none)'}, not ${opts.vault}`)
    }
    if (!isAddress(req.payTo)) throw new Error(`invalid payTo ${req.payTo}`)
    const now = Math.floor((opts.now ?? Date.now)() / 1000)
    const ttl = Math.min(Math.max(Number(req.maxTimeoutSeconds) || 60, 1), MAX_VAULT_AUTH_SECONDS)
    const message = {
      owner: getAddress(opts.owner),
      to: getAddress(req.payTo),
      amount: BigInt(req.amount),
      nonce: opts.nonce(),
      deadline: BigInt(now + ttl)
    }
    const signature = await opts.sessionKey.signTypedData({
      domain: vaultDomain(opts.chainId, opts.vault),
      types: SPEND_TYPES,
      primaryType: 'Spend',
      message
    })
    const payload: VaultSpendPayload = {
      owner: message.owner,
      to: message.to,
      amount: message.amount.toString(),
      nonce: message.nonce.toString(),
      deadline: message.deadline.toString(),
      signature
    }
    return { x402Version, payload: payload as unknown as Record<string, unknown> }
  }
}

// ─── resource-server side ────────────────────────────────────────────────────

/**
 * x402 resource-server mechanism for `chainpe-vault`. Prices must be explicit
 * asset amounts (no default-asset lookup). The vault address and its EIP-712
 * domain come from the facilitator's `/supported` kind `extra`, unless the route
 * already set them.
 */
export class VaultEvmServerScheme implements SchemeNetworkServer {
  readonly scheme = VAULT_SCHEME
  readonly defaultAssetTransferMethod = 'default'
  readonly paymentFlows = {
    // Same as `exact`: verify before the handler, settle after it succeeds.
    default: { supported: ['authorization', 'upfront'] as const, default: 'authorization' as const }
  }

  async parsePrice(price: Price, network: Network): Promise<AssetAmount> {
    if (typeof price === 'object' && price !== null && 'amount' in price && price.asset) {
      return { amount: price.amount, asset: price.asset, extra: price.extra ?? {} }
    }
    throw new Error(`chainpe-vault on ${network} needs an explicit { asset, amount } price`)
  }

  async enhancePaymentRequirements(req: PaymentRequirements, kind: SupportedKind): Promise<PaymentRequirements> {
    return { ...req, extra: { ...(kind.extra ?? {}), ...(req.extra ?? {}) } }
  }
}
