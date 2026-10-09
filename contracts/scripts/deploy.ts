/**
 * Deploy ChainPeRegistryUpgradeable behind an ERC-1967 proxy.
 *
 * Usage:
 *   npm run deploy:testnet     # Monad testnet (chainId 10143)
 *   npm run deploy:mainnet     # Monad mainnet (chainId 143)
 *
 * Required env:
 *   DEPLOYER_PRIVATE_KEY   funded deployer key
 * Optional env:
 *   FEE_TOKEN_ADDRESS      ERC-20 used for the registration fee (defaults to
 *                          canonical USDC for the target network)
 *   FEE_RECIPIENT          treasury receiving fees (defaults to deployer)
 *   REGISTRATION_FEE_USDC  human fee, e.g. "0.1" (defaults to "0" — free
 *                          listings while we grow adoption)
 *   IDENTITY_REGISTRY      ERC-8004 Identity Registry (defaults to the
 *                          canonical Monad deployment; must have code)
 *   OWNER_ADDRESS          Gnosis Safe multisig address that will own the
 *                          contract. STRONGLY RECOMMENDED on mainnet.
 *                          Defaults to deployer (⚠ insecure for prod).
 *
 * Writes deployed addresses to deployments/<network>.json.
 */
import { ethers, network } from "hardhat";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { monadDefaults, isMonadMainnet, hasCode, formatMon } from "./lib/monad";

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  const defaults = monadDefaults(chainId);
  const feeToken = process.env.FEE_TOKEN_ADDRESS ?? defaults?.usdc;
  if (!feeToken) {
    throw new Error(`No FEE_TOKEN_ADDRESS set and no default USDC for chainId ${chainId}.`);
  }
  const feeRecipient = process.env.FEE_RECIPIENT ?? deployer.address;
  const feeHuman = process.env.REGISTRATION_FEE_USDC ?? "0";
  const registrationFee = ethers.parseUnits(feeHuman, 6);
  const identityRegistry =
    process.env.IDENTITY_REGISTRY ?? defaults?.identityRegistry ?? ethers.ZeroAddress;
  // The registry calls ownerOf() on this address to check agent links, so it
  // must be a deployed contract (or explicitly 0 to disable linking checks).
  if (identityRegistry !== ethers.ZeroAddress && !(await hasCode(identityRegistry))) {
    throw new Error(
      `IDENTITY_REGISTRY ${identityRegistry} has no code on chainId ${chainId}.\n` +
      "   Set IDENTITY_REGISTRY to the ERC-8004 IdentityRegistry on this network."
    );
  }

  // Owner defaults to deployer but MUST be a multisig/timelock on mainnet.
  const ownerAddress = process.env.OWNER_ADDRESS ?? deployer.address;
  if (ownerAddress === deployer.address && isMonadMainnet(chainId)) {
    if (process.env.ALLOW_DEPLOYER_OWNER === "true") {
      console.warn(
        "\n⚠  ALLOW_DEPLOYER_OWNER=true — deploying with the deployer EOA as owner.\n" +
        "   This is INSECURE for production; transfer ownership to a timelock/Safe ASAP.\n"
      );
    } else {
      throw new Error(
        "Refusing to deploy to Monad mainnet with the deployer EOA as owner.\n" +
        "   Set OWNER_ADDRESS to a Gnosis Safe multisig (ideally owning a ChainPeTimelock).\n" +
        "   Deploy a timelock first:  npx hardhat run scripts/deploy-timelock.ts --network monad\n" +
        "   To override for testing only, set ALLOW_DEPLOYER_OWNER=true."
      );
    }
  }

  console.log(`\nDeploying ChainPeRegistryUpgradeable (UUPS proxy) to ${network.name} (chainId ${chainId})`);
  console.log(`  Deployer:         ${deployer.address}`);
  console.log(`  Fee token:        ${feeToken}`);
  console.log(`  Fee recipient:    ${feeRecipient}`);
  console.log(`  Registration fee: ${feeHuman} (${registrationFee} atomic)`);
  console.log(`  Identity reg:     ${identityRegistry}`);
  console.log(`  Owner:            ${ownerAddress}${ownerAddress === deployer.address ? " (⚠ same as deployer)" : " ✓ multisig"}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`  Deployer balance: ${formatMon(balance)}\n`);

  // 1. Deploy implementation.
  const Impl = await ethers.getContractFactory("ChainPeRegistryUpgradeable");
  const impl = await Impl.deploy();
  await impl.waitForDeployment();
  const implAddr = await impl.getAddress();
  console.log("  Implementation:", implAddr);

  // 2. Encode initialize calldata.
  const initData = Impl.interface.encodeFunctionData("initialize", [
    feeToken,
    feeRecipient,
    registrationFee,
    identityRegistry,
    ownerAddress,
  ]);

  // 3. Deploy ERC-1967 proxy.
  const Proxy = await ethers.getContractFactory(
    "contracts/erc8004/ERC1967Proxy.sol:ERC1967Proxy"
  );
  const proxy = await Proxy.deploy(implAddr, initData);
  await proxy.waitForDeployment();
  const proxyAddr = await proxy.getAddress();
  console.log("  Proxy (use this address):", proxyAddr);

  // 4. Sanity-check owner.
  const registry = await ethers.getContractAt("ChainPeRegistryUpgradeable", proxyAddr);
  const onChainOwner = await registry.owner();
  if (onChainOwner.toLowerCase() !== ownerAddress.toLowerCase()) {
    throw new Error(`Owner mismatch! On-chain: ${onChainOwner}, expected: ${ownerAddress}`);
  }

  console.log("\n========================================");
  console.log("  ChainPeRegistryUpgradeable deployed");
  console.log("========================================");
  console.log(`  Proxy:          ${proxyAddr}  ← use this`);
  console.log(`  Implementation: ${implAddr}`);
  console.log(`  Owner:          ${onChainOwner}`);

  const dir = join(__dirname, "..", "deployments");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const out = {
    network: network.name,
    chainId,
    chainPeRegistryProxy: proxyAddr,
    chainPeRegistryImpl: implAddr,
    feeToken,
    feeRecipient,
    registrationFee: registrationFee.toString(),
    identityRegistry,
    owner: onChainOwner,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    upgradeable: true,
  };
  const file = join(dir, `${network.name}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log(`\n  Saved -> deployments/${network.name}.json`);
  console.log(`\n  Verify implementation with:`);
  console.log(`  npx hardhat verify --network ${network.name} ${implAddr}`);
  if (ownerAddress === deployer.address) {
    console.log(`\n  ⚠  Transfer ownership to a Gnosis Safe BEFORE registrations go live:`);
    console.log(`     SAFE_ADDRESS=0x... npx hardhat run scripts/transfer-ownership.ts --network ${network.name}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
