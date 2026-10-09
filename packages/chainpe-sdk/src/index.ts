/**
 * @chainpeavax/sdk — ChainPe for Monad: x402 v2 USDC payments + ERC-8004
 * reputation for AI agents.
 *
 * @example
 * ```ts
 * import { ChainPe } from '@chainpeavax/sdk'
 *
 * const cp = new ChainPe({ privateKey: process.env.PRIVATE_KEY!, network: 'monad-testnet' })
 * const res = await cp.fetch('https://api.example.com/paid')   // auto-pays the 402
 * console.log(await res.json())
 * ```
 */
export { ChainPe } from './chainpe.js'

export { paidFetch, checkOffer } from './payment.js'
export type { PaidRequest, PaidFetchOptions, OfferCheck } from './payment.js'

export { RegistryClient, filterServices, rankByReputation, decodeService } from './registry.js'
export type { RawService } from './registry.js'

export { getReputation, giveFeedback, summaryToScore } from './reputation.js'
export type { GiveFeedbackParams } from './reputation.js'

export { PolicyVaultClient } from './policyvault.js'
export type { PolicyVaultOptions, PolicyParams, SpendAuthorization } from './policyvault.js'

export {
  NETWORKS,
  DEFAULT_NETWORK,
  USDC_DECIMALS,
  isChainPeNetwork,
  getNetwork,
  networkFromChainId,
  networkFromCaip2,
  chainFor,
  rpcUrlFor,
  getUsdcAddress,
  getCaip2,
  publicClientFor,
  resolveRegistryAddress,
  resolveReputationRegistry,
  resolveIdentityRegistry,
  resolvePolicyVault,
  explorerTxUrl,
  explorerAddressUrl,
  normalizeKey
} from './networks.js'
export type { Caip2, NetworkInfo, UsdcInfo } from './networks.js'

export { ChainPePaymentError } from './types.js'
export type {
  ChainPeNetwork,
  ChainPeOptions,
  FetchOptions,
  ChainPeService,
  DiscoverOptions,
  ReputationSummary,
  RankedService,
  PaymentInfo,
  PaidResult,
  Balances
} from './types.js'
