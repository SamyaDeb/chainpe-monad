import type { ChainPeNetwork } from '@chainpemonad/sdk'

export type { ChainPeNetwork }

export interface BudgetConfig {
  /** Max USDC per payment (decimal string). */
  maxPerCall: string
  /** Max USDC per UTC day (decimal string). */
  maxPerDay: string
}

export interface AppConfig {
  privateKey?: string
  network: ChainPeNetwork
  registryAddress?: string
  reputationRegistry?: string
  /** Indexer REST API; when set, `search_bazaar` uses it instead of the chain. */
  indexerUrl?: string
  budget: BudgetConfig
  canPay: boolean
  mode: 'READ_ONLY' | 'MONAD'
  reload(): void
}

export interface WalletFileConfig {
  privateKey?: string
  network?: string
  registryAddress?: string
  reputationRegistry?: string
  createdAt?: string
}

export interface SpendingRecord {
  recipient: string
  amount: string
  network: string
  timestamp: string
  txHash?: string
}
