/**
 * The gas-paying settlement signer.
 *
 * Transactions are submitted one at a time from a local nonce manager: two
 * settlements racing for the same nonce would make one of them fail (and on
 * Monad a transaction that reverts still pays for its full gas limit).
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  nonceManager,
  type PublicClient
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { toFacilitatorEvmSigner, type FacilitatorEvmSigner } from '@x402/evm'
import type { FacilitatorConfig } from './config.js'

/** Runs async tasks strictly one after another. */
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve()
  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task, task)
    tail = run.catch(() => undefined)
    return run
  }
}

export interface SettlementSigner {
  address: `0x${string}`
  signer: FacilitatorEvmSigner
  publicClient: PublicClient
}

export function createSettlementSigner(cfg: FacilitatorConfig): SettlementSigner {
  const account = privateKeyToAccount(cfg.privateKey, { nonceManager })
  const transport = http(cfg.rpcUrl)
  const publicClient = createPublicClient({ chain: cfg.chain, transport }) as PublicClient
  const wallet = createWalletClient({ account, chain: cfg.chain, transport })
  const submit = createSerialQueue()

  const signer = toFacilitatorEvmSigner(
    {
      address: account.address,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      readContract: args => publicClient.readContract(args as any),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      verifyTypedData: args => publicClient.verifyTypedData(args as any),
      writeContract: args =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        submit(() => wallet.writeContract({ ...(args as any), account, chain: cfg.chain })),
      sendTransaction: args => submit(() => wallet.sendTransaction({ ...args, account, chain: cfg.chain })),
      waitForTransactionReceipt: args => publicClient.waitForTransactionReceipt(args),
      getCode: args => publicClient.getCode(args)
    },
    { confirmationTimeoutMs: 30_000 }
  )

  return { address: account.address, signer, publicClient }
}
