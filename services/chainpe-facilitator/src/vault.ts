/**
 * `chainpe-vault` facilitator mechanism: x402 payments paid BY the PolicyVault.
 *
 * Payload = a PolicyVault EIP-712 `Spend {owner, to, amount, nonce, deadline}`
 * signed by the owner's policy SESSION KEY (see packages/chainpe-sdk/src/vaultScheme.ts).
 *
 *   verify  the offer is ours (scheme, network, vault, USDC); the payload matches
 *           the offer (to = payTo, amount); not expired; nonce = vault.nonces(owner);
 *           the signer is policyOf(owner).sessionKey; vault.previewSpend(owner, to,
 *           amount) is ok — so a capped / non-allowlisted / revoked spend is refused
 *           with the contract's own reason before any gas is spent.
 *   settle  re-verify, then PolicyVault.spend(...) from the serialized settlement
 *           signer with a tight gas limit (Monad bills the limit). The contract
 *           enforces every cap again on-chain.
 *
 * The payTo policy (registered / allow-listed sellers) is applied by app.ts for
 * every scheme.
 */
import { getAddress, isAddress, type Hex } from 'viem'
import type { FacilitatorEvmSigner } from '@x402/evm'
import type {
  Network,
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse
} from '@x402/core/types'

export const VAULT_SCHEME = 'chainpe-vault'
export const VAULT_EIP712_NAME = 'ChainPePolicyVault'
export const VAULT_EIP712_VERSION = '1'

const SPEND_TYPES = {
  Spend: [
    { name: 'owner', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' }
  ]
} as const

export const POLICY_VAULT_ABI = [
  {
    type: 'function',
    name: 'spend',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'sessionSig', type: 'bytes' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'policyOf',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [
      { name: 'maxPerCall', type: 'uint256' },
      { name: 'dailyCap', type: 'uint256' },
      { name: 'totalBudget', type: 'uint256' },
      { name: 'sessionKey', type: 'address' },
      { name: 'expiry', type: 'uint64' },
      { name: 'allowlistOnly', type: 'bool' },
      { name: 'active', type: 'bool' }
    ]
  },
  {
    type: 'function',
    name: 'nonces',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'previewSpend',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [
      { name: 'ok', type: 'bool' },
      { name: 'reason', type: 'string' }
    ]
  },
  {
    type: 'function',
    name: 'token',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }]
  }
] as const

/** `"over per-call cap"` → `vault_over_per_call_cap` (x402 only relays the reason code). */
export function vaultReasonCode(reason: string): string {
  const slug = reason
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
  return `vault_${slug || 'rejected'}`
}

export interface VaultSchemeDeps {
  vault: `0x${string}`
  chainId: number
  usdc: `0x${string}`
  signer: Pick<FacilitatorEvmSigner, 'getAddresses' | 'readContract' | 'verifyTypedData' | 'writeContract' | 'waitForTransactionReceipt'>
  /** Gas estimate for `spend` (also a dry run: throws when it would revert). */
  estimateSpendGas(args: readonly unknown[]): Promise<bigint>
  now?: () => number
  /** Seconds a signed spend must still be valid for when we verify it. */
  minValiditySeconds?: number
}

interface ParsedSpend {
  owner: `0x${string}`
  to: `0x${string}`
  amount: bigint
  nonce: bigint
  deadline: bigint
  signature: Hex
}

const UINT = /^\d{1,78}$/

function parseSpend(payload: Record<string, unknown> | undefined): ParsedSpend | null {
  if (!payload || typeof payload !== 'object') return null
  const { owner, to, amount, nonce, deadline, signature } = payload as Record<string, unknown>
  if (typeof owner !== 'string' || !isAddress(owner)) return null
  if (typeof to !== 'string' || !isAddress(to)) return null
  for (const v of [amount, nonce, deadline]) if (typeof v !== 'string' || !UINT.test(v)) return null
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return null
  return {
    owner: getAddress(owner),
    to: getAddress(to),
    amount: BigInt(amount as string),
    nonce: BigInt(nonce as string),
    deadline: BigInt(deadline as string),
    signature: signature as Hex
  }
}

type Checked = { ok: true; spend: ParsedSpend } | { ok: false; reason: string; message?: string; payer?: string }

export class VaultEvmFacilitatorScheme implements SchemeNetworkFacilitator {
  readonly scheme = VAULT_SCHEME
  readonly caipFamily = 'eip155:*'

  constructor(private readonly deps: VaultSchemeDeps) {}

  getExtra(_network: Network): Record<string, unknown> {
    return { vault: this.deps.vault, name: VAULT_EIP712_NAME, version: VAULT_EIP712_VERSION }
  }

  getSigners(_network: string): string[] {
    return [...this.deps.signer.getAddresses()]
  }

