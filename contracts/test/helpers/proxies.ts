/**
 * Deploys ChainPe's upgradeable contracts behind an ERC-1967 proxy, exactly as
 * scripts/deploy.ts and scripts/deploy-policyvault.ts do on Monad.
 */
import { ethers } from "hardhat";
import type { ChainPeRegistryUpgradeable, PolicyVaultUpgradeable } from "../../typechain-types";

const PROXY = "contracts/erc8004/ERC1967Proxy.sol:ERC1967Proxy";

export async function deployRegistryProxy(
  feeToken: string,
  feeRecipient: string,
  registrationFee: bigint,
  identityRegistry: string,
  owner: string
): Promise<ChainPeRegistryUpgradeable> {
  const Impl = await ethers.getContractFactory("ChainPeRegistryUpgradeable");
  const impl = await Impl.deploy();
  await impl.waitForDeployment();
  const initData = Impl.interface.encodeFunctionData("initialize", [
    feeToken,
    feeRecipient,
    registrationFee,
    identityRegistry,
    owner,
  ]);
  const Proxy = await ethers.getContractFactory(PROXY);
  const proxy = await Proxy.deploy(await impl.getAddress(), initData);
  await proxy.waitForDeployment();
  return (await ethers.getContractAt(
    "ChainPeRegistryUpgradeable",
    await proxy.getAddress()
  )) as unknown as ChainPeRegistryUpgradeable;
}

export async function deployVaultProxy(token: string, owner: string): Promise<PolicyVaultUpgradeable> {
  const Impl = await ethers.getContractFactory("PolicyVaultUpgradeable");
  const impl = await Impl.deploy();
  await impl.waitForDeployment();
  const initData = Impl.interface.encodeFunctionData("initialize", [token, owner]);
  const Proxy = await ethers.getContractFactory(PROXY);
  const proxy = await Proxy.deploy(await impl.getAddress(), initData);
  await proxy.waitForDeployment();
  return (await ethers.getContractAt(
    "PolicyVaultUpgradeable",
    await proxy.getAddress()
  )) as unknown as PolicyVaultUpgradeable;
}
