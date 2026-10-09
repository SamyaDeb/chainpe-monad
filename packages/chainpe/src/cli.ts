#!/usr/bin/env node

/**
 * ChainPe CLI — put any API behind x402 v2 USDC payments on Monad.
 *
 *   chainpe init        guided setup → ~/.chainpe/config.json
 *   chainpe start       x402 payment proxy in front of your API
 *   chainpe register    list the service in the on-chain registry
 *   chainpe fetch <url> pay-and-fetch as a consumer
 *   chainpe discover    find services ranked by reputation
 */

import "dotenv/config";
import { program } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { isAddress, getAddress } from "viem";
import {
  ChainPe,
  RegistryWriter,
  DEFAULT_NETWORK,
  isChainPeNetwork,
  resolveRegistryAddress,
  explorerTxUrl,
  explorerAddressUrl,
} from "@chainpeavax/sdk";

import type { ChainPeConfig, ChainPeNetwork } from "./types.js";
import { startProxyServer, resolveFacilitatorUrl } from "./proxy/index.js";
import { priceToAtomic } from "./proxy/routeConfig.js";
import { setLogLevel } from "./logger.js";

const CONFIG_DIR = path.join(os.homedir(), ".chainpe");
const CONFIG_FILE = process.env.CHAINPE_CONFIG ?? path.join(CONFIG_DIR, "config.json");
const VERSION = "3.0.0-monad.0";

// ─── config ──────────────────────────────────────────────────────────────────

async function loadConfig(): Promise<ChainPeConfig | null> {
  try {
    return JSON.parse(await fs.readFile(CONFIG_FILE, "utf-8")) as ChainPeConfig;
  } catch {
    return null;
  }
}

