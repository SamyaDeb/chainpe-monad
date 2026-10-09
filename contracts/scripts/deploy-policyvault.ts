/**
 * Deploy PolicyVaultUpgradeable behind an ERC-1967 proxy.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-policyvault.ts --network monadTestnet
 *   npx hardhat run scripts/deploy-policyvault.ts --network monad
 *
 * Required env:
 *   DEPLOYER_PRIVATE_KEY   funded deployer key
 * Optional env:
 *   USDC_ADDRESS / FEE_TOKEN_ADDRESS  ERC-20 the vault holds (defaults to
 *                                     canonical USDC for the target network)
 *   OWNER_ADDRESS          Gnosis Safe multisig address that will own the
 *                          contract after deployment. STRONGLY RECOMMENDED on
 *                          mainnet. Defaults to deployer (⚠ insecure for prod).
 *
 * Writes deployed addresses to deployments/<network>-policyvault.json.
 */
import { ethers, network } from "hardhat";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { monadDefaults, isMonadMainnet, formatMon } from "./lib/monad";

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  const token =
    process.env.USDC_ADDRESS ?? process.env.FEE_TOKEN_ADDRESS ?? monadDefaults(chainId)?.usdc;
  if (!token) {
    throw new Error(`No USDC_ADDRESS set and no default USDC for chainId ${chainId}.`);
  }

  // Owner defaults to deployer but MUST be a multisig/timelock on mainnet — the
  // vault custodies user USDC, so the owner (who controls upgrades) is critical.
  const ownerAddress = process.env.OWNER_ADDRESS ?? deployer.address;
  if (ownerAddress === deployer.address && isMonadMainnet(chainId)) {
    if (process.env.ALLOW_DEPLOYER_OWNER === "true") {
      console.warn(
        "\n⚠  ALLOW_DEPLOYER_OWNER=true — deploying with the deployer EOA as owner.\n" +
        "   This is INSECURE for a fund-custody vault; move ownership to a timelock ASAP.\n"
      );
    } else {
      throw new Error(
        "Refusing to deploy the vault to Monad mainnet with the deployer EOA as owner.\n" +
        "   The owner controls UUPS upgrades and can drain the vault. Set OWNER_ADDRESS to a\n" +
        "   ChainPeTimelock (owned by your Gnosis Safe):\n" +
        "     npx hardhat run scripts/deploy-timelock.ts --network monad\n" +
        "   To override for testing only, set ALLOW_DEPLOYER_OWNER=true."
      );
    }
  }

  console.log(`\nDeploying PolicyVaultUpgradeable (UUPS proxy) to ${network.name} (chainId ${chainId})`);
  console.log(`  Deployer: ${deployer.address}`);
  console.log(`  Token:    ${token}`);
  console.log(`  Owner:    ${ownerAddress}${ownerAddress === deployer.address ? " (⚠ same as deployer)" : " ✓ multisig"}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`  Balance:  ${formatMon(balance)}\n`);

  // 1. Deploy implementation.
  const Impl = await ethers.getContractFactory("PolicyVaultUpgradeable");
  const impl = await Impl.deploy();
  await impl.waitForDeployment();
  const implAddr = await impl.getAddress();
  console.log("  Implementation:", implAddr);

  // 2. Encode initialize calldata.
  const initData = Impl.interface.encodeFunctionData("initialize", [token, ownerAddress]);

  // 3. Deploy ERC-1967 proxy pointing at the implementation and calling initialize.
  const Proxy = await ethers.getContractFactory(
    "contracts/erc8004/ERC1967Proxy.sol:ERC1967Proxy"
  );
  const proxy = await Proxy.deploy(implAddr, initData);
  await proxy.waitForDeployment();
  const proxyAddr = await proxy.getAddress();
  console.log("  Proxy (use this address): ", proxyAddr);

  // 4. Sanity-check: confirm owner is set correctly.
  const vault = await ethers.getContractAt("PolicyVaultUpgradeable", proxyAddr);
  const onChainOwner = await vault.owner();
  if (onChainOwner.toLowerCase() !== ownerAddress.toLowerCase()) {
    throw new Error(`Owner mismatch! On-chain: ${onChainOwner}, expected: ${ownerAddress}`);
  }

  console.log("\n========================================");
  console.log("  PolicyVaultUpgradeable deployed");
  console.log("========================================");
  console.log(`  Proxy:          ${proxyAddr}  ← use this`);
  console.log(`  Implementation: ${implAddr}`);
  console.log(`  Owner:          ${onChainOwner}`);

  const dir = join(__dirname, "..", "deployments");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const out = {
    network: network.name,
    chainId,
    policyVaultProxy: proxyAddr,
    policyVaultImpl: implAddr,
    token,
    owner: onChainOwner,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    upgradeable: true,
  };
  const file = join(dir, `${network.name}-policyvault.json`);
  writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log(`\n  Saved -> deployments/${network.name}-policyvault.json`);
  console.log(`\n  Verify implementation with:`);
  console.log(`  npx hardhat verify --network ${network.name} ${implAddr}`);
  console.log(`\n  Next steps:`);
  if (ownerAddress === deployer.address) {
    console.log(`  ⚠  Transfer ownership to a Gnosis Safe BEFORE depositing real funds:`);
    console.log(`     npx hardhat run scripts/transfer-ownership.ts --network ${network.name}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
