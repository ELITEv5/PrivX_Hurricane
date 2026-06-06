// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║           P R I V X   H U R R I C A N E   S H I E L D   V 2     ║
 * ║                       Universal Token Shield                     ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  Shields any ERC-20 token using PLONK zero-knowledge proofs.     ║
 * ║                                                                  ║
 * ║  V2 change: miningRewardAmount is set independently of           ║
 * ║  denomination at deploy time. This normalises POP rewards        ║
 * ║  across all tokens regardless of denomination size or decimals.  ║
 * ║  Every token's d0/d1/d2/d3 tiers pay the same PRIVX reward       ║
 * ║  regardless of how many tokens that denomination represents.     ║
 * ║                                                                  ║
 * ║  Fee model: flat basis-point % of denomination, paid in the      ║
 * ║  shielded token. Always proportional — no oracle, no external    ║
 * ║  token price dependency. Works identically for any token.        ║
 * ║                                                                  ║
 * ║  Fee flow:                                                       ║
 * ║    · 100% of fee → FeeVault (converted asynchronously)           ║
 * ║    · FeeVault converts: 80% POL / 10% mining vault / 10% burn    ║
 * ║                                                                  ║
 * ║  POP rewards: paid in PRIVX from the Mining Vault on every       ║
 * ║  successful withdrawal. No PRIVX required to use any shield.     ║
 * ║                                                                  ║
 * ║  Standard miningRewardAmount tier values (match pDAI baseline):  ║
 * ║    d0 →  1_000e18   d1 →  10_000e18                              ║
 * ║    d2 → 100_000e18  d3 → 1_000_000e18                            ║
 * ║                                                                  ║
 * ║  Circuit: PrivXMixer(14) — 14-level Poseidon Merkle tree         ║
 * ║  Fully immutable after deployment.  2025 © PrivX Protocol        ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface IPlonkVerifier {
    function verifyProof(
        uint256[24] calldata proof,
        uint256[4]  calldata pubSignals
    ) external view returns (bool);
}

interface IPoseidonHasher {
    function poseidon(uint256[2] calldata inputs) external pure returns (uint256);
}

interface IMiningVault {
    function mineReward(address user, uint256 amount, string calldata action) external;
}

// ─── Contract ─────────────────────────────────────────────────────────────────