async function saveConfig(config: ChainPeConfig): Promise<void> {
  await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

async function requireConfig(): Promise<ChainPeConfig> {
  const config = await loadConfig();
  if (!config) {
    console.error(chalk.red(`No configuration found at ${CONFIG_FILE}. Run \`chainpe init\` first.`));
    process.exit(1);
  }
  return config;
}

function fail(message: string): never {
  console.error(chalk.red(message));
  process.exit(1);
}

function requireKey(explicit?: string): string {
  const key = explicit ?? process.env.CHAINPE_PRIVATE_KEY;
  if (!key) fail("A private key is required: set CHAINPE_PRIVATE_KEY (never pass keys on the command line).");
  return key;
}

function networkFrom(value: string | undefined, fallback: ChainPeNetwork = DEFAULT_NETWORK): ChainPeNetwork {
  const n = value ?? process.env.CHAINPE_NETWORK ?? process.env.NETWORK ?? fallback;
  if (!isChainPeNetwork(n)) fail(`Unknown network "${n}" — use monad or monad-testnet.`);
  return n;
}

// ─── init ────────────────────────────────────────────────────────────────────

async function runInit(): Promise<void> {
  p.intro(chalk.magenta.bold("ChainPe") + " — monetize an API on Monad");
  const existing = await loadConfig();

  const answers = await p.group(
    {
      targetUrl: () =>
        p.text({
          message: "Backend URL to put behind x402 payments",
          placeholder: "http://localhost:3000",
          initialValue: existing?.targetUrl ?? "http://localhost:3000",
          validate: v => (/^https?:\/\//.test(v) ? undefined : "Must start with http:// or https://"),
        }),
      serviceName: () =>
        p.text({ message: "Service name", initialValue: existing?.serviceName, validate: v => (v ? undefined : "Required") }),
      serviceDescription: () =>
        p.text({ message: "Description", initialValue: existing?.serviceDescription ?? "" }),
      tags: () => p.text({ message: "Tags (comma-separated)", initialValue: existing?.tags?.join(",") ?? "api" }),
      pricePerRequest: () =>
        p.text({
          message: "Price per request (USDC)",
          initialValue: existing?.pricePerRequest ?? "0.01",
          validate: v => {
            try {
              priceToAtomic(v);
            } catch (e) {
              return (e as Error).message;
            }
          },
        }),
      walletAddress: () =>
        p.text({
          message: "Wallet address that receives payments (0x…)",
          initialValue: existing?.walletAddress,
          validate: v => (isAddress(v) ? undefined : "Not a valid address"),
        }),
      network: () =>
        p.select({
          message: "Network",
          initialValue: existing?.network ?? DEFAULT_NETWORK,
          options: [
            { value: "monad-testnet", label: "Monad testnet (recommended to start)" },
            { value: "monad", label: "Monad mainnet (real USDC)" },
          ],
        }),
      proxyPort: () => p.text({ message: "Proxy port", initialValue: String(existing?.proxyPort ?? 4402) }),
    },
    { onCancel: () => (p.cancel("Cancelled."), process.exit(0)) }
  );

  const config: ChainPeConfig = {
    ...existing,
    serviceName: answers.serviceName,
    serviceDescription: answers.serviceDescription,
    tags: answers.tags.split(",").map(t => t.trim()).filter(Boolean),
    targetUrl: answers.targetUrl.replace(/\/$/, ""),
    pricePerRequest: answers.pricePerRequest,
    paymentToken: "USDC",
    walletAddress: getAddress(answers.walletAddress),
    proxyPort: Number(answers.proxyPort),
    network: answers.network as ChainPeNetwork,
  };
  await saveConfig(config);
  p.outro(`Saved ${CONFIG_FILE}. Next: ${chalk.cyan("chainpe start")}`);
}

// ─── start ───────────────────────────────────────────────────────────────────

async function runStart(opts: { port?: string; verbose?: boolean }): Promise<void> {
  const config = await requireConfig();
  if (opts.port) config.proxyPort = Number(opts.port);
  setLogLevel(opts.verbose ? "verbose" : config.logLevel ?? "normal");
  if (!resolveFacilitatorUrl(config)) {
    fail(
      `No facilitator for ${config.network}. Set CHAINPE_FACILITATOR_URL (or "facilitatorUrl" in ${CONFIG_FILE}) ` +
        "to a ChainPe facilitator — see services/chainpe-facilitator."
    );
  }
  await startProxyServer({ config });
  console.log(chalk.gray(`  Paid requests settle in USDC on ${config.network} to ${config.walletAddress}`));
}

// ─── register / deregister ───────────────────────────────────────────────────

async function runRegister(): Promise<void> {
  const config = await requireConfig();
  const registry = resolveRegistryAddress(config.network, config.registryAddress);
  const writer = new RegistryWriter(config.network, registry, requireKey());
  const endpoint = process.env.CHAINPE_PUBLIC_URL ?? `http://localhost:${config.proxyPort}`;
  if (/localhost|127\.0\.0\.1/.test(endpoint)) {
    console.log(chalk.yellow("! endpoint is local; set CHAINPE_PUBLIC_URL to the public URL of your proxy before registering for real."));
  }
  const spinner = p.spinner();
  spinner.start(`Registering "${config.serviceName}" on ${config.network}…`);
  try {
    const res = await writer.registerOrUpdate({
      name: config.serviceName,
      description: config.serviceDescription,
      tags: config.tags,
      endpoint,
      pricePerRequest: config.pricePerRequest,
      payTo: config.walletAddress,
      agentId: config.agentId,
    });
    spinner.stop(`${res.action} ✓`);
    console.log(`  tx ${explorerTxUrl(config.network, res.txHash)}`);
    console.log(`  registry ${explorerAddressUrl(config.network, registry)}`);
  } catch (err) {
    spinner.stop("failed");
    fail((err as Error).message);
  }
}

async function runDeregister(): Promise<void> {
  const config = await requireConfig();
  const registry = resolveRegistryAddress(config.network, config.registryAddress);
  const writer = new RegistryWriter(config.network, registry, requireKey());
  const tx = await writer.deregister(config.serviceName);
  console.log(`Deregistered "${config.serviceName}" — ${explorerTxUrl(config.network, tx)}`);
}

// ─── consumer commands ───────────────────────────────────────────────────────

async function runFetch(
  url: string,
  opts: { method?: string; header?: string[]; data?: string; key?: string; network?: string; max?: string; raw?: boolean }
): Promise<void> {
  const network = networkFrom(opts.network);
  const cp = new ChainPe({
    privateKey: requireKey(opts.key),
    network,
    maxPerCall: opts.max ?? "1",
    registryAddress: process.env.CHAINPE_REGISTRY_ADDRESS ?? "0x000000000000000000000000000000000000dEaD",
  });
  const headers: Record<string, string> = {};
  for (const h of opts.header ?? []) {
    const i = h.indexOf(":");
    if (i > 0) headers[h.slice(0, i).trim()] = h.slice(i + 1).trim();
  }
  const result = await cp.pay(url, { method: opts.method ?? "GET", headers, body: opts.data });
  if (opts.raw) {
    console.log(typeof result.data === "string" ? result.data : JSON.stringify(result.data, null, 2));
    return;
  }
  console.log(chalk.bold(`HTTP ${result.status}`));
  if (result.payment) {
    console.log(chalk.green(`Paid ${result.payment.amount} USDC → ${result.payment.recipient}`));
    if (result.payment.txHash) console.log(chalk.gray(`  ${explorerTxUrl(network, result.payment.txHash)}`));
  }
  console.log(typeof result.data === "string" ? result.data : JSON.stringify(result.data, null, 2));
}

async function runDiscover(
  query: string | undefined,
  opts: { network?: string; tag?: string[]; maxPrice?: string; json?: boolean }
): Promise<void> {
  const network = networkFrom(opts.network);
  // Discovery is read-only; any key works, so use a throwaway when none is set.
  const cp = new ChainPe({
    privateKey: process.env.CHAINPE_PRIVATE_KEY ?? "0x" + "11".repeat(32),
    network,
    registryAddress: process.env.CHAINPE_REGISTRY_ADDRESS,
  });
  const services = await cp.discover({ query, tags: opts.tag, maxPrice: opts.maxPrice });
  if (opts.json) return console.log(JSON.stringify(services, null, 2));
  if (services.length === 0) return console.log("No services found.");
  for (const s of services) {
    const rep = s.reputation?.score != null ? `⭐ ${s.reputation.score} (${s.reputation.count})` : "unrated";
    console.log(`${chalk.bold(s.name)}  ${chalk.green(`${s.pricePerRequest} USDC`)}  ${rep}\n  ${s.endpoint}\n  ${chalk.gray(s.description)}`);
  }
}

async function runStatus(): Promise<void> {
  const config = await loadConfig();
  console.log(`ChainPe ${VERSION}`);
  if (!config) return console.log(`No configuration (${CONFIG_FILE}). Run \`chainpe init\`.`);
  console.log(`  service   ${config.serviceName}`);
  console.log(`  backend   ${config.targetUrl}`);
  console.log(`  price     ${config.pricePerRequest} USDC / request`);
  console.log(`  payTo     ${config.walletAddress}`);
  console.log(`  network   ${config.network}`);
  console.log(`  facilitator ${resolveFacilitatorUrl(config) ?? chalk.yellow("not set")}`);
  console.log(`  agentId   ${config.agentId ?? "—"}`);
}

// ─── wiring ──────────────────────────────────────────────────────────────────

program.name("chainpe").version(VERSION).description("ChainPe — monetize any API with x402 USDC payments on Monad");
program.command("init").description("Create a ChainPe configuration").action(runInit);
program
  .command("start")
  .description("Start the x402 payment proxy")
  .option("-p, --port <port>", "Override the proxy port")
  .option("-v, --verbose", "Verbose logging")
  .action(runStart);
program.command("register").description("Register / update your service in the on-chain registry").action(runRegister);
program.command("deregister").description("Remove your service from the registry").action(runDeregister);
program.command("status").description("Show the current configuration").action(runStatus);
program
  .command("fetch <url>")
  .description("Fetch a URL as a consumer, auto-paying any x402 402 in USDC")
  .option("-X, --method <method>", "HTTP method (default GET)")
  .option("-H, --header <header...>", 'Request header "Key: Value" (repeatable)')
  .option("-d, --data <body>", "Request body")
  .option("-n, --network <network>", "monad | monad-testnet (default: $CHAINPE_NETWORK or monad-testnet)")
  .option("--max <usdc>", "Max USDC to pay for one call (default 1)")
  .option("--raw", "Print only the response body")
  .action(runFetch);
program
  .command("discover [query]")
  .description("Discover registered services ranked by reputation")
  .option("-n, --network <network>", "monad | monad-testnet")
  .option("--tag <tag...>", "Filter by tag (repeatable)")
  .option("--max-price <usdc>", "Maximum price per request in USDC")
  .option("--json", "Output raw JSON")
  .action(runDiscover);

program.parseAsync().catch(err => fail(err instanceof Error ? err.message : String(err)));
