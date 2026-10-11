import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import express from 'express'
import { ChainPe, NETWORKS, VAULT_SCHEME, resetVaultNonces } from '@chainpemonad/sdk'
import { generatePrivateKey } from 'viem/accounts'
import {
  createProxyServer,
  createRoutesConfig,
  facilitatorSupportsVault,
  startProxyServer
} from '../src/index.js'
import type { ChainPeConfig } from '../src/index.js'

// Public Hardhat test key — not a secret.
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const SESSION_KEY = generatePrivateKey()
const OWNER = '0x2222222222222222222222222222222222222222'
const SELLER = '0x1111111111111111111111111111111111111111'
const TX = '0x' + 'cd'.repeat(32)
const net = NETWORKS['monad-testnet']
const VAULT = net.policyVault!

const config: ChainPeConfig = {
  serviceName: 'Vault Test',
  serviceDescription: 'test',
  tags: ['test'],
  targetUrl: '',
  pricePerRequest: '0.01',
  paymentToken: 'USDC',
  walletAddress: SELLER,
  proxyPort: 0,
  network: 'monad-testnet',
  agentId: '42'
}

const kinds = {
  exact: { x402Version: 2, scheme: 'exact', network: net.caip2 },
  vault: { x402Version: 2, scheme: VAULT_SCHEME, network: net.caip2, extra: { vault: VAULT, name: 'ChainPePolicyVault', version: '1' } }
}
const settled: { scheme: string; extra: Record<string, unknown> }[] = []
let vaultNonce = 0n
const facilitator = (withVault: boolean) => ({
  getSupported: async () => ({ kinds: withVault ? [kinds.exact, kinds.vault] : [kinds.exact], extensions: [], signers: {} }),
  verify: async () => ({ isValid: true, payer: OWNER }),
  settle: async (_p: unknown, r: { scheme: string; extra: Record<string, unknown> }) => {
    settled.push(r)
    if (r.scheme === VAULT_SCHEME) vaultNonce++
    return { success: true, transaction: TX, network: net.caip2, payer: OWNER }
  }
})

const listen = (app: express.Express) =>
  new Promise<{ server: Server; url: string }>(resolve => {
    const server = app.listen(0, () => {
      const a = server.address()
      resolve({ server, url: `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}` })
    })
  })

const offersOf = async (url: string) => {
  const res = await fetch(url)
  expect(res.status).toBe(402)
  return JSON.parse(Buffer.from(res.headers.get('payment-required')!, 'base64').toString()).accepts as {
    scheme: string
    payTo: string
    amount: string
    extra: Record<string, unknown>
  }[]
}

const servers: Server[] = []
let backendUrl = ''
let backendHits = 0
beforeAll(async () => {
  const b = express()
  b.get('/data', (_req, res) => {
    backendHits++
    res.json({ data: 'paid' })
  })
  const be = await listen(b)
  servers.push(be.server)
  backendUrl = be.url
})
afterAll(() => servers.forEach(s => s.close()))

describe('route config with vault offers', () => {
  it('offers exact AND chainpe-vault for the same price and payTo', () => {
    const routes = createRoutesConfig(config, undefined, { vault: true }) as Record<string, { accepts: { scheme: string; payTo: string; price: { amount: string; extra: Record<string, unknown> } }[] }>
    const [exact, vault] = routes['/*'].accepts
    expect(exact.scheme).toBe('exact')
    expect(vault.scheme).toBe(VAULT_SCHEME)
    expect(vault.payTo).toBe(SELLER)
    expect(vault.price.amount).toBe(exact.price.amount)
    // The vault's EIP-712 domain comes from the facilitator, never USDC's.
    expect(vault.price.extra).toEqual({ agentId: '42' })
  })

  it('can pin the vault address', () => {
    const routes = createRoutesConfig({ ...config, policyVault: VAULT }, undefined, { vault: true }) as Record<string, { accepts: { price: { extra: Record<string, unknown> } }[] }>
    expect(routes['/*'].accepts[1].price.extra.vault).toBe(VAULT)
  })
})

