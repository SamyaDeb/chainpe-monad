/**
 * ChainPeRegistry reader (read-only, viem).
 *
 * Reads service registrations from the on-chain `ChainPeRegistry` via the
 * paginated `getServices` view. Pure decode/filter/rank helpers are exported so
 * they can be unit-tested without an RPC connection.
 */
import { createWalletClient, erc20Abi, getAddress, http, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { publicClientFor, chainFor, rpcUrlFor, normalizeKey } from './networks.js'
import type {
  ChainPeNetwork,
  ChainPeService,
  DiscoverOptions,
  RankedService
} from './types.js'

const SERVICE_COMPONENTS = [
  { name: 'name', type: 'string' },
  { name: 'description', type: 'string' },
  { name: 'tags', type: 'string' },
  { name: 'endpoint', type: 'string' },
  { name: 'pricePerRequest', type: 'string' },
  { name: 'paymentToken', type: 'string' },
  { name: 'network', type: 'string' },
  { name: 'payTo', type: 'address' },
  { name: 'developer', type: 'address' },
  { name: 'agentId', type: 'uint256' },
  { name: 'createdAt', type: 'uint64' },
  { name: 'updatedAt', type: 'uint64' },
  { name: 'exists', type: 'bool' }
] as const

const REGISTRY_ABI = [
  {
    type: 'function',
    name: 'getServiceCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'getServices',
    stateMutability: 'view',
    inputs: [
      { name: 'offset', type: 'uint256' },
      { name: 'limit', type: 'uint256' }
    ],
    outputs: [{ name: 'page', type: 'tuple[]', components: SERVICE_COMPONENTS }]
  }
] as const

export interface RawService {
  name: string
  description: string
  tags: string
  endpoint: string
  pricePerRequest: string
  paymentToken: string
  network: string
  payTo: string
  developer: string
  agentId: bigint
  createdAt: bigint
  updatedAt: bigint
  exists: boolean
}

/** Decodes an on-chain service tuple into the public {@link ChainPeService}. */
export function decodeService(raw: RawService): ChainPeService {
  const createdAt = Number(raw.createdAt)
  const updatedAt = Number(raw.updatedAt)
  return {
    id: `${raw.developer}:${raw.name}`,
    name: raw.name,
    description: raw.description,
    tags: raw.tags
      .split(',')
      .map(t => t.trim())
      .filter(Boolean),
    endpoint: raw.endpoint,
    pricePerRequest: raw.pricePerRequest,
    paymentToken: (raw.paymentToken || 'USDC') as 'USDC',
    walletAddress: raw.payTo,
    network: (raw.network as ChainPeNetwork) ?? 'monad-testnet',
    developer: raw.developer,
    agentId: raw.agentId > 0n ? raw.agentId.toString() : undefined,
    createdAt: createdAt ? new Date(createdAt * 1000).toISOString() : undefined,
    updatedAt: updatedAt ? new Date(updatedAt * 1000).toISOString() : undefined
  }
}

/** Filters services by free-text query, tags, and max price. Pure. */
export function filterServices(
  services: ChainPeService[],
  options: DiscoverOptions
): ChainPeService[] {
  let results = [...services]
  if (options.query) {
    const q = options.query.toLowerCase()
    results = results.filter(
      s =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tags.some(tag => tag.toLowerCase().includes(q))
    )
  }
  if (options.tags?.length) {
    const tl = options.tags.map(t => t.toLowerCase())
    results = results.filter(s =>
      s.tags.some(tag => tl.includes(tag.toLowerCase()))
    )
  }
  if (options.maxPrice) {
    const max = parseFloat(options.maxPrice)
    results = results.filter(s => parseFloat(s.pricePerRequest) <= max)
  }
  return results
}

/**
 * Ranks services by reputation: scored before unscored, higher score first,
 * then more feedback, then cheaper. Stable for equal keys. Pure.
 */
export function rankByReputation(services: RankedService[]): RankedService[] {
  return [...services].sort((a, b) => {
    const sa = a.reputation?.score
    const sb = b.reputation?.score
    const aHas = sa != null
    const bHas = sb != null
    if (aHas !== bHas) return aHas ? -1 : 1
    if (aHas && bHas && sa !== sb) return sb - sa
    const ca = a.reputation?.count ?? 0
    const cb = b.reputation?.count ?? 0
    if (ca !== cb) return cb - ca
    return parseFloat(a.pricePerRequest) - parseFloat(b.pricePerRequest)
  })
}

/** Reads the on-chain ChainPeRegistry. */
export class RegistryClient {
  constructor(
    private readonly network: ChainPeNetwork,
    private readonly address: `0x${string}`
  ) {}

  getAddress(): string {
    return this.address
  }

  /** Lists ALL services via the paginated on-chain view (page size 100). */
  async listAllServices(): Promise<ChainPeService[]> {
    const client = publicClientFor(this.network)
    const count = (await client.readContract({
      address: this.address,
      abi: REGISTRY_ABI,
      functionName: 'getServiceCount'
    })) as bigint

    const total = Number(count)
    if (total === 0) return []

    const pageSize = 100
    const out: ChainPeService[] = []
    for (let offset = 0; offset < total; offset += pageSize) {
      const limit = Math.min(pageSize, total - offset)
      const page = (await client.readContract({
        address: this.address,
        abi: REGISTRY_ABI,
        functionName: 'getServices',
        args: [BigInt(offset), BigInt(limit)]
      })) as unknown as RawService[]
      for (const raw of page) out.push(decodeService(raw))
    }
    return out
  }
}

// ─── Writes (provider side) ──────────────────────────────────────────────────

const SERVICE_INPUT_COMPONENTS = [
  { name: 'name', type: 'string' },
  { name: 'description', type: 'string' },
  { name: 'tags', type: 'string' },
  { name: 'endpoint', type: 'string' },
  { name: 'pricePerRequest', type: 'string' },
  { name: 'paymentToken', type: 'string' },
  { name: 'network', type: 'string' },
  { name: 'payTo', type: 'address' },
  { name: 'agentId', type: 'uint256' }
] as const

const REGISTRY_WRITE_ABI = [
  {
    type: 'function',
    name: 'register',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'input', type: 'tuple', components: SERVICE_INPUT_COMPONENTS }],
    outputs: [{ name: 'key', type: 'bytes32' }]
  },
  {
    type: 'function',
    name: 'update',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'input', type: 'tuple', components: SERVICE_INPUT_COMPONENTS }],
    outputs: [{ name: 'key', type: 'bytes32' }]
  },
  {
    type: 'function',
    name: 'deregister',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: []
  },
  {
    type: 'function',
    name: 'hasService',
    stateMutability: 'view',
    inputs: [
      { name: 'developer', type: 'address' },
      { name: 'name', type: 'string' }
    ],
    outputs: [{ name: '', type: 'bool' }]
  },
  { type: 'function', name: 'registrationFee', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'updateFee', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'feeToken', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] }
] as const

