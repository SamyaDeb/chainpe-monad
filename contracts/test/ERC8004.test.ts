import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { deployRegistryProxy } from "./helpers/proxies";
import { deployErc8004 } from "../scripts/lib/deployErc8004";

/**
 * Integration tests for the vendored ERC-8004 registries. These prove the
 * official reference contracts deploy via the bootstrap proxy pattern and that
 * the core identity + reputation flow works end-to-end in our Hardhat setup.
 *
 * Note: agent ids are 0-indexed in the reference implementation, and an agent
 * owner/operator cannot leave feedback on its own agent (self-feedback guard),
 * so feedback is given by a separate `client` account.
 */
describe("ERC-8004 (vendored reference contracts)", () => {
  it("deploys all three registries behind proxies and wires identity", async () => {
    const { identityRegistry, reputationRegistry, validationRegistry } = await deployErc8004();
    expect(identityRegistry).to.properAddress;
    expect(reputationRegistry).to.properAddress;
    expect(validationRegistry).to.properAddress;

    const reputation = await ethers.getContractAt(
      "ReputationRegistryUpgradeable",
      reputationRegistry
    );
    expect(await reputation.getIdentityRegistry()).to.equal(identityRegistry);

    const validation = await ethers.getContractAt(
      "ValidationRegistryUpgradeable",
      validationRegistry
    );
    expect(await validation.getIdentityRegistry()).to.equal(identityRegistry);
  });

  it("bootstraps proxies owned by the deployer with initializers consumed", async () => {
    const [deployer] = await ethers.getSigners();
    const { identityRegistry, reputationRegistry, validationRegistry } = await deployErc8004();

    const identity = await ethers.getContractAt("IdentityRegistryUpgradeable", identityRegistry);
    const reputation = await ethers.getContractAt("ReputationRegistryUpgradeable", reputationRegistry);
    const validation = await ethers.getContractAt("ValidationRegistryUpgradeable", validationRegistry);

    // Ownership carried over from the minimal-UUPS bootstrap to the real impls.
    expect(await identity.owner()).to.equal(deployer.address);
    expect(await reputation.owner()).to.equal(deployer.address);
    expect(await validation.owner()).to.equal(deployer.address);

    // The reinitializer(2) slot is consumed — initialize cannot be replayed.
    await expect(identity.initialize()).to.be.revertedWithCustomError(
      identity, "InvalidInitialization"
    );
    await expect(reputation.initialize(identityRegistry)).to.be.revertedWithCustomError(
      reputation, "InvalidInitialization"
    );
    await expect(validation.initialize(identityRegistry)).to.be.revertedWithCustomError(
      validation, "InvalidInitialization"
    );
  });

  it("registers an agent identity (ERC-721) with a token URI", async () => {
    const [provider] = await ethers.getSigners();
    const { identityRegistry } = await deployErc8004();
    const identity = await ethers.getContractAt("IdentityRegistryUpgradeable", identityRegistry);

    await expect(identity.connect(provider)["register(string)"]("ipfs://agent-card.json"))
      .to.emit(identity, "Registered")
      .withArgs(0n, "ipfs://agent-card.json", provider.address);

    // agentId 0 is the first agent; owner is the provider.
    expect(await identity.ownerOf(0n)).to.equal(provider.address);
    expect(await identity.tokenURI(0n)).to.equal("ipfs://agent-card.json");
  });

  it("lets a client leave feedback and reads it back via getSummary", async () => {
    const [provider, client] = await ethers.getSigners();
    const { identityRegistry, reputationRegistry } = await deployErc8004();
    const identity = await ethers.getContractAt("IdentityRegistryUpgradeable", identityRegistry);
    const reputation = await ethers.getContractAt(
      "ReputationRegistryUpgradeable",
      reputationRegistry
    );

    await identity.connect(provider)["register(string)"]("ipfs://weather-agent");
    const agentId = 0n;

    // value 90 with 0 decimals, tagged "quality"/"weather" (x402 use case).
    await expect(
      reputation
        .connect(client)
        .giveFeedback(agentId, 90, 0, "quality", "weather", "https://weather.example.com", "", ethers.ZeroHash)
    )
      .to.emit(reputation, "NewFeedback");

    const [count, summaryValue] = await reputation.getSummary(
      agentId,
      [client.address],
      "",
      ""
    );
    expect(count).to.equal(1n);
    expect(summaryValue).to.equal(90n);
  });

  it("blocks self-feedback from the agent owner", async () => {
    const [provider] = await ethers.getSigners();
    const { identityRegistry, reputationRegistry } = await deployErc8004();
    const identity = await ethers.getContractAt("IdentityRegistryUpgradeable", identityRegistry);
    const reputation = await ethers.getContractAt(
      "ReputationRegistryUpgradeable",
      reputationRegistry
    );

    await identity.connect(provider)["register(string)"]("ipfs://agent");
    await expect(
      reputation
        .connect(provider)
        .giveFeedback(0n, 50, 0, "quality", "", "", "", ethers.ZeroHash)
    ).to.be.revertedWith("Self-feedback not allowed");
  });

});

