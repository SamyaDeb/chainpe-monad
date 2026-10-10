/**
 * Indexer configuration from the environment.
 *
 * Network constants mirror packages/chainpe-sdk/src/networks.ts (this service
 * deploys on its own, so it keeps a copy — keep them in sync, see CLAUDE.md).
 */
import 'dotenv/config'
import { getAddress, type Chain } from 'viem'
import { monad, monadTestnet } from 'viem/chains'

export type Network = 'monad' | 'monad-testnet'

interface NetworkDefaults {
  chain: Chain
  rpcUrl: string
  rpcEnv: string
  usdc: `0x${string}`
  identity: `0x${string}`
  reputation: `0x${string}`
  registry?: `0x${string}`
  policyVault?: `0x${string}`
  /** Block the ChainPeRegistry proxy was deployed in (first block worth scanning). */
  registryDeployBlock?: bigint
}

const NETWORKS: Record<Network, NetworkDefaults> = {
  monad: {
    chain: monad,
    rpcUrl: 'https://rpc.monad.xyz',
    rpcEnv: 'MONAD_RPC_URL',
    usdc: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603',
    identity: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    reputation: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63'
  },
  'monad-testnet': {
    chain: monadTestnet,
    rpcUrl: 'https://testnet-rpc.monad.xyz',
    rpcEnv: 'MONAD_TESTNET_RPC_URL',
    usdc: '0x534b2f3A21130d7a60830c2Df862319e593943A3',
    identity: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    reputation: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
    registry: '0xe41CEcC51A61921dDFCeCAa9807856C446867CA4',
    policyVault: '0x1Eb25cDD00bCCEC89782Aaf12600Ac5eFeEeAB65',
    registryDeployBlock: 69_658_414n
  }
}

export interface IndexerConfig {
  network: Network
  chain: Chain
  rpcUrl: string
  usdc: `0x${string}`
  registry: `0x${string}`
  reputation: `0x${string}`
  identity: `0x${string}`
  /** PolicyVault whose `Spent` events count as payments (mandate mode); undefined = exact only. */
  policyVault?: `0x${string}`
  databaseUrl: string
  port: number
  /** Express `trust proxy` setting (Railway sits behind one proxy hop). */
  trustProxy: number | boolean
  startBlock: bigint
  pollIntervalMs: number
  /** Max block span per getLogs request (Monad's public RPC caps it at ~100). */
  logChunk: bigint
  /** Smallest USDC payment (atomic) that backs a paid rating. */
  minPaidAtomic: bigint
  /** Per-receipt weight cap (atomic USDC): a big payment buys no extra say. */
  weightCapAtomic: bigint
  /** Max share of total paid weight any single payer may hold (0–1]. */
  payerShareCap: number
}

type Env = Record<string, string | undefined>

function parseTrustProxy(raw: string | undefined): number | boolean {
  if (raw === undefined || raw === '') return 1
  if (raw === 'true') return true
  if (raw === 'false') return false
  return Number(raw)
}

function address(value: string | undefined, fallback: string | undefined, label: string, network: Network) {
  const candidate = value?.trim() || fallback
  if (!candidate) throw new Error(`${label} address not set for network "${network}".`)
  return getAddress(candidate)
}

export function loadConfig(env: Env = process.env): IndexerConfig {
  const raw = env.NETWORK?.trim() || 'monad-testnet'
  if (raw !== 'monad' && raw !== 'monad-testnet') {
    throw new Error(`NETWORK must be "monad" or "monad-testnet" (got "${raw}")`)
  }
  const network: Network = raw
  const d = NETWORKS[network]
  const share = Number(env.PAYER_SHARE_CAP ?? '0.25')
  if (!(share > 0 && share <= 1)) throw new Error('PAYER_SHARE_CAP must be in (0, 1]')

  // Without a start block the poller would walk the chain from genesis in LOG_CHUNK
  // spans (tens of millions of getLogs calls on mainnet) — refuse instead.
  const startRaw = env.START_BLOCK?.trim()
  if (!startRaw && d.registryDeployBlock === undefined) {
    throw new Error(`START_BLOCK is required on "${network}" (set it to the ChainPeRegistry deploy block).`)
  }

  return {
    network,
    chain: d.chain,
    rpcUrl: env.RPC_URL?.trim() || env[d.rpcEnv]?.trim() || d.rpcUrl,
    usdc: d.usdc,
    registry: address(env.CHAINPE_REGISTRY_ADDRESS, d.registry, 'ChainPeRegistry', network),
    reputation: address(env.ERC8004_REPUTATION_REGISTRY, d.reputation, 'ERC-8004 Reputation Registry', network),
    identity: address(env.ERC8004_IDENTITY_REGISTRY, d.identity, 'ERC-8004 Identity Registry', network),
    policyVault:
      env.POLICY_VAULT_ADDRESS?.trim() === 'off'
        ? undefined
        : env.POLICY_VAULT_ADDRESS?.trim()
          ? getAddress(env.POLICY_VAULT_ADDRESS.trim())
          : d.policyVault,
    databaseUrl: env.DATABASE_URL ?? '',
    port: Number(env.PORT ?? 4600),
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    startBlock: BigInt(startRaw || d.registryDeployBlock!),
    pollIntervalMs: Number(env.POLL_INTERVAL_MS ?? 2000),
    logChunk: BigInt(env.LOG_CHUNK ?? '100'),
    minPaidAtomic: BigInt(env.MIN_PAID_AMOUNT ?? '1000'), // 0.001 USDC
    weightCapAtomic: BigInt(env.WEIGHT_CAP_AMOUNT ?? '1000000'), // 1 USDC
    payerShareCap: share
  }
}
