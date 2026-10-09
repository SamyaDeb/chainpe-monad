/**
 * AVAX Price Seller Agent — live AVAX + Avalanche DeFi data, paid per call.
 *
 *   GET  /price     → live AVAX/USD price, 24h change, volume (CoinGecko)
 *   GET  /defi      → top Avalanche protocols by TVL (DeFiLlama)
 *   GET  /health    → free
 *
 * No external API keys required — uses public endpoints.
 * Run: node avax-price-agent.mjs
 */
import 'dotenv/config'
import express from 'express'
import { startSeller, requireEnv } from './seller-runtime.mjs'

const app = express()
app.use(express.json())

app.get('/health', (_req, res) => res.json({ status: 'ok', agent: 'avax-price' }))
app.get('/schema', (_req, res) => res.json({
  name: 'AVAX Price Agent',
  routes: [
    { method: 'GET', path: '/price', paid: true,  description: 'Live AVAX/USD price, 24h/7d change, volume, market cap, Avalanche TVL.' },
    { method: 'GET', path: '/defi',  paid: true,  description: 'Top Avalanche DeFi protocols by TVL + highest yield pools.' },
    { method: 'GET', path: '/health',paid: false, description: 'Health check — free.' },
  ],
}))

app.get('/price', async (_req, res) => {
  try {
    const [cgRes, dlRes] = await Promise.all([
      fetch(
        'https://api.coingecko.com/api/v3/coins/avalanche-2?' +
        'localization=false&tickers=false&community_data=false&developer_data=false',
        { headers: { Accept: 'application/json' } }
      ),
      fetch('https://api.llama.fi/v2/chains', { headers: { Accept: 'application/json' } }),
    ])

    const cg = await cgRes.json()
    const chains = await dlRes.json()

    const avaxChain = Array.isArray(chains)
      ? chains.find((c) => c.name === 'Avalanche')
      : null

    const md = cg.market_data ?? {}
    res.json({
      agent: 'avax-price-agent',
      timestamp: new Date().toISOString(),
      avax: {
        usd: md.current_price?.usd ?? null,
        change24h: md.price_change_percentage_24h ?? null,
        change7d: md.price_change_percentage_7d ?? null,
        high24h: md.high_24h?.usd ?? null,
        low24h: md.low_24h?.usd ?? null,
        volume24h: md.total_volume?.usd ?? null,
        marketCap: md.market_cap?.usd ?? null,
        ath: md.ath?.usd ?? null,
        athChangePercent: md.ath_change_percentage?.usd ?? null,
      },
      avalancheTvl: avaxChain?.tvl ?? null,
      avalancheTvlChange24h: avaxChain?.change_1d ?? null,
    })
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) })
  }
})

app.get('/defi', async (_req, res) => {
  try {
    const [protRes, yieldRes] = await Promise.all([
      fetch('https://api.llama.fi/protocols', { headers: { Accept: 'application/json' } }),
      fetch('https://yields.llama.fi/pools', { headers: { Accept: 'application/json' } }),
    ])

    const protocols = await protRes.json()
    const yields = await yieldRes.json()

    // Top 10 Avalanche protocols by TVL
    const avaxProtocols = (Array.isArray(protocols) ? protocols : [])
      .filter((p) => p.chains?.includes('Avalanche') && p.tvl > 0)
      .sort((a, b) => b.tvl - a.tvl)
      .slice(0, 10)
      .map((p) => ({
        name: p.name,
        category: p.category,
        tvlUsd: p.tvl,
        change1d: p.change_1d,
        change7d: p.change_7d,
      }))

    // Top 10 Avalanche yield pools by APY
    const avaxPools = ((yields.data ?? []))
      .filter((p) => p.chain === 'Avalanche' && p.apy > 0 && p.tvlUsd > 100_000)
      .sort((a, b) => b.apy - a.apy)
      .slice(0, 10)
      .map((p) => ({
        pool: p.pool,
        project: p.project,
        symbol: p.symbol,
        tvlUsd: p.tvlUsd,
        apy: p.apy,
        apyBase: p.apyBase,
        apyReward: p.apyReward,
      }))

    res.json({
      agent: 'avax-price-agent',
      timestamp: new Date().toISOString(),
      topProtocols: avaxProtocols,
      topYieldPools: avaxPools,
    })
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) })
  }
})

await startSeller({
  name: process.env.PRICE_NAME || 'AVAX Price Agent',
  app,
  backendPort: Number(process.env.PRICE_BACKEND_PORT || 5103),
  proxyPort: Number(process.env.PRICE_PROXY_PORT || 4503),
  payTo: requireEnv('PRICE_PAYTO'),
  price: process.env.PRICE_PRICE || '0.005',
  description: 'Live AVAX price, DEX rates, and top Avalanche DeFi protocols by TVL.',
  tags: ['avax', 'price', 'defi', 'data'],
  agentId: process.env.PRICE_AGENT_ID,
})
