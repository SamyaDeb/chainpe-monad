/**
 * AVAX News Seller Agent — latest Avalanche ecosystem news, synthesized by Claude.
 *
 *   POST /news { "limit": 10 }  → top Avalanche news + LLM synthesis (paid)
 *   GET  /health                → free
 *
 * Run: node avax-news-agent.mjs  (needs ANTHROPIC_API_KEY + NEWS_PAYTO)
 */
import 'dotenv/config'
import express from 'express'
import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import { startSeller, requireEnv } from './seller-runtime.mjs'

const MODEL = process.env.NEWS_MODEL || 'claude-haiku-4-5-20251001'
if (!process.env.ANTHROPIC_API_KEY) requireEnv('ANTHROPIC_API_KEY')

const app = express()
app.use(express.json())

app.get('/health', (_req, res) => res.json({ status: 'ok', agent: 'avax-news' }))
app.get('/schema', (_req, res) => res.json({
  name: 'AVAX News Agent',
  routes: [
    { method: 'POST', path: '/news', paid: true,  description: 'Avalanche ecosystem news digest. Body: { limit?: number (default 10) }. Returns: { sentiment, headline, keyDevelopments, protocols, riskFactors, tradingImplications }.' },
    { method: 'GET',  path: '/health', paid: false, description: 'Health check — free.' },
  ],
}))

