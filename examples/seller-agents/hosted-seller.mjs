// One seller service for a public host (Railway): a Monad backend behind the ChainPe x402 proxy
// on $PORT. It needs no funded or real key: the proxy only advertises the payTo address, and the
// services that read chain data (DIGEST, TRUST) use a throwaway key that never holds funds.
//   SERVICE=STATS|PRICE|DIGEST|TRUST  SELLER_ADDRESS=0x…  SELLER_AGENT_ID=2133
//   CHAINPE_FACILITATOR_URL=https://…  [CHAINPE_INDEXER_URL=https://…]  node hosted-seller.mjs
// Demo traffic between team-controlled wallets — never traction.
import http from 'node:http'
import { startProxyServer } from '@chainpemonad/cli'
import { ChainPe } from '@chainpemonad/sdk'
import { getAddress } from 'viem'
import { generatePrivateKey } from 'viem/accounts'
import { network, SERVICES } from './lib.mjs'
import { statsApp, priceApp, digestApp, trustApp } from './backends.mjs'

// SERVICE=ALL (default on the shared host) runs all four services, one ChainPe proxy each, behind a
// path router on $PORT: /stats, /quote, /digest, /report. Per service: <ID>_ADDRESS, <ID>_AGENT_ID.
// A single service: SERVICE=STATS with SELLER_ADDRESS / SELLER_AGENT_ID.
const mode = (process.env.SERVICE ?? 'STATS').toUpperCase()
const reader = () => new ChainPe({ privateKey: generatePrivateKey(), network }) // read-only, never funded
const builders = { STATS: statsApp, PRICE: priceApp, DIGEST: () => digestApp(reader()), TRUST: () => trustApp(reader()) }
const wanted = mode === 'ALL' ? SERVICES : SERVICES.filter(x => x.id === mode)
if (!wanted.length) throw new Error(`SERVICE must be ALL or one of ${SERVICES.map(x => x.id).join(', ')}`)
const publicPort = Number(process.env.PORT ?? wanted[0].port)
const routes = {}

for (const s of wanted) {
  const single = wanted.length === 1
  const payTo = getAddress((single ? process.env.SELLER_ADDRESS : undefined) ?? process.env[`${s.id}_ADDRESS`] ?? '')
  const agentId = (single ? process.env.SELLER_AGENT_ID : undefined) ?? process.env[`${s.id}_AGENT_ID`]
  const inner = s.port + 100
  const proxyPort = single ? publicPort : s.port
  await new Promise(r => builders[s.id]().listen(inner, '127.0.0.1', r))
  await startProxyServer({
    config: {
      serviceName: s.name, serviceDescription: s.description, tags: s.tags,
      targetUrl: `http://127.0.0.1:${inner}`, pricePerRequest: s.price, paymentToken: 'USDC',
      walletAddress: payTo, proxyPort, network,
      facilitatorUrl: process.env.CHAINPE_FACILITATOR_URL, ...(agentId ? { agentId } : {}), logLevel: 'normal'
    }
  })
  routes[s.path.split(/[/?]/)[1]] = proxyPort
  console.log(`✓ ${s.name} on :${proxyPort}  payTo ${payTo}  agentId ${agentId ?? '-'}`)
}

if (wanted.length > 1) {
  // Path router: the first path segment picks the service's proxy; the proxy still answers 402 itself.
  http.createServer((req, res) => {
    const seg = (req.url ?? '/').split(/[/?]/)[1]
    if (seg === 'health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ status: 'ok', service: 'chainpe-demo-sellers', network, routes: Object.keys(routes).map(k => '/' + k) }))
    }
    const port = routes[seg]
    if (!port) {
      res.writeHead(404, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ error: 'not found', routes: Object.keys(routes).map(k => '/' + k) }))
    }
    const up = http.request({ host: '127.0.0.1', port, path: req.url, method: req.method, headers: req.headers }, r => {
      res.writeHead(r.statusCode ?? 502, r.headers)
      r.pipe(res)
    })
    up.on('error', () => { res.writeHead(502); res.end() })
    req.pipe(up)
  }).listen(publicPort, () => console.log(`✓ router on :${publicPort} → ${JSON.stringify(routes)}`))
}
