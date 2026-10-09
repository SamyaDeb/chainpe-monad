import { DEFAULT_NETWORK, isChainPeNetwork, type ChainPeNetwork } from '@chainpeavax/sdk'
import type { AppConfig } from './types.js'
import { loadWalletConfig } from './wallet-store.js'

export const DEFAULT_MAX_PER_CALL = '0.10'
export const DEFAULT_MAX_PER_DAY = '20.00'

export function loadConfig(): AppConfig {
  return {
    ...buildState(),
    reload() {
      Object.assign(this, buildState())
    }
  }
}

/** A set, non-blank env var. Claude Desktop passes unset optional fields as "". */
function env(name: string): string | undefined {
  const value = process.env[name]
  return value && value.trim() !== '' ? value.trim() : undefined
}

/** Unknown / legacy network names fall back to testnet — never to mainnet. */
function normalizeNetwork(value: string | undefined): ChainPeNetwork {
  return isChainPeNetwork(value) ? value : DEFAULT_NETWORK
}

function positiveAmount(value: string | undefined, fallback: string): string {
  return value && /^\d+(\.\d{1,6})?$/.test(value) && Number(value) > 0 ? value : fallback
}

function buildState(): Omit<AppConfig, 'reload'> {
  const wallet = loadWalletConfig()

  const privateKey = env('CHAINPE_PRIVATE_KEY') ?? wallet?.privateKey ?? undefined
  const network = normalizeNetwork(env('NETWORK') ?? wallet?.network)
  const canPay = !!privateKey

  return {
    privateKey,
    network,
    registryAddress: env('CHAINPE_REGISTRY_ADDRESS') ?? wallet?.registryAddress ?? undefined,
    reputationRegistry: env('ERC8004_REPUTATION_REGISTRY') ?? wallet?.reputationRegistry ?? undefined,
    indexerUrl: env('CHAINPE_INDEXER_URL')?.replace(/\/+$/, ''),
    budget: {
      maxPerCall: positiveAmount(env('MAX_PER_CALL'), DEFAULT_MAX_PER_CALL),
      maxPerDay: positiveAmount(env('MAX_PER_DAY'), DEFAULT_MAX_PER_DAY)
    },
    canPay,
    mode: canPay ? 'MONAD' : 'READ_ONLY'
  }
}
