import { z } from 'zod'
import { createWalletClient, http, erc20Abi, getAddress, parseUnits } from 'viem'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { chainFor, explorerTxUrl, getUsdcAddress, publicClientFor, rpcUrlFor } from '@chainpemonad/sdk'
import type { AppConfig } from '../types.js'
import type { SpendingTracker } from '../spending.js'
import { getAccount, NO_WALLET_MESSAGE, tightGas, USDC_DECIMALS } from '../clients.js'
import { errMsg, fail, text } from './util.js'

export function registerTransferUsdc(server: McpServer, config: AppConfig, spending: SpendingTracker): void {
  server.tool(
    'transfer_usdc',
    'Send USDC directly on-chain from your Monad wallet to another address. This is a real ERC-20 ' +
      'transfer (costs MON gas) — NOT an x402 payment. Counts against the daily budget.',
    {
      to: z.string().describe('Recipient EVM address (0x…)'),
      amount: z.string().describe('USDC amount as decimal string, e.g. "1.50"')
    },
    async ({ to, amount }) => {
      if (!config.privateKey) return fail(NO_WALLET_MESSAGE)
      try {
        const network = config.network
        const value = parseUnits(amount, USDC_DECIMALS)
        if (value <= 0n) return fail('Amount must be greater than 0.')
        spending.check(amount)

        const account = getAccount(config)
        const recipient = getAddress(to)
        const publicClient = publicClientFor(network)
        const walletClient = createWalletClient({ account, chain: chainFor(network), transport: http(rpcUrlFor(network)) })

        const request = { address: getUsdcAddress(network), abi: erc20Abi, functionName: 'transfer', args: [recipient, value], account } as const
        const gas = tightGas(await publicClient.estimateContractGas(request))
        const hash = await walletClient.writeContract({ ...request, chain: chainFor(network), gas })

        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        if (receipt.status === 'success') spending.record(amount, recipient, network, hash)

        return text({
          success: receipt.status === 'success',
          txHash: hash,
          from: account.address,
          to: recipient,
          amount: `${amount} USDC`,
          network,
          blockNumber: Number(receipt.blockNumber),
          explorerUrl: explorerTxUrl(network, hash)
        })
      } catch (err) {
        return fail(`Transfer failed: ${errMsg(err)}`)
      }
    }
  )
}
