import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import express from 'express'
import { paymentMiddleware } from '@x402/express'
import { x402ResourceServer } from '@x402/core/server'
import { ExactEvmScheme as ExactServerScheme } from '@x402/evm/exact/server'
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types'
import { verifyTypedData } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { checkOffer, paidFetch } from '../src/payment.js'
import { ChainPe } from '../src/chainpe.js'
import { ChainPePaymentError } from '../src/types.js'
import { NETWORKS } from '../src/networks.js'
import {
  SPEND_TYPES,
  VAULT_SCHEME,
  VaultEvmClientScheme,
  VaultEvmServerScheme,
  resetVaultNonces,
  vaultDomain,
  withVaultLock,
  type VaultSpendPayload
} from '../src/vaultScheme.js'

// Public Hardhat test key — not a secret.
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const account = privateKeyToAccount(KEY)
const SESSION_KEY = generatePrivateKey()
const session = privateKeyToAccount(SESSION_KEY)
const OWNER = '0x2222222222222222222222222222222222222222'
const SELLER = '0x1111111111111111111111111111111111111111'
const net = NETWORKS['monad-testnet']
const VAULT = net.policyVault!

const vaultOffer = (over: Partial<PaymentRequirements> = {}): PaymentRequirements => ({
  scheme: VAULT_SCHEME,
  network: net.caip2,
  asset: net.usdc.address,
  amount: '10000',
  payTo: SELLER,
  maxTimeoutSeconds: 60,
  extra: { vault: VAULT, name: 'ChainPePolicyVault', version: '1' },
  ...over
})

describe('checkOffer in mandate mode', () => {
  it('accepts a chainpe-vault offer for our vault, in USDC, within the cap', () => {
    expect(checkOffer(vaultOffer(), 'monad-testnet', 1_000_000n, VAULT)).toEqual({ ok: true })
  })

  it.each([
    [{ scheme: 'exact' }, /scheme/],
    [{ extra: { vault: SELLER } }, /vault/],
    [{ extra: {} }, /vault/],
    [{ asset: SELLER }, /USDC/],
    [{ network: 'eip155:143' }, /network/],
    [{ amount: '2000000' }, /exceeds maxPerCall/]
  ])('refuses %j', (over, reason) => {
    const r = checkOffer(vaultOffer(over as Partial<PaymentRequirements>), 'monad-testnet', 1_000_000n, VAULT)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toMatch(reason)
  })

  it('never pays a vault offer without mandate mode', () => {
    expect(checkOffer(vaultOffer(), 'monad-testnet', 1_000_000n).ok).toBe(false)
  })
})

describe('VaultEvmClientScheme', () => {
  it('signs the PolicyVault Spend with the session key', async () => {
    const scheme = new VaultEvmClientScheme({
      sessionKey: session,
      owner: OWNER,
      vault: VAULT,
      chainId: net.chainId,
      nonce: () => 7n,
      now: () => 1_000_000
    })
    const { payload } = await scheme.createPaymentPayload(2, vaultOffer())
    const p = payload as unknown as VaultSpendPayload
    expect(p).toMatchObject({ owner: OWNER, to: SELLER, amount: '10000', nonce: '7', deadline: String(1000 + 60) })
    const valid = await verifyTypedData({
      address: session.address,
      domain: vaultDomain(net.chainId, VAULT),
      types: SPEND_TYPES,
      primaryType: 'Spend',
      message: { owner: OWNER, to: SELLER, amount: 10000n, nonce: 7n, deadline: 1060n },
      signature: p.signature
    })
    expect(valid).toBe(true)
  })

  it('caps the authorization lifetime at 5 minutes', async () => {
    const scheme = new VaultEvmClientScheme({ sessionKey: session, owner: OWNER, vault: VAULT, chainId: net.chainId, nonce: () => 0n, now: () => 0 })
    const { payload } = await scheme.createPaymentPayload(2, vaultOffer({ maxTimeoutSeconds: 86_400 }))
    expect((payload as unknown as VaultSpendPayload).deadline).toBe('300')
  })

  it('refuses to sign for a different vault', async () => {
    const scheme = new VaultEvmClientScheme({ sessionKey: session, owner: OWNER, vault: VAULT, chainId: net.chainId, nonce: () => 0n })
    await expect(scheme.createPaymentPayload(2, vaultOffer({ extra: { vault: SELLER } }))).rejects.toThrow(/vault/)
  })
})

