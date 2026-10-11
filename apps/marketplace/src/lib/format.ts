import { explorerAddressUrl, explorerTxUrl, getNetwork, isChainPeNetwork, type ChainPeNetwork } from '@chainpemonad/sdk'

const net = (network: string): ChainPeNetwork => (isChainPeNetwork(network) ? network : 'monad-testnet')

export const txUrl = (network: string, hash: string) => explorerTxUrl(net(network), hash)
export const addressUrl = (network: string, address: string) => explorerAddressUrl(net(network), address)

export const short = (hex: string, head = 6, tail = 4) =>
  hex.length > head + tail + 2 ? `${hex.slice(0, head)}…${hex.slice(-tail)}` : hex

export const score = (n: number | null | undefined) => (n == null ? '—' : String(Math.round(n * 100) / 100))

/** "0.0123" USDC → "0.0123 USDC"; trailing zeros dropped. */
export const usdc = (v: string | null | undefined) => (v == null ? '—' : `${String(Number(v))} USDC`)

export function when(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
}

export const snapshotDate = (iso: string) => new Date(iso).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'

/** Why the indexer left a rating out of the paid score, in words. */
export const REASONS: Record<string, string> = {
  no_receipt: 'no payment receipt cited',
  receipt_reused: 'receipt already backs another rating',
  self_dealing: "rater is the agent's owner, developer or payee (self-dealing)",
  tx_not_found: 'cited tx does not exist',
  tx_reverted: 'cited tx reverted',
  no_matching_transfer: 'cited tx has no USDC payment from the rater to this service',
  below_minimum: 'payment below the indexer minimum',
  no_registered_service: 'agent has no registered service'
}

export const reasonText = (r: string | null) => (r ? (REASONS[r] ?? r) : 'not verified yet')

/** Canonical ERC-8004 + ChainPe contract addresses for a network (from the SDK). */
export const contracts = (network: string) => {
  const n = getNetwork(net(network))
  return { identity: n.erc8004.identityRegistry, reputation: n.erc8004.reputationRegistry, registry: n.chainPeRegistry }
}
