/**
 * REAL `chainpe-vault` settlement on a local EVM chain (no chain/signer mocks):
 *
 *   Hardhat node → MockUSDC + PolicyVaultUpgradeable behind an ERC1967 proxy
 *   → facilitator HTTP app (production signer, policy and vault mechanism)
 *   → the SDK's x402 client mechanism signs a vault Spend with the session key
 *   → /verify → /settle → PolicyVault.spend moves USDC vault → seller.
 *
 * Covers the caps the contract enforces (per call, daily, total, allowlist,
 * revocation), nonce handling and concurrent settlements. Needs the contracts
 * compiled and a free port 8547; skipped when the artifacts are missing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Server } from 'node:http'
import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, getAddress, http, erc20Abi } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { x402Facilitator } from '@x402/core/facilitator'
import { ExactEvmScheme as FacilitatorScheme } from '@x402/evm/exact/facilitator'
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types'
import pino from 'pino'
import { createApp } from '../src/app.js'
import { createSettlementSigner } from '../src/signer.js'
import { loadConfig } from '../src/config.js'
import { PayToAllowlist } from '../src/policy.js'
import { VAULT_SCHEME, createVaultScheme } from '../src/vault.js'
// The client side lives in the SDK; using it here pins the wire format both ends agree on.
import { VaultEvmClientScheme } from '../../../packages/chainpe-sdk/src/vaultScheme.js'

const ART = resolve(__dirname, '../../../contracts/artifacts')
const USDC_ARTIFACT = `${ART}/contracts/mocks/MockUSDC.sol/MockUSDC.json`
const VAULT_ARTIFACT = `${ART}/contracts/PolicyVaultUpgradeable.sol/PolicyVaultUpgradeable.json`
const PROXY_ARTIFACT = `${ART}/@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol/ERC1967Proxy.json`
const CONTRACTS_DIR = resolve(__dirname, '../../../contracts')
const PORT = 8547
const RPC = `http://127.0.0.1:${PORT}`
const CHAIN_ID = 31337

// Hardhat's well-known dev accounts — not secrets.
const KEYS = {
  deployer: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  facilitator: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  owner: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdd5c9a3'
} as const
const SELLER = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
const OTHER_SELLER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' // payTo-allowed, NOT on the vault allowlist
const session = privateKeyToAccount(generatePrivateKey()) // holds nothing

const chain = defineChain({
  id: CHAIN_ID,
  name: 'local',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } }
})
const pub = createPublicClient({ chain, transport: http(RPC) })
const ownerAccount = privateKeyToAccount(KEYS.owner)
const ownerWallet = createWalletClient({ account: ownerAccount, chain, transport: http(RPC) })

const haveArtifacts = [USDC_ARTIFACT, VAULT_ARTIFACT, PROXY_ARTIFACT].every(existsSync)
let node: ChildProcess | undefined
let server: Server | undefined
let base = ''
let usdc: `0x${string}`
let vault: `0x${string}`
let vaultAbi: readonly unknown[]

async function waitForRpc() {
  for (let i = 0; i < 100; i++) {
    try {
      await pub.getBlockNumber()
      return
    } catch {
      await new Promise(r => setTimeout(r, 200))
    }
  }
  throw new Error('hardhat node did not start')
}

const ownerTx = async (address: `0x${string}`, abi: readonly unknown[], functionName: string, args: unknown[]) => {
  const hash = await ownerWallet.writeContract({ address, abi, functionName, args } as never)
  await pub.waitForTransactionReceipt({ hash })
}

describe.skipIf(!haveArtifacts)('chainpe-vault settlement (local chain)', () => {
  beforeAll(async () => {
    node = spawn('npx', ['hardhat', 'node', '--port', String(PORT)], { cwd: CONTRACTS_DIR, stdio: 'ignore', detached: true })
    await waitForRpc()

    const read = (p: string) => JSON.parse(readFileSync(p, 'utf-8'))
    const usdcArt = read(USDC_ARTIFACT)
    const vaultArt = read(VAULT_ARTIFACT)
    const proxyArt = read(PROXY_ARTIFACT)
    vaultAbi = vaultArt.abi
    const deployer = privateKeyToAccount(KEYS.deployer)
    const dw = createWalletClient({ account: deployer, chain, transport: http(RPC) })
    const deploy = async (art: { abi: unknown[]; bytecode: `0x${string}` }, args: unknown[]) =>
      (await pub.waitForTransactionReceipt({ hash: await dw.deployContract({ abi: art.abi, bytecode: art.bytecode, args } as never) }))
        .contractAddress!

    usdc = await deploy(usdcArt, [])
    const impl = await deploy(vaultArt, [])
    const init = encodeFunctionData({ abi: vaultArt.abi, functionName: 'initialize', args: [usdc, deployer.address] })
    vault = getAddress(await deploy(proxyArt, [impl, init]))

    // Owner: gas + USDC, deposit 1 USDC, set the policy (caps 0.02 / 0.05 / 0.10), allowlist SELLER.
    await pub.waitForTransactionReceipt({ hash: await dw.sendTransaction({ to: ownerAccount.address, value: 10n ** 18n }) })
    await pub.waitForTransactionReceipt({
      hash: await dw.writeContract({ address: usdc, abi: usdcArt.abi, functionName: 'mint', args: [ownerAccount.address, 2_000_000n] } as never)
    })
    await ownerTx(usdc, erc20Abi, 'approve', [vault, 1_000_000n])
    await ownerTx(vault, vaultAbi, 'deposit', [1_000_000n])
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 86_400)
    await ownerTx(vault, vaultAbi, 'setPolicy', [session.address, 20_000n, 50_000n, 100_000n, expiry, true])
    await ownerTx(vault, vaultAbi, 'setAllowlist', [SELLER, true])

    const cfg = loadConfig({
      FACILITATOR_PRIVATE_KEY: KEYS.facilitator,
      NETWORK: 'local',
      CHAIN_ID: String(CHAIN_ID),
      RPC_URL: RPC,
      USDC_ADDRESS: usdc,
      POLICY_VAULT_ADDRESS: vault,
      REQUIRE_REGISTERED_PAYTO: 'true',
      PAYTO_ALLOWLIST: `${SELLER},${OTHER_SELLER}`
    })
    const settlement = createSettlementSigner(cfg)
    const facilitator = new x402Facilitator()
      .register(cfg.caip2, new FacilitatorScheme(settlement.signer))
      .register(cfg.caip2, createVaultScheme(cfg, settlement))
    const allowlist = new PayToAllowlist(cfg.payToAllowlist, cfg.requireRegisteredPayTo)
    const app = createApp({
      network: cfg.network,
      caip2: cfg.caip2,
      usdc: cfg.usdc,
      minAmountAtomic: cfg.minAmountAtomic,
      facilitatorAddress: settlement.address,
      facilitator,
      isPayToAllowed: a => allowlist.isAllowed(a),
      schemes: ['exact', VAULT_SCHEME],
      gasBalance: () => null,
      lowGasThresholdWei: cfg.lowGasThresholdWei,
      allowedOrigins: [],
      trustProxy: 1,
      rateLimitPerMinute: 1000,
      log: pino({ level: 'silent' })
    })
    await new Promise<void>(r => {
      server = app.listen(0, () => {
        const a = server!.address()
        base = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`
        r()
      })
    })
  }, 90_000)

  afterAll(() => {
    server?.close()
    if (node?.pid) process.kill(-node.pid, 'SIGKILL')
  })

  const requirements = (amount = '10000', payTo = SELLER): PaymentRequirements => ({
    scheme: VAULT_SCHEME,
    network: `eip155:${CHAIN_ID}`,
    asset: usdc,
    amount,
    payTo,
    maxTimeoutSeconds: 60,
    extra: { vault, name: 'ChainPePolicyVault', version: '1' }
  })

  const view = <T>(functionName: string, args: unknown[]) =>
    pub.readContract({ address: vault, abi: vaultAbi, functionName, args } as never) as Promise<T>
  const onchainNonce = () => view<bigint>('nonces', [ownerAccount.address])

  async function sign(req: PaymentRequirements, nonce?: bigint, signer = session): Promise<PaymentPayload> {
    const n = nonce ?? (await onchainNonce())
    const scheme = new VaultEvmClientScheme({ sessionKey: signer, owner: ownerAccount.address, vault, chainId: CHAIN_ID, nonce: () => n })
    const { payload } = await scheme.createPaymentPayload(2, req)
    return { x402Version: 2, resource: { url: 'http://seller/data' }, accepted: req, payload }
  }

  const post = async (path: string, payload: PaymentPayload, req: PaymentRequirements) =>
    (
      await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: req })
      })
    ).json()

  const usdcOf = (who: `0x${string}`) => pub.readContract({ address: usdc, abi: erc20Abi, functionName: 'balanceOf', args: [who] })

  it('advertises chainpe-vault with the vault address in /supported', async () => {
    const body = await (await fetch(`${base}/supported`)).json()
    const kind = body.kinds.find((k: { scheme: string }) => k.scheme === VAULT_SCHEME)
    expect(kind).toMatchObject({ network: `eip155:${CHAIN_ID}`, extra: { vault } })
  })

  it('verifies a session-key-signed spend (payer = vault owner)', async () => {
    const req = requirements()
    expect(await post('/verify', await sign(req), req)).toMatchObject({ isValid: true, payer: ownerAccount.address })
  })

  it('settles: PolicyVault.spend pays the seller from the vault, the facilitator pays gas', async () => {
    const req = requirements()
    const before = { seller: await usdcOf(SELLER), vault: await view<bigint>('balanceOf', [ownerAccount.address]) }
    const body = await post('/settle', await sign(req), req)
    expect(body).toMatchObject({ success: true, payer: ownerAccount.address })
    const receipt = await pub.getTransactionReceipt({ hash: body.transaction })
    expect(receipt.status).toBe('success')
    expect(receipt.to?.toLowerCase()).toBe(vault.toLowerCase())
    expect(await usdcOf(SELLER)).toBe(before.seller + 10_000n)
    expect(await view<bigint>('balanceOf', [ownerAccount.address])).toBe(before.vault - 10_000n)
    expect(await usdcOf(ownerAccount.address)).toBe(1_000_000n) // the owner's own wallet is untouched
  })

  it('refuses a replay of a settled spend (nonce consumed)', async () => {
    const req = requirements()
    const payload = await sign(req)
    expect((await post('/settle', payload, req)).success).toBe(true)
    expect(await post('/settle', payload, req)).toMatchObject({ success: false, errorReason: 'vault_nonce_mismatch' })
  })

  it('refuses over the per-call cap with the contract reason, before any gas is spent', async () => {
    const req = requirements('30000')
    const nonceBefore = await onchainNonce()
    expect(await post('/verify', await sign(req), req)).toMatchObject({
      isValid: false,
      invalidReason: 'vault_over_per_call_cap',
      invalidMessage: 'over per-call cap'
    })
    expect(await post('/settle', await sign(req), req)).toMatchObject({ success: false, errorReason: 'vault_over_per_call_cap' })
    expect(await onchainNonce()).toBe(nonceBefore)
  })

  it('refuses a recipient that is not on the owner allowlist', async () => {
    const req = requirements('10000', OTHER_SELLER)
    expect(await post('/settle', await sign(req), req)).toMatchObject({
      success: false,
      errorReason: 'vault_recipient_not_allowlisted'
    })
  })

  it('refuses a spend not signed by the policy session key', async () => {
    const req = requirements()
    const stranger = privateKeyToAccount(generatePrivateKey())
    expect(await post('/verify', await sign(req, undefined, stranger), req)).toMatchObject({
      isValid: false,
      invalidReason: 'vault_invalid_session_signature'
    })
  })

  it('refuses a payload that does not match the offer (amount swapped)', async () => {
    const req = requirements()
    const signedCheap = await sign(requirements('5000'))
    expect(await post('/verify', { ...signedCheap, accepted: req }, req)).toMatchObject({
      isValid: false,
      invalidReason: 'vault_amount_mismatch'
    })
  })

  it('refuses a stale nonce (a spend signed before another one settled)', async () => {
    const req = requirements('1000')
    const stale = await sign(req, (await onchainNonce()) - 1n)
    expect(await post('/verify', stale, req)).toMatchObject({ isValid: false, invalidReason: 'vault_nonce_mismatch' })
  })

  it('settles back-to-back spends with consecutive nonces (n, n+1)', async () => {
    // Vault nonces are sequential per owner; the SDK signs n+1 only after n settled.
    const req = requirements('5000')
    const n = await onchainNonce()
    const first = await post('/settle', await sign(req, n), req)
    const second = await post('/settle', await sign(req, n + 1n), req)
    expect([first.success, second.success]).toEqual([true, true])
    expect(first.transaction).not.toBe(second.transaction)
  })

  it('enforces the daily cap (0.05) across calls', async () => {
    // Spent so far today: 0.01 + 0.01 + 0.005 + 0.005 = 0.03 → 0.02 left.
    const ok = requirements('20000')
    expect((await post('/settle', await sign(ok), ok)).success).toBe(true)
    const over = requirements('1000')
    expect(await post('/settle', await sign(over), over)).toMatchObject({ success: false, errorReason: 'vault_over_daily_cap' })
  })

  it('stops paying once the owner revokes the session', async () => {
    await ownerTx(vault, vaultAbi, 'revokeSession', [])
    const req = requirements('1000')
    expect(await post('/settle', await sign(req), req)).toMatchObject({ success: false, errorReason: 'vault_session_inactive' })
  })
})
