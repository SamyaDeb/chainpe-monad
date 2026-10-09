import { describe, expect, it, vi } from 'vitest'
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { verifyTypedData } from 'viem'
import { VAULT_SCHEME, VaultEvmFacilitatorScheme, vaultReasonCode, type VaultSchemeDeps } from '../src/vault.js'
import { checkPayment } from '../src/policy.js'
import { loadConfig } from '../src/config.js'

const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' // public Hardhat key
const USDC = '0x534b2f3A21130d7a60830c2Df862319e593943A3'
const VAULT = '0x1Eb25cDD00bCCEC89782Aaf12600Ac5eFeEeAB65'
const OWNER = '0x2222222222222222222222222222222222222222'
const SELLER = '0x1111111111111111111111111111111111111111'
const CHAIN_ID = 10143
const session = privateKeyToAccount(generatePrivateKey())
const NOW = 1_800_000_000_000

const requirements = (over: Partial<PaymentRequirements> = {}): PaymentRequirements => ({
  scheme: VAULT_SCHEME,
  network: `eip155:${CHAIN_ID}`,
  asset: USDC,
  amount: '10000',
  payTo: SELLER,
  maxTimeoutSeconds: 60,
  extra: { vault: VAULT, name: 'ChainPePolicyVault', version: '1' },
  ...over
})

async function payload(over: Record<string, unknown> = {}, signer = session): Promise<PaymentPayload> {
  const message = {
    owner: OWNER,
    to: SELLER,
    amount: 10000n,
    nonce: 3n,
    deadline: BigInt(NOW / 1000 + 60)
  } as const
  const signature = await signer.signTypedData({
    domain: { name: 'ChainPePolicyVault', version: '1', chainId: CHAIN_ID, verifyingContract: VAULT },
    types: {
      Spend: [
        { name: 'owner', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' }
      ]
    },
    primaryType: 'Spend',
    message
  })
  return {
    x402Version: 2,
    accepted: requirements(),
    payload: {
      owner: message.owner,
      to: message.to,
      amount: message.amount.toString(),
      nonce: message.nonce.toString(),
      deadline: message.deadline.toString(),
      signature,
      ...over
    }
  }
}

function deps(over: { preview?: [boolean, string]; nonce?: bigint; estimate?: () => Promise<bigint> } = {}) {
  const writeContract = vi.fn(async () => ('0x' + 'ee'.repeat(32)) as `0x${string}`)
  const d: VaultSchemeDeps = {
    vault: VAULT,
    chainId: CHAIN_ID,
    usdc: USDC,
    now: () => NOW,
    estimateSpendGas: over.estimate ?? (async () => 100_000n),
    signer: {
      getAddresses: () => ['0x3333333333333333333333333333333333333333'],
      readContract: async ({ functionName }) => {
        if (functionName === 'nonces') return over.nonce ?? 3n
        if (functionName === 'previewSpend') return over.preview ?? [true, '']
        if (functionName === 'policyOf') return [20000n, 50000n, 100000n, session.address, 2_000_000_000n, true, true]
        throw new Error(functionName)
      },
      verifyTypedData: args => verifyTypedData(args as never),
      writeContract,
      waitForTransactionReceipt: async () => ({ status: 'success' })
    }
  }
  return { d, writeContract }
}

describe('vaultReasonCode', () => {
  it.each([
    ['over per-call cap', 'vault_over_per_call_cap'],
    ['recipient not allowlisted', 'vault_recipient_not_allowlisted'],
    ['session inactive', 'vault_session_inactive'],
    ['to=0', 'vault_to_0'],
    ['', 'vault_rejected']
  ])('%j → %s', (reason, code) => expect(vaultReasonCode(reason)).toBe(code))
})

describe('VaultEvmFacilitatorScheme', () => {
  it('advertises the vault and its EIP-712 domain', () => {
    expect(new VaultEvmFacilitatorScheme(deps().d).getExtra('eip155:10143')).toEqual({
      vault: VAULT,
      name: 'ChainPePolicyVault',
      version: '1'
    })
  })

  it('verifies a session-key-signed spend; payer = owner', async () => {
    const s = new VaultEvmFacilitatorScheme(deps().d)
    expect(await s.verify(await payload(), requirements())).toEqual({ isValid: true, payer: OWNER })
  })

  it.each([
    ['vault_unknown', {}, { extra: { vault: SELLER } }],
    ['unsupported_asset', {}, { asset: SELLER }],
    ['unsupported_network', {}, { network: 'eip155:143' }],
    ['invalid_payload', { signature: '0x1234' }, {}],
    ['invalid_payload', { amount: '-1' }, {}],
    ['vault_recipient_mismatch', {}, { payTo: '0x4444444444444444444444444444444444444444' }],
    ['vault_amount_mismatch', {}, { amount: '20000' }],
    ['vault_authorization_expired', { deadline: String(NOW / 1000 + 2) }, {}]
  ])('refuses %s', async (reason, payloadOver, reqOver) => {
    const s = new VaultEvmFacilitatorScheme(deps().d)
    const r = await s.verify(await payload(payloadOver), requirements(reqOver as Partial<PaymentRequirements>))
    expect(r).toMatchObject({ isValid: false, invalidReason: reason })
  })

  it('refuses a signature from anyone but the policy session key', async () => {
    const s = new VaultEvmFacilitatorScheme(deps().d)
    const r = await s.verify(await payload({}, privateKeyToAccount(generatePrivateKey())), requirements())
    expect(r).toMatchObject({ isValid: false, invalidReason: 'vault_invalid_session_signature' })
  })

  it('refuses a nonce that is not the vault nonce', async () => {
    const s = new VaultEvmFacilitatorScheme(deps({ nonce: 4n }).d)
    expect(await s.verify(await payload(), requirements())).toMatchObject({ invalidReason: 'vault_nonce_mismatch' })
  })

  it("relays the contract's previewSpend reason", async () => {
    const s = new VaultEvmFacilitatorScheme(deps({ preview: [false, 'over daily cap'] }).d)
    expect(await s.verify(await payload(), requirements())).toEqual({
      isValid: false,
      invalidReason: 'vault_over_daily_cap',
      invalidMessage: 'over daily cap',
      payer: OWNER
    })
  })

  it('settles with PolicyVault.spend and a gas limit of estimate + 10%', async () => {
    const { d, writeContract } = deps()
    const r = await new VaultEvmFacilitatorScheme(d).settle(await payload(), requirements())
    expect(r).toMatchObject({ success: true, payer: OWNER, transaction: '0x' + 'ee'.repeat(32), amount: '10000' })
    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: VAULT, functionName: 'spend', gas: 110_000n })
    )
  })

  it('does not send a spend that would revert', async () => {
    const { d, writeContract } = deps({ estimate: async () => Promise.reject(new Error('OverDailyCap()')) })
    const r = await new VaultEvmFacilitatorScheme(d).settle(await payload(), requirements())
    expect(r).toMatchObject({ success: false, errorReason: 'vault_spend_would_revert' })
    expect(writeContract).not.toHaveBeenCalled()
  })

  it('does not send a spend that fails verification', async () => {
    const { d, writeContract } = deps({ preview: [false, 'recipient not allowlisted'] })
    const r = await new VaultEvmFacilitatorScheme(d).settle(await payload(), requirements())
    expect(r).toMatchObject({ success: false, errorReason: 'vault_recipient_not_allowlisted' })
    expect(writeContract).not.toHaveBeenCalled()
  })
})

