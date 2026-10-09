/**
 * AVAX DEX Seller Agent — executes swaps on Trader Joe (Fuji testnet), paid per call.
 *
 *   POST /swap     { fromToken, toToken, amountIn, slippagePct, live? }
 *                  → swap quote + (if live=true) actual on-chain execution
 *   POST /quote    { fromToken, toToken, amountIn }  → quote only, no execution
 *   GET  /tokens   → supported tokens on Fuji
 *   GET  /health   → free
 *
 * Defaults to SIMULATION. Pass live=true in body to execute a real testnet swap.
 * The agent's own wallet (DEX_WALLET_KEY) signs + pays gas for the swap.
 *
 * Run: node avax-dex-agent.mjs  (needs DEX_PAYTO + DEX_WALLET_KEY)
 */
import 'dotenv/config'
import express from 'express'
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  parseEther,
  erc20Abi,
  maxUint256,
} from 'viem'
import { avalancheFuji } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { startSeller, requireEnv } from './seller-runtime.mjs'

// ── Fuji contract addresses ───────────────────────────────────────────────────

const TOKENS = {
  WAVAX: { address: '0xd00ae08403B9bbb9124bB305C09058E32C39A48c', decimals: 18, symbol: 'WAVAX' },
  USDC:  { address: '0x5425890298aed601595a70AB815c96711a31Bc65', decimals: 6,  symbol: 'USDC'  },
  USDT:  { address: '0x134b1be34911e39a8397ec6bF97898C5b0Edf7A', decimals: 6,  symbol: 'USDT'  },
}

// Trader Joe V1 Router on Fuji
const TRADER_JOE_ROUTER = '0xd7f655E3376cE2D7A2b08fF01Eb3B1023191A901'

