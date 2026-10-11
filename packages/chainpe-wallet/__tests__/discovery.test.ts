import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoverServices, isReachableEndpoint } from '../src/discovery.js'
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
  endpoint: `https://${name}.example.com`,
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

describe('unreachable endpoints', () => {
  it('classifies endpoints a remote caller can and cannot reach', () => {
    for (const ok of ['https://seller-production-ea9b.up.railway.app', 'https://api.example.com/x']) expect(isReachableEndpoint(ok), ok).toBe(true)
    for (const bad of ['http://localhost:4602', 'https://localhost', 'http://127.0.0.1:4604', 'https://10.0.0.5', 'https://192.168.1.2', 'https://172.20.0.1', 'https://chainpe.example/monad-weather', 'http://seller.up.railway.app', '', 'not a url', 'https://intranet'])
      expect(isReachableEndpoint(bad), bad).toBe(false)
    expect(isReachableEndpoint(null)).toBe(false)
  })

  it('hides localhost services by default, says how many, and can include them', async () => {
    const items = [{ ...svc('local', '0.001', ['price'], 90), endpoint: 'http://localhost:4602' }, svc('live', '0.001', ['price'], null)]
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ total: 2, items })))
    const cfg = config({ indexerUrl: 'https://idx.example' })
    const hiddenRun = await discoverServices(cfg, {})
    expect(hiddenRun.services.map(s => s.name)).toEqual(['live'])
    expect(hiddenRun.hidden).toBe(1)
    const all = await discoverServices(cfg, {}, true)
    expect(all.services.map(s => s.name).sort()).toEqual(['live', 'local'])
    expect(all.hidden).toBe(0)
  })
})
