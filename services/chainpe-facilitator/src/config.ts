/**
 * Facilitator configuration from the environment.
 *
 * Network constants mirror packages/chainpe-sdk/src/networks.ts (this service
 * deploys on its own, so it keeps a copy — keep them in sync, see CLAUDE.md).
 */
import { defineChain, parseEther, type Chain } from 'viem'
import { monad, monadTestnet } from 'viem/chains'

export type Caip2 = `eip155:${number}`

export interface FacilitatorConfig {
  /** `monad`, `monad-testnet`, or `local` (any EVM chain — used by e2e tests). */
  network: string
  caip2: Caip2
  chain: Chain
  rpcUrl: string
  /** USDC (EIP-3009) — the only asset this facilitator settles. */
  usdc: `0x${string}`
  privateKey: `0x${string}`
  port: number
  allowedOrigins: string[]
  /** Express `trust proxy` setting (Railway sits behind one proxy hop). */
  trustProxy: number | boolean
  rateLimitPerMinute: number
  /** Smallest payment we pay gas to settle (atomic USDC). */
  minAmountAtomic: bigint
  /** Static payTo allowlist (lower-case). */
  payToAllowlist: Set<string>
  /** Indexer base URL; registered services' payTo addresses are allowed. */
  indexerUrl?: string
  /** Refuse payTo addresses that are neither listed nor registered. */
  requireRegisteredPayTo: boolean
  /**
   * Warn when the gas key falls below this. Settlements are gas-only (no MON
   * value), so Monad's 10 MON reserve rule does not apply; ~1 MON covers
   * hundreds of settlements (~137k gas each).
   */
  lowGasThresholdWei: bigint
}

const MONAD_NETWORKS: Record<string, { caip2: Caip2; chain: Chain; rpcUrl: string; rpcEnv: string; usdc: `0x${string}` }> = {
  monad: {
    caip2: 'eip155:143',
    chain: monad,
    rpcUrl: 'https://rpc.monad.xyz',
    rpcEnv: 'MONAD_RPC_URL',
    usdc: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603'
  },
  'monad-testnet': {
    caip2: 'eip155:10143',
    chain: monadTestnet,
    rpcUrl: 'https://testnet-rpc.monad.xyz',
    rpcEnv: 'MONAD_TESTNET_RPC_URL',
    usdc: '0x534b2f3A21130d7a60830c2Df862319e593943A3'
  }
}

type Env = Record<string, string | undefined>

function req(env: Env, name: string): string {
  const v = env[name]?.trim()
  if (!v) throw new Error(`${name} is required`)
  return v
}

function hexKey(value: string): `0x${string}` {
  return (value.startsWith('0x') ? value : `0x${value}`) as `0x${string}`
}

function parseTrustProxy(raw: string | undefined): number | boolean {
  if (raw === undefined || raw === '') return 1
  if (raw === 'true') return true
  if (raw === 'false') return false
  return Number(raw)
}

export function loadConfig(env: Env = process.env): FacilitatorConfig {
  const network = env.NETWORK?.trim() || 'monad-testnet'

  let caip2: Caip2
  let chain: Chain
  let rpcUrl: string
  let usdc: `0x${string}`
  const known = MONAD_NETWORKS[network]
  if (known) {
    caip2 = known.caip2
    chain = known.chain
    rpcUrl = env.RPC_URL || env[known.rpcEnv] || known.rpcUrl
    usdc = (env.USDC_ADDRESS as `0x${string}`) || known.usdc
  } else if (network === 'local') {
    const chainId = Number(req(env, 'CHAIN_ID'))
    rpcUrl = req(env, 'RPC_URL')
    usdc = req(env, 'USDC_ADDRESS') as `0x${string}`
    caip2 = `eip155:${chainId}`
    chain = defineChain({
      id: chainId,
      name: 'local',
      nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } }
    })
  } else {
    throw new Error(`Unsupported NETWORK "${network}" (use monad, monad-testnet or local)`)
  }

  const payToAllowlist = new Set(
    (env.PAYTO_ALLOWLIST ?? '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
  )
  const requireRegisteredPayTo =
    env.REQUIRE_REGISTERED_PAYTO !== undefined
      ? env.REQUIRE_REGISTERED_PAYTO === 'true'
      : network === 'monad' // strict by default on mainnet

  return {
    network,
    caip2,
    chain,
    rpcUrl,
    usdc,
    privateKey: hexKey(req(env, 'FACILITATOR_PRIVATE_KEY')),
    port: Number(env.PORT ?? 4500),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE ?? 120),
    minAmountAtomic: BigInt(env.MIN_AMOUNT_ATOMIC ?? '1000'), // 0.001 USDC
    payToAllowlist,
    indexerUrl: env.CHAINPE_INDEXER_URL?.replace(/\/$/, '') || undefined,
    requireRegisteredPayTo,
    lowGasThresholdWei: parseEther(env.LOW_GAS_MON ?? '1')
  }
}
