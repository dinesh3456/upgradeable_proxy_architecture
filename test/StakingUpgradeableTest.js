const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("StakingUpgradeable", function () {
  // Helper function to convert to and from wei values
  function parseEther(value) {
    return ethers.parseUnits(value.toString(), "ether");
  }

  const initialRewardRate = parseEther("0.1"); // 0.1 tokens per second
  const ONE_DAY = 86400; // 1 day in seconds
  const LOCK_DURATION = ONE_DAY * 7; // 7 days
  const EARLY_WITHDRAWAL_FEE = 500; // 5%

  async function deployContractsFixture() {
    // Get signers
    const [owner, user1, user2, feeCollector] = await ethers.getSigners();

    // Deploy mock ERC20 tokens for staking and rewards
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    const stakingToken = await MockERC20Factory.deploy(
      "Stake Token",
      "STK",
      18
    );
    const rewardToken = await MockERC20Factory.deploy(
      "Reward Token",
      "RWD",
      18
    );

    // Deploy StakingUpgradeable using OpenZeppelin's deployProxy
    const StakingUpgradeableFactory = await ethers.getContractFactory(
      "StakingUpgradeable"
    );
    const stakingContract = await hre.upgrades.deployProxy(
      StakingUpgradeableFactory,
      [
        await stakingToken.getAddress(),
        await rewardToken.getAddress(),
        initialRewardRate,
        await owner.getAddress(),
      ],
      { kind: "uups", initializer: "initialize" }
    );

    // Mint tokens to users for testing
    await stakingToken.mint(await user1.getAddress(), parseEther("1000"));
    await stakingToken.mint(await user2.getAddress(), parseEther("1000"));

    // Mint reward tokens to contract
    await rewardToken.mint(
      await stakingContract.getAddress(),
      parseEther("10000")
    );

    // Approve tokens for staking
    await stakingToken
      .connect(user1)
      .approve(await stakingContract.getAddress(), parseEther("1000"));
    await stakingToken
      .connect(user2)
      .approve(await stakingContract.getAddress(), parseEther("1000"));

    return {
      stakingContract,
      stakingToken,
      rewardToken,
      owner,
      user1,
      user2,
      feeCollector,
    };
  }

  describe("Initial contract deployment", function () {
    it("Should initialize with correct values", async function () {
      const { stakingContract, stakingToken, rewardToken, owner } =
        await loadFixture(deployContractsFixture);

      expect(await stakingContract.stakingToken()).to.equal(
        await stakingToken.getAddress()
      );
      expect(await stakingContract.rewardToken()).to.equal(
        await rewardToken.getAddress()
      );
      expect(await stakingContract.rewardRate()).to.equal(initialRewardRate);
      expect(await stakingContract.owner()).to.equal(await owner.getAddress());
    });

    it("Should allow users to stake tokens", async function () {
      const { stakingContract, user1 } = await loadFixture(
        deployContractsFixture
      );

      const stakeAmount = parseEther("100");
      await stakingContract.connect(user1).stake(stakeAmount);

      expect(await stakingContract.balances(await user1.getAddress())).to.equal(
        stakeAmount
      );
      expect(await stakingContract.totalSupply()).to.equal(stakeAmount);
    });

    it("Should allow users to withdraw staked tokens", async function () {
      const { stakingContract, user1 } = await loadFixture(
        deployContractsFixture
      );

      const stakeAmount = parseEther("100");
      await stakingContract.connect(user1).stake(stakeAmount);

      await stakingContract.connect(user1).withdraw(stakeAmount);

      expect(await stakingContract.balances(await user1.getAddress())).to.equal(
        0
      );
      expect(await stakingContract.totalSupply()).to.equal(0);
    });

    it("Should accrue rewards for stakers", async function () {
      const { stakingContract, rewardToken, user1 } = await loadFixture(
        deployContractsFixture
      );

      const stakeAmount = parseEther("100");
      await stakingContract.connect(user1).stake(stakeAmount);

      // Fast forward time (simulate 1 day passing)
      await ethers.provider.send("evm_increaseTime", [ONE_DAY]);
      await ethers.provider.send("evm_mine");

      // Check earned rewards
      const earnedReward = await stakingContract.earned(
        await user1.getAddress()
      );

      // Verify reward is in the expected range (allowing for timing differences)
      expect(earnedReward).to.be.gt(0);

      const rewardBefore = await rewardToken.balanceOf(
        await user1.getAddress()
      );

      // Claim rewards
      await stakingContract.connect(user1).getReward();

      // Check user received rewards
      const rewardAfter = await rewardToken.balanceOf(await user1.getAddress());
      expect(rewardAfter).to.be.gt(rewardBefore);
      expect(rewardAfter - rewardBefore).to.equal(earnedReward);
    });
  });

  describe("Contract upgrade", function () {
    it("Should upgrade to V2 and preserve storage", async function () {
      const { stakingContract, user1, feeCollector } = await loadFixture(
        deployContractsFixture
      );

      // Initial setup - stake tokens with V1
      const stakeAmount = parseEther("100");
      await stakingContract.connect(user1).stake(stakeAmount);

      // Prepare V2 implementation
      const StakingUpgradeableV2Factory = await ethers.getContractFactory(
        "StakingUpgradeableV2"
      );

      // Upgrade to V2
      const upgradedContractAddress = await stakingContract.getAddress();
      const upgradedContract = await hre.upgrades.upgradeProxy(
        upgradedContractAddress,
        StakingUpgradeableV2Factory,
        { kind: "uups" }
      );

      // Verify storage preserved
      expect(
        await upgradedContract.balances(await user1.getAddress())
      ).to.equal(stakeAmount);
      expect(await upgradedContract.totalSupply()).to.equal(stakeAmount);

      // Initialize V2 functionality
      await upgradedContract.initializeV2(
        LOCK_DURATION,
        EARLY_WITHDRAWAL_FEE,
        await feeCollector.getAddress()
      );

      // Verify V2 state variables are initialized correctly
      expect(await upgradedContract.lockDuration()).to.equal(LOCK_DURATION);
      expect(await upgradedContract.earlyWithdrawalFee()).to.equal(
        EARLY_WITHDRAWAL_FEE
      );
      expect(await upgradedContract.feeCollector()).to.equal(
        await feeCollector.getAddress()
      );
    });

    it("Should apply early withdrawal fee in V2", async function () {
      const { stakingContract, stakingToken, user1, feeCollector } =
        await loadFixture(deployContractsFixture);

      // Upgrade to V2 first
      const StakingUpgradeableV2Factory = await ethers.getContractFactory(
        "StakingUpgradeableV2"
      );
      const upgradedContract = await hre.upgrades.upgradeProxy(
        await stakingContract.getAddress(),
        StakingUpgradeableV2Factory,
        { kind: "uups" }
      );

      // Initialize V2 functionality
      await upgradedContract.initializeV2(
        LOCK_DURATION,
        EARLY_WITHDRAWAL_FEE,
        await feeCollector.getAddress()
      );

      // User stakes tokens in V2
      const stakeAmount = parseEther("100");
      await upgradedContract.connect(user1).stake(stakeAmount);

      // Early withdrawal should incur a fee
      const withdrawAmount = parseEther("50");
      await upgradedContract.connect(user1).withdraw(withdrawAmount);

      // Calculate expected fee
      const feeAmount =
        (withdrawAmount * BigInt(EARLY_WITHDRAWAL_FEE)) / BigInt(10000);
      const amountAfterFee = withdrawAmount - feeAmount;

      // Check fee collector received the fee
      const feeCollectorBalance = await stakingToken.balanceOf(
        await feeCollector.getAddress()
      );
      expect(feeCollectorBalance).to.equal(feeAmount);

      // Check user received amount minus fee
      const userStakingTokenBalance = await stakingToken.balanceOf(
        await user1.getAddress()
      );
      expect(userStakingTokenBalance).to.equal(
        parseEther("1000") - stakeAmount + amountAfterFee
      );
    });

    it("Should allow using new batch stake feature in V2", async function () {
      const {
        stakingContract,
        stakingToken,
        owner,
        user1,
        user2,
        feeCollector,
      } = await loadFixture(deployContractsFixture);

      // Upgrade to V2
      const StakingUpgradeableV2Factory = await ethers.getContractFactory(
        "StakingUpgradeableV2"
      );
      const upgradedContract = await hre.upgrades.upgradeProxy(
        await stakingContract.getAddress(),
        StakingUpgradeableV2Factory,
        { kind: "uups" }
      );

      // Initialize V2 functionality
      await upgradedContract.initializeV2(
        LOCK_DURATION,
        EARLY_WITHDRAWAL_FEE,
        await feeCollector.getAddress()
      );

      // Prepare for batch stake
      const recipients = [await user1.getAddress(), await user2.getAddress()];
      const amounts = [parseEther("50"), parseEther("30")];

      // Owner needs tokens and approval for batch stake
      await stakingToken.mint(await owner.getAddress(), parseEther("100"));
      await stakingToken
        .connect(owner)
        .approve(await upgradedContract.getAddress(), parseEther("100"));

      // Execute batch stake
      await upgradedContract.batchStake(recipients, amounts);

      // Verify balances updated correctly
      expect(
        await upgradedContract.balances(await user1.getAddress())
      ).to.equal(amounts[0]);
      expect(
        await upgradedContract.balances(await user2.getAddress())
      ).to.equal(amounts[1]);
      expect(await upgradedContract.totalSupply()).to.equal(
        amounts[0] + amounts[1]
      );
    });

    it("Should not allow non-owners to upgrade the contract", async function () {
      const { stakingContract, user1 } = await loadFixture(
        deployContractsFixture
      );

      // Try to upgrade as non-owner
      const StakingUpgradeableV2Factory = await ethers.getContractFactory(
        "StakingUpgradeableV2",
        user1
      );

      await expect(
        hre.upgrades.upgradeProxy(
          await stakingContract.getAddress(),
          StakingUpgradeableV2Factory,
          { kind: "uups" }
        )
      ).to.be.reverted;
    });
  });
});