describe("ChainPeRegistry ↔ ERC-8004 agent link (owner check)", () => {
  const service = (payTo: string, agentId: bigint, name = "Weather API") => ({
    name,
    description: "Weather data",
    tags: "weather",
    endpoint: "https://weather.example.com",
    pricePerRequest: "0.01",
    paymentToken: "USDC",
    network: "monad-testnet",
    payTo,
    agentId,
  });

  async function fixture() {
    const [owner, dev, treasury, other, operator] = await ethers.getSigners();
    const { identityRegistry } = await deployErc8004();
    const identity = await ethers.getContractAt("IdentityRegistryUpgradeable", identityRegistry);
    // Agent #0 is minted to `other` (the canonical registry mints a #0 too);
    // `dev` owns agent #1, `other` owns agent #2.
    await identity.connect(other)["register(string)"]("ipfs://zero");
    await identity.connect(dev)["register(string)"]("ipfs://dev-agent");
    await identity.connect(other)["register(string)"]("ipfs://other-agent");

    const Usdc = await ethers.getContractFactory("MockUSDC");
    const usdc = await Usdc.deploy();
    const registry = await deployRegistryProxy(
      await usdc.getAddress(),
      treasury.address,
      0n, // zero fee for simplicity here
      identityRegistry,
      owner.address
    );
    return { registry, identity, owner, dev, other, operator };
  }

  it("the agent's owner can link it", async () => {
    const { registry, identity, dev } = await loadFixture(fixture);
    expect(await registry.identityRegistry()).to.equal(await identity.getAddress());
    await registry.connect(dev).register(service(dev.address, 1n));
    expect((await registry.getService(dev.address, "Weather API")).agentId).to.equal(1n);
  });

  it("someone else's agent cannot be linked", async () => {
    const { registry, dev } = await loadFixture(fixture);
    await expect(registry.connect(dev).register(service(dev.address, 2n)))
      .to.be.revertedWithCustomError(registry, "NotAgentOwner")
      .withArgs(dev.address, 2n);
  });

  it("a nonexistent agent cannot be linked", async () => {
    const { registry, identity, dev } = await loadFixture(fixture);
    await expect(
      registry.connect(dev).register(service(dev.address, 99n))
    ).to.be.revertedWithCustomError(identity, "ERC721NonexistentToken");
  });

  it("agentId 0 means unlinked and is never checked", async () => {
    const { registry, dev } = await loadFixture(fixture);
    await registry.connect(dev).register(service(dev.address, 0n));
    expect((await registry.getService(dev.address, "Weather API")).agentId).to.equal(0n);
  });

  it("an operator approved for all, or for the agent, can link it", async () => {
    const { registry, identity, other, operator, dev } = await loadFixture(fixture);
    await identity.connect(other).setApprovalForAll(operator.address, true);
    await registry.connect(operator).register(service(operator.address, 2n));

    await identity.connect(dev).approve(operator.address, 1n);
    await registry.connect(operator).register(service(operator.address, 1n, "Second API"));
    expect((await registry.getService(operator.address, "Second API")).agentId).to.equal(1n);
  });

  it("update enforces the same check", async () => {
    const { registry, dev } = await loadFixture(fixture);
    await registry.connect(dev).register(service(dev.address, 1n));
    await expect(registry.connect(dev).update(service(dev.address, 2n)))
      .to.be.revertedWithCustomError(registry, "NotAgentOwner")
      .withArgs(dev.address, 2n);
    await registry.connect(dev).update(service(dev.address, 0n));
    expect((await registry.getService(dev.address, "Weather API")).agentId).to.equal(0n);
  });
});
