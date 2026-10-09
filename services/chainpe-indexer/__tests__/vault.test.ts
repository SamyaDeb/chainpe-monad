/**
 * Mandate mode receipts: a `PolicyVault.Spent` (x402 `chainpe-vault`) backs a
 * rating by the vault owner or by the session key that signed the spend.
 */
import { describe, expect, it } from 'vitest'
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  getAddress,
  type PublicClient
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { verifyFeedbackPayment, type VerifyInput } from '../src/core.js'
import { readSettlement } from '../src/verify.js'
import { VAULT_SPEND_FN, VAULT_SPEND_TYPES, VAULT_SPENT_EVENT } from '../src/abi.js'

const USDC = '0x534b2f3A21130d7a60830c2Df862319e593943A3'
const VAULT = '0x1Eb25cDD00bCCEC89782Aaf12600Ac5eFeEeAB65' as const
const OTHER_VAULT = '0x00000000000000000000000000000000000000bb'
const DEV = '0xd000000000000000000000000000000000000001'
const PAYTO = '0xa000000000000000000000000000000000000002'
const AGENT_OWNER = '0x0000000000000000000000000000000000000003'
const VAULT_OWNER = '0xb000000000000000000000000000000000000005'
const SESSION = '0xb000000000000000000000000000000000000006'
const STRANGER = '0xc000000000000000000000000000000000000007'
const TX = ('0x' + 'ab'.repeat(32)) as `0x${string}`

describe('verifyFeedbackPayment with PolicyVault spends', () => {
  const spend = (over: Record<string, unknown> = {}) => ({
    vault: VAULT,
    owner: VAULT_OWNER,
    to: PAYTO,
    amount: 10_000n,
    sessionKey: SESSION,
    ...over
  })
  const base = (client: string, over: Partial<VerifyInput> = {}): VerifyInput => ({
    feedback: { agentId: '5', client, feedbackHash: TX },
    // The USDC moves vault → payTo; that Transfer alone never matches the rater.
    receipt: { status: 'success', transfers: [{ token: USDC, from: VAULT, to: PAYTO, value: 10_000n }], vaultSpends: [spend()] },
    usdc: USDC,
    vault: VAULT,
    services: [{ payTo: PAYTO, developer: DEV }],
    agentOwner: AGENT_OWNER,
    agentWallet: null,
    minAmountAtomic: 1_000n,
    receiptAlreadyUsed: false,
    ...over
  })

  it('a rating by the vault owner is paid (payer = owner)', () => {
    expect(verifyFeedbackPayment(base(VAULT_OWNER))).toEqual({ paid: true, amount: 10_000n, payer: VAULT_OWNER })
  })

  it('a rating by the session key that signed the spend is paid (payer = owner)', () => {
    expect(verifyFeedbackPayment(base(SESSION.toLowerCase()))).toEqual({ paid: true, amount: 10_000n, payer: VAULT_OWNER })
  })

  it('anyone else citing the vault receipt is not paid', () => {
    expect(verifyFeedbackPayment(base(STRANGER))).toEqual({ paid: false, reason: 'no_matching_transfer' })
  })

  it('a session key that is unknown (calldata not decodable) only lets the owner rate', () => {
    const r = { status: 'success' as const, transfers: [], vaultSpends: [spend({ sessionKey: null })] }
    expect(verifyFeedbackPayment(base(SESSION, { receipt: r })).paid).toBe(false)
    expect(verifyFeedbackPayment(base(VAULT_OWNER, { receipt: r })).paid).toBe(true)
  })

  it.each([
    ['another vault', { vault: OTHER_VAULT }, 'no_matching_transfer'],
    ['another payTo', { to: STRANGER }, 'no_matching_transfer'],
    ['below the minimum', { amount: 999n }, 'below_minimum']
  ])('refuses a spend to %s', (_label, over, reason) => {
    const r = { status: 'success' as const, transfers: [], vaultSpends: [spend(over)] }
    expect(verifyFeedbackPayment(base(VAULT_OWNER, { receipt: r }))).toEqual({ paid: false, reason })
  })

  it('ignores vault spends when no vault is configured', () => {
    expect(verifyFeedbackPayment(base(VAULT_OWNER, { vault: null })).paid).toBe(false)
  })

  it('a vault owned by an insider is self-dealing even when the session key rates', () => {
    const r = { status: 'success' as const, transfers: [], vaultSpends: [spend({ owner: AGENT_OWNER })] }
    expect(verifyFeedbackPayment(base(SESSION, { receipt: r }))).toEqual({ paid: false, reason: 'self_dealing' })
  })

  it('a reverted vault tx is not a receipt', () => {
    const r = { status: 'reverted' as const, transfers: [], vaultSpends: [spend()] }
    expect(verifyFeedbackPayment(base(VAULT_OWNER, { receipt: r }))).toEqual({ paid: false, reason: 'tx_reverted' })
  })
})

describe('readSettlement recovers the session key of a vault spend', () => {
  it('from the spend() calldata and the Spent nonce', async () => {
    const session = privateKeyToAccount(generatePrivateKey())
    const msg = { owner: VAULT_OWNER, to: PAYTO, amount: 20_000n, nonce: 4n, deadline: 1_900_000_000n } as const
    const sig = await session.signTypedData({
      domain: { name: 'ChainPePolicyVault', version: '1', chainId: 10143, verifyingContract: VAULT },
      types: VAULT_SPEND_TYPES,
      primaryType: 'Spend',
      message: msg
    })
    const spentLog = {
      address: VAULT,
      topics: encodeEventTopics({
        abi: VAULT_SPENT_EVENT,
        eventName: 'Spent',
        args: { owner: msg.owner, to: msg.to, relayer: '0x0000000000000000000000000000000000000009' }
      }),
      data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [msg.amount, msg.nonce]),
      blockNumber: 1n,
      blockHash: TX,
      transactionHash: TX,
      transactionIndex: 0,
      logIndex: 0,
      removed: false
    }
    const client = {
      getTransactionReceipt: async () => ({ status: 'success', logs: [spentLog] }),
      getTransaction: async () => ({
        to: VAULT,
        chainId: 10143,
        input: encodeFunctionData({ abi: VAULT_SPEND_FN, functionName: 'spend', args: [msg.owner, msg.to, msg.amount, msg.deadline, sig] })
      })
    } as unknown as PublicClient

    const r = await readSettlement(client, TX, VAULT)
    expect(r?.vaultSpends).toEqual([
      { vault: VAULT, owner: getAddress(VAULT_OWNER), to: getAddress(PAYTO), amount: 20_000n, sessionKey: session.address }
    ])
    // Without a configured vault the Spent event is ignored (and no extra RPC call is made).
    expect((await readSettlement(client, TX))?.vaultSpends).toEqual([])
  })
})
