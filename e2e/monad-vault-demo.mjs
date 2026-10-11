#!/usr/bin/env node
/**
 * Phase 5 live demo on Monad TESTNET — mandate mode: x402 payments paid BY the
 * PolicyVault (`chainpe-vault` scheme), so the owner's caps and recipient
 * allowlist are enforced by the contract on every call.
 *
 *   owner (DEPLOYER_PRIVATE_KEY) deposits 1 USDC and sets a policy for a fresh
 *   session key: maxPerCall 0.02, dailyCap 0.05, totalBudget 0.10, expiry +1 day,
 *   allowlistOnly, allowlist = the demo seller.
 *   The agent (holding only the session key — no USDC, no MON) then pays through
 *   ChainPe proxies that offer `exact` + `chainpe-vault`:
 *     1. in-cap call (0.01)                  → 200 + settlement tx (PolicyVault.spend)
 *     2. over the per-call cap (0.03)        → refused with the contract's reason,
 *                                              and the same spend reverts on-chain
 *     3. a seller not on the allowlist       → refused + on-chain revert
 *     4. fill the daily cap (0.02 + 0.02)    → 200s, then 0.01 more → refused
 *     5. owner revokeSession                 → the next call is refused
 *     6. owner withdraws the rest
 *
 * Runs our facilitator (services/chainpe-facilitator, `exact` + `chainpe-vault`)
 * as a child process. Keys: DEPLOYER_PRIVATE_KEY (env) = vault owner;
 * e2e/.env.demo (git-ignored): RATER_PRIVATE_KEY = facilitator gas key (pays gas
 * only), VAULT_SESSION_KEY + OTHER_SELLER_ADDRESS (created on first run).
 * Keys are never printed. Build first: npm run build.
 *
 * Demo traffic between team-controlled test wallets — not traction.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { createWalletClient, decodeErrorResult, erc20Abi, formatUnits, http, parseEventLogs, parseUnits } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
  ChainPe,
  ChainPePaymentError,
  PolicyVaultClient,
  chainFor,
  explorerTxUrl,
  getNetwork,
  publicClientFor,
  rpcUrlFor
} from '@chainpemonad/sdk'
import { startProxyServer } from '@chainpemonad/cli'

const network = 'monad-testnet' // this demo never touches mainnet
const net = getNetwork(network)
const VAULT = net.policyVault
const SELLER = '0x5e45B6025Dc9621ed3eef4BFEAD2041D7E475227'
const here = path.dirname(fileURLToPath(import.meta.url))
const envFile = path.join(here, '.env.demo')
const FACILITATOR_PORT = Number(process.env.FACILITATOR_PORT ?? 4510)

// ─── keys (never printed) ────────────────────────────────────────────────────
function loadEnv() {
  if (!fs.existsSync(envFile)) throw new Error(`${envFile} missing — it holds the demo wallet keys`)
  const env = {}
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim()
  }
  return env
}
function saveVar(name, value) {
  const lines = fs.readFileSync(envFile, 'utf8').split('\n').filter(l => !l.startsWith(`${name}=`) && l !== '')
  fs.writeFileSync(envFile, [...lines, `${name}=${value}`, ''].join('\n'), { mode: 0o600 })
}
const hex = k => (k.startsWith('0x') ? k : `0x${k}`)
const demo = loadEnv()
if (!demo.VAULT_SESSION_KEY) saveVar('VAULT_SESSION_KEY', (demo.VAULT_SESSION_KEY = generatePrivateKey()))
if (!demo.OTHER_SELLER_ADDRESS) {
  saveVar('OTHER_SELLER_ADDRESS', (demo.OTHER_SELLER_ADDRESS = privateKeyToAccount(generatePrivateKey()).address))
}
const ownerKey = process.env.DEPLOYER_PRIVATE_KEY || (console.error('Missing DEPLOYER_PRIVATE_KEY'), process.exit(1))
const relayerKey = demo.RATER_PRIVATE_KEY || (console.error('Missing RATER_PRIVATE_KEY in e2e/.env.demo'), process.exit(1))
const owner = privateKeyToAccount(hex(ownerKey))
const session = privateKeyToAccount(hex(demo.VAULT_SESSION_KEY))
const relayer = privateKeyToAccount(hex(relayerKey))
const OTHER_SELLER = demo.OTHER_SELLER_ADDRESS

const pub = publicClientFor(network)
const ownerWallet = createWalletClient({ account: owner, chain: chainFor(network), transport: http(rpcUrlFor(network)) })
const ownerVault = new PolicyVaultClient({ privateKey: hex(ownerKey), network, vaultAddress: VAULT })
const usdc = n => parseUnits(n, 6)
const link = h => explorerTxUrl(network, h)
const results = []
const record = (step, outcome) => {
  results.push({ step, ...outcome })
  console.log(`\n▶ ${step}`)
  for (const [k, v] of Object.entries(outcome)) console.log(`   ${k}: ${v}`)
}
async function mined(hash, label) {
  const r = await pub.waitForTransactionReceipt({ hash })
  if (r.status !== 'success') throw new Error(`${label} reverted: ${link(hash)}`)
  console.log(`   ${label}: ${link(hash)}`)
  return r
}

// PolicyVault custom errors, for decoding on-chain reverts.
const VAULT_ERRORS = [
  'SessionInactive', 'SessionExpired', 'AuthExpired', 'ZeroRecipient', 'ZeroAmount', 'OverPerCallCap',
  'InsufficientVaultBalance', 'OverTotalBudget', 'OverDailyCap', 'RecipientNotAllowlisted', 'BadSessionSig'
].map(name => ({ type: 'error', name, inputs: [] }))
const SPEND_ABI = [
  {
    type: 'function', name: 'spend', stateMutability: 'nonpayable', outputs: [],
    inputs: [
      { name: 'owner', type: 'address' }, { name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' },
      { name: 'deadline', type: 'uint256' }, { name: 'sessionSig', type: 'bytes' }
    ]
  },
  {
    type: 'event', name: 'Spent', inputs: [
      { name: 'owner', type: 'address', indexed: true }, { name: 'to', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false }, { name: 'relayer', type: 'address', indexed: true },
      { name: 'nonce', type: 'uint256', indexed: false }
    ]
  },
  {
    type: 'function', name: 'previewSpend', stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: 'ok', type: 'bool' }, { name: 'reason', type: 'string' }]
  },
  ...VAULT_ERRORS
]

/** Submits a session-signed spend straight to the vault (no x402) with a fixed gas limit, so a refused spend is mined as a revert. */
async function onchainRevert(to, amount) {
  const agent = new PolicyVaultClient({ privateKey: hex(demo.VAULT_SESSION_KEY), network, vaultAddress: VAULT })
  const auth = await agent.signSpend({ owner: owner.address, to, amount })
  const args = [owner.address, to, BigInt(auth.amountAtomic), BigInt(auth.deadline), auth.signature]
  let errorName = '(none)'
  try {
    await pub.simulateContract({ address: VAULT, abi: SPEND_ABI, functionName: 'spend', args, account: owner })
  } catch (err) {
    const data = err?.cause?.data ?? err?.cause?.cause?.data
    errorName = data?.errorName ?? (typeof data === 'string' ? decodeErrorResult({ abi: VAULT_ERRORS, data }).errorName : err.shortMessage)
  }
  // Monad bills the gas limit; 80k covers the checks before the revert.
  const hash = await ownerWallet.writeContract({ address: VAULT, abi: SPEND_ABI, functionName: 'spend', args, gas: 80_000n })
  const r = await pub.waitForTransactionReceipt({ hash })
  return { status: r.status, errorName, hash }
}

