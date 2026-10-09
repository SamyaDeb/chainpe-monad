/**
 * Monad network defaults shared by the deploy/ops scripts.
 * Keep in sync with packages/chainpe-sdk/src/networks.ts (see CLAUDE.md).
 */
import { ethers } from "hardhat";

export const MONAD_MAINNET = 143;
export const MONAD_TESTNET = 10143;

export interface MonadChainDefaults {
  name: "monad" | "monad-testnet";
  /** Circle USDC (6 decimals, EIP-3009). */
  usdc: string;
  /** Canonical ERC-8004 IdentityRegistry. */
  identityRegistry: string;
  explorer: string;
}

export const MONAD_DEFAULTS: Record<number, MonadChainDefaults> = {
  [MONAD_MAINNET]: {
    name: "monad",
    usdc: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
    identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    explorer: "https://monadvision.com",
  },
  [MONAD_TESTNET]: {
    name: "monad-testnet",
    usdc: "0x534b2f3A21130d7a60830c2Df862319e593943A3",
    // CREATE2 testnet address of the canonical ERC-8004 deployment — not yet
    // confirmed on Monad testnet; deploy.ts checks it has code before using it.
    identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    explorer: "https://testnet.monadvision.com",
  },
};

export function isMonadMainnet(chainId: number): boolean {
  return chainId === MONAD_MAINNET;
}

/** Returns the defaults for a Monad chain, or undefined for other chains (e.g. hardhat). */
export function monadDefaults(chainId: number): MonadChainDefaults | undefined {
  return MONAD_DEFAULTS[chainId];
}

/** True when `address` has contract code on the connected network. */
export async function hasCode(address: string): Promise<boolean> {
  const code = await ethers.provider.getCode(address);
  return code !== "0x";
}

/** Formats a native (MON) balance. */
export function formatMon(wei: bigint): string {
  return `${ethers.formatEther(wei)} MON`;
}
