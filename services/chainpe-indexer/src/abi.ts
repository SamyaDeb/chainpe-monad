/** Event ABIs watched by the indexer (ChainPeRegistry + canonical ERC-8004 Reputation on Monad). */

export const REGISTRY_EVENTS = [
  {
    type: 'event',
    name: 'ServiceRegistered',
    inputs: [
      { name: 'key', type: 'bytes32', indexed: true },
      { name: 'developer', type: 'address', indexed: true },
      { name: 'name', type: 'string', indexed: false },
      { name: 'endpoint', type: 'string', indexed: false },
      { name: 'pricePerRequest', type: 'string', indexed: false },
      { name: 'paymentToken', type: 'string', indexed: false },
      { name: 'payTo', type: 'address', indexed: false },
      { name: 'agentId', type: 'uint256', indexed: true }
    ]
  },
  {
    type: 'event',
    name: 'ServiceUpdated',
    inputs: [
      { name: 'key', type: 'bytes32', indexed: true },
      { name: 'developer', type: 'address', indexed: true },
      { name: 'name', type: 'string', indexed: false },
      { name: 'endpoint', type: 'string', indexed: false },
      { name: 'pricePerRequest', type: 'string', indexed: false },
      { name: 'paymentToken', type: 'string', indexed: false },
      { name: 'payTo', type: 'address', indexed: false },
      { name: 'agentId', type: 'uint256', indexed: true }
    ]
  },
  {
    type: 'event',
    name: 'ServiceDeregistered',
    inputs: [
      { name: 'key', type: 'bytes32', indexed: true },
      { name: 'developer', type: 'address', indexed: true },
      { name: 'name', type: 'string', indexed: false }
    ]
  }
] as const

/** Read-only `getService` view — used to enrich rows with description + tags
 * (which the events omit). */
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

export const REGISTRY_READ_ABI = [
  {
    type: 'function',
    name: 'getService',
    stateMutability: 'view',
    inputs: [
      { name: 'developer', type: 'address' },
      { name: 'name', type: 'string' }
    ],
    outputs: [{ name: '', type: 'tuple', components: SERVICE_COMPONENTS }]
  }
] as const

export const REPUTATION_EVENTS = [
  {
    type: 'event',
    name: 'NewFeedback',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'clientAddress', type: 'address', indexed: true },
      { name: 'feedbackIndex', type: 'uint64', indexed: false },
      { name: 'value', type: 'int128', indexed: false },
      { name: 'valueDecimals', type: 'uint8', indexed: false },
      { name: 'indexedTag1', type: 'string', indexed: true },
      { name: 'tag1', type: 'string', indexed: false },
      { name: 'tag2', type: 'string', indexed: false },
      { name: 'endpoint', type: 'string', indexed: false },
      { name: 'feedbackURI', type: 'string', indexed: false },
      { name: 'feedbackHash', type: 'bytes32', indexed: false }
    ]
  },
  {
    type: 'event',
    name: 'FeedbackRevoked',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'clientAddress', type: 'address', indexed: true },
      { name: 'feedbackIndex', type: 'uint64', indexed: true }
    ]
  }
] as const

/** USDC `Transfer` — the payment evidence inside a settlement receipt. */
export const TRANSFER_EVENT = [
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false }
    ]
  }
] as const

/** Canonical ERC-8004 Identity Registry views used for self-dealing checks. */
export const IDENTITY_READ_ABI = [
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }]
  },
  {
    type: 'function',
    name: 'getAgentWallet',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }]
  }
] as const

/** PolicyVault: the `Spent` receipt of an x402 `chainpe-vault` payment, and `spend` (to recover its signer). */
export const VAULT_SPENT_EVENT = [
  {
    type: 'event',
    name: 'Spent',
    inputs: [
      { name: 'owner', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'relayer', type: 'address', indexed: true },
      { name: 'nonce', type: 'uint256', indexed: false }
    ]
  }
] as const

export const VAULT_SPEND_FN = [
  {
    type: 'function',
    name: 'spend',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'sessionSig', type: 'bytes' }
    ],
    outputs: []
  }
] as const

export const VAULT_SPEND_TYPES = {
  Spend: [
    { name: 'owner', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' }
  ]
} as const
