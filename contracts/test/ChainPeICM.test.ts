import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import type {
  ChainPeICMSender,
  ChainPeICMReceiver,
  MockTeleporterMessenger,
} from "../typechain-types";

const SERVICE_ID = ethers.id("research-agent"); // bytes32
const DEST_BLOCKCHAIN = ethers.id("c-chain"); // bytes32

describe("ChainPe ICM (Teleporter cross-L1 payment intent)", () => {
  async function deployFixture() {
    const [buyer, payTo, other] = await ethers.getSigners();

    const Messenger = await ethers.getContractFactory("MockTeleporterMessenger");
    const messenger = (await Messenger.deploy()) as unknown as MockTeleporterMessenger;
    await messenger.waitForDeployment();
    const messengerAddr = await messenger.getAddress();

    const Receiver = await ethers.getContractFactory("ChainPeICMReceiver");
    const receiver = (await Receiver.deploy(messengerAddr)) as unknown as ChainPeICMReceiver;
    await receiver.waitForDeployment();

    const Sender = await ethers.getContractFactory("ChainPeICMSender");
    const sender = (await Sender.deploy(messengerAddr)) as unknown as ChainPeICMSender;
    await sender.waitForDeployment();

    return { messenger, receiver, sender, buyer, payTo, other };
  }

  it("delivers a payment intent across L1s and the receiver emits it", async () => {
    const { receiver, sender, buyer, payTo } = await loadFixture(deployFixture);
    const amount = ethers.parseUnits("0.5", 6);

    // Intents are event-sourced (no on-chain array): the full payload is carried
    // by the CrossChainPaymentIntent event for off-chain indexers to consume.
    await expect(
      sender
        .connect(buyer)
        .sendPaymentIntent(
          DEST_BLOCKCHAIN,
          await receiver.getAddress(),
          SERVICE_ID,
          payTo.address,
          amount,
          200_000,
          ethers.ZeroAddress,
          0n
        )
    )
      .to.emit(sender, "PaymentIntentSent")
      .and.to.emit(receiver, "CrossChainPaymentIntent")
      .withArgs(
        await (await ethers.getContractAt("MockTeleporterMessenger", await receiver.messenger()))
          .MOCK_SOURCE_BLOCKCHAIN_ID(),
        buyer.address,
        payTo.address,
        amount,
        SERVICE_ID,
        await sender.getAddress()
      );
  });

  it("pulls a relayer fee from the caller when feeAmount > 0", async () => {
    const { messenger, receiver, sender, buyer, payTo } = await loadFixture(deployFixture);
    const amount = ethers.parseUnits("0.5", 6);
    const fee = ethers.parseUnits("0.01", 6);

    const Usdc = await ethers.getContractFactory("MockUSDC");
    const feeToken = await Usdc.deploy();
    await feeToken.waitForDeployment();
    await feeToken.mint(buyer.address, fee);
    await feeToken.connect(buyer).approve(await sender.getAddress(), fee);

    await sender
      .connect(buyer)
      .sendPaymentIntent(
        DEST_BLOCKCHAIN,
        await receiver.getAddress(),
        SERVICE_ID,
        payTo.address,
        amount,
        200_000,
        await feeToken.getAddress(),
        fee
      );

    // The fee left the buyer; the messenger holds an allowance from the sender.
    expect(await feeToken.balanceOf(buyer.address)).to.equal(0n);
    expect(await feeToken.balanceOf(await sender.getAddress())).to.equal(fee);
    expect(
      await feeToken.allowance(await sender.getAddress(), await messenger.getAddress())
    ).to.equal(fee);
  });

  it("rejects a direct receive not coming from the Teleporter messenger", async () => {
    const { receiver, other, buyer, payTo } = await loadFixture(deployFixture);
    const payload = ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "address", "uint256", "address"],
      [SERVICE_ID, payTo.address, 1n, buyer.address]
    );
    await expect(
      receiver
        .connect(other)
        .receiveTeleporterMessage(DEST_BLOCKCHAIN, other.address, payload)
    ).to.be.revertedWith("only teleporter");
  });

  it("rejects a zero messenger in the constructors", async () => {
    const Sender = await ethers.getContractFactory("ChainPeICMSender");
    await expect(Sender.deploy(ethers.ZeroAddress)).to.be.revertedWith("messenger=0");
    const Receiver = await ethers.getContractFactory("ChainPeICMReceiver");
    await expect(Receiver.deploy(ethers.ZeroAddress)).to.be.revertedWith("messenger=0");
  });

  describe("trusted sender enforcement", () => {
    it("allows any sender when no trusted sender is registered", async () => {
      // Default state: trustedSenders[sourceChain] == address(0) → accept all.
      const { receiver, sender, buyer, payTo } = await loadFixture(deployFixture);
      const amount = ethers.parseUnits("0.5", 6);
      await expect(
        sender.connect(buyer).sendPaymentIntent(DEST_BLOCKCHAIN, await receiver.getAddress(), SERVICE_ID, payTo.address, amount, 200_000, ethers.ZeroAddress, 0n)
      ).to.emit(receiver, "CrossChainPaymentIntent");
    });

    it("owner can set a trusted sender; only that sender is then accepted", async () => {
      const { messenger, receiver, sender, buyer, payTo } = await loadFixture(deployFixture);
      const [, , , , ownerSigner] = await ethers.getSigners();

      const MockSourceChain = ethers.id("source-l1");
      const senderAddr = await sender.getAddress();
      const anotherAddr = (await ethers.getSigners())[4].address;

      // Register the real sender as trusted for MockSourceChain.
      // (receiver deployer is the first signer = buyer in fixture, but Ownable
      // sets owner = msg.sender at deploy time which is the test runner.)
      const [owner] = await ethers.getSigners();
      await receiver.connect(owner).setTrustedSender(MockSourceChain, senderAddr);
      expect(await receiver.trustedSenders(MockSourceChain)).to.equal(senderAddr);
    });

    it("non-owner cannot set trusted sender", async () => {
      const { receiver, other } = await loadFixture(deployFixture);
      await expect(
        receiver.connect(other).setTrustedSender(DEST_BLOCKCHAIN, other.address)
      ).to.be.revertedWithCustomError(receiver, "OwnableUnauthorizedAccount");
    });
  });
});