describe('withVaultLock', () => {
  beforeEach(() => resetVaultNonces())
  const params = (readNonce: () => Promise<bigint>) => ({ chainId: 1, vault: VAULT, owner: OWNER, readNonce })

  it('runs spends for one owner strictly one at a time, each on a fresh nonce', async () => {
    let onchain = 0n
    let inFlight = 0
    let maxInFlight = 0
    const used: bigint[] = []
    const spend = () =>
      withVaultLock(params(async () => onchain), async (nonce, settled) => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        used.push(nonce)
        await new Promise(r => setTimeout(r, 5))
        onchain = nonce + 1n
        settled()
        inFlight--
      })
    await Promise.all([spend(), spend(), spend()])
    expect(maxInFlight).toBe(1)
    expect(used).toEqual([0n, 1n, 2n])
  })

  it('moves past a settled nonce even if the RPC node still reports the old one', async () => {
    const used: bigint[] = []
    const stale = async () => 4n
    await withVaultLock(params(stale), async (n, settled) => (used.push(n), settled()))
    await withVaultLock(params(stale), async n => void used.push(n))
    expect(used).toEqual([4n, 5n])
  })

  it('reuses a nonce whose spend did not settle, and keeps going after a failure', async () => {
    const used: bigint[] = []
    await expect(
      withVaultLock(params(async () => 9n), async n => {
        used.push(n)
        throw new Error('refused')
      })
    ).rejects.toThrow('refused')
    await withVaultLock(params(async () => 9n), async n => void used.push(n))
    expect(used).toEqual([9n, 9n])
  })
})

// A real x402 v2 resource server offering BOTH exact and chainpe-vault, with a
// stub facilitator that checks the vault signature like the real one.
const verified: PaymentPayload[] = []
let vaultRefusal: string | undefined
let vaultNonce = 0n
const TX = '0x' + 'ab'.repeat(32)
const facilitatorClient = {
  getSupported: async () => ({
    kinds: [
      { x402Version: 2, scheme: 'exact', network: net.caip2 },
      { x402Version: 2, scheme: VAULT_SCHEME, network: net.caip2, extra: { vault: VAULT, name: 'ChainPePolicyVault', version: '1' } }
    ],
    extensions: [],
    signers: {}
  }),
  verify: async (p: PaymentPayload, r: PaymentRequirements) => {
    verified.push(p)
    if (r.scheme !== VAULT_SCHEME) return { isValid: true, payer: account.address }
    const s = p.payload as unknown as VaultSpendPayload
    if (vaultRefusal) return { isValid: false, invalidReason: vaultRefusal, payer: s.owner }
    const ok =
      BigInt(s.nonce) === vaultNonce &&
      (await verifyTypedData({
        address: session.address,
        domain: vaultDomain(net.chainId, String(r.extra.vault)),
        types: SPEND_TYPES,
        primaryType: 'Spend',
        message: { owner: s.owner as `0x${string}`, to: s.to as `0x${string}`, amount: BigInt(s.amount), nonce: BigInt(s.nonce), deadline: BigInt(s.deadline) },
        signature: s.signature
      }))
    return ok ? { isValid: true, payer: s.owner } : { isValid: false, invalidReason: 'vault_invalid_session_signature' }
  },
  settle: async (p: PaymentPayload, r: PaymentRequirements) => {
    if (r.scheme === VAULT_SCHEME) vaultNonce++
    return { success: true, transaction: TX, network: net.caip2, payer: r.scheme === VAULT_SCHEME ? OWNER : account.address }
  }
}

