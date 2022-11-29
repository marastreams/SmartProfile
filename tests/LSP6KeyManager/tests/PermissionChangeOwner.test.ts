import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

// constants
import { ERC725YKeys, PERMISSIONS, OPERATION_TYPES } from "../../../constants";

import { LSP6KeyManager, LSP6KeyManager__factory } from "../../../types";

// setup
import { LSP6TestContext } from "../../utils/context";
import { setupKeyManager } from "../../utils/fixtures";

// helpers
import { provider } from "../../utils/helpers";

export const shouldBehaveLikePermissionChangeOwner = (
  buildContext: () => Promise<LSP6TestContext>
) => {
  let context: LSP6TestContext;

  let canChangeOwner: SignerWithAddress, cannotChangeOwner: SignerWithAddress;

  let permissionsKeys: string[];
  let permissionsValues: string[];

  beforeEach(async () => {
    context = await buildContext();

    canChangeOwner = context.accounts[1];
    cannotChangeOwner = context.accounts[2];

    permissionsKeys = [
      ERC725YKeys.LSP6["AddressPermissions:Permissions"] +
        canChangeOwner.address.substring(2),
      ERC725YKeys.LSP6["AddressPermissions:Permissions"] +
        cannotChangeOwner.address.substring(2),
    ];

    permissionsValues = [PERMISSIONS.CHANGEOWNER, PERMISSIONS.SETDATA];

    await setupKeyManager(context, permissionsKeys, permissionsValues);

    // fund the UP
    await context.owner.sendTransaction({
      to: context.universalProfile.address,
      value: ethers.utils.parseEther("10"),
    });
  });

  describe("when transferring Ownership to the target address", () => {
    it("should revert", async () => {
      const transferOwnershipPayload =
        context.universalProfile.interface.encodeFunctionData(
          "transferOwnership",
          [context.universalProfile.address]
        );

      await expect(
        context.keyManager
          .connect(canChangeOwner)
          .execute(transferOwnershipPayload)
      ).to.be.revertedWithCustomError(
        context.universalProfile,
        "CannotTransferOwnershipToSelf"
      );
    });
  });

  describe("when upgrading to a new KeyManager via transferOwnership(...)", () => {
    let newKeyManager: LSP6KeyManager;

    describe("when caller does not have have CHANGEOWNER permission", () => {
      beforeEach(async () => {
        newKeyManager = await new LSP6KeyManager__factory(context.owner).deploy(
          context.universalProfile.address
        );

        let transferOwnershipPayload =
          context.universalProfile.interface.encodeFunctionData(
            "transferOwnership",
            [newKeyManager.address]
          );

        await context.keyManager
          .connect(canChangeOwner)
          .execute(transferOwnershipPayload);
      });
      it("should revert", async () => {
        let transferOwnershipPayload =
          context.universalProfile.interface.encodeFunctionData(
            "transferOwnership",
            [newKeyManager.address]
          );

        await expect(
          context.keyManager
            .connect(cannotChangeOwner)
            .execute(transferOwnershipPayload)
        )
          .to.be.revertedWithCustomError(context.keyManager, "NotAuthorised")
          .withArgs(cannotChangeOwner.address, "TRANSFEROWNERSHIP");
      });
    });

    describe("when caller has ALL PERMISSIONS", () => {
      beforeEach(async () => {
        newKeyManager = await new LSP6KeyManager__factory(context.owner).deploy(
          context.universalProfile.address
        );

        let transferOwnershipPayload =
          context.universalProfile.interface.encodeFunctionData(
            "transferOwnership",
            [newKeyManager.address]
          );

        await context.keyManager
          .connect(context.owner)
          .execute(transferOwnershipPayload);
      });
      it("should have set newKeyManager as pendingOwner", async () => {
        let pendingOwner = await context.universalProfile.pendingOwner();
        expect(pendingOwner).to.equal(newKeyManager.address);
      });

      it("owner should remain the current KeyManager", async () => {
        const ownerBefore = await context.universalProfile.owner();

        let transferOwnershipPayload =
          context.universalProfile.interface.encodeFunctionData(
            "transferOwnership",
            [newKeyManager.address]
          );

        await context.keyManager
          .connect(context.owner)
          .execute(transferOwnershipPayload);

        const ownerAfter = await context.universalProfile.owner();

        expect(ownerBefore).to.equal(context.keyManager.address);
        expect(ownerAfter).to.equal(context.keyManager.address);
      });

      it("should override the pendingOwner when transferOwnership(...) is called twice", async () => {
        let overridenPendingOwner = await new LSP6KeyManager__factory(
          context.owner
        ).deploy(context.universalProfile.address);

        await context.keyManager
          .connect(context.owner)
          .execute(
            context.universalProfile.interface.encodeFunctionData(
              "transferOwnership",
              [overridenPendingOwner.address]
            )
          );

        const pendingOwner = await context.universalProfile.pendingOwner();
        expect(pendingOwner).to.equal(overridenPendingOwner.address);
      });

      describe("it should still be possible to call onlyOwner functions via the old KeyManager", () => {
        it("setData(...)", async () => {
          const key =
            "0xcafecafecafecafecafecafecafecafecafecafecafecafecafecafecafecafe";
          const value = "0xabcd";

          let payload = context.universalProfile.interface.encodeFunctionData(
            "setData(bytes32,bytes)",
            [key, value]
          );

          await context.keyManager.connect(context.owner).execute(payload);

          const result = await context.universalProfile["getData(bytes32)"](
            key
          );
          expect(result).to.equal(value);
        });

        it("execute(...) - LYX transfer", async () => {
          const recipient = context.accounts[8];
          const amount = ethers.utils.parseEther("3");

          const recipientBalanceBefore = await provider.getBalance(
            recipient.address
          );
          const accountBalanceBefore = await provider.getBalance(
            context.universalProfile.address
          );

          let payload = context.universalProfile.interface.encodeFunctionData(
            "execute(uint256,address,uint256,bytes)",
            [OPERATION_TYPES.CALL, recipient.address, amount, "0x"]
          );

          await context.keyManager.connect(context.owner).execute(payload);

          const recipientBalanceAfter = await provider.getBalance(
            recipient.address
          );
          const accountBalanceAfter = await provider.getBalance(
            context.universalProfile.address
          );

          // recipient balance should have gone up
          expect(recipientBalanceAfter).to.be.gt(recipientBalanceBefore);

          // account balance should have gone down
          expect(accountBalanceAfter).to.be.lt(accountBalanceBefore);
        });
      });
    });

    describe("when caller has only CHANGE0OWNER permission", () => {
      beforeEach(async () => {
        newKeyManager = await new LSP6KeyManager__factory(context.owner).deploy(
          context.universalProfile.address
        );

        let transferOwnershipPayload =
          context.universalProfile.interface.encodeFunctionData(
            "transferOwnership",
            [newKeyManager.address]
          );

        await context.keyManager
          .connect(canChangeOwner)
          .execute(transferOwnershipPayload);
      });

      it("should have set newKeyManager as pendingOwner", async () => {
        let pendingOwner = await context.universalProfile.pendingOwner();
        expect(pendingOwner).to.equal(newKeyManager.address);
      });

      it("owner should remain the current KeyManager", async () => {
        const ownerBefore = await context.universalProfile.owner();

        let transferOwnershipPayload =
          context.universalProfile.interface.encodeFunctionData(
            "transferOwnership",
            [newKeyManager.address]
          );

        await context.keyManager
          .connect(canChangeOwner)
          .execute(transferOwnershipPayload);

        const ownerAfter = await context.universalProfile.owner();

        expect(ownerBefore).to.equal(context.keyManager.address);
        expect(ownerAfter).to.equal(context.keyManager.address);
      });

      it("should override the pendingOwner when transferOwnership(...) is called twice", async () => {
        let overridenPendingOwner = await new LSP6KeyManager__factory(
          context.owner
        ).deploy(context.universalProfile.address);

        await context.keyManager
          .connect(canChangeOwner)
          .execute(
            context.universalProfile.interface.encodeFunctionData(
              "transferOwnership",
              [overridenPendingOwner.address]
            )
          );

        const pendingOwner = await context.universalProfile.pendingOwner();
        expect(pendingOwner).to.equal(overridenPendingOwner.address);
      });
    });
  });

  describe("when calling acceptOwnership(...) from a KeyManager that is not the pendingOwner", () => {
    let newKeyManager: LSP6KeyManager;

    beforeEach(async () => {
      newKeyManager = await new LSP6KeyManager__factory(context.owner).deploy(
        context.universalProfile.address
      );

      let transferOwnershipPayload =
        context.universalProfile.interface.encodeFunctionData(
          "transferOwnership",
          [newKeyManager.address]
        );

      await context.keyManager
        .connect(context.owner)
        .execute(transferOwnershipPayload);
    });

    it("should revert", async () => {
      let notPendingKeyManager = await new LSP6KeyManager__factory(
        context.accounts[5]
      ).deploy(context.universalProfile.address);

      let payload =
        context.universalProfile.interface.getSighash("acceptOwnership");

      await expect(
        notPendingKeyManager.connect(context.owner).execute(payload)
      ).to.be.revertedWith("LSP14: caller is not the pendingOwner");
    });
  });

  describe("when calling acceptOwnership(...) via the pending new KeyManager", () => {
    let newKeyManager: LSP6KeyManager;

    beforeEach(async () => {
      newKeyManager = await new LSP6KeyManager__factory(context.owner).deploy(
        context.universalProfile.address
      );

      let transferOwnershipPayload =
        context.universalProfile.interface.encodeFunctionData(
          "transferOwnership",
          [newKeyManager.address]
        );

      await context.keyManager
        .connect(context.owner)
        .execute(transferOwnershipPayload);
    });

    it("should have change the account's owner to the pendingOwner (= pending KeyManager)", async () => {
      let payload =
        context.universalProfile.interface.getSighash("acceptOwnership");

      let pendingOwner = await context.universalProfile.pendingOwner();

      await newKeyManager.connect(context.owner).execute(payload);

      let updatedOwner = await context.universalProfile.owner();
      expect(updatedOwner).to.equal(pendingOwner);
    });

    it("should have cleared the pendingOwner after transfering ownership", async () => {
      let payload =
        context.universalProfile.interface.getSighash("acceptOwnership");

      await newKeyManager.connect(context.owner).execute(payload);

      let newPendingOwner = await context.universalProfile.pendingOwner();
      expect(newPendingOwner).to.equal(ethers.constants.AddressZero);
    });
  });

  describe("after KeyManager has been upgraded via acceptOwnership(...)", () => {
    let oldKeyManager: LSP6KeyManager, newKeyManager: LSP6KeyManager;

    beforeEach(async () => {
      oldKeyManager = context.keyManager;

      newKeyManager = await new LSP6KeyManager__factory(context.owner).deploy(
        context.universalProfile.address
      );

      let transferOwnershipPayload =
        context.universalProfile.interface.encodeFunctionData(
          "transferOwnership",
          [newKeyManager.address]
        );

      await context.keyManager
        .connect(context.owner)
        .execute(transferOwnershipPayload);

      let claimOwnershipPayload =
        context.universalProfile.interface.getSighash("acceptOwnership");

      await newKeyManager.connect(context.owner).execute(claimOwnershipPayload);
    });

    describe("old KeyManager should not be allowed to call onlyOwner functions anymore", () => {
      it("should revert when calling `setData(...)`", async () => {
        const key =
          "0xcafecafecafecafecafecafecafecafecafecafecafecafecafecafecafecafe";
        const value = "0xabcd";

        let payload = context.universalProfile.interface.encodeFunctionData(
          "setData(bytes32,bytes)",
          [key, value]
        );

        await expect(
          oldKeyManager.connect(context.owner).execute(payload)
        ).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("should revert when calling `execute(...)`", async () => {
        let recipient = context.accounts[3];
        let amount = ethers.utils.parseEther("3");

        let payload = context.universalProfile.interface.encodeFunctionData(
          "execute(uint256,address,uint256,bytes)",
          [OPERATION_TYPES.CALL, recipient.address, amount, "0x"]
        );

        await expect(
          oldKeyManager.connect(context.owner).execute(payload)
        ).to.be.revertedWith("Ownable: caller is not the owner");
      });
    });

    describe("new Key Manager should be allowed to call onlyOwner functions", () => {
      it("setData(...)", async () => {
        const key =
          "0xcafecafecafecafecafecafecafecafecafecafecafecafecafecafecafecafe";
        const value = "0xabcd";

        let payload = context.universalProfile.interface.encodeFunctionData(
          "setData(bytes32,bytes)",
          [key, value]
        );

        await newKeyManager.connect(context.owner).execute(payload);

        const result = await context.universalProfile["getData(bytes32)"](key);
        expect(result).to.equal(value);
      });

      it("execute(...) - LYX transfer", async () => {
        const recipient = context.accounts[3];
        const amount = ethers.utils.parseEther("3");

        const recipientBalanceBefore = await provider.getBalance(
          recipient.address
        );
        const accountBalanceBefore = await provider.getBalance(
          context.universalProfile.address
        );

        let payload = context.universalProfile.interface.encodeFunctionData(
          "execute(uint256,address,uint256,bytes)",
          [OPERATION_TYPES.CALL, recipient.address, amount, "0x"]
        );

        await newKeyManager.connect(context.owner).execute(payload);

        const recipientBalanceAfter = await provider.getBalance(
          recipient.address
        );
        const accountBalanceAfter = await provider.getBalance(
          context.universalProfile.address
        );

        // recipient balance should have gone up
        expect(recipientBalanceAfter).to.be.gt(recipientBalanceBefore);

        // account balance should have gone down
        expect(accountBalanceAfter).to.be.lt(accountBalanceBefore);
      });
    });
  });
};
