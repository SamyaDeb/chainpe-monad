# @chainpemonad/ai-tools

[![npm](https://img.shields.io/npm/v/@chainpemonad/ai-tools.svg)](https://www.npmjs.com/package/@chainpemonad/ai-tools)

**Drop-in ChainPe tools for AI agents**: let any Vercel AI SDK or LangChain agent
**discover, pay for and rate** HTTP APIs and other agents, per request, in USDC on
**Monad** (x402 v2). Thin adapters over [`@chainpemonad/sdk`](../chainpe-sdk).

Two tools per framework:

- **`chainpeFetch` / `chainpe_fetch`**: call a URL. If it returns `402 Payment
  Required`, pay it automatically in USDC (EIP-3009) and return the result with the
  settlement tx and its MonadVision link. The SDK signs only `exact` offers on your
  Monad network, in Monad USDC, within `maxPerCall`.
- **`discoverService` / `discover_service`**: browse the ChainPe registry on Monad,
  ranked by ERC-8004 reputation.

```bash
npm install @chainpemonad/ai-tools @chainpemonad/sdk
# plus your framework: `ai` (Vercel AI SDK) or `@langchain/core`
```

## Vercel AI SDK

```ts
import { generateText, stepCountIs } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { createChainPeTools } from '@chainpemonad/ai-tools/vercel'

const tools = createChainPeTools({
  privateKey: process.env.PRIVATE_KEY!,
  network: 'monad-testnet', // default; 'monad' for mainnet (real USDC)
  maxPerCall: '0.10',
  autoFeedback: true // leave on-chain reputation after each paid call (costs MON gas)
})

const { text } = await generateText({
  model: anthropic('claude-opus-4-8'),
  tools,
  stopWhen: stepCountIs(8),
  prompt: 'Find a summarizer agent on ChainPe and summarize today\'s top AI news.'
})
```

## LangChain

```ts
import { ChatAnthropic } from '@langchain/anthropic'
import { createReactAgent } from '@langchain/langgraph/prebuilt'
import { createChainPeLangChainTools } from '@chainpemonad/ai-tools/langchain'

const { chainpeFetchTool, discoverServiceTool } = createChainPeLangChainTools({
  privateKey: process.env.PRIVATE_KEY!,
  network: 'monad-testnet',
  maxPerCall: '0.10'
})

const agent = createReactAgent({
  llm: new ChatAnthropic({ model: 'claude-opus-4-8' }),
  tools: [discoverServiceTool, chainpeFetchTool]
})
```

## Options

`createChainPeTools(options)` / `createChainPeLangChainTools(options)` take the same
options as [`new ChainPe(...)`](../chainpe-sdk#api): `privateKey`, `network`
(`monad-testnet` by default, or `monad`), `registryAddress?`, `reputationRegistry?`,
`maxPerCall?` (default `1` USDC) and `autoFeedback?`. You can also pass a pre-built
client via `{ client }`:

```ts
import { ChainPe } from '@chainpemonad/sdk'
const client = new ChainPe({ privateKey, network: 'monad' })
const tools = createChainPeTools({ client })
```

## Custom frameworks

The framework-agnostic core is exported from the package root, so you can wire the
same logic into any tool-calling runtime:

```ts
import { fetchInputSchema, runFetch, getClient } from '@chainpemonad/ai-tools'

const client = getClient({ privateKey, network: 'monad-testnet' })
const result = await runFetch(client, { url: 'https://api.example.com/paid' })
```

Until the ChainPeRegistry is deployed and its address added to the SDK, pass
`registryAddress` (or set `CHAINPE_REGISTRY_ADDRESS`).

## License

MIT
