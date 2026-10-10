// Generate demo wallets into the git-ignored .env.sellers. Prints ADDRESSES only, never keys.
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { envFile, loadEnv, saveVar, SERVICES } from './lib.mjs'

const env = loadEnv()
const roles = ['BUYER', 'FACILITATOR', ...SERVICES.map(s => s.id)]
for (const r of roles) {
  if (!env[`${r}_KEY`]) saveVar(`${r}_KEY`, generatePrivateKey())
}
const now = loadEnv()
console.log(`keys stored in ${envFile} (mode 600, git-ignored)`)
for (const r of roles) console.log(r.padEnd(12), privateKeyToAccount(now[`${r}_KEY`]).address)
