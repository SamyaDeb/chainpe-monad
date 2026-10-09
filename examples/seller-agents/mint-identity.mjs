/**
 * Mint an ERC-8004 agent identity and print its agentId.
 *
 * Each seller agent gets a distinct identity so it can accrue portable on-chain
 * reputation. Spends a little AVAX for gas on the seller's wallet.
 *
 * Run: node mint-identity.mjs <privateKey> [agentURI]
 *  or: SELLER_KEY=0x... node mint-identity.mjs
 */
import 'dotenv/config'
import { createWalletClient, createPublicClient, http, decodeEventLog } from 'viem'
import { avalanche, avalancheFuji } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

const NETWORK = process.env.CHAINPE_NETWORK || 'fuji'
const CHAIN = NETWORK === 'avalanche' ? avalanche : avalancheFuji
const RPC =
  process.env.CHAINPE_RPC_URL ||
  (NETWORK === 'avalanche'
    ? 'https://api.avax.network/ext/bc/C/rpc'
    : 'https://api.avax-test.network/ext/bc/C/rpc')

const IDENTITY_REGISTRY =
  process.env.ERC8004_IDENTITY_REGISTRY || '0x56FEc2359fcDfFa6FA1D3a8AB3b708Ff698161D5'

const ABI = [
  {
    type: 'function',
    name: 'register',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'agentURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'Registered',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'agentURI', type: 'string', indexed: false },
      { name: 'owner', type: 'address', indexed: true },
    ],
  },
]

const key = process.argv[2] || process.env.SELLER_KEY || process.env.PRIVATE_KEY
if (!key) {
  console.error('Usage: node mint-identity.mjs <privateKey> [agentURI]   (or set SELLER_KEY)')
  process.exit(1)
}
const agentURI = process.argv[3] || 'chainpe://seller-agent'
const normalized = key.startsWith('0x') ? key : `0x${key}`

const account = privateKeyToAccount(normalized)
const wallet = createWalletClient({ account, chain: CHAIN, transport: http(RPC) })
const pub = createPublicClient({ chain: CHAIN, transport: http(RPC) })

console.log(`Minting ERC-8004 identity for ${account.address} on ${NETWORK}…`)
const hash = await wallet.writeContract({
  account,
  chain: CHAIN,
  address: IDENTITY_REGISTRY,
  abi: ABI,
  functionName: 'register',
  args: [agentURI],
})
const receipt = await pub.waitForTransactionReceipt({ hash })

let agentId
for (const log of receipt.logs) {
  if (log.address.toLowerCase() !== IDENTITY_REGISTRY.toLowerCase()) continue
  try {
    const ev = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics })
    if (ev.eventName === 'Registered') agentId = ev.args.agentId
  } catch {
    /* not our event */
  }
}

if (agentId === undefined) {
  console.error('Minted, but could not decode the agentId from logs. Tx:', hash)
  process.exit(1)
}
console.log(`✓ agentId ${agentId}  (tx ${hash})`)
// Print just the id on the last line for easy capture in scripts.
console.log(String(agentId))
