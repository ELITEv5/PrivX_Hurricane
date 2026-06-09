// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║        P R I V X   P L S   S H I E L D   V 3                    ║
 * ║        Powered by PrivX Hurricane                                ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  Shields native PLS using PLONK zero-knowledge proofs.           ║
 * ║  Users deposit raw PLS — no wrapping step required.              ║
 * ║                                                                  ║
 * ║  Internally: PLS is wrapped to WPLS on deposit, unwrapped        ║
 * ║  back to PLS on withdrawal. Users always interact with native    ║
 * ║  PLS only.                                                       ║
 * ║                                                                  ║
 * ║  V3 adds:                                                        ║
 * ║    • SNARK_FIELD overflow checks on all 4 public signals         ║
 * ║      (prevents double-spend via field-element aliasing)          ║
 * ║    • asset() view returning address(wpls) — consistent with      ║
 * ║      the universal PrivX_Shield_V3 verification interface        ║
 * ║    • V3 MRA tiers: 100 / 1K / 10K / 100K PRIVX                  ║
 * ║                                                                  ║
 * ║  Fee: 0.5% of denomination in WPLS sent to FeeVault.             ║
 * ║  Fully immutable after deployment.  2025 © PrivX Hurricane       ║
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

interface IWPLS {
    function deposit() external payable;
    function withdraw(uint256 wad) external;
    function transfer(address dst, uint256 wad) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

// ─── Contract ─────────────────────────────────────────────────────────────────

contract PrivX_PLS_Shield_V3 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Constants ─────────────────────────────────────────────────────────────

    uint32  public constant LEVELS       = 14;
    uint32  public constant ROOT_HISTORY = 100;
    uint256 public constant BP_DENOM     = 10_000;
    uint256 public constant SNARK_FIELD  = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    // ── Immutable config ──────────────────────────────────────────────────────

    IPlonkVerifier public immutable verifier;
    IPoseidonHasher public immutable hasher;
    IWPLS           public immutable wpls;
    address         public immutable feeVault;
    IMiningVault    public immutable miningVault;

    uint256 public immutable denomination;
    uint256 public immutable feeBP;
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

    constructor(
        IPlonkVerifier  _verifier,
        IPoseidonHasher _hasher,
        address         _wpls,
        address         _feeVault,
        IMiningVault    _miningVault,
        uint256         _denomination,
        uint256         _feeBP,
        uint256         _miningRewardAmount
    ) {
        require(address(_verifier)  != address(0), "verifier: zero");
        require(address(_hasher)    != address(0), "hasher: zero");
        require(_wpls               != address(0), "wpls: zero");
        require(_denomination       >  0,          "denomination: zero");
        require(_feeBP              <  BP_DENOM,   "feeBP: >= 100%");
        require(_miningRewardAmount >  0,          "rewardAmount: zero");

        verifier           = _verifier;
        hasher             = _hasher;
        wpls               = IWPLS(_wpls);
        feeVault           = _feeVault;
        miningVault        = IMiningVault(_miningVault);
        denomination       = _denomination;
        feeBP              = _feeBP;
        miningRewardAmount = _miningRewardAmount;

        bytes32 current = bytes32(0);
        for (uint32 i = 0; i < LEVELS; i++) {
            zeros[i]          = current;
            filledSubtrees[i] = current;
            current           = bytes32(hasher.poseidon([uint256(current), uint256(current)]));
        }
        roots[0] = current;
    }

    // ── Deposit (native PLS) ──────────────────────────────────────────────────

    /**
     * @notice Shield PLS. Send denomination + fee as msg.value.
     *         No wrapping step required — just send raw PLS.
     */
    function deposit(bytes32 _commitment) external payable nonReentrant {
        uint256 fee      = (denomination * feeBP) / BP_DENOM;
        uint256 required = denomination + fee;

        require(msg.value == required,             "pls: wrong amount");
        require(!commitments[_commitment],          "commitment: already exists");
        require(nextIndex < 2 ** LEVELS,           "tree: full");

        commitments[_commitment] = true;

        // Wrap all received PLS → WPLS in one call
        wpls.deposit{value: required}();

        // Send fee portion as WPLS to Fee Vault
        if (fee > 0 && feeVault != address(0)) {
            IERC20(address(wpls)).safeTransfer(feeVault, fee);
        }

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

    // ── Withdraw (native PLS) ─────────────────────────────────────────────────

    /**
     * @notice Withdraw denomination PLS to recipient using a ZK proof.
     *         Recipient receives native PLS directly — no unwrapping needed.
     */
    function withdraw(
        uint256[24] calldata _proof,
        uint256[4]  calldata _pubSignals,
        address              _recipient
    ) external nonReentrant {
        require(_recipient != address(0), "recipient: zero");

        // Reject non-canonical public inputs — prevents double-spend via field overflow
        require(_pubSignals[0] < SNARK_FIELD, "root: overflow");
        require(_pubSignals[1] < SNARK_FIELD, "nullifier: overflow");
        require(_pubSignals[2] < SNARK_FIELD, "denomination: overflow");
        require(_pubSignals[3] < SNARK_FIELD, "recipient: overflow");

        bytes32 root          = bytes32(_pubSignals[0]);
        bytes32 nullifierHash = bytes32(_pubSignals[1]);
        uint256 denomCheck    = _pubSignals[2];

        require(isKnownRoot(root),                               "root: unknown");
        require(!nullifierHashes[nullifierHash],                  "note: already spent");
        require(denomCheck == denomination,                      "denomination: mismatch");
        require(address(uint160(_pubSignals[3])) == _recipient,  "recipient: mismatch");
        require(verifier.verifyProof(_proof, _pubSignals),       "proof: invalid");

        nullifierHashes[nullifierHash] = true;

        // Unwrap WPLS → PLS, then forward native PLS to recipient
        wpls.withdraw(denomination);
        (bool sent, ) = payable(_recipient).call{value: denomination}("");
        require(sent, "pls: transfer failed");

        if (address(miningVault) != address(0)) {
            try miningVault.mineReward(_recipient, miningRewardAmount, "withdraw") {} catch {}
        }

        emit Withdrawal(_recipient, nullifierHash);
    }

    // ── View helpers ──────────────────────────────────────────────────────────

    /// @notice Returns WPLS address — compatible with PrivX_Shield_V3 verification interface.
    function asset() external view returns (address) {
        return address(wpls);
    }

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

    /// @dev Required to receive PLS when wpls.withdraw() sends it back.
    receive() external payable {
        require(msg.sender == address(wpls), "pls: only wpls");
    }
}
