// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.0;

// interfaces
import {IERC725Y} from "@erc725/smart-contracts/contracts/interfaces/IERC725Y.sol";
import {ILSP1UniversalReceiverDelegate} from "../ILSP1UniversalReceiverDelegate.sol";
import {ILSP6KeyManager} from "../../LSP6KeyManager/ILSP6KeyManager.sol";
import {ILSP7DigitalAsset} from "../../LSP7DigitalAsset/ILSP7DigitalAsset.sol";

// modules
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {ERC725Y} from "@erc725/smart-contracts/contracts/ERC725Y.sol";

// libraries
import {ERC165Checker} from "../../Custom/ERC165Checker.sol";
import {LSP1Utils} from "../LSP1Utils.sol";
import {LSP2Utils} from "../../LSP2ERC725YJSONSchema/LSP2Utils.sol";
import {LSP6Utils} from "../../LSP6KeyManager/LSP6Utils.sol";
import {LSP5Utils} from "../../LSP5ReceivedAssets/LSP5Utils.sol";
import {LSP10Utils} from "../../LSP10ReceivedVaults/LSP10Utils.sol";

// constants
import "../LSP1Constants.sol";
import "../../LSP6KeyManager/LSP6Constants.sol";
import "../../LSP9Vault/LSP9Constants.sol";
import "../../LSP14Ownable2Step/LSP14Constants.sol";

// errors
import "../LSP1Errors.sol";

/**
 * @title Core Implementation of contract writing the received Vaults and LSP7, LSP8 assets into your ERC725Account using
 *        the LSP5-ReceivedAsset and LSP10-ReceivedVaults standard and removing the sent vaults and assets.
 *
 * @author Fabian Vogelsteller, Yamen Merhi, Jean Cavallera
 * @dev Delegate contract of the initial universal receiver
 *
 * Owner of the UniversalProfile MUST be a KeyManager that allows (this) address to setData on the UniversalProfile
 *
 */
contract LSP1UniversalReceiverDelegateUP is ERC165, ILSP1UniversalReceiverDelegate {
    using ERC165Checker for address;

    /**
     * @inheritdoc ILSP1UniversalReceiverDelegate
     * @dev Allows to register arrayKeys and Map of incoming vaults and assets and removing them after being sent
     * @return result the return value of keyManager's execute function
     */
    function universalReceiverDelegate(
        address notifier,
        uint256 value, // solhint-disable no-unused-vars
        bytes32 typeId,
        bytes memory data // solhint-disable no-unused-vars
    ) public virtual returns (bytes memory result) {
        (bool invalid, bytes10 mapPrefix, bytes4 interfaceID, bool isReceiving) = LSP1Utils
            .getTransferDetails(typeId);

        if (invalid) return "LSP1: typeId out of scope";

        // solhint-disable avoid-tx-origin
        if (notifier == tx.origin) revert CannotRegisterEOAsAsAssets(notifier);

        (address keyManager, bool ownerIsKeyManager) = _validateCallerViaKeyManager();
        if (!ownerIsKeyManager) return "LSP1: account owner is not a LSP6KeyManager";

        bytes32 notifierMapKey = LSP2Utils.generateMappingKey(mapPrefix, bytes20(notifier));
        bytes memory notifierMapValue = IERC725Y(msg.sender).getData(notifierMapKey);

        if (isReceiving) {
            // if the map value is already set, then do nothing
            if (bytes12(notifierMapValue) != bytes12(0))
                return "LSP1: asset received is already registered";

            result = _whenReceiving(typeId, notifier, keyManager, notifierMapKey, interfaceID);
        } else {
            // if there is no map value for the asset/vault to remove, then do nothing
            if (bytes12(notifierMapValue) == bytes12(0))
                return "LSP1: asset sent is not registered";

            result = _whenSending(typeId, notifier, keyManager, notifierMapKey, notifierMapValue);
        }
    }

    // --- Internal functions

    /**
     * @dev To avoid stack too deep error
     * Generate the keys/values of the asset/vault received to set and set them
     * on the Key Manager depending on the type of the transfer (asset/vault)
     */
    function _whenReceiving(
        bytes32 typeId,
        address notifier,
        address keyManager,
        bytes32 notifierMapKey,
        bytes4 interfaceID
    ) internal returns (bytes memory result) {
        // if it's a token transfer (LSP7/LSP8)
        if (typeId != _TYPEID_LSP14_OwnershipTransferred_RecipientNotification) {
            // if the amount sent is 0, then do not update the keys
            uint256 balance = ILSP7DigitalAsset(notifier).balanceOf(msg.sender);
            if (balance == 0) return "LSP1: balance not updated";

            (bytes32[] memory dataKeys, bytes[] memory dataValues) = LSP5Utils
                .generateReceivedAssetKeys(msg.sender, notifier, notifierMapKey, interfaceID);

            result = LSP6Utils.setDataViaKeyManager(keyManager, dataKeys, dataValues);
        } else {
            (bytes32[] memory dataKeys, bytes[] memory dataValues) = LSP10Utils
                .generateReceivedVaultKeys(msg.sender, notifier, notifierMapKey, interfaceID);

            result = LSP6Utils.setDataViaKeyManager(keyManager, dataKeys, dataValues);
        }
    }

    /**
     * @dev To avoid stack too deep error
     * Generate the keys/values of the asset/vault sent to set and set them
     * on the Key Manager depending on the type of the transfer (asset/vault)
     */
    function _whenSending(
        bytes32 typeId,
        address notifier,
        address keyManager,
        bytes32 notifierMapKey,
        bytes memory notifierMapValue
    ) internal returns (bytes memory result) {
        // if it's a token transfer (LSP7/LSP8)
        if (typeId != _TYPEID_LSP14_OwnershipTransferred_SenderNotification) {
            // if the amount sent is not the full balance, then do not update the keys
            uint256 balance = ILSP7DigitalAsset(notifier).balanceOf(msg.sender);
            if (balance != 0) return "LSP1: full balance is not sent";

            (bytes32[] memory dataKeys, bytes[] memory dataValues) = LSP5Utils
                .generateSentAssetKeys(msg.sender, notifierMapKey, notifierMapValue);

            result = LSP6Utils.setDataViaKeyManager(keyManager, dataKeys, dataValues);
        } else {
            (bytes32[] memory dataKeys, bytes[] memory dataValues) = LSP10Utils
                .generateSentVaultKeys(msg.sender, notifierMapKey, notifierMapValue);

            result = LSP6Utils.setDataViaKeyManager(keyManager, dataKeys, dataValues);
        }
    }

    /**
     * @dev Check if the caller is owned by an LSP6KeyManager and linked to
     * the owner returned
     */
    function _validateCallerViaKeyManager()
        internal
        view
        returns (address accountOwner, bool ownerIsKeyManager)
    {
        accountOwner = ERC725Y(msg.sender).owner();
        if (accountOwner.supportsERC165Interface(_INTERFACEID_LSP6)) ownerIsKeyManager = true;

        address target = ILSP6KeyManager(accountOwner).target();
        // check if the caller is the same account controlled by the keyManager
        if (target != msg.sender) revert CallerNotLSP6LinkedTarget(msg.sender, target);
    }

    // --- Overrides

    /**
     * @inheritdoc ERC165
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == _INTERFACEID_LSP1_DELEGATE || super.supportsInterface(interfaceId);
    }
}
