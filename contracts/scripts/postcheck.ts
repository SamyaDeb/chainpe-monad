/** Post-deploy sanity check: reads live state from the mainnet proxies. */
import { ethers } from "hardhat";

const REGISTRY = "0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E";
const VAULT = "0xFe38A9fE7bdA837549fed1b3608d138Bd9a168d8";
const IDENTITY = "0xB1330d7B1b083ba689C7f56bDf667F1F528a3195";
const USDC = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E";

async function main() {
  const [signer] = await ethers.getSigners();
  const reg = await ethers.getContractAt("ChainPeRegistryUpgradeable", REGISTRY);
  const vault = await ethers.getContractAt("PolicyVaultUpgradeable", VAULT);

  console.log("\n  ── ChainPeRegistry ──");
  console.log("  owner:            ", await reg.owner());
  console.log("  feeToken:         ", await reg.feeToken(), (await reg.feeToken()) === USDC ? "(USDC ✓)" : "(✗)");
  console.log("  registrationFee:  ", (await reg.registrationFee()).toString());
  console.log("  identityRegistry: ", await reg.identityRegistry(), (await reg.identityRegistry()) === IDENTITY ? "✓" : "✗");
  console.log("  serviceCount:     ", (await reg.getServiceCount()).toString());

  console.log("\n  ── PolicyVault ──");
  console.log("  owner:            ", await vault.owner());
  console.log("  token:            ", await vault.token(), (await vault.token()) === USDC ? "(USDC ✓)" : "(✗)");
  console.log("  paused:           ", await vault.paused());

  const bal = await ethers.provider.getBalance(signer.address);
  console.log("\n  Deployer balance now: ", ethers.formatEther(bal), "AVAX");
}
main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; });
