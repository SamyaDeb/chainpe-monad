/**
 * spending_report — the persisted budget as an MCP tool, so the agent can
 * reason about its own spend and remaining allowance (survives restarts).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { formatUnits } from 'viem'
import { USDC_DECIMALS } from '@chainpemonad/sdk'
import type { SpendingTracker } from '../spending.js'
import { errMsg, fail, text } from './util.js'

export function registerSpendingReport(server: McpServer, spending: SpendingTracker): void {
  server.tool(
    'spending_report',
    'Show the agent’s spending: USDC spent today (UTC) and this session, remaining daily budget, ' +
      'per-call and daily limits, and recent payments with tx hashes. The budget is stored on disk, ' +
      'so it persists across restarts and resets at UTC midnight.',
    {},
    async () => {
      try {
        const s = spending.getSummary()
        const remaining = Number(formatUnits(spending.remainingDailyAtomic(), USDC_DECIMALS))
        return text({
          summary: {
            spentToday: `$${s.spentToday} USDC`,
            spentThisSession: `$${s.spentSession} USDC`,
            remainingDailyBudget: `$${remaining.toFixed(USDC_DECIMALS)} USDC`,
            dailyLimit: `$${s.limits.maxPerDay} USDC`,
            perCallLimit: `$${s.limits.maxPerCall} USDC`,
            resetsAt: 'UTC midnight',
            storedAt: s.storedAt
          },
          recentPayments: s.recentPayments.map(p => ({
            recipient: p.recipient,
            amount: `$${p.amount} USDC`,
            network: p.network,
            txHash: p.txHash,
            time: p.timestamp
          })),
          totalPayments: s.recentPayments.length
        })
      } catch (err) {
        return fail(`Error: ${errMsg(err)}`)
      }
    }
  )
}
