/**
 * search_bazaar — discover x402-gated services registered in ChainPe, ranked by
 * ERC-8004 reputation. Uses the indexer when CHAINPE_INDEXER_URL is set, else
 * reads the ChainPeRegistry on Monad directly.
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '../types.js'
import { discoverServices } from '../discovery.js'
import { errMsg, fail, text } from './util.js'

export function registerBazaarSearch(server: McpServer, config: AppConfig): void {
  server.tool(
    'search_bazaar',
    'Discover x402-gated services registered on ChainPe (Monad). Returns each service with its description, ' +
      'price, tags, ERC-8004 reputation and endpoint URL, best-reputation first. To use a service, pass its ' +
      'endpoint to `x402_fetch` or `pay`, which handle the USDC payment.',
    {
      query: z.string().optional().describe('Optional keyword to filter by name, description, or tag (e.g. "weather")'),
      tags: z.array(z.string()).optional().describe('Optional list of tags to filter by (matches any)'),
      maxPrice: z.string().optional().describe('Optional maximum price per request as a decimal string, e.g. "0.05"')
    },
    async ({ query, tags, maxPrice }) => {
      try {
        const { services, source, note } = await discoverServices(config, { query, tags, maxPrice })

        if (services.length === 0) {
          const where = query ? ` matching "${query}"` : ''
          return text(`No ChainPe services found${where} on ${config.network} (source: ${source}).${note ? `\n${note}` : ''}`)
        }

        const list = services
          .map((s, i) => {
            const r = s.reputation
            let repLine = ''
            if (s.agentId) {
              repLine =
                r && r.count > 0 && r.score !== null
                  ? `  ·  ⭐ ${r.score.toFixed(0)}/100 (${r.count} review${r.count === 1 ? '' : 's'})`
                  : '  ·  ⭐ no ratings yet'
            }
            return (
              `${i + 1}. ${s.name} — ${s.description}\n` +
              `   Price: ${s.pricePerRequest} ${s.paymentToken}` +
              (s.tags.length ? `  ·  Tags: ${s.tags.join(', ')}` : '') +
              (s.agentId ? `  ·  Agent ID: ${s.agentId}` : '') +
              repLine +
              `\n   Endpoint: ${s.endpoint}`
            )
          })
          .join('\n\n')

        const header = query
          ? `Found ${services.length} ChainPe service(s) matching "${query}":`
          : `Found ${services.length} ChainPe service(s):`
        const footer =
          `\n\nNetwork: ${config.network}  ·  Source: ${source}` +
          (note ? `\n${note}` : '') +
          `\nHint: call x402_fetch (or pay) with a service's Endpoint to pay and fetch its result.`
        return text(`${header}\n\n${list}${footer}`)
      } catch (err) {
        return fail(`ChainPe service search failed: ${errMsg(err)}`)
      }
    }
  )
}
