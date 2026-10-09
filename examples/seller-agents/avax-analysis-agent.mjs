/**
 * AVAX Analysis Seller Agent — Claude-powered investment analysis for Avalanche.
 *
 *   POST /analyze { price, news, portfolio? }  → BUY/SELL/HOLD with position sizing (paid)
 *   GET  /health                               → free
 *
 * Run: node avax-analysis-agent.mjs  (needs ANTHROPIC_API_KEY + ANALYSIS_PAYTO)
 */
import 'dotenv/config'
import express from 'express'
import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import { startSeller, requireEnv } from './seller-runtime.mjs'

const MODEL = process.env.ANALYSIS_MODEL || 'claude-sonnet-4-6'
if (!process.env.ANTHROPIC_API_KEY) requireEnv('ANTHROPIC_API_KEY')

const app = express()
app.use(express.json({ limit: '512kb' }))

app.get('/health', (_req, res) => res.json({ status: 'ok', agent: 'avax-analysis' }))
app.get('/schema', (_req, res) => res.json({
  name: 'AVAX Analysis Agent',
  routes: [
    { method: 'POST', path: '/analyze', paid: true, description: 'Investment analysis. Body: { price?: <from price agent>, news?: <from news agent>, portfolio?: { usdcBalance, avaxAmount } }. Returns: { action: BUY|SELL|HOLD, confidence, targetEntryUsd, targetExitUsd, stopLossUsd, positionSizePercent, rationale }.' },
    { method: 'GET',  path: '/health',  paid: false, description: 'Health check — free.' },
  ],
}))

