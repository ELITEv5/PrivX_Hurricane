# PrivX Hurricane — Proof of Privacy Protocol

> Zero-knowledge token shielding on PulseChain. Shield tokens. Generate a Proof of Privacy. Mine PRIVX.

**Live:** [Hurricane Shield](https://elitev5.github.io/PrivX_Hurricane/index.html) &nbsp;·&nbsp; [ETHOS Shield](https://elitev5.github.io/PrivX_Hurricane/ethos.html) &nbsp;·&nbsp; **Chain:** PulseChain (chainId 369)

---

## What Is PrivX Hurricane?

PrivX Hurricane is a zero-knowledge privacy protocol built on PulseChain. It lets you deposit tokens into a shielded pool and withdraw them to a completely unlinked address — with no on-chain connection between sender and recipient.

The withdrawal proof is a **PLONK zero-knowledge proof** generated entirely in your browser. It proves you know a valid deposit note without revealing which deposit it came from. The on-chain verifier checks the math. The contract releases your tokens. No one — not the development team, not a node operator, not a block explorer — can link your deposit to your withdrawal.

Every withdrawal also produces a **Proof of Privacy (POP)** — a verifiable record that you used the protocol — which triggers an automatic PRIVX mining reward. No claim transaction. No staking. Just use the protocol, earn PRIVX.

The same ZK circuit that powers PrivX Hurricane also powers **ETHOS Shield** — a multi-token extension that shields 9 PulseChain tokens using the same proving key, verifier, and Poseidon hasher.

---

## How It Works

```
Deposit                                    Withdraw
──────                                    ────────
You have 1,000 PRIVX                      From a fresh wallet
  │                                         │
  ├─ Generate random nullifier + secret      ├─ Paste your private note
  ├─ Compute commitment = Poseidon(n, s)     ├─ Browser builds Merkle proof
  ├─ Approve shield contract                 ├─ Generates PLONK ZK proof (~20s)
  ├─ Deposit: commitment stored in tree      ├─ Contract verifies proof on-chain
  ├─ 0.5% fee → FeeVault                    ├─ Tokens → your fresh wallet
  └─ Save your private note                 └─ PRIVX mining reward paid instantly
```

**The note is the only key.** It encodes your nullifier and secret. Losing it means the funds are locked in the contract forever — there is no recovery mechanism.

---

## Architecture

### Shield Contracts

Two shield contract variants share the same ZK circuit:

**`PrivX_Shield_V2.sol`** — Universal ERC-20 shield. Used for all tokens except native PLS. Includes `miningRewardAmount` — a constructor parameter that normalises POP rewards across tokens regardless of denomination size or token decimals. All tokens use the same tier values:

| Tier | `miningRewardAmount` | PRIVX reward at peak |
|---|---|---|
| d0 | `1_000e18` | ~10 PRIVX |
| d1 | `10_000e18` | ~100 PRIVX |
| d2 | `100_000e18` | ~1,000 PRIVX |
| d3 | `1_000_000e18` | ~10,000 PRIVX |

**`PrivX_PLS_Shield.sol`** — Native PLS shield. Users deposit raw PLS — no wrapping step required. The contract wraps PLS → WPLS on deposit and unwraps WPLS → PLS on withdrawal. Also uses `miningRewardAmount` for normalised POP rewards.

Both contracts are fully immutable after deployment — no owner, no admin key, no upgrade proxy, no pause function.

- **Merkle tree:** 14-level incremental Poseidon Merkle tree (16,384 leaves)
- **Root history:** Last 100 roots stored, allowing ~100 concurrent pending withdrawals
- **Circuit:** `PrivXMixer(14)` — PLONK proof with 4 public signals `[root, nullifierHash, denomination, recipient]`
- **Fee model:** 0.5% of denomination in the shielded token, sent to FeeVault on deposit
- **POP rewards:** `mineReward()` called on Mining Vault on every successful withdrawal

### Fee Vault (`ETHOS_FeeVault.sol`)

Receives protocol fees from all shields and converts them into PRIVX value. Anyone can trigger conversion at any time.

```
Fee token accumulated → swap to WPLS (PulseX V2)
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
           80% POL        10% Vault      10% Burn
     buy PRIVX + add    buy PRIVX →    buy PRIVX →
     PRIVX/WPLS LP      topUp()        dead address
     (locked forever)   (POP rewards)  (deflationary)
```

- LP tokens are permanently locked in FeeVault — Protocol-Owned Liquidity that compounds with every deposit
- Mining Vault is auto-refilled from conversions — POP rewards are self-sustaining
- Tax-token aware: ETHOS, ZKP, and OMEGA (5% swap tax) use the FOT-safe PulseX router function

### Mining Vault (`PrivX_Mining_Vault_V2.sol`)

Pays PRIVX rewards to withdrawal recipients. Owner can add and remove shields freely until `sealVault()` is called — after which it is fully immutable.

- **Emission curve:** Quadratic decay relative to peak balance — rewards are highest when vault is full
- **Auto-refill:** Fee Vault calls `topUp()` on every conversion cycle
- **Cooldown:** 5-minute per-user cooldown prevents reward spam
- **Max rate:** 10% of fee amount per withdrawal (hard cap)
- **Safety functions (pre-seal only):** `removeShield()` and `ownerWithdraw()` allow safe setup and recovery before the vault is sealed

### ZK Circuit (`circuits/PrivXMixer.circom`)

```
Private inputs:  nullifier, secret, pathIndices[14], siblings[14]
Public signals:  root, nullifierHash, denomination, recipient

Constraints:
  commitment    = Poseidon(nullifier, secret)
  commitment    ∈ Merkle tree with root
  nullifierHash = Poseidon(nullifier, denomination)
  recipient     = bound into proof at generation time
```

The recipient address is cryptographically embedded into the ZK proof at generation time — MEV bots cannot redirect withdrawals to a different address even if they observe the proof in the mempool. `nullifierHash` binds to the denomination, preventing note replay across pools. **The same circuit and proving key power every shield — adding a new token requires no circuit changes.**

---

## Deployed Contracts — PulseChain Mainnet

### Shared Infrastructure

| Contract | Address |
|---|---|
| PLONK Verifier | [`0xcEDa1071542d537221B5a01BFd1cF920cF8B9829`](https://scan.pulsechain.com/address/0xcEDa1071542d537221B5a01BFd1cF920cF8B9829) |
| Poseidon Hasher | [`0x72740d65A93f2e9d9741234371d62FeE36AEf9dF`](https://scan.pulsechain.com/address/0x72740d65A93f2e9d9741234371d62FeE36AEf9dF) |
| PRIVX Token | [`0x34310B5d3a8d1e5f8e4A40dcf38E48d90170E986`](https://scan.pulsechain.com/address/0x34310B5d3a8d1e5f8e4A40dcf38E48d90170E986) |

### Shared Infrastructure — PrivX Hurricane + ETHOS Shield

Mining vault and fee vault are unified across both protocols. All shields — PrivX Hurricane and ETHOS Shield — feed the same POL, the same mining rewards, and the same burn.

| Contract | Address |
|---|---|
| POP Mining Vault V2 | [`0x7f6D1165a15a7DC4Bbbf27C6C18de7bfAA9E718C`](https://scan.pulsechain.com/address/0x7f6D1165a15a7DC4Bbbf27C6C18de7bfAA9E718C) |
| Fee Vault (PulseX V2) | [`0x54818356b47b5F7b52DceAbf2B6eF52Cf8b072Fd`](https://scan.pulsechain.com/address/0x54818356b47b5F7b52DceAbf2B6eF52Cf8b072Fd) |

### PRIVX Hurricane Shield

| Contract | Address |
|---|---|
| Shield · 100 PRIVX | [`0x74471E88588c2dF518379c4f9feC981158f741F4`](https://scan.pulsechain.com/address/0x74471E88588c2dF518379c4f9feC981158f741F4) |
| Shield · 1,000 PRIVX | [`0xAbbF7729949eb15Ba2A9e739b591db7585d252ae`](https://scan.pulsechain.com/address/0xAbbF7729949eb15Ba2A9e739b591db7585d252ae) |
| Shield · 10,000 PRIVX | [`0x7DBc9558DA5aA494302d2099f5F36F307988a84a`](https://scan.pulsechain.com/address/0x7DBc9558DA5aA494302d2099f5F36F307988a84a) |
| Shield · 100,000 PRIVX | [`0x72DDf291c8cE3e2DCb7C555b48E09Cd353CE9177`](https://scan.pulsechain.com/address/0x72DDf291c8cE3e2DCb7C555b48E09Cd353CE9177) |

### ETHOS Shield — Multi-Token (pDAI + PLS + PrivX Live)

| Contract | Address |
|---|---|
| pDAI · 1,000 | [`0x94D0Df289cE310462Fee8137aF945381844B94D1`](https://scan.pulsechain.com/address/0x94D0Df289cE310462Fee8137aF945381844B94D1) |
| pDAI · 10,000 | [`0xc00D854d2fCBEdBe8A717c01a15C1351722858E7`](https://scan.pulsechain.com/address/0xc00D854d2fCBEdBe8A717c01a15C1351722858E7) |
| pDAI · 100,000 | [`0x5136467D3E81bF2a722f364900DF2982adeE02EE`](https://scan.pulsechain.com/address/0x5136467D3E81bF2a722f364900DF2982adeE02EE) |
| pDAI · 1,000,000 | [`0xBbaFF183588FAB20cC24F67De7cd4263670a09E5`](https://scan.pulsechain.com/address/0xBbaFF183588FAB20cC24F67De7cd4263670a09E5) |
| PLS · 100,000 | [`0xFdbd8a02f112e722543C12bce3596f42b9Bb3b72`](https://scan.pulsechain.com/address/0xFdbd8a02f112e722543C12bce3596f42b9Bb3b72) |
| PLS · 1,000,000 | [`0xfD03a99A337931de9a217E5836046CBF13578B18`](https://scan.pulsechain.com/address/0xfD03a99A337931de9a217E5836046CBF13578B18) |
| PLS · 10,000,000 | [`0xE97135be5b9D6A3020C733AD122c4A6092ABF1F7`](https://scan.pulsechain.com/address/0xE97135be5b9D6A3020C733AD122c4A6092ABF1F7) |
| PLS · 100,000,000 | [`0xEB4297A2c769eD02778Fa9D3197a58665beD8834`](https://scan.pulsechain.com/address/0xEB4297A2c769eD02778Fa9D3197a58665beD8834) |
| PrivX · 100 | [`0x74471E88588c2dF518379c4f9feC981158f741F4`](https://scan.pulsechain.com/address/0x74471E88588c2dF518379c4f9feC981158f741F4) |
| PrivX · 1,000 | [`0xAbbF7729949eb15Ba2A9e739b591db7585d252ae`](https://scan.pulsechain.com/address/0xAbbF7729949eb15Ba2A9e739b591db7585d252ae) |
| PrivX · 10,000 | [`0x7DBc9558DA5aA494302d2099f5F36F307988a84a`](https://scan.pulsechain.com/address/0x7DBc9558DA5aA494302d2099f5F36F307988a84a) |
| PrivX · 100,000 | [`0x72DDf291c8cE3e2DCb7C555b48E09Cd353CE9177`](https://scan.pulsechain.com/address/0x72DDf291c8cE3e2DCb7C555b48E09Cd353CE9177) |

---

## PRIVX Token

PRIVX is the **Proof-of-Privacy mining token**. Fixed supply of 21 million. No minting ever.

**Value flywheel:**

```
Shield deposit (any token, any shield)
       │
       └─ 0.5% fee → FeeVault
                         │
              ┌──────────┼───────────┐
              ▼          ▼           ▼
          Buy PRIVX   Buy PRIVX   Buy PRIVX
          + add LP    → Vault      → Burn
          (80% POL)   (10% POP)   (10% 🔥)
```

Every token shielded across every pool creates buying pressure on PRIVX, deepens its liquidity permanently, and funds mining rewards. The protocol gets stronger the more it is used.

**POP Rewards:**
- Paid automatically on every withdrawal — no claim needed
- Rate = `BASE_RATE_BP × (vaultBalance / peakBalance)²` — quadratic decay
- Normalised across all tokens: same denomination tier = same PRIVX reward regardless of which token is shielded
- Vault refills automatically from FeeVault conversions

---

## Trusted Setup

PrivX Hurricane's cryptographic foundation rests on the **Hermez Network Powers of Tau** — one of the most rigorous multi-party computation ceremonies ever conducted for a ZK proving system. **54 independent contributors** from across the world each added entropy to the ceremony. The security guarantee is unconditional: every single one of those 54 participants would need to have secretly preserved their randomness *and* coordinated together to compromise the system. This is considered computationally and logistically impossible.

### Why PLONK Changes Everything

Unlike Groth16 — the proving system used by earlier privacy protocols — **PLONK requires no circuit-specific trusted setup**. There is no secondary ceremony, no per-circuit toxic waste, and no privileged developer key that could theoretically be exploited. The universal structured reference string (SRS) derived from the Hermez ceremony is all that is needed, permanently and for every token PrivX Hurricane ever shields.

This means:
- Adding a new shielded token requires **no new ceremony**
- There is **no single point of failure** introduced at circuit compile time
- The proving key is a mathematical consequence of the ceremony — not a secret

### Verification

The ceremony file is cryptographically fingerprinted and independently verifiable by anyone:

```
SHA256: 489be9e5ac65d524f7b1685baac8a183c6e77924fdb73d2b8105e335f277895d
```

The proving key (`PrivXMixer14_final.zkey`) was derived from this ceremony file and the compiled circuit constraints. It is pinned to IPFS, served to the browser for fully client-side proof generation, and never touches a server.

---

## Security Properties

| Property | Status |
|---|---|
| No owner or admin key on shields | ✅ |
| No upgrade proxy | ✅ |
| No pause function | ✅ |
| No fee change | ✅ |
| No withdrawal censorship | ✅ |
| Recipient bound into ZK proof | ✅ MEV theft impossible |
| Reentrancy protection | ✅ OpenZeppelin ReentrancyGuard |
| Safe token transfers | ✅ OpenZeppelin SafeERC20 |
| Double-spend prevention | ✅ Nullifier hash mapping |
| Root freshness | ✅ 100-root circular history |
| Denomination binding | ✅ nullifierHash = Poseidon(nullifier, denomination) |
| Trusted setup | ✅ Hermez multi-party ceremony (54 contributors) |

The shield contracts are immutable from the moment of deployment. The development team cannot change the fee, pause withdrawals, blacklist addresses, or alter any parameter. **If you know the note, you can withdraw — always, unconditionally, forever.**

---

## Repository Structure

```
plonk-zk/
├── circuits/
│   ├── PrivXMixer.circom              # 14-level Poseidon Merkle circuit
│   └── mixer_js/
│       ├── PrivXMixer14.wasm          # Compiled circuit for browser proof generation
│       └── witness_calculator.js
├── contracts/
│   ├── PrivX_Shield.sol               # Universal ERC-20 shield (V1 — pDAI Hurricane)
│   ├── PrivX_Shield_V2.sol            # Universal ERC-20 shield (V2 — normalised rewards)
│   ├── PrivX_PLS_Shield.sol           # Native PLS shield (wraps/unwraps WPLS internally)
│   ├── ETHOS_FeeVault.sol             # Fee conversion → POL + rewards + burn (tax-token aware)
│   └── PrivX_Mining_Vault_V2.sol      # POP reward distributor (removeShield + ownerWithdraw pre-seal)
├── build/
│   ├── PrivXMixer14_final.zkey        # Proving key (pin to IPFS)
│   ├── verification_key.json          # For verifier contract regeneration
│   ├── PrivXMixer.r1cs                # Compiled constraints
│   └── powersOfTau28_hez_final_14.ptau # Hermez ceremony file
├── index.html                         # PrivX Hurricane dapp (single file, no build step)
└── scripts/
    └── build_circuit.sh               # Circuit compile + trusted setup + verifier export
```

---

## Running Locally

No build step required. Open `index.html` directly or serve with any static file server:

```bash
npx serve .
# or
python3 -m http.server 8080
```

Requires MetaMask (or any EIP-1193 wallet) connected to PulseChain (chainId 369).

The proving key (~31MB) is fetched from IPFS on first use and cached in memory for the session. Proof generation takes 15–30 seconds depending on device.

---

## Deploying New Token Shields

Use `PrivX_Shield_V2.sol` for all new ERC-20 token shields. The key addition over V1 is `_miningRewardAmount` — set this to the pDAI tier value for the denomination, not the raw denomination wei:

```
d0 → 1_000e18   (smallest pool, ~10 PRIVX reward at peak)
d1 → 10_000e18
d2 → 100_000e18
d3 → 1_000_000e18  (largest pool, ~10,000 PRIVX reward at peak)
```

For native PLS shields use `PrivX_PLS_Shield.sol` with the same `_miningRewardAmount` values.

**Setup flow:**
1. Deploy `PrivX_Mining_Vault_V2`
2. Deploy `ETHOS_FeeVault` with new Mining Vault address
3. Deploy 4× shield contracts with token address, denominations, and normalised `_miningRewardAmount`
4. Call `addShield()` × 4 on Mining Vault
5. Call `setTokenConfig()` on Fee Vault for each token
6. Call `topUp()` to fund Mining Vault with PRIVX
7. Test deposits and withdrawals
8. Call `sealVault()` — vault becomes permanently immutable

The ZK circuit, proving key, and verifier contract do not change. No new ceremony required.

---

## Coming Soon

- **ETHOS, PLSX, HEX, ProvX, OMEGA, ZKP, PrivX shields** — remaining 7 ETHOS Shield tokens
- **FeeVault keeper** — automated `convertAuto()` calls
- **Relayer support** — gasless withdrawals for maximum privacy

---

## Why Privacy?

Financial privacy is a fundamental human right. Every transaction on a public blockchain is visible to every employer, government, creditor, and advertiser — permanently, immutably, forever. Transparency without the option of privacy is not a financial system. It is a surveillance system.

PrivX Hurricane exists to give people the option to transact privately. The contracts are ownerless. The math is the law.

---

## License

MIT

---

*Part of the [Sun Systems Protocol](https://elitev5.github.io/Sun-Systems/) · 2025 © PrivX Protocol*