describe('policy + config for chainpe-vault', () => {
  const ctx = { caip2: `eip155:${CHAIN_ID}`, usdc: USDC, minAmountAtomic: 1000n, isPayToAllowed: () => true }
  const withAccepted = (r: PaymentRequirements): PaymentPayload => ({ x402Version: 2, accepted: { ...r }, payload: {} })

  it('settles chainpe-vault only when it is enabled', () => {
    const r = requirements()
    expect(checkPayment(withAccepted(r), r, ctx)).toEqual({ ok: false, reason: 'unsupported_scheme' })
    expect(checkPayment(withAccepted(r), r, { ...ctx, schemes: ['exact', VAULT_SCHEME] })).toEqual({ ok: true })
  })

  it('still applies the payTo policy and the accepted-offer match to vault payments', () => {
    const r = requirements()
    expect(checkPayment(withAccepted(r), r, { ...ctx, schemes: [VAULT_SCHEME], isPayToAllowed: () => false })).toEqual({
      ok: false,
      reason: 'payto_not_registered'
    })
    expect(checkPayment(withAccepted({ ...r, amount: '1' }), r, { ...ctx, schemes: [VAULT_SCHEME] })).toEqual({
      ok: false,
      reason: 'accepted_requirements_mismatch'
    })
  })

  it('uses the deployed testnet vault by default, none on mainnet, and can be turned off', () => {
    expect(loadConfig({ FACILITATOR_PRIVATE_KEY: KEY }).policyVault).toBe(VAULT)
    expect(loadConfig({ FACILITATOR_PRIVATE_KEY: KEY, NETWORK: 'monad' }).policyVault).toBeUndefined()
    expect(loadConfig({ FACILITATOR_PRIVATE_KEY: KEY, POLICY_VAULT_ADDRESS: 'off' }).policyVault).toBeUndefined()
    expect(() => loadConfig({ FACILITATOR_PRIVATE_KEY: KEY, POLICY_VAULT_ADDRESS: '0x12' })).toThrow(/POLICY_VAULT_ADDRESS/)
  })
})
