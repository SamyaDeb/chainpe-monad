// Fund the demo wallets with MON for gas from DEPLOYER_PRIVATE_KEY (TESTNET ONLY).
// Also tops the BUYER up to AMOUNT_BUYER_USDC testnet USDC (default 1) from the deployer, so no faucet is needed.
//   AMOUNT_BUYER=0.5 AMOUNT_FACILITATOR=1 AMOUNT_SELLER=0.2 AMOUNT_BUYER_USDC=1 node fund.mjs
import { createWalletClient, http, parseEther, formatEther, parseUnits, formatUnits, erc20Abi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { chainFor, explorerTxUrl, getUsdcAddress, publicClientFor, rpcUrlFor } from '@chainpeavax/sdk'
import { network, loadEnv, SERVICES } from './lib.mjs'

if (network !== 'monad-testnet') throw new Error('fund.mjs is testnet only')
if (!process.env.DEPLOYER_PRIVATE_KEY) throw new Error('DEPLOYER_PRIVATE_KEY not set')
const env = loadEnv()
const pub = publicClientFor(network)
const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY)
const wallet = createWalletClient({ account, chain: chainFor(network), transport: http(rpcUrlFor(network)) })
const plan = [
  ['BUYER', process.env.AMOUNT_BUYER ?? '0.5'],
  ['FACILITATOR', process.env.AMOUNT_FACILITATOR ?? '1'],
  ...SERVICES.map(s => [s.id, process.env.AMOUNT_SELLER ?? '0.2'])
]
console.log(`deployer ${account.address} MON ${formatEther(await pub.getBalance({ address: account.address }))}`)
for (const [role, amt] of plan) {
  const to = privateKeyToAccount(env[`${role}_KEY`]).address
  if ((await pub.getBalance({ address: to })) >= parseEther(amt)) { console.log(role, 'already funded'); continue }
  const hash = await wallet.sendTransaction({ to, value: parseEther(amt), gas: 21000n })
  await pub.waitForTransactionReceipt({ hash })
  console.log(role.padEnd(12), to, amt, 'MON', explorerTxUrl(network, hash))
}

// Testnet USDC for the buyer's x402 payments.
const usdc = getUsdcAddress(network)
const buyer = privateKeyToAccount(env.BUYER_KEY).address
const want = parseUnits(process.env.AMOUNT_BUYER_USDC ?? '1', 6)
const have = await pub.readContract({ address: usdc, abi: erc20Abi, functionName: 'balanceOf', args: [buyer] })
if (have >= want) console.log('BUYER       ', buyer, 'already has', formatUnits(have, 6), 'USDC')
else {
  const args = [buyer, want - have]
  // Monad bills the gas limit, so estimate (cold slots on a fresh recipient cost more) + 20% headroom.
  const gas = (await pub.estimateContractGas({ account, address: usdc, abi: erc20Abi, functionName: 'transfer', args })) * 12n / 10n
  const hash = await wallet.writeContract({ address: usdc, abi: erc20Abi, functionName: 'transfer', args, gas })
  const receipt = await pub.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`USDC transfer reverted: ${explorerTxUrl(network, hash)}`)
  console.log('BUYER       ', buyer, formatUnits(want - have, 6), 'USDC', explorerTxUrl(network, hash))
}