app.post('/analyze', async (req, res) => {
  const { price, news, portfolio } = req.body ?? {}

  if (!price && !news) {
    return res.status(400).json({
      error: 'Provide at least one of: price (from avax-price-agent) or news (from avax-news-agent).',
    })
  }

  const priceCtx = price
    ? [
        `AVAX/USD: $${price.avax?.usd ?? 'unknown'}`,
        `24h change: ${price.avax?.change24h?.toFixed(2) ?? '?'}%`,
        `7d change: ${price.avax?.change7d?.toFixed(2) ?? '?'}%`,
        `24h high: $${price.avax?.high24h ?? '?'}  low: $${price.avax?.low24h ?? '?'}`,
        `24h volume: $${price.avax?.volume24h ? (price.avax.volume24h / 1e6).toFixed(1) + 'M' : '?'}`,
        `Market cap: $${price.avax?.marketCap ? (price.avax.marketCap / 1e9).toFixed(2) + 'B' : '?'}`,
        `Avalanche TVL: $${price.avalancheTvl ? (price.avalancheTvl / 1e9).toFixed(2) + 'B' : '?'}`,
        `TVL 24h change: ${price.avalancheTvlChange24h?.toFixed(2) ?? '?'}%`,
      ].join('\n')
    : 'No price data provided.'

  const newsCtx = news
    ? [
        `Sentiment: ${news.sentiment}`,
        `Headline: ${news.headline}`,
        `Key developments: ${(news.keyDevelopments ?? []).join('; ')}`,
        `Protocols to watch: ${(news.protocols ?? []).join(', ')}`,
        `Risk factors: ${(news.riskFactors ?? []).join('; ')}`,
        `Trading implications: ${news.tradingImplications}`,
      ].join('\n')
    : 'No news data provided.'

  const portfolioCtx = portfolio
    ? `Current portfolio: AVAX position = ${portfolio.avaxAmount ?? 0} AVAX, USDC balance = $${portfolio.usdcBalance ?? 0}`
    : 'No current portfolio data.'

  try {
    let analysis
    try {
      const { object } = await generateObject({
        model: anthropic(MODEL),
        schema: z.object({
          action: z.enum(['BUY', 'SELL', 'HOLD']).describe('Recommended action'),
          confidence: z.number().min(0).max(100).describe('Confidence score 0–100'),
          targetEntryUsd: z.number().nullable().describe('Recommended entry price in USD, null for HOLD/SELL'),
          targetExitUsd: z.number().nullable().describe('Take-profit price in USD'),
          stopLossUsd: z.number().nullable().describe('Stop-loss price in USD'),
          positionSizePercent: z.number().min(0).max(100).describe('Suggested position size as % of portfolio'),
          timeHorizon: z.enum(['short-term (<24h)', 'medium-term (1-7d)', 'long-term (>7d)']).describe('Suggested holding period'),
          rationale: z.string().describe('2-3 sentence reasoning for this recommendation'),
          technicalSignals: z.array(z.string()).describe('2-4 technical signals supporting this call'),
          keyRisks: z.array(z.string()).describe('2-3 specific risks that could invalidate this thesis'),
          onChainInsights: z.array(z.string()).describe('1-3 on-chain / DeFi-specific observations'),
        }),
        prompt:
          `You are a quantitative DeFi investment analyst specializing in Avalanche ecosystem assets. ` +
          `Analyze the following data and provide a precise, actionable investment recommendation for AVAX.\n\n` +
          `## Market Data\n${priceCtx}\n\n` +
          `## Ecosystem News & Sentiment\n${newsCtx}\n\n` +
          `## Current Portfolio\n${portfolioCtx}\n\n` +
          `Be specific with price targets. Consider on-chain TVL trends as a leading indicator. ` +
          `Weight news sentiment vs. price momentum. Keep position sizing conservative on testnet (max 30%).`,
      })
      analysis = object
    } catch (llmErr) {
      // Rule-based fallback when LLM is unavailable
      const change24h = price?.avax?.change24h ?? 0
      const tvlChange = price?.avalancheTvlChange24h ?? 0
      const newsSentiment = news?.sentiment ?? 'neutral'

      const bullSignals = (change24h > 1 ? 1 : 0) + (tvlChange >= 0 ? 1 : 0) + (newsSentiment === 'bullish' ? 1 : 0)
      const bearSignals = (change24h < -1 ? 1 : 0) + (tvlChange < -3 ? 1 : 0) + (newsSentiment === 'bearish' ? 2 : 0)

      const action = bullSignals >= 2 ? 'BUY' : bearSignals >= 3 ? 'SELL' : 'HOLD'
      const currentPrice = price?.avax?.usd ?? 0

      analysis = {
        action,
        confidence: 45,
        targetEntryUsd: action === 'BUY' ? currentPrice : null,
        targetExitUsd: action === 'BUY' ? currentPrice * 1.05 : null,
        stopLossUsd: action === 'BUY' ? currentPrice * 0.96 : null,
        positionSizePercent: action !== 'HOLD' ? 15 : 0,
        timeHorizon: 'short-term (<24h)',
        rationale: `Rule-based fallback (LLM unavailable). 24h: ${change24h.toFixed(2)}%, TVL change: ${tvlChange?.toFixed(2) ?? '?'}%, sentiment: ${newsSentiment}. Bull signals: ${bullSignals}, bear signals: ${bearSignals}.`,
        technicalSignals: [
          `24h price change: ${change24h > 0 ? '+' : ''}${change24h.toFixed(2)}%`,
          `TVL 24h: ${tvlChange > 0 ? '+' : ''}${tvlChange?.toFixed(2) ?? '?'}%`,
          `News sentiment: ${newsSentiment}`,
        ],
        keyRisks: ['LLM analysis unavailable — low confidence', 'Testnet conditions differ from mainnet'],
        onChainInsights: [`Avalanche TVL: $${((price?.avalancheTvl ?? 0) / 1e9).toFixed(2)}B`],
        llmSkipped: true,
        llmError: llmErr?.message?.slice(0, 100),
      }
    }

    res.json({
      agent: 'avax-analysis-agent',
      model: MODEL,
      timestamp: new Date().toISOString(),
      currentPrice: price?.avax?.usd ?? null,
      ...analysis,
    })
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) })
  }
})

await startSeller({
  name: process.env.ANALYSIS_NAME || 'AVAX Analysis Agent',
  app,
  backendPort: Number(process.env.ANALYSIS_BACKEND_PORT || 5105),
  proxyPort: Number(process.env.ANALYSIS_PROXY_PORT || 4505),
  payTo: requireEnv('ANALYSIS_PAYTO'),
  price: process.env.ANALYSIS_PRICE || '0.05',
  description: 'Claude-powered AVAX investment analysis: BUY/SELL/HOLD with price targets and position sizing.',
  tags: ['avax', 'analysis', 'trading', 'ai'],
  agentId: process.env.ANALYSIS_AGENT_ID,
})
