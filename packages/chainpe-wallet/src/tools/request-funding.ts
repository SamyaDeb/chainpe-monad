/**
 * request_funding — an EIP-681 payment URI (plus faucet links on testnet) so a
 * human or another agent can top up this wallet with USDC or MON.
 *   MON:   ethereum:<wallet>@<chainId>?value=<wei>
 *   USDC:  ethereum:<usdc>@<chainId>/transfer?address=<wallet>&uint256=<atomic>
 */
import { z } from 'zod'
import { parseEther, parseUnits } from 'viem'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getNetwork, getUsdcAddress } from '@chainpeavax/sdk'
import type { AppConfig } from '../types.js'
import { getWalletAddress, NO_WALLET_MESSAGE, USDC_DECIMALS } from '../clients.js'
import { errMsg, fail, text } from './util.js'

export const MON_FAUCET = 'https://faucet.monad.xyz'
export const USDC_FAUCET = 'https://faucet.circle.com'

export function registerRequestFunding(server: McpServer, config: AppConfig): void {
  server.tool(
    'request_funding',
    'Generate an EIP-681 payment link (and the plain address) to ask a human or another agent to send ' +
      'USDC or MON to this wallet on Monad. On testnet it also returns the MON and USDC faucet links.',
    {
      currency: z.enum(['USDC', 'MON']).default('USDC').describe('Which currency to request — USDC (default) or native MON'),
      amount: z.string().describe('Amount to request as decimal, e.g. "5.00"')
    },
    async ({ currency, amount }) => {
      if (!config.privateKey) return fail(NO_WALLET_MESSAGE)
      try {
        const network = config.network
        const address = getWalletAddress(config)
        const { chainId } = getNetwork(network)

        const uri =
          currency === 'USDC'
            ? `ethereum:${getUsdcAddress(network)}@${chainId}/transfer?address=${address}&uint256=${parseUnits(amount, USDC_DECIMALS)}`
            : `ethereum:${address}@${chainId}?value=${parseEther(amount)}`

        const testnet = network === 'monad-testnet'
        return text({
          message: `Please send ${amount} ${currency} to fund this agent wallet.`,
          walletAddress: address,
          currency,
          amount: `${amount} ${currency}`,
          network,
          chainId,
          paymentUri: uri,
          faucets: testnet ? { MON: MON_FAUCET, USDC: USDC_FAUCET } : undefined,
          instructions: [
            'Tap paymentUri in a mobile EVM wallet to prefill the transfer',
            `Or copy walletAddress and send manually on Monad (${network})`,
            ...(testnet
              ? [`Testnet MON: ${MON_FAUCET}`, `Testnet USDC: ${USDC_FAUCET} (choose Monad Testnet)`]
              : [])
          ]
        })
      } catch (err) {
        return fail(`Error: ${errMsg(err)}`)
      }
    }
  )
}
