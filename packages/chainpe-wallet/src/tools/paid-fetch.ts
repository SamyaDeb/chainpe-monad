import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ChainPePaymentError, giveFeedback, resolveReputationRegistry } from '@chainpemonad/sdk'
import type { AppConfig } from '../types.js'
import type { SpendingTracker } from '../spending.js'
import { NO_WALLET_MESSAGE } from '../clients.js'
import { makePaidRequest } from '../payments.js'
import { errMsg, fail, text } from './util.js'

function isLikelyTextContentType(contentType: string | null): boolean {
  if (!contentType) return false
  const n = contentType.toLowerCase()
  return (
    n.startsWith('text/') ||
    n.includes('application/json') ||
    n.includes('application/xml') ||
    n.includes('application/javascript') ||
    n.includes('application/x-www-form-urlencoded')
  )
}

export async function formatResponseBody(response: Response) {
  const contentType = response.headers.get('content-type')
  const contentLength = response.headers.get('content-length')
  if (isLikelyTextContentType(contentType)) {
    return { body: await response.text(), bodyEncoding: 'text' as const, contentType, contentLength }
  }
  const buf = await response.arrayBuffer()
  return { body: Buffer.from(buf).toString('base64'), bodyEncoding: 'base64' as const, contentType, contentLength }
}

/** Funding hint appended when a server refuses a signed payment. */
export function fundingHint(config: AppConfig): string {
  const faucets =
    config.network === 'monad-testnet'
      ? ['  • USDC: https://faucet.circle.com  (select Monad Testnet)', '  • MON:  https://faucet.monad.xyz']
      : ['  • Bridge or buy Monad USDC and send it to this wallet.']
  return ['', `The wallet needs enough USDC on ${config.network}. The facilitator pays gas, so MON is not needed to pay.`, ...faucets].join('\n')
}

/**
 * Opt-in (CHAINPE_AUTO_FEEDBACK=1): leave a positive ERC-8004 score for the
 * provider advertised on the 402, backed by the settlement tx (no settlement
 * tx, no rating). Costs gas, so off by default. Best effort.
 */
async function autoFeedback(config: AppConfig, url: string, agentId: string | undefined, paymentTxHash: string | undefined) {
  if (process.env.CHAINPE_AUTO_FEEDBACK !== '1' || !config.privateKey) return undefined
  if (!agentId || agentId === '0' || !paymentTxHash) return undefined
  try {
    const registry = resolveReputationRegistry(config.network, config.reputationRegistry)
    const txHash = await giveFeedback(config.network, registry, config.privateKey, {
      agentId,
      value: 100,
      paymentTxHash,
      endpoint: new URL(url).origin
    })
    return { agentId, score: 100, txHash }
  } catch {
    return undefined
  }
}

export function registerX402Fetch(server: McpServer, config: AppConfig, spending: SpendingTracker): void {
  server.tool(
    'x402_fetch',
    'Fetch a URL with automatic x402 v2 payment. Makes the HTTP request; if the server answers 402 Payment ' +
      'Required, signs a USDC (EIP-3009) payment on Monad and retries. Only offers that are `exact`, on the ' +
      "wallet's Monad network, in that network's USDC and within the per-call and daily budget are signed. " +
      'Returns the final response with the payment receipt (tx hash + MonadVision link).',
    {
      url: z.string().url().describe('The URL to fetch'),
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('GET').describe('HTTP method (default: GET)'),
      headers: z.record(z.string()).optional().describe('Optional HTTP headers'),
      body: z.string().optional().describe('Optional request body')
    },
    async ({ url, method, headers, body }) => {
      if (!config.canPay) return fail(NO_WALLET_MESSAGE)
      try {
        const { response, payment, agentId } = await makePaidRequest(config, spending, { url, method, headers, body })
        const payload = await formatResponseBody(response)
        const reputation = payment ? await autoFeedback(config, url, agentId, payment.txHash) : undefined
        return text({
          status: response.status,
          statusText: response.statusText,
          ...payload,
          payment: payment
            ? { ...payment, amount: `${payment.amount} USDC`, settlement: undefined }
            : undefined,
          settlement: payment?.settlement,
          reputation
        })
      } catch (err) {
        const hint = err instanceof ChainPePaymentError && err.reason === 'settlement_rejected' ? fundingHint(config) : ''
        return fail(`x402 fetch failed: ${errMsg(err)}${hint}`)
      }
    }
  )
}