/** Checks a settlement on-chain: success, a Spent from our vault to the seller, USDC vault → seller. */
async function checkSettlement(hash, to, amount) {
  const r = await pub.getTransactionReceipt({ hash })
  const spent = parseEventLogs({ abi: SPEND_ABI, eventName: 'Spent', logs: r.logs }).find(l => l.address.toLowerCase() === VAULT.toLowerCase())
  const transfer = parseEventLogs({ abi: erc20Abi, eventName: 'Transfer', logs: r.logs }).find(l => l.address.toLowerCase() === net.usdc.address.toLowerCase())
  const ok =
    r.status === 'success' &&
    spent?.args.owner.toLowerCase() === owner.address.toLowerCase() &&
    spent?.args.to.toLowerCase() === to.toLowerCase() &&
    spent?.args.amount === usdc(amount) &&
    transfer?.args.from.toLowerCase() === VAULT.toLowerCase() &&
    transfer?.args.to.toLowerCase() === to.toLowerCase()
  return { ok, gasUsed: r.gasUsed, nonce: spent?.args.nonce, relayer: spent?.args.relayer }
}

// ─── services: our facilitator + two seller proxies ──────────────────────────
async function startFacilitator() {
  const dir = path.join(here, '../services/chainpe-facilitator')
  const child = spawn(path.join(dir, 'node_modules/.bin/tsx'), ['src/server.ts'], {
    cwd: dir,
    env: {
      ...process.env,
      NETWORK: network,
      FACILITATOR_PRIVATE_KEY: hex(relayerKey),
      PORT: String(FACILITATOR_PORT),
      PAYTO_ALLOWLIST: `${SELLER},${OTHER_SELLER}`, // so the vault, not the facilitator, refuses OTHER_SELLER
      REQUIRE_REGISTERED_PAYTO: 'true',
      POLICY_VAULT_ADDRESS: VAULT,
      LOG_LEVEL: 'warn'
    },
    stdio: ['ignore', 'inherit', 'inherit']
  })
  const url = `http://127.0.0.1:${FACILITATOR_PORT}`
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${url}/`)
      if (res.ok) return { child, url, info: await res.json() }
    } catch {}
    await new Promise(r => setTimeout(r, 500))
  }
  child.kill()
  throw new Error('facilitator did not start')
}

const listen = app => new Promise(res => { const s = app.listen(0, () => res({ s, url: `http://127.0.0.1:${s.address().port}` })) })
const backend = express()
backend.get('/:tier', (req, res) => res.json({ tier: req.params.tier, at: new Date().toISOString() }))
const be = await listen(backend)

const fac = await startFacilitator()
console.log(`facilitator ${relayer.address} at ${fac.url} — schemes: ${fac.info.schemes.join(', ')}`)
const proxyFor = async payTo => {
  const config = {
    serviceName: 'ChainPe vault demo', serviceDescription: 'demo', tags: ['demo'], targetUrl: be.url,
    pricePerRequest: '0.01', paymentToken: 'USDC', walletAddress: payTo, proxyPort: 0, network,
    facilitatorUrl: fac.url, logLevel: 'quiet'
  }
  const extra = [
    { path: '/mid', pricePerRequest: '0.02', paymentToken: 'USDC' },
    { path: '/pricey', pricePerRequest: '0.03', paymentToken: 'USDC' }
  ]
  const { server } = await startProxyServer({ config, additionalRoutes: extra })
  return { server, url: `http://127.0.0.1:${server.address().port}` }
}
const seller = await proxyFor(SELLER)
const other = await proxyFor(OTHER_SELLER)
const offers = JSON.parse(Buffer.from((await fetch(`${seller.url}/basic`)).headers.get('payment-required'), 'base64').toString()).accepts
console.log(`seller proxy offers: ${offers.map(o => o.scheme).join(' + ')} (vault ${offers.find(o => o.scheme === 'chainpe-vault')?.extra?.vault})`)

const agent = new ChainPe({
  privateKey: hex(demo.VAULT_SESSION_KEY), // the agent only holds the session key
  network,
  maxPerCall: '0.05', // above the vault's 0.02 so the CONTRACT's cap is what refuses
  registryAddress: '0x000000000000000000000000000000000000dEaD',
  policyVault: { owner: owner.address }
})
const pay = async url => {
  try {
    const r = await agent.pay(url)
    return { status: r.status, payment: r.payment }
  } catch (err) {
    if (err instanceof ChainPePaymentError) return { refused: err.detail ?? err.reason, message: err.message }
    throw err
  }
}
const preview = async (to, amount) => {
  const [ok, reason] = await pub.readContract({ address: VAULT, abi: SPEND_ABI, functionName: 'previewSpend', args: [owner.address, to, usdc(amount)] })
  return ok ? 'ok' : reason
}

try {
  console.log(`\nowner ${owner.address} · session key ${session.address} · seller ${SELLER} · other seller ${OTHER_SELLER}`)
  console.log(`vault ${VAULT} (PolicyVault proxy on ${network})`)

  // 0. Owner funds the vault and sets the mandate.
  console.log('\n▶ owner: approve + deposit 1 USDC, setPolicy, allowlist the seller')
  const approve = await ownerWallet.writeContract({ address: net.usdc.address, abi: erc20Abi, functionName: 'approve', args: [VAULT, usdc('1')] })
  await mined(approve, 'approve')
  await mined(await ownerVault.deposit('1'), 'deposit 1 USDC')
  const expiry = Math.floor(Date.now() / 1000) + 86_400
  const setPolicy = await ownerVault.setPolicy({ sessionKey: session.address, maxPerCall: '0.02', dailyCap: '0.05', totalBudget: '0.10', expiry, allowlistOnly: true })
  await mined(setPolicy, 'setPolicy (0.02 / call, 0.05 / day, 0.10 total, +1 day, allowlist only)')
  await mined(await ownerVault.setAllowlist(SELLER, true), 'allowlist seller')
  results.push({ step: 'owner setup', approve, setPolicy })
  console.log(`   vault balance ${await ownerVault.balanceOf(owner.address)} USDC · daily left ${await ownerVault.dailyRemaining(owner.address)} · budget left ${await ownerVault.budgetRemaining(owner.address)}`)

  // 1. In-cap paid call.
  const t0 = performance.now()
  const ok = await pay(`${seller.url}/basic`)
  const ms = Math.round(performance.now() - t0)
  const c1 = ok.payment?.txHash ? await checkSettlement(ok.payment.txHash, SELLER, '0.01') : { ok: false }
  record('1. in-cap call (0.01) via chainpe-vault', {
    http: ok.status ?? `refused: ${ok.refused}`, scheme: ok.payment?.scheme, ms, tx: ok.payment?.txHash && link(ok.payment.txHash),
    onchain: c1.ok ? `Spent(owner → seller, 0.01, nonce ${c1.nonce}) + USDC vault → seller, gas ${c1.gasUsed}` : 'NOT VERIFIED'
  })

  // 2. Over the per-call cap.
  const over = await pay(`${seller.url}/pricey`)
  const overRevert = await onchainRevert(SELLER, '0.03')
  record('2. over the per-call cap (0.03 > 0.02)', {
    x402: over.refused ? `refused: ${over.refused}` : `UNEXPECTED ${over.status}`,
    previewSpend: await preview(SELLER, '0.03'),
    'direct spend on-chain': `${overRevert.status} (${overRevert.errorName}) ${link(overRevert.hash)}`
  })

  // 3. Seller not on the allowlist.
  const na = await pay(`${other.url}/basic`)
  const naRevert = await onchainRevert(OTHER_SELLER, '0.01')
  record('3. seller not on the owner allowlist', {
    x402: na.refused ? `refused: ${na.refused}` : `UNEXPECTED ${na.status}`,
    previewSpend: await preview(OTHER_SELLER, '0.01'),
    'direct spend on-chain': `${naRevert.status} (${naRevert.errorName}) ${link(naRevert.hash)}`
  })

  // 4. Daily cap: 0.01 spent; 0.02 + 0.02 fills 0.05; one more 0.01 is refused.
  const d1 = await pay(`${seller.url}/mid`)
  const d2 = await pay(`${seller.url}/mid`)
  const d3 = await pay(`${seller.url}/basic`)
  record('4. daily cap 0.05', {
    '0.02 #1': d1.payment?.txHash ? link(d1.payment.txHash) : `refused: ${d1.refused}`,
    '0.02 #2': d2.payment?.txHash ? link(d2.payment.txHash) : `refused: ${d2.refused}`,
    '0.01 more': d3.refused ? `refused: ${d3.refused}` : `UNEXPECTED ${d3.status}`,
    'daily left': `${await ownerVault.dailyRemaining(owner.address)} USDC`
  })

  // 5. Owner revokes the session: no more payments, whatever the caps say.
  const revoke = await ownerVault.revokeSession()
  await mined(revoke, 'revokeSession')
  const afterRevoke = await pay(`${seller.url}/basic`)
  record('5. owner revokes the session', {
    revoke: link(revoke),
    'next call': afterRevoke.refused ? `refused: ${afterRevoke.refused}` : `UNEXPECTED ${afterRevoke.status}`
  })

  // 6. Owner withdraws the rest.
  const left = await ownerVault.balanceOf(owner.address)
  const withdraw = await ownerVault.withdraw(left)
  await mined(withdraw, `withdraw ${left} USDC`)
  record('6. owner withdraws the rest', { amount: `${left} USDC`, tx: link(withdraw), 'vault balance now': `${await ownerVault.balanceOf(owner.address)} USDC` })

  const paid = [ok, d1, d2].filter(r => r.payment?.txHash)
  console.log(`\nSettled via the vault: ${paid.length} calls, ${formatUnits(paid.reduce((a, r) => a + usdc(r.payment.amount), 0n), 6)} USDC to ${SELLER}`)
  console.log('Demo traffic between team-controlled test wallets — not traction.')
  fs.writeFileSync(path.join(here, '.vault-demo-result.json'), JSON.stringify(results, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2))
} finally {
  fac.child.kill()
  seller.server.close()
  other.server.close()
  be.s.close()
}
