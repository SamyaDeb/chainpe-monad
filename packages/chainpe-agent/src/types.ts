/**
 * ChainPe Agent SDK Types
 * Types for the consumer-side AI agent with x402 v2 payment capabilities on Monad
 */

// ============================================================================
// LLM Configuration
// ============================================================================

export type LLMMode = "api" | "local";
export type LLMProvider = "openai" | "anthropic" | "gemini" | "groq" | "qwen";

export interface LLMConfig {
  mode?: LLMMode; // Defaults to "api" for backwards compatibility
  provider: LLMProvider;
  model: string;
  apiKey?: string; // Optional for local mode
  baseURL?: string; // Optional custom base URL (e.g., for Ollama)
}

// ============================================================================
// Network / Payment Configuration
// ============================================================================

import type { ChainPeNetwork } from "@chainpeavax/sdk";

/** Monad network (`monad` | `monad-testnet`) — defined once, in the SDK. */
export type { ChainPeNetwork };

// x402 "exact" on EVM settles in USDC.
export type PaymentToken = "USDC";

export interface WalletConfig {
  address: string; // EVM wallet address (0x), derived from the private key
  useKeychain?: boolean; // Whether the private key is stored in the OS keychain (default: true)
}

export interface PaymentConfig {
  preferredToken: PaymentToken;
  maxPricePerRequest?: string; // Optional spending limit
}

// ============================================================================
// Agent Configuration
// ============================================================================

export interface AgentConfig {
  llm: LLMConfig;
  wallet: WalletConfig;
  payment: PaymentConfig;
  registryPath?: string;
  network?: ChainPeNetwork;
  registryAddress?: string; // Deployed ChainPeRegistry contract address (0x)
  reputationRegistry?: string; // ERC-8004 Reputation Registry address (0x)
}

// ============================================================================
// Registry Types
// ============================================================================

export interface ServiceInfo {
  id: string;
  name: string;
  description: string;
  tags: string[];
  endpoint: string;
  pricePerRequest: string;
  paymentToken: PaymentToken;
  walletAddress: string;
  network: ChainPeNetwork;
  /** Registering developer (set for on-chain services). */
  developer?: string;
  agentId?: string; // ERC-8004 agent identity
  createdAt?: string;
  updatedAt?: string;
}

export interface Registry {
  version: string;
  services: ServiceInfo[];
}

// ============================================================================
// Payment Types
// ============================================================================

export interface PaymentReceipt {
  /** Settlement transaction hash, when the provider reported one. */
  txId?: string;
  /** MonadVision link for txId. */
  explorerUrl?: string;
  network?: ChainPeNetwork;
  amount: string;
  token: PaymentToken;
  recipient: string;
  timestamp: Date;
  service: string;
  path: string;
}

export interface PaymentSummary {
  totalSpent: Record<PaymentToken, string>;
  transactionCount: number;
  receipts: PaymentReceipt[];
}

// ============================================================================
// Task Types
// ============================================================================

export interface RunOptions {
  provider?: string; // Service name to use
  maxSteps?: number; // Max agentic loop iterations
  verbose?: boolean;
  onStep?: (step: StepInfo) => void;
  onPayment?: (receipt: PaymentReceipt) => void;
}

export interface StepInfo {
  stepNumber: number;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  text?: string;
  thinking?: string;
}

export interface TaskResult {
  text: string;
  success: boolean;
  steps: StepInfo[];
  payments: PaymentSummary;
  error?: string;
  duration: number;
}

// ============================================================================
// Tool Types
// ============================================================================

export interface ToolCallInfo {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResultInfo {
  name: string;
  result: unknown;
}

// ============================================================================
// HTTP Client Types
// ============================================================================

export interface HttpRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
}

export interface HttpResponse<T = unknown> {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: T;
  paid?: boolean;
  paymentReceipt?: PaymentReceipt;
}

// ============================================================================
// Constants — chain ids, RPCs, USDC and explorers live in @chainpeavax/sdk
// ============================================================================

export { USDC_DECIMALS } from "@chainpeavax/sdk";

export const DEFAULT_REGISTRY_PATH = "~/.chainpe/registry.json";
export const CONFIG_PATH = "~/.chainpe/agent.json";
