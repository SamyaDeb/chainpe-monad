/**
 * Fund all seller wallets from a single master wallet.
 *
 * Sends each seller wallet:
 *   - 0.07 AVAX  (gas for ERC-8004 identity mint + registry register tx)
 *   - 0.15 USDC  (0.1 registration fee + 0.05 buffer)
 *
 * The master wallet needs:
 *   - ≥ 0.5 AVAX  (faucet: https://core.app/tools/testnet-faucet/)
 *   - ≥ 1.5 USDC  (faucet: https://faucet.circle.com → Avalanche Fuji)
 *
 * Run:
 *   MASTER_KEY=0x... node fund-sellers.mjs
 *   # Or with the buyer key already in .env:
 *   node fund-sellers.mjs
 */
import 'dotenv/config'
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  parseUnits,
  formatUnits,
  erc20Abi,
} from 'viem'
import { avalancheFuji } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

const RPC = 'https://api.avax-test.network/ext/bc/C/rpc'
const USDC = '0x5425890298aed601595a70AB815c96711a31Bc65'
const AVAX_PER_SELLER = parseEther('0.07')
const USDC_PER_SELLER = parseUnits('0.15', 6)

const rawKey = process.env.MASTER_KEY || process.env.CHAINPE_PRIVATE_KEY
if (!rawKey) {
  console.error('Set MASTER_KEY=0x... (a Fuji wallet with ≥0.5 AVAX and ≥1.5 USDC)')
  process.exit(1)
}
const masterKey = rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`
const masterAccount = privateKeyToAccount(masterKey)

const pub = createPublicClient({ chain: avalancheFuji, transport: http(RPC) })
const wallet = createWalletClient({ account: masterAccount, chain: avalancheFuji, transport: http(RPC) })

const SELLERS = [
  { label: 'Research Agent',   addr: process.env.RESEARCH_PAYTO },
  { label: 'Digest Agent',     addr: process.env.DIGEST_PAYTO },
  { label: 'Price Agent',      addr: process.env.PRICE_PAYTO },
  { label: 'News Agent',       addr: process.env.NEWS_PAYTO },
  { label: 'Analysis Agent',   addr: process.env.ANALYSIS_PAYTO },
  { label: 'DEX Agent',        addr: process.env.DEX_PAYTO },
].filter(s => s.addr)

if (!SELLERS.length) {
  console.error('No seller addresses found in .env. Run gen-wallets.mjs first.')
  process.exit(1)
}

// Check master balances
const avaxWei = await pub.getBalance({ address: masterAccount.address })
const usdcRaw = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [masterAccount.address] })

console.log(`\nMaster wallet: ${masterAccount.address}`)
console.log(`  AVAX: ${formatUnits(avaxWei, 18)}  (need ≥${formatUnits(AVAX_PER_SELLER * BigInt(SELLERS.length), 18)})`)
console.log(`  USDC: ${formatUnits(usdcRaw, 6)}  (need ≥${formatUnits(USDC_PER_SELLER * BigInt(SELLERS.length), 6)})`)

const needAvax = AVAX_PER_SELLER * BigInt(SELLERS.length)
const needUsdc = USDC_PER_SELLER * BigInt(SELLERS.length)

if (avaxWei < needAvax) {
  console.error(`\n✗ Not enough AVAX. Get ${formatUnits(needAvax - avaxWei, 18)} more from:\n  https://core.app/tools/testnet-faucet/`)
  process.exit(1)
}
if (usdcRaw < needUsdc) {
  console.error(`\n✗ Not enough USDC. Get ${formatUnits(needUsdc - usdcRaw, 6)} more from:\n  https://faucet.circle.com  (select Avalanche Fuji)`)
  process.exit(1)
}

console.log(`\nFunding ${SELLERS.length} seller wallets...\n`)

for (const { label, addr } of SELLERS) {
  process.stdout.write(`  ${label.padEnd(18)} ${addr}`)

  // Send AVAX
  const avaxTx = await wallet.sendTransaction({ to: addr, value: AVAX_PER_SELLER })
  await pub.waitForTransactionReceipt({ hash: avaxTx, timeout: 60_000 })

  // Send USDC
  const usdcTx = await wallet.writeContract({
    address: USDC, abi: erc20Abi, functionName: 'transfer',
    args: [addr, USDC_PER_SELLER],
  })
  await pub.waitForTransactionReceipt({ hash: usdcTx, timeout: 60_000 })

  console.log(`  ✓  +0.07 AVAX  +0.15 USDC`)
}

console.log('\nAll sellers funded. Run register-all.mjs to register on-chain.')
