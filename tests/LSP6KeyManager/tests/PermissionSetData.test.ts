import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { encodeData, flattenEncodedData } from "@erc725/erc725.js";

import { Executor, Executor__factory } from "../../../types";

// constants
import {
  ERC725YKeys,
  ALL_PERMISSIONS,
  PERMISSIONS,
  BasicUPSetup_Schema,
  OPERATION_TYPES,
} from "../../../constants";

// setup
import { LSP6TestContext } from "../../utils/context";
import { setupKeyManager } from "../../utils/fixtures";

// helpers
import {
  generateKeysAndValues,
  getRandomAddresses,
  combinePermissions,
  encodeCompactBytesArray,
  abiCoder,
} from "../../utils/helpers";

export const shouldBehaveLikePermissionSetData = (
  buildContext: () => Promise<LSP6TestContext>
) => {
  let context: LSP6TestContext;

  describe("when caller is an EOA", () => {
    let canSetDataWithAllowedERC725YDataKeys: SignerWithAddress,
      canSetDataWithoutAllowedERC725YDataKeys: SignerWithAddress,
      cannotSetData: SignerWithAddress;

    beforeEach(async () => {
      context = await buildContext();

      canSetDataWithAllowedERC725YDataKeys = context.accounts[1];
      canSetDataWithoutAllowedERC725YDataKeys = context.accounts[2];
      cannotSetData = context.accounts[3];

      const permissionsKeys = [
        ERC725YKeys.LSP6["AddressPermissions:Permissions"] +
          context.owner.address.substring(2),
        ERC725YKeys.LSP6["AddressPermissions:Permissions"] +
          canSetDataWithAllowedERC725YDataKeys.address.substring(2),
        ERC725YKeys.LSP6["AddressPermissions:AllowedERC725YKeys"] +
          canSetDataWithAllowedERC725YDataKeys.address.substring(2),
        ERC725YKeys.LSP6["AddressPermissions:Permissions"] +
          canSetDataWithoutAllowedERC725YDataKeys.address.substring(2),
        ERC725YKeys.LSP6["AddressPermissions:Permissions"] +
          cannotSetData.address.substring(2),
      ];

      const permissionsValues = [
        ALL_PERMISSIONS,
        combinePermissions(PERMISSIONS.SETDATA, PERMISSIONS.CALL),
        encodeCompactBytesArray([
          ERC725YKeys.LSP1.LSP1UniversalReceiverDelegate,
          ERC725YKeys.LSP3.LSP3Profile,
          ERC725YKeys.LSP12["LSP12IssuedAssets[]"].index,
          ethers.utils.keccak256(ethers.utils.toUtf8Bytes("My First Key")),
          ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MyFirstKey")),
          ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MySecondKey")),
          ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MyThirdKey")),
          ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MyFourthKey")),
          ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MyFifthKey")),
        ]),
        combinePermissions(PERMISSIONS.SETDATA, PERMISSIONS.CALL),
        PERMISSIONS.CALL,
      ];

      await setupKeyManager(context, permissionsKeys, permissionsValues);
    });

    describe("when setting one key", () => {
      describe("For UP owner", () => {
        it("should pass", async () => {
          let key = ethers.utils.keccak256(
            ethers.utils.toUtf8Bytes("My First Key")
          );
          let value = ethers.utils.hexlify(
            ethers.utils.toUtf8Bytes("Hello Lukso!")
          );

          let payload = context.universalProfile.interface.encodeFunctionData(
            "setData(bytes32,bytes)",
            [key, value]
          );

          await context.keyManager.connect(context.owner).execute(payload);
          const fetchedResult = await context.universalProfile.callStatic[
            "getData(bytes32)"
          ](key);
          expect(fetchedResult).to.equal(value);
        });
      });

      describe("For address that has permission SETDATA with AllowedERC725YDataKeys", () => {
        it("should pass", async () => {
          let key = ethers.utils.keccak256(
            ethers.utils.toUtf8Bytes("My First Key")
          );
          let value = ethers.utils.hexlify(
            ethers.utils.toUtf8Bytes("Hello Lukso!")
          );

          let payload = context.universalProfile.interface.encodeFunctionData(
            "setData(bytes32,bytes)",
            [key, value]
          );

          await context.keyManager
            .connect(canSetDataWithAllowedERC725YDataKeys)
            .execute(payload);
          const fetchedResult = await context.universalProfile.callStatic[
            "getData(bytes32)"
          ](key);
          expect(fetchedResult).to.equal(value);
        });
      });

      describe("For address that has permission SETDATA without any AllowedERC725YDataKeys", () => {
        it("should revert", async () => {
          let key = ethers.utils.keccak256(
            ethers.utils.toUtf8Bytes("My First Key")
          );
          let value = ethers.utils.hexlify(
            ethers.utils.toUtf8Bytes("Hello Lukso!")
          );

          let payload = context.universalProfile.interface.encodeFunctionData(
            "setData(bytes32,bytes)",
            [key, value]
          );

          await expect(
            context.keyManager
              .connect(canSetDataWithoutAllowedERC725YDataKeys)
              .execute(payload)
          )
            .to.be.revertedWithCustomError(
              context.keyManager,
              "NoERC725YDataKeysAllowed"
            )
            .withArgs(canSetDataWithoutAllowedERC725YDataKeys.address);
        });
      });

      describe("For address that doesn't have permission SETDATA", () => {
        it("should not allow", async () => {
          let key = ethers.utils.keccak256(
            ethers.utils.toUtf8Bytes("My First Key")
          );
          let value = ethers.utils.hexlify(
            ethers.utils.toUtf8Bytes("Hello Lukso!")
          );

          let payload = context.universalProfile.interface.encodeFunctionData(
            "setData(bytes32,bytes)",
            [key, value]
          );

          await expect(
            context.keyManager.connect(cannotSetData).execute(payload)
          )
            .to.be.revertedWithCustomError(context.keyManager, "NotAuthorised")
            .withArgs(cannotSetData.address, "SETDATA");
        });
      });
    });

    describe("when setting multiple keys", () => {
      describe("For UP owner", () => {
        it("(should pass): adding 5 singleton keys", async () => {
          let elements = {
            MyFirstKey: "aaaaaaaaaa",
            MySecondKey: "bbbbbbbbbb",
            MyThirdKey: "cccccccccc",
            MyFourthKey: "dddddddddd",
            MyFifthKey: "eeeeeeeeee",
          };

          let [keys, values] = generateKeysAndValues(elements);

          let payload = context.universalProfile.interface.encodeFunctionData(
            "setData(bytes32[],bytes[])",
            [keys, values]
          );

          await context.keyManager.connect(context.owner).execute(payload);
          let fetchedResult = await context.universalProfile.callStatic[
            "getData(bytes32[])"
          ](keys);

          let expectedResult = Object.values(elements).map((value) =>
            ethers.utils.hexlify(ethers.utils.toUtf8Bytes(value))
          );
          expect(fetchedResult).to.deep.equal(expectedResult);
        });

        it("(should pass): adding 10 LSP12IssuedAssets", async () => {
          let lsp12IssuedAssets = getRandomAddresses(10);

          const data = { "LSP12IssuedAssets[]": lsp12IssuedAssets };

          const encodedData = encodeData(data, BasicUPSetup_Schema);
          const flattenedEncodedData = flattenEncodedData(encodedData);

          let keys = [];
          let values = [];

          flattenedEncodedData.map((data) => {
            keys.push(data.key);
            values.push(data.value);
          });

          let payload = context.universalProfile.interface.encodeFunctionData(
            "setData(bytes32[],bytes[])",
            [keys, values]
          );

          await context.keyManager.connect(context.owner).execute(payload);

          const fetchedResult = await context.universalProfile.callStatic[
            "getData(bytes32[])"
          ](keys);
          expect(fetchedResult).to.deep.equal(values);
        });

        it("(should pass): setup a basic Universal Profile (`LSP3Profile`, `LSP12IssuedAssets[]` and `LSP1UniversalReceiverDelegate`)", async () => {
          const basicUPSetup = {
            LSP3Profile: {
              hashFunction: "keccak256(utf8)",
              hash: "0x820464ddfac1bec070cc14a8daf04129871d458f2ca94368aae8391311af6361",
              url: "ifps://QmYr1VJLwerg6pEoscdhVGugo39pa6rycEZLjtRPDfW84UAx",
            },
            "LSP12IssuedAssets[]": [
              "0xD94353D9B005B3c0A9Da169b768a31C57844e490",
              "0xDaea594E385Fc724449E3118B2Db7E86dFBa1826",
            ],
            LSP1UniversalReceiverDelegate:
              "0x1183790f29BE3cDfD0A102862fEA1a4a30b3AdAb",
          };

          let encodedData = encodeData(basicUPSetup, BasicUPSetup_Schema);
          let flattenedEncodedData = flattenEncodedData(encodedData);

          let keys = [];
          let values = [];

          flattenedEncodedData.map((data) => {
            keys.push(data.key);
            values.push(data.value);
          });

          let payload = context.universalProfile.interface.encodeFunctionData(
            "setData(bytes32[],bytes[])",
            [keys, values]
          );

          await context.keyManager.connect(context.owner).execute(payload);

          let fetchedResult = await context.universalProfile.callStatic[
            "getData(bytes32[])"
          ](keys);
          expect(fetchedResult).to.deep.equal(values);
        });
      });

      describe("For address that has permission SETDATA with AllowedERC725YDataKeys", () => {
        it("(should pass): adding 5 singleton keys", async () => {
          let elements = {
            MyFirstKey: "aaaaaaaaaa",
            MySecondKey: "bbbbbbbbbb",
            MyThirdKey: "cccccccccc",
            MyFourthKey: "dddddddddd",
            MyFifthKey: "eeeeeeeeee",
          };

          let [keys, values] = generateKeysAndValues(elements);

          let payload = context.universalProfile.interface.encodeFunctionData(
            "setData(bytes32[],bytes[])",
            [keys, values]
          );

          await context.keyManager
            .connect(canSetDataWithAllowedERC725YDataKeys)
            .execute(payload);

          let fetchedResult = await context.universalProfile.callStatic[
            "getData(bytes32[])"
          ](keys);

          let expectedResult = Object.values(elements).map((value) =>
            ethers.utils.hexlify(ethers.utils.toUtf8Bytes(value))
          );
          expect(fetchedResult).to.deep.equal(expectedResult);
        });

        it("(should pass): adding 10 LSP12IssuedAssets", async () => {
          let lsp12IssuedAssets = getRandomAddresses(10);

          const data = { "LSP12IssuedAssets[]": lsp12IssuedAssets };

          const encodedData = encodeData(data, BasicUPSetup_Schema);
          const flattenedEncodedData = flattenEncodedData(encodedData);

          let keys = [];
          let values = [];

          flattenedEncodedData.map((data) => {
            keys.push(data.key);
            values.push(data.value);
          });

          let payload = context.universalProfile.interface.encodeFunctionData(
            "setData(bytes32[],bytes[])",
            [keys, values]
          );

          await context.keyManager
            .connect(canSetDataWithAllowedERC725YDataKeys)
            .execute(payload);

          let fetchedResult = await context.universalProfile.callStatic[
            "getData(bytes32[])"
          ](keys);
          expect(fetchedResult).to.deep.equal(values);
        });

        it("(should pass): setup a basic Universal Profile (`LSP3Profile`, `LSP12IssuedAssets[]`)", async () => {
          const basicUPSetup = {
            LSP3Profile: {
              hashFunction: "keccak256(utf8)",
              hash: "0x820464ddfac1bec070cc14a8daf04129871d458f2ca94368aae8391311af6361",
              url: "ifps://QmYr1VJLwerg6pEoscdhVGugo39pa6rycEZLjtRPDfW84UAx",
            },
            "LSP12IssuedAssets[]": [
              "0xD94353D9B005B3c0A9Da169b768a31C57844e490",
              "0xDaea594E385Fc724449E3118B2Db7E86dFBa1826",
            ],
          };

          let encodedData = encodeData(basicUPSetup, BasicUPSetup_Schema);
          let flattenedEncodedData = flattenEncodedData(encodedData);

          let keys = [];
          let values = [];

          flattenedEncodedData.map((data) => {
            keys.push(data.key);
            values.push(data.value);
          });

          let payload = context.universalProfile.interface.encodeFunctionData(
            "setData(bytes32[],bytes[])",
            [keys, values]
          );

          await context.keyManager
            .connect(canSetDataWithAllowedERC725YDataKeys)
            .execute(payload);

          let fetchedResult = await context.universalProfile.callStatic[
            "getData(bytes32[])"
          ](keys);
          expect(fetchedResult).to.deep.equal(values);
        });
      });

      describe("For address that has permission SETDATA without AllowedERC725YDataKeys", () => {
        it("(should revert): adding 5 singleton keys", async () => {
          let elements = {
            MyFirstKey: "aaaaaaaaaa",
            MySecondKey: "bbbbbbbbbb",
            MyThirdKey: "cccccccccc",
            MyFourthKey: "dddddddddd",
            MyFifthKey: "eeeeeeeeee",
          };

          let [keys, values] = generateKeysAndValues(elements);

          let payload = context.universalProfile.interface.encodeFunctionData(
            "setData(bytes32[],bytes[])",
            [keys, values]
          );

          await expect(
            context.keyManager
              .connect(canSetDataWithoutAllowedERC725YDataKeys)
              .execute(payload)
          )
            .to.be.revertedWithCustomError(
              context.keyManager,
              "NoERC725YDataKeysAllowed"
            )
            .withArgs(canSetDataWithoutAllowedERC725YDataKeys.address);
        });

        it("(should revert): adding 10 LSP12IssuedAssets", async () => {
          let lsp12IssuedAssets = getRandomAddresses(10);

          const data = { "LSP12IssuedAssets[]": lsp12IssuedAssets };

          const encodedData = encodeData(data, BasicUPSetup_Schema);
          const flattenedEncodedData = flattenEncodedData(encodedData);

          let keys = [];
          let values = [];

          flattenedEncodedData.map((data) => {
            keys.push(data.key);
            values.push(data.value);
          });

          let payload = context.universalProfile.interface.encodeFunctionData(
            "setData(bytes32[],bytes[])",
            [keys, values]
          );

          await expect(
            context.keyManager
              .connect(canSetDataWithoutAllowedERC725YDataKeys)
              .execute(payload)
          )
            .to.be.revertedWithCustomError(
              context.keyManager,
              "NoERC725YDataKeysAllowed"
            )
            .withArgs(canSetDataWithoutAllowedERC725YDataKeys.address);
        });

        it("(should revert): setup a basic Universal Profile (`LSP3Profile`, `LSP12IssuedAssets[]`)", async () => {
          const basicUPSetup = {
            LSP3Profile: {
              hashFunction: "keccak256(utf8)",
              hash: "0x820464ddfac1bec070cc14a8daf04129871d458f2ca94368aae8391311af6361",
              url: "ifps://QmYr1VJLwerg6pEoscdhVGugo39pa6rycEZLjtRPDfW84UAx",
            },
            "LSP12IssuedAssets[]": [
              "0xD94353D9B005B3c0A9Da169b768a31C57844e490",
              "0xDaea594E385Fc724449E3118B2Db7E86dFBa1826",
            ],
          };

          let encodedData = encodeData(basicUPSetup, BasicUPSetup_Schema);
          let flattenedEncodedData = flattenEncodedData(encodedData);

          let keys = [];
          let values = [];

          flattenedEncodedData.map((data) => {
            keys.push(data.key);
            values.push(data.value);
          });

          let payload = context.universalProfile.interface.encodeFunctionData(
            "setData(bytes32[],bytes[])",
            [keys, values]
          );

          await expect(
            context.keyManager
              .connect(canSetDataWithoutAllowedERC725YDataKeys)
              .execute(payload)
          )
            .to.be.revertedWithCustomError(
              context.keyManager,
              "NoERC725YDataKeysAllowed"
            )
            .withArgs(canSetDataWithoutAllowedERC725YDataKeys.address);
        });
      });

      describe("For address that doesn't have permission SETDATA", () => {
        it("(should fail): adding 5 singleton keys", async () => {
          let elements = {
            MyFirstKey: "aaaaaaaaaa",
            MySecondKey: "bbbbbbbbbb",
            MyThirdKey: "cccccccccc",
            MyFourthKey: "dddddddddd",
            MyFifthKey: "eeeeeeeeee",
          };

          let [keys, values] = generateKeysAndValues(elements);

          let payload = context.universalProfile.interface.encodeFunctionData(
            "setData(bytes32[],bytes[])",
            [keys, values]
          );

          await expect(
            context.keyManager.connect(cannotSetData).execute(payload)
          )
            .to.be.revertedWithCustomError(context.keyManager, "NotAuthorised")
            .withArgs(cannotSetData.address, "SETDATA");
        });

        it("(should fail): adding 10 LSP12IssuedAssets", async () => {
          let lsp12IssuedAssets = getRandomAddresses(10);

          const data = { "LSP12IssuedAssets[]": lsp12IssuedAssets };

          const encodedData = encodeData(data, BasicUPSetup_Schema);
          const flattenedEncodedData = flattenEncodedData(encodedData);

          let keys = [];
          let values = [];

          flattenedEncodedData.map((data) => {
            keys.push(data.key);
            values.push(data.value);
          });

          let payload = context.universalProfile.interface.encodeFunctionData(
            "setData(bytes32[],bytes[])",
            [keys, values]
          );

          await expect(
            context.keyManager.connect(cannotSetData).execute(payload)
          )
            .to.be.revertedWithCustomError(context.keyManager, "NotAuthorised")
            .withArgs(cannotSetData.address, "SETDATA");
        });

        it("(should fail): setup a basic Universal Profile (`LSP3Profile`, `LSP12IssuedAssets[]`)", async () => {
          const basicUPSetup = {
            LSP3Profile: {
              hashFunction: "keccak256(utf8)",
              hash: "0x820464ddfac1bec070cc14a8daf04129871d458f2ca94368aae8391311af6361",
              url: "ifps://QmYr1VJLwerg6pEoscdhVGugo39pa6rycEZLjtRPDfW84UAx",
            },
            "LSP12IssuedAssets[]": [
              "0xD94353D9B005B3c0A9Da169b768a31C57844e490",
              "0xDaea594E385Fc724449E3118B2Db7E86dFBa1826",
            ],
          };

          let encodedData = encodeData(basicUPSetup, BasicUPSetup_Schema);
          let flattenedEncodedData = flattenEncodedData(encodedData);

          let keys = [];
          let values = [];

          flattenedEncodedData.map((data) => {
            keys.push(data.key);
            values.push(data.value);
          });

          let payload = context.universalProfile.interface.encodeFunctionData(
            "setData(bytes32[],bytes[])",
            [keys, values]
          );

          await expect(
            context.keyManager.connect(cannotSetData).execute(payload)
          )
            .to.be.revertedWithCustomError(context.keyManager, "NotAuthorised")
            .withArgs(cannotSetData.address, "SETDATA");
        });
      });
    });
  });

  describe("when caller is a contract", () => {
    let contractCanSetData: Executor;

    const key = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Some Key"));
    const value = ethers.utils.hexlify(ethers.utils.toUtf8Bytes("Some value"));

    /**
     * @dev this is necessary when the function being called in the contract
     *  perform a raw / low-level call (in the function body)
     *  otherwise, the deeper layer of interaction (UP.execute) fails
     */
    const GAS_PROVIDED = 500_000;

    beforeEach(async () => {
      context = await buildContext();

      contractCanSetData = await new Executor__factory(context.owner).deploy(
        context.universalProfile.address,
        context.keyManager.address
      );

      const permissionKeys = [
        ERC725YKeys.LSP6["AddressPermissions:Permissions"] +
          context.owner.address.substring(2),
        ERC725YKeys.LSP6["AddressPermissions:Permissions"] +
          contractCanSetData.address.substring(2),
        ERC725YKeys.LSP6["AddressPermissions:AllowedERC725YKeys"] +
          contractCanSetData.address.substring(2),
      ];

      const hardcodedDataKey =
        "0x562d53c1631c0c1620e183763f5f6356addcf78f26cbbd0b9eb7061d7c897ea1";

      const compactedAllowedERC725YDataKeys = encodeCompactBytesArray([
        hardcodedDataKey,
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Some Key")),
      ]);

      const permissionValues = [
        ALL_PERMISSIONS,
        PERMISSIONS.SETDATA,
        compactedAllowedERC725YDataKeys,
      ];

      await setupKeyManager(context, permissionKeys, permissionValues);
    });

    describe("> contract calls", () => {
      it("should allow to set a key hardcoded inside a function of the calling contract", async () => {
        // check that nothing is set at store[key]
        const initialStorage = await context.universalProfile.callStatic[
          "getData(bytes32)"
        ](key);
        expect(initialStorage).to.equal("0x");

        // make the executor call
        await contractCanSetData.setHardcodedKey();

        // check that store[key] is now set to value
        const newStorage = await context.universalProfile.callStatic[
          "getData(bytes32)"
        ](key);
        expect(newStorage).to.equal(value);
      });

      it("Should allow to set a key computed inside a function of the calling contract", async () => {
        // check that nothing is set at store[key]
        const initialStorage = await context.universalProfile.callStatic[
          "getData(bytes32)"
        ](key);
        expect(initialStorage).to.equal("0x");

        // make the executor call
        await contractCanSetData.setComputedKey();

        // check that store[key] is now set to value
        const newStorage = await context.universalProfile.callStatic[
          "getData(bytes32)"
        ](key);
        expect(newStorage).to.equal(value);
      });

      it("Should allow to set a key computed from parameters given to a function of the calling contract", async () => {
        // check that nothing is set at store[key]
        const initialStorage = await context.universalProfile.callStatic[
          "getData(bytes32)"
        ](key);
        expect(initialStorage).to.equal("0x");

        // make the executor call
        await contractCanSetData.setComputedKeyFromParams(key, value);

        // check that store[key] is now set to value
        const newStorage = await context.universalProfile.callStatic[
          "getData(bytes32)"
        ](key);
        expect(newStorage).to.equal(value);
      });
    });

    describe("> Low-level calls", () => {
      it("Should allow to `setHardcodedKeyRawCall` on UP", async () => {
        // check that nothing is set at store[key]
        const initialStorage = await context.universalProfile.callStatic[
          "getData(bytes32)"
        ](key);
        expect(initialStorage).to.equal("0x");

        // check if low-level call succeeded
        let result = await contractCanSetData.callStatic.setHardcodedKeyRawCall(
          {
            gasLimit: GAS_PROVIDED,
          }
        );
        expect(result).to.be.true;

        // make the executor call
        await contractCanSetData.setHardcodedKeyRawCall({
          gasLimit: GAS_PROVIDED,
        });

        // check that store[key] is now set to value
        const newStorage = await context.universalProfile.callStatic[
          "getData(bytes32)"
        ](key);
        expect(newStorage).to.equal(value);
      });

      it("Should allow to `setComputedKeyRawCall` on UP", async () => {
        // check that nothing is set at store[key]
        const initialStorage = await context.universalProfile.callStatic[
          "getData(bytes32)"
        ](key);
        expect(initialStorage).to.equal("0x");

        // make the executor call
        await contractCanSetData.setComputedKeyRawCall({
          gasLimit: GAS_PROVIDED,
        });

        // check that store[key] is now set to value
        const newStorage = await context.universalProfile.callStatic[
          "getData(bytes32)"
        ](key);
        expect(newStorage).to.equal(value);
      });

      it("Should allow to `setComputedKeyFromParamsRawCall` on UP", async () => {
        // check that nothing is set at store[key]
        let initialStorage = await context.universalProfile.callStatic[
          "getData(bytes32)"
        ](key);
        expect(initialStorage).to.equal("0x");

        // make the executor call
        await contractCanSetData.setComputedKeyFromParamsRawCall(key, value, {
          gasLimit: GAS_PROVIDED,
        });

        // check that store[key] is now set to value
        let newStorage = await context.universalProfile.callStatic[
          "getData(bytes32)"
        ](key);
        expect(newStorage).to.equal(value);
      });
    });
  });

  describe("when caller is another UniversalProfile (with a KeyManager attached as owner)", () => {
    // UP making the call
    let alice: SignerWithAddress;
    let aliceContext: LSP6TestContext;

    // UP being called
    let bob: SignerWithAddress;
    let bobContext: LSP6TestContext;

    beforeEach(async () => {
      aliceContext = await buildContext();
      alice = aliceContext.accounts[0];

      bobContext = await buildContext();
      bob = bobContext.accounts[1];

      const alicePermissionKeys = [
        ERC725YKeys.LSP6["AddressPermissions:Permissions"] +
          alice.address.substring(2),
      ];
      const alicePermissionValues = [ALL_PERMISSIONS];

      const bobPermissionKeys = [
        ERC725YKeys.LSP6["AddressPermissions:Permissions"] +
          bob.address.substring(2),
        ERC725YKeys.LSP6["AddressPermissions:Permissions"] +
          aliceContext.universalProfile.address.substring(2),
      ];

      const bobPermissionValues = [ALL_PERMISSIONS, PERMISSIONS.SETDATA];

      await setupKeyManager(
        aliceContext,
        alicePermissionKeys,
        alicePermissionValues
      );

      await setupKeyManager(bobContext, bobPermissionKeys, bobPermissionValues);
    });

    it("Alice should have ALL PERMISSIONS in her UP", async () => {
      let key =
        ERC725YKeys.LSP6["AddressPermissions:Permissions"] +
        alice.address.substring(2);

      const result = await aliceContext.universalProfile["getData(bytes32)"](
        key
      );
      expect(result).to.equal(ALL_PERMISSIONS);
    });

    it("Bob should have ALL PERMISSIONS in his UP", async () => {
      let key =
        ERC725YKeys.LSP6["AddressPermissions:Permissions"] +
        bob.address.substring(2);

      const result = await bobContext.universalProfile["getData(bytes32)"](key);
      expect(result).to.equal(ALL_PERMISSIONS);
    });

    it("Alice's UP should have permission SETDATA on Bob's UP", async () => {
      let key =
        ERC725YKeys.LSP6["AddressPermissions:Permissions"] +
        aliceContext.universalProfile.address.substring(2);

      const result = await bobContext.universalProfile["getData(bytes32)"](key);
      expect(result).to.equal(PERMISSIONS.SETDATA);
    });

    it("Alice's UP should't be able to `setData(...)` on Bob's UP when it doesn't have any AllowedERC725YDataKeys", async () => {
      let key = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Alice's Key"));
      let value = ethers.utils.hexlify(
        ethers.utils.toUtf8Bytes("Alice's Value")
      );

      let finalSetDataPayload =
        bobContext.universalProfile.interface.encodeFunctionData(
          "setData(bytes32,bytes)",
          [key, value]
        );

      let bobKeyManagerPayload =
        bobContext.keyManager.interface.encodeFunctionData("execute", [
          finalSetDataPayload,
        ]);

      let aliceUniversalProfilePayload =
        aliceContext.universalProfile.interface.encodeFunctionData(
          "execute(uint256,address,uint256,bytes)",
          [
            OPERATION_TYPES.CALL,
            bobContext.keyManager.address,
            0,
            bobKeyManagerPayload,
          ]
        );

      await expect(
        aliceContext.keyManager
          .connect(alice)
          .execute(aliceUniversalProfilePayload)
      )
        .to.be.revertedWithCustomError(
          bobContext.keyManager,
          "NoERC725YDataKeysAllowed"
        )
        .withArgs(aliceContext.universalProfile.address);
    });

    it("Alice's UP should be able to `setData(...)` on Bob's UP when it has AllowedERC725YDataKeys", async () => {
      let key = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Alice's Key"));
      let value = ethers.utils.hexlify(
        ethers.utils.toUtf8Bytes("Alice's Value")
      );

      // Adding `key` to AllowedERC725YDataKeys for Alice
      const payload = bobContext.universalProfile.interface.encodeFunctionData(
        "setData(bytes32,bytes)",
        [
          ERC725YKeys.LSP6["AddressPermissions:AllowedERC725YKeys"] +
            aliceContext.universalProfile.address.substring(2),
          encodeCompactBytesArray([key]),
        ]
      );
      await bobContext.keyManager.connect(bob).execute(payload);

      let finalSetDataPayload =
        bobContext.universalProfile.interface.encodeFunctionData(
          "setData(bytes32,bytes)",
          [key, value]
        );

      let bobKeyManagerPayload =
        bobContext.keyManager.interface.encodeFunctionData("execute", [
          finalSetDataPayload,
        ]);

      let aliceUniversalProfilePayload =
        aliceContext.universalProfile.interface.encodeFunctionData(
          "execute(uint256,address,uint256,bytes)",
          [
            OPERATION_TYPES.CALL,
            bobContext.keyManager.address,
            0,
            bobKeyManagerPayload,
          ]
        );

      await aliceContext.keyManager
        .connect(alice)
        .execute(aliceUniversalProfilePayload);

      const result = await bobContext.universalProfile["getData(bytes32)"](key);
      expect(result).to.equal(value);
    });
  });

  describe("when caller has SUPER_SETDATA + some allowed ERC725YKeys", () => {
    let caller: SignerWithAddress;

    const allowedERC725YKeys = [
      ethers.utils.keccak256(ethers.utils.toUtf8Bytes("My 1st allowed key")),
      ethers.utils.keccak256(ethers.utils.toUtf8Bytes("My 2nd allowed key")),
      ethers.utils.keccak256(ethers.utils.toUtf8Bytes("My 3rd allowed key")),
    ];

    beforeEach(async () => {
      context = await buildContext();

      caller = context.accounts[1];

      const permissionKeys = [
        ERC725YKeys.LSP6["AddressPermissions:Permissions"] +
          caller.address.substring(2),
        ERC725YKeys.LSP6["AddressPermissions:AllowedERC725YKeys"] +
          caller.address.substring(2),
      ];

      const permissionValues = [
        PERMISSIONS.SUPER_SETDATA,
        encodeCompactBytesArray(allowedERC725YKeys),
      ];

      await setupKeyManager(context, permissionKeys, permissionValues);
    });

    describe("when trying to set a disallowed key", () => {
      for (let ii = 1; ii <= 5; ii++) {
        let key = ethers.utils.keccak256(
          ethers.utils.toUtf8Bytes(`dissallowed key ${ii}`)
        );
        let value = ethers.utils.hexlify(
          ethers.utils.toUtf8Bytes(`some value ${ii}`)
        );

        it(`should be allowed to set a disallowed key: ${key}`, async () => {
          const payload = context.universalProfile.interface.encodeFunctionData(
            "setData(bytes32,bytes)",
            [key, value]
          );

          await context.keyManager.connect(caller).execute(payload);

          const result = await context.universalProfile["getData(bytes32)"](
            key
          );
          expect(result).to.equal(value);
        });
      }
    });

    describe("when trying to set an allowed key", () => {
      it("should be allowed to set the 1st allowed key", async () => {
        let value = ethers.utils.hexlify(
          ethers.utils.toUtf8Bytes("some value 1")
        );

        let payload = context.universalProfile.interface.encodeFunctionData(
          "setData(bytes32,bytes)",
          [allowedERC725YKeys[0], value]
        );

        await context.keyManager.connect(caller).execute(payload);

        const result = await context.universalProfile["getData(bytes32)"](
          allowedERC725YKeys[0]
        );
        expect(result).to.equal(value);
      });

      it("should be allowed to set the 2nd allowed key", async () => {
        let value = ethers.utils.hexlify(
          ethers.utils.toUtf8Bytes("some value 2")
        );

        let payload = context.universalProfile.interface.encodeFunctionData(
          "setData(bytes32,bytes)",
          [allowedERC725YKeys[1], value]
        );

        await context.keyManager.connect(caller).execute(payload);

        const result = await context.universalProfile["getData(bytes32)"](
          allowedERC725YKeys[1]
        );
        expect(result).to.equal(value);
      });

      it("should be allowed to set the 3rd allowed key", async () => {
        let value = ethers.utils.hexlify(
          ethers.utils.toUtf8Bytes("some value 3")
        );

        let payload = context.universalProfile.interface.encodeFunctionData(
          "setData(bytes32,bytes)",
          [allowedERC725YKeys[2], value]
        );

        await context.keyManager.connect(caller).execute(payload);

        const result = await context.universalProfile["getData(bytes32)"](
          allowedERC725YKeys[2]
        );
        expect(result).to.equal(value);
      });
    });
  });
};
