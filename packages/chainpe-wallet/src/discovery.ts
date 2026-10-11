/**
 * Service discovery for search_bazaar: the ChainPe indexer API when
 * CHAINPE_INDEXER_URL is set (fast, includes reputation), otherwise the
 * on-chain ChainPeRegistry read through the SDK.
 */
import {
  RegistryClient,
  filterServices,
  getReputation,
  rankByReputation,
  resolveRegistryAddress,
  resolveReputationRegistry,
  type DiscoverOptions,
  type RankedService
} from '@chainpemonad/sdk'
import type { AppConfig } from './types.js'

export interface DiscoveryResult {
  services: RankedService[]
  source: string
  note?: string
}

async function fromIndexer(config: AppConfig, options: DiscoverOptions): Promise<RankedService[]> {
  const url = new URL(`${config.indexerUrl}/services`)
  url.searchParams.set('limit', '100')
  if (options.query) url.searchParams.set('query', options.query)
  if (options.maxPrice) url.searchParams.set('maxPrice', options.maxPrice)

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`indexer answered HTTP ${res.status}`)
  const body = (await res.json()) as { items?: RankedService[] }
  if (!Array.isArray(body.items)) throw new Error('indexer returned an unexpected payload')

  const items = body.items.map(s => ({ ...s, reputation: s.reputation ?? null }))
  // The indexer filters by query/price; tags (match-any) are applied here.
  return rankByReputation(filterServices(items, { tags: options.tags }) as RankedService[])
}

async function fromChain(config: AppConfig, options: DiscoverOptions): Promise<RankedService[]> {
  const registry = new RegistryClient(config.network, resolveRegistryAddress(config.network, config.registryAddress))
  const reputationRegistry = resolveReputationRegistry(config.network, config.reputationRegistry)
  const services = filterServices(await registry.listAllServices(), options)
  const ranked: RankedService[] = await Promise.all(
    services.map(async s => ({
      ...s,
      reputation: s.agentId ? await getReputation(config.network, reputationRegistry, s.agentId) : null
    }))
  )
  return rankByReputation(ranked)
}

export async function discoverServices(config: AppConfig, options: DiscoverOptions): Promise<DiscoveryResult> {
  if (config.indexerUrl) {
    try {
      return { services: await fromIndexer(config, options), source: `indexer ${config.indexerUrl}` }
    } catch (err) {
      // Fall through to the chain, and say so — never hide that the indexer was down.
      const reason = err instanceof Error ? err.message : String(err)
      const services = await fromChain(config, options)
      return {
        services,
        source: `on-chain registry ${resolveRegistryAddress(config.network, config.registryAddress)}`,
        note: `Indexer ${config.indexerUrl} failed (${reason}); used the on-chain registry instead.`
      }
    }
  }
  const address = resolveRegistryAddress(config.network, config.registryAddress)
  return { services: await fromChain(config, options), source: `on-chain registry ${address}` }
}
