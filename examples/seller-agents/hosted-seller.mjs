// One seller service for a public host (Railway): the Monad network-stats backend behind the
// ChainPe x402 proxy on $PORT. It needs no private key: the proxy only advertises the payTo address.
//   SELLER_ADDRESS=0x…  SELLER_AGENT_ID=2133  CHAINPE_FACILITATOR_URL=https://…  node hosted-seller.mjs
// Demo traffic between team-controlled wallets — never traction.
import { startProxyServer } from '@chainpemonad/cli'
import { getAddress } from 'viem'
import { network, SERVICES } from './lib.mjs'
import { statsApp } from './backends.mjs'

const s = SERVICES.find(x => x.id === 'STATS')
const payTo = getAddress(process.env.SELLER_ADDRESS ?? '')
const agentId = process.env.SELLER_AGENT_ID
const port = Number(process.env.PORT ?? s.port)
const inner = 4700

await new Promise(r => statsApp().listen(inner, '127.0.0.1', r))
await startProxyServer({
  config: {
    serviceName: s.name, serviceDescription: s.description, tags: s.tags,
    targetUrl: `http://127.0.0.1:${inner}`, pricePerRequest: s.price, paymentToken: 'USDC',
    walletAddress: payTo, proxyPort: port, network,
    facilitatorUrl: process.env.CHAINPE_FACILITATOR_URL, ...(agentId ? { agentId } : {}), logLevel: 'normal'
  }
})
console.log(`✓ ${s.name} listening on :${port}  payTo ${payTo}  agentId ${agentId ?? '-'}`)
