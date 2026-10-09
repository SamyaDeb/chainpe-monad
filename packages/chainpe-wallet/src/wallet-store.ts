import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { WalletFileConfig } from './types.js'

/** Directory for all ChainPe wallet state (`CHAINPE_HOME` overrides, used by tests). */
export function chainpeDir(): string {
  return process.env.CHAINPE_HOME?.trim() || path.join(os.homedir(), '.chainpe')
}

export function getWalletPath(): string {
  return path.join(chainpeDir(), 'wallet.json')
}

export function loadWalletConfig(): WalletFileConfig | null {
  try {
    return JSON.parse(fs.readFileSync(getWalletPath(), 'utf-8')) as WalletFileConfig
  } catch {
    return null
  }
}

export function saveWalletConfig(config: Partial<WalletFileConfig>): void {
  const merged = { ...loadWalletConfig(), ...config }
  fs.mkdirSync(chainpeDir(), { recursive: true, mode: 0o700 })
  fs.writeFileSync(getWalletPath(), JSON.stringify(merged, null, 2) + '\n', { mode: 0o600 })
}
