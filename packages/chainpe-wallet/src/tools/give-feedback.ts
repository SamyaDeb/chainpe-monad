import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { privateKeyToAccount } from 'viem/accounts'
import {
  explorerTxUrl,
  giveFeedback,
  normalizeKey,
  resolveReputationRegistry,
  verifyPaymentReceipt
} from '@chainpeavax/sdk'
import type { AppConfig } from '../types.js'
import { NO_WALLET_MESSAGE } from '../clients.js'
import { errMsg, fail, text } from './util.js'

/**
 * give_feedback — post an on-chain reputation score for a provider's agent to
 * the canonical ERC-8004 Reputation Registry on Monad (a real transaction,
 * paid in MON gas). The registry rejects self-feedback.
 *
 * No receipt, no rating: the tool only posts when `paymentTxHash` is a
 * successful Monad tx in which this wallet sent USDC. The hash becomes the
 * feedback's `feedbackHash`, so the ChainPe indexer can count it as paid.
 */
export function registerGiveFeedback(server: McpServer, config: AppConfig): void {
  server.tool(
    'give_feedback',
    'Leave on-chain reputation feedback for a service provider (ERC-8004). Submits a real transaction to ' +
      'the Reputation Registry on Monad (needs a little MON for gas) with a 0–100 score. Use after calling a ' +
      'paid service; pass the agentId shown by search_bazaar or pay AND the paymentTxHash (settlement tx) of the ' +
      'payment you made to it. Feedback without a payment receipt from this wallet is refused.',
    {
      agentId: z.string().describe("The provider service's ERC-8004 agent id (from search_bazaar)"),
      score: z.number().min(0).max(100).describe('Score 0–100 (e.g. 100 = excellent, 0 = bad)'),
      paymentTxHash: z
        .string()
        .optional()
        .describe('Settlement tx hash of your x402 payment to this provider (payment.txHash from x402_fetch / pay)'),
      endpoint: z.string().optional().describe('The service endpoint the feedback is about')
    },
    async ({ agentId, score, paymentTxHash, endpoint }) => {
      if (!config.privateKey) return fail(NO_WALLET_MESSAGE)
      if (!agentId || agentId === '0' || !/^\d+$/.test(agentId)) {
        return fail('This provider has no valid ERC-8004 agent id, so it cannot be scored.')
      }
      if (!paymentTxHash || !/^0x[0-9a-fA-F]{64}$/.test(paymentTxHash)) {
        return fail(
          'No payment receipt: pass paymentTxHash, the settlement tx of your x402 payment to this provider. ' +
            'ChainPe only posts feedback backed by a payment.'
        )
      }
      try {
        const payer = privateKeyToAccount(normalizeKey(config.privateKey)).address
        const receipt = await verifyPaymentReceipt(config.network, paymentTxHash, payer)
        if (!receipt.ok) {
          return fail(`Payment receipt not accepted (${receipt.reason}). ChainPe only posts feedback backed by a payment.`)
        }
        const registry = resolveReputationRegistry(config.network, config.reputationRegistry)
        const txHash = await giveFeedback(config.network, registry, config.privateKey, {
          agentId,
          value: score,
          paymentTxHash,
          endpoint,
          waitConfirm: true
        })
        return text({
          success: true,
          agentId,
          score,
          txHash,
          explorer: explorerTxUrl(config.network, txHash),
          paymentTxHash,
          note: 'Receipt-backed feedback recorded on-chain in the ERC-8004 Reputation Registry.'
        })
      } catch (err) {
        const msg = errMsg(err)
        const hint = /self-feedback/i.test(msg) ? ' (you cannot rate your own agent)' : ''
        return fail(`Feedback failed: ${msg}${hint}`)
      }
    }
  )
}
