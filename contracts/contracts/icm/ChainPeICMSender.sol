// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {
    ITeleporterMessenger,
    TeleporterMessageInput,
    TeleporterFeeInfo
} from "./ITeleporter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title ChainPeICMSender
 * @notice Sends a ChainPe payment intent from one Avalanche L1 to a
 * {ChainPeICMReceiver} on another L1, over Avalanche Interchain Messaging (ICM /
 * Teleporter). This lets an agent living on its own L1 hire a service registered
 * on the C-Chain (or any other L1) without leaving Avalanche.
 *
 * The intent is the cross-chain trigger; settlement still happens in USDC via
 * x402 on the destination. The payload is `(serviceId, payTo, amount, buyer)`.
 *
 * @dev Relayer fee: on mainnet a Teleporter message is only delivered if a
 * relayer is incentivized. Pass a non-zero `feeToken`/`feeAmount` to attach a
 * fee — the sender pulls it from the caller (who must approve this contract) and
 * forwards the allowance to the messenger. Passing `feeAmount = 0` keeps the
 * legacy free path (only delivered if a relayer relays gratis).
 */
contract ChainPeICMSender {
    using SafeERC20 for IERC20;

    ITeleporterMessenger public immutable messenger;

    event PaymentIntentSent(
        bytes32 indexed destinationBlockchainID,
        address indexed destinationAddress,
        bytes32 indexed serviceId,
        address payTo,
        uint256 amount,
        bytes32 messageID
    );

    constructor(address messenger_) {
        require(messenger_ != address(0), "messenger=0");
        messenger = ITeleporterMessenger(messenger_);
    }

    /**
     * @notice Send a payment intent to a receiver on another L1.
     * @param destinationBlockchainID the destination Avalanche L1 (blockchain id)
     * @param destinationAddress the {ChainPeICMReceiver} on that L1
     * @param serviceId the ChainPe service being hired
     * @param payTo the service's payout address (on the destination L1)
     * @param amount USDC amount (atomic) the buyer commits to pay
     * @param requiredGasLimit gas the receiver may use to process the message
     * @param feeToken ERC-20 used to pay the relayer (address(0) when feeAmount=0)
     * @param feeAmount relayer fee, pulled from msg.sender (0 = no fee)
     */
    function sendPaymentIntent(
        bytes32 destinationBlockchainID,
        address destinationAddress,
        bytes32 serviceId,
        address payTo,
        uint256 amount,
        uint256 requiredGasLimit,
        address feeToken,
        uint256 feeAmount
    ) external returns (bytes32 messageID) {
        if (feeAmount > 0) {
            require(feeToken != address(0), "feeToken=0");
            // Pull the fee from the caller and grant the messenger an allowance
            // for exactly this fee (forceApprove resets any stale allowance).
            IERC20(feeToken).safeTransferFrom(msg.sender, address(this), feeAmount);
            IERC20(feeToken).forceApprove(address(messenger), feeAmount);
        }

        bytes memory payload = abi.encode(serviceId, payTo, amount, msg.sender);

        messageID = messenger.sendCrossChainMessage(
            TeleporterMessageInput({
                destinationBlockchainID: destinationBlockchainID,
                destinationAddress: destinationAddress,
                feeInfo: TeleporterFeeInfo({feeTokenAddress: feeToken, amount: feeAmount}),
                requiredGasLimit: requiredGasLimit,
                allowedRelayerAddresses: new address[](0),
                message: payload
            })
        );

        emit PaymentIntentSent(
            destinationBlockchainID,
            destinationAddress,
            serviceId,
            payTo,
            amount,
            messageID
        );
    }
}
