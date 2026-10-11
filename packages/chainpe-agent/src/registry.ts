/**
 * ChainPe Agent Registry Client (Monad, read-only)
 *
 * Wraps the SDK's on-chain ChainPeRegistry reader. Registry address priority:
 *   1. explicit constructor arg
 *   2. CHAINPE_REGISTRY_ADDRESS environment variable
 *   3. registryAddress field in ~/.chainpe/agent.json
 *   4. the SDK's deployed address for the network
 */

import fs from "fs";
import path from "path";
import os from "os";
import {
  DEFAULT_NETWORK,
  RegistryClient as SdkRegistryClient,
  filterServices as sdkFilterServices,
  resolveRegistryAddress,
  type ChainPeService,
} from "@chainpemonad/sdk";
import type { Registry, ServiceInfo, PaymentToken, AgentConfig, ChainPeNetwork } from "./types.js";

function readAddressFromConfig(): string | undefined {
  try {
    const configPath = path.join(os.homedir(), ".chainpe", "agent.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as AgentConfig;
    return config.registryAddress || undefined;
  } catch {
    return undefined;
  }
}

// ============================================================================
// Search
// ============================================================================

export interface SearchOptions {
  name?: string;
  tags?: string[];
  paymentToken?: PaymentToken;
  network?: ChainPeNetwork;
  maxPrice?: string;
}

function filterServices(services: ServiceInfo[], options: SearchOptions): ServiceInfo[] {
  let results = sdkFilterServices(services as ChainPeService[], { query: options.name, tags: options.tags, maxPrice: options.maxPrice }) as ServiceInfo[];
  if (options.paymentToken) results = results.filter((s) => s.paymentToken === options.paymentToken);
  if (options.network) results = results.filter((s) => s.network === options.network);
  return results;
}

// ============================================================================
// RegistryClient — on-chain reads
// ============================================================================

export class RegistryClient {
  private readonly network: ChainPeNetwork;
  private readonly address: `0x${string}`;
  private readonly reader: SdkRegistryClient;

  constructor(network: ChainPeNetwork = DEFAULT_NETWORK, registryAddress?: string) {
    this.network = network;
    this.address = resolveRegistryAddress(
      network,
      registryAddress || process.env.CHAINPE_REGISTRY_ADDRESS || readAddressFromConfig()
    );
    this.reader = new SdkRegistryClient(network, this.address);
  }

  getAddress(): string {
    return this.address;
  }

  /** Lists ALL services via the paginated on-chain view. */
  async listAllServices(): Promise<ServiceInfo[]> {
    return this.reader.listAllServices();
  }

  /** A developer's service by name, or undefined. */
  async findService(developerAddress: string, name: string): Promise<ServiceInfo | undefined> {
    const all = await this.listAllServices();
    return all.find(
      (s) => s.developer?.toLowerCase() === developerAddress.toLowerCase() && s.name.toLowerCase() === name.toLowerCase()
    );
  }

  /** Finds a service by name across all developers (a developer hint is preferred when given). */
  async findByName(name: string, developerAddress?: string): Promise<ServiceInfo | undefined> {
    const all = await this.listAllServices();
    const byName = all.filter((s) => s.name.toLowerCase() === name.toLowerCase());
    if (developerAddress) {
      const mine = byName.find((s) => s.developer?.toLowerCase() === developerAddress.toLowerCase());
      if (mine) return mine;
    }
    return byName[0];
  }

  async getService(developerAddress: string, name: string): Promise<ServiceInfo | undefined> {
    return this.findService(developerAddress, name);
  }

  async search(options: SearchOptions = {}): Promise<ServiceInfo[]> {
    const all = await this.listAllServices();
    return filterServices(all, { ...options, network: options.network ?? this.network });
  }
}

// ============================================================================
// Helpers (registry-as-data)
// ============================================================================

/** Loads all on-chain services into a Registry object (empty when unreachable). */
export async function loadRegistry(
  network: ChainPeNetwork = DEFAULT_NETWORK,
  registryAddress?: string
): Promise<Registry> {
  try {
    const client = new RegistryClient(network, registryAddress);
    return { version: "1.0.0", services: await client.listAllServices() };
  } catch {
    return { version: "1.0.0", services: [] };
  }
}

export function searchServices(registry: Registry, options: SearchOptions = {}): ServiceInfo[] {
  return filterServices(registry.services, options);
}

export function findServiceByName(registry: Registry, name: string): ServiceInfo | undefined {
  return registry.services.find((s) => s.name.toLowerCase() === name.toLowerCase());
}

export function findServiceById(registry: Registry, id: string): ServiceInfo | undefined {
  return registry.services.find((s) => s.id === id);
}

export function getAllTags(registry: Registry): string[] {
  return Array.from(new Set(registry.services.flatMap((s) => s.tags.map((t) => t.toLowerCase())))).sort();
}

export async function registryExists(
  network: ChainPeNetwork = DEFAULT_NETWORK,
  registryAddress?: string
): Promise<boolean> {
  try {
    await new RegistryClient(network, registryAddress).listAllServices();
    return true;
  } catch {
    return false;
  }
}

export function getServiceStats(registry: Registry) {
  return {
    total: registry.services.length,
    byToken: { USDC: registry.services.length } as Record<PaymentToken, number>,
    byNetwork: registry.services.reduce(
      (acc, s) => {
        acc[s.network] = (acc[s.network] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    ),
  };
}
