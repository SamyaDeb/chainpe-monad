import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ChainPePaymentError } from '@chainpeavax/sdk'
import type { AppConfig } from '../types.js'
import type { SpendingTracker } from '../spending.js'
import { NO_WALLET_MESSAGE } from '../clients.js'
import { makePaidRequest } from '../payments.js'
import { errMsg, fail, text } from './util.js'
import { fundingHint } from './paid-fetch.js'

async function parseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      return await response.json()
    } catch {
      return null
    }
  }
  return response.text()
}

export function registerPay(server: McpServer, config: AppConfig, spending: SpendingTracker): void {
  server.tool(
    'pay',
    'Pay for an x402-gated API call and get a structured result: parsed data, the payment receipt ' +
      '(amount, recipient, settlement tx hash, MonadVision link) and the provider agent id for ' +
      'give_feedback. Same safety rules as x402_fetch — only `exact` offers in Monad USDC within budget are ' +
      'signed — plus an optional tighter `maxAmount` for this call.',
    {
      url: z.string().url().describe('The x402-gated URL to pay for'),
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('GET').describe('HTTP method (default: GET)'),
      headers: z.record(z.string()).optional().describe('Optional HTTP headers'),
      body: z.string().optional().describe('Optional request body'),
      maxAmount: z.string().regex(/^\d+(\.\d{1,6})?$/).optional().describe('Refuse offers above this USDC amount, e.g. "0.05"')
    },
    async ({ url, method, headers, body, maxAmount }) => {
      if (!config.canPay) return fail(NO_WALLET_MESSAGE)
      try {
        const { response, payment, agentId } = await makePaidRequest(config, spending, {
          url,
          method,
          headers,
          body,
          maxAmount
        })
        return text({
          paid: !!payment,
          status: response.status,
          ok: response.ok,
          data: await parseBody(response),
          payment: payment ? { ...payment, amount: `${payment.amount} USDC` } : null,
          agentId: agentId ?? null,
          hint: payment && agentId ? 'Use give_feedback with this agentId to rate the provider.' : undefined
        })
      } catch (err) {
        const hint = err instanceof ChainPePaymentError && err.reason === 'settlement_rejected' ? fundingHint(config) : ''
        return fail(`Payment failed: ${errMsg(err)}${hint}`)
      }
    }
  )
}
