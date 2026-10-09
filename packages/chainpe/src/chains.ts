/**
 * Monad network definitions — re-exported from the SDK, the single source of
 * truth (packages/chainpe-sdk/src/networks.ts).
 */
import {
  NETWORKS,
  USDC_DECIMALS,
  getNetwork as sdkGetNetwork,
  explorerTxUrl as sdkExplorerTxUrl,
  type ChainPeNetwork,
  type NetworkInfo
} from "@chainpeavax/sdk";

export type { ChainPeNetwork, NetworkInfo };
export { NETWORKS, USDC_DECIMALS };

export const getNetwork = sdkGetNetwork;
export const explorerTxUrl = sdkExplorerTxUrl;
