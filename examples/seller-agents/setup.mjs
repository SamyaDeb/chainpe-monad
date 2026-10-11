// Mint an ERC-8004 agentId per service on the canonical Identity Registry and register the
// service in ChainPeRegistry (the registry enforces that the caller owns the agentId).
//   ENDPOINT_BASE=http://localhost node setup.mjs
import { createWalletClient, http, parseEventLogs } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { RegistryWriter, chainFor, explorerTxUrl, publicClientFor, resolveIdentityRegistry, resolveRegistryAddress, rpcUrlFor } from '@chainpemonad/sdk'
import { network, loadEnv, saveVar, SERVICES } from './lib.mjs'

const ABI = [
  { type: 'function', name: 'register', stateMutability: 'nonpayable', inputs: [{ name: 'agentURI', type: 'string' }], outputs: [{ name: 'agentId', type: 'uint256' }] },
  { type: 'event', name: 'Registered', inputs: [{ name: 'agentId', type: 'uint256', indexed: true }, { name: 'agentURI', type: 'string', indexed: false }, { name: 'owner', type: 'address', indexed: true }] }
]
const base = process.env.ENDPOINT_BASE ?? 'http://localhost'
const pub = publicClientFor(network)
const env = loadEnv()
const only = process.env.ONLY?.split(',')
const retry = async fn => { for (let i = 0; ; i++) try { return await fn() } catch (e) { if (i >= 5) throw e; await new Promise(r => setTimeout(r, 3000)) } } // RPC nodes lag right after funding
for (const s of SERVICES.filter(s => !only || only.includes(s.id))) {
  const key = env[`${s.id}_KEY`]
  const account = privateKeyToAccount(key)
  let agentId = env[`${s.id}_AGENT_ID`]
  if (!agentId) {
    const client = createWalletClient({ account, chain: chainFor(network), transport: http(rpcUrlFor(network)) })
    const hash = await retry(() => client.writeContract({ address: resolveIdentityRegistry(network), abi: ABI, functionName: 'register',
      args: [`https://github.com/SamyaDeb/chainpe-monad#${s.name}`] }))
    const r = await pub.waitForTransactionReceipt({ hash })
    agentId = parseEventLogs({ abi: ABI, eventName: 'Registered', logs: r.logs })[0].args.agentId.toString()
    saveVar(`${s.id}_AGENT_ID`, agentId)
    console.log(`${s.name}: minted agentId ${agentId} ${explorerTxUrl(network, hash)}`)
  }
  const w = new RegistryWriter(network, resolveRegistryAddress(network), key)
  const res = await retry(() => w.registerOrUpdate({ name: s.name, description: s.description + ' [demo seller]', tags: s.tags,
    endpoint: `${base}:${s.port}`, pricePerRequest: s.price, payTo: account.address, agentId }))
  await pub.waitForTransactionReceipt({ hash: res.txHash })
  console.log(`${s.name}: ${res.action} ${explorerTxUrl(network, res.txHash)}`)
}