describe('facilitatorSupportsVault', () => {
  it('reads /supported', async () => {
    expect(await facilitatorSupportsVault([facilitator(true) as never], net.caip2)).toBe(true)
    expect(await facilitatorSupportsVault([facilitator(false) as never], net.caip2)).toBe(false)
    expect(await facilitatorSupportsVault([facilitator(true) as never], 'eip155:143')).toBe(false)
    const broken = { getSupported: async () => Promise.reject(new Error('down')) }
    expect(await facilitatorSupportsVault([broken as never, facilitator(true) as never], net.caip2)).toBe(true)
  })
})

describe('proxy in mandate mode', () => {
  let base = ''
  beforeAll(async () => {
    const px = await listen(
      createProxyServer({ config: { ...config, targetUrl: backendUrl }, facilitatorClient: facilitator(true) as never, acceptVault: true })
    )
    servers.push(px.server)
    base = px.url
  })

  it('advertises both offers; the vault one names the facilitator vault', async () => {
    const offers = await offersOf(`${base}/data`)
    expect(offers.map(o => o.scheme)).toEqual(['exact', VAULT_SCHEME])
    expect(offers[1].extra).toMatchObject({ vault: VAULT, name: 'ChainPePolicyVault', version: '1', agentId: '42' })
  })

  it('a mandate-mode agent pays via the vault and reaches the backend', async () => {
    resetVaultNonces()
    const hits = backendHits
    const cp = new ChainPe({
      privateKey: KEY,
      network: 'monad-testnet',
      registryAddress: '0x000000000000000000000000000000000000dEaD',
      policyVault: { owner: OWNER, sessionKey: SESSION_KEY, readNonce: async () => vaultNonce }
    })
    const r = await cp.pay(`${base}/data`)
    expect(r.data).toEqual({ data: 'paid' })
    expect(r.payment).toMatchObject({ scheme: VAULT_SCHEME, owner: OWNER, txHash: TX, recipient: SELLER })
    expect(settled.at(-1)?.scheme).toBe(VAULT_SCHEME)
    expect(backendHits).toBe(hits + 1)
  })

  it('a plain agent still pays exact', async () => {
    const cp = new ChainPe({ privateKey: KEY, network: 'monad-testnet', registryAddress: '0x000000000000000000000000000000000000dEaD' })
    const r = await cp.pay(`${base}/data`)
    expect(r.payment?.scheme).toBe('exact')
    expect(settled.at(-1)?.scheme).toBe('exact')
  })
})

describe('startProxyServer auto-detects vault support', () => {
  it('offers chainpe-vault only when the facilitator supports it', async () => {
    const withVault = await startProxyServer({ config: { ...config, targetUrl: backendUrl }, facilitatorClient: facilitator(true) as never })
    const without = await startProxyServer({ config: { ...config, targetUrl: backendUrl }, facilitatorClient: facilitator(false) as never })
    servers.push(withVault.server, without.server)
    const url = (s: Server) => {
      const a = s.address()
      return `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}/data`
    }
    expect((await offersOf(url(withVault.server))).map(o => o.scheme)).toEqual(['exact', VAULT_SCHEME])
    expect((await offersOf(url(without.server))).map(o => o.scheme)).toEqual(['exact'])
  })

  it('a mandate-mode agent refuses an exact-only provider (no silent fallback to its own wallet)', async () => {
    const px = await listen(createProxyServer({ config: { ...config, targetUrl: backendUrl }, facilitatorClient: facilitator(false) as never }))
    servers.push(px.server)
    const cp = new ChainPe({
      privateKey: KEY,
      network: 'monad-testnet',
      registryAddress: '0x000000000000000000000000000000000000dEaD',
      policyVault: { owner: OWNER, sessionKey: SESSION_KEY, readNonce: async () => vaultNonce }
    })
    await expect(cp.fetch(`${px.url}/data`)).rejects.toThrow(/no acceptable payment offer/)
  })
})
