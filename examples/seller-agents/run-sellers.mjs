// Start the 4 Monad services, each behind a ChainPe x402 proxy (same gateway as `chainpe start`).
//   node run-sellers.mjs        (needs gen-wallets + setup first; CHAINPE_FACILITATOR_URL on mainnet)
import { ChainPe } from '@chainpeavax/sdk'
import { startProxyServer } from '@chainpeavax/cli'
import { privateKeyToAccount } from 'viem/accounts'
import { network, loadEnv, SERVICES } from './lib.mjs'
import { statsApp, priceApp, digestApp, trustApp } from './backends.mjs'

const env = loadEnv()
const cp = new ChainPe({ privateKey: env.BUYER_KEY, network })
const apps = { STATS: statsApp(), PRICE: priceApp(), DIGEST: digestApp(cp), TRUST: trustApp(cp) }
for (const s of SERVICES) {
  await new Promise(r => apps[s.id].listen(s.port + 100, '127.0.0.1', r))
  const agentId = env[`${s.id}_AGENT_ID`]
  await startProxyServer({
    config: {
      serviceName: s.name, serviceDescription: s.description, tags: s.tags,
      targetUrl: `http://127.0.0.1:${s.port + 100}`, pricePerRequest: s.price, paymentToken: 'USDC',
      walletAddress: privateKeyToAccount(env[`${s.id}_KEY`]).address, proxyPort: s.port, network,
      facilitatorUrl: process.env.CHAINPE_FACILITATOR_URL, ...(agentId ? { agentId } : {}), logLevel: 'normal'
    }
  })
  console.log(`✓ ${s.name} → http://localhost:${s.port}${s.path}  ${s.price} USDC/call  agentId ${agentId ?? '-'}`)
}
