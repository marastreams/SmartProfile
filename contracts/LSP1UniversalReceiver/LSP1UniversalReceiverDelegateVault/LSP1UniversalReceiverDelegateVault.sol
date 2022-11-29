// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.0;

// interfaces
import {IERC725Y} from "@erc725/smart-contracts/contracts/interfaces/IERC725Y.sol";
import {ILSP1UniversalReceiverDelegate} from "../ILSP1UniversalReceiverDelegate.sol";
import {ILSP7DigitalAsset} from "../../LSP7DigitalAsset/ILSP7DigitalAsset.sol";

// modules
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {ERC725Y} from "@erc725/smart-contracts/contracts/ERC725Y.sol";

import {ERC165Checker} from "../../Custom/ERC165Checker.sol";
import {LSP1Utils} from "../LSP1Utils.sol";
import {LSP2Utils} from "../../LSP2ERC725YJSONSchema/LSP2Utils.sol";
import {LSP5Utils} from "../../LSP5ReceivedAssets/LSP5Utils.sol";

// constants
import "../LSP1Constants.sol";
import "../../LSP9Vault/LSP9Constants.sol";

// errors
import "../LSP1Errors.sol";

/**
 * @title Core Implementation of contract writing the received LSP7 and LSP8 assets into your Vault using
 *        the LSP5-ReceivedAsset standard and removing the sent assets.
 *
 * @author Fabian Vogelsteller, Yamen Merhi, Jean Cavallera
 * @dev Delegate contract of the initial universal receiver
 */
contract LSP1UniversalReceiverDelegateVault is ERC165, ILSP1UniversalReceiverDelegate {
    /**
     * @inheritdoc ILSP1UniversalReceiverDelegate
     * @dev allows to register arrayKeys and Map of incoming assets and remove after being sent
     * @return result The return value
     */
    function universalReceiverDelegate(
        address notifier,
        uint256 value, // solhint-disable no-unused-vars
        bytes32 typeId,
        bytes memory data // solhint-disable no-unused-vars
    ) public virtual returns (bytes memory result) {
        (bool invalid, bytes10 mapPrefix, bytes4 interfaceID, bool isReceiving) = LSP1Utils
            .getTransferDetails(typeId);

        if (invalid || interfaceID == _INTERFACEID_LSP9) return "LSP1: typeId out of scope";

        // solhint-disable avoid-tx-origin
        if (notifier == tx.origin) revert CannotRegisterEOAsAsAssets(notifier);

        bytes32 notifierMapKey = LSP2Utils.generateMappingKey(mapPrefix, bytes20(notifier));
        bytes memory notifierMapValue = IERC725Y(msg.sender).getData(notifierMapKey);

        if (isReceiving) {
            // if the amount sent is 0, then do not update the keys
            uint256 balance = ILSP7DigitalAsset(notifier).balanceOf(msg.sender);
            if (balance == 0) return "LSP1: balance not updated";

            // if the map value is already set, then do nothing
            if (bytes12(notifierMapValue) != bytes12(0))
                return "URD: asset received is already registered";

            (bytes32[] memory receiverDataKeys, bytes[] memory receiverDataValues) = LSP5Utils
                .generateReceivedAssetKeys(msg.sender, notifier, notifierMapKey, interfaceID);

            IERC725Y(msg.sender).setData(receiverDataKeys, receiverDataValues);
        } else {
            // if there is no map value for the asset to remove, then do nothing
            if (bytes12(notifierMapValue) == bytes12(0))
                return "LSP1: asset sent is not registered";
            // if it's a token transfer (LSP7/LSP8)
            uint256 balance = ILSP7DigitalAsset(notifier).balanceOf(msg.sender);
            if (balance != 0) return "LSP1: full balance is not sent";

            (bytes32[] memory senderDataKeys, bytes[] memory senderDataValues) = LSP5Utils
                .generateSentAssetKeys(msg.sender, notifierMapKey, notifierMapValue);

            IERC725Y(msg.sender).setData(senderDataKeys, senderDataValues);
        }
    }

    // --- Overrides

    /**
     * @inheritdoc ERC165
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == _INTERFACEID_LSP1_DELEGATE || super.supportsInterface(interfaceId);
    }
}
