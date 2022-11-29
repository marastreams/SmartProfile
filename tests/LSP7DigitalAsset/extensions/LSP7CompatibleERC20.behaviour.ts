import { ethers } from "hardhat";
import { expect } from "chai";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, ContractTransaction } from "ethers";
import type { TransactionResponse } from "@ethersproject/abstract-provider";

import { INTERFACE_IDS, SupportedStandards } from "../../../constants";
import {
  LSP7CompatibleERC20,
  LSP7CompatibleERC20Tester,
  TokenReceiverWithLSP1,
  TokenReceiverWithLSP1__factory,
  TokenReceiverWithoutLSP1,
  TokenReceiverWithoutLSP1__factory,
} from "../../../types";
import { ERC725YKeys } from "../../../constants.js";

type LSP7CompatibleERC20TestAccounts = {
  owner: SignerWithAddress;
  tokenReceiver: SignerWithAddress;
  operator: SignerWithAddress;
  anotherOperator: SignerWithAddress;
  anyone: SignerWithAddress;
};

export const getNamedAccounts =
  async (): Promise<LSP7CompatibleERC20TestAccounts> => {
    const [owner, tokenReceiver, operator, anotherOperator, anyone] =
      await ethers.getSigners();
    return { owner, tokenReceiver, operator, anotherOperator, anyone };
  };

export type LSP7CompatibleERC20DeployParams = {
  name: string;
  symbol: string;
  newOwner: string;
};

export type LSP7CompatibleERC20TestContext = {
  accounts: LSP7CompatibleERC20TestAccounts;
  lsp7CompatibleERC20: LSP7CompatibleERC20Tester;
  deployParams: LSP7CompatibleERC20DeployParams;
  initialSupply: BigNumber;
};

export type ExpectedError = {
  error: string;
  args: string[];
};

