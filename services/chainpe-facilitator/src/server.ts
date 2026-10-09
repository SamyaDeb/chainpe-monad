/**
 * ChainPe x402 facilitator for Monad — standalone, non-custodial settlement.
 *
 * Implements the x402 v2 facilitator contract (`/verify`, `/settle`,
 * `/supported`) for USDC `exact` (EIP-3009) payments on Monad, plus
 * `chainpe-vault` (mandate mode: the PolicyVault pays, its caps apply on every
 * call) when a PolicyVault is configured. Providers point their proxy at it
 * with `CHAINPE_FACILITATOR_URL`.
 *
 * NON-CUSTODIAL: the key only pays gas and relays the payer's signed
 * `transferWithAuthorization` or session-key-signed vault spend; it never
 * holds user funds.
 *
 * Env: see .env.example.
 */
import 'dotenv/config'
import pino from 'pino'
import { formatEther } from 'viem'
import { x402Facilitator } from '@x402/core/facilitator'
import { ExactEvmScheme } from '@x402/evm/exact/facilitator'
import { loadConfig } from './config.js'
import { PayToAllowlist } from './policy.js'
import { createSettlementSigner } from './signer.js'
import { createApp } from './app.js'
import { POLICY_VAULT_ABI, VAULT_SCHEME, createVaultScheme } from './vault.js'

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' })

async function main() {
  const cfg = loadConfig()
  const settlement = createSettlementSigner(cfg)
  const { address, signer, publicClient } = settlement

  const facilitator = new x402Facilitator().register(cfg.caip2, new ExactEvmScheme(signer))
  const schemes = ['exact']
  if (cfg.policyVault) {
    const vault = cfg.policyVault
    const token = (await publicClient.readContract({ address: vault, abi: POLICY_VAULT_ABI, functionName: 'token' })) as string
    if (token.toLowerCase() !== cfg.usdc.toLowerCase()) {
      throw new Error(`PolicyVault ${vault} holds ${token}, not USDC ${cfg.usdc}`)
    }
    facilitator.register(cfg.caip2, createVaultScheme(cfg, settlement))
    schemes.push(VAULT_SCHEME)
  }

  const allowlist = new PayToAllowlist(cfg.payToAllowlist, cfg.requireRegisteredPayTo, cfg.indexerUrl)
  const refreshAllowlist = () =>
    allowlist
      .refresh()
      .then(() => log.debug?.({ registered: allowlist.registeredCount }, 'payTo allowlist refreshed'))
      .catch(err => log.warn({ err: String(err) }, 'payTo allowlist refresh failed (keeping previous)'))
  await refreshAllowlist()
  setInterval(refreshAllowlist, 60_000).unref()

  // Background gas-balance cache so /health never hits the RPC.
  let gasBalance: bigint | null = null
  const refreshGas = async () => {
    try {
      gasBalance = await publicClient.getBalance({ address })
      if (gasBalance < cfg.lowGasThresholdWei) {
        log.warn({ facilitator: address, gasBalanceMon: formatEther(gasBalance) }, 'gas key below threshold — top up MON')
      }
    } catch {
      /* keep the stale value on transient RPC errors */
    }
  }
  await refreshGas()
  setInterval(refreshGas, 60_000).unref()

  if (!cfg.requireRegisteredPayTo && cfg.payToAllowlist.size === 0) {
    log.warn('REQUIRE_REGISTERED_PAYTO=false and no PAYTO_ALLOWLIST: settling for any payTo (dev mode)')
  }

  const app = createApp({
    network: cfg.network,
    caip2: cfg.caip2,
    usdc: cfg.usdc,
    minAmountAtomic: cfg.minAmountAtomic,
    facilitatorAddress: address,
    facilitator,
    isPayToAllowed: payTo => allowlist.isAllowed(payTo),
    schemes,
    gasBalance: () => gasBalance,
    lowGasThresholdWei: cfg.lowGasThresholdWei,
    allowedOrigins: cfg.allowedOrigins,
    trustProxy: cfg.trustProxy,
    rateLimitPerMinute: cfg.rateLimitPerMinute,
    log
  })

  app.listen(cfg.port, () => {
    log.info(
      {
        network: cfg.network,
        caip2: cfg.caip2,
        facilitator: address,
        gasBalanceMon: gasBalance !== null ? formatEther(gasBalance) : 'unknown',
        registeredPayTo: allowlist.registeredCount,
        requireRegisteredPayTo: cfg.requireRegisteredPayTo,
        schemes,
        policyVault: cfg.policyVault ?? 'off'
      },
      `ChainPe facilitator listening on :${cfg.port}`
    )
  })
}

main().catch(err => {
  log.fatal({ err: String(err?.stack ?? err) }, 'fatal startup error')
  process.exit(1)
})
