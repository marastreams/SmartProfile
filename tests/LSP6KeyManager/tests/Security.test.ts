import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { EIP191Signer } from "@lukso/eip191-signer.js";

import {
  Reentrancy,
  Reentrancy__factory,
  TargetContract,
  TargetContract__factory,
} from "../../../types";

// constants
import {
  ALL_PERMISSIONS,
  ERC725YKeys,
  OPERATION_TYPES,
  LSP6_VERSION,
  PERMISSIONS,
} from "../../../constants";

// setup
import { LSP6TestContext } from "../../utils/context";
import { setupKeyManager } from "../../utils/fixtures";

// helpers
import {
  provider,
  combinePermissions,
  EMPTY_PAYLOAD,
  LOCAL_PRIVATE_KEYS,
  combineAllowedCalls,
} from "../../utils/helpers";

export const testSecurityScenarios = (
  buildContext: () => Promise<LSP6TestContext>
) => {
  let context: LSP6TestContext;

  let signer: SignerWithAddress,
    relayer: SignerWithAddress,
    addressWithNoPermissions: SignerWithAddress;

  let attacker: SignerWithAddress;

  let targetContract: TargetContract, maliciousContract: Reentrancy;

  beforeEach(async () => {
    context = await buildContext();

    signer = context.accounts[1];
    relayer = context.accounts[2];
    addressWithNoPermissions = context.accounts[3];

    attacker = context.accounts[4];

    targetContract = await new TargetContract__factory(
      context.accounts[0]
    ).deploy();

    maliciousContract = await new Reentrancy__factory(attacker).deploy(
      context.keyManager.address
    );

    const permissionKeys = [
      ERC725YKeys.LSP6["AddressPermissions:Permissions"] +
        context.owner.address.substring(2),
      ERC725YKeys.LSP6["AddressPermissions:Permissions"] +
        signer.address.substring(2),
      ERC725YKeys.LSP6["AddressPermissions:AllowedCalls"] +
        signer.address.substring(2),
    ];

    const permissionValues = [
      ALL_PERMISSIONS,
      combinePermissions(PERMISSIONS.CALL, PERMISSIONS.TRANSFERVALUE),
      combineAllowedCalls(
        ["0xffffffff", "0xffffffff"],
        [signer.address, ethers.constants.AddressZero],
        ["0xffffffff", "0xffffffff"]
      ),
    ];

    await setupKeyManager(context, permissionKeys, permissionValues);

    // Fund Universal Profile with some LYXe
    await context.owner.sendTransaction({
      to: context.universalProfile.address,
      value: ethers.utils.parseEther("10"),
    });
  });

  it("Should revert when caller has no permissions set", async () => {
    let targetContractPayload = targetContract.interface.encodeFunctionData(
      "setName",
      ["New Contract Name"]
    );

    let executePayload = context.universalProfile.interface.encodeFunctionData(
      "execute(uint256,address,uint256,bytes)",
      [OPERATION_TYPES.CALL, targetContract.address, 0, targetContractPayload]
    );

    await expect(
      context.keyManager
        .connect(addressWithNoPermissions)
        .execute(executePayload)
    )
      .to.be.revertedWithCustomError(context.keyManager, "NoPermissionsSet")
      .withArgs(addressWithNoPermissions.address);
  });

  describe("should revert when admin with ALL PERMISSIONS try to call `renounceOwnership(...)`", () => {
    it("via `execute(...)`", async () => {
      let payload =
        context.universalProfile.interface.getSighash("renounceOwnership");

      await expect(context.keyManager.connect(context.owner).execute(payload))
        .to.be.revertedWithCustomError(
          context.keyManager,
          "InvalidERC725Function"
        )
        .withArgs(payload);
    });

    it("via `executeRelayCall()`", async () => {
      const HARDHAT_CHAINID = 31337;
      let valueToSend = 0;

      let nonce = await context.keyManager.getNonce(context.owner.address, 0);

      let payload =
        context.universalProfile.interface.getSighash("renounceOwnership");

      let encodedMessage = ethers.utils.solidityPack(
        ["uint256", "uint256", "uint256", "uint256", "bytes"],
        [LSP6_VERSION, HARDHAT_CHAINID, nonce, valueToSend, payload]
      );

      const eip191Signer = new EIP191Signer();

      let { signature } = await eip191Signer.signDataWithIntendedValidator(
        context.keyManager.address,
        encodedMessage,
        LOCAL_PRIVATE_KEYS.ACCOUNT0
      );

      await expect(
        context.keyManager
          .connect(context.owner)
          .executeRelayCall(signature, nonce, payload, {
            value: valueToSend,
          })
      )
        .to.be.revertedWithCustomError(
          context.keyManager,
          "InvalidERC725Function"
        )
        .withArgs(payload);
    });
  });

  describe("when sending LYX to a contract", () => {
    it("Permissions should prevent ReEntrancy and stop malicious contract with a re-entrant fallback() function.", async () => {
      // the Universal Profile wants to send 1 x LYX from its UP to another smart contract
      // we assume the UP owner is not aware that some malicious code is present
      // in the fallback function of the target (= recipient) contract
      let transferPayload =
        context.universalProfile.interface.encodeFunctionData(
          "execute(uint256,address,uint256,bytes)",
          [
            OPERATION_TYPES.CALL,
            maliciousContract.address,
            ethers.utils.parseEther("1"),
            EMPTY_PAYLOAD,
          ]
        );

      let executePayload = context.keyManager.interface.encodeFunctionData(
        "execute",
        [transferPayload]
      );
      // load the malicious payload, that will be executed in the fallback function
      // every time the contract receives LYX
      await maliciousContract.loadPayload(executePayload);

      let initialAccountBalance = await provider.getBalance(
        context.universalProfile.address
      );
      let initialAttackerContractBalance = await provider.getBalance(
        maliciousContract.address
      );

      // send LYX to malicious contract
      await context.keyManager.connect(context.owner).execute(transferPayload);
      // at this point, the malicious contract fallback function
      // try to drain funds by re-entering the call

      let newAccountBalance = await provider.getBalance(
        context.universalProfile.address
      );
      let newAttackerContractBalance = await provider.getBalance(
        maliciousContract.address
      );

      expect(newAccountBalance).to.equal(
        initialAccountBalance.sub(ethers.utils.parseEther("1"))
      );
      expect(newAttackerContractBalance).to.equal(ethers.utils.parseEther("1"));
    });

    describe("when calling via `executeRelayCall(...)`", () => {
      const channelId = 0;

      it("Replay Attack should fail because of invalid nonce", async () => {
        let nonce = await context.keyManager.callStatic.getNonce(
          signer.address,
          channelId
        );

        let executeRelayCallPayload =
          context.universalProfile.interface.encodeFunctionData(
            "execute(uint256,address,uint256,bytes)",
            [
              OPERATION_TYPES.CALL,
              signer.address,
              ethers.utils.parseEther("1"),
              EMPTY_PAYLOAD,
            ]
          );

        const HARDHAT_CHAINID = 31337;
        let valueToSend = 0;

        let encodedMessage = ethers.utils.solidityPack(
          ["uint256", "uint256", "uint256", "uint256", "bytes"],
          [
            LSP6_VERSION,
            HARDHAT_CHAINID,
            nonce,
            valueToSend,
            executeRelayCallPayload,
          ]
        );

        const eip191Signer = new EIP191Signer();

        const { signature } = await eip191Signer.signDataWithIntendedValidator(
          context.keyManager.address,
          encodedMessage,
          LOCAL_PRIVATE_KEYS.ACCOUNT1
        );

        // first call
        await context.keyManager
          .connect(relayer)
          .executeRelayCall(signature, nonce, executeRelayCallPayload, {
            value: valueToSend,
          });

        // 2nd call = replay attack
        await expect(
          context.keyManager
            .connect(relayer)
            .executeRelayCall(signature, nonce, executeRelayCallPayload)
        )
          .to.be.revertedWithCustomError(
            context.keyManager,
            "InvalidRelayNonce"
          )
          .withArgs(signer.address, nonce, signature);
      });
    });
  });
};