contract PrivX_Shield_V2 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Constants ─────────────────────────────────────────────────────────────

    uint32  public constant LEVELS       = 14;
    uint32  public constant ROOT_HISTORY = 100;
    uint256 public constant BP_DENOM     = 10_000;

    // ── Immutable config ──────────────────────────────────────────────────────

    IPlonkVerifier  public immutable verifier;
    IPoseidonHasher public immutable hasher;

    /// @notice The ERC-20 token being shielded. Fee is also collected in this token.
    IERC20 public immutable asset;

    /// @notice Receives the protocol fee on every deposit.
    address public immutable feeVault;

    /// @notice Pays PRIVX POP rewards on every withdrawal.
    IMiningVault public immutable miningVault;

    /// @notice Amount of asset (in wei) deposited and returned per note.
    uint256 public immutable denomination;

    /// @notice Fee in basis points of denomination (e.g. 50 = 0.5%).
    uint256 public immutable feeBP;

    /// @notice Amount passed to mineReward — normalised to the pDAI tier baseline
    ///         so POP rewards are consistent across all tokens and decimal sizes.
    ///         d0 = 1_000e18 / d1 = 10_000e18 / d2 = 100_000e18 / d3 = 1_000_000e18
    uint256 public immutable miningRewardAmount;

    // ── Merkle tree state ─────────────────────────────────────────────────────

    uint32  public nextIndex;
    uint32  public currentRootIndex;
    bytes32[ROOT_HISTORY] public roots;
    bytes32[LEVELS]       public filledSubtrees;
    bytes32[LEVELS]       public zeros;

    // ── Spent-note tracking ───────────────────────────────────────────────────

    mapping(bytes32 => bool) public nullifierHashes;
    mapping(bytes32 => bool) public commitments;

    // ── Events ────────────────────────────────────────────────────────────────

    event Deposit(bytes32 indexed commitment, uint32 leafIndex, uint256 timestamp);
    event Withdrawal(address indexed recipient, bytes32 indexed nullifierHash);

    // ── Constructor ───────────────────────────────────────────────────────────

    /**
     * @param _verifier           PLONK verifier (shared across all shields)
     * @param _hasher             Poseidon hasher (shared across all shields)
     * @param _asset              Token to shield. Fee also paid in this token.
     * @param _feeVault           Address that receives the protocol fee. Use address(0) to disable.
     * @param _miningVault        Mining vault that pays POP rewards. Use address(0) to disable.
     * @param _denomination       Amount of asset (wei) per deposit/withdrawal.
     * @param _feeBP              Fee in basis points (e.g. 50 = 0.5%).
     * @param _miningRewardAmount Amount passed to mineReward. Use pDAI tier values:
     *                            d0=1_000e18, d1=10_000e18, d2=100_000e18, d3=1_000_000e18
     */
    constructor(
        IPlonkVerifier  _verifier,
        IPoseidonHasher _hasher,
        IERC20          _asset,
        address         _feeVault,
        IMiningVault    _miningVault,
        uint256         _denomination,
        uint256         _feeBP,
        uint256         _miningRewardAmount
    ) {
        require(address(_verifier)  != address(0), "verifier: zero");
        require(address(_hasher)    != address(0), "hasher: zero");
        require(address(_asset)     != address(0), "asset: zero");
        require(_denomination       >  0,          "denomination: zero");
        require(_feeBP              <  BP_DENOM,   "feeBP: >= 100%");
        require(_miningRewardAmount >  0,          "rewardAmount: zero");

        verifier            = _verifier;
        hasher              = _hasher;
        asset               = _asset;
        feeVault            = _feeVault;
        miningVault         = IMiningVault(_miningVault);
        denomination        = _denomination;
        feeBP               = _feeBP;
        miningRewardAmount  = _miningRewardAmount;

        bytes32 current = bytes32(0);
        for (uint32 i = 0; i < LEVELS; i++) {
            zeros[i]          = current;
            filledSubtrees[i] = current;
            current           = bytes32(hasher.poseidon([uint256(current), uint256(current)]));
        }
        roots[0] = current;
    }

    // ── Deposit ───────────────────────────────────────────────────────────────

    /**
     * @notice Shield `denomination` tokens.
     * @dev Caller must approve denomination + fee before calling. Use approvalNeeded().
     * @param _commitment  Poseidon(nullifier, secret) computed client-side.
     */
    function deposit(bytes32 _commitment) external nonReentrant {
        require(!commitments[_commitment], "commitment: already exists");
        require(nextIndex < 2 ** LEVELS,   "tree: full");

        commitments[_commitment] = true;

        uint256 fee = (denomination * feeBP) / BP_DENOM;
        if (fee > 0 && feeVault != address(0)) {
            asset.safeTransferFrom(msg.sender, feeVault, fee);
        }

        asset.safeTransferFrom(msg.sender, address(this), denomination);

        uint32  index = nextIndex;
        bytes32 node  = _commitment;
        for (uint32 i = 0; i < LEVELS; i++) {
            if (index % 2 == 0) {
                filledSubtrees[i] = node;
                node = bytes32(hasher.poseidon([uint256(node), uint256(zeros[i])]));
            } else {
                node = bytes32(hasher.poseidon([uint256(filledSubtrees[i]), uint256(node)]));
            }
            index >>= 1;
        }
        currentRootIndex        = (currentRootIndex + 1) % ROOT_HISTORY;
        roots[currentRootIndex] = node;
        nextIndex++;

        emit Deposit(_commitment, nextIndex - 1, block.timestamp);
    }

    // ── Withdraw ──────────────────────────────────────────────────────────────

    /**
     * @notice Withdraw `denomination` tokens using a ZK proof.
     * @param _proof       24-element PLONK proof from snarkjs.plonk.fullProve()
     * @param _pubSignals  [root, nullifierHash, denomination, recipient]
     * @param _recipient   Address that receives the tokens and POP reward
     */
    function withdraw(
        uint256[24] calldata _proof,
        uint256[4]  calldata _pubSignals,
        address              _recipient
    ) external nonReentrant {
        require(_recipient != address(0), "recipient: zero");

        bytes32 root          = bytes32(_pubSignals[0]);
        bytes32 nullifierHash = bytes32(_pubSignals[1]);
        uint256 denomCheck    = _pubSignals[2];

        require(isKnownRoot(root),                                  "root: unknown");
        require(!nullifierHashes[nullifierHash],                     "note: already spent");
        require(denomCheck == denomination,                         "denomination: mismatch");
        require(address(uint160(_pubSignals[3])) == _recipient,     "recipient: mismatch");
        require(verifier.verifyProof(_proof, _pubSignals),          "proof: invalid");

        nullifierHashes[nullifierHash] = true;
        asset.safeTransfer(_recipient, denomination);

        if (address(miningVault) != address(0)) {
            try miningVault.mineReward(_recipient, miningRewardAmount, "withdraw") {} catch {}
        }

        emit Withdrawal(_recipient, nullifierHash);
    }

    // ── View helpers ──────────────────────────────────────────────────────────

    function isKnownRoot(bytes32 _root) public view returns (bool) {
        if (_root == bytes32(0)) return false;
        uint32 i = currentRootIndex;
        do {
            if (roots[i] == _root) return true;
            if (i == 0) i = ROOT_HISTORY - 1;
            else        i--;
        } while (i != currentRootIndex);
        return false;
    }

    function getLastRoot() external view returns (bytes32) {
        return roots[currentRootIndex];
    }

    function depositCount() external view returns (uint32) {
        return nextIndex;
    }

    function feePerDeposit() external view returns (uint256) {
        return (denomination * feeBP) / BP_DENOM;
    }

    function approvalNeeded() external view returns (uint256) {
        return denomination + (denomination * feeBP) / BP_DENOM;
    }

    function shieldBalance() external view returns (uint256) {
        return asset.balanceOf(address(this));
    }
}
