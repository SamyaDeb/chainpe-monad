/**
 * @chainpeavax/sdk — ChainPe for Monad: x402 USDC payments + payment-backed
 * ERC-8004 reputation for AI agents.
 *
 * Porting status: network configuration (Phase 1). The payment client,
 * registry, reputation and PolicyVault modules land in Phase 2
 * (see docs/MONAD-PLAN.md).
 */
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
export type { ChainPeNetwork, Caip2, NetworkInfo, UsdcInfo } from './networks.js'
