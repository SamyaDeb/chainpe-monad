import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

vi.mock('../src/keychain.js', () => ({
  savePrivateKey: vi.fn(),
  getPrivateKey: vi.fn(async () => null)
}))

let home: string
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'chainpe-agent-'))
  vi.spyOn(os, 'homedir').mockReturnValue(home)
  vi.resetModules()
})
afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(home, { recursive: true, force: true })
})

const writeConfig = (network: unknown) => {
  fs.mkdirSync(path.join(home, '.chainpe'), { recursive: true })
  fs.writeFileSync(
    path.join(home, '.chainpe', 'agent.json'),
    JSON.stringify({
      llm: { provider: 'qwen', model: 'qwen-plus', apiKey: 'k' },
      wallet: { address: '0xabc' },
      payment: { preferredToken: 'USDC' },
      network
    })
  )
}

describe('agent config', () => {
  it('buildConfig defaults to monad-testnet', async () => {
    const { buildConfig } = await import('../src/config.js')
    const c = buildConfig({ llmProvider: 'qwen', llmModel: 'qwen-plus', walletAddress: '0xabc', preferredToken: 'USDC' })
    expect(c.network).toBe('monad-testnet')
    expect(c.wallet).toEqual({ address: '0xabc', useKeychain: true })
  })

  it('keeps a Monad network from disk', async () => {
    writeConfig('monad')
    const { loadConfig } = await import('../src/config.js')
    expect((await loadConfig())?.network).toBe('monad')
  })

  it('maps an old non-Monad network to testnet, never mainnet', async () => {
    writeConfig('some-other-chain')
    const { loadConfig } = await import('../src/config.js')
    expect((await loadConfig())?.network).toBe('monad-testnet')
  })

  it('never writes the private key to disk', async () => {
    const { saveConfig, buildConfig } = await import('../src/config.js')
    const c = buildConfig({ llmProvider: 'openai', llmModel: 'gpt-4o', walletAddress: '0xabc', preferredToken: 'USDC' })
    await saveConfig({ ...c, wallet: { ...c.wallet, privateKey: '0xsecret' } as never })
    expect(fs.readFileSync(path.join(home, '.chainpe', 'agent.json'), 'utf-8')).not.toContain('0xsecret')
  })

  it('offers Qwen models', async () => {
    const { DEFAULT_MODELS, getDefaultModel } = await import('../src/config.js')
    expect(DEFAULT_MODELS.qwen.length).toBeGreaterThan(0)
    expect(getDefaultModel('qwen')).toBe('qwen-plus')
  })
})
