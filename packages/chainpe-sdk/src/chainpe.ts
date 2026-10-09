/**
 * ChainPe — x402 payments + ERC-8004 reputation in a few lines.
 *
 *   const cp = new ChainPe({ privateKey, network: 'monad-testnet' })
 *   const res = await cp.fetch('https://api.example.com/paid')   // auto-pays a 402
 *   const data = await res.json()
 */
import { erc20Abi, formatUnits, parseUnits, getAddress } from 'viem'
import { privateKeyToAccount, type LocalAccount } from 'viem/accounts'
import {
  publicClientFor,
  getUsdcAddress,
  resolveRegistryAddress,
  resolveReputationRegistry,
  resolvePolicyVault,
  normalizeKey,
  DEFAULT_NETWORK,
  USDC_DECIMALS
} from './networks.js'
import { RegistryClient, filterServices, rankByReputation } from './registry.js'
import { getReputation, giveFeedback } from './reputation.js'
import { paidFetch, type PaidRequest, type VaultPaymentOptions } from './payment.js'
import type {
  ChainPeNetwork,
  ChainPeOptions,
  FetchOptions,
  DiscoverOptions,
  RankedService,
  ReputationSummary,
  PaidResult,
  Balances
} from './types.js'

export class ChainPe {
  readonly network: ChainPeNetwork
  readonly registryAddress: `0x${string}`
  readonly reputationRegistry?: `0x${string}`

  private readonly privateKey: string
  private readonly signerAccount: LocalAccount
  private readonly account: `0x${string}`
  private readonly maxPerCallAtomic: bigint
  private readonly autoFeedback: boolean
  private readonly facilitatorUrl?: string
  private readonly vault?: VaultPaymentOptions

  constructor(options: ChainPeOptions) {
    if (!options.privateKey) {
      throw new Error('ChainPe: `privateKey` is required.')
    }
    this.privateKey = options.privateKey
    this.network = options.network ?? DEFAULT_NETWORK
    this.registryAddress = resolveRegistryAddress(
      this.network,
      options.registryAddress
    )
    this.reputationRegistry = resolveReputationRegistry(
      this.network,
      options.reputationRegistry
    )
    this.signerAccount = privateKeyToAccount(normalizeKey(this.privateKey))
    this.account = this.signerAccount.address
    this.maxPerCallAtomic = parseUnits(
      options.maxPerCall ?? '1',
      USDC_DECIMALS
    )
    this.autoFeedback = options.autoFeedback ?? false
    this.facilitatorUrl = options.facilitatorUrl
    if (options.policyVault) {
      const pv = options.policyVault
      const vaultAddress = resolvePolicyVault(this.network, pv.vaultAddress)
      if (!vaultAddress) throw new Error(`ChainPe: no PolicyVault known for ${this.network}; pass policyVault.vaultAddress.`)
      if (!pv.owner) throw new Error('ChainPe: policyVault.owner is required.')
      this.vault = {
        vaultAddress,
        owner: getAddress(pv.owner),
        sessionKey: pv.sessionKey ? privateKeyToAccount(normalizeKey(pv.sessionKey)) : this.signerAccount,
        fallbackToExact: pv.fallbackToExact ?? false,
        readNonce: pv.readNonce
      }
    }
  }

  /** Echoes the resolved configuration (no secrets). */
  get config() {
    return {
      network: this.network,
      address: this.account,
      registryAddress: this.registryAddress,
      reputationRegistry: this.reputationRegistry,
      facilitatorUrl: this.facilitatorUrl,
      maxPerCall: formatUnits(this.maxPerCallAtomic, USDC_DECIMALS),
      policyVault: this.vault
        ? {
            vaultAddress: this.vault.vaultAddress,
            owner: this.vault.owner,
            sessionKey: this.vault.sessionKey.address,
            fallbackToExact: this.vault.fallbackToExact
          }
        : undefined
    }
  }

  /** The wallet address that signs payments and feedback. */
  getAddress(): string {
    return this.account
  }

