// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║       P R O O F - O F - P R I V A C Y   M I N I N G   V A U L T  ║
 * ║                          V E R S I O N   2                       ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  Distributes PRIVX rewards to users who withdraw through a       ║
 * ║  PrivX Hurricane shield (i.e. prove knowledge of a valid note).  ║
 * ║                                                                  ║
 * ║  Reward is computed as a dynamic percentage of the PRIVX fee     ║
 * ║  paid on deposit — NOT of the shielded asset amount.             ║
 * ║  This ensures rewards are always denominated in PRIVX and are    ║
 * ║  self-funded by the fee stream.                                  ║
 * ║                                                                  ║
 * ║  Emission curve:                                                 ║
 * ║    • Rate decays quadratically as vault drains                   ║
 * ║    • Rate resets toward BASE_RATE when vault is refilled         ║
 * ║    • Hard cap: MAX_REWARD_RATE_BP of privxFeeAmount per call     ║
 * ║    • 5-minute per-user cooldown prevents reward spam             ║
 * ║                                                                  ║
 * ║  Vault can receive PRIVX from:                                   ║
 * ║    1. The 20% fee split on every shield deposit (automatic)      ║
 * ║    2. Anyone calling topUp() (community refills)                 ║
 * ║                                                                  ║
 * ║  Fully immutable after sealVault(). No owner. No admin.          ║
 * ║  2025 © PrivX Protocol                                           ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract PrivX_Mining_Vault_V2 {
    using SafeERC20 for IERC20;

    // ── Immutable ─────────────────────────────────────────────────────────────

    IERC20  public immutable privx;
    address public immutable owner;

    // ── Configuration constants ───────────────────────────────────────────────

    /// @notice Reward rate when vault is at peak balance (1%).
    uint256 public constant BASE_RATE_BP     = 100;
    /// @notice Hard cap on reward per call (10% of privxFeeAmount).
    uint256 public constant MAX_REWARD_RATE_BP = 1000;
    uint256 public constant BP_DENOMINATOR   = 10_000;
    uint256 public constant COOLDOWN         = 5 minutes;
    uint8   public constant MAX_SHIELDS      = 40;

    // ── Shield registry (configured before seal) ──────────────────────────────

    mapping(address => bool) public authorizedShields;
    address[]                public linkedShields;
    bool                     public isSealed;

    // ── Dynamic emission state ────────────────────────────────────────────────

    /// @notice Highest balance ever recorded — used as the decay reference.
    uint256 public peakBalance;

    // ── Usage tracking ────────────────────────────────────────────────────────

    uint256 public totalMined;
    mapping(address => uint256) public lastMineTime;

    // ── Events ────────────────────────────────────────────────────────────────

    event RewardPaid(
        address indexed user,
        uint256 reward,
        uint256 privxFeeAmount,
        uint256 totalMined
    );
    event VaultFunded(address indexed funder, uint256 amount, uint256 newBalance);
    event ShieldLinked(address indexed shield);
    event ShieldRemoved(address indexed shield);
    event VaultSealed();
    event PeakUpdated(uint256 newPeak);

    // ── Constructor ───────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "vault: not owner");
        _;
    }

    constructor(address _privx) {
        require(_privx != address(0), "privx: zero");
        privx = IERC20(_privx);
        owner = msg.sender;
    }

    // ── Shield registry ───────────────────────────────────────────────────────

    /**
     * @notice Add a shield that is authorised to trigger mining rewards.
     *         Must be called before sealVault().
     */
    function addShield(address _shield) external onlyOwner {
        require(!isSealed,                              "vault: sealed");
        require(_shield != address(0),                 "shield: zero");
        require(!authorizedShields[_shield],           "shield: already added");
        require(linkedShields.length < MAX_SHIELDS,    "shield: max reached");

        authorizedShields[_shield] = true;
        linkedShields.push(_shield);
        emit ShieldLinked(_shield);
    }

    /**
     * @notice Remove a shield from the authorized list.
     *         Only callable by owner before vault is sealed.
     */
    function removeShield(address _shield) external onlyOwner {
        require(!isSealed,                    "vault: sealed");
        require(authorizedShields[_shield],   "shield: not found");

        authorizedShields[_shield] = false;

        uint256 len = linkedShields.length;
        for (uint256 i = 0; i < len; i++) {
            if (linkedShields[i] == _shield) {
                linkedShields[i] = linkedShields[len - 1];
                linkedShields.pop();
                break;
            }
        }
        emit ShieldRemoved(_shield);
    }

    /**
     * @notice Emergency withdraw PRIVX to owner.
     *         Only callable before vault is sealed — escape hatch during setup.
     */
    function ownerWithdraw(uint256 _amount) external onlyOwner {
        require(!isSealed, "vault: sealed");
        require(_amount > 0, "amount: zero");
        privx.safeTransfer(owner, _amount);
    }

    /**
     * @notice Permanently seal the vault — no new shields can be added.
     *         Call this once all shields are linked and vault is funded.
     */
    function sealVault() external onlyOwner {
        require(!isSealed,              "vault: already sealed");
        require(linkedShields.length > 0, "vault: no shields");

        isSealed = true;

        uint256 bal = privx.balanceOf(address(this));
        if (bal > peakBalance) {
            peakBalance = bal;
            emit PeakUpdated(peakBalance);
        }

        emit VaultSealed();
    }

    // ── Funding ───────────────────────────────────────────────────────────────

    /**
     * @notice Anyone can top up the vault at any time.
     *         Refilling above the historical peak resets the emission curve.
     */
    function topUp(uint256 _amount) external {
        require(_amount > 0, "amount: zero");
        privx.safeTransferFrom(msg.sender, address(this), _amount);

        uint256 newBal = privx.balanceOf(address(this));
        if (newBal > peakBalance) {
            peakBalance = newBal;
            emit PeakUpdated(peakBalance);
        }

        emit VaultFunded(msg.sender, _amount, newBal);
    }

    // ── Core: mine reward ─────────────────────────────────────────────────────

    /**
     * @notice Compute and pay a PRIVX reward to `_user`.
     *         Called by authorised shields on every successful withdrawal.
     *
     * @param _user             Withdrawal recipient.
     * @param _privxFeeAmount   PRIVX fee paid on the original deposit (in wei).
     *                          Reward is a % of this value — dimensionally correct.
     */
    function mineReward(
        address _user,
        uint256 _privxFeeAmount,
        string calldata /* action */
    ) external {
        require(authorizedShields[msg.sender],                    "vault: unauthorized");
        require(_privxFeeAmount > 0,                              "fee: zero");
        require(block.timestamp >= lastMineTime[_user] + COOLDOWN, "vault: cooldown");

        lastMineTime[_user] = block.timestamp;

        uint256 vaultBal = privx.balanceOf(address(this));
        if (vaultBal == 0) return;

        // ── Dynamic rate: quadratic decay relative to peak ────────────────────
        // When vault == peak:  ratio = 1e36, dynamicRateBp = BASE_RATE_BP (100)
        // When vault == 50%:   ratio = 0.25e36, dynamicRateBp ≈ 25
        // When vault → 0:      dynamicRateBp → 0
        uint256 ref   = peakBalance > 0 ? peakBalance : vaultBal;
        uint256 ratio = (vaultBal * 1e18) / ref;          // 0–1e18
        if (ratio > 1e18) ratio = 1e18;

        // dynamicRateBp = BASE_RATE_BP * ratio² / 1e36
        uint256 dynamicRateBp = (BASE_RATE_BP * ratio * ratio) / 1e36;

        // ── Compute reward ────────────────────────────────────────────────────
        uint256 reward    = (_privxFeeAmount * dynamicRateBp) / BP_DENOMINATOR;
        uint256 maxReward = (_privxFeeAmount * MAX_REWARD_RATE_BP) / BP_DENOMINATOR;

        if (reward > maxReward)  reward = maxReward;
        if (reward > vaultBal)   reward = vaultBal;
        if (reward == 0)         return;

        totalMined += reward;
        privx.safeTransfer(_user, reward);
        emit RewardPaid(_user, reward, _privxFeeAmount, totalMined);
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    function vaultBalance() external view returns (uint256) {
        return privx.balanceOf(address(this));
    }

    /// @notice Current dynamic reward rate in basis points.
    function currentRateBp() external view returns (uint256) {
        uint256 vaultBal = privx.balanceOf(address(this));
        if (vaultBal == 0 || peakBalance == 0) return 0;
        uint256 ratio = (vaultBal * 1e18) / peakBalance;
        if (ratio > 1e18) ratio = 1e18;
        return (BASE_RATE_BP * ratio * ratio) / 1e36;
    }

    /// @notice Seconds until `_user` can mine again. 0 if eligible now.
    function cooldownRemaining(address _user) external view returns (uint256) {
        uint256 last = lastMineTime[_user];
        if (last == 0) return 0;
        uint256 ready = last + COOLDOWN;
        return ready > block.timestamp ? ready - block.timestamp : 0;
    }

    function getLinkedShields() external view returns (address[] memory) {
        return linkedShields;
    }
}
