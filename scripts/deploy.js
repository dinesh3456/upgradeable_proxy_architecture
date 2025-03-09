const { ethers, upgrades } = require("hardhat");

async function main() {
  console.log("Deploying StakingUpgradeable contract...");

  // Get deployer account
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  // For a real deployment, you would use real token addresses
  // This is just a placeholder for demonstration
  console.log("Deploying mock tokens for testing...");
  const MockERC20 = await ethers.getContractFactory("MockERC20");

  const stakingToken = await MockERC20.deploy("Stake Token", "STK", 18);
  await stakingToken.deployed();
  console.log("Staking token deployed to:", stakingToken.address);

  const rewardToken = await MockERC20.deploy("Reward Token", "RWD", 18);
  await rewardToken.deployed();
  console.log("Reward token deployed to:", rewardToken.address);

  // Deploy implementation and proxy
  console.log("Deploying StakingUpgradeable implementation and proxy...");
  const StakingUpgradeable = await ethers.getContractFactory(
    "StakingUpgradeable"
  );

  // Initial reward rate (0.1 tokens per second)
  const initialRewardRate = ethers.utils.parseEther("0.1");

  // Deploy as UUPS proxy
  const stakingProxy = await upgrades.deployProxy(
    StakingUpgradeable,
    [
      stakingToken.address,
      rewardToken.address,
      initialRewardRate,
      deployer.address,
    ],
    {
      kind: "uups",
      initializer: "initialize",
    }
  );

  await stakingProxy.deployed();

  console.log("StakingUpgradeable proxy deployed to:", stakingProxy.address);

  // Get implementation address
  const implementationAddress = await upgrades.erc1967.getImplementationAddress(
    stakingProxy.address
  );
  console.log(
    "StakingUpgradeable implementation deployed to:",
    implementationAddress
  );

  console.log("Deployment complete!");
}

async function upgrade() {
  console.log("Upgrading StakingUpgradeable contract to V2...");

  // Get deployer account
  const [deployer] = await ethers.getSigners();
  console.log("Upgrading contracts with the account:", deployer.address);

  // The address of the previously deployed proxy
  const proxyAddress = process.env.PROXY_ADDRESS;
  if (!proxyAddress) {
    throw new Error("Please set PROXY_ADDRESS environment variable");
  }

  console.log(`Upgrading proxy at ${proxyAddress}`);

  // Deploy new implementation
  const StakingUpgradeableV2 = await ethers.getContractFactory(
    "StakingUpgradeableV2"
  );

  // Upgrade proxy to point to new implementation (using UUPS pattern)
  const upgradedProxy = await upgrades.upgradeProxy(
    proxyAddress,
    StakingUpgradeableV2
  );
  console.log("Proxy upgraded!");

  // Get new implementation address
  const newImplementationAddress =
    await upgrades.erc1967.getImplementationAddress(upgradedProxy.address);
  console.log("New implementation deployed to:", newImplementationAddress);

  // Initialize V2 functionality
  console.log("Initializing V2 functionality...");
  const LOCK_DURATION = 7 * 24 * 60 * 60; // 7 days in seconds
  const EARLY_WITHDRAWAL_FEE = 500; // 5%
  const feeCollector = deployer.address; // Using deployer as fee collector for simplicity

  await upgradedProxy.initializeV2(
    LOCK_DURATION,
    EARLY_WITHDRAWAL_FEE,
    feeCollector
  );

  console.log("StakingUpgradeableV2 initialized successfully!");
  console.log("Upgrade complete!");
}

// Execute the appropriate function based on command-line args
async function executeScript() {
  const scriptType = process.env.SCRIPT_TYPE || "deploy";

  if (scriptType === "deploy") {
    await main();
  } else if (scriptType === "upgrade") {
    await upgrade();
  } else {
    console.error("Unknown SCRIPT_TYPE. Use 'deploy' or 'upgrade'");
    process.exit(1);
  }
}

// Execute the script
executeScript()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
