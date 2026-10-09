# x402 v2 notes (as used by ChainPe on Monad)

Read from the type definitions and source of `@x402/core`, `@x402/evm`, `@x402/fetch`,
`@x402/express` **2.28.0** (2026-10-09). v1 packages (`x402`, `x402-fetch`,
`x402-express`) do not know Monad; we use v2 only.

## Wire format (HTTP)

| Step | v2 | (v1, for reference) |
|---|---|---|
| Server → client: payment required | `402` + header **`PAYMENT-REQUIRED`** = base64(JSON `PaymentRequired`) | JSON body |
| Client → server: payment | header **`PAYMENT-SIGNATURE`** = base64(JSON `PaymentPayload`) | `X-PAYMENT` |
| Server → client: settlement | header **`PAYMENT-RESPONSE`** = base64(JSON `SettleResponse`) | `X-PAYMENT-RESPONSE` |

Helpers: `@x402/core/http` — `encode/decodePaymentRequiredHeader`,
`encode/decodePaymentSignatureHeader`, `encode/decodePaymentResponseHeader`.
CORS on a proxy must expose `PAYMENT-REQUIRED` and `PAYMENT-RESPONSE`.

## Core types (`@x402/core/types`)

```ts
type Network = `${string}:${string}`            // CAIP-2, e.g. "eip155:143"
type PaymentRequirements = { scheme; network; asset; amount; payTo; maxTimeoutSeconds; extra }
type PaymentRequired = { x402Version; error?; resource: ResourceInfo; accepts: PaymentRequirements[]; extensions? }
type PaymentPayload  = { x402Version; resource?; accepted: PaymentRequirements; payload; extensions? }
type SettleResponse  = { success; errorReason?; errorMessage?; payer?; transaction; network; amount? }
type SupportedResponse = { kinds: { x402Version; scheme; network; extra? }[]; extensions: string[]; signers }
```
Note `amount` (v2) replaces v1's `maxAmountRequired`. For `exact` EVM, `extra` carries the
token's EIP-712 `name` / `version` (Monad USDC: `"USDC"` / `"2"`).

## Client (`@x402/core/client`, `@x402/evm/exact/client`, `@x402/fetch`)

```ts
const client = new x402Client(selector?)                 // or x402Client.fromConfig({...})
  .register('eip155:143', new ExactEvmScheme(signer))     // signer = viem LocalAccount (address + signTypedData)
  .registerPolicy((v, reqs) => reqs.filter(...))          // filter offers (we: USDC only, amount ≤ cap)
  .setSpendControls(false | { ... })                      // library USD caps; default = default assets + a USD cap
const http = new x402HTTPClient(client)
http.getPaymentRequiredResponse(name => res.headers.get(name), body)
const payload = await http.createPaymentPayload(paymentRequired)
http.encodePaymentSignatureHeader(payload)                // → { 'PAYMENT-SIGNATURE': ... }
http.getPaymentSettleResponse(name => res.headers.get(name))
```
`wrapFetchWithPayment(fetch, client)` does the whole loop but hides the selected offer; the
SDK runs the loop itself so it can report the settlement tx hash and payTo.

## Facilitator (`@x402/core/facilitator`, `@x402/evm/exact/facilitator`)

```ts
const signer = toFacilitatorEvmSigner({ address, readContract, verifyTypedData,
  writeContract /* accepts gas */, sendTransaction, waitForTransactionReceipt, getCode })
const facilitator = new x402Facilitator().register('eip155:143', new ExactEvmScheme(signer))
await facilitator.verify(paymentPayload, paymentRequirements)   // VerifyResponse
await facilitator.settle(paymentPayload, paymentRequirements)   // SettleResponse (transaction = tx hash)
facilitator.getSupported()                                      // SupportedResponse
```
HTTP contract expected by `HTTPFacilitatorClient`: `POST {url}/verify` and `POST {url}/settle`
with body `{ x402Version, paymentPayload, paymentRequirements }`; `GET {url}/supported`.

## Resource server (`@x402/core/server`, `@x402/evm/exact/server`, `@x402/express`)

```ts
const server = new x402ResourceServer(new HTTPFacilitatorClient({ url }))
  .register('eip155:143', new ExactEvmScheme())
app.use(paymentMiddleware({ 'GET /data': { accepts: { scheme: 'exact', network: 'eip155:143',
  payTo, price: '$0.01' /* or { asset, amount, extra } */ } } }, server))
```
`price` as a money string resolves through the library's default-asset table (Monad USDC is
in it); an `AssetAmount` works on any EVM chain (we use it for local Hardhat tests).
