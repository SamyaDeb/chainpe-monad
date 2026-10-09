/**
 * ChainPe proxy server (Monad)
 *
 * x402 v2 payment gateway built on `@x402/express`. Every proxied request is
 * gated by a USDC payment (EIP-3009) on Monad; once the facilitator has verified
 * and settled it, the request is forwarded to the provider's backend. The
 * backend never sees keys, USDC or x402 headers.
 */

import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { createProxyMiddleware, type Options as ProxyOptions } from "http-proxy-middleware";
import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import type { FacilitatorClient } from "@x402/core/server";
import { decodePaymentResponseHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/server";

import type { ChainPeConfig, PaymentEvent, RouteConfig } from "../types.js";
import { getNetwork } from "../chains.js";
import { createRoutesConfig, formatRoutesForDisplay } from "./routeConfig.js";
import { analytics } from "./analytics.js";
import { logger, logPayment, logRequest, logServerStart } from "../logger.js";

export interface ProxyServerOptions {
  config: ChainPeConfig;
  additionalRoutes?: RouteConfig[];
  onPayment?: (event: PaymentEvent) => void;
  /** Override the facilitator client (tests, in-process facilitators). */
  facilitatorClient?: FacilitatorClient;
}

/** Facilitator to use when none is configured (Monad's public testnet facilitator). */
export const DEFAULT_TESTNET_FACILITATOR = "https://x402-facilitator.molandak.org";

export function resolveFacilitatorUrl(config: ChainPeConfig): string | undefined {
  return (
    config.facilitatorUrl ??
    process.env.CHAINPE_FACILITATOR_URL ??
    (config.network === "monad-testnet" ? DEFAULT_TESTNET_FACILITATOR : undefined)
  );
}

export function createProxyServer(options: ProxyServerOptions): Express {
  const { config, additionalRoutes, onPayment } = options;
  const net = getNetwork(config.network);
  const app = express();

  app.use(cors({ exposedHeaders: ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE", "X-CHAINPE-AGENT-ID"] }));

  // Request logging / counting (raw — no body parsing, so proxying is unaffected).
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    analytics.recordRequest();
    res.on("finish", () => logRequest(req.method, req.path, res.statusCode, Date.now() - start));
    next();
  });

  // Health check (not gated).
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", service: config.serviceName, network: config.network, uptime: process.uptime() });
  });

  // Admin endpoints (JSON-parsed, optionally key-protected) — not gated.
  const adminRouter = express.Router();
  adminRouter.use(express.json());
  if (config.adminKey) {
    adminRouter.use((req: Request, res: Response, next: NextFunction) => {
      const apiKey = req.headers["x-admin-key"];
      if (apiKey !== config.adminKey) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      next();
    });
  }
  adminRouter.get("/stats", (_req: Request, res: Response) => {
    res.json({ ...analytics.getStats(), revenue: analytics.getRevenueSummary(), totalRevenue: undefined, revenueByToken: undefined });
  });
  adminRouter.get("/payments", (_req: Request, res: Response) => res.json(analytics.getRecentPayments()));
  adminRouter.get("/config", (_req: Request, res: Response) => {
    res.json({
      serviceName: config.serviceName,
      serviceDescription: config.serviceDescription,
      targetUrl: config.targetUrl,
      pricePerRequest: config.pricePerRequest,
      paymentToken: config.paymentToken,
      walletAddress: config.walletAddress,
      network: config.network,
      tags: config.tags,
    });
  });
  // Pass-through: fetch /schema from the backend so agents can self-describe
  // their routes without going through the payment gate.
  adminRouter.get("/schema", async (_req: Request, res: Response) => {
    try {
      const r = await fetch(`${config.targetUrl}/schema`);
      if (!r.ok) { res.status(404).json({ error: "Agent has no /schema endpoint" }); return; }
      res.json(await r.json());
    } catch {
      res.status(503).json({ error: "Backend unreachable" });
    }
  });
  app.use("/chainpe-admin", adminRouter);

  // Resolve the facilitator.
  const facilitatorUrl = resolveFacilitatorUrl(config);
  let facilitatorClient = options.facilitatorClient;
  if (!facilitatorClient) {
    if (!facilitatorUrl) {
      throw new Error(
        `No facilitator configured for ${config.network}. Set facilitatorUrl in the config or CHAINPE_FACILITATOR_URL.`
      );
    }
    facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });
    logger.info(`Using facilitator: ${facilitatorUrl}`);
  }

  // Advertise this provider's ERC-8004 agentId on every response so consumers
  // can leave payment-backed reputation feedback (it is also in each offer's `extra`).
  const advertisedAgentId = config.agentId ?? process.env.CHAINPE_AGENT_ID;
  if (advertisedAgentId && advertisedAgentId !== "0") {
    app.use((_req: Request, res: Response, next: NextFunction) => {
      res.setHeader("X-CHAINPE-AGENT-ID", advertisedAgentId);
      next();
    });
  }

  // x402 routes.
  const routesConfig = createRoutesConfig(config, additionalRoutes);
  logger.info("Configured x402 routes:");
  for (const r of formatRoutesForDisplay(routesConfig)) {
    logger.info(`  ${r.path} → ${r.price} ${r.token} (${net.caip2})`);
  }

  // Payment tracking — record settlements. The middleware sets PAYMENT-RESPONSE
  // on successful paid responses; read it when the response finishes.
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.on("finish", () => {
      const header = res.getHeader("PAYMENT-RESPONSE");
      if (header && res.statusCode < 400) {
        let payer = "unknown";
        let txId: string | undefined;
        try {
          const settle = decodePaymentResponseHeader(String(header));
          payer = settle.payer ?? "unknown";
          txId = settle.transaction || undefined;
        } catch {
          /* header not decodable — ignore */
        }
        const event: PaymentEvent = {
          timestamp: new Date(),
          path: req.path,
          amount: config.pricePerRequest,
          token: config.paymentToken,
          payer,
          txId,
          success: true,
        };
        analytics.recordPayment(event);
        logPayment(event.amount, event.token, payer, req.path);
        onPayment?.(event);
      }
    });
    next();
  });

  // Payment middleware (gates everything after it).
  const resourceServer = new x402ResourceServer(facilitatorClient).register(net.caip2, new ExactEvmScheme());
  app.use(paymentMiddleware(routesConfig, resourceServer));

  // Reverse proxy to the provider backend.
  const proxyOptions: ProxyOptions = {
    target: config.targetUrl,
    changeOrigin: true,
    ws: true,
    on: {
      proxyReq: (proxyReq, req) => {
        // The backend must never see x402 payment material.
        for (const h of ["payment-signature", "x-payment", "payment-required"]) proxyReq.removeHeader(h);
        logger.verbose(`Proxying ${req.method} ${req.url} → ${config.targetUrl}`);
      },
      proxyRes: (proxyRes, req) => logger.verbose(`Response ${config.targetUrl}${req.url}: ${proxyRes.statusCode}`),
      error: (err, _req, res) => {
        logger.error(`Proxy error: ${err.message}`);
        if (res && "writeHead" in res && typeof (res as Response).status === "function") {
          (res as Response).status(502).json({ error: "Bad Gateway", message: "Failed to reach upstream server" });
        }
      },
    },
  };
  app.use("/", createProxyMiddleware(proxyOptions));

  return app;
}

export async function startProxyServer(
  options: ProxyServerOptions
): Promise<{ app: Express; server: ReturnType<Express["listen"]> }> {
  const { config } = options;
  const app = createProxyServer(options);
  return new Promise((resolve) => {
    const server = app.listen(config.proxyPort, () => {
      logServerStart(config.proxyPort, config.serviceName);
      resolve({ app, server });
    });
  });
}

export { analytics };
