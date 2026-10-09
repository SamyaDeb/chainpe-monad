import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { explorerAddressUrl } from '@chainpeavax/sdk'
import type { AppConfig } from '../types.js'
import { getMonBalance, getUsdcBalance, getWalletAddress, NO_WALLET_MESSAGE } from '../clients.js'
import { errMsg, fail, text } from './util.js'

export function registerCheckBalance(server: McpServer, config: AppConfig): void {
  server.tool(
    'check_balance',
    'Check wallet balances on Monad: USDC (used for x402 payments) and native MON (gas for transfers and feedback).',
    {},
    async () => {
      if (!config.canPay) return fail(NO_WALLET_MESSAGE)
      try {
        const address = getWalletAddress(config)
        const [usdc, mon] = await Promise.all([
          getUsdcBalance(config.network, address),
          getMonBalance(config.network, address)
        ])
        return text({
          address,
          network: config.network,
          mode: config.mode,
          usdc: `${usdc} USDC`,
          mon: `${mon} MON`,
          explorerUrl: explorerAddressUrl(config.network, address),
          gasNote:
            'MON pays gas for transfers and on-chain feedback. x402 USDC payments need no MON — the facilitator pays gas.'
        })
      } catch (err) {
        return fail(`Error: ${errMsg(err)}`)
      }
    }
  )
}
