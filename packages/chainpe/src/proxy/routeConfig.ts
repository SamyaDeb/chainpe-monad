/**
 * Route configuration: builds the @x402/express v2 RoutesConfig from a
 * ChainPeConfig. Prices are exact USDC amounts on the configured Monad network.
 * A catch-all "/*" gates every proxied path; per-path overrides may be added.
 *
 * With `vault`, each route offers two ways to pay the same price to the same
 * payTo: `exact` (the buyer's own USDC, EIP-3009) and `chainpe-vault` (the
 * buyer's PolicyVault pays; its caps and allowlist are enforced on-chain).
 */
import type { RoutesConfig } from "@x402/core/server";
import { VAULT_SCHEME } from "@chainpemonad/sdk";
import { parseUnits } from "viem";
import { getNetwork, USDC_DECIMALS } from "../chains.js";
import type { ChainPeConfig, RouteConfig as ChainPeRouteConfig } from "../types.js";

/** Converts a human USDC price ("0.01" or "$0.01") to atomic units ("10000"). */
export function priceToAtomic(price: string): string {
  const clean = price.trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{1,6})?$/.test(clean)) {
    throw new Error(`Invalid USDC price "${price}" (use up to 6 decimals, e.g. 0.01)`);
  }
  const atomic = parseUnits(clean, USDC_DECIMALS);
  if (atomic <= 0n) throw new Error(`Price must be greater than 0, got "${price}"`);
  return atomic.toString();
}

export interface RouteOptions {
  /** Also offer `chainpe-vault`. The vault address comes from the facilitator unless set here. */
  vault?: boolean | { address?: string };
}

export function createRoutesConfig(
  config: ChainPeConfig,
  additionalRoutes?: ChainPeRouteConfig[],
  options: RouteOptions = {}
): RoutesConfig {
  const net = getNetwork(config.network);
  // Advertise the provider's ERC-8004 agent id in each offer's `extra` so consumers
  // can leave payment-backed feedback without scanning the registry.
  const agentId = config.agentId ?? process.env.CHAINPE_AGENT_ID;
  const agentExtra = agentId && agentId !== "0" ? { agentId } : {};

  const vaultAddress =
    typeof options.vault === "object" ? options.vault.address ?? config.policyVault : config.policyVault;

  const route = (accepts: unknown, price: string, description?: string) => ({
    accepts,
    description: description ?? `Pay ${price} USDC per request`,
    serviceName: config.serviceName,
    tags: config.tags,
  });

  const build = (price: string, description?: string) => {
    const exact = {
      scheme: "exact",
      network: net.caip2,
      payTo: config.walletAddress,
      // Explicit asset amount: always Monad USDC, never a library default.
      price: {
        asset: net.usdc.address,
        amount: priceToAtomic(price),
        extra: { name: net.usdc.eip712Name, version: net.usdc.eip712Version, ...agentExtra },
      },
      maxTimeoutSeconds: 60,
    };
    if (!options.vault) return route(exact, price, description);
    const vault = {
      scheme: VAULT_SCHEME,
      network: net.caip2,
      payTo: config.walletAddress,
      // Same USDC amount; the vault + its EIP-712 domain are filled in from the
      // facilitator's /supported kind (unless pinned via `policyVault`).
      price: {
        asset: net.usdc.address,
        amount: priceToAtomic(price),
        extra: { ...(vaultAddress ? { vault: vaultAddress } : {}), ...agentExtra },
      },
      maxTimeoutSeconds: 60,
    };
    return route([exact, vault], price, description);
  };

  const routes: Record<string, ReturnType<typeof build>> = {};

  // Specific routes first.
  if (additionalRoutes) {
    for (const r of additionalRoutes) {
      routes[r.path] = build(r.pricePerRequest || config.pricePerRequest, r.description);
    }
  }

  // Catch-all: every path.
  routes["/*"] = build(config.pricePerRequest);

  return routes as unknown as RoutesConfig;
}

/** Human-readable summary of the configured routes for CLI display. */
export function formatRoutesForDisplay(
  routes: RoutesConfig
): Array<{ path: string; price: string; token: string }> {
  return Object.entries(routes as Record<string, { accepts: unknown }>).map(([path, cfg]) => {
    const accepts = Array.isArray(cfg.accepts) ? cfg.accepts[0] : cfg.accepts;
    const amount = (accepts as { price?: { amount?: string } })?.price?.amount ?? "0";
    return { path, price: (Number(amount) / 10 ** USDC_DECIMALS).toString(), token: "USDC" };
  });
}
