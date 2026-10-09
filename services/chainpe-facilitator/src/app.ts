/**
 * HTTP surface of the facilitator — the x402 v2 facilitator contract
 * (`POST /verify`, `POST /settle`, `GET /supported`) plus ops endpoints.
 *
 * Dependencies are injected so tests can run against fakes.
 */
import express, { type Request, type Response } from 'express'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import { formatEther } from 'viem'
import type { Logger } from 'pino'
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types'
import type { x402Facilitator } from '@x402/core/facilitator'
import { checkPayment } from './policy.js'

export interface AppDeps {
  network: string
  caip2: string
  usdc: string
  minAmountAtomic: bigint
  facilitatorAddress: string
  facilitator: Pick<x402Facilitator, 'verify' | 'settle' | 'getSupported'>
  isPayToAllowed(payTo: string): boolean
  /** x402 schemes settled here (default `exact`; plus `chainpe-vault` with a PolicyVault). */
  schemes?: string[]
  /** Latest known gas-key balance (wei), or null if unknown. */
  gasBalance(): bigint | null
  lowGasThresholdWei: bigint
  allowedOrigins: string[]
  trustProxy: number | boolean
  rateLimitPerMinute: number
  log: Pick<Logger, 'info' | 'warn' | 'error'>
}

interface FacilitatorRequestBody {
  x402Version?: number
  paymentPayload?: PaymentPayload
  paymentRequirements?: PaymentRequirements
}

function parseBody(body: unknown): { payload: PaymentPayload; requirements: PaymentRequirements } | null {
  const b = body as FacilitatorRequestBody | undefined
  if (!b || typeof b !== 'object') return null
  const { paymentPayload, paymentRequirements } = b
  if (!paymentPayload || typeof paymentPayload !== 'object') return null
  if (!paymentRequirements || typeof paymentRequirements !== 'object') return null
  if (paymentPayload.x402Version !== 2) return null
  return { payload: paymentPayload, requirements: paymentRequirements }
}

export function createApp(deps: AppDeps) {
  const app = express()
  app.set('trust proxy', deps.trustProxy)
  app.use(
    deps.allowedOrigins.length
      ? cors({ origin: deps.allowedOrigins })
      : cors({ origin: false }) // server-to-server only by default
  )
  app.use(express.json({ limit: '50kb' }))

  const limiter = rateLimit({
    windowMs: 60_000,
    limit: deps.rateLimitPerMinute,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'rate_limit_exceeded' }
  })

  const counters = {
    verify_valid: 0,
    verify_invalid: 0,
    verify_rejected_by_policy: 0,
    settle_success: 0,
    settle_failure: 0,
    errors: 0
  }

  const policyCtx = {
    caip2: deps.caip2,
    usdc: deps.usdc,
    minAmountAtomic: deps.minAmountAtomic,
    isPayToAllowed: deps.isPayToAllowed,
    schemes: deps.schemes ?? ['exact']
  }

  app.get('/', (_req: Request, res: Response) => {
    res.json({
      service: 'chainpe-facilitator',
      description: 'Non-custodial x402 v2 verify + settle for USDC on Monad.',
      network: deps.network,
      caip2: deps.caip2,
      schemes: policyCtx.schemes,
      custodial: false,
      endpoints: ['/health', '/status', '/supported', '/metrics', '/verify', '/settle']
    })
  })

  // Liveness: never touches the chain, always 200 while the process is up.
  app.get('/health', (_req: Request, res: Response) => {
    const bal = deps.gasBalance()
    const lowGas = bal !== null && bal < deps.lowGasThresholdWei
    res.json({
      status: lowGas ? 'degraded' : 'ok',
      service: 'chainpe-facilitator',
      network: deps.network,
      caip2: deps.caip2,
      facilitator: deps.facilitatorAddress,
      custodial: false,
      ...(lowGas ? { warning: 'low_gas' } : {})
    })
  })

  app.get('/status', (_req: Request, res: Response) => {
    const bal = deps.gasBalance()
    res.json({
      service: 'chainpe-facilitator',
      network: deps.network,
      caip2: deps.caip2,
      facilitator: deps.facilitatorAddress,
      gasBalanceMon: bal !== null ? formatEther(bal) : 'unavailable',
      lowGasThresholdMon: formatEther(deps.lowGasThresholdWei),
      lowGas: bal !== null ? bal < deps.lowGasThresholdWei : null
    })
  })

  app.get('/supported', (_req: Request, res: Response) => {
    res.json(deps.facilitator.getSupported())
  })

  app.get('/metrics', (_req: Request, res: Response) => {
    const bal = deps.gasBalance()
    const lines = [
      '# TYPE chainpe_verify_total counter',
      `chainpe_verify_total{result="valid"} ${counters.verify_valid}`,
      `chainpe_verify_total{result="invalid"} ${counters.verify_invalid}`,
      `chainpe_verify_total{result="policy_rejected"} ${counters.verify_rejected_by_policy}`,
      '# TYPE chainpe_settle_total counter',
      `chainpe_settle_total{result="success"} ${counters.settle_success}`,
      `chainpe_settle_total{result="failure"} ${counters.settle_failure}`,
      '# TYPE chainpe_errors_total counter',
      `chainpe_errors_total ${counters.errors}`,
      '# TYPE chainpe_gas_balance_mon gauge',
      `chainpe_gas_balance_mon{network="${deps.network}"} ${bal !== null ? formatEther(bal) : 'NaN'}`
    ]
    res.type('text/plain; version=0.0.4').send(lines.join('\n') + '\n')
  })

  app.post('/verify', limiter, async (req: Request, res: Response) => {
    const parsed = parseBody(req.body)
    if (!parsed) return res.status(400).json({ isValid: false, invalidReason: 'invalid_request' })

    const policy = checkPayment(parsed.payload, parsed.requirements, policyCtx)
    if (!policy.ok) {
      counters.verify_rejected_by_policy++
      return res.json({ isValid: false, invalidReason: policy.reason })
    }
    try {
      const result = await deps.facilitator.verify(parsed.payload, parsed.requirements)
      if (result.isValid) counters.verify_valid++
      else counters.verify_invalid++
      deps.log.info({ event: 'verify', isValid: result.isValid, reason: result.invalidReason, payer: result.payer })
      return res.json(result)
    } catch (err) {
      counters.errors++
      deps.log.error({ event: 'verify_error', err }, 'verify failed')
      return res.status(500).json({ isValid: false, invalidReason: 'verify_error' })
    }
  })

  app.post('/settle', limiter, async (req: Request, res: Response) => {
    const parsed = parseBody(req.body)
    if (!parsed) {
      return res.status(400).json({ success: false, errorReason: 'invalid_request', transaction: '', network: deps.caip2 })
    }
    const policy = checkPayment(parsed.payload, parsed.requirements, policyCtx)
    if (!policy.ok) {
      counters.settle_failure++
      return res.json({ success: false, errorReason: policy.reason, transaction: '', network: deps.caip2 })
    }
    try {
      const result = await deps.facilitator.settle(parsed.payload, parsed.requirements)
      if (result.success) counters.settle_success++
      else counters.settle_failure++
      deps.log.info({
        event: 'settle',
        success: result.success,
        reason: result.errorReason,
        transaction: result.transaction,
        payer: result.payer,
        payTo: parsed.requirements.payTo,
        amount: parsed.requirements.amount
      })
      return res.json(result)
    } catch (err) {
      counters.errors++
      deps.log.error({ event: 'settle_error', err }, 'settle failed')
      return res.status(500).json({ success: false, errorReason: 'settle_error', transaction: '', network: deps.caip2 })
    }
  })

  return app
}
