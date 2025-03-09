// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title StakingUpgradeableV2
 * @dev An upgraded version of the staking contract with additional features.
 * This contract maintains the same storage layout as the previous version.
 */
contract StakingUpgradeableV2 is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    // Original state variables - DO NOT CHANGE THE ORDER
    ERC20Upgradeable public stakingToken;
    ERC20Upgradeable public rewardToken;

    uint256 public rewardRate;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;

    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    uint256 public totalSupply;
    mapping(address => uint256) public balances;

    // New state variables for V2 - add them AFTER all original variables
    uint256 public lockDuration;
    mapping(address => uint256) public stakingTime;
    uint256 public earlyWithdrawalFee; // In basis points (e.g., 500 = 5%)
    address public feeCollector;

    // Events from V1
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardRateUpdated(uint256 newRate);

    // New events for V2
    event LockDurationUpdated(uint256 newDuration);
    event EarlyWithdrawalFeeUpdated(uint256 newFee);
    event FeeCollectorUpdated(address newCollector);
    event EarlyWithdrawalFeeCollected(address indexed user, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initializes the contract with the necessary parameters.
     * This replaces the constructor for upgradeable contracts.
     * Even though this exact function already exists in V1, it must be included here as well
     * for the upgrade to be considered safe.
     */
    function initialize(
        address _stakingToken,
        address _rewardToken,
        uint256 _rewardRate,
        address initialOwner
    ) public initializer {
        __Ownable_init(initialOwner);
        __ReentrancyGuard_init();
        __Pausable_init();
        __UUPSUpgradeable_init();

        require(
            _stakingToken != address(0),
            "Staking token cannot be zero address"
        );
        require(
            _rewardToken != address(0),
            "Reward token cannot be zero address"
        );

        stakingToken = ERC20Upgradeable(_stakingToken);
        rewardToken = ERC20Upgradeable(_rewardToken);
        rewardRate = _rewardRate;
        lastUpdateTime = block.timestamp;
    }

    /**
     * @dev Initializes the V2 contract with new parameters.
     * This can be called once after the upgrade.
     */
    function initializeV2(
        uint256 _lockDuration,
        uint256 _earlyWithdrawalFee,
        address _feeCollector
    ) external reinitializer(2) {
        require(_earlyWithdrawalFee <= 1000, "Fee cannot exceed 10%");
        require(
            _feeCollector != address(0),
            "Fee collector cannot be zero address"
        );

        lockDuration = _lockDuration;
        earlyWithdrawalFee = _earlyWithdrawalFee;
        feeCollector = _feeCollector;
    }

    /**
     * @dev Updates the accumulated rewards for all token holders.
     */
    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = block.timestamp;

        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    /**
     * @dev Calculates the reward per token.
     */
    function rewardPerToken() public view returns (uint256) {
        if (totalSupply == 0) {
            return rewardPerTokenStored;
        }

        return
            rewardPerTokenStored +
            (((block.timestamp - lastUpdateTime) * rewardRate * 1e18) /
                totalSupply);
    }

    /**
     * @dev Calculates the earned rewards for an account.
     */
    function earned(address account) public view returns (uint256) {
        return
            ((balances[account] *
                (rewardPerToken() - userRewardPerTokenPaid[account])) / 1e18) +
            rewards[account];
    }

    /**
     * @dev Allows a user to stake tokens.
     */
    function stake(
        uint256 amount
    ) external nonReentrant whenNotPaused updateReward(msg.sender) {
        require(amount > 0, "Cannot stake 0");

        totalSupply += amount;
        balances[msg.sender] += amount;
        stakingTime[msg.sender] = block.timestamp; // Record staking time for lock period

        stakingToken.transferFrom(msg.sender, address(this), amount);

        emit Staked(msg.sender, amount);
    }

    /**
     * @dev Allows a user to withdraw their staked tokens, with potential early withdrawal fee.
     */
    function withdraw(
        uint256 amount
    ) external nonReentrant updateReward(msg.sender) {
        require(amount > 0, "Cannot withdraw 0");
        require(balances[msg.sender] >= amount, "Insufficient staked amount");

        totalSupply -= amount;
        balances[msg.sender] -= amount;

        // Check if withdrawal is subject to early withdrawal fee
        if (
            block.timestamp < stakingTime[msg.sender] + lockDuration &&
            earlyWithdrawalFee > 0
        ) {
            uint256 feeAmount = (amount * earlyWithdrawalFee) / 10000;
            uint256 amountAfterFee = amount - feeAmount;

            // Transfer fee to fee collector
            if (feeAmount > 0) {
                stakingToken.transfer(feeCollector, feeAmount);
                emit EarlyWithdrawalFeeCollected(msg.sender, feeAmount);
            }

            // Transfer remaining amount to user
            stakingToken.transfer(msg.sender, amountAfterFee);
        } else {
            // No fee, transfer full amount
            stakingToken.transfer(msg.sender, amount);
        }

        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @dev Allows a user to claim their earned rewards.
     */
    function getReward() external nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];

        if (reward > 0) {
            rewards[msg.sender] = 0;
            rewardToken.transfer(msg.sender, reward);

            emit RewardPaid(msg.sender, reward);
        }
    }

    /**
     * @dev Calculates time remaining in lock period for a user.
     */
    function lockTimeRemaining(address user) external view returns (uint256) {
        uint256 endTime = stakingTime[user] + lockDuration;
        if (block.timestamp >= endTime) {
            return 0;
        }
        return endTime - block.timestamp;
    }

    /**
     * @dev Updates the reward rate. Only callable by the owner.
     */
    function setRewardRate(
        uint256 _rewardRate
    ) external onlyOwner updateReward(address(0)) {
        rewardRate = _rewardRate;
        emit RewardRateUpdated(_rewardRate);
    }

    /**
     * @dev Updates the lock duration. Only callable by the owner.
     */
    function setLockDuration(uint256 _lockDuration) external onlyOwner {
        lockDuration = _lockDuration;
        emit LockDurationUpdated(_lockDuration);
    }

    /**
     * @dev Updates the early withdrawal fee. Only callable by the owner.
     */
    function setEarlyWithdrawalFee(
        uint256 _earlyWithdrawalFee
    ) external onlyOwner {
        require(_earlyWithdrawalFee <= 1000, "Fee cannot exceed 10%");
        earlyWithdrawalFee = _earlyWithdrawalFee;
        emit EarlyWithdrawalFeeUpdated(_earlyWithdrawalFee);
    }

    /**
     * @dev Updates the fee collector address. Only callable by the owner.
     */
    function setFeeCollector(address _feeCollector) external onlyOwner {
        require(
            _feeCollector != address(0),
            "Fee collector cannot be zero address"
        );
        feeCollector = _feeCollector;
        emit FeeCollectorUpdated(_feeCollector);
    }

    /**
     * @dev Batch stake to multiple addresses (for airdrops or team allocations).
     */
    function batchStake(
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external onlyOwner nonReentrant whenNotPaused {
        require(recipients.length == amounts.length, "Arrays length mismatch");
        require(recipients.length > 0, "Empty arrays");

        uint256 totalAmount = 0;

        for (uint256 i = 0; i < recipients.length; i++) {
            require(amounts[i] > 0, "Cannot stake 0");
            require(
                recipients[i] != address(0),
                "Cannot stake to zero address"
            );

            totalAmount += amounts[i];

            // Update state for each recipient
            balances[recipients[i]] += amounts[i];
            stakingTime[recipients[i]] = block.timestamp;

            // Update rewards for each recipient
            _updateRewardForAccount(recipients[i]);

            emit Staked(recipients[i], amounts[i]);
        }

        // Update total supply
        totalSupply += totalAmount;

        // Transfer tokens from sender to contract
        stakingToken.transferFrom(msg.sender, address(this), totalAmount);
    }

    /**
     * @dev Internal function to update rewards for an account.
     */
    function _updateRewardForAccount(address account) internal {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = block.timestamp;

        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
    }

    /**
     * @dev Pause staking functionality. Only callable by the owner.
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @dev Unpause staking functionality. Only callable by the owner.
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @dev Function that is required to be implemented by the UUPS pattern.
     * It controls who can upgrade the contract.
     */
    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyOwner {
        // Additional authorization logic could be added here
    }
}
