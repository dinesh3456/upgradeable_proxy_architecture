# Step-by-Step Upgrade Guide for Staking Contract

This guide explains how to deploy, upgrade, and manage the upgradeable staking contract using OpenZeppelin's UUPS proxy pattern.

## Prerequisites

- Node.js and npm installed
- Hardhat development environment set up
- OpenZeppelin Contracts Upgradeable library installed

```bash
npm install --save-dev @openzeppelin/contracts-upgradeable @openzeppelin/hardhat-upgrades
```

## 1. Initial Deployment

### 1.1 Configure Hardhat

Ensure your `hardhat.config.js` includes the OpenZeppelin upgrades plugin:

```javascript
require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");

module.exports = {
  solidity: "0.8.20",
  networks: {
    // Your network configurations
  },
};
```

### 1.2 Deploy the Initial Version

Run the deployment script to deploy the proxy and implementation:

```bash
SCRIPT_TYPE=deploy npx hardhat run scripts/deploy.js --network <your-network>
```

This will:

- Deploy the mock tokens (for test environments)
- Deploy the StakingUpgradeable implementation contract
- Deploy the UUPS proxy
- Initialize the proxy with the provided parameters

### 1.3 Verify Deployment

After deployment, verify that the proxy is initialized correctly:

```bash
npx hardhat console --network <your-network>
> const StakingUpgradeable = await ethers.getContractFactory("StakingUpgradeable")
> const stakingContract = await StakingUpgradeable.attach("<proxy-address>")
> await stakingContract.owner()  // Should return the owner address
> await stakingContract.stakingToken()  // Should return the staking token address
> await stakingContract.rewardToken()  // Should return the reward token address
```

## 2. Preparing for Upgrade

### 2.1 Develop the Upgraded Contract

Create the upgraded contract (`StakingUpgradeableV2.sol`) with the following key considerations:

1. **Storage Layout**: Maintain the same storage layout. Never modify, remove, or reorder existing state variables.
2. **New Variables**: Add new state variables only at the end of the existing state variable declarations.
3. **Initializer Function**: Create a new initializer function (e.g., `initializeV2`) with the `reinitializer` modifier.
4. **Version Management**: Use the reinitializer with an incremented version number (e.g., `reinitializer(2)`).

### 2.2 Test the Upgrade Process

Before upgrading in production, test the upgrade process in a development environment:

```bash
npx hardhat test
```

Ensure all tests pass, including:

- Storage state preservation after upgrade
- Proper initialization of new features
- Authorization controls for upgrade function

## 3. Performing the Upgrade

### 3.1 Deploy the New Implementation and Upgrade

Set the proxy address as an environment variable and run the upgrade script:

```bash
SCRIPT_TYPE=upgrade PROXY_ADDRESS=<your-proxy-address> npx hardhat run scripts/deploy.js --network <your-network>
```

This will:

- Deploy the StakingUpgradeableV2 implementation contract
- Upgrade the proxy to point to the new implementation
- Call initializeV2 to set up the new state variables

### 3.2 Verify the Upgrade

Confirm that the upgrade was successful and new functionality is available:

```bash
npx hardhat console --network <your-network>
> const StakingUpgradeableV2 = await ethers.getContractFactory("StakingUpgradeableV2")
> const upgradedContract = await StakingUpgradeableV2.attach("<proxy-address>")
> await upgradedContract.lockDuration()  // Should return the configured lock duration
> await upgradedContract.earlyWithdrawalFee()  // Should return the configured fee
```

### 3.3 Verify State Preservation

Confirm that user balances and staking information are preserved:

```bash
> await upgradedContract.totalSupply()  // Should remain unchanged
> await upgradedContract.balances("<user-address>")  // Should remain unchanged
```

## 4. Security Considerations

### 4.1 Access Control

The UUPS upgrade mechanism relies on the `_authorizeUpgrade` function to control who can upgrade the contract:

```solidity
function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
    // Additional authorization logic could be added here
}
```

Consider implementing additional authorization logic, such as:

- Timelock mechanisms
- Multi-signature requirements
- DAO governance voting

### 4.2 Implementation Contract Security

After upgrading, it's advisable to:

1. Verify the implementation contract cannot be initialized directly
2. Ensure implementation contracts cannot receive funds accidentally

## 5. Future Upgrades

For future upgrades beyond V2, follow the same pattern:

1. Create a new contract (e.g., `StakingUpgradeableV3.sol`)
2. Preserve all state variables in the same order
3. Add new state variables at the end
4. Create a new initializer (e.g., `initializeV3`) with `reinitializer(3)`
5. Test thoroughly before upgrading
6. Perform the upgrade using the same UUPS pattern

## 6. Troubleshooting

### 6.1 Common Issues

- **Storage Collisions**: Ensure state variables are defined in the same order with the same types
- **Initialization Issues**: Verify that each version uses the correct initializer version number
- **Authorization Failures**: Confirm that the upgrading account has owner permissions

### 6.2 Recovery Options

If issues occur during an upgrade:

1. Deploy a fixed implementation contract
2. Retry the upgrade with the corrected implementation
3. In emergency situations, consider using a lower-level approach to address storage layout issues

## 7. Documentation and Management

Keep a detailed record of:

- All implementation addresses
- Upgrade dates and descriptions
- Storage layout changes
- Initialization parameters for each version

This documentation is crucial for long-term management of upgradeable contracts.
