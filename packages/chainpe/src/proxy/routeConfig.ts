/**
 * Route configuration: builds the @x402/express v2 RoutesConfig from a
 * ChainPeConfig. Prices are exact USDC amounts on the configured Monad network.
 * A catch-all "/*" gates every proxied path; per-path overrides may be added.
 */
import type { RoutesConfig } from "@x402/core/server";
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

export function createRoutesConfig(
  config: ChainPeConfig,
  additionalRoutes?: ChainPeRouteConfig[]
): RoutesConfig {
  const net = getNetwork(config.network);
  // Advertise the provider's ERC-8004 agent id in each offer's `extra` so consumers
  // can leave payment-backed feedback without scanning the registry.
  const agentId = config.agentId ?? process.env.CHAINPE_AGENT_ID;
  const agentExtra = agentId && agentId !== "0" ? { agentId } : {};

  const build = (price: string, description?: string) => ({
    accepts: {
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
    },
    description: description ?? `Pay ${price} USDC per request`,
    serviceName: config.serviceName,
    tags: config.tags,
  });

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
