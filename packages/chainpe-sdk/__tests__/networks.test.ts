import { afterEach, describe, expect, it } from 'vitest'
import { monad, monadTestnet } from 'viem/chains'
import {
  NETWORKS,
  DEFAULT_NETWORK,
  getNetwork,
  isChainPeNetwork,
  networkFromChainId,
  networkFromCaip2,
  rpcUrlFor,
  getUsdcAddress,
  resolveRegistryAddress,
  resolveReputationRegistry,
  resolveIdentityRegistry,
  resolvePolicyVault,
  explorerTxUrl,
  normalizeKey
} from '../src/networks.js'

const ENV_KEYS = [
  'MONAD_RPC_URL',
  'MONAD_TESTNET_RPC_URL',
  'CHAINPE_REGISTRY_ADDRESS',
  'ERC8004_REPUTATION_REGISTRY',
  'ERC8004_IDENTITY_REGISTRY',
  'POLICY_VAULT_ADDRESS'
]

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
})

describe('Monad network table', () => {
  it('matches viem chain ids and CAIP-2 ids', () => {
    expect(NETWORKS.monad.chainId).toBe(monad.id)
    expect(NETWORKS['monad-testnet'].chainId).toBe(monadTestnet.id)
    expect(NETWORKS.monad.caip2).toBe('eip155:143')
    expect(NETWORKS['monad-testnet'].caip2).toBe('eip155:10143')
  })

  it('uses Circle USDC with the "USDC" v2 EIP-712 domain', () => {
    for (const n of Object.values(NETWORKS)) {
      expect(n.usdc.decimals).toBe(6)
      expect(n.usdc.eip712Name).toBe('USDC')
      expect(n.usdc.eip712Version).toBe('2')
    }
    expect(getUsdcAddress('monad')).toBe('0x754704Bc059F8C67012fEd69BC8A327a5aafb603')
  })

  it('defaults to testnet', () => {
    expect(DEFAULT_NETWORK).toBe('monad-testnet')
  })

  it('rejects unknown networks', () => {
    expect(isChainPeNetwork('avalanche')).toBe(false)
    expect(() => getNetwork('avalanche' as never)).toThrow(/Unknown ChainPe network/)
  })
})

describe('network lookups', () => {
  it('maps chain ids and CAIP-2 ids back to networks', () => {
    expect(networkFromChainId(143)).toBe('monad')
    expect(networkFromChainId(43114)).toBeUndefined()
    expect(networkFromCaip2('eip155:10143')).toBe('monad-testnet')
    expect(networkFromCaip2('monad')).toBe('monad')
    expect(networkFromCaip2('eip155:8453')).toBeUndefined()
    expect(networkFromCaip2('avalanche')).toBeUndefined()
  })

  it('builds explorer links', () => {
    expect(explorerTxUrl('monad', '0xabc')).toBe('https://monadvision.com/tx/0xabc')
  })

  it('normalizes private keys', () => {
    expect(normalizeKey('ab')).toBe('0xab')
    expect(normalizeKey('0xab')).toBe('0xab')
  })
})

describe('env overrides', () => {
  it('honours per-network RPC overrides', () => {
    expect(rpcUrlFor('monad')).toBe('https://rpc.monad.xyz')
    process.env.MONAD_RPC_URL = 'https://my-node.example'
    expect(rpcUrlFor('monad')).toBe('https://my-node.example')
    expect(rpcUrlFor('monad-testnet')).toBe('https://testnet-rpc.monad.xyz')
  })

  it('requires a registry address until one is deployed', () => {
    expect(() => resolveRegistryAddress('monad')).toThrow(/No ChainPe registry address/)
    process.env.CHAINPE_REGISTRY_ADDRESS = '0x000000000000000000000000000000000000dead'
    expect(resolveRegistryAddress('monad')).toBe('0x000000000000000000000000000000000000dEaD')
    expect(resolveRegistryAddress('monad', '0x0000000000000000000000000000000000000001')).toBe(
      '0x0000000000000000000000000000000000000001'
    )
  })

  it('defaults ERC-8004 registries to the canonical deployment', () => {
    expect(resolveReputationRegistry('monad')).toBe('0x8004BAa17C55a88189AE136b182e5fdA19dE9b63')
    expect(resolveIdentityRegistry('monad')).toBe('0x8004A169FB4a3325136EB29fA0ceB6D2e539a432')
    process.env.ERC8004_REPUTATION_REGISTRY = '0x000000000000000000000000000000000000dead'
    expect(resolveReputationRegistry('monad')).toBe('0x000000000000000000000000000000000000dEaD')
  })

  it('treats the PolicyVault as optional', () => {
    expect(resolvePolicyVault('monad')).toBeUndefined()
    process.env.POLICY_VAULT_ADDRESS = '0x000000000000000000000000000000000000dead'
    expect(resolvePolicyVault('monad')).toBe('0x000000000000000000000000000000000000dEaD')
  })
})
