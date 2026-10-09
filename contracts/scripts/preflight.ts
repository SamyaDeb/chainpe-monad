/**
 * Preflight before a deploy: prints the signer Hardhat will use, its MON
 * balance, the live gas price and an estimated deploy cost. Read-only — sends
 * no transaction.
 *
 * Usage:
 *   EXPECTED_DEPLOYER=0x... npx hardhat run scripts/preflight.ts --network monadTestnet
 *
 * Monad bills gas on the gas LIMIT (not gas used) and keeps a reserve balance
 * (default 10 MON) on every account, so the deployer needs headroom above both.
 */
import { ethers, network } from "hardhat";
import { formatMon, monadDefaults } from "./lib/monad";

// Registry impl + proxy, PolicyVault impl + proxy, generous.
const TOTAL_GAS_EST = 12_000_000n;
const RESERVE_BALANCE = ethers.parseEther("10");

async function main() {
  const [signer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const addr = await signer.getAddress();
  const bal = await ethers.provider.getBalance(addr);
  const gasPrice = (await ethers.provider.getFeeData()).gasPrice ?? 0n;
  const estCost = TOTAL_GAS_EST * gasPrice;
  const needed = estCost + RESERVE_BALANCE;

  console.log(`\n  Network:     ${network.name} (chainId ${chainId}) ${monadDefaults(chainId) ? "✓ Monad" : "✗ not a Monad chain"}`);
  console.log(`  Signer:      ${addr}`);
  console.log(`  Balance:     ${formatMon(bal)}`);
  console.log(`  Gas price:   ${ethers.formatUnits(gasPrice, 9)} gwei`);
  console.log(`  Est. deploy: ${formatMon(estCost)} (+ ${formatMon(RESERVE_BALANCE)} reserve balance)`);
  console.log(`  Sufficient:  ${bal > needed ? "YES ✓" : "NO ✗"}\n`);

  const expected = process.env.EXPECTED_DEPLOYER;
  if (expected && addr.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`Signer ${addr} ≠ EXPECTED_DEPLOYER ${expected} — wrong DEPLOYER_PRIVATE_KEY.`);
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exitCode = 1;
});