export const shouldBehaveLikeLSP7CompatibleERC20 = (
  buildContext: () => Promise<LSP7CompatibleERC20TestContext>
) => {
  let context: LSP7CompatibleERC20TestContext;

  beforeEach(async () => {
    context = await buildContext();
  });

  describe("approve", () => {
    describe("when operator is the zero address", () => {
      it("should revert", async () => {
        await expect(
          context.lsp7CompatibleERC20.approve(
            ethers.constants.AddressZero,
            context.initialSupply
          )
        ).to.be.revertedWithCustomError(
          context.lsp7CompatibleERC20,
          "LSP7CannotUseAddressZeroAsOperator"
        );
      });
    });

    describe("when the operator had no authorized amount", () => {
      it("should succeed by setting the given amount", async () => {
        const operator = context.accounts.operator.address;
        const tokenOwner = context.accounts.owner.address;
        const authorizedAmount = 1;

        const preAllowance = await context.lsp7CompatibleERC20.allowance(
          tokenOwner,
          operator
        );
        expect(preAllowance).to.equal(0);

        const tx = await context.lsp7CompatibleERC20.approve(
          operator,
          authorizedAmount
        );

        await expect(tx)
          .to.emit(context.lsp7CompatibleERC20, "AuthorizedOperator")
          .withArgs(operator, tokenOwner, authorizedAmount);

        await expect(tx)
          .to.emit(context.lsp7CompatibleERC20, "Approval")
          .withArgs(tokenOwner, operator, authorizedAmount);

        const postAllowance = await context.lsp7CompatibleERC20.allowance(
          tokenOwner,
          operator
        );
        expect(postAllowance).to.equal(authorizedAmount);
      });
    });

    describe("when the operator had an authorized amount", () => {
      describe("when the operator authorized amount is changed to another non-zero value", () => {
        it("should succeed by replacing the existing amount with the given amount", async () => {
          const operator = context.accounts.operator.address;
          const tokenOwner = context.accounts.owner.address;
          const previouslyAuthorizedAmount = "20";
          const authorizedAmount = "1";

          await context.lsp7CompatibleERC20.approve(
            operator,
            previouslyAuthorizedAmount
          );

          const preAllowance = await context.lsp7CompatibleERC20.allowance(
            tokenOwner,
            operator
          );
          expect(preAllowance).to.equal(previouslyAuthorizedAmount);

          const tx = await context.lsp7CompatibleERC20.approve(
            operator,
            authorizedAmount
          );

          await expect(tx)
            .to.emit(context.lsp7CompatibleERC20, "AuthorizedOperator")
            .withArgs(operator, tokenOwner, authorizedAmount);

          await expect(tx)
            .to.emit(context.lsp7CompatibleERC20, "Approval")
            .withArgs(tokenOwner, operator, authorizedAmount);

          const postAllowance = await context.lsp7CompatibleERC20.allowance(
            tokenOwner,
            operator
          );
          expect(postAllowance).to.equal(authorizedAmount);
        });
      });

      describe("when the operator authorized amount is changed to zero", () => {
        it("should succeed by replacing the existing amount with the given amount", async () => {
          const operator = context.accounts.operator.address;
          const tokenOwner = context.accounts.owner.address;
          const previouslyAuthorizedAmount = "20";
          const authorizedAmount = "0";

          await context.lsp7CompatibleERC20.approve(
            operator,
            previouslyAuthorizedAmount
          );

          const preAllowance = await context.lsp7CompatibleERC20.allowance(
            tokenOwner,
            operator
          );
          expect(preAllowance).to.equal(previouslyAuthorizedAmount);

          const tx = await context.lsp7CompatibleERC20.approve(
            operator,
            authorizedAmount
          );

          await expect(tx)
            .to.emit(context.lsp7CompatibleERC20, "RevokedOperator")
            .withArgs(operator, tokenOwner);

          await expect(tx)
            .to.emit(context.lsp7CompatibleERC20, "Approval")
            .withArgs(tokenOwner, operator, authorizedAmount);

          const postAllowance = await context.lsp7CompatibleERC20.allowance(
            tokenOwner,
            operator
          );
          expect(postAllowance).to.equal(authorizedAmount);
        });
      });
    });
  });

  describe("allowance", () => {
    describe("when operator has been approved", () => {
      it("should return approval amount", async () => {
        await context.lsp7CompatibleERC20.approve(
          context.accounts.operator.address,
          context.initialSupply
        );

        expect(
          await context.lsp7CompatibleERC20.allowance(
            context.accounts.owner.address,
            context.accounts.operator.address
          )
        ).to.equal(context.initialSupply);
      });
    });

    describe("when operator has not been approved", () => {
      it("should return zero", async () => {
        expect(
          await context.lsp7CompatibleERC20.allowance(
            context.accounts.owner.address,
            context.accounts.anyone.address
          )
        ).to.equal(ethers.constants.Zero);
      });
    });
  });

  describe("mint", () => {
    describe("when a token is minted", () => {
      it("should have expected events", async () => {
        const txParams = {
          to: context.accounts.owner.address,
          amount: context.initialSupply,
          data: ethers.utils.toUtf8Bytes("mint tokens for the owner"),
        };
        const operator = context.accounts.owner;

        const tx = await context.lsp7CompatibleERC20
          .connect(operator)
          .mint(txParams.to, txParams.amount, txParams.data);

        await expect(tx)
          .to.emit(
            context.lsp7CompatibleERC20,
            "Transfer(address,address,address,uint256,bool,bytes)"
          )
          .withArgs(
            operator.address,
            ethers.constants.AddressZero,
            txParams.to,
            txParams.amount,
            true,
            ethers.utils.hexlify(txParams.data)
          );

        await expect(tx)
          .to.emit(
            context.lsp7CompatibleERC20,
            "Transfer(address,address,uint256)"
          )
          .withArgs(ethers.constants.AddressZero, txParams.to, txParams.amount);
      });
    });
  });

  describe("burn", () => {
    describe("when a token is burned", () => {
      beforeEach(async () => {
        await context.lsp7CompatibleERC20.mint(
          context.accounts.owner.address,
          context.initialSupply,
          ethers.utils.toUtf8Bytes("mint tokens for owner")
        );
      });

      it("should have expected events", async () => {
        const txParams = {
          from: context.accounts.owner.address,
          amount: context.initialSupply,
          data: ethers.utils.toUtf8Bytes("burn tokens from the owner"),
        };
        const operator = context.accounts.owner;

        const tx = await context.lsp7CompatibleERC20
          .connect(operator)
          .burn(txParams.from, txParams.amount, txParams.data);

        await expect(tx)
          .to.emit(
            context.lsp7CompatibleERC20,
            "Transfer(address,address,address,uint256,bool,bytes)"
          )
          .withArgs(
            operator.address,
            txParams.from,
            ethers.constants.AddressZero,
            txParams.amount,
            false,
            ethers.utils.hexlify(txParams.data)
          );

        await expect(tx)
          .to.emit(
            context.lsp7CompatibleERC20,
            "Transfer(address,address,uint256)"
          )
          .withArgs(
            txParams.from,
            ethers.constants.AddressZero,
            txParams.amount
          );
      });
    });
  });

  describe("transfers", () => {
    type TestDeployedContracts = {
      tokenReceiverWithLSP1: TokenReceiverWithLSP1;
      tokenReceiverWithoutLSP1: TokenReceiverWithoutLSP1;
    };
    let deployedContracts: TestDeployedContracts;

    beforeEach(async () => {
      deployedContracts = {
        tokenReceiverWithLSP1: await new TokenReceiverWithLSP1__factory(
          context.accounts.owner
        ).deploy(),
        tokenReceiverWithoutLSP1: await new TokenReceiverWithoutLSP1__factory(
          context.accounts.owner
        ).deploy(),
      };
    });

    beforeEach(async () => {
      // setup so we have tokens to transfer
      await context.lsp7CompatibleERC20.mint(
        context.accounts.owner.address,
        context.initialSupply,
        ethers.utils.toUtf8Bytes("mint tokens for the owner")
      );

      // setup so we can observe allowance values during transfer tests
      await context.lsp7CompatibleERC20.approve(
        context.accounts.operator.address,
        context.initialSupply
      );
    });

    type TransferParams = {
      operator: string;
      from: string;
      to: string;
      amount: BigNumber;
    };

    const transferSuccessScenario = async (
      { operator, from, to, amount }: TransferParams,
      sendTransaction: () => Promise<ContractTransaction>,
      expectedData: string
    ) => {
      // pre-conditions
      const preBalanceOf = await context.lsp7CompatibleERC20.balanceOf(from);
      const preAllowance = await context.lsp7CompatibleERC20.allowance(
        from,
        operator
      );

      // effect
      const tx = await sendTransaction();
      await expect(tx)
        .to.emit(
          context.lsp7CompatibleERC20,
          "Transfer(address,address,address,uint256,bool,bytes)"
        )
        .withArgs(
          operator,
          from,
          to,
          amount,
          true, // Using force=true so that EOA and any contract may receive the tokens.
          expectedData
        );

      await expect(tx)
        .to.emit(
          context.lsp7CompatibleERC20,
          "Transfer(address,address,uint256)"
        )
        .withArgs(from, to, amount);

      // post-conditions
      const postBalanceOf = await context.lsp7CompatibleERC20.balanceOf(from);
      expect(postBalanceOf).to.equal(preBalanceOf.sub(amount));

      if (operator !== from) {
        const postAllowance = await context.lsp7CompatibleERC20.allowance(
          from,
          operator
        );
        expect(postAllowance).to.equal(preAllowance.sub(amount));
      }
    };

    const transferFailScenario = async (
      { from }: TransferParams,
      sendTransaction: () => Promise<ContractTransaction>,
      expectedError: ExpectedError
    ) => {
      // pre-conditions
      const preBalanceOf = await context.lsp7CompatibleERC20.balanceOf(from);

      // effect
      if (expectedError.args.length > 0) {
        await expect(sendTransaction())
          .to.be.revertedWithCustomError(
            context.lsp7CompatibleERC20,
            expectedError.error
          )
          .withArgs(...expectedError.args);
      } else {
        await expect(sendTransaction()).to.be.revertedWithCustomError(
          context.lsp7CompatibleERC20,
          expectedError.error
        );
      }

      // post-conditions
      const postBalanceOf = await context.lsp7CompatibleERC20.balanceOf(from);
      expect(postBalanceOf).to.equal(preBalanceOf);
    };

    [
      {
        transferFn: "transfer",
        sendTransaction: (
          lsp7CompatibleERC20: LSP7CompatibleERC20Tester,
          txParams: TransferParams
        ) => {
          return lsp7CompatibleERC20["transfer(address,uint256)"](
            txParams.to,
            txParams.amount
          );
        },
        expectedData: ethers.utils.hexlify(ethers.utils.toUtf8Bytes("")),
      },
      {
        transferFn: "transferFrom",
        sendTransaction: (
          lsp7CompatibleERC20: LSP7CompatibleERC20Tester,
          txParams: TransferParams
        ) => {
          return lsp7CompatibleERC20.transferFrom(
            txParams.from,
            txParams.to,
            txParams.amount
          );
        },
        expectedData: ethers.utils.hexlify(ethers.utils.toUtf8Bytes("")),
      },
    ].forEach(({ transferFn, sendTransaction, expectedData }) => {
      describe(transferFn, () => {
        describe("when sender has enough balance", () => {
          describe("when `to` is an EOA", () => {
            it("should allow transfering the tokenId", async () => {
              const txParams = {
                operator: context.accounts.owner.address,
                from: context.accounts.owner.address,
                to: context.accounts.tokenReceiver.address,
                amount: context.initialSupply,
              };

              await transferSuccessScenario(
                txParams,
                () => sendTransaction(context.lsp7CompatibleERC20, txParams),
                expectedData
              );
            });
          });

          describe("when `to` is a contract", () => {
            describe("when receiving contract supports LSP1", () => {
              it("should allow transfering the tokenId", async () => {
                const txParams = {
                  operator: context.accounts.owner.address,
                  from: context.accounts.owner.address,
                  to: deployedContracts.tokenReceiverWithLSP1.address,
                  amount: context.initialSupply,
                };

                await transferSuccessScenario(
                  txParams,
                  () => sendTransaction(context.lsp7CompatibleERC20, txParams),
                  expectedData
                );
              });
            });

            describe("when receiving contract does not support LSP1", () => {
              it("should allow transfering the tokenId", async () => {
                const txParams = {
                  operator: context.accounts.owner.address,
                  from: context.accounts.owner.address,
                  to: deployedContracts.tokenReceiverWithoutLSP1.address,
                  amount: context.initialSupply,
                };

                await transferSuccessScenario(
                  txParams,
                  () => sendTransaction(context.lsp7CompatibleERC20, txParams),
                  expectedData
                );
              });
            });
          });
        });

        describe("when sender does not have enough balance", () => {
          it("should revert", async () => {
            const txParams = {
              operator: context.accounts.owner.address,
              from: context.accounts.owner.address,
              to: deployedContracts.tokenReceiverWithoutLSP1.address,
              amount: context.initialSupply.add(1),
            };
            const expectedError = "LSP7AmountExceedsBalance";

            await transferFailScenario(
              txParams,
              () => sendTransaction(context.lsp7CompatibleERC20, txParams),
              {
                error: expectedError,
                args: [
                  context.initialSupply.toHexString(),
                  txParams.from,
                  txParams.amount.toHexString(),
                ],
              }
            );
          });
        });
      });
    });
  });
};

