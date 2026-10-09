/**
 * Wallet Module (Monad)
 *
 * Derives an EVM account from a private key and reads balances. Network
 * constants come from @chainpeavax/sdk; payments are signed by the SDK.
 *
 * SECURITY: Private keys are retrieved from the OS keychain, never stored in files.
 */

import { erc20Abi, formatUnits, parseUnits, getAddress, type PublicClient } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { DEFAULT_NETWORK, getUsdcAddress, normalizeKey, publicClientFor, USDC_DECIMALS } from "@chainpeavax/sdk";

import type { ChainPeNetwork } from "./types.js";
import { getPrivateKey } from "./keychain.js";

// ============================================================================
// Wallet Creation
// ============================================================================

export interface WalletInstance {
  address: string;
  /** viem account that signs x402 payments and feedback. */
  account: PrivateKeyAccount;
  network: ChainPeNetwork;
}

/** Creates a wallet instance from a private key for the given network. */
export async function createWalletFromPrivateKey(
  privateKey: string,
  network: ChainPeNetwork = DEFAULT_NETWORK
): Promise<WalletInstance> {
  const account = privateKeyToAccount(normalizeKey(privateKey));
  return { address: account.address, account, network };
}

/** Creates a wallet instance by retrieving the private key from the OS keychain. */
export async function createWalletFromAddress(
  address: string,
  network: ChainPeNetwork = DEFAULT_NETWORK
): Promise<WalletInstance> {
  const privateKey = await getPrivateKey(address);
  if (!privateKey) {
    throw new Error(
      `Wallet private key not found in OS keychain for address: ${address}\n` +
        `Run 'chainpe-agent init' to set up your wallet.`
    );
  }
  return createWalletFromPrivateKey(privateKey, network);
}

/** Derives the EVM address from a private key. */
export function addressFromPrivateKey(privateKey: string): string {
  return privateKeyToAccount(normalizeKey(privateKey)).address;
}

// ============================================================================
// Clients
// ============================================================================

export function createClient(network: ChainPeNetwork): PublicClient {
  return publicClientFor(network);
}

// ============================================================================
// Balances
// ============================================================================

export interface WalletBalance {
  mon: bigint; // wei (18 decimals)
  usdc: bigint; // atomic (6 decimals)
}

export async function getWalletBalance(address: string, network: ChainPeNetwork): Promise<WalletBalance> {
  const client = createClient(network);
  const addr = getAddress(address);
  const [mon, usdc] = await Promise.all([
    client.getBalance({ address: addr }),
    client.readContract({
      address: getUsdcAddress(network),
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [addr],
    }) as Promise<bigint>,
  ]);
  return { mon, usdc };
}

export function hasSufficientUsdc(balance: WalletBalance, amountAtomic: bigint): boolean {
  return balance.usdc >= amountAtomic;
}

// ============================================================================
// Formatting
// ============================================================================

/** Formats atomic USDC (6 decimals) to a human string. */
export function formatAmount(atomic: bigint, decimals: number = USDC_DECIMALS): string {
  return formatUnits(atomic, decimals);
}

/** Parses a human USDC string to atomic units. */
export function parseAmount(amount: string, decimals: number = USDC_DECIMALS): bigint {
  return parseUnits(amount, decimals);
}

export function formatBalance(balance: WalletBalance): { mon: string; usdc: string } {
  return {
    mon: formatUnits(balance.mon, 18),
    usdc: formatUnits(balance.usdc, USDC_DECIMALS),
  };
}
