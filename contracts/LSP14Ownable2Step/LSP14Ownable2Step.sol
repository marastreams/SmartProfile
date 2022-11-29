// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// interfaces
import {ILSP1UniversalReceiver} from "../LSP1UniversalReceiver/ILSP1UniversalReceiver.sol";

// modules
import {OwnableUnset} from "@erc725/smart-contracts/contracts/custom/OwnableUnset.sol";
import {ERC165Checker} from "../Custom/ERC165Checker.sol";

// errors
import "./LSP14Errors.sol";

// constants
import {
    _TYPEID_LSP14_OwnershipTransferStarted,
    _TYPEID_LSP14_OwnershipTransferred_SenderNotification,
    _TYPEID_LSP14_OwnershipTransferred_RecipientNotification
} from "./LSP14Constants.sol";
import {_INTERFACEID_LSP1} from "../LSP1UniversalReceiver/LSP1Constants.sol";

/**
 * @title LSP14Ownable2Step
 * @author Fabian Vogelsteller <fabian@lukso.network>, Jean Cavallera (CJ42), Yamen Merhi (YamenMerhi), Daniel Afteni (B00ste)
 * @dev This contract is a modified version of the OwnableUnset implementation, where transferring and renouncing ownership
 *      works as a 2 steps process. This can be used as a confirmation mechanism to prevent potential mistakes when
 *      transferring ownership of the contract, where the control of the contract could be lost forever.
 */
abstract contract LSP14Ownable2Step is OwnableUnset {
    /**
     * @dev emitted whenever the `transferOwnership(..)` 2-step process is started
     */
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);

    /**
     * @dev emitted whenever the `renounceOwnership(..)` 2-step process is started
     */
    event RenounceOwnershipInitiated();

    /**
     * @dev emitted when ownership of the contract has been renounced
     */
    event OwnershipRenounced();

    /**
     * @dev The number of block that MUST pass before one is able to
     *  confirm renouncing ownership
     */
    uint256 private constant _RENOUNCE_OWNERSHIP_CONFIRMATION_DELAY = 100;

    /**
     * @dev The number of blocks during which one can renounce ownership
     */
    uint256 private constant _RENOUNCE_OWNERSHIP_CONFIRMATION_PERIOD = 100;

    /**
     * @dev The block number saved when initiating the process of
     * renouncing ownerhsip
     */
    uint256 private _renounceOwnershipStartedAt;

    /**
     * @dev The address that ownership of the contract is transferred to.
     * This address may use `acceptOwnership()` to gain ownership of the contract.
     * Meaning that the current owner will lose access to the methods marked as
     * `onlyOwner` in favor to the `_pendingOwner`.
     */
    address private _pendingOwner;

    // --- General Methods

    /**
     * @dev Returns the address of the current pending owner.
     */
    function pendingOwner() public view virtual returns (address) {
        return _pendingOwner;
    }

    function transferOwnership(address newOwner) public virtual override onlyOwner {
        _transferOwnership(newOwner);
    }

    function acceptOwnership() public virtual {
        _acceptOwnership();
    }

    function renounceOwnership() public virtual override onlyOwner {
        _renounceOwnership();
    }

    // --- Internal methods

    /**
     * @dev Start the process of transferring ownership of the contract
     * and notify the new owner about it.
     *
     * Requirements:
     * - `newOwner` MUST NOT accept ownership of the contract in the same transaction.
     */
    function _transferOwnership(address newOwner) internal virtual {
        if (newOwner == address(this)) revert CannotTransferOwnershipToSelf();
        
        _pendingOwner = newOwner;
        address currentOwner = owner();
        emit OwnershipTransferStarted(currentOwner, newOwner);
        
        _notifyUniversalReceiver(newOwner, _TYPEID_LSP14_OwnershipTransferStarted, "");  
        require(
            currentOwner == owner(),
            "LSP14: newOwner MUST accept ownership in a separate transaction"
        );

    }

    /**
     * @dev Accept ownership of the contract and notify
     * previous owner and the new owner that ownership has been transferred.
     */
    function _acceptOwnership() internal virtual {
        require(msg.sender == pendingOwner(), "LSP14: caller is not the pendingOwner");

        address previousOwner = owner();
        _setOwner(_pendingOwner);
        delete _pendingOwner;

        _notifyUniversalReceiver(
            previousOwner,
            _TYPEID_LSP14_OwnershipTransferred_SenderNotification,
            ""
        );
        _notifyUniversalReceiver(
            msg.sender,
            _TYPEID_LSP14_OwnershipTransferred_RecipientNotification,
            ""
        );
    }

    /**
     * @dev initiate or confirm the process of renouncing ownership. Leaves the contract
     * without an owner, making functions marked as `onlyOwner` not callable anymore.
     */
    function _renounceOwnership() internal virtual {
        uint256 currentBlock = block.number;
        uint256 confirmationPeriodStart = _renounceOwnershipStartedAt +
            _RENOUNCE_OWNERSHIP_CONFIRMATION_DELAY;
        uint256 confirmationPeriodEnd = confirmationPeriodStart +
            _RENOUNCE_OWNERSHIP_CONFIRMATION_PERIOD;

        if (currentBlock > confirmationPeriodEnd) {
            _renounceOwnershipStartedAt = currentBlock;
            emit RenounceOwnershipInitiated();
            return;
        }

        if (currentBlock < confirmationPeriodStart) {
            revert NotInRenounceOwnershipInterval(confirmationPeriodStart, confirmationPeriodEnd);
        }

        _setOwner(address(0));
        delete _renounceOwnershipStartedAt;
        delete _pendingOwner;
        emit OwnershipRenounced();
    }

    // --- URD Hooks

    /**
     * @dev Calls the universalReceiver function of the Universal Profile
     * if supports LSP1 InterfaceId
     */
    function _notifyUniversalReceiver(
        address notifiedContract,
        bytes32 typeId,
        bytes memory data
    ) internal virtual {
        if (ERC165Checker.supportsERC165Interface(notifiedContract, _INTERFACEID_LSP1)) {
            ILSP1UniversalReceiver(notifiedContract).universalReceiver(typeId, data);
        }
    }
}
