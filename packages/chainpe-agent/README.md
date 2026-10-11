# @chainpemonad/agent

**A ready-made AI agent that finds paid APIs in the ChainPe registry and pays for them
with x402 v2 USDC on Monad.**

Give it a task in plain English. It searches the registry (with ERC-8004 reputation),
picks a service, pays the `402` in USDC and answers from the result. Every payment
comes back with its settlement transaction on MonadVision.

## Install

```bash
npm install -g @chainpemonad/agent   # CLI
npm install @chainpemonad/agent      # library
```

## Set up

```bash
chainpe-agent init
```

`init` asks for:

- **LLM**: an API provider (OpenAI, Anthropic, Gemini, Groq or **Qwen**) or a local
  OpenAI-compatible server (Ollama).
- **Network**: `monad-testnet` (default) or `monad` (mainnet, real USDC).
- **Wallet**: generate a new one or paste a private key. The key goes into the **OS
  keychain** (macOS Keychain, Linux Secret Service, Windows Credential Manager).
  `~/.chainpe/agent.json` holds only the address.

On testnet, get MON from https://faucet.monad.xyz and USDC from
https://faucet.circle.com (choose Monad Testnet). x402 payments need USDC only; the
facilitator pays gas.

## Use

```bash
chainpe-agent run "What's the weather in London?"
chainpe-agent run "Monad network stats" --provider MonStats   # pin a service
chainpe-agent services                                        # list the registry
chainpe-agent status                                          # config + MON/USDC balance
```

```ts
import { ChainPeAgent } from "@chainpemonad/agent";

const agent = await ChainPeAgent.fromConfig();          // reads ~/.chainpe/agent.json + keychain
const result = await agent.run("What's the weather in London?", {
  onPayment: r => console.log(`paid ${r.amount} USDC → ${r.explorerUrl}`),
});
console.log(result.text);
console.log("spent:", result.payments.totalSpent.USDC, "USDC");
```

## How payment works

Payments go through `@chainpemonad/sdk` (`paidFetch`). The agent signs an offer only when
it is `exact`, on the configured Monad network, in that network's Circle USDC, and no more
than `payment.maxPricePerRequest` (default 1 USDC). Any other offer is refused before
signing.

```
user task → LLM → discoverService (ChainPeRegistry + ERC-8004 scores)
                → callPaidApi → 402 → SDK signs USDC (EIP-3009) → 200 + receipt
```

Auto-feedback is opt-in. Set `CHAINPE_AUTO_FEEDBACK=1` and the agent posts a 100/100
ERC-8004 score for the provider after each paid call. It is an on-chain transaction and
needs a little MON.

## Configuration (`~/.chainpe/agent.json`)

```json
{
  "llm": { "mode": "api", "provider": "qwen", "model": "qwen-plus", "apiKey": "…" },
  "wallet": { "address": "0x…", "useKeychain": true },
  "payment": { "preferredToken": "USDC", "maxPricePerRequest": "0.10" },
  "network": "monad-testnet"
}
```

| Setting | Env override | Default |
|---|---|---|
| Registry | `CHAINPE_REGISTRY_ADDRESS` / `registryAddress` | SDK default for the network |
| Reputation registry | `ERC8004_REPUTATION_REGISTRY` / `reputationRegistry` | canonical ERC-8004 registry |
| RPC | `MONAD_RPC_URL`, `MONAD_TESTNET_RPC_URL` | public Monad RPCs |

### LLM providers

| Provider | Notes |
|---|---|
| `qwen` | Alibaba Cloud Model Studio via its OpenAI-compatible API (`https://dashscope-intl.aliyuncs.com/compatible-mode/v1`; set `llm.baseURL` for another region). Models: `qwen-plus`, `qwen-max`, `qwen-turbo`. |
| `groq` | OpenAI-compatible Groq endpoint. |
| `openai`, `anthropic`, `gemini` | Official AI SDK providers. |
| local (`mode: "local"`) | Any OpenAI-compatible server, default Ollama at `http://localhost:11434/v1`. |

## Security

- Use a dedicated wallet with a small balance.
- The key lives in the OS keychain only and is never logged or written to `agent.json`.
- Start on `monad-testnet`.
