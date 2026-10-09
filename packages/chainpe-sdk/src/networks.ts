/**
 * Monad network constants — the single source of truth for ChainPe.
 *
 * Every other package imports these from `@chainpeavax/sdk`. Services that
 * deploy on their own (facilitator, indexer) and the contract scripts keep a
 * copy that must match this file (see CLAUDE.md).
 */
import { createPublicClient, http, getAddress, type Chain, type PublicClient } from 'viem'
import { monad, monadTestnet } from 'viem/chains'

/** Monad network ChainPe operates on. */
export type ChainPeNetwork = 'monad' | 'monad-testnet'

/** CAIP-2 chain identifier, as used by x402 v2 (`eip155:<chainId>`). */
export type Caip2 = `eip155:${number}`

/** Testnet is the default so nothing spends real money unless asked to. */
export const DEFAULT_NETWORK: ChainPeNetwork = 'monad-testnet'

export const USDC_DECIMALS = 6

export interface UsdcInfo {
  address: `0x${string}`
  decimals: typeof USDC_DECIMALS
  /** EIP-712 domain of Circle's USDC on Monad (needed to sign EIP-3009). */
  eip712Name: string
  eip712Version: string
}

export interface NetworkInfo {
  name: ChainPeNetwork
  chainId: number
  caip2: Caip2
  chain: Chain
  /** Default public RPC; override with MONAD_RPC_URL / MONAD_TESTNET_RPC_URL. */
  rpcUrl: string
  rpcEnvVar: 'MONAD_RPC_URL' | 'MONAD_TESTNET_RPC_URL'
  usdc: UsdcInfo
  /** Canonical ERC-8004 registries on this network. */
  erc8004: {
    identityRegistry: `0x${string}`
    reputationRegistry: `0x${string}`
  }
  /** Deployed ChainPeRegistry proxy, once known (see contracts/deployments). */
  chainPeRegistry?: `0x${string}`
  /** Deployed PolicyVault proxy, once known. */
  policyVault?: `0x${string}`
  explorer: string
  nativeSymbol: 'MON'
  faucet?: string
}

export const NETWORKS: Record<ChainPeNetwork, NetworkInfo> = {
  monad: {
    name: 'monad',
    chainId: 143,
    caip2: 'eip155:143',
    chain: monad,
    rpcUrl: 'https://rpc.monad.xyz',
    rpcEnvVar: 'MONAD_RPC_URL',
    usdc: {
      address: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603',
      decimals: USDC_DECIMALS,
      eip712Name: 'USDC',
      eip712Version: '2'
    },
    erc8004: {
      identityRegistry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
      reputationRegistry: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63'
    },
    explorer: 'https://monadvision.com',
    nativeSymbol: 'MON'
  },
  'monad-testnet': {
    name: 'monad-testnet',
    chainId: 10143,
    caip2: 'eip155:10143',
    chain: monadTestnet,
    rpcUrl: 'https://testnet-rpc.monad.xyz',
    rpcEnvVar: 'MONAD_TESTNET_RPC_URL',
    usdc: {
      address: '0x534b2f3A21130d7a60830c2Df862319e593943A3',
      decimals: USDC_DECIMALS,
      eip712Name: 'USDC',
      eip712Version: '2'
    },
    // CREATE2 testnet addresses of the canonical ERC-8004 deployment.
    // TODO(verify): confirm these have code on Monad testnet.
    erc8004: {
      identityRegistry: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
      reputationRegistry: '0x8004B663056A597Dffe9eCcC1965A193B7388713'
    },
    explorer: 'https://testnet.monadvision.com',
    nativeSymbol: 'MON',
    faucet: 'https://faucet.monad.xyz'
  }
}

function env(name: string): string | undefined {
  if (typeof process === 'undefined' || !process.env) return undefined
  const value = process.env[name]
  return value && value.trim() !== '' ? value.trim() : undefined
}

export function isChainPeNetwork(value: unknown): value is ChainPeNetwork {
  return value === 'monad' || value === 'monad-testnet'
}