const ROUTER_ABI = [
  {
    name: 'getAmountsOut',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'path', type: 'address[]' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
  {
    name: 'swapExactTokensForTokens',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
  {
    name: 'swapExactAVAXForTokens',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
  {
    name: 'swapExactTokensForAVAX',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
]

// ── Viem clients ──────────────────────────────────────────────────────────────

const RPC = process.env.AVAX_RPC || 'https://api.avax-test.network/ext/bc/C/rpc'
const pub = createPublicClient({ chain: avalancheFuji, transport: http(RPC) })

function resolveToken(symbol) {
  const upper = symbol?.toUpperCase()
  if (!TOKENS[upper]) throw new Error(`Unknown token: ${symbol}. Supported: ${Object.keys(TOKENS).join(', ')}`)
  return TOKENS[upper]
}

async function getQuote(fromToken, toToken, amountInAtomic) {
  const path = [fromToken.address, toToken.address]
  try {
    const amounts = await pub.readContract({
      address: TRADER_JOE_ROUTER,
      abi: ROUTER_ABI,
      functionName: 'getAmountsOut',
      args: [amountInAtomic, path],
    })
    return amounts[1] // amountOut
  } catch (err) {
    // If no direct pair exists, try routing through WAVAX
    if (fromToken.symbol !== 'WAVAX' && toToken.symbol !== 'WAVAX') {
      const wavax = TOKENS.WAVAX
      const midPath = [fromToken.address, wavax.address, toToken.address]
      const amounts = await pub.readContract({
        address: TRADER_JOE_ROUTER,
        abi: ROUTER_ABI,
        functionName: 'getAmountsOut',
        args: [amountInAtomic, midPath],
      })
      return amounts[2]
    }
    throw err
  }
}

// ── Express app ───────────────────────────────────────────────────────────────

const app = express()
app.use(express.json())

app.get('/health', (_req, res) => res.json({ status: 'ok', agent: 'avax-dex' }))
app.get('/schema', (_req, res) => res.json({
  name: 'AVAX DEX Agent',
  routes: [
    { method: 'POST', path: '/swap',  paid: true,  description: 'Execute or simulate a DEX swap on Trader Joe Fuji. Body: { fromToken: "USDC"|"WAVAX"|"AVAX", toToken: "USDC"|"WAVAX"|"AVAX", amountIn: string, slippagePct?: number, live?: boolean }. live=true executes real on-chain swap; live=false (default) simulates.' },
    { method: 'POST', path: '/quote', paid: true,  description: 'Get swap quote without executing. Body: { fromToken, toToken, amountIn }.' },
    { method: 'GET',  path: '/tokens',paid: true,  description: 'List supported tokens and contract addresses.' },
    { method: 'GET',  path: '/health',paid: false, description: 'Health check — free.' },
  ],
}))

app.get('/tokens', (_req, res) => {
  res.json({
    agent: 'avax-dex-agent',
    network: 'avalanche-fuji',
    router: TRADER_JOE_ROUTER,
    tokens: TOKENS,
  })
})

app.post('/quote', async (req, res) => {
  const { fromToken: fromSym, toToken: toSym, amountIn } = req.body ?? {}
  if (!fromSym || !toSym || !amountIn) {
    return res.status(400).json({ error: 'Required: fromToken, toToken, amountIn' })
  }
  try {
    const from = resolveToken(fromSym)
    const to = resolveToken(toSym)
    const amountInAtomic = parseUnits(String(amountIn), from.decimals)
    const amountOutAtomic = await getQuote(from, to, amountInAtomic)
    const amountOut = formatUnits(amountOutAtomic, to.decimals)
    const rate = Number(amountOut) / Number(amountIn)

    res.json({
      agent: 'avax-dex-agent',
      network: 'avalanche-fuji',
      from: { token: from.symbol, amount: String(amountIn) },
      to: { token: to.symbol, amount: amountOut },
      rate,
      priceImpactNote: 'Price impact not computed — use small amounts on testnet.',
    })
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) })
  }
})

app.post('/swap', async (req, res) => {
  const {
    fromToken: fromSym,
    toToken: toSym,
    amountIn,
    slippagePct = 0.5,
    live = false,
    recipient,
  } = req.body ?? {}

  if (!fromSym || !toSym || !amountIn) {
    return res.status(400).json({ error: 'Required: fromToken, toToken, amountIn' })
  }

  const walletKey = process.env.DEX_WALLET_KEY
  if (live && !walletKey) {
    return res.status(400).json({
      error: 'live=true requires DEX_WALLET_KEY env var (the agent wallet that signs swaps).',
    })
  }

  try {
    const from = resolveToken(fromSym)
    const to = resolveToken(toSym)
    const amountInAtomic = parseUnits(String(amountIn), from.decimals)

    // Always get a quote first
    let amountOutAtomic
    try {
      amountOutAtomic = await getQuote(from, to, amountInAtomic)
    } catch (err) {
      return res.status(400).json({
        error: `No liquidity pair found on Trader Joe Fuji for ${from.symbol}→${to.symbol}: ${err.message}`,
      })
    }

    const amountOut = formatUnits(amountOutAtomic, to.decimals)
    const rate = Number(amountOut) / Number(amountIn)
    const slippage = slippagePct / 100
    const amountOutMin = (amountOutAtomic * BigInt(Math.floor((1 - slippage) * 10000))) / 10000n
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300) // 5 min

    // ── SIMULATION MODE ──────────────────────────────────────────────────────
    if (!live) {
      return res.json({
        agent: 'avax-dex-agent',
        mode: 'simulation',
        network: 'avalanche-fuji',
        router: TRADER_JOE_ROUTER,
        swap: {
          from: { token: from.symbol, amount: String(amountIn) },
          to: { token: to.symbol, estimatedAmount: amountOut },
          rate,
          slippagePct,
          minReceived: formatUnits(amountOutMin, to.decimals),
          deadline: new Date(Number(deadline) * 1000).toISOString(),
        },
        note: 'Simulation only. Pass live=true to execute the real swap on Fuji.',
      })
    }

    // ── LIVE EXECUTION MODE ──────────────────────────────────────────────────
    const normalizedKey = walletKey.startsWith('0x') ? walletKey : `0x${walletKey}`
    const account = privateKeyToAccount(normalizedKey)
    const walletClient = createWalletClient({ account, chain: avalancheFuji, transport: http(RPC) })
    const to_addr = (recipient ?? account.address)
    const path = [from.address, to.address]

    // Approve router to spend fromToken
    const approveTx = await walletClient.writeContract({
      address: from.address,
      abi: erc20Abi,
      functionName: 'approve',
      args: [TRADER_JOE_ROUTER, maxUint256],
    })
    await pub.waitForTransactionReceipt({ hash: approveTx, timeout: 60_000 })

    // Execute swap
    const swapTx = await walletClient.writeContract({
      address: TRADER_JOE_ROUTER,
      abi: ROUTER_ABI,
      functionName: 'swapExactTokensForTokens',
      args: [amountInAtomic, amountOutMin, path, to_addr, deadline],
    })
    const receipt = await pub.waitForTransactionReceipt({ hash: swapTx, timeout: 60_000 })

    res.json({
      agent: 'avax-dex-agent',
      mode: 'live',
      network: 'avalanche-fuji',
      router: TRADER_JOE_ROUTER,
      swap: {
        from: { token: from.symbol, amount: String(amountIn) },
        to: { token: to.symbol, estimatedAmount: amountOut },
        rate,
        slippagePct,
        minReceived: formatUnits(amountOutMin, to.decimals),
        recipient: to_addr,
      },
      tx: {
        approveTxHash: approveTx,
        swapTxHash: swapTx,
        blockNumber: String(receipt.blockNumber),
        status: receipt.status === 'success' ? 'confirmed' : 'reverted',
        explorerUrl: `https://testnet.snowtrace.io/tx/${swapTx}`,
      },
    })
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) })
  }
})

await startSeller({
  name: process.env.DEX_NAME || 'AVAX DEX Agent',
  app,
  backendPort: Number(process.env.DEX_BACKEND_PORT || 5106),
  proxyPort: Number(process.env.DEX_PROXY_PORT || 4506),
  payTo: requireEnv('DEX_PAYTO'),
  price: process.env.DEX_PRICE || '0.01',
  description: 'DEX swap agent on Trader Joe Fuji. Quotes and executes WAVAX/USDC swaps on testnet.',
  tags: ['avax', 'dex', 'swap', 'trading'],
  agentId: process.env.DEX_AGENT_ID,
})
