import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadConfig } from '../src/config.js'

vi.mock('../src/wallet-store.js', () => ({
  loadWalletConfig: vi.fn(() => null)
}))

const TEST_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

describe('loadConfig', () => {
  beforeEach(() => {
    for (const v of [
      'CHAINPE_PRIVATE_KEY',
      'NETWORK',
      'MAX_PER_CALL',
      'MAX_PER_DAY',
      'CHAINPE_REGISTRY_ADDRESS',
      'ERC8004_REPUTATION_REGISTRY',
      'CHAINPE_INDEXER_URL'
    ]) {
      delete process.env[v]
    }
  })

  it('returns READ_ONLY when no key is set', () => {
    const config = loadConfig()
    expect(config.mode).toBe('READ_ONLY')
    expect(config.canPay).toBe(false)
  })

  it('returns MONAD when a private key is set', () => {
    process.env.CHAINPE_PRIVATE_KEY = TEST_KEY
    const config = loadConfig()
    expect(config.mode).toBe('MONAD')
    expect(config.canPay).toBe(true)
  })

  it('defaults to monad-testnet', () => {
    expect(loadConfig().network).toBe('monad-testnet')
  })

  it('respects NETWORK=monad (mainnet is opt-in)', () => {
    process.env.NETWORK = 'monad'
    expect(loadConfig().network).toBe('monad')
  })

  it('falls back to testnet — never mainnet — for unknown NETWORK values', () => {
    for (const bad of ['ethereum', 'base-sepolia', 'algorand-testnet', 'eip155:143']) {
      process.env.NETWORK = bad
      expect(loadConfig().network).toBe('monad-testnet')
    }
  })

  it('reads registry addresses and the indexer URL from env', () => {
    process.env.CHAINPE_REGISTRY_ADDRESS = '0x1111111111111111111111111111111111111111'
    process.env.CHAINPE_INDEXER_URL = 'https://indexer.example/'
    const config = loadConfig()
    expect(config.registryAddress).toBe('0x1111111111111111111111111111111111111111')
    expect(config.indexerUrl).toBe('https://indexer.example')
  })

  it('treats blank env values (unset Claude Desktop fields) as unset', () => {
    process.env.NETWORK = ''
    process.env.CHAINPE_REGISTRY_ADDRESS = ''
    process.env.ERC8004_REPUTATION_REGISTRY = '  '
    process.env.CHAINPE_INDEXER_URL = ''
    process.env.MAX_PER_CALL = ''
    const config = loadConfig()
    expect(config.network).toBe('monad-testnet')
    expect(config.registryAddress).toBeUndefined()
    expect(config.reputationRegistry).toBeUndefined()
    expect(config.indexerUrl).toBeUndefined()
    expect(config.budget.maxPerCall).toBe('0.10')
  })

  it('uses default budget limits', () => {
    const config = loadConfig()
    expect(config.budget).toEqual({ maxPerCall: '0.10', maxPerDay: '20.00' })
  })

  it('respects budget env vars and ignores garbage', () => {
    process.env.MAX_PER_CALL = '5.00'
    process.env.MAX_PER_DAY = 'lots'
    const config = loadConfig()
    expect(config.budget.maxPerCall).toBe('5.00')
    expect(config.budget.maxPerDay).toBe('20.00')
  })

  it('reload refreshes config', () => {
    const config = loadConfig()
    expect(config.mode).toBe('READ_ONLY')
    process.env.CHAINPE_PRIVATE_KEY = TEST_KEY
    config.reload()
    expect(config.mode).toBe('MONAD')
  })
})
