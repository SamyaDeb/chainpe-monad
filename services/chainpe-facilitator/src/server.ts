/**
 * ChainPe x402 Facilitator — standalone, non-custodial settlement service.
 *
 * Implements the x402 facilitator HTTP contract (`/verify`, `/settle`,
 * `/supported`) for USDC (EIP-3009) payments on Avalanche. Point a ChainPe
 * provider proxy at it with `CHAINPE_FACILITATOR_URL`.
 *
 * NON-CUSTODIAL: the facilitator key only pays gas and relays the payer's
 * already-signed `transferWithAuthorization`. It never holds user funds and
 * cannot move money the payer did not authorize.
 *
 * Env:
 *   FACILITATOR_PRIVATE_KEY  (required) gas-paying key that submits settlements
 *   NETWORK                  "fuji" | "avalanche"  (default: fuji)
 *   RPC_URL                  optional RPC override
 *   PORT                     HTTP port (Railway injects this)
 *   ALLOWED_ORIGINS          comma-separated list of allowed CORS origins
 *                            (default: deny all cross-origin browser requests)
 */
import "dotenv/config";
import express, { type Request, type Response } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import pino from "pino";
import {
  createPublicClient,
  createWalletClient,
  http,
  publicActions,
  formatEther,
  type PublicClient,
  type WalletClient,
} from "viem";
import { avalanche, avalancheFuji } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { verify, settle } from "x402/facilitator";
import { PaymentPayloadSchema, PaymentRequirementsSchema } from "x402/types";

const log = pino({ level: process.env.LOG_LEVEL ?? "info" });

type Network = "fuji" | "avalanche";

const NETWORK = (process.env.NETWORK === "avalanche" ? "avalanche" : "fuji") as Network;
const X402_NETWORK = NETWORK === "avalanche" ? "avalanche" : "avalanche-fuji";
const CHAIN = NETWORK === "avalanche" ? avalanche : avalancheFuji;
const RPC_URL =
  process.env.RPC_URL ??
  (NETWORK === "avalanche"
    ? "https://api.avax.network/ext/bc/C/rpc"
    : "https://api.avax-test.network/ext/bc/C/rpc");
const PORT = parseInt(process.env.PORT ?? "4500", 10);

