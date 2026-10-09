// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ITeleporterReceiver} from "./ITeleporter.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ChainPeICMReceiver
 * @notice Receives ChainPe payment intents from another Avalanche L1 over ICM
 * (Teleporter) and records them. Deployed on the L1 where the service lives
 * (e.g. the C-Chain). Only the local Teleporter messenger may deliver messages.
 *
 * @dev The Teleporter protocol authenticates that a message originated from the
 * stated `sourceBlockchainID` and `originSenderAddress`. The `msg.sender ==
 * messenger` check ensures only the real Teleporter contract can call
 * `receiveTeleporterMessage`. For additional defence the owner may register
 * `trustedSenders`: once set for a source chain, only messages from that exact
 * sender address (the ChainPeICMSender on that chain) are accepted.
 */
contract ChainPeICMReceiver is ITeleporterReceiver, Ownable {
    address public immutable messenger;

    /// sourceBlockchainID => trusted ChainPeICMSender address.
    /// Zero (unset) means any sender on that source chain is accepted.
    mapping(bytes32 => address) public trustedSenders;

    // NOTE: Intents are NOT stored on-chain. Every delivered intent is emitted as
    // a `CrossChainPaymentIntent` event carrying the full payload — off-chain
    // consumers should index that event. This keeps per-message cost to a single
    // log instead of ~6 cold storage writes.

    event CrossChainPaymentIntent(
        bytes32 indexed sourceBlockchainID,
        address indexed buyer,
        address indexed payTo,
        uint256 amount,
        bytes32 serviceId,
        address originSender
    );

    event TrustedSenderSet(bytes32 indexed sourceBlockchainID, address indexed sender);

    constructor(address messenger_) Ownable(msg.sender) {
        require(messenger_ != address(0), "messenger=0");
        messenger = messenger_;
    }

    /**
     * @notice Register the trusted ChainPeICMSender for a source chain.
     * @dev Set to address(0) to accept any sender from that source chain again.
     */
    function setTrustedSender(bytes32 sourceBlockchainID, address sender) external onlyOwner {
        trustedSenders[sourceBlockchainID] = sender;
        emit TrustedSenderSet(sourceBlockchainID, sender);
    }

    /// @inheritdoc ITeleporterReceiver
    function receiveTeleporterMessage(
        bytes32 sourceBlockchainID,
        address originSenderAddress,
        bytes calldata message
    ) external {
        require(msg.sender == messenger, "only teleporter");

        // If a trusted sender is registered for this source chain, enforce it.
        address trusted = trustedSenders[sourceBlockchainID];
        if (trusted != address(0)) {
            require(originSenderAddress == trusted, "untrusted sender");
        }

        (bytes32 serviceId, address payTo, uint256 amount, address buyer) = abi.decode(
            message,
            (bytes32, address, uint256, address)
        );

        emit CrossChainPaymentIntent(
            sourceBlockchainID,
            buyer,
            payTo,
            amount,
            serviceId,
            originSenderAddress
        );
    }
}
