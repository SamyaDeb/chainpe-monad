/**
 * Thin helpers over @chainpeavax/sdk's network module — the single source of
 * truth for Monad chain ids, RPCs, USDC and explorers. Nothing is duplicated here.
 */
import { erc20Abi, formatUnits, getAddress } from 'viem'
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { getUsdcAddress, normalizeKey, publicClientFor, USDC_DECIMALS } from '@chainpeavax/sdk'
import type { AppConfig, ChainPeNetwork } from './types.js'

export { USDC_DECIMALS }

export const NO_WALLET_MESSAGE = 'No wallet configured. Set the CHAINPE_PRIVATE_KEY environment variable.'

export function getAccount(config: AppConfig): PrivateKeyAccount {
  if (!config.privateKey) throw new Error(NO_WALLET_MESSAGE)
  return privateKeyToAccount(normalizeKey(config.privateKey))
}

export function getWalletAddress(config: AppConfig): string {
  return getAccount(config).address
}

/** USDC balance in human units, or `unavailable` when the RPC call fails. */
export async function getUsdcBalance(network: ChainPeNetwork, address: string): Promise<string> {
  try {
    const raw = (await publicClientFor(network).readContract({
      address: getUsdcAddress(network),
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [getAddress(address)]
    })) as bigint
    return formatUnits(raw, USDC_DECIMALS)
  } catch {
    return 'unavailable'
  }
}

/** Native MON balance in human units, or `unavailable` when the RPC call fails. */
export async function getMonBalance(network: ChainPeNetwork, address: string): Promise<string> {
  try {
    const wei = await publicClientFor(network).getBalance({ address: getAddress(address) })
    return formatUnits(wei, 18)
  } catch {
    return 'unavailable'
  }
}

/**
 * Monad bills gas on the gas LIMIT, not gas used, so transactions are sent with
 * the node's estimate plus a small margin instead of a generous default.
 */
export function tightGas(estimate: bigint): bigint {
  return (estimate * 110n) / 100n
}