export type LSP7InitializeTestContext = {
  lsp7CompatibleERC20: LSP7CompatibleERC20;
  deployParams: LSP7CompatibleERC20DeployParams;
  initializeTransaction: TransactionResponse;
};

export const shouldInitializeLikeLSP7CompatibleERC20 = (
  buildContext: () => Promise<LSP7InitializeTestContext>
) => {
  let context: LSP7InitializeTestContext;

  beforeEach(async () => {
    context = await buildContext();
  });

  describe("when the contract was initialized", () => {
    it("should have registered its ERC165 interface", async () => {
      expect(
        await context.lsp7CompatibleERC20.supportsInterface(
          INTERFACE_IDS.LSP7DigitalAsset
        )
      );
    });

    it("should have set expected entries with ERC725Y.setData", async () => {
      await expect(context.initializeTransaction)
        .to.emit(context.lsp7CompatibleERC20, "DataChanged")
        .withArgs(
          SupportedStandards.LSP4DigitalAsset.key,
          SupportedStandards.LSP4DigitalAsset.value
        );
      expect(
        await context.lsp7CompatibleERC20["getData(bytes32)"](
          SupportedStandards.LSP4DigitalAsset.key
        )
      ).to.equal(SupportedStandards.LSP4DigitalAsset.value);

      const nameKey = ERC725YKeys.LSP4.LSP4TokenName;
      const expectedNameValue = ethers.utils.hexlify(
        ethers.utils.toUtf8Bytes(context.deployParams.name)
      );
      await expect(context.initializeTransaction)
        .to.emit(context.lsp7CompatibleERC20, "DataChanged")
        .withArgs(nameKey, expectedNameValue);
      expect(
        await context.lsp7CompatibleERC20["getData(bytes32)"](nameKey)
      ).to.equal(expectedNameValue);

      const symbolKey = ERC725YKeys.LSP4.LSP4TokenSymbol;
      const expectedSymbolValue = ethers.utils.hexlify(
        ethers.utils.toUtf8Bytes(context.deployParams.symbol)
      );
      await expect(context.initializeTransaction)
        .to.emit(context.lsp7CompatibleERC20, "DataChanged")
        .withArgs(symbolKey, expectedSymbolValue);
      expect(
        await context.lsp7CompatibleERC20["getData(bytes32)"](symbolKey)
      ).to.equal(expectedSymbolValue);
    });
  });
};
