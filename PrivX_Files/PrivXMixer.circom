pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/switcher.circom";
include "circomlib/circuits/bitify.circom";

// Verifies a Merkle inclusion proof for a given leaf.
template MerkleTreeChecker(levels) {
    signal input leaf;
    signal input root;
    signal input pathIndices[levels];  // 0 = current node is left child, 1 = right child
    signal input siblings[levels];

    component hashers[levels];
    component switchers[levels];
    signal nodes[levels + 1];
    nodes[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        // Ensure pathIndices[i] is a bit
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        // Switcher: sel=0 → (outL=node, outR=sibling)   left child
        //           sel=1 → (outL=sibling, outR=node)   right child
        switchers[i] = Switcher();
        switchers[i].L   <== nodes[i];
        switchers[i].R   <== siblings[i];
        switchers[i].sel <== pathIndices[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== switchers[i].outL;
        hashers[i].inputs[1] <== switchers[i].outR;

        nodes[i + 1] <== hashers[i].out;
    }

    root === nodes[levels];
}

// PrivX Hurricane Shield – Proof of Privacy circuit
//
// Private inputs:  nullifier, secret, pathIndices[levels], siblings[levels]
// Public inputs:   root, nullifierHash, denomination
//
// Proves:
//   1. commitment = Poseidon(nullifier, secret) is in the Merkle tree with given root
//   2. nullifierHash = Poseidon(nullifier, denomination)  (binds spend tag to denomination)
//   3. denomination is correct (public — contract checks it matches its stored denomination)
//
// Public signal order must match the contract's pubSignals[0..2]:
//   pubSignals[0] = root
//   pubSignals[1] = nullifierHash
//   pubSignals[2] = denomination
template PrivXMixer(levels) {
    // Private inputs
    signal input nullifier;
    signal input secret;
    signal input pathIndices[levels];
    signal input siblings[levels];

    // Public inputs (order here determines publicSignals order in PLONK output)
    signal input root;
    signal input nullifierHash;
    signal input denomination;
    signal input recipient;       // bound to proof — prevents recipient substitution

    // 1. Commitment: Poseidon(nullifier, secret)
    component commitHasher = Poseidon(2);
    commitHasher.inputs[0] <== nullifier;
    commitHasher.inputs[1] <== secret;

    // 2. NullifierHash: Poseidon(nullifier, denomination) — prevents double-spend
    component nullifierHasher = Poseidon(2);
    nullifierHasher.inputs[0] <== nullifier;
    nullifierHasher.inputs[1] <== denomination;
    nullifierHasher.out === nullifierHash;

    // 3. Merkle inclusion proof
    component tree = MerkleTreeChecker(levels);
    tree.leaf <== commitHasher.out;
    tree.root <== root;
    for (var i = 0; i < levels; i++) {
        tree.pathIndices[i] <== pathIndices[i];
        tree.siblings[i]    <== siblings[i];
    }

    // Force denomination and recipient into the constraint system.
    // (squaring is the standard no-op constraint in circom)
    signal denominationSquared;
    denominationSquared <== denomination * denomination;

    signal recipientSquared;
    recipientSquared <== recipient * recipient;
}

// 14-level tree → max 2^14 = 16,384 deposits per shield instance
component main { public [root, nullifierHash, denomination, recipient] } = PrivXMixer(14);
