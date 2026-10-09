/**
 * Avalanche C-Chain benchmark for ChainPe — quantifies why Avalanche fits
 * high-frequency agent micropayments: fast deterministic finality + low fees.
 *
 * MEASURED live (read-only, no funds): chain id, block height, average block
 * time, and the live gas price. PROJECTED: per-operation fees at a clearly
 * labeled representative gas price (testnet gas is ~0 and not representative, so
 * the cost table uses GAS_PRICE_GWEI — default 1 nAVAX, typical of Avalanche
 * C-Chain after the Etna fee reduction). Everything is reproducible:
 *   fee = gasPrice × gas × AVAX_USD.
 *
 * Run: node bench.mjs
 *      GAS_PRICE_GWEI=1 AVAX_USD=40 node bench.mjs
 *      CHAINPE_NETWORK=avalanche node bench.mjs
 */
import { createPublicClient, http, formatEther, formatGwei, parseGwei } from 'viem'
import { avalanche, avalancheFuji } from 'viem/chains'

const NETWORK = process.env.CHAINPE_NETWORK || 'fuji'
const CHAIN = NETWORK === 'avalanche' ? avalanche : avalancheFuji
const RPC =
  process.env.CHAINPE_RPC_URL ||
  (NETWORK === 'avalanche'
    ? 'https://api.avax.network/ext/bc/C/rpc'
    : 'https://api.avax-test.network/ext/bc/C/rpc')
const AVAX_USD = Number(process.env.AVAX_USD || '40')
const PROJECT_GWEI = process.env.GAS_PRICE_GWEI || '1'
const projectedGasPrice = parseGwei(PROJECT_GWEI)

// Representative gas per ChainPe operation (contract suite / typical EVM costs).
const OPS = [
  ['x402 settlement (USDC EIP-3009 transfer)', 75_000n],
  ['ERC-8004 giveFeedback (reputation)', 120_000n],
  ['Register a service (ChainPeRegistry)', 210_000n],
  ['PolicyVault gasless spend', 95_000n]
]

const client = createPublicClient({ chain: CHAIN, transport: http(RPC) })

const N = 30
const [chainId, head, liveGasPrice] = await Promise.all([
  client.getChainId(),
  client.getBlockNumber(),
  client.getGasPrice()
])

const blocks = await Promise.all(
  Array.from({ length: N + 1 }, (_, i) => client.getBlock({ blockNumber: head - BigInt(i) }))
)
const ts = blocks.map(b => Number(b.timestamp))
let sum = 0
for (let i = 0; i < N; i++) sum += ts[i] - ts[i + 1]
const avgBlockTime = sum / N

const costUsd = gas => Number(formatEther(projectedGasPrice * gas)) * AVAX_USD

console.log(`\nChainPe — Avalanche ${NETWORK} live benchmark`)
console.log('='.repeat(60))
console.log('  MEASURED (live):')
console.log(`    Chain ID:          ${chainId}`)
console.log(`    Latest block:      ${head}`)
console.log(`    Avg block time:    ${avgBlockTime.toFixed(2)} s  (last ${N} blocks)`)
console.log(`    Live gas price:    ${formatGwei(liveGasPrice)} gwei`)
console.log(`    Finality:          ~1–2 s, deterministic — no reorgs (Snowman consensus)`)
console.log('\n  PROJECTED fees @ ' + PROJECT_GWEI + ' gwei, AVAX=$' + AVAX_USD + ':')
console.log('  ' + '-'.repeat(58))
for (const [label, gas] of OPS) {
  const c = costUsd(gas)
  const perDollar = Math.floor(1 / c).toLocaleString()
  console.log(`    ${label.padEnd(42)} $${c.toFixed(5)}  (${perDollar}/$1)`)
}
console.log('  ' + '-'.repeat(58))
console.log(
  `\n  → Sub-cent settlement + ~2s finality = pay-per-request economics that`
)
console.log(`    actually work in a live agent loop. Recompute: fee = gasPrice × gas × AVAX_USD.\n`)