  private async check(payload: PaymentPayload, req: PaymentRequirements): Promise<Checked> {
    const d = this.deps
    if (req.scheme !== VAULT_SCHEME) return { ok: false, reason: 'unsupported_scheme' }
    if (req.network !== `eip155:${d.chainId}`) return { ok: false, reason: 'unsupported_network' }
    if (String(req.extra?.vault ?? '').toLowerCase() !== d.vault.toLowerCase()) {
      return { ok: false, reason: 'vault_unknown' }
    }
    if (req.asset?.toLowerCase() !== d.usdc.toLowerCase()) return { ok: false, reason: 'unsupported_asset' }
    if (!UINT.test(req.amount ?? '') || !isAddress(req.payTo ?? '')) return { ok: false, reason: 'invalid_requirements' }

    const spend = parseSpend(payload.payload)
    if (!spend) return { ok: false, reason: 'invalid_payload' }
    const payer = spend.owner
    if (spend.to.toLowerCase() !== req.payTo.toLowerCase()) return { ok: false, reason: 'vault_recipient_mismatch', payer }
    if (spend.amount !== BigInt(req.amount)) return { ok: false, reason: 'vault_amount_mismatch', payer }
    const now = BigInt(Math.floor((d.now ?? Date.now)() / 1000))
    if (spend.deadline < now + BigInt(d.minValiditySeconds ?? 5)) return { ok: false, reason: 'vault_authorization_expired', payer }

    const read = (functionName: 'policyOf' | 'nonces' | 'previewSpend', args: readonly unknown[]) =>
      d.signer.readContract({ address: d.vault, abi: POLICY_VAULT_ABI, functionName, args })
    const [policy, nonce, preview] = (await Promise.all([
      read('policyOf', [spend.owner]),
      read('nonces', [spend.owner]),
      read('previewSpend', [spend.owner, spend.to, spend.amount])
    ])) as [readonly unknown[], bigint, readonly [boolean, string]]

    if (nonce !== spend.nonce) {
      return { ok: false, reason: 'vault_nonce_mismatch', message: `vault nonce is ${nonce}, payload has ${spend.nonce}`, payer }
    }
    const sessionKey = policy[3] as `0x${string}`
    const sigOk =
      /^0x0{40}$/i.test(sessionKey) === false &&
      (await d.signer.verifyTypedData({
        address: sessionKey,
        domain: { name: VAULT_EIP712_NAME, version: VAULT_EIP712_VERSION, chainId: d.chainId, verifyingContract: d.vault },
        types: SPEND_TYPES as unknown as Record<string, unknown>,
        primaryType: 'Spend',
        message: { owner: spend.owner, to: spend.to, amount: spend.amount, nonce: spend.nonce, deadline: spend.deadline },
        signature: spend.signature
      }))
    if (!sigOk) return { ok: false, reason: 'vault_invalid_session_signature', payer }

    const [ok, why] = preview
    if (!ok) return { ok: false, reason: vaultReasonCode(why), message: why, payer }
    return { ok: true, spend }
  }

  async verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
    const c = await this.check(payload, requirements)
    if (!c.ok) return { isValid: false, invalidReason: c.reason, invalidMessage: c.message, payer: c.payer }
    return { isValid: true, payer: c.spend.owner }
  }

  async settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    const network = requirements.network
    const c = await this.check(payload, requirements)
    if (!c.ok) {
      return { success: false, errorReason: c.reason, errorMessage: c.message, payer: c.payer, transaction: '', network }
    }
    const s = c.spend
    const args = [s.owner, s.to, s.amount, s.deadline, s.signature] as const
    let gas: bigint
    try {
      gas = await this.deps.estimateSpendGas(args)
    } catch (err) {
      return {
        success: false,
        errorReason: 'vault_spend_would_revert',
        errorMessage: (err as Error).message?.split('\n')[0],
        payer: s.owner,
        transaction: '',
        network
      }
    }
    // Monad charges the gas LIMIT: estimate + 10% headroom, nothing more.
    const hash = await this.deps.signer.writeContract({
      address: this.deps.vault,
      abi: POLICY_VAULT_ABI,
      functionName: 'spend',
      args,
      gas: (gas * 110n) / 100n
    })
    const receipt = await this.deps.signer.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') {
      return { success: false, errorReason: 'vault_spend_reverted', payer: s.owner, transaction: hash, network }
    }
    return { success: true, payer: s.owner, transaction: hash, network, amount: s.amount.toString() }
  }
}

/** Builds the vault mechanism on the production settlement signer (serialized writes). */
export function createVaultScheme(
  cfg: { policyVault?: `0x${string}`; chain: { id: number }; usdc: `0x${string}` },
  settlement: {
    address: `0x${string}`
    signer: VaultSchemeDeps['signer']
    publicClient: { estimateContractGas(args: never): Promise<bigint> }
  }
): VaultEvmFacilitatorScheme {
  if (!cfg.policyVault) throw new Error('createVaultScheme: no PolicyVault configured')
  const vault = cfg.policyVault
  return new VaultEvmFacilitatorScheme({
    vault,
    chainId: cfg.chain.id,
    usdc: cfg.usdc,
    signer: settlement.signer,
    estimateSpendGas: args =>
      settlement.publicClient.estimateContractGas({
        address: vault,
        abi: POLICY_VAULT_ABI,
        functionName: 'spend',
        args,
        account: settlement.address
      } as never)
  })
}
