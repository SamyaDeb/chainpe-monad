/**
 * ChainPe provider types (Monad).
 *
 * Payment gating uses USDC via the x402 v2 "exact" scheme (EIP-3009
 * transferWithAuthorization). Prices are human-readable USDC, e.g. "0.01".
 */

import type { ChainPeNetwork } from "./chains.js";

export type { ChainPeNetwork } from "./chains.js";

// x402 "exact" on EVM settles in USDC. MON is only used for gas (paid by the
// facilitator), never as a payment-gating token.
export type PaymentToken = "USDC";

export interface ChainPeConfig {
  // Service identity
  serviceName: string;
  serviceDescription: string;
  tags: string[];

  // Backend target
  targetUrl: string;

  // Pricing
  pricePerRequest: string; // Human-readable USDC, e.g. "0.01"
  paymentToken: PaymentToken;

  // Wallet (0x address that receives payments)
  walletAddress: string;

  // Server
  proxyPort: number;

  // Network
  network: ChainPeNetwork;

  // Deployed ChainPeRegistry contract address (0x...)
  registryAddress?: string;

  // ERC-8004 agent identity for this service. When set, the proxy advertises it
  // on 402 responses so consumers can leave reputation feedback without
  // scanning the registry. Override via CHAINPE_AGENT_ID.
  agentId?: string;

  // x402 facilitator URL (verifies + settles payments, pays gas).
  facilitatorUrl?: string;

  // Mandate mode (`chainpe-vault`): also accept payments made BY a buyer's
  // PolicyVault, so the buyer's on-chain caps + allowlist apply to every call.
  // Default: on when the facilitator's /supported lists chainpe-vault.
  acceptVault?: boolean;
  // Facilitator for chainpe-vault when it differs from facilitatorUrl
  // (e.g. exact via Monad's public facilitator, vault via ChainPe's).
  // Override via CHAINPE_VAULT_FACILITATOR_URL.
  vaultFacilitatorUrl?: string;
  // PolicyVault named in vault offers. Default: the one the facilitator advertises.
  policyVault?: string;

  // Optional settings
  logLevel?: "verbose" | "normal" | "quiet";
  adminKey?: string;
}

export interface RouteConfig {
  path: string;
  pricePerRequest: string; // Human-readable USDC
  paymentToken: PaymentToken;
  description?: string;
}

export interface RequestStats {
  totalRequests: number;
  paidRequests: number;
  failedPayments: number;
  totalRevenue: bigint; // atomic USDC (6 decimals)
  revenueByToken: Record<PaymentToken, bigint>;
  requestsPerMinute: number[];
  lastHourRequests: number;
}

export interface PaymentEvent {
  timestamp: Date;
  path: string;
  amount: string;
  token: PaymentToken;
  payer: string;
  txId?: string;
  success: boolean;
  error?: string;
}

export type LogLevel = "verbose" | "normal" | "quiet";

export interface Logger {
  verbose: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  success: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}