export interface ServiceInput {
  name: string
  description: string
  tags: string[]
  endpoint: string
  /** Human USDC, e.g. "0.01". */
  pricePerRequest: string
  /** Address that receives payments (the 402 payTo). */
  payTo: string
  /** ERC-8004 agent id this service is linked to; "0"/undefined = unlinked. */
  agentId?: string
}

export interface RegisterResult {
  action: 'registered' | 'updated'
  txHash: Hex
  /** Fee approval tx, when one was needed. */
  approveTxHash?: Hex
}

/**
 * Writes to the ChainPeRegistry as a provider: register / update / deregister.
 * Approves the USDC fee first when the registry charges one.
 */
export class RegistryWriter {
  private readonly account
  constructor(
    private readonly network: ChainPeNetwork,
    private readonly address: `0x${string}`,
    privateKey: string
  ) {
    this.account = privateKeyToAccount(normalizeKey(privateKey))
  }

  getAddress(): `0x${string}` {
    return this.account.address
  }

  private wallet() {
    return createWalletClient({
      account: this.account,
      chain: chainFor(this.network),
      transport: http(rpcUrlFor(this.network))
    })
  }

  private toTuple(s: ServiceInput) {
    return {
      name: s.name,
      description: s.description,
      tags: s.tags.join(','),
      endpoint: s.endpoint,
      pricePerRequest: s.pricePerRequest,
      paymentToken: 'USDC',
      network: this.network,
      payTo: getAddress(s.payTo),
      agentId: BigInt(s.agentId && s.agentId !== '' ? s.agentId : '0')
    }
  }

  async exists(name: string): Promise<boolean> {
    return (await publicClientFor(this.network).readContract({
      address: this.address,
      abi: REGISTRY_WRITE_ABI,
      functionName: 'hasService',
      args: [this.account.address, name]
    })) as boolean
  }

  /** Registers the service, or updates it if this developer already listed that name. */
  async registerOrUpdate(service: ServiceInput): Promise<RegisterResult> {
    const pub = publicClientFor(this.network)
    const wallet = this.wallet()
    const chain = chainFor(this.network)
    const update = await this.exists(service.name)
    const fee = (await pub.readContract({
      address: this.address,
      abi: REGISTRY_WRITE_ABI,
      functionName: update ? 'updateFee' : 'registrationFee'
    })) as bigint

    let approveTxHash: Hex | undefined
    if (fee > 0n) {
      const token = (await pub.readContract({ address: this.address, abi: REGISTRY_WRITE_ABI, functionName: 'feeToken' })) as `0x${string}`
      const allowance = (await pub.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [this.account.address, this.address]
      })) as bigint
      if (allowance < fee) {
        approveTxHash = await wallet.writeContract({
          account: this.account,
          chain,
          address: token,
          abi: erc20Abi,
          functionName: 'approve',
          args: [this.address, fee]
        })
        await pub.waitForTransactionReceipt({ hash: approveTxHash })
      }
    }

    const txHash = await wallet.writeContract({
      account: this.account,
      chain,
      address: this.address,
      abi: REGISTRY_WRITE_ABI,
      functionName: update ? 'update' : 'register',
      args: [this.toTuple(service)]
    })
    await pub.waitForTransactionReceipt({ hash: txHash })
    return { action: update ? 'updated' : 'registered', txHash, approveTxHash }
  }

  async deregister(name: string): Promise<Hex> {
    const txHash = await this.wallet().writeContract({
      account: this.account,
      chain: chainFor(this.network),
      address: this.address,
      abi: REGISTRY_WRITE_ABI,
      functionName: 'deregister',
      args: [name]
    })
    await publicClientFor(this.network).waitForTransactionReceipt({ hash: txHash })
    return txHash
  }
}
