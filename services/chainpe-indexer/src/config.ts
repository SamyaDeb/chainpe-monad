import 'dotenv/config'
import { getAddress } from 'viem'

export type Network = 'fuji' | 'avalanche'

export const NETWORK: Network =
  process.env.NETWORK === 'avalanche' ? 'avalanche' : 'fuji'

export const RPC_URL =
  process.env.RPC_URL ??
  (NETWORK === 'avalanche'
    ? 'https://api.avax.network/ext/bc/C/rpc'
    : 'https://api.avax-test.network/ext/bc/C/rpc')

const DEFAULT_REGISTRY: Record<Network, string | undefined> = {
  fuji: '0x91677a35599f052E99Ed0ab9E45c17E736a22Bf6',
  avalanche: undefined
}
const DEFAULT_REPUTATION: Record<Network, string | undefined> = {
  fuji: '0x89476DfEf9c72a668fa5E86f154B73EDB053aFe4',
  avalanche: undefined
}

function resolve(envValue: string | undefined, fallback: string | undefined, label: string): `0x${string}` {
  const candidate = envValue ?? fallback
  if (!candidate) throw new Error(`${label} address not set for network "${NETWORK}".`)
  return getAddress(candidate)
}

export const REGISTRY_ADDRESS = resolve(
  process.env.CHAINPE_REGISTRY_ADDRESS,
  DEFAULT_REGISTRY[NETWORK],
  'ChainPeRegistry'
)
export const REPUTATION_ADDRESS = resolve(
  process.env.ERC8004_REPUTATION_REGISTRY,
  DEFAULT_REPUTATION[NETWORK],
  'ERC-8004 Reputation Registry'
)

/** Postgres connection string — required at runtime (not for typecheck/tests). */
export const DATABASE_URL = process.env.DATABASE_URL ?? ''

export const PORT = Number(process.env.PORT ?? 4600)
export const START_BLOCK = BigInt(process.env.START_BLOCK ?? '0')
export const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 5000)
/** Max block span per getLogs request (public RPCs cap this). */
export const LOG_CHUNK = BigInt(process.env.LOG_CHUNK ?? '2000')
