import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { EIP191Signer } from "@lukso/eip191-signer.js";

import { TargetContract, TargetContract__factory } from "../../../types";

// constants
import {
  ERC725YKeys,
  ALL_PERMISSIONS,
  PERMISSIONS,
  LSP6_VERSION,
  OPERATION_TYPES,
} from "../../../constants";

// setup
import { LSP6TestContext } from "../../utils/context";
import { setupKeyManager } from "../../utils/fixtures";

// helpers
import {
  abiCoder,
  combineAllowedCalls,
  LOCAL_PRIVATE_KEYS,
} from "../../utils/helpers";

export const shouldBehaveLikePermissionCall = (
  buildContext: () => Promise<LSP6TestContext>
) => {
  let context: LSP6TestContext;

  let addressCanMakeCallNoAllowedCalls: SignerWithAddress,
    addressCanMakeCallWithAllowedCalls: SignerWithAddress,
    addressCannotMakeCall: SignerWithAddress;

  let targetContract: TargetContract;

  beforeEach(async () => {
    context = await buildContext();

    addressCanMakeCallNoAllowedCalls = context.accounts[1];
    addressCanMakeCallWithAllowedCalls = context.accounts[2];
    addressCannotMakeCall = context.accounts[3];

    targetContract = await new TargetContract__factory(
      context.accounts[0]
    ).deploy();

    const permissionKeys = [
      ERC725YKeys.LSP6["AddressPermissions:Permissions"] +
        context.owner.address.substring(2),
      ERC725YKeys.LSP6["AddressPermissions:Permissions"] +
        addressCanMakeCallNoAllowedCalls.address.substring(2),
      ERC725YKeys.LSP6["AddressPermissions:Permissions"] +
        addressCanMakeCallWithAllowedCalls.address.substring(2),
      ERC725YKeys.LSP6["AddressPermissions:Permissions"] +
        addressCannotMakeCall.address.substring(2),
      ERC725YKeys.LSP6["AddressPermissions:AllowedCalls"] +
        addressCanMakeCallWithAllowedCalls.address.substring(2),
    ];

    const permissionsValues = [
      ALL_PERMISSIONS,
      PERMISSIONS.CALL,
      PERMISSIONS.CALL,
      PERMISSIONS.SETDATA,
      combineAllowedCalls(
        ["0xffffffff"],
        [targetContract.address],
        ["0xffffffff"]
      ),
    ];

    await setupKeyManager(context, permissionKeys, permissionsValues);
  });

  describe("when interacting via `execute(...)`", () => {
    describe("when caller has ALL PERMISSIONS", () => {
      it("should pass and change state at the target contract", async () => {
        let argument = "new name";

        let targetPayload = targetContract.interface.encodeFunctionData(
          "setName",
          [argument]
        );

        let payload = context.universalProfile.interface.encodeFunctionData(
          "execute(uint256,address,uint256,bytes)",
          [OPERATION_TYPES.CALL, targetContract.address, 0, targetPayload]
        );

        await context.keyManager.connect(context.owner).execute(payload);

        const result = await targetContract.callStatic.getName();
        expect(result).to.equal(argument);
      });
    });

    describe("when caller has permission CALL", () => {
      describe("when caller has no allowed calls set", () => {
        it("should revert with `NotAllowedCall(...)` error", async () => {
          let argument = "another name";

          let targetPayload = targetContract.interface.encodeFunctionData(
            "setName",
            [argument]
          );

          let payload = context.universalProfile.interface.encodeFunctionData(
            "execute(uint256,address,uint256,bytes)",
            [OPERATION_TYPES.CALL, targetContract.address, 0, targetPayload]
          );

          await expect(
            context.keyManager
              .connect(addressCanMakeCallNoAllowedCalls)
              .execute(payload)
          )
            .to.be.revertedWithCustomError(context.keyManager, "NoCallsAllowed")
            .withArgs(addressCanMakeCallNoAllowedCalls.address);
        });
      });

      describe("when caller has some allowed calls set", () => {
        it("should pass and change state at the target contract", async () => {
          let argument = "another name";

          let targetPayload = targetContract.interface.encodeFunctionData(
            "setName",
            [argument]
          );

          let payload = context.universalProfile.interface.encodeFunctionData(
            "execute(uint256,address,uint256,bytes)",
            [OPERATION_TYPES.CALL, targetContract.address, 0, targetPayload]
          );

          await context.keyManager
            .connect(addressCanMakeCallWithAllowedCalls)
            .execute(payload);

          const result = await targetContract.callStatic.getName();
          expect(result).to.equal(argument);
        });
      });
    });

    describe("when caller does not have permission CALL", () => {
      it("should revert", async () => {
        let argument = "another name";

        let targetPayload = targetContract.interface.encodeFunctionData(
          "setName",
          [argument]
        );

        let payload = context.universalProfile.interface.encodeFunctionData(
          "execute(uint256,address,uint256,bytes)",
          [OPERATION_TYPES.CALL, targetContract.address, 0, targetPayload]
        );

        await expect(
          context.keyManager.connect(addressCannotMakeCall).execute(payload)
        )
          .to.be.revertedWithCustomError(context.keyManager, "NotAuthorised")
          .withArgs(addressCannotMakeCall.address, "CALL");
      });
    });

    describe("when calling a function that returns some value", () => {
      it("should return the value to the Key Manager <- UP <- targetContract.getName()", async () => {
        let expectedName = await targetContract.callStatic.getName();

        let targetContractPayload =
          targetContract.interface.encodeFunctionData("getName");

        let executePayload =
          context.universalProfile.interface.encodeFunctionData(
            "execute(uint256,address,uint256,bytes)",
            [
              OPERATION_TYPES.CALL,
              targetContract.address,
              0,
              targetContractPayload,
            ]
          );

        let result = await context.keyManager
          .connect(context.owner)
          .callStatic.execute(executePayload);

        let [decodedResult] = abiCoder.decode(["string"], result);
        expect(decodedResult).to.equal(expectedName);
      });

      it("Should return the value to the Key Manager <- UP <- targetContract.getNumber()", async () => {
        let expectedNumber = await targetContract.callStatic.getNumber();

        let targetContractPayload =
          targetContract.interface.encodeFunctionData("getNumber");

        let executePayload =
          context.universalProfile.interface.encodeFunctionData(
            "execute(uint256,address,uint256,bytes)",
            [
              OPERATION_TYPES.CALL,
              targetContract.address,
              0,
              targetContractPayload,
            ]
          );

        let result = await context.keyManager
          .connect(context.owner)
          .callStatic.execute(executePayload);

        let [decodedResult] = abiCoder.decode(["uint256"], result);
        expect(decodedResult).to.equal(expectedNumber);
      });
    });

    describe("when calling a function that reverts", () => {
      it("should revert", async () => {
        let targetContractPayload =
          targetContract.interface.encodeFunctionData("revertCall");

        let payload = context.universalProfile.interface.encodeFunctionData(
          "execute(uint256,address,uint256,bytes)",
          [
            OPERATION_TYPES.CALL,
            targetContract.address,
            0,
            targetContractPayload,
          ]
        );

        await expect(context.keyManager.execute(payload)).to.be.revertedWith(
          "TargetContract:revertCall: this function has reverted!"
        );
      });
    });
  });

  describe("when interacting via `executeRelayCall(...)`", () => {
    // Use channelId = 0 for sequential nonce
    const channelId = 0;

    describe("when signer has ALL PERMISSIONS", () => {
      describe("when signing tx with EIP191Signer `\\x19\\x00` prefix", () => {
        it("should execute successfully", async () => {
          let newName = "New Name";

          let targetContractPayload =
            targetContract.interface.encodeFunctionData("setName", [newName]);
          let nonce = await context.keyManager.callStatic.getNonce(
            context.owner.address,
            channelId
          );

          let executeRelayCallPayload =
            context.universalProfile.interface.encodeFunctionData(
              "execute(uint256,address,uint256,bytes)",
              [
                OPERATION_TYPES.CALL,
                targetContract.address,
                0,
                targetContractPayload,
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

          const { signature } =
            await eip191Signer.signDataWithIntendedValidator(
              context.keyManager.address,
              encodedMessage,
              LOCAL_PRIVATE_KEYS.ACCOUNT0
            );

          await context.keyManager.executeRelayCall(
            signature,
            nonce,
            executeRelayCallPayload,
            { value: valueToSend }
          );

          const result = await targetContract.callStatic.getName();
          expect(result).to.equal(newName);
        });
      });

      describe("when signing with Ethereum Signed Message prefix", () => {
        it("should retrieve the incorrect signer address and revert with `NoPermissionsSet` error", async () => {
          let newName = "New Name";

          let targetContractPayload =
            targetContract.interface.encodeFunctionData("setName", [newName]);
          let nonce = await context.keyManager.callStatic.getNonce(
            context.owner.address,
            channelId
          );

          let executeRelayCallPayload =
            context.universalProfile.interface.encodeFunctionData(
              "execute(uint256,address,uint256,bytes)",
              [
                OPERATION_TYPES.CALL,
                targetContract.address,
                0,
                targetContractPayload,
              ]
            );

          const HARDHAT_CHAINID = 31337;
          let valueToSend = 0;

          const eip191Signer = new EIP191Signer();

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

          const signature = await context.owner.signMessage(encodedMessage);

          const incorrectSignerAddress = eip191Signer.recover(
            eip191Signer.hashDataWithIntendedValidator(
              context.keyManager.address,
              encodedMessage
            ),
            signature
          );

          await expect(
            context.keyManager.executeRelayCall(
              signature,
              nonce,
              executeRelayCallPayload,
              { value: valueToSend }
            )
          )
            .to.be.revertedWithCustomError(
              context.keyManager,
              "NoPermissionsSet"
            )
            .withArgs(incorrectSignerAddress);
        });
      });
    });

    describe("when signer has permission CALL", () => {
      describe("when signing tx with EIP191Signer `\\x19\\x00` prefix", () => {
        describe("when caller has some allowed calls set", () => {
          it("should execute successfully", async () => {
            let newName = "Another name";

            let targetContractPayload =
              targetContract.interface.encodeFunctionData("setName", [newName]);

            let nonce = await context.keyManager.callStatic.getNonce(
              addressCanMakeCallWithAllowedCalls.address,
              channelId
            );

            let executeRelayCallPayload =
              context.universalProfile.interface.encodeFunctionData(
                "execute(uint256,address,uint256,bytes)",
                [
                  OPERATION_TYPES.CALL,
                  targetContract.address,
                  0,
                  targetContractPayload,
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

            const { signature } =
              await eip191Signer.signDataWithIntendedValidator(
                context.keyManager.address,
                encodedMessage,
                LOCAL_PRIVATE_KEYS.ACCOUNT2
              );

            await context.keyManager.executeRelayCall(
              signature,
              nonce,
              executeRelayCallPayload,
              { value: valueToSend }
            );

            const result = await targetContract.callStatic.getName();
            expect(result).to.equal(newName);
          });
        });

        describe("when caller has no allowed calls set", () => {
          it("should revert with `NotAllowedCall(...)` error", async () => {
            let newName = "Another name";

            let targetContractPayload =
              targetContract.interface.encodeFunctionData("setName", [newName]);
            let nonce = await context.keyManager.callStatic.getNonce(
              addressCanMakeCallNoAllowedCalls.address,
              channelId
            );

            let executeRelayCallPayload =
              context.universalProfile.interface.encodeFunctionData(
                "execute(uint256,address,uint256,bytes)",
                [
                  OPERATION_TYPES.CALL,
                  targetContract.address,
                  0,
                  targetContractPayload,
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

            const { signature } =
              await eip191Signer.signDataWithIntendedValidator(
                context.keyManager.address,
                encodedMessage,
                LOCAL_PRIVATE_KEYS.ACCOUNT1
              );

            await expect(
              context.keyManager.executeRelayCall(
                signature,
                nonce,
                executeRelayCallPayload,
                { value: valueToSend }
              )
            )
              .to.be.revertedWithCustomError(
                context.keyManager,
                "NoCallsAllowed"
              )
              .withArgs(addressCanMakeCallNoAllowedCalls.address);
          });
        });
      });

      describe("when signing tx with Ethereum Signed Message prefix", () => {
        it("should retrieve the incorrect signer address and revert with `NoPermissionsSet` error", async () => {
          let newName = "Another name";

          let targetContractPayload =
            targetContract.interface.encodeFunctionData("setName", [newName]);
          let nonce = await context.keyManager.callStatic.getNonce(
            addressCanMakeCallWithAllowedCalls.address,
            channelId
          );

          let executeRelayCallPayload =
            context.universalProfile.interface.encodeFunctionData(
              "execute(uint256,address,uint256,bytes)",
              [
                OPERATION_TYPES.CALL,
                targetContract.address,
                0,
                targetContractPayload,
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

          let signature = await addressCanMakeCallWithAllowedCalls.signMessage(
            encodedMessage
          );

          const eip191Signer = new EIP191Signer();
          const incorrectSignerAddress = eip191Signer.recover(
            eip191Signer.hashDataWithIntendedValidator(
              context.keyManager.address,
              encodedMessage
            ),
            signature
          );

          await expect(
            context.keyManager.executeRelayCall(
              signature,
              nonce,
              executeRelayCallPayload,
              { value: valueToSend }
            )
          )
            .to.be.revertedWithCustomError(
              context.keyManager,
              "NoPermissionsSet"
            )
            .withArgs(incorrectSignerAddress);
        });
      });
    });

    describe("when signer does not have permission CALL", () => {
      describe("when signing tx with EIP191Signer `\\x19\\x00` prefix", () => {
        it("should revert with `NotAuthorised` and permission CALL error", async () => {
          const initialName = await targetContract.callStatic.getName();

          let targetContractPayload =
            targetContract.interface.encodeFunctionData("setName", [
              "Random name",
            ]);
          let nonce = await context.keyManager.callStatic.getNonce(
            addressCannotMakeCall.address,
            channelId
          );

          let executeRelayCallPayload =
            context.universalProfile.interface.encodeFunctionData(
              "execute(uint256,address,uint256,bytes)",
              [
                OPERATION_TYPES.CALL,
                targetContract.address,
                0,
                targetContractPayload,
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

          const { signature } =
            await eip191Signer.signDataWithIntendedValidator(
              context.keyManager.address,
              encodedMessage,
              LOCAL_PRIVATE_KEYS.ACCOUNT3
            );

          await expect(
            context.keyManager.executeRelayCall(
              signature,
              nonce,
              executeRelayCallPayload,
              { value: valueToSend }
            )
          )
            .to.be.revertedWithCustomError(context.keyManager, "NotAuthorised")
            .withArgs(addressCannotMakeCall.address, "CALL");

          // ensure no state change at the target contract
          const result = await targetContract.callStatic.getName();
          expect(result).to.equal(initialName);
        });
      });

      describe("when signing tx with Ethereum Signed Message prefix", () => {
        it("should retrieve the incorrect signer address and revert with `NoPermissionSet`", async () => {
          const initialName = await targetContract.callStatic.getName();

          let targetContractPayload =
            targetContract.interface.encodeFunctionData("setName", [
              "Random name",
            ]);
          let nonce = await context.keyManager.callStatic.getNonce(
            addressCannotMakeCall.address,
            channelId
          );

          let executeRelayCallPayload =
            context.universalProfile.interface.encodeFunctionData(
              "execute(uint256,address,uint256,bytes)",
              [
                OPERATION_TYPES.CALL,
                targetContract.address,
                0,
                targetContractPayload,
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

          const ethereumSignature = await addressCannotMakeCall.signMessage(
            encodedMessage
          );

          const eip191Signer = new EIP191Signer();

          const incorrectSignerAddress = await eip191Signer.recover(
            eip191Signer.hashDataWithIntendedValidator(
              context.keyManager.address,
              encodedMessage
            ),
            ethereumSignature
          );

          await expect(
            context.keyManager.executeRelayCall(
              ethereumSignature,
              nonce,
              executeRelayCallPayload,
              { value: valueToSend }
            )
          )
            .to.be.revertedWithCustomError(
              context.keyManager,
              "NoPermissionsSet"
            )
            .withArgs(incorrectSignerAddress);

          // ensure state at target contract has not changed
          expect(await targetContract.callStatic.getName()).to.equal(
            initialName
          );
        });
      });
    });
  });
};
