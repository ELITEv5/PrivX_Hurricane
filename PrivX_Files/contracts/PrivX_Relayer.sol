// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║              P R I V X   R E L A Y E R   V 1                    ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  Trustless relay fee escrow for PrivX Hurricane shields.         ║
 * ║  Compatible with any EVM chain.                                  ║
 * ║                                                                  ║
 * ║  Problem:                                                        ║
 * ║    The recipient is cryptographically locked inside every ZK     ║
 * ║    proof — no intermediary can redirect or skim funds.           ║
 * ║    Off-chain tip agreements require trusting the relayer.        ║
 * ║                                                                  ║
 * ║  Solution:                                                       ║
 * ║    User escrows a native token tip keyed by their nullifierHash  ║
 * ║    before handing the proof to a relayer. The relayer submits    ║
 * ║    through this contract and auto-collects. If no relay occurs   ║
 * ║    by deadline, the user reclaims.                               ║
 * ║                                                                  ║
 * ║  Flow:                                                           ║
 * ║    1. User calls registerRequest() with native tip (msg.value)   ║
 * ║    2. User sends proof JSON to relayer off-chain                 ║
 * ║    3. Relayer calls relay() — withdrawal submitted, tip paid     ║
 * ║    4. If deadline passes unrelayed → reclaimFee()               ║
 * ║                                                                  ║
 * ║  Fully immutable. No owner. No admin. No upgrades.               ║
 * ║  Works with any PrivX Hurricane shield on any EVM chain.         ║
 * ║  2025 © PrivX Protocol                                           ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

interface IPrivXShield {
    function withdraw(
        uint256[24] calldata _proof,
        uint256[4]  calldata _pubSignals,
        address              _recipient
    ) external;

    function nullifierHashes(bytes32) external view returns (bool);
}

contract PrivX_Relayer {

    // ── Storage ───────────────────────────────────────────────────────────────

    struct RelayRequest {
        address shield;
        address depositor;
        address relayer;   // address(0) = any relayer accepted
        uint96  fee;       // native token tip (packed with relayer into one slot)
        uint40  deadline;  // unix timestamp
        bool    exists;
    }

    // nullifierHash (pubSignals[1]) → request
    mapping(bytes32 => RelayRequest) public requests;

    // ── Events ────────────────────────────────────────────────────────────────

    event RequestRegistered(
        bytes32 indexed nullifierHash,
        address indexed depositor,
        address         relayer,
        uint256         fee,
        uint256         deadline
    );

    event Relayed(
        bytes32 indexed nullifierHash,
        address indexed relayer,
        uint256         fee
    );

    event FeeReclaimed(
        bytes32 indexed nullifierHash,
        address indexed depositor,
        uint256         fee
    );

    // ── Register ──────────────────────────────────────────────────────────────

    /**
     * @notice Escrow a native token tip for whoever relays your withdrawal.
     *
     * @param nullifierHash  pubSignals[1] from your proof — uniquely identifies the note.
     *                       Obtain this from the proof JSON before calling.
     * @param shield         The PrivX Hurricane shield contract the proof is for.
     * @param relayer        Specific relayer address, or address(0) to accept any relayer.
     * @param deadline       Unix timestamp after which you can reclaim if unrelayed.
     *                       Suggested: block.timestamp + 24 hours to 72 hours.
     */
    function registerRequest(
        bytes32 nullifierHash,
        address shield,
        address relayer,
        uint40  deadline
    ) external payable {
        require(msg.value > 0,                   "fee: zero");
        require(msg.value <= type(uint96).max,   "fee: overflow");
        require(shield != address(0),            "shield: zero");
        require(deadline > block.timestamp,      "deadline: past");
        require(!requests[nullifierHash].exists, "request: already registered");
        require(
            !IPrivXShield(shield).nullifierHashes(nullifierHash),
            "note: already spent"
        );

        requests[nullifierHash] = RelayRequest({
            shield:    shield,
            depositor: msg.sender,
            relayer:   relayer,
            fee:       uint96(msg.value),
            deadline:  deadline,
            exists:    true
        });

        emit RequestRegistered(nullifierHash, msg.sender, relayer, msg.value, deadline);
    }

    // ── Relay ─────────────────────────────────────────────────────────────────

    /**
     * @notice Submit a PrivX withdrawal and collect the escrowed tip.
     *
     *         The nullifierHash is extracted from pubSignals[1] and used to look up
     *         the registered request. Caller must be the registered relayer, or any
     *         address if relayer was set to address(0).
     *
     *         CEI pattern: request is deleted before the external shield call.
     *         If the shield call reverts, the entire transaction reverts and the
     *         request is restored. No funds can be lost.
     */
    function relay(
        uint256[24] calldata proof,
        uint256[4]  calldata pubSignals,
        address              recipient
    ) external {
        bytes32 nullHash = bytes32(pubSignals[1]);
        RelayRequest memory req = requests[nullHash];

        require(req.exists,                                               "request: not found");
        require(req.relayer == address(0) || req.relayer == msg.sender,   "relayer: unauthorized");
        require(block.timestamp <= req.deadline,                          "request: expired");

        // Delete before external call — reentrancy guard
        delete requests[nullHash];

        // Submit withdrawal — reverts here undo the delete
        IPrivXShield(req.shield).withdraw(proof, pubSignals, recipient);

        // Pay relayer
        uint256 fee = uint256(req.fee);
        (bool ok,) = payable(msg.sender).call{value: fee}("");
        require(ok, "fee: transfer failed");

        emit Relayed(nullHash, msg.sender, fee);
    }

    // ── Reclaim ───────────────────────────────────────────────────────────────

    /**
     * @notice Reclaim your escrowed tip if the deadline has passed and the note
     *         was not relayed. Only the original depositor can call this.
     */
    function reclaimFee(bytes32 nullifierHash) external {
        RelayRequest memory req = requests[nullifierHash];

        require(req.exists,                    "request: not found");
        require(req.depositor == msg.sender,   "reclaim: not depositor");
        require(block.timestamp > req.deadline, "deadline: not reached");

        delete requests[nullifierHash];

        (bool ok,) = payable(msg.sender).call{value: req.fee}("");
        require(ok, "fee: transfer failed");

        emit FeeReclaimed(nullifierHash, msg.sender, req.fee);
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    function getRequest(bytes32 nullifierHash)
        external
        view
        returns (RelayRequest memory)
    {
        return requests[nullifierHash];
    }

    function isRegistered(bytes32 nullifierHash) external view returns (bool) {
        return requests[nullifierHash].exists;
    }
}