export function getNetwork(network: ChainPeNetwork): NetworkInfo {
  const info = NETWORKS[network]
  if (!info) throw new Error(`Unknown ChainPe network: ${String(network)}`)
  return info
}

/** Maps a chain id (143 / 10143) back to the ChainPe network name. */
export function networkFromChainId(chainId: number): ChainPeNetwork | undefined {
  return (Object.keys(NETWORKS) as ChainPeNetwork[]).find(n => NETWORKS[n].chainId === chainId)
}

/** Maps a CAIP-2 id (`eip155:143`) — or a legacy x402 v1 name (`monad`) — to a network. */
export function networkFromCaip2(id: string): ChainPeNetwork | undefined {
  if (isChainPeNetwork(id)) return id
  const match = /^eip155:(\d+)$/.exec(id)
  return match ? networkFromChainId(Number(match[1])) : undefined
}

export function chainFor(network: ChainPeNetwork): Chain {
  return getNetwork(network).chain
}

/** RPC URL for a network, honouring MONAD_RPC_URL / MONAD_TESTNET_RPC_URL. */
export function rpcUrlFor(network: ChainPeNetwork): string {
  const info = getNetwork(network)
  return env(info.rpcEnvVar) ?? info.rpcUrl
}

export function getUsdcAddress(network: ChainPeNetwork): `0x${string}` {
  return getNetwork(network).usdc.address
}

export function getCaip2(network: ChainPeNetwork): Caip2 {
  return getNetwork(network).caip2
}

export function publicClientFor(network: ChainPeNetwork): PublicClient {
  return createPublicClient({
    chain: chainFor(network),
    transport: http(rpcUrlFor(network))
  }) as PublicClient
}

/**
 * Resolves the ChainPeRegistry address: explicit arg → CHAINPE_REGISTRY_ADDRESS →
 * built-in default. Throws when none is available.
 */
export function resolveRegistryAddress(network: ChainPeNetwork, explicit?: string): `0x${string}` {
  const candidate = explicit ?? env('CHAINPE_REGISTRY_ADDRESS') ?? getNetwork(network).chainPeRegistry
  if (!candidate) {
    throw new Error(
      `No ChainPe registry address for network "${network}". Pass registryAddress or set CHAINPE_REGISTRY_ADDRESS.`
    )
  }
  return getAddress(candidate)
}

/** ERC-8004 Reputation Registry: explicit → ERC8004_REPUTATION_REGISTRY → canonical. */
export function resolveReputationRegistry(network: ChainPeNetwork, explicit?: string): `0x${string}` {
  return getAddress(
    explicit ?? env('ERC8004_REPUTATION_REGISTRY') ?? getNetwork(network).erc8004.reputationRegistry
  )
}

/** ERC-8004 Identity Registry: explicit → ERC8004_IDENTITY_REGISTRY → canonical. */
export function resolveIdentityRegistry(network: ChainPeNetwork, explicit?: string): `0x${string}` {
  return getAddress(
    explicit ?? env('ERC8004_IDENTITY_REGISTRY') ?? getNetwork(network).erc8004.identityRegistry
  )
}

/** PolicyVault: explicit → POLICY_VAULT_ADDRESS → built-in default, or undefined. */
export function resolvePolicyVault(network: ChainPeNetwork, explicit?: string): `0x${string}` | undefined {
  const candidate = explicit ?? env('POLICY_VAULT_ADDRESS') ?? getNetwork(network).policyVault
  return candidate ? getAddress(candidate) : undefined
}

export function explorerTxUrl(network: ChainPeNetwork, txHash: string): string {
  return `${getNetwork(network).explorer}/tx/${txHash}`
}

export function explorerAddressUrl(network: ChainPeNetwork, address: string): string {
  return `${getNetwork(network).explorer}/address/${address}`
}

/** Accepts a private key with or without the 0x prefix. */
export function normalizeKey(key: string): `0x${string}` {
  return (key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`
}
