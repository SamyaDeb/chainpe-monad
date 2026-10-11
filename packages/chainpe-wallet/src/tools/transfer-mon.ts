/**
 * transfer_mon — send native MON from the agent wallet to any address.
 * (transfer_usdc moves the ERC-20; this moves the gas token.)
 */
import { z } from 'zod'
import { createWalletClient, http, getAddress, parseEther } from 'viem'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { chainFor, explorerTxUrl, publicClientFor, rpcUrlFor } from '@chainpemonad/sdk'
import type { AppConfig } from '../types.js'
import { getAccount, NO_WALLET_MESSAGE, tightGas } from '../clients.js'
import { errMsg, fail, text } from './util.js'

/** Monad keeps a 10 MON reserve balance; dipping below it can make later txs fail. */
const RESERVE_MON = parseEther('10')

export function registerTransferMon(server: McpServer, config: AppConfig): void {
  server.tool(
    'transfer_mon',
    'Send native MON from this agent wallet to another address. Use it to pay gas for another wallet or ' +
      'move value in MON. For USDC use transfer_usdc.',
    {
      to: z.string().describe('Recipient EVM address (0x…)'),
      amount: z.string().describe('Amount of MON as decimal string, e.g. "1.5"')
    },
    async ({ to, amount }) => {
      if (!config.privateKey) return fail(NO_WALLET_MESSAGE)
      try {
        const network = config.network
        const value = parseEther(amount)
        if (value <= 0n) return fail('Amount must be greater than 0.')

        const account = getAccount(config)
        const recipient = getAddress(to)
        const publicClient = publicClientFor(network)
        const walletClient = createWalletClient({ account, chain: chainFor(network), transport: http(rpcUrlFor(network)) })

        const balanceBefore = await publicClient.getBalance({ address: account.address })
        const gas = tightGas(await publicClient.estimateGas({ account, to: recipient, value }))
        const hash = await walletClient.sendTransaction({ account, chain: chainFor(network), to: recipient, value, gas })
        const receipt = await publicClient.waitForTransactionReceipt({ hash })

        return text({
          success: receipt.status === 'success',
          txHash: hash,
          from: account.address,
          to: recipient,
          amount: `${amount} MON`,
          network,
          blockNumber: Number(receipt.blockNumber),
          explorerUrl: explorerTxUrl(network, hash),
          warning:
            balanceBefore - value < RESERVE_MON
              ? 'Balance is now below Monad’s 10 MON reserve; keep gas-paying keys above it.'
              : undefined
        })
      } catch (err) {
        return fail(`Transfer failed: ${errMsg(err)}`)
      }
    }
  )
}
