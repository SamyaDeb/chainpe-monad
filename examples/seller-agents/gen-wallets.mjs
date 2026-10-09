/**
 * Generate 4 demo wallets and print a ready-to-paste .env block.
 *
 * Run once: node gen-wallets.mjs
 * Then paste the output into .env and fund the wallets per the instructions.
 */
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const roles = [
  { key: 'CHAINPE_PRIVATE_KEY',    payto: 'BUYER_ADDRESS',        name: 'Buyer (orchestrator)'   },
  { key: 'CHAINPE_FACILITATOR_KEY',payto: 'FACILITATOR_ADDRESS',  name: 'Facilitator (gas)'      },
  { key: 'RESEARCH_PAYTO_KEY',     payto: 'RESEARCH_PAYTO',       name: 'Research Seller'        },
  { key: 'DIGEST_PAYTO_KEY',       payto: 'DIGEST_PAYTO',         name: 'News Digest Seller'     },
  { key: 'PRICE_PAYTO_KEY',        payto: 'PRICE_PAYTO',          name: 'AVAX Price Agent'       },
  { key: 'NEWS_PAYTO_KEY',         payto: 'NEWS_PAYTO',           name: 'AVAX News Agent'        },
  { key: 'ANALYSIS_PAYTO_KEY',     payto: 'ANALYSIS_PAYTO',       name: 'AVAX Analysis Agent'    },
  { key: 'DEX_PAYTO_KEY',          payto: 'DEX_PAYTO',            name: 'AVAX DEX Agent'         },
]

const wallets = roles.map(r => {
  const privateKey = generatePrivateKey()
  const { address } = privateKeyToAccount(privateKey)
  return { ...r, privateKey, address }
})

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('  ChainPe demo wallets — SAVE THESE PRIVATELY')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

for (const w of wallets) {
  console.log(`${w.name}`)
  console.log(`  Address:     ${w.address}`)
  console.log(`  Private key: ${w.privateKey}`)
  console.log()
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('  Fund these wallets on Fuji BEFORE continuing:')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

const buyer       = wallets[0]
const facilitator = wallets[1]
const research    = wallets[2]
const digest      = wallets[3]
const price       = wallets[4]
const news        = wallets[5]
const analysis    = wallets[6]
const dex         = wallets[7]

console.log('AVAX (gas) — https://core.app/tools/testnet-faucet/')
console.log(`  ${facilitator.address}  ← Facilitator  (need ~0.5 AVAX)`)
console.log(`  ${research.address}  ← Research Seller (need ~0.05 AVAX)`)
console.log(`  ${digest.address}  ← Digest Seller   (need ~0.05 AVAX)`)
console.log(`  ${price.address}  ← Price Agent     (need ~0.05 AVAX)`)
console.log(`  ${news.address}  ← News Agent      (need ~0.05 AVAX)`)
console.log(`  ${analysis.address}  ← Analysis Agent  (need ~0.05 AVAX)`)
console.log(`  ${dex.address}  ← DEX Agent       (need ~0.1 AVAX for swaps)`)
console.log()
console.log('USDC — https://faucet.circle.com  (select "Avalanche Fuji")')
console.log(`  ${buyer.address}  ← Buyer (need ~5 USDC for fees + trades)`)
console.log()

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('  Paste this block into .env:')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

const envBlock = `
# ─── Buyer (orchestrator / investment fund manager) ──────────────────────
CHAINPE_PRIVATE_KEY=${buyer.privateKey}

# ─── Facilitator (gas wallet) ────────────────────────────────────────────
CHAINPE_FACILITATOR_KEY=${facilitator.privateKey}

# ─── Original demo sellers ────────────────────────────────────────────────
RESEARCH_PAYTO=${research.address}
RESEARCH_PAYTO_KEY=${research.privateKey}
DIGEST_PAYTO=${digest.address}
DIGEST_PAYTO_KEY=${digest.privateKey}

# ─── Investment agents ────────────────────────────────────────────────────
PRICE_PAYTO=${price.address}
PRICE_PAYTO_KEY=${price.privateKey}
NEWS_PAYTO=${news.address}
NEWS_PAYTO_KEY=${news.privateKey}
ANALYSIS_PAYTO=${analysis.address}
ANALYSIS_PAYTO_KEY=${analysis.privateKey}
DEX_PAYTO=${dex.address}
DEX_PAYTO_KEY=${dex.privateKey}
# DEX_WALLET_KEY — wallet that signs actual Trader Joe swaps (can reuse DEX_PAYTO_KEY)
DEX_WALLET_KEY=${dex.privateKey}

# ─── LLM ─────────────────────────────────────────────────────────────────
ANTHROPIC_API_KEY=sk-ant-...

# ─── Network + contracts (Fuji) ───────────────────────────────────────────
CHAINPE_NETWORK=fuji
CHAINPE_REGISTRY_ADDRESS=0x91677a35599f052E99Ed0ab9E45c17E736a22Bf6
ERC8004_IDENTITY_REGISTRY=0x56FEc2359fcDfFa6FA1D3a8AB3b708Ff698161D5
ERC8004_REPUTATION_REGISTRY=0x89476DfEf9c72a668fa5E86f154B73EDB053aFe4

# ─── Portfolio seed ────────────────────────────────────────────────────────
PORTFOLIO_USDC=5.0
PORTFOLIO_AVAX=0
`.trim()

console.log(envBlock)

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('  After funding, register all agents:')
console.log('  INVEST_AGENTS=1 REGISTER=1 ./launch.sh')
console.log('  Or register one at a time: npm run register')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('  MCP wallet config for Claude.ai:')
console.log('  Settings → Developer → Edit Config → add under "mcpServers":')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

const mcpConfig = {
  "chainpe-wallet": {
    "command": "node",
    "args": [
      `${process.env.HOME || '/Users/samya'}/Downloads/chainpe/chainpe/packages/chainpe-wallet/dist/index.js`
    ],
    "env": {
      "CHAINPE_PRIVATE_KEY": buyer.privateKey,
      "CHAINPE_REGISTRY_ADDRESS": "0x91677a35599f052E99Ed0ab9E45c17E736a22Bf6",
      "ERC8004_REPUTATION_REGISTRY": "0x89476DfEf9c72a668fa5E86f154B73EDB053aFe4",
      "NETWORK": "fuji",
      "MAX_PER_CALL": "0.05",
      "MAX_PER_DAY": "1.00"
    }
  }
}

console.log(JSON.stringify({ mcpServers: mcpConfig }, null, 2))
console.log()