const rawKey = process.env.FACILITATOR_PRIVATE_KEY;
if (!rawKey) {
  log.fatal("FACILITATOR_PRIVATE_KEY is required (gas-paying settlement key).");
  process.exit(1);
}
const account = privateKeyToAccount((rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`);

const publicClient: PublicClient = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });
// settle() calls verify() which needs public actions (verifyTypedData) too.
const walletClient: WalletClient = createWalletClient({
  account,
  chain: CHAIN,
  transport: http(RPC_URL),
}).extend(publicActions) as unknown as WalletClient;

// ─── Rate limiter: 60 requests / minute per IP ──────────────────────────────

const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limit_exceeded" },
});

// ─── CORS config ────────────────────────────────────────────────────────────

function buildCorsOptions() {
  const raw = process.env.ALLOWED_ORIGINS ?? "";
  const origins = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    // No origins configured → deny all browser cross-origin requests.
    // Server-to-server calls (no Origin header) still work fine.
    return cors({ origin: false });
  }
  return cors({ origin: origins, credentials: true });
}

// ─── In-memory Prometheus-style counters ────────────────────────────────────
// Intentionally simple: no external dep. Reset on process restart (acceptable
// for a single-instance Railway service — use Railway metrics for persistence).
const counters = {
  verify_success: 0,
  verify_error: 0,
  settle_success: 0,
  settle_error: 0,
};

// ─── Background gas-balance cache (refreshes every 60 s) ────────────────────
// Module-level so both /health and /metrics can read it without live RPC.
let cachedGasBalance: bigint | null = null;
const LOW_GAS_THRESHOLD = 5n * 10n ** 16n; // 0.05 AVAX

async function refreshGasBalance() {
  try {
    cachedGasBalance = await publicClient.getBalance({ address: account.address });
  } catch {
    // Keep stale value on transient RPC errors; warn but don't crash.
  }
}
void refreshGasBalance();
setInterval(() => { void refreshGasBalance(); }, 60_000);

export function createApp() {
  const app = express();
  app.use(buildCorsOptions());
  // Reduced from 1 MB — x402 payloads are well under 10 KB.
  app.use(express.json({ limit: "50kb" }));

  app.get("/", (_req: Request, res: Response) => {
    res.json({
      service: "chainpe-facilitator",
      description: "Non-custodial x402 verify + settle for USDC on Avalanche.",
      network: NETWORK,
      custodial: false,
      endpoints: ["/health", "/status", "/supported", "/metrics", "/verify", "/settle"],
    });
  });

  // Liveness probe — always 200 while the process is running.
  // Gas warnings are in /status so Railway doesn't crash-loop on low balance.
  app.get("/health", (_req: Request, res: Response) => {
    const lowGas = cachedGasBalance !== null && cachedGasBalance < LOW_GAS_THRESHOLD;
    if (lowGas) {
      log.warn(
        { facilitator: account.address, gasBalanceAvax: formatEther(cachedGasBalance!) },
        "health check: AVAX balance critically low — top up required"
      );
    }
    res.json({
      status: lowGas ? "degraded" : "ok",
      service: "chainpe-facilitator",
      network: NETWORK,
      x402Network: X402_NETWORK,
      facilitator: account.address,
      custodial: false,
      ...(lowGas ? { warning: "low_gas" } : {}),
    });
  });

  // Operational status incl. the gas balance (reads the chain — use sparingly).
  app.get("/status", async (_req: Request, res: Response) => {
    const balance = await publicClient
      .getBalance({ address: account.address })
      .catch(() => null);
    res.json({
      service: "chainpe-facilitator",
      network: NETWORK,
      x402Network: X402_NETWORK,
      facilitator: account.address,
      gasBalanceAvax: balance != null ? formatEther(balance) : "unavailable",
      lowGas: balance != null ? balance < 10n ** 16n : null,
    });
  });

  app.get("/supported", (_req: Request, res: Response) => {
    res.json({ kinds: [{ x402Version: 1, scheme: "exact", network: X402_NETWORK }] });
  });

  // Prometheus text-format metrics — scrape with Railway metrics or an external
  // Prometheus instance. Counters reset on restart; use Railway's built-in
  // service metrics for long-term trends.
  app.get("/metrics", (_req: Request, res: Response) => {
    const gasAvax = cachedGasBalance !== null ? Number(formatEther(cachedGasBalance)) : 0;
    const lines = [
      "# HELP chainpe_verify_total Total /verify requests handled",
      "# TYPE chainpe_verify_total counter",
      `chainpe_verify_total{result="success"} ${counters.verify_success}`,
      `chainpe_verify_total{result="error"} ${counters.verify_error}`,
      "# HELP chainpe_settle_total Total /settle requests handled",
      "# TYPE chainpe_settle_total counter",
      `chainpe_settle_total{result="success"} ${counters.settle_success}`,
      `chainpe_settle_total{result="error"} ${counters.settle_error}`,
      "# HELP chainpe_gas_balance_avax Current gas key AVAX balance",
      "# TYPE chainpe_gas_balance_avax gauge",
      `chainpe_gas_balance_avax{network="${NETWORK}",facilitator="${account.address}"} ${gasAvax}`,
    ].join("\n") + "\n";
    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.send(lines);
  });

  app.post("/verify", apiLimiter, async (req: Request, res: Response) => {
    try {
      const payload = PaymentPayloadSchema.parse(req.body.paymentPayload);
      const requirements = PaymentRequirementsSchema.parse(req.body.paymentRequirements);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await verify(publicClient as any, payload, requirements);
      counters.verify_success++;
      log.info({ event: "verify", isValid: result.isValid }, "verify");
      res.json(result);
    } catch (err) {
      counters.verify_error++;
      log.error({ event: "verify_error", err }, "verify failed");
      res.status(400).json({ isValid: false, invalidReason: "verify_failed" });
    }
  });

  app.post("/settle", apiLimiter, async (req: Request, res: Response) => {
    try {
      const payload = PaymentPayloadSchema.parse(req.body.paymentPayload);
      const requirements = PaymentRequirementsSchema.parse(req.body.paymentRequirements);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await settle(walletClient as any, payload, requirements);
      counters.settle_success++;
      log.info(
        { event: "settle", success: result.success, transaction: (result as Record<string, unknown>).transaction },
        "settle"
      );
      res.json(result);
    } catch (err) {
      counters.settle_error++;
      log.error({ event: "settle_error", err }, "settle failed");
      res.status(400).json({
        success: false,
        errorReason: "settle_failed",
        transaction: "",
        network: X402_NETWORK,
      });
    }
  });

  return app;
}

async function main() {
  const balance = await publicClient.getBalance({ address: account.address }).catch(() => 0n);
  createApp().listen(PORT, () => {
    log.info(
      { network: NETWORK, x402Network: X402_NETWORK, facilitator: account.address, gasBalanceAvax: formatEther(balance) },
      `ChainPe facilitator listening on :${PORT}`
    );
    if (balance < 10n ** 16n) {
      log.warn("Low AVAX balance — top up the facilitator so it can pay settlement gas.");
    }
  });
}

// Only auto-start when run directly (not when imported by tests).
if (process.env.NODE_ENV !== "test") {
  main().catch((e) => {
    log.fatal(e, "fatal startup error");
    process.exit(1);
  });
}
