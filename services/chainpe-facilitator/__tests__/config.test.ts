import { describe, expect, it } from 'vitest'
import { parseEther } from 'viem'
import { loadConfig } from '../src/config.js'
import { createSerialQueue } from '../src/signer.js'

const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' // public Hardhat key

describe('loadConfig', () => {
  it('defaults to Monad testnet with Monad USDC', () => {
    const cfg = loadConfig({ FACILITATOR_PRIVATE_KEY: KEY })
    expect(cfg.network).toBe('monad-testnet')
    expect(cfg.caip2).toBe('eip155:10143')
    expect(cfg.chain.id).toBe(10143)
    expect(cfg.usdc).toBe('0x534b2f3A21130d7a60830c2Df862319e593943A3')
    expect(cfg.requireRegisteredPayTo).toBe(false)
    expect(cfg.trustProxy).toBe(1)
    expect(cfg.lowGasThresholdWei).toBe(parseEther('1'))
  })

  it('is strict about payTo on mainnet by default', () => {
    const cfg = loadConfig({ FACILITATOR_PRIVATE_KEY: KEY, NETWORK: 'monad' })
    expect(cfg.caip2).toBe('eip155:143')
    expect(cfg.requireRegisteredPayTo).toBe(true)
    expect(loadConfig({ FACILITATOR_PRIVATE_KEY: KEY, NETWORK: 'monad', REQUIRE_REGISTERED_PAYTO: 'false' }).requireRegisteredPayTo).toBe(false)
    // A blank variable (docker compose / Railway) must not switch the mainnet policy off.
    expect(loadConfig({ FACILITATOR_PRIVATE_KEY: KEY, NETWORK: 'monad', REQUIRE_REGISTERED_PAYTO: '' }).requireRegisteredPayTo).toBe(true)
  })

  it('supports a local chain for end-to-end tests', () => {
    const cfg = loadConfig({
      FACILITATOR_PRIVATE_KEY: KEY,
      NETWORK: 'local',
      CHAIN_ID: '31337',
      RPC_URL: 'http://127.0.0.1:8545',
      USDC_ADDRESS: '0x5FbDB2315678afecb367f032d93F642f64180aa3'
    })
    expect(cfg.caip2).toBe('eip155:31337')
    expect(cfg.chain.id).toBe(31337)
  })

  it('rejects unknown networks and a missing key', () => {
    expect(() => loadConfig({ FACILITATOR_PRIVATE_KEY: KEY, NETWORK: 'avalanche' })).toThrow(/Unsupported NETWORK/)
    expect(() => loadConfig({})).toThrow(/FACILITATOR_PRIVATE_KEY/)
  })

  it('parses the payTo allowlist', () => {
    const cfg = loadConfig({ FACILITATOR_PRIVATE_KEY: KEY, PAYTO_ALLOWLIST: ' 0xAbC , 0xdef,' })
    expect([...cfg.payToAllowlist]).toEqual(['0xabc', '0xdef'])
  })
})

describe('createSerialQueue', () => {
  it('runs tasks one at a time, in order, even when one fails', async () => {
    const enqueue = createSerialQueue()
    const events: string[] = []
    let running = 0
    const task = (name: string, fail = false) => async () => {
      running++
      expect(running).toBe(1)
      events.push(`start ${name}`)
      await new Promise(r => setTimeout(r, 5))
      events.push(`end ${name}`)
      running--
      if (fail) throw new Error(name)
      return name
    }
    const results = await Promise.allSettled([enqueue(task('a')), enqueue(task('b', true)), enqueue(task('c'))])
    expect(events).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c'])
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled'])
  })
})
