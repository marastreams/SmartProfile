import { ethers } from "hardhat";
import { expect } from "chai";
import {
  ILSP1UniversalReceiver,
  LSP0ERC725Account,
  UniversalProfileInit__factory,
  UniversalProfile__factory,
  UniversalReceiverTester__factory,
} from "../types";
import { deployProxy } from "./utils/fixtures";

import {
  LSP1TestContext,
  shouldBehaveLikeLSP1,
} from "./LSP1UniversalReceiver/LSP1UniversalReceiver.behaviour";

import {
  LSP14TestContext,
  shouldBehaveLikeLSP14,
} from "./LSP14Ownable2Step/LSP14Ownable2Step.behaviour";

import {
  LSP3TestContext,
  shouldInitializeLikeLSP3,
  shouldBehaveLikeLSP3,
} from "./UniversalProfile.behaviour";
import { provider } from "./utils/helpers";

describe("UniversalProfile", () => {
  describe("when using UniversalProfile contract with constructor", () => {
    const buildLSP3TestContext = async (
      initialFunding?: number
    ): Promise<LSP3TestContext> => {
      const accounts = await ethers.getSigners();
      const deployParams = {
        owner: accounts[0],
        initialFunding,
      };
      const universalProfile = await new UniversalProfile__factory(
        accounts[0]
      ).deploy(deployParams.owner.address, {
        value: initialFunding,
      });

      return { accounts, universalProfile, deployParams };
    };

    const buildLSP1TestContext = async (): Promise<LSP1TestContext> => {
      const accounts = await ethers.getSigners();

      const lsp1Implementation = await new UniversalProfile__factory(
        accounts[0]
      ).deploy(accounts[0].address);

      const lsp1Checker = await new UniversalReceiverTester__factory(
        accounts[0]
      ).deploy();

      return { accounts, lsp1Implementation, lsp1Checker };
    };

    const buildLSP14TestContext = async (): Promise<LSP14TestContext> => {
      const accounts = await ethers.getSigners();
      const deployParams = {
        owner: accounts[0],
      };
      const contract = await new UniversalProfile__factory(accounts[0]).deploy(
        deployParams.owner.address
      );

      const onlyOwnerRevertString = "Ownable: caller is not the owner";

      return { accounts, contract, deployParams, onlyOwnerRevertString };
    };

    [
      { initialFunding: undefined },
      { initialFunding: 0 },
      { initialFunding: 5 },
    ].forEach((testCase) => {
      describe("when deploying the contract with or without value", () => {
        let context: LSP3TestContext;

        beforeEach(async () => {
          context = await buildLSP3TestContext(testCase.initialFunding);
        });

        it(`should have deployed with the correct funding amount (${testCase.initialFunding})`, async () => {
          const balance = await provider.getBalance(
            context.universalProfile.address
          );
          expect(balance).to.equal(testCase.initialFunding || 0);
        });
      });
    });

    describe("when deploying the contract", () => {
      let context: LSP3TestContext;

      beforeEach(async () => {
        context = await buildLSP3TestContext();
      });

      describe("when initializing the contract", () => {
        shouldInitializeLikeLSP3(async () => {
          return context;
        });
      });
    });

    describe("when testing deployed contract", () => {
      shouldBehaveLikeLSP3(buildLSP3TestContext);
      shouldBehaveLikeLSP1(buildLSP1TestContext);
      shouldBehaveLikeLSP14(buildLSP14TestContext);
    });
  });

  describe("when using UniversalProfile contract with proxy", () => {
    const buildLSP3TestContext = async (
      initialFunding?: number
    ): Promise<LSP3TestContext> => {
      const accounts = await ethers.getSigners();
      const deployParams = {
        owner: accounts[0],
        initialFunding,
      };
      const universalProfileInit = await new UniversalProfileInit__factory(
        accounts[0]
      ).deploy();

      const universalProfileProxy = await deployProxy(
        universalProfileInit.address,
        accounts[0]
      );

      const universalProfile = universalProfileInit.attach(
        universalProfileProxy
      );

      return { accounts, universalProfile, deployParams };
    };

    const initializeProxy = async (context: LSP3TestContext) => {
      return context.universalProfile["initialize(address)"](
        context.deployParams.owner.address,
        { value: context.deployParams.initialFunding }
      );
    };

    const buildLSP1TestContext = async (): Promise<LSP1TestContext> => {
      const accounts = await ethers.getSigners();

      const universalProfileInit = await new UniversalProfileInit__factory(
        accounts[0]
      ).deploy();
      const universalProfileProxy = await deployProxy(
        universalProfileInit.address,
        accounts[0]
      );

      const lsp1Implementation = universalProfileInit.attach(
        universalProfileProxy
      );

      await lsp1Implementation.initialize(accounts[0].address);

      const lsp1Checker = await new UniversalReceiverTester__factory(
        accounts[0]
      ).deploy();

      return { accounts, lsp1Implementation, lsp1Checker };
    };

    const buildLSP14TestContext = async (): Promise<LSP14TestContext> => {
      const accounts = await ethers.getSigners();
      const deployParams = { owner: accounts[0] };

      const universalProfileInit = await new UniversalProfileInit__factory(
        accounts[0]
      ).deploy();

      const universalProfileProxy = await deployProxy(
        universalProfileInit.address,
        accounts[0]
      );

      const universalProfile = universalProfileInit.attach(
        universalProfileProxy
      );

      const onlyOwnerRevertString = "Ownable: caller is not the owner";

      return {
        accounts,
        contract: universalProfile,
        deployParams,
        onlyOwnerRevertString,
      };
    };

    describe("when deploying the base implementation contract", () => {
      it("prevent any address from calling the initialize(...) function on the implementation", async () => {
        const accounts = await ethers.getSigners();

        const universalProfileInit = await new UniversalProfileInit__factory(
          accounts[0]
        ).deploy();

        const randomCaller = accounts[1];

        await expect(
          universalProfileInit.initialize(randomCaller.address)
        ).to.be.revertedWith("Initializable: contract is already initialized");
      });
    });

    [
      { initialFunding: undefined },
      { initialFunding: 0 },
      { initialFunding: 5 },
    ].forEach((testCase) => {
      describe("when deploying the proxy contract", () => {
        let context: LSP3TestContext;

        beforeEach(async () => {
          context = await buildLSP3TestContext(testCase.initialFunding);
        });

        describe("when initializing the proxy contract with or without value", () => {
          it(`should have deployed with the correct funding amount (${testCase.initialFunding})`, async () => {
            const balance = await provider.getBalance(
              context.universalProfile.address
            );
            expect(balance).to.equal(testCase.initialFunding || 0);
          });

          shouldInitializeLikeLSP3(async () => {
            await initializeProxy(context);
            return context;
          });
        });

        describe("when calling `initialize(...)` more than once", () => {
          it("should revert", async () => {
            await initializeProxy(context);

            await expect(initializeProxy(context)).to.be.revertedWith(
              "Initializable: contract is already initialized"
            );
          });
        });
      });
    });

    describe("when testing deployed contract", () => {
      shouldBehaveLikeLSP3(async () => {
        let context = await buildLSP3TestContext();
        await initializeProxy(context);
        return context;
      });

      shouldBehaveLikeLSP1(async () => {
        let lsp3Context = await buildLSP3TestContext();
        await initializeProxy(lsp3Context);

        let lsp1Context = await buildLSP1TestContext();
        return lsp1Context;
      });

      shouldBehaveLikeLSP14(async () => {
        let claimOwnershipContext = await buildLSP14TestContext();

        await initializeProxy({
          accounts: claimOwnershipContext.accounts,
          universalProfile: claimOwnershipContext.contract as LSP0ERC725Account,
          deployParams: claimOwnershipContext.deployParams,
        });

        return claimOwnershipContext;
      });
    });
  });
});
