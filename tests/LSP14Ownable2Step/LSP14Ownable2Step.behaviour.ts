import { expect } from "chai";
import { ethers, network } from "hardhat";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  contracts,
  LSP0ERC725Account,
  LSP9Vault,
  UPWithInstantAcceptOwnership__factory,
  UPWithInstantAcceptOwnership,
} from "../../types";

// constants
import { INTERFACE_IDS, OPERATION_TYPES } from "../../constants";

// helpers
import { provider } from "../utils/helpers";
import { lsp0Erc725Account } from "../../types/factories/contracts";

export type LSP14TestContext = {
  accounts: SignerWithAddress[];
  contract: LSP0ERC725Account | LSP9Vault;
  deployParams: { owner: SignerWithAddress };
  onlyOwnerRevertString: string;
};

export const shouldBehaveLikeLSP14 = (
  buildContext: () => Promise<LSP14TestContext>
) => {
  let context: LSP14TestContext;
  let newOwner: SignerWithAddress;

  beforeEach(async () => {
    context = await buildContext();

    newOwner = context.accounts[1];

    // fund the account
    await context.deployParams.owner.sendTransaction({
      to: context.contract.address,
      value: ethers.utils.parseEther("10"),
    });
  });

  describe("when owner call transferOwnership(...)", () => {
    beforeEach(async () => {
      await context.contract
        .connect(context.deployParams.owner)
        .transferOwnership(newOwner.address);
    });

    it("should have set the pendingOwner", async () => {
      let pendingOwner = await context.contract.pendingOwner();
      expect(pendingOwner).to.equal(newOwner.address);
    });

    it("owner should remain the current owner", async () => {
      let newOwner = ethers.Wallet.createRandom();

      const ownerBefore = await context.contract.owner();

      await context.contract
        .connect(context.deployParams.owner)
        .transferOwnership(newOwner.address);

      const ownerAfter = await context.contract.owner();

      expect(ownerBefore).to.equal(ownerAfter);
    });

    it("should override the pendingOwner when transferOwnership(...) is called twice", async () => {
      let overridenNewOwner = ethers.Wallet.createRandom();

      await context.contract
        .connect(context.deployParams.owner)
        .transferOwnership(overridenNewOwner.address);

      const pendingOwner = await context.contract.pendingOwner();
      expect(pendingOwner).to.equal(overridenNewOwner.address);
    });

    it("should revert when transferring Ownership to the contract itself", async () => {
      await expect(
        context.contract
          .connect(context.deployParams.owner)
          .transferOwnership(context.contract.address)
      ).to.be.revertedWithCustomError(
        context.contract,
        "CannotTransferOwnershipToSelf"
      );
    });

    describe("it should still be allowed to call onlyOwner functions", () => {
      it("setData(...)", async () => {
        const key =
          "0xcafecafecafecafecafecafecafecafecafecafecafecafecafecafecafecafe";
        const value = "0xabcd";

        await context.contract
          .connect(context.deployParams.owner)
          ["setData(bytes32,bytes)"](key, value);

        const result = await context.contract["getData(bytes32)"](key);
        expect(result).to.equal(value);
      });

      it("execute(...) - LYX transfer", async () => {
        const recipient = context.accounts[3];
        const amount = ethers.utils.parseEther("3");

        const recipientBalanceBefore = await provider.getBalance(
          recipient.address
        );
        const accountBalanceBefore = await provider.getBalance(
          context.contract.address
        );

        await context.contract
          .connect(context.deployParams.owner)
          ["execute(uint256,address,uint256,bytes)"](
            OPERATION_TYPES.CALL,
            recipient.address,
            amount,
            "0x"
          );

        const recipientBalanceAfter = await provider.getBalance(
          recipient.address
        );
        const accountBalanceAfter = await provider.getBalance(
          context.contract.address
        );

        // recipient balance should have gone up
        expect(recipientBalanceAfter).to.be.gt(recipientBalanceBefore);

        // account balance should have gone down
        expect(accountBalanceAfter).to.be.lt(accountBalanceBefore);
      });
    });

    describe("when `acceptOwnership(...)` is called in the same tx as `transferOwnership(...)`", () => {
      let upWithCustomURD: UPWithInstantAcceptOwnership;
      before(async () => {
        context = await buildContext();
        upWithCustomURD = await new UPWithInstantAcceptOwnership__factory(
          context.accounts[0]
        ).deploy(context.accounts[0].address);
      });

      it("should revert (e.g: if `universalReceiver(...)` function of `newOwner` calls directly `acceptOwnership(...)')", async () => {
        const ownershipTransfer = context.contract
          .connect(context.deployParams.owner)
          .transferOwnership(upWithCustomURD.address);

        await expect(ownershipTransfer).to.be.revertedWith(
          "LSP14: newOwner MUST accept ownership in a separate transaction"
        );
      });
    });
  });

  describe("when non-owner call transferOwnership(...)", () => {
    it("should revert", async () => {
      let newOwner = context.accounts[2];

      await expect(
        context.contract
          .connect(context.accounts[1])
          .transferOwnership(newOwner.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("when calling acceptOwnership(...)", () => {
    it("should revert when caller is not the pending owner", async () => {
      let newOwner = context.accounts[1];

      await context.contract
        .connect(context.deployParams.owner)
        .transferOwnership(newOwner.address);

      await expect(
        context.contract.connect(context.accounts[2]).acceptOwnership()
      ).to.be.revertedWith("LSP14: caller is not the pendingOwner");
    });

    describe("when caller is the pending owner", () => {
      let newOwner: SignerWithAddress;

      beforeEach(async () => {
        newOwner = context.accounts[1];

        await context.contract
          .connect(context.deployParams.owner)
          .transferOwnership(newOwner.address);
      });

      it("should change the contract owner to the pendingOwner", async () => {
        let pendingOwner = await context.contract.pendingOwner();

        await context.contract.connect(newOwner).acceptOwnership();

        let updatedOwner = await context.contract.owner();
        expect(updatedOwner).to.equal(pendingOwner);
      });

      it("should have cleared the pendingOwner after transferring ownership", async () => {
        await context.contract.connect(newOwner).acceptOwnership();

        let newPendingOwner = await context.contract.pendingOwner();
        expect(newPendingOwner).to.equal(ethers.constants.AddressZero);
      });

      it("should have emitted a OwnershipTransferred event", async () => {
        const owner = await context.contract.owner();

        await expect(await context.contract.connect(newOwner).acceptOwnership())
          .to.emit(context.contract, "OwnershipTransferred")
          .withArgs(
            owner, // previous owner
            newOwner.address // new owner
          );
      });
    });

    describe("after pendingOwner has claimed ownership", () => {
      let previousOwner: SignerWithAddress, newOwner: SignerWithAddress;

      beforeEach(async () => {
        previousOwner = context.deployParams.owner;
        newOwner = context.accounts[1];

        await context.contract
          .connect(context.deployParams.owner)
          .transferOwnership(newOwner.address);

        await context.contract.connect(newOwner).acceptOwnership();
      });

      describe("previous owner should not be allowed anymore to call onlyOwner functions", () => {
        it("should revert when calling `setData(...)`", async () => {
          const key =
            "0xcafecafecafecafecafecafecafecafecafecafecafecafecafecafecafecafe";
          const value = "0xabcd";

          await expect(
            context.contract
              .connect(previousOwner)
              ["setData(bytes32,bytes)"](key, value)
          ).to.be.revertedWith(context.onlyOwnerRevertString);
        });

        it("should revert when calling `execute(...)`", async () => {
          const recipient = context.accounts[3];
          const amount = ethers.utils.parseEther("3");

          await expect(
            context.contract
              .connect(previousOwner)
              ["execute(uint256,address,uint256,bytes)"](
                OPERATION_TYPES.CALL,
                recipient.address,
                amount,
                "0x"
              )
          ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("should revert when calling `renounceOwnership(...)`", async () => {
          await expect(
            context.contract.connect(previousOwner).renounceOwnership()
          ).to.be.revertedWith("Ownable: caller is not the owner");
        });
      });

      describe("new owner should be allowed to call onlyOwner functions", () => {
        it("setData(...)", async () => {
          const key =
            "0xcafecafecafecafecafecafecafecafecafecafecafecafecafecafecafecafe";
          const value = "0xabcd";

          await context.contract
            .connect(newOwner)
            ["setData(bytes32,bytes)"](key, value);

          const result = await context.contract["getData(bytes32)"](key);
          expect(result).to.equal(value);
        });

        it("execute(...) - LYX transfer", async () => {
          const recipient = context.accounts[3];
          const amount = ethers.utils.parseEther("3");

          await expect(() =>
            context.contract
              .connect(newOwner)
              ["execute(uint256,address,uint256,bytes)"](
                OPERATION_TYPES.CALL,
                recipient.address,
                amount,
                "0x"
              )
          ).to.changeEtherBalances(
            [context.contract.address, recipient.address],
            [
              `-${amount}`, // account balance should have gone down
              amount, // recipient balance should have gone up
            ]
          );
        });
      });
    });
  });

  describe("renounceOwnership(...)", () => {
    before(async () => {
      // mine 1,000 blocks
      await network.provider.send("hardhat_mine", [
        ethers.utils.hexValue(1000),
      ]);
    });

    describe("when calling renounceOwnership() with a non-owner account", () => {
      it("should revert with custom message", async () => {
        const tx = context.contract
          .connect(context.accounts[1])
          .renounceOwnership();

        await expect(tx).to.be.revertedWith("Ownable: caller is not the owner");
      });
    });

    describe("when calling renounceOwnership() the first time", () => {
      it("should instantiate the renounceOwnership process correctly", async () => {
        let tx = await context.contract
          .connect(context.deployParams.owner)
          .renounceOwnership();

        await tx.wait();

        const _renounceOwnershipStartedAtAfter = await provider.getStorageAt(
          context.contract.address,
          2
        );

        expect(
          ethers.BigNumber.from(_renounceOwnershipStartedAtAfter).toNumber()
        ).to.equal(tx.blockNumber);
      });

      it("should have emitted a RenounceOwnershipInitiated event", async () => {
        await expect(
          context.contract
            .connect(context.deployParams.owner)
            .renounceOwnership()
        ).to.emit(context.contract, "RenounceOwnershipInitiated");
      });

      it("should not change the current owner", async () => {
        await context.contract
          .connect(context.deployParams.owner)
          .renounceOwnership();

        expect(await context.contract.owner()).to.equal(
          context.deployParams.owner.address
        );
      });

      it("should not reset the pendingOwner", async () => {
        await context.contract
          .connect(context.deployParams.owner)
          .transferOwnership(newOwner.address);

        await context.contract
          .connect(context.deployParams.owner)
          .renounceOwnership();

        expect(await context.contract.pendingOwner()).to.equal(
          newOwner.address
        );
      });

      describe("currentOwner should still be able to interact with contract before confirming", () => {
        it("`setData(...)`", async () => {
          await context.contract
            .connect(context.deployParams.owner)
            .renounceOwnership();

          const key = ethers.utils.keccak256(
            ethers.utils.toUtf8Bytes("Random Key")
          );
          const value = ethers.utils.hexlify(
            ethers.utils.toUtf8Bytes("Random Value")
          );

          await context.contract
            .connect(context.deployParams.owner)
            ["setData(bytes32,bytes)"](key, value);

          const result = await context.contract["getData(bytes32)"](key);

          expect(result).to.equal(value);
        });

        it("transfer LYX via `execute(...)`", async () => {
          const recipient = context.accounts[3].address;
          const amount = ethers.utils.parseEther("3");

          // verify that balances have been updated
          await expect(() =>
            context.contract
              .connect(context.deployParams.owner)
              ["execute(uint256,address,uint256,bytes)"](
                OPERATION_TYPES.CALL,
                recipient,
                amount,
                "0x"
              )
          ).to.changeEtherBalances(
            [context.contract.address, recipient],
            [`-${amount}`, amount]
          );
        });
      });
    });

    describe("when calling renounceOwnership() the second time", () => {
      it("should revert if called in the delay period", async () => {
        const renounceOwnershipOnce = await context.contract
          .connect(context.deployParams.owner)
          .renounceOwnership();

        await network.provider.send("hardhat_mine", ["0x62"]); // skip 98 blocks

        const renounceOwnershipSecond = context.contract
          .connect(context.deployParams.owner)
          .renounceOwnership();

        await expect(renounceOwnershipSecond)
          .to.be.revertedWithCustomError(
            context.contract,
            "NotInRenounceOwnershipInterval"
          )
          .withArgs(
            (await renounceOwnershipOnce).blockNumber + 100,
            (await renounceOwnershipOnce).blockNumber + 200
          );

        expect(await context.contract.owner()).to.equal(
          context.deployParams.owner.address
        );
      });

      describe("when called after the delay and before the confirmation period end", () => {
        it("should have emitted a OwnershipTransferred event", async () => {
          await context.contract
            .connect(context.deployParams.owner)
            .renounceOwnership();

          await network.provider.send("hardhat_mine", ["0x63"]); // skip 99 blocks

          await expect(
            context.contract
              .connect(context.deployParams.owner)
              .renounceOwnership()
          )
            .to.emit(context.contract, "OwnershipTransferred")
            .withArgs(
              context.deployParams.owner.address,
              ethers.constants.AddressZero
            );

          expect(await context.contract.owner()).to.equal(
            ethers.constants.AddressZero
          );
        });

        it("should have emitted a OwnershipRenounced event", async () => {
          await context.contract
            .connect(context.deployParams.owner)
            .renounceOwnership();

          await network.provider.send("hardhat_mine", ["0x63"]); // skip 99 blocks

          await expect(
            context.contract
              .connect(context.deployParams.owner)
              .renounceOwnership()
          ).to.emit(context.contract, "OwnershipRenounced");

          expect(await context.contract.owner()).to.equal(
            ethers.constants.AddressZero
          );
        });

        it("owner should now be address(0)", async () => {
          await context.contract
            .connect(context.deployParams.owner)
            .renounceOwnership();

          await network.provider.send("hardhat_mine", ["0x63"]); // skip 99 blocks

          await context.contract
            .connect(context.deployParams.owner)
            .renounceOwnership();

          expect(await context.contract.owner()).to.equal(
            ethers.constants.AddressZero
          );
        });

        it("should have reset the `_renounceOwnershipStartedAt` state variable to zero", async () => {
          await context.contract
            .connect(context.deployParams.owner)
            .renounceOwnership();

          await network.provider.send("hardhat_mine", ["0x63"]); // skip 99 blocks

          await context.contract
            .connect(context.deployParams.owner)
            .renounceOwnership();

          const _renounceOwnershipStartedAtAfter = await provider.getStorageAt(
            context.contract.address,
            2
          );

          expect(
            ethers.BigNumber.from(_renounceOwnershipStartedAtAfter).toNumber()
          ).to.equal(0);
        });

        describe("currentOwner should not be able to interact with contract anymore after confirming", () => {
          it("`setData(...)`", async () => {
            await context.contract
              .connect(context.deployParams.owner)
              .renounceOwnership();

            await network.provider.send("hardhat_mine", ["0x63"]); // skip 99 blocks

            await context.contract
              .connect(context.deployParams.owner)
              .renounceOwnership();

            const key = ethers.utils.keccak256(
              ethers.utils.toUtf8Bytes("Random Key")
            );
            const value = ethers.utils.hexlify(
              ethers.utils.toUtf8Bytes("Random Value")
            );

            /** @todo check using Typescript type */
            const getExpectedRevertString = async () => {
              if (
                await context.contract.supportsInterface(
                  INTERFACE_IDS.LSP9Vault
                )
              ) {
                return "Only Owner or Universal Receiver Delegate allowed";
              } else {
                return "Ownable: caller is not the owner";
              }
            };
            const revertString = await getExpectedRevertString();

            await expect(
              context.contract
                .connect(context.deployParams.owner)
                ["setData(bytes32,bytes)"](key, value)
            ).to.be.revertedWith(revertString);
          });

          it("transfer LYX via `execute(...)`", async () => {
            await context.contract
              .connect(context.deployParams.owner)
              .renounceOwnership();

            await network.provider.send("hardhat_mine", ["0x63"]); // skip 99 blocks

            await context.contract
              .connect(context.deployParams.owner)
              .renounceOwnership();

            const recipient = context.accounts[3].address;
            const amount = ethers.utils.parseEther("3");

            await expect(
              context.contract
                .connect(context.deployParams.owner)
                ["execute(uint256,address,uint256,bytes)"](
                  OPERATION_TYPES.CALL,
                  recipient,
                  amount,
                  "0x"
                )
            ).to.be.revertedWith("Ownable: caller is not the owner");
          });
        });
      });

      it("should initialize again if the confirmation period passed", async () => {
        await context.contract
          .connect(context.deployParams.owner)
          .renounceOwnership();

        await network.provider.send("hardhat_mine", ["0xc8"]); // skip 200 blocks

        let tx = await context.contract
          .connect(context.deployParams.owner)
          .renounceOwnership();

        await tx.wait();

        const _renounceOwnershipStartedAtAfter = await provider.getStorageAt(
          context.contract.address,
          2
        );

        expect(
          ethers.BigNumber.from(_renounceOwnershipStartedAtAfter).toNumber()
        ).to.equal(tx.blockNumber);
      });

      describe("if there was a pendingOwner set before confirming `renounceOwnership(...)", () => {
        beforeEach(async () => {
          await context.contract
            .connect(context.deployParams.owner)
            .transferOwnership(newOwner.address);
        });

        it("should reset the pendingOwner whenever renounceOwnership(..) is confirmed", async () => {
          await context.contract
            .connect(context.deployParams.owner)
            .renounceOwnership();

          await network.provider.send("hardhat_mine", [
            ethers.utils.hexValue(100),
          ]);

          await context.contract
            .connect(context.deployParams.owner)
            .renounceOwnership();

          expect(await context.contract.pendingOwner()).to.equal(
            ethers.constants.AddressZero
          );
        });

        it("previous pendingOwner should not be able to call acceptOwnership(...) anymore", async () => {
          await context.contract
            .connect(context.deployParams.owner)
            .renounceOwnership();

          await network.provider.send("hardhat_mine", [
            ethers.utils.hexValue(100),
          ]);

          await context.contract
            .connect(context.deployParams.owner)
            .renounceOwnership();

          await expect(
            context.contract.connect(newOwner).acceptOwnership()
          ).to.be.revertedWith("LSP14: caller is not the pendingOwner");
        });
      });
    });
  });
};