app.post('/news', async (req, res) => {
  const limit = Math.min(Number(req.body?.limit ?? 10), 20)

  try {
    // Fetch news from multiple free sources
    const [llamaRes, cgRes] = await Promise.all([
      fetch(`https://cryptonews-api.com/api/v1?tickers=AVAX&items=${limit}&token=DEMO`, {
        headers: { Accept: 'application/json' },
      }).catch(() => null),
      fetch(
        'https://api.coingecko.com/api/v3/news?per_page=' + limit,
        { headers: { Accept: 'application/json' } }
      ).catch(() => null),
    ])

    const rawItems = []

    // CoinGecko news (filter for Avalanche/AVAX)
    if (cgRes?.ok) {
      const cgNews = await cgRes.json().catch(() => ({}))
      const articles = cgNews.data ?? cgNews ?? []
      if (Array.isArray(articles)) {
        articles
          .filter((a) => {
            const text = ((a.title ?? '') + ' ' + (a.description ?? '')).toLowerCase()
            return text.includes('avax') || text.includes('avalanche') || text.includes('subnet')
          })
          .slice(0, limit)
          .forEach((a) =>
            rawItems.push({
              title: a.title ?? a.news_title,
              description: a.description ?? a.text ?? '',
              url: a.url ?? a.news_url,
              source: a.author ?? a.source_name ?? 'CoinGecko News',
              publishedAt: a.updated_at ?? a.date,
            })
          )
      }
    }

    // DeFiLlama doesn't have a /news endpoint, use raised/hacks data as signals
    const [hacksRes, raisesRes] = await Promise.all([
      fetch('https://api.llama.fi/hacks', { headers: { Accept: 'application/json' } }).catch(() => null),
      fetch('https://api.llama.fi/raises', { headers: { Accept: 'application/json' } }).catch(() => null),
    ])

    if (hacksRes?.ok) {
      const hacks = await hacksRes.json().catch(() => [])
      ;(Array.isArray(hacks) ? hacks : [])
        .filter((h) => {
          const c = h.chain
          if (!c) return false
          return Array.isArray(c)
            ? c.some((x) => x?.toLowerCase?.().includes('avalanche'))
            : c.toLowerCase().includes('avalanche')
        })
        .slice(0, 3)
        .forEach((h) =>
          rawItems.push({
            title: `[HACK] ${h.name}: $${(h.amount / 1e6).toFixed(1)}M exploited`,
            description: `Technique: ${h.technique ?? 'unknown'}. Funds returned: ${h.fundsReturned ?? 0}`,
            url: h.link ?? null,
            source: 'DeFiLlama Hacks',
            publishedAt: h.date ? new Date(h.date * 1000).toISOString() : null,
          })
        )
    }

    if (raisesRes?.ok) {
      const raises = await raisesRes.json().catch(() => ({ raises: [] }))
      ;(Array.isArray(raises.raises) ? raises.raises : [])
        .filter((r) => (r.chains ?? []).includes('Avalanche') || r.name?.toLowerCase().includes('avax'))
        .slice(0, 3)
        .forEach((r) =>
          rawItems.push({
            title: `[RAISE] ${r.name} raised $${(r.amount / 1e6).toFixed(1)}M`,
            description: `Lead investors: ${(r.leadInvestors ?? []).join(', ') || 'undisclosed'}. Round: ${r.round ?? 'unknown'}`,
            url: r.source ?? null,
            source: 'DeFiLlama Raises',
            publishedAt: r.date ? new Date(r.date * 1000).toISOString() : null,
          })
        )
    }

    // If no real news found, synthesize from market data
    const newsContext =
      rawItems.length > 0
        ? rawItems
            .slice(0, limit)
            .map((n) => `• ${n.title}: ${n.description}`)
            .join('\n')
        : 'No specific news articles available. Use your knowledge of recent Avalanche ecosystem developments.'

    let synthesis
    try {
      const { object } = await generateObject({
        model: anthropic(MODEL),
        schema: z.object({
          headline: z.string().describe('One punchy headline for the Avalanche ecosystem today'),
          sentiment: z.enum(['bullish', 'bearish', 'neutral']),
          keyDevelopments: z.array(z.string()).describe('3-5 most important things happening on Avalanche right now'),
          protocols: z.array(z.string()).describe('2-4 specific protocols worth watching'),
          riskFactors: z.array(z.string()).describe('2-3 risks to consider'),
          tradingImplications: z.string().describe('1-2 sentences on what this means for trading AVAX'),
        }),
        prompt:
          `You are an Avalanche ecosystem analyst. Based on this news and your knowledge of the current state ` +
          `of Avalanche, produce a concise investment-relevant news digest.\n\nNews:\n${newsContext}`,
      })
      synthesis = object
    } catch (llmErr) {
      // Degrade gracefully: return raw signals without LLM synthesis
      const hackCount = rawItems.filter((i) => i.source?.includes('Hack')).length
      synthesis = {
        headline: rawItems[0]?.title ?? 'Avalanche ecosystem update',
        sentiment: hackCount > 0 ? 'bearish' : 'neutral',
        keyDevelopments: rawItems.slice(0, 5).map((i) => i.title).filter(Boolean),
        protocols: ['Trader Joe', 'Benqi', 'Aave', 'GMX'],
        riskFactors: ['Market volatility', 'Smart contract risk', 'Liquidity constraints'],
        tradingImplications: 'No LLM synthesis available — using raw signal data only.',
        llmSkipped: true,
        llmError: llmErr?.message?.slice(0, 100),
      }
    }

    res.json({
      agent: 'avax-news-agent',
      model: MODEL,
      timestamp: new Date().toISOString(),
      articlesFound: rawItems.length,
      articles: rawItems.slice(0, 5),
      ...synthesis,
    })
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) })
  }
})

await startSeller({
  name: process.env.NEWS_NAME || 'AVAX News Agent',
  app,
  backendPort: Number(process.env.NEWS_BACKEND_PORT || 5104),
  proxyPort: Number(process.env.NEWS_PROXY_PORT || 4504),
  payTo: requireEnv('NEWS_PAYTO'),
  price: process.env.NEWS_PRICE || '0.02',
  description: 'Latest Avalanche ecosystem news, LLM-synthesized into investment signals.',
  tags: ['avax', 'news', 'avalanche', 'research'],
  agentId: process.env.NEWS_AGENT_ID,
})
