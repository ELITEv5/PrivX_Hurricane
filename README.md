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

### PRIVX Hurricane Shield

| Contract | Address |
|---|---|
| Mining Vault | [`0x925D32ff834285E0faefFBAc83Fc641A71660057`](https://scan.pulsechain.com/address/0x925D32ff834285E0faefFBAc83Fc641A71660057) |
| Fee Vault | [`0xBfa76b6961600331BA83F409789ddA36183F09Bf`](https://scan.pulsechain.com/address/0xBfa76b6961600331BA83F409789ddA36183F09Bf) |
| Shield · 100 PRIVX | [`0x1e06B9A5D519241809701eD29142ef01dDfc9288`](https://scan.pulsechain.com/address/0x1e06B9A5D519241809701eD29142ef01dDfc9288) |
| Shield · 1,000 PRIVX | [`0x6aCC2D19b6cCe5FbeF91AF97e18592B215280161`](https://scan.pulsechain.com/address/0x6aCC2D19b6cCe5FbeF91AF97e18592B215280161) |
| Shield · 10,000 PRIVX | [`0xb2Ef8c01BcC3f5B39d2648d598b90ed98E3cb9Cb`](https://scan.pulsechain.com/address/0xb2Ef8c01BcC3f5B39d2648d598b90ed98E3cb9Cb) |
| Shield · 100,000 PRIVX | [`0xaa2E70cE38C40e07d529b9656124c96eA26197Be`](https://scan.pulsechain.com/address/0xaa2E70cE38C40e07d529b9656124c96eA26197Be) |

### ETHOS Shield — Multi-Token (pDAI + PLS Live)

| Contract | Address |
|---|---|
| Mining Vault | [`0x7f6D1165a15a7DC4Bbbf27C6C18de7bfAA9E718C`](https://scan.pulsechain.com/address/0x7f6D1165a15a7DC4Bbbf27C6C18de7bfAA9E718C) |
| Fee Vault | [`0x83799D768243265a40395bEd77A7C3A410E6FCbB`](https://scan.pulsechain.com/address/0x83799D768243265a40395bEd77A7C3A410E6FCbB) |
| pDAI · 1,000 | [`0x6CF348cAd3A6A7A70103A78Af5B80071133395d8`](https://scan.pulsechain.com/address/0x6CF348cAd3A6A7A70103A78Af5B80071133395d8) |
| pDAI · 10,000 | [`0x59a50171E178313a1B3beDaF6558D2AffD1729bD`](https://scan.pulsechain.com/address/0x59a50171E178313a1B3beDaF6558D2AffD1729bD) |
| pDAI · 100,000 | [`0xeb19d6A2Fc2b5c9395daB2B90b7A959b7683fE87`](https://scan.pulsechain.com/address/0xeb19d6A2Fc2b5c9395daB2B90b7A959b7683fE87) |
| pDAI · 1,000,000 | [`0x2447C0fb757565b7984655D141506D478f15F5c1`](https://scan.pulsechain.com/address/0x2447C0fb757565b7984655D141506D478f15F5c1) |
| PLS · 100,000 | [`0x3524E0ec3Fd42852ab9423EE80fA0954D50f046a`](https://scan.pulsechain.com/address/0x3524E0ec3Fd42852ab9423EE80fA0954D50f046a) |
| PLS · 1,000,000 | [`0x5ce2B1953459cFE00cE8876b3B2D93f1C7e24C49`](https://scan.pulsechain.com/address/0x5ce2B1953459cFE00cE8876b3B2D93f1C7e24C49) |
| PLS · 10,000,000 | [`0x9FCd7De9dbFA15D26e4eb4D22658Db49820cC60A`](https://scan.pulsechain.com/address/0x9FCd7De9dbFA15D26e4eb4D22658Db49820cC60A) |
| PLS · 100,000,000 | [`0x4B0481A990F39EC21d684349F35a524Bf93c2a38`](https://scan.pulsechain.com/address/0x4B0481A990F39EC21d684349F35a524Bf93c2a38) |

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

The ZK circuit uses the **Hermez Powers of Tau ceremony** (`powersOfTau28_hez_final_14.ptau`) — a multi-party trusted setup with 54 independent contributors. Security holds as long as at least one contributor destroyed their toxic waste. The ceremony file is publicly verifiable:

```
SHA256: 489be9e5ac65d524f7b1685baac8a183c6e77924fdb73d2b8105e335f277895d
Source: https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_14.ptau
```

The proving key (`PrivXMixer14_final.zkey`) was generated from this ceremony file and the compiled circuit constraints. It is pinned on IPFS and served to the browser for client-side proof generation.

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
