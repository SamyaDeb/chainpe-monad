# Outreach drafts (NOT sent — for the team to review and send)

Facts used below are all in this repo: payment-backed reputation indexer and the testnet demo
(`docs/METROPOLIS.md`, 2026-10-09: paid score 95 vs raw 98.33 inflated by two fake ratings).
Mainnet is not deployed yet — the messages say so. Fill in the repo link and your handle before sending.

## 1. MonadTrust / monad-agent-trust / prooflines (trust auditors)
Hi <name> — we're building ChainPe (Track 4): x402 USDC payments + an indexer that scores ERC-8004
agents only by ratings backed by a real payment receipt (the rating's feedbackHash must be a USDC
settlement to the agent). On our Monad testnet demo, two unpaid 100/100 ratings pushed the raw score
to 98.33 while the paid score stayed at 95 with 1 payer. You filter farmed reviews with funding
provenance; we have a receipt signal you could use as an extra input, and a REST endpoint
(`/services/:id/reputation` → paid vs raw). Would you be open to us exposing it for your
audits, or to you running your provenance filter on our receipts? Repo: <link>. Happy to do a 15-minute call.

## 2. Headwater
Hi <name> — ChainPe indexes the canonical ERC-8004 Reputation Registry on Monad and separates
payment-backed ratings from unpaid ones (one receipt backs one rating, per-payer weight cap).
If Headwater surfaces agent scores, we can provide the paid-reputation numbers via a simple
HTTP API — and would like your feedback on the scoring rules. Testnet demo with tx links: <repo link>.
Could we try a small integration or just compare results on a few agents?

## 3. monapi (x402 monetization)
Hi <name> — ChainPe is an x402 v2 gateway + registry for Monad: `chainpe start` puts any API
behind USDC payments and lists it, linked to its ERC-8004 agent id, in an on-chain registry
with payment-backed reputation. monapi monetizes APIs; we add the trust layer. Would you
list monapi services in our registry (so buyers can rank them by paid reputation), or call our
reputation API before routing agents to a seller? Repo: <link>. Glad to do the listing for you.
