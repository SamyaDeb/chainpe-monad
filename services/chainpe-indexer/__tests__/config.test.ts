import { describe, it, expect } from 'vitest'
import { loadConfig } from '../src/config.js'

const MAINNET_REGISTRY = '0x1111111111111111111111111111111111111111'

describe('loadConfig', () => {
  it('starts testnet at the registry deploy block by default', () => {
    const c = loadConfig({ NETWORK: 'monad-testnet' })
    expect(c.startBlock).toBe(69_658_414n)
  })

  it('refuses mainnet without START_BLOCK (would scan from genesis)', () => {
    expect(() => loadConfig({ NETWORK: 'monad', CHAINPE_REGISTRY_ADDRESS: MAINNET_REGISTRY })).toThrow(/START_BLOCK/)
  })

  it('refuses mainnet without a registry address', () => {
    expect(() => loadConfig({ NETWORK: 'monad', START_BLOCK: '1' })).toThrow(/ChainPeRegistry/)
  })

  it('accepts mainnet with registry + START_BLOCK and uses the canonical registries', () => {
    const c = loadConfig({ NETWORK: 'monad', CHAINPE_REGISTRY_ADDRESS: MAINNET_REGISTRY, START_BLOCK: '42000000' })
    expect(c.startBlock).toBe(42_000_000n)
    expect(c.chain.id).toBe(143)
    expect(c.reputation).toBe('0x8004BAa17C55a88189AE136b182e5fdA19dE9b63')
    expect(c.policyVault).toBeUndefined()
  })
})
