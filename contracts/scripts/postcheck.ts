/**
 * Post-deploy sanity check: reads live state from the deployed proxies listed
 * in deployments/<network>.json and deployments/<network>-policyvault.json.
 *
 * Usage:
 *   npx hardhat run scripts/postcheck.ts --network monadTestnet
 */
import { ethers, network } from "hardhat";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { formatMon, monadDefaults } from "./lib/monad";

function load(file: string): Record<string, string> | undefined {
  const path = join(__dirname, "..", "deployments", file);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : undefined;
}

const mark = (ok: boolean) => (ok ? "✓" : "✗");

async function main() {
  const [signer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const defaults = monadDefaults(chainId);

  const reg = load(`${network.name}.json`);
  if (reg?.chainPeRegistryProxy) {
    const registry = await ethers.getContractAt("ChainPeRegistryUpgradeable", reg.chainPeRegistryProxy);
    const feeToken = await registry.feeToken();
    const identity = await registry.identityRegistry();
    console.log("\n  ── ChainPeRegistry ──", reg.chainPeRegistryProxy);
    console.log("  owner:            ", await registry.owner());
    console.log("  feeToken:         ", feeToken, mark(feeToken.toLowerCase() === defaults?.usdc.toLowerCase()));
    console.log("  registrationFee:  ", ethers.formatUnits(await registry.registrationFee(), 6), "USDC");
    console.log("  identityRegistry: ", identity, mark(identity.toLowerCase() === defaults?.identityRegistry.toLowerCase()));
    console.log("  serviceCount:     ", (await registry.getServiceCount()).toString());
    console.log("  paused:           ", await registry.paused());
  } else {
    console.log(`\n  No registry in deployments/${network.name}.json`);
  }

  const vaultDep = load(`${network.name}-policyvault.json`);
  if (vaultDep?.policyVaultProxy) {
    const vault = await ethers.getContractAt("PolicyVaultUpgradeable", vaultDep.policyVaultProxy);
    const token = await vault.token();
    console.log("\n  ── PolicyVault ──", vaultDep.policyVaultProxy);
    console.log("  owner:            ", await vault.owner());
    console.log("  token:            ", token, mark(token.toLowerCase() === defaults?.usdc.toLowerCase()));
    console.log("  paused:           ", await vault.paused());
  } else {
    console.log(`\n  No vault in deployments/${network.name}-policyvault.json`);
  }

  console.log("\n  Signer balance now:", formatMon(await ethers.provider.getBalance(signer.address)), "\n");
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exitCode = 1;
});
