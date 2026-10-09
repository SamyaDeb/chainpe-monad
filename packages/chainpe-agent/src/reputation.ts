/**
 * ERC-8004 Reputation on Monad — read scores + post feedback.
 *
 * Thin adapters over @chainpeavax/sdk (which targets the canonical ERC-8004
 * Reputation Registry for each Monad network), keeping this package's
 * call signatures. Self-feedback is rejected on-chain.
 */
import {
  getReputation as sdkGetReputation,
  giveFeedback as sdkGiveFeedback,
  resolveReputationRegistry as sdkResolveReputationRegistry,
  type ReputationSummary,
} from "@chainpeavax/sdk";
import type { ChainPeNetwork } from "./types.js";

export type { ReputationSummary };

/** explicit → ERC8004_REPUTATION_REGISTRY → canonical registry for the network. */
export function resolveReputationRegistry(network: ChainPeNetwork, explicit?: string): `0x${string}` {
  return sdkResolveReputationRegistry(network, explicit);
}

/** Reads a provider's on-chain reputation (count 0 when unscored, null when unknown). */
export async function getReputation(
  network: ChainPeNetwork,
  agentId: string,
  reputationRegistry?: string
): Promise<ReputationSummary | null> {
  return sdkGetReputation(network, resolveReputationRegistry(network, reputationRegistry), agentId);
}

/**
 * Posts receipt-backed feedback (0–100, valueDecimals 0) for an agent:
 * `paymentTxHash` is the x402 settlement tx being rated and becomes the
 * ERC-8004 feedbackHash. Returns the tx hash.
 */
export async function giveFeedback(
  privateKey: string,
  network: ChainPeNetwork,
  agentId: string,
  value: number,
  opts: { paymentTxHash: string; endpoint?: string; reputationRegistry?: string; waitConfirm?: boolean }
): Promise<string> {
  return sdkGiveFeedback(network, resolveReputationRegistry(network, opts.reputationRegistry), privateKey, {
    agentId,
    value,
    paymentTxHash: opts.paymentTxHash,
    endpoint: opts.endpoint,
    waitConfirm: opts.waitConfirm,
  });
}
