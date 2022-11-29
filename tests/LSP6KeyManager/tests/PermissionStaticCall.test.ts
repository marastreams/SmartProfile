import { expect } from "chai";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { TargetContract, TargetContract__factory } from "../../../types";

// constants
import {
  ERC725YKeys,
  ALL_PERMISSIONS,
  PERMISSIONS,
  OPERATION_TYPES,
} from "../../../constants";

// setup
import { LSP6TestContext } from "../../utils/context";
import { setupKeyManager } from "../../utils/fixtures";

// helpers
import { abiCoder, combineAllowedCalls } from "../../utils/helpers";

export const shouldBehaveLikePermissionStaticCall = (
  buildContext: () => Promise<LSP6TestContext>
) => {
  let context: LSP6TestContext;

  let addressCanMakeStaticCall: SignerWithAddress,
    addressCannotMakeStaticCall: SignerWithAddress,
    addressCanMakeStaticCallNoAllowedCalls: SignerWithAddress;

  let targetContract: TargetContract;

  beforeEach(async () => {
    context = await buildContext();

    addressCanMakeStaticCall = context.accounts[1];
    addressCannotMakeStaticCall = context.accounts[2];
    addressCanMakeStaticCallNoAllowedCalls = context.accounts[3];

    targetContract = await new TargetContract__factory(
      context.accounts[0]
    ).deploy();

    const permissionKeys = [
      ERC725YKeys.LSP6["AddressPermissions:Permissions"] +
        context.owner.address.substring(2),
      ERC725YKeys.LSP6["AddressPermissions:Permissions"] +
        addressCanMakeStaticCall.address.substring(2),
      ERC725YKeys.LSP6["AddressPermissions:AllowedCalls"] +
        addressCanMakeStaticCall.address.substring(2),
      ERC725YKeys.LSP6["AddressPermissions:Permissions"] +
        addressCannotMakeStaticCall.address.substring(2),
      ERC725YKeys.LSP6["AddressPermissions:Permissions"] +
        addressCanMakeStaticCallNoAllowedCalls.address.substring(2),
    ];

    const permissionsValues = [
      ALL_PERMISSIONS,
      PERMISSIONS.STATICCALL,
      combineAllowedCalls(
        ["0xffffffff"],
        [targetContract.address],
        ["0xffffffff"]
      ),
      PERMISSIONS.SETDATA,
      PERMISSIONS.STATICCALL,
    ];

    await setupKeyManager(context, permissionKeys, permissionsValues);
  });

  describe("when caller has ALL PERMISSIONS", () => {
    it("should pass and return data", async () => {
      let expectedName = await targetContract.callStatic.getName();

      let targetContractPayload =
        targetContract.interface.encodeFunctionData("getName");

      let executePayload =
        context.universalProfile.interface.encodeFunctionData(
          "execute(uint256,address,uint256,bytes)",
          [
            OPERATION_TYPES.STATICCALL,
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
  });

  describe("when caller has permission STATICCALL + some allowed calls", () => {
    it("should pass and return data", async () => {
      let expectedName = await targetContract.callStatic.getName();

      let targetContractPayload =
        targetContract.interface.encodeFunctionData("getName");

      let executePayload =
        context.universalProfile.interface.encodeFunctionData(
          "execute(uint256,address,uint256,bytes)",
          [
            OPERATION_TYPES.STATICCALL,
            targetContract.address,
            0,
            targetContractPayload,
          ]
        );

      let result = await context.keyManager
        .connect(addressCanMakeStaticCall)
        .callStatic.execute(executePayload);

      let [decodedResult] = abiCoder.decode(["string"], result);
      expect(decodedResult).to.equal(expectedName);
    });

    it("should revert when trying to change state at the target contract", async () => {
      let initialValue = await targetContract.callStatic.getName();

      let targetContractPayload = targetContract.interface.encodeFunctionData(
        "setName",
        ["modified name"]
      );

      let executePayload =
        context.universalProfile.interface.encodeFunctionData(
          "execute(uint256,address,uint256,bytes)",
          [
            OPERATION_TYPES.STATICCALL,
            targetContract.address,
            0,
            targetContractPayload,
          ]
        );

      await expect(
        context.keyManager
          .connect(addressCanMakeStaticCall)
          .execute(executePayload)
      ).to.be.reverted;

      // ensure state hasn't changed.
      let newValue = await targetContract.callStatic.getName();
      expect(initialValue).to.equal(newValue);
    });

    it("should revert when caller try to make a CALL", async () => {
      let targetContractPayload = targetContract.interface.encodeFunctionData(
        "setName",
        ["modified name"]
      );

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

      await expect(
        context.keyManager
          .connect(addressCanMakeStaticCall)
          .execute(executePayload)
      )
        .to.be.revertedWithCustomError(context.keyManager, "NotAuthorised")
        .withArgs(addressCanMakeStaticCall.address, "CALL");
    });
  });

  describe("when caller has permission STATICCALL + no allowed calls", () => {
    it("should revert with `NotAllowedCall` error", async () => {
      let targetContractPayload =
        targetContract.interface.encodeFunctionData("getName");

      let executePayload =
        context.universalProfile.interface.encodeFunctionData(
          "execute(uint256,address,uint256,bytes)",
          [
            OPERATION_TYPES.STATICCALL,
            targetContract.address,
            0,
            targetContractPayload,
          ]
        );

      await expect(
        context.keyManager
          .connect(addressCanMakeStaticCallNoAllowedCalls)
          .callStatic.execute(executePayload)
      )
        .to.be.revertedWithCustomError(context.keyManager, "NoCallsAllowed")
        .withArgs(addressCanMakeStaticCallNoAllowedCalls.address);
    });
  });

  describe("when caller does not have permission STATICCALL", () => {
    it("should revert", async () => {
      let targetContractPayload =
        targetContract.interface.encodeFunctionData("getName");

      let executePayload =
        context.universalProfile.interface.encodeFunctionData(
          "execute(uint256,address,uint256,bytes)",
          [
            OPERATION_TYPES.STATICCALL,
            targetContract.address,
            0,
            targetContractPayload,
          ]
        );

      await expect(
        context.keyManager
          .connect(addressCannotMakeStaticCall)
          .execute(executePayload)
      )
        .to.be.revertedWithCustomError(context.keyManager, "NotAuthorised")
        .withArgs(addressCannotMakeStaticCall.address, "STATICCALL");
    });
  });

  describe("when caller has permission STATICCALL + 2 x allowed addresses", () => {
    let caller: SignerWithAddress;
    let allowedTargetContracts: [TargetContract, TargetContract];

    beforeEach(async () => {
      context = await buildContext();

      caller = context.accounts[1];

      allowedTargetContracts = [
        await new TargetContract__factory(context.accounts[0]).deploy(),
        await new TargetContract__factory(context.accounts[0]).deploy(),
      ];

      const permissionKeys = [
        ERC725YKeys.LSP6["AddressPermissions:Permissions"] +
          caller.address.substring(2),
        ERC725YKeys.LSP6["AddressPermissions:AllowedCalls"] +
          caller.address.substring(2),
      ];

      const permissionValues = [
        PERMISSIONS.STATICCALL,
        combineAllowedCalls(
          ["0xffffffff", "0xffffffff"],
          [
            allowedTargetContracts[0].address,
            allowedTargetContracts[1].address,
          ],
          ["0xffffffff", "0xffffffff"]
        ),
      ];

      await setupKeyManager(context, permissionKeys, permissionValues);
    });

    it("should revert when trying to interact with a non-allowed address", async () => {
      let targetContract = await new TargetContract__factory(
        context.accounts[0]
      ).deploy();

      const payload = context.universalProfile.interface.encodeFunctionData(
        "execute(uint256,address,uint256,bytes)",
        [
          OPERATION_TYPES.STATICCALL,
          targetContract.address,
          0,
          targetContract.interface.getSighash("getName"),
        ]
      );

      await expect(context.keyManager.connect(caller).execute(payload))
        .to.be.revertedWithCustomError(context.keyManager, "NotAllowedCall")
        .withArgs(
          caller.address,
          targetContract.address,
          targetContract.interface.getSighash("getName")
        );
    });

    describe("when interacting with 1st allowed contract", () => {
      it("should allow to call view function -> getName()", async () => {
        let targetContract = allowedTargetContracts[0];

        const name = await targetContract.getName();

        const payload = context.universalProfile.interface.encodeFunctionData(
          "execute(uint256,address,uint256,bytes)",
          [
            OPERATION_TYPES.STATICCALL,
            targetContract.address,
            0,
            targetContract.interface.getSighash("getName"),
          ]
        );

        const result = await context.keyManager
          .connect(caller)
          .callStatic.execute(payload);

        const [decodedResult] = abiCoder.decode(["string"], result);
        expect(decodedResult).to.equal(name);
      });

      it("should allow to call view function -> getNumber()", async () => {
        let targetContract = allowedTargetContracts[0];

        const number = await targetContract.getNumber();

        const payload = context.universalProfile.interface.encodeFunctionData(
          "execute(uint256,address,uint256,bytes)",
          [
            OPERATION_TYPES.STATICCALL,
            targetContract.address,
            0,
            targetContract.interface.getSighash("getNumber"),
          ]
        );

        const result = await context.keyManager
          .connect(caller)
          .callStatic.execute(payload);

        const [decodedResult] = abiCoder.decode(["uint256"], result);
        expect(decodedResult).to.equal(number);
      });

      it("should revert when calling state changing function -> setName(string)", async () => {
        let targetContract = allowedTargetContracts[0];

        const targetPayload = targetContract.interface.encodeFunctionData(
          "setName",
          ["new name"]
        );

        const payload = context.universalProfile.interface.encodeFunctionData(
          "execute(uint256,address,uint256,bytes)",
          [OPERATION_TYPES.STATICCALL, targetContract.address, 0, targetPayload]
        );

        await expect(
          context.keyManager.connect(caller).callStatic.execute(payload)
        ).to.be.reverted;
      });

      it("should revert when calling state changing function -> setNumber(uint256)", async () => {
        let targetContract = allowedTargetContracts[0];

        const targetPayload = targetContract.interface.encodeFunctionData(
          "setNumber",
          [12345]
        );

        const payload = context.universalProfile.interface.encodeFunctionData(
          "execute(uint256,address,uint256,bytes)",
          [OPERATION_TYPES.STATICCALL, targetContract.address, 0, targetPayload]
        );

        await expect(
          context.keyManager.connect(caller).callStatic.execute(payload)
        ).to.be.reverted;
      });
    });

    describe("when interacting with 2nd allowed contract", () => {
      it("should allow to interact with 2nd allowed contract - getName()", async () => {
        let targetContract = allowedTargetContracts[1];

        const name = await targetContract.getName();

        const payload = context.universalProfile.interface.encodeFunctionData(
          "execute(uint256,address,uint256,bytes)",
          [
            OPERATION_TYPES.STATICCALL,
            targetContract.address,
            0,
            targetContract.interface.getSighash("getName"),
          ]
        );

        const result = await context.keyManager
          .connect(caller)
          .callStatic.execute(payload);

        const [decodedResult] = abiCoder.decode(["string"], result);
        expect(decodedResult).to.equal(name);
      });

      it("should allow to interact with 2nd allowed contract - getNumber()", async () => {
        let targetContract = allowedTargetContracts[1];

        const number = await targetContract.getNumber();

        const payload = context.universalProfile.interface.encodeFunctionData(
          "execute(uint256,address,uint256,bytes)",
          [
            OPERATION_TYPES.STATICCALL,
            targetContract.address,
            0,
            targetContract.interface.getSighash("getNumber"),
          ]
        );

        const result = await context.keyManager
          .connect(caller)
          .callStatic.execute(payload);

        const [decodedResult] = abiCoder.decode(["uint256"], result);
        expect(decodedResult).to.equal(number);
      });

      it("should revert when calling state changing function -> setName(string)", async () => {
        let targetContract = allowedTargetContracts[1];

        const targetPayload = targetContract.interface.encodeFunctionData(
          "setName",
          ["new name"]
        );

        const payload = context.universalProfile.interface.encodeFunctionData(
          "execute(uint256,address,uint256,bytes)",
          [OPERATION_TYPES.STATICCALL, targetContract.address, 0, targetPayload]
        );

        await expect(
          context.keyManager.connect(caller).callStatic.execute(payload)
        ).to.be.reverted;
      });

      it("should revert when calling state changing function -> setNumber(uint256)", async () => {
        let targetContract = allowedTargetContracts[1];

        const targetPayload = targetContract.interface.encodeFunctionData(
          "setNumber",
          [12345]
        );

        const payload = context.universalProfile.interface.encodeFunctionData(
          "execute(uint256,address,uint256,bytes)",
          [OPERATION_TYPES.STATICCALL, targetContract.address, 0, targetPayload]
        );

        await expect(
          context.keyManager.connect(caller).callStatic.execute(payload)
        ).to.be.reverted;
      });
    });
  });

  describe("when caller has permission SUPER_STATICCALL + 2 allowed addresses", () => {
    let caller: SignerWithAddress;
    let allowedTargetContracts: [TargetContract, TargetContract];

    beforeEach(async () => {
      context = await buildContext();

      caller = context.accounts[1];

      allowedTargetContracts = [
        await new TargetContract__factory(context.accounts[0]).deploy(),
        await new TargetContract__factory(context.accounts[0]).deploy(),
      ];

      const permissionKeys = [
        ERC725YKeys.LSP6["AddressPermissions:Permissions"] +
          caller.address.substring(2),
        ERC725YKeys.LSP6["AddressPermissions:AllowedCalls"] +
          caller.address.substring(2),
      ];

      const permissionValues = [
        PERMISSIONS.SUPER_STATICCALL,
        combineAllowedCalls(
          ["0xffffffff", "0xffffffff"],
          [
            allowedTargetContracts[0].address,
            allowedTargetContracts[1].address,
          ],
          ["0xffffffff", "0xffffffff"]
        ),
      ];

      await setupKeyManager(context, permissionKeys, permissionValues);
    });

    describe("it should bypass allowed addresses check + allow to interact with any contract", () => {
      for (let ii = 1; ii <= 5; ii++) {
        it(`e.g: Target Contract nb ${ii}`, async () => {
          let targetContract = await new TargetContract__factory(
            context.accounts[0]
          ).deploy();

          const name = await targetContract.getName();

          const payload = context.universalProfile.interface.encodeFunctionData(
            "execute(uint256,address,uint256,bytes)",
            [
              OPERATION_TYPES.STATICCALL,
              targetContract.address,
              0,
              targetContract.interface.getSighash("getName"),
            ]
          );

          const result = await context.keyManager
            .connect(caller)
            .callStatic.execute(payload);

          const [decodedResult] = abiCoder.decode(["string"], result);
          expect(decodedResult).to.equal(name);
        });
      }
    });
  });
};
