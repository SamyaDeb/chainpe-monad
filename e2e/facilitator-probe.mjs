#!/usr/bin/env node
/**
 * Interop probe: does a facilitator understand ChainPe's x402 v2 payments?
 * Signs a payment with a RANDOM throwaway key and calls only /supported and
 * /verify — nothing is settled and no funds move. A facilitator that parses the
 * payment will answer "insufficient funds" for the empty throwaway wallet.
 *
 *   FACILITATOR_URL=https://x402-facilitator.molandak.org NETWORK=monad-testnet node e2e/facilitator-probe.mjs
 */
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { x402Client, x402HTTPClient } from '@x402/core/client'
import { ExactEvmScheme } from '@x402/evm/exact/client'
import { NETWORKS, isChainPeNetwork } from '@chainpeavax/sdk'

const url = (process.env.FACILITATOR_URL ?? 'https://x402-facilitator.molandak.org').replace(/\/$/, '')
const network = process.env.NETWORK ?? 'monad-testnet'
if (!isChainPeNetwork(network)) throw new Error(`Unknown NETWORK ${network}`)
const net = NETWORKS[network]

const supported = await (await fetch(`${url}/supported`)).json()
const kind = supported.kinds.find(k => k.scheme === 'exact' && k.network === net.caip2)
console.log(`supported: exact on ${net.caip2}? ${kind ? 'YES' : 'NO'}`)

const requirements = {
  scheme: 'exact',
  network: net.caip2,
  asset: net.usdc.address,
  amount: '10000',
  payTo: '0x1111111111111111111111111111111111111111',
  maxTimeoutSeconds: 60,
  extra: { name: net.usdc.eip712Name, version: net.usdc.eip712Version }
}
const account = privateKeyToAccount(generatePrivateKey())
const client = new x402Client().register(net.caip2, new ExactEvmScheme(account)).setSpendControls(false)
const payload = await new x402HTTPClient(client).createPaymentPayload({
  x402Version: 2,
  resource: { url: 'https://example.com/probe' },
  accepts: [requirements]
})
const res = await fetch(`${url}/verify`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: requirements })
})
console.log(`verify: HTTP ${res.status}`, await res.text())
