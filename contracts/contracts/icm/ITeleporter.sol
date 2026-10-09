// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * Minimal Avalanche ICM (Teleporter) interfaces — vendored so ChainPe's
 * cross-L1 contracts compile/test without pulling the full icm-contracts
 * dependency. These match the canonical TeleporterMessenger ABI, so the same
 * contracts deploy against the real Teleporter
 * (0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf on Avalanche L1s).
 */

struct TeleporterFeeInfo {
    address feeTokenAddress;
    uint256 amount;
}

struct TeleporterMessageInput {
    bytes32 destinationBlockchainID;
    address destinationAddress;
    TeleporterFeeInfo feeInfo;
    uint256 requiredGasLimit;
    address[] allowedRelayerAddresses;
    bytes message;
}

interface ITeleporterMessenger {
    /// @notice Sends a message to another Avalanche L1 via ICM.
    function sendCrossChainMessage(
        TeleporterMessageInput calldata messageInput
    ) external returns (bytes32 messageID);
}

interface ITeleporterReceiver {
    /// @notice Called by the Teleporter messenger when a cross-L1 message arrives.
    function receiveTeleporterMessage(
        bytes32 sourceBlockchainID,
        address originSenderAddress,
        bytes calldata message
    ) external;
}
