#!/usr/bin/env node
/**
 * Phase 4 live demo on Monad TESTNET: "no receipt, no rating".
 *
 *   node e2e/monad-reputation-demo.mjs setup    seller mints an ERC-8004 agentId on the canonical
 *                                               Identity Registry and registers its service in the
 *                                               ChainPe registry (payTo = seller, linked to agentId)
 *   node e2e/monad-reputation-demo.mjs unpaid   a second wallet rates the seller WITHOUT a receipt
 *                                               (zero feedbackHash) and once more citing someone
 *                                               else's settlement tx (STOLEN_RECEIPT=0x…)
 *   node e2e/monad-reputation-demo.mjs status   balances + agent id
 *
 * The paid rating comes from e2e/monad-paid-call.mjs (AGENT_ID + FEEDBACK).
 *
 * Keys come from e2e/.env.demo (git-ignored): SELLER_PRIVATE_KEY, RATER_PRIVATE_KEY,
 * and AGENT_ID once `setup` has run. Testnet only. Build first: npm run build
 * Demo traffic between team-controlled wallets — not traction.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWalletClient, http, parseEventLogs } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  ChainPe,
  RegistryWriter,
  chainFor,
  explorerTxUrl,
  explorerAddressUrl,
  paymentFeedbackUri,
  publicClientFor,
  resolveIdentityRegistry,
  resolveRegistryAddress,
  resolveReputationRegistry,
  rpcUrlFor
} from '@chainpemonad/sdk'

const network = 'monad-testnet' // this demo never touches mainnet
const envFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '.env.demo')

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

const IDENTITY_ABI = [
  {
    type: 'function',
    name: 'register',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'agentURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }]
  },
  {
    type: 'event',
    name: 'Registered',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'agentURI', type: 'string', indexed: false },
      { name: 'owner', type: 'address', indexed: true }
    ]
  }
]
const FEEDBACK_ABI = [
  {
    type: 'function',
    name: 'giveFeedback',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'value', type: 'int128' },
      { name: 'valueDecimals', type: 'uint8' },
      { name: 'tag1', type: 'string' },
      { name: 'tag2', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'feedbackURI', type: 'string' },
      { name: 'feedbackHash', type: 'bytes32' }
    ],
    outputs: []
  }
]

const pub = publicClientFor(network)
const walletFor = key => {
  const account = privateKeyToAccount(key)
  return { account, client: createWalletClient({ account, chain: chainFor(network), transport: http(rpcUrlFor(network)) }) }
}
async function send(label, hashPromise) {
  const hash = await hashPromise
  const r = await pub.waitForTransactionReceipt({ hash })
  if (r.status !== 'success') throw new Error(`${label} reverted: ${hash}`)
  console.log(`${label}: ${explorerTxUrl(network, hash)} (gas ${r.gasUsed})`)
  return r
}

async function setup(env) {
  const seller = walletFor(env.SELLER_PRIVATE_KEY)
  console.log(`seller ${seller.account.address}`)
  let agentId = env.AGENT_ID
  if (!agentId) {
    const identity = resolveIdentityRegistry(network)
    const r = await send(
      'mint ERC-8004 agentId',
      seller.client.writeContract({
        address: identity,
        abi: IDENTITY_ABI,
        functionName: 'register',
        args: ['https://github.com/SamyaDeb/chainpe-monad#phase-4-demo-seller']
      })
    )
    const [ev] = parseEventLogs({ abi: IDENTITY_ABI, eventName: 'Registered', logs: r.logs })
    agentId = ev.args.agentId.toString()
    saveVar('AGENT_ID', agentId)
  }
  console.log(`agentId ${agentId}`)

  const registry = resolveRegistryAddress(network)
  const writer = new RegistryWriter(network, registry, env.SELLER_PRIVATE_KEY)
  const res = await writer.registerOrUpdate({
    name: 'monad-weather-demo',
    description: 'Phase 4 demo seller: x402 paid weather on Monad testnet (test traffic only)',
    tags: ['weather', 'demo'],
    endpoint: 'https://chainpe.example/monad-weather',
    pricePerRequest: '0.01',
    payTo: seller.account.address,
    agentId
  })
  const r = await pub.waitForTransactionReceipt({ hash: res.txHash })
  console.log(`${res.action} service in ChainPeRegistry: ${explorerTxUrl(network, res.txHash)} (status ${r.status})`)
}

async function unpaid(env) {
  if (!env.AGENT_ID) throw new Error('run setup first (AGENT_ID)')
  const rater = walletFor(env.RATER_PRIVATE_KEY)
  const reputation = resolveReputationRegistry(network)
  console.log(`rater ${rater.account.address} (never paid the seller)`)
  const zero = `0x${'0'.repeat(64)}`
  await send(
    'feedback 100/100 WITHOUT a receipt',
    rater.client.writeContract({
      address: reputation,
      abi: FEEDBACK_ABI,
      functionName: 'giveFeedback',
      args: [BigInt(env.AGENT_ID), 100n, 0, 'x402', 'paid-call', '', '', zero]
    })
  )
  const stolen = process.env.STOLEN_RECEIPT
  if (stolen) {
    await send(
      `feedback 100/100 citing someone else's receipt ${stolen.slice(0, 10)}…`,
      rater.client.writeContract({
        address: reputation,
        abi: FEEDBACK_ABI,
        functionName: 'giveFeedback',
        args: [BigInt(env.AGENT_ID), 100n, 0, 'x402', 'paid-call', '', paymentFeedbackUri(network, stolen), stolen]
      })
    )
  }
}

async function status(env) {
  for (const [name, key] of [
    ['seller', env.SELLER_PRIVATE_KEY],
    ['rater', env.RATER_PRIVATE_KEY]
  ]) {
    const cp = new ChainPe({ privateKey: key, network })
    console.log(`${name.padEnd(6)} ${cp.getAddress()}  ${JSON.stringify(await cp.balance())}  ${explorerAddressUrl(network, cp.getAddress())}`)
  }
  console.log(`agentId ${env.AGENT_ID ?? '(not minted yet)'}`)
}

const cmd = process.argv[2]
const env = loadEnv()
const steps = { setup, unpaid, status }
if (!steps[cmd]) {
  console.error('usage: monad-reputation-demo.mjs setup | unpaid | status')
  process.exit(1)
}
await steps[cmd](env)
