/**
 * Mainnet preflight: prints the signer Hardhat will actually use, its balance,
 * the live gas price, and an estimated total deploy cost. Read-only — sends no tx.
 */
import { ethers, network } from "hardhat";

const EXPECTED = "0x3b8a312fac101E7163F9701457d8Dc46cE8fd30a"; // funded wallet
const TOTAL_GAS_EST = 23_000_000n; // core + ICM + ERC-8004, generous

async function main() {
  const [signer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const addr = await signer.getAddress();
  const bal = await ethers.provider.getBalance(addr);
  const fee = await ethers.provider.getFeeData();
  const gasPrice = fee.gasPrice ?? 0n;

  console.log(`\n  Network:        ${network.name} (chainId ${net.chainId})`);
  console.log(`  Signer (env):   ${addr}`);
  console.log(`  Expected:       ${EXPECTED}`);
  console.log(`  MATCH:          ${addr.toLowerCase() === EXPECTED.toLowerCase() ? "YES ✓" : "NO ✗ — env key is a DIFFERENT wallet!"}`);
  console.log(`  Balance:        ${ethers.formatEther(bal)} AVAX`);
  console.log(`  Gas price:      ${ethers.formatUnits(gasPrice, 9)} nAVAX`);
  const estCost = TOTAL_GAS_EST * gasPrice;
  console.log(`  Est. full deploy (~${TOTAL_GAS_EST} gas): ${ethers.formatEther(estCost)} AVAX`);
  console.log(`  Sufficient:     ${bal > estCost ? "YES ✓" : "NO ✗"}\n`);

  if (addr.toLowerCase() !== EXPECTED.toLowerCase()) {
    throw new Error("Signer mismatch — refusing. Set DEPLOYER_PRIVATE_KEY to the funded key.");
  }
}

main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; });
