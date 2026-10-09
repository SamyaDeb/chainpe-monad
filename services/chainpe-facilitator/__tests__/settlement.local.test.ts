/**
 * REAL settlement test on a local EVM chain (no mocks of the chain or signer):
 *
 *   Hardhat node → MockUSDC (EIP-3009, same EIP-712 domain as Monad USDC)
 *   → facilitator HTTP app with the production signer/policy code
 *   → x402 v2 client signs a payment → /verify → /settle → USDC actually moves.
 *
 * Needs the contracts compiled (`cd contracts && npx hardhat compile`) and a free
 * port 8546. Skipped automatically when the artifact is missing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Server } from 'node:http'
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseUnits,
  erc20Abi
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { x402Client, x402HTTPClient } from '@x402/core/client'
import { x402Facilitator } from '@x402/core/facilitator'
import { ExactEvmScheme as ClientScheme } from '@x402/evm/exact/client'
import { ExactEvmScheme as FacilitatorScheme } from '@x402/evm/exact/facilitator'
import type { PaymentRequired, PaymentRequirements } from '@x402/core/types'
import { createApp } from '../src/app.js'
import { createSettlementSigner } from '../src/signer.js'
import { loadConfig } from '../src/config.js'
import { PayToAllowlist } from '../src/policy.js'
import pino from 'pino'

const ARTIFACT = resolve(__dirname, '../../../contracts/artifacts/contracts/mocks/MockUSDC.sol/MockUSDC.json')
const CONTRACTS_DIR = resolve(__dirname, '../../../contracts')
const PORT = 8546
const RPC = `http://127.0.0.1:${PORT}`
const CHAIN_ID = 31337

// Hardhat's well-known dev accounts — not secrets.
const KEYS = {
  deployer: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  facilitator: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  payer: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdd5c9a3'
} as const
const SELLER = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'

const chain = defineChain({
  id: CHAIN_ID,
  name: 'local',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } }
})

const haveArtifact = existsSync(ARTIFACT)
let node: ChildProcess | undefined
let server: Server | undefined
let base = ''
let usdc: `0x${string}`

async function waitForRpc() {
  const pub = createPublicClient({ chain, transport: http(RPC) })
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

describe.skipIf(!haveArtifact)('real on-chain settlement (local chain)', () => {
  beforeAll(async () => {
    node = spawn('npx', ['hardhat', 'node', '--port', String(PORT)], { cwd: CONTRACTS_DIR, stdio: 'ignore' })
    await waitForRpc()

    // Deploy MockUSDC and fund the payer.
    const artifact = JSON.parse(readFileSync(ARTIFACT, 'utf-8'))
    const deployer = privateKeyToAccount(KEYS.deployer)
    const wallet = createWalletClient({ account: deployer, chain, transport: http(RPC) })
    const pub = createPublicClient({ chain, transport: http(RPC) })
    const deployTx = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args: [] })
    usdc = (await pub.waitForTransactionReceipt({ hash: deployTx })).contractAddress!
    const mintTx = await wallet.writeContract({
      address: usdc,
      abi: artifact.abi,
      functionName: 'mint',
      args: [privateKeyToAccount(KEYS.payer).address, parseUnits('10', 6)]
    })
    await pub.waitForTransactionReceipt({ hash: mintTx })

    // The facilitator, built from the production modules.
    const cfg = loadConfig({
      FACILITATOR_PRIVATE_KEY: KEYS.facilitator,
      NETWORK: 'local',
      CHAIN_ID: String(CHAIN_ID),
      RPC_URL: RPC,
      USDC_ADDRESS: usdc,
      REQUIRE_REGISTERED_PAYTO: 'true',
      PAYTO_ALLOWLIST: SELLER
    })
    const { address, signer } = createSettlementSigner(cfg)
    const facilitator = new x402Facilitator().register(cfg.caip2, new FacilitatorScheme(signer))
    const allowlist = new PayToAllowlist(cfg.payToAllowlist, cfg.requireRegisteredPayTo)
    const app = createApp({
      network: cfg.network,
      caip2: cfg.caip2,
      usdc: cfg.usdc,
      minAmountAtomic: cfg.minAmountAtomic,
      facilitatorAddress: address,
      facilitator,
      isPayToAllowed: a => allowlist.isAllowed(a),
      gasBalance: () => null,
      lowGasThresholdWei: cfg.lowGasThresholdWei,
      allowedOrigins: [],
      trustProxy: 1,
      rateLimitPerMinute: 1000,
      log: pino({ level: 'silent' })
    })
    await new Promise<void>(resolveListen => {
      server = app.listen(0, () => {
        const a = server!.address()
        base = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`
        resolveListen()
      })
    })
  }, 60_000)

  afterAll(() => {
    server?.close()
    node?.kill('SIGKILL')
  })

  const requirements = (): PaymentRequirements => ({
    scheme: 'exact',
    network: `eip155:${CHAIN_ID}`,
    asset: usdc,
    amount: '10000', // 0.01 USDC
    payTo: SELLER,
    maxTimeoutSeconds: 60,
    extra: { name: 'USDC', version: '2' }
  })

  async function sign(req: PaymentRequirements) {
    const client = new x402Client().register(req.network, new ClientScheme(privateKeyToAccount(KEYS.payer))).setSpendControls(false)
    const required: PaymentRequired = { x402Version: 2, resource: { url: 'http://seller/data' }, accepts: [req] }
    return new x402HTTPClient(client).createPaymentPayload(required)
  }

  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

  const balance = (who: `0x${string}`) =>
    createPublicClient({ chain, transport: http(RPC) }).readContract({ address: usdc, abi: erc20Abi, functionName: 'balanceOf', args: [who] })

  it('verifies a freshly signed payment', async () => {
    const req = requirements()
    const res = await post('/verify', { x402Version: 2, paymentPayload: await sign(req), paymentRequirements: req })
    expect(await res.json()).toMatchObject({ isValid: true })
  })

  it('settles on-chain: USDC moves payer → seller and the facilitator pays the gas', async () => {
    const req = requirements()
    const payload = await sign(req)
    const payer = privateKeyToAccount(KEYS.payer).address
    const before = { payer: await balance(payer), seller: await balance(SELLER) }

    const res = await post('/settle', { x402Version: 2, paymentPayload: payload, paymentRequirements: req })
    const body = await res.json()
    expect(body).toMatchObject({ success: true, payer })
    expect(body.transaction).toMatch(/^0x[0-9a-f]{64}$/)

    expect(await balance(SELLER)).toBe(before.seller + 10000n)
    expect(await balance(payer)).toBe(before.payer - 10000n)
  })

  it('refuses to settle the same authorization twice', async () => {
    const req = requirements()
    const payload = await sign(req)
    const first = await (await post('/settle', { x402Version: 2, paymentPayload: payload, paymentRequirements: req })).json()
    expect(first.success).toBe(true)
    const second = await (await post('/settle', { x402Version: 2, paymentPayload: payload, paymentRequirements: req })).json()
    expect(second.success).toBe(false)
  })

  it('handles concurrent settlements without nonce collisions', async () => {
    const req = requirements()
    const payloads = await Promise.all([sign(req), sign(req), sign(req)])
    const results = await Promise.all(
      payloads.map(async p => (await post('/settle', { x402Version: 2, paymentPayload: p, paymentRequirements: req })).json())
    )
    expect(results.map(r => r.success)).toEqual([true, true, true])
    expect(new Set(results.map(r => r.transaction)).size).toBe(3)
  })

  it('does not pay gas for an unregistered payTo', async () => {
    const other = { ...requirements(), payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' }
    const res = await post('/settle', { x402Version: 2, paymentPayload: await sign(other), paymentRequirements: other })
    expect(await res.json()).toMatchObject({ success: false, errorReason: 'payto_not_registered' })
  })
})