let server: Server
let base: string
beforeAll(async () => {
  const app = express()
  const resources = new x402ResourceServer(facilitatorClient as never)
    .register(net.caip2, new ExactServerScheme())
    .register(net.caip2, new VaultEvmServerScheme())
  const price = { asset: net.usdc.address, amount: '10000' }
  app.use(
    paymentMiddleware(
      {
        'GET /both': {
          accepts: [
            { scheme: 'exact', network: net.caip2, payTo: SELLER, price: { ...price, extra: { name: 'USDC', version: '2' } } },
            { scheme: VAULT_SCHEME, network: net.caip2, payTo: SELLER, price }
          ],
          description: 'both'
        },
        'GET /exact-only': {
          accepts: { scheme: 'exact', network: net.caip2, payTo: SELLER, price: { ...price, extra: { name: 'USDC', version: '2' } } },
          description: 'exact'
        }
      } as never,
      resources
    )
  )
  app.get('/both', (_req, res) => res.json({ ok: 'both' }))
  app.get('/exact-only', (_req, res) => res.json({ ok: 'exact' }))
  await new Promise<void>(resolve => {
    server = app.listen(0, () => {
      const a = server.address()
      base = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`
      resolve()
    })
  })
})
afterAll(() => server?.close())

describe('paying through the vault against a real x402 v2 server', () => {
  beforeEach(() => {
    resetVaultNonces()
    verified.length = 0
    vaultRefusal = undefined
  })
  const vault = { vaultAddress: VAULT, owner: OWNER, sessionKey: session, readNonce: async () => vaultNonce }
  const opts = (path: string) => ({ url: `${base}${path}`, network: 'monad-testnet' as const, account, maxPerCallAtomic: 1_000_000n, vault })

  it('the 402 carries the vault (from the facilitator) in the chainpe-vault offer', async () => {
    const res = await fetch(`${base}/both`)
    const required = JSON.parse(Buffer.from(res.headers.get('payment-required')!, 'base64').toString())
    const offer = required.accepts.find((a: PaymentRequirements) => a.scheme === VAULT_SCHEME)
    expect(offer.extra).toMatchObject({ vault: VAULT, name: 'ChainPePolicyVault', version: '1' })
  })

  it('prefers the vault offer in mandate mode', async () => {
    const r = await paidFetch(opts('/both'))
    expect(r.response.status).toBe(200)
    expect(r.accepted?.scheme).toBe(VAULT_SCHEME)
    expect(r.payment).toMatchObject({ scheme: VAULT_SCHEME, owner: OWNER, txHash: TX, amount: '0.01', recipient: SELLER })
    expect(verified[0].accepted.scheme).toBe(VAULT_SCHEME)
  })

  it('serializes concurrent vault payments so each signs the next nonce', async () => {
    const start = vaultNonce
    const results = await Promise.all([paidFetch(opts('/both')), paidFetch(opts('/both')), paidFetch(opts('/both'))])
    expect(results.map(r => r.response.status)).toEqual([200, 200, 200])
    const nonces = verified.map(p => (p.payload as unknown as VaultSpendPayload).nonce)
    expect(nonces).toEqual([start, start + 1n, start + 2n].map(String))
  })

  it("surfaces the facilitator's vault refusal (e.g. the contract's cap reason)", async () => {
    vaultRefusal = 'vault_over_per_call_cap'
    const err = await paidFetch(opts('/both')).catch(e => e)
    expect(err).toBeInstanceOf(ChainPePaymentError)
    expect(err.reason).toBe('settlement_rejected')
    expect(err.detail).toBe('vault_over_per_call_cap')
  })

  it('does not fall back to exact (own wallet) unless asked', async () => {
    await expect(paidFetch(opts('/exact-only'))).rejects.toThrow(/no acceptable payment offer/)
    const r = await paidFetch({ ...opts('/exact-only'), vault: { ...vault, fallbackToExact: true } })
    expect(r.payment?.scheme).toBe('exact')
  })

  it('without mandate mode the SDK pays exact exactly as before', async () => {
    const r = await paidFetch({ url: `${base}/both`, network: 'monad-testnet', account, maxPerCallAtomic: 1_000_000n })
    expect(r.payment?.scheme).toBe('exact')
    expect(verified[0].accepted.scheme).toBe('exact')
  })

  it('ChainPe({ policyVault }) pays via the vault with the session key', async () => {
    const make = (sessionKey: string) =>
      new ChainPe({
        privateKey: KEY,
        network: 'monad-testnet',
        registryAddress: '0x000000000000000000000000000000000000dEaD',
        policyVault: { owner: OWNER, sessionKey, readNonce: async () => vaultNonce }
      })
    const cp = make(SESSION_KEY)
    expect(cp.config.policyVault).toMatchObject({ vaultAddress: VAULT, owner: OWNER, sessionKey: session.address, fallbackToExact: false })
    const r = await cp.pay<{ ok: string }>(`${base}/both`)
    expect(r.data).toEqual({ ok: 'both' })
    expect(r.payment).toMatchObject({ scheme: VAULT_SCHEME, owner: OWNER, txHash: TX })
    // A key that is not the policy's session key is refused by the facilitator.
    await expect(make(generatePrivateKey()).pay(`${base}/both`)).rejects.toThrow(/vault_invalid_session_signature/)
  })

  it('ChainPe refuses mandate mode without an owner', () => {
    expect(() => new ChainPe({ privateKey: KEY, policyVault: { owner: '' } })).toThrow(/owner/)
  })
})
