import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/keychain.js', () => ({ getPrivateKey: vi.fn(async () => null), savePrivateKey: vi.fn() }))

const { ChainPeAgent, QWEN_BASE_URL } = await import('../src/agent.js')
const { searchServices, getAllTags, findServiceByName } = await import('../src/registry.js')
const { resolveReputationRegistry } = await import('../src/reputation.js')
const { NETWORKS } = await import('@chainpemonad/sdk')

const llm = (provider: string, extra: Record<string, unknown> = {}) =>
  new ChainPeAgent({
    config: {
      llm: { mode: 'api', provider, model: 'qwen-plus', apiKey: 'test-key', ...extra },
      wallet: { address: '0xabc' },
      payment: { preferredToken: 'USDC' },
      network: 'monad-testnet'
    } as never
  })

describe('LLM providers', () => {
  it('builds a Qwen model through the OpenAI-compatible provider', () => {
    const model = (llm('qwen') as unknown as { createModel(): { provider: string; modelId: string } }).createModel()
    expect(model.modelId).toBe('qwen-plus')
    expect(model.provider).toMatch(/^qwen/)
    expect(QWEN_BASE_URL).toMatch(/^https:\/\//)
  })

  it('requires an API key in API mode', () => {
    const agent = llm('qwen', { apiKey: undefined }) as unknown as { createModel(): unknown }
    expect(() => agent.createModel()).toThrow(/apiKey/)
  })

  it('fails the run cleanly when the wallet is not in the keychain', async () => {
    const r = await llm('qwen').run('weather in London')
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/not found in OS keychain|registry address/)
  })
})

describe('registry helpers', () => {
  const svc = (name: string, tags: string[], price: string) => ({
    id: `0xdev:${name}`,
    name,
    description: `${name} data`,
    tags,
    endpoint: `https://${name}.example`,
    pricePerRequest: price,
    paymentToken: 'USDC' as const,
    walletAddress: '0x1111111111111111111111111111111111111111',
    network: 'monad-testnet' as const
  })
  const registry = { version: '1.0.0', services: [svc('Weather', ['weather'], '0.01'), svc('MonStats', ['monad', 'stats'], '0.05')] }

  it('searches by name, tag, network and price', () => {
    expect(searchServices(registry, { name: 'weather' }).map(s => s.name)).toEqual(['Weather'])
    expect(searchServices(registry, { tags: ['monad'] }).map(s => s.name)).toEqual(['MonStats'])
    expect(searchServices(registry, { maxPrice: '0.02' }).map(s => s.name)).toEqual(['Weather'])
    expect(searchServices(registry, { network: 'monad' })).toEqual([])
    expect(getAllTags(registry)).toEqual(['monad', 'stats', 'weather'])
    expect(findServiceByName(registry, 'monstats')?.name).toBe('MonStats')
  })
})

describe('reputation', () => {
  it('defaults to the canonical ERC-8004 registry on each Monad network', () => {
    expect(resolveReputationRegistry('monad-testnet')).toBe(NETWORKS['monad-testnet'].erc8004.reputationRegistry)
    expect(resolveReputationRegistry('monad')).toBe(NETWORKS.monad.erc8004.reputationRegistry)
  })
})
