/**
 * Verify the deployed implementation contracts (and their proxies) on the
 * Monad explorer, reading addresses from deployments/<network>*.json.
 *
 * Usage:
 *   npx hardhat run scripts/verify.ts --network monadTestnet
 *   (MonadVision via Sourcify always; Monadscan too when ETHERSCAN_API_KEY is set)
 *
 * Implementations have no constructor args. Each proxy is an ERC1967Proxy whose
 * constructor args are (implementation, initData); initData is rebuilt from the
 * deployment record.
 */
import { ethers, run, network } from "hardhat";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const PROXY = "contracts/erc8004/ERC1967Proxy.sol:ERC1967Proxy";

function load(file: string): Record<string, string> | undefined {
  const path = join(__dirname, "..", "deployments", file);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : undefined;
}

async function verify(label: string, address: string, args: unknown[], contract?: string) {
  // MonadVision (Sourcify) needs no API key; Monadscan (Etherscan v2) only runs
  // when ETHERSCAN_API_KEY is set.
  const targets: [string, () => Promise<unknown>][] = [
    ["MonadVision (Sourcify)", () => run("verify:sourcify", { address, ...(contract ? { contract } : {}) })],
  ];
  if (process.env.ETHERSCAN_API_KEY) {
    targets.push([
      "Monadscan (Etherscan)",
      () => run("verify:etherscan", { address, constructorArgsParams: [], constructorArguments: args, ...(contract ? { contract } : {}) }),
    ]);
  }
  for (const [where, go] of targets) {
    console.log(`\n  Verifying ${label} at ${address} on ${where}...`);
    try {
      await go();
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      if (/already verified/i.test(msg)) console.log("  already verified ✓");
      else console.error(`  ✗ ${msg.split("\n")[0]}`);
    }
  }
}

async function main() {
  const reg = load(`${network.name}.json`);
  if (reg) {
    await verify("ChainPeRegistryUpgradeable (impl)", reg.chainPeRegistryImpl, []);
    const Impl = await ethers.getContractFactory("ChainPeRegistryUpgradeable");
    const initData = Impl.interface.encodeFunctionData("initialize", [
      reg.feeToken,
      reg.feeRecipient,
      reg.registrationFee,
      reg.identityRegistry,
      reg.owner,
    ]);
    await verify("ChainPeRegistry (proxy)", reg.chainPeRegistryProxy, [reg.chainPeRegistryImpl, initData], PROXY);
  }

  const vault = load(`${network.name}-policyvault.json`);
  if (vault) {
    await verify("PolicyVaultUpgradeable (impl)", vault.policyVaultImpl, []);
    const Impl = await ethers.getContractFactory("PolicyVaultUpgradeable");
    const initData = Impl.interface.encodeFunctionData("initialize", [vault.token, vault.owner]);
    await verify("PolicyVault (proxy)", vault.policyVaultProxy, [vault.policyVaultImpl, initData], PROXY);
  }

  if (!reg && !vault) console.log(`No deployments found for ${network.name}.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