  /** Reads on-chain USDC + MON balances (human units). */
  async balance(): Promise<Balances> {
    const client = publicClientFor(this.network)
    const address = getAddress(this.account)
    const [usdcRaw, wei] = await Promise.all([
      client
        .readContract({
          address: getUsdcAddress(this.network),
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address]
        })
        .catch(() => 0n) as Promise<bigint>,
      client.getBalance({ address }).catch(() => 0n)
    ])
    return {
      usdc: formatUnits(usdcRaw, USDC_DECIMALS),
      mon: formatUnits(wei, 18)
    }
  }

  /**
   * Drop-in `fetch` that automatically pays an x402 `402 Payment Required`
   * (USDC via EIP-3009, x402 v2) and returns the final live {@link Response}.
   */
  async fetch(url: string, opts: FetchOptions = {}): Promise<Response> {
    const { result, autoFeedback } = await this.execute(url, opts)
    if (result.payment && (autoFeedback ?? this.autoFeedback)) {
      await this.tryAutoFeedback(url, result.payment.txHash, result.payTo, result.agentId)
    }
    return result.response
  }

  /**
   * Like {@link fetch}, but returns a structured, body-parsed result with the
   * payment + (optional) reputation details. Convenient for agents.
   */
  async pay<T = unknown>(
    url: string,
    opts: FetchOptions = {}
  ): Promise<PaidResult<T>> {
    const { result, autoFeedback } = await this.execute(url, opts)
    const { response } = result

    let reputation: PaidResult<T>['reputation']
    if (result.payment && (autoFeedback ?? this.autoFeedback)) {
      reputation = await this.tryAutoFeedback(url, result.payment.txHash, result.payTo, result.agentId)
    }

    const data = (await this.parseBody(response)) as T
    return {
      status: response.status,
      ok: response.ok,
      headers: headersToObject(response.headers),
      data,
      payment: result.payment,
      reputation
    }
  }

  /**
   * Discovers registered services, annotated with ERC-8004 reputation and
   * ranked (scored first, higher score first). Pass a search string or filters.
   */
  async discover(
    query: string | DiscoverOptions = {}
  ): Promise<RankedService[]> {
    const options: DiscoverOptions =
      typeof query === 'string' ? { query } : query
    const registry = new RegistryClient(this.network, this.registryAddress)
    const services = filterServices(await registry.listAllServices(), options)

    const ranked: RankedService[] = await Promise.all(
      services.map(async s => ({
        ...s,
        reputation: s.agentId
          ? await getReputation(
              this.network,
              this.reputationRegistry,
              s.agentId
            )
          : null
      }))
    )
    return rankByReputation(ranked)
  }

  /** Reads a provider agent's aggregate ERC-8004 reputation. */
  async getReputation(agentId: string): Promise<ReputationSummary | null> {
    return getReputation(this.network, this.reputationRegistry, agentId)
  }

  /**
   * Posts receipt-backed ERC-8004 feedback (0–100) for a provider agent on the
   * canonical Reputation Registry. `paymentTxHash` is the x402 settlement tx of
   * the call being rated (`PaidResult.payment.txHash`); it becomes the
   * `feedbackHash`, so indexers can prove the rating came from a paying client.
   * Returns the feedback tx hash.
   */
  async giveFeedback(params: {
    agentId: string
    value: number
    paymentTxHash: string
    endpoint?: string
    waitConfirm?: boolean
  }): Promise<string> {
    return giveFeedback(
      this.network,
      this.reputationRegistry,
      this.privateKey,
      params
    )
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  /**
   * Runs the x402 v2 flow (see payment.ts) so we can surface the payment
   * metadata and the `payTo` (needed to resolve the provider's agent for feedback).
   */
  private async execute(
    url: string,
    opts: FetchOptions
  ): Promise<{ result: PaidRequest & { payTo?: string }; autoFeedback?: boolean }> {
    const { autoFeedback, timeout = 30_000, ...init } = opts
    const paid = await paidFetch({
      url,
      init,
      network: this.network,
      account: this.signerAccount,
      maxPerCallAtomic: this.maxPerCallAtomic,
      timeoutMs: timeout,
      vault: this.vault
    })
    return { result: { ...paid, payTo: paid.accepted?.payTo }, autoFeedback }
  }

  /**
   * Best-effort positive feedback for the provider's agent after a paid call.
   * Prefers the agent id advertised on the 402 (3b); otherwise resolves it by
   * matching `payTo` (then URL prefix) against the registry. Skipped when the
   * provider reported no settlement tx (nothing to back the rating). Never throws
   * (self-feedback, no agentId, etc. are swallowed).
   */
  private async tryAutoFeedback(
    url: string,
    paymentTxHash: string | undefined,
    payTo?: string,
    advertisedAgentId?: string
  ): Promise<{ agentId: string; score: number; txHash: string } | undefined> {
    try {
      if (!this.reputationRegistry) return undefined
      // No settlement tx → no receipt → no rating.
      if (!paymentTxHash) return undefined

      let agentId = advertisedAgentId
      let endpoint: string | undefined

      // No advertised id → fall back to a registry scan by payTo / URL.
      if (!agentId || agentId === '0') {
        const registry = new RegistryClient(this.network, this.registryAddress)
        const services = await registry.listAllServices()
        const svc =
          (payTo &&
            services.find(
              s =>
                s.walletAddress.toLowerCase() === payTo.toLowerCase() &&
                s.agentId
            )) ||
          services.find(s => url.startsWith(s.endpoint) && s.agentId)
        agentId = svc?.agentId
        endpoint = svc?.endpoint
      }

      if (!agentId || agentId === '0') return undefined
      const txHash = await giveFeedback(
        this.network,
        this.reputationRegistry,
        this.privateKey,
        {
          agentId,
          value: 100,
          paymentTxHash,
          endpoint: endpoint ?? new URL(url).origin
        }
      )
      return { agentId, score: 100, txHash }
    } catch {
      return undefined
    }
  }

  private async parseBody(response: Response): Promise<unknown> {
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
}

function headersToObject(headers: Headers): Record<string, string> {
  const obj: Record<string, string> = {}
  headers.forEach((value, key) => {
    obj[key] = value
  })
  return obj
}
