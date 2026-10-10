// The four LLM-free, data-backed Monad services (express apps on private ports).
import express from 'express'
import { ChainPe, RegistryClient, publicClientFor, resolveRegistryAddress } from '@chainpeavax/sdk'
import { formatGwei } from 'viem'
import { network } from './lib.mjs'

const pub = publicClientFor(network)
const INDEXER = process.env.CHAINPE_INDEXER_URL

export function statsApp() {
  const app = express()
  app.get('/stats', async (_req, res) => {
    const head = await pub.getBlockNumber()
    const blocks = await Promise.all([0n, 1n, 10n, 50n].map(d => pub.getBlock({ blockNumber: head - d })))
    const secPerBlock = (Number(blocks[0].timestamp) - Number(blocks[3].timestamp)) / 50
    res.json({
      network, chainId: await pub.getChainId(), head: head.toString(),
      blockTimeSec: Number(secPerBlock.toFixed(3)),
      gasPriceGwei: formatGwei(await pub.getGasPrice()),
      latestBlockTxs: blocks[0].transactions.length, gasUsedLatest: blocks[0].gasUsed.toString(),
      asOf: new Date(Number(blocks[0].timestamp) * 1000).toISOString()
    })
  })
  return app
}

export function priceApp() {
  const app = express()
  let cache
  const spot = async () => {
    if (cache && Date.now() - cache.t < 30_000) return cache
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=monad&vs_currencies=usd')
    const usd = (await r.json())?.monad?.usd
    if (!usd) throw new Error('price source unavailable')
    return (cache = { usd, t: Date.now() })
  }
  app.get('/quote', async (req, res) => {
    const amountUsdc = Number(req.query.amountUsdc ?? 10)
    if (!(amountUsdc > 0 && amountUsdc <= 1e6)) return res.status(400).json({ error: 'bad amountUsdc' })
    try {
      const { usd, t } = await spot()
      res.json({ pair: 'MON/USD', priceUsd: usd, amountUsdc, indicativeMon: amountUsdc / usd,
        source: 'coingecko', kind: 'reference price (not an on-chain swap quote)', asOf: new Date(t).toISOString() })
    } catch (e) { res.status(502).json({ error: String(e.message ?? e) }) }
  })
  return app
}

export function digestApp(cp) {
  const app = express()
  app.get('/digest', async (_req, res) => {
    const services = await new RegistryClient(network, resolveRegistryAddress(network)).listAllServices()
    const ranked = await cp.discover({})
    res.json({
      network, registeredServices: services.length,
      byTag: services.flatMap(s => s.tags).reduce((a, t) => ((a[t] = (a[t] ?? 0) + 1), a), {}),
      top: ranked.slice(0, 5).map(s => ({ name: s.name, price: s.pricePerRequest, agentId: s.agentId, reputation: s.reputation })),
      note: 'Computed live from the ChainPe registry + ERC-8004 reputation; no editorial content.'
    })
  })
  return app
}

export function trustApp(cp) {
  const app = express()
  app.get('/report', async (req, res) => {
    const agentId = String(req.query.agentId ?? '')
    if (!/^\d{1,12}$/.test(agentId)) return res.status(400).json({ error: 'agentId must be a number' })
    const onchain = await cp.getReputation(agentId).catch(() => null)
    let paid = null
    if (INDEXER) {
      const r = await fetch(`${INDEXER}/services/${agentId}/reputation`).catch(() => null)
      if (r?.ok) paid = await r.json()
    }
    res.json({ agentId, network, raw: onchain, paid: paid ?? 'set CHAINPE_INDEXER_URL for payment-backed score',
      method: 'paid = only ratings whose feedbackHash is an x402 settlement to the agent (see ChainPe indexer)' })
  })
  return app
}
