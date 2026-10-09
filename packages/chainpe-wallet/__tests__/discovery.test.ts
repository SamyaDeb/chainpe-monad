import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoverServices } from '../src/discovery.js'
import type { AppConfig } from '../src/types.js'

const config = (over: Partial<AppConfig> = {}): AppConfig => ({
  network: 'monad-testnet',
  budget: { maxPerCall: '0.1', maxPerDay: '1' },
  canPay: false,
  mode: 'READ_ONLY',
  reload: () => {},
  ...over
})

const svc = (name: string, price: string, tags: string[], score: number | null, count = 1) => ({
  id: `0xdev:${name}`,
  name,
  description: `${name} service`,
  tags,
  endpoint: `https://${name}.example`,
  pricePerRequest: price,
  paymentToken: 'USDC',
  walletAddress: '0x1111111111111111111111111111111111111111',
  network: 'monad-testnet',
  developer: '0xdev',
  agentId: '1',
  reputation: score === null ? null : { count, score }
})

afterEach(() => vi.restoreAllMocks())

describe('discoverServices', () => {
  it('uses the indexer API when CHAINPE_INDEXER_URL is set, ranked by reputation', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          total: 3,
          items: [svc('cheap', '0.001', ['weather'], null), svc('top', '0.05', ['weather'], 98), svc('mid', '0.01', ['news'], 70)]
        })
      )
    )
    const r = await discoverServices(config({ indexerUrl: 'https://idx.example' }), { query: 'x', maxPrice: '0.1' })
    expect(r.source).toBe('indexer https://idx.example')
    expect(r.services.map(s => s.name)).toEqual(['top', 'mid', 'cheap'])
    const url = new URL(String(fetchSpy.mock.calls[0][0]))
    expect(url.origin + url.pathname).toBe('https://idx.example/services')
    expect(url.searchParams.get('query')).toBe('x')
    expect(url.searchParams.get('maxPrice')).toBe('0.1')
  })

  it('applies the tags filter (match-any) to indexer results', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ items: [svc('a', '0.01', ['weather'], 80), svc('b', '0.01', ['news'], 90)] }))
    )
    const r = await discoverServices(config({ indexerUrl: 'https://idx.example' }), { tags: ['weather'] })
    expect(r.services.map(s => s.name)).toEqual(['a'])
  })

  it('falls back to the chain, and says so, when the indexer fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 503 }))
    // Mainnet has no registry deployed yet → the chain path reports that clearly.
    await expect(
      discoverServices(config({ network: 'monad', indexerUrl: 'https://idx.example' }), {})
    ).rejects.toThrow(/No ChainPe registry address/)
  })

  it('reads the chain (not the indexer) when no indexer is configured', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(discoverServices(config({ network: 'monad' }), {})).rejects.toThrow(/CHAINPE_REGISTRY_ADDRESS/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
