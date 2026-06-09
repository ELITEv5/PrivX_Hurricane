# PrivX Hurricane — Proof of Privacy Protocol

> Zero-knowledge token shielding on PulseChain. Shield tokens. Generate a Proof of Privacy. Mine PRIVX.

**PrivX Hurricane** &nbsp;·&nbsp; [Live](https://elitev5.github.io/PrivX_Hurricane/privx.html) &nbsp;·&nbsp; [IPFS](https://ipfs.io/ipfs/bafybeicc5rpmxdpprhtt3jecudzcevipnfhfeqxbdlau726vv3grl3mf6q/index.html)

**PrivX Pay ATM** &nbsp;·&nbsp; [Live](https://elitev5.github.io/PrivX_Hurricane/privx-pay.html) &nbsp;·&nbsp; [IPFS](https://ipfs.io/ipfs/bafybeicc5rpmxdpprhtt3jecudzcevipnfhfeqxbdlau726vv3grl3mf6q/privx-pay.html) — private stablecoin cash, desktop ATM

**PrivX Pay Wallet** &nbsp;·&nbsp; [Live](https://elitev5.github.io/PrivX_Hurricane/privx-pay-wallet.html) &nbsp;·&nbsp; [IPFS](https://ipfs.io/ipfs/bafybeicc5rpmxdpprhtt3jecudzcevipnfhfeqxbdlau726vv3grl3mf6q/privx-pay-wallet.html) — PIN-protected mobile wallet with seed recovery

**Chain:** PulseChain (chainId 369)

---

## What Is PrivX Hurricane?

PrivX Hurricane is PulseChain's first PLONK-based privacy protocol, and the first of its kind to shield multiple tokens simultaneously. Deposit any of 6 supported tokens into a shielded pool and withdraw them to a completely unlinked address. Every withdrawal generates a **Proof of Privacy (POP)** and automatically pays PRIVX mining rewards. No PRIVX required to deposit — it is what you earn, not what you spend.

The withdrawal proof is a **PLONK zero-knowledge proof** generated entirely in your browser. It proves you know a valid deposit note without revealing which deposit it came from. The on-chain verifier checks the math. The contract releases your tokens. No one — not the development team, not a node operator, not a block explorer — can link your deposit to your withdrawal.

---

## How It Works

```
Deposit                                    Withdraw
──────                                    ────────
You have tokens to shield                 From a fresh wallet
  │                                         │
  ├─ Generate random nullifier + secret      ├─ Paste your private note
  ├─ Compute commitment = Poseidon(n, s)     ├─ Browser builds Merkle proof
  ├─ Approve shield contract                 ├─ Generates PLONK ZK proof (~20s)
  ├─ Deposit: commitment stored in tree      ├─ Contract verifies proof on-chain
  ├─ 0.5% fee → FeeVault                    ├─ Tokens → your fresh wallet
  └─ Save your private note                 └─ PRIVX mining reward paid instantly
```

**The note is the only key.** It encodes your nullifier and secret. Losing it means the funds are locked in the contract forever. For seed-based note recovery, use the **PrivX Pay Wallet** — it derives every note from a master seed so your full history can be scanned back from the blockchain after device loss.

---

## Supported Tokens — Hurricane: 6 Tokens, 24 Pools · Pay: 3 Tokens, 18 Pools

**PrivX Hurricane**

| Token | Denominations | Token CA |
|---|---|---|
| PLS (WPLS) | 100K / 1M / 10M / 100M | `0xA1077a294dDE1B09bB078844df40758a5D0f9a27` |
| HEX | 1K / 10K / 100K / 1M | `0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39` |
| PLSX | 100K / 1M / 10M / 100M | `0x95B303987A60C71504D99Aa1b13B4DA07b0790ab` |
| DAI | 10 / 100 / 1K / 10K | `0xefD766cCb38EaF1dfd701853BFCe31359239F305` |
| WETH | 0.01 / 0.1 / 1 / 10 | `0x02DcdD04e3F455D838cd1249292C58f3B79e3C3C` |
| PrivX | 100 / 1K / 10K / 100K | `0x34310B5d3a8d1e5f8e4A40dcf38E48d90170E986` |

**PrivX Pay**

| Token | Denominations | Token CA |
|---|---|---|
| DAI | $1 / $5 / $10 / $20 / $50 / $100 | `0xefD766cCb38EaF1dfd701853BFCe31359239F305` |
| USDC | $1 / $5 / $10 / $20 / $50 / $100 | `0x15D38573d2feeb82e7ad5187aB8c1D52810B1f07` |
| pSunDAI | $1 / $5 / $10 / $20 / $50 / $100 | `0x1c2a9d0d6c641F92284EeCF8aC62D1e39D703E4f` |

DAI $10 / $100 shields serve both protocols — same contract address in both Hurricane and Pay.

---

## Architecture

### Shield Contracts

Two shield contract variants cover all tokens:

**`PrivX_Shield_V3.sol`** — Universal ERC-20 shield. Used for HEX, PLSX, DAI, WETH, and PrivX. Fully immutable after deployment — no owner, no admin key, no upgrade proxy, no pause function. V3 adds SNARK field overflow checks on all 4 public inputs.

**`PrivX_PLS_Shield_V3.sol`** — Native PLS shield. Payable `deposit()` wraps PLS→WPLS internally; `withdraw()` unwraps WPLS→PLS and sends native PLS to the recipient address. Ensures recipients receive native PLS, not WPLS — critical for funding fresh wallets. Same immutability and V3 security guarantees as the ERC-20 variant.

`miningRewardAmount` is a constructor parameter that normalises POP rewards across all tokens regardless of denomination size or token decimals.

**Hurricane fixed tiers (all 6 tokens):**

| Tier | `miningRewardAmount` | PRIVX reward at peak vault |
|---|---|---|
| d0 | `100e18` | ~1 PRIVX |
| d1 | `1_000e18` | ~10 PRIVX |
| d2 | `10_000e18` | ~100 PRIVX |
| d3 | `100_000e18` | ~1,000 PRIVX |

**Pay proportional tiers (stables — denomination × 10 PRIVX):**

| Denomination | `miningRewardAmount` | PRIVX reward at peak vault |
|---|---|---|
| $1 | `10e18` | ~0.1 PRIVX |
| $10 | `100e18` | ~1 PRIVX |
| $100 | `1_000e18` | ~10 PRIVX |

- **Merkle tree:** 14-level incremental Poseidon Merkle tree (16,384 leaves per pool)
- **Root history:** Last 100 roots stored — allows ~100 concurrent pending withdrawals
- **Circuit:** `PrivXMixer(14)` — PLONK proof with 4 public signals `[root, nullifierHash, denomination, recipient]`
- **Fee model:** 0.5% of denomination in the shielded token, sent to FeeVault on deposit
- **POP rewards:** `mineReward()` called on Mining Vault on every successful withdrawal

### Fee Vault

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

LP tokens are permanently locked — Protocol-Owned Liquidity that compounds with every deposit across all 24 Hurricane pools and 18 Pay pools.

### Mining Vault (`PrivX_Mining_Vault_V2.sol`)

Pays PRIVX rewards to withdrawal recipients automatically.

- **Emission curve:** Quadratic decay relative to peak balance — rewards highest when vault is full
- **Auto-refill:** Fee Vault calls `topUp()` on every conversion cycle
- **Cooldown:** 5-minute per-user cooldown prevents reward spam
- **Max rate:** 10% of `miningRewardAmount` per withdrawal (BASE_RATE_BP = 100)
- **Immutable:** Sealed after all shields are added — no further changes possible

### ZK Circuit (`circuits/PrivXMixer.circom`)

```
Private inputs (30):  nullifier, secret, pathIndices[14], siblings[14]
Public signals (4):   root, nullifierHash, denomination, recipient

Constraints (8,330):
  commitment    = Poseidon(nullifier, secret)
  commitment    ∈ Merkle tree with root
  nullifierHash = Poseidon(nullifier, denomination)
  recipient     = bound into proof at generation time (PLONK Fiat-Shamir)
```

The recipient address is cryptographically embedded into the ZK proof at generation time — MEV bots cannot redirect withdrawals even if they observe the proof in the mempool. `nullifierHash` binds to the denomination, preventing note replay across pools. **The same circuit and proving key power every shield — adding a new token requires no circuit changes.**

---

## Deployed Contracts — PulseChain Mainnet

### Shared Infrastructure

| Contract | Address |
|---|---|
| PLONK Verifier | [`0xcEDa1071542d537221B5a01BFd1cF920cF8B9829`](https://scan.pulsechain.com/address/0xcEDa1071542d537221B5a01BFd1cF920cF8B9829) |
| Poseidon Hasher | [`0x72740d65A93f2e9d9741234371d62FeE36AEf9dF`](https://scan.pulsechain.com/address/0x72740d65A93f2e9d9741234371d62FeE36AEf9dF) |
| POP Mining Vault V2 | [`0x7f6D1165a15a7DC4Bbbf27C6C18de7bfAA9E718C`](https://scan.pulsechain.com/address/0x7f6D1165a15a7DC4Bbbf27C6C18de7bfAA9E718C) |
| Fee Vault | [`0x54818356b47b5F7b52DceAbf2B6eF52Cf8b072Fd`](https://scan.pulsechain.com/address/0x54818356b47b5F7b52DceAbf2B6eF52Cf8b072Fd) |
| PRIVX Token | [`0x34310B5d3a8d1e5f8e4A40dcf38E48d90170E986`](https://scan.pulsechain.com/address/0x34310B5d3a8d1e5f8e4A40dcf38E48d90170E986) |

### PLS Shields (V3 — native PLS wrap/unwrap)

| Denomination | Address |
|---|---|
| 100,000 PLS | [`0x4B24FDAEC9A7C11aBE0011Ae812358F2Fe14fCC8`](https://scan.pulsechain.com/address/0x4B24FDAEC9A7C11aBE0011Ae812358F2Fe14fCC8) |
| 1,000,000 PLS | [`0x0aC3EF852345c9385b7aEd07d592241bC8BD3547`](https://scan.pulsechain.com/address/0x0aC3EF852345c9385b7aEd07d592241bC8BD3547) |
| 10,000,000 PLS | [`0x7E89CF958bA87Ca35b2DD988620F35e323733bd5`](https://scan.pulsechain.com/address/0x7E89CF958bA87Ca35b2DD988620F35e323733bd5) |
| 100,000,000 PLS | [`0xDe853DCcE8325FDe98cE1794143115811BA0822d`](https://scan.pulsechain.com/address/0xDe853DCcE8325FDe98cE1794143115811BA0822d) |

### HEX Shields (V3)

| Denomination | Address |
|---|---|
| 1,000 HEX | [`0xfaF31B882e8E6f108c4174b27317D933fEDbC904`](https://scan.pulsechain.com/address/0xfaF31B882e8E6f108c4174b27317D933fEDbC904) |
| 10,000 HEX | [`0x266E7Ee64254aD21B2b455681d6Dd42c94f0b59f`](https://scan.pulsechain.com/address/0x266E7Ee64254aD21B2b455681d6Dd42c94f0b59f) |
| 100,000 HEX | [`0xf5900Ca66bb477f27d2f48Ea38349F463B818627`](https://scan.pulsechain.com/address/0xf5900Ca66bb477f27d2f48Ea38349F463B818627) |
| 1,000,000 HEX | [`0x4495808b2Cd678CC59805A9E2Bd1C96805529F81`](https://scan.pulsechain.com/address/0x4495808b2Cd678CC59805A9E2Bd1C96805529F81) |

### PLSX Shields (V3)

| Denomination | Address |
|---|---|
| 100,000 PLSX | [`0xa17c9e32AC4C0e231c472e8958CbC067916Da8FB`](https://scan.pulsechain.com/address/0xa17c9e32AC4C0e231c472e8958CbC067916Da8FB) |
| 1,000,000 PLSX | [`0x7E1395607AAE569ef246Dfe1E9E8723ef7c956b3`](https://scan.pulsechain.com/address/0x7E1395607AAE569ef246Dfe1E9E8723ef7c956b3) |
| 10,000,000 PLSX | [`0xD3B401bd5578D8887243198D39705dCaC72870d4`](https://scan.pulsechain.com/address/0xD3B401bd5578D8887243198D39705dCaC72870d4) |
| 100,000,000 PLSX | [`0x61bBB40C624bd8F3d75A73324F58F26Eb7A034CD`](https://scan.pulsechain.com/address/0x61bBB40C624bd8F3d75A73324F58F26Eb7A034CD) |

### DAI Shields (V3 — shared with Pay $10/$100)

| Denomination | Address |
|---|---|
| 10 DAI | [`0xFe63926D5535EA3B6e1EA204bdDf93F4E2a4b906`](https://scan.pulsechain.com/address/0xFe63926D5535EA3B6e1EA204bdDf93F4E2a4b906) ← also Pay $10 |
| 100 DAI | [`0xDA6e061F10deE54DDcF8B3d054F2fdDC5848Ee79`](https://scan.pulsechain.com/address/0xDA6e061F10deE54DDcF8B3d054F2fdDC5848Ee79) ← also Pay $100 |
| 1,000 DAI | [`0xc78011A35A2416515750C1f095e559b341BF6706`](https://scan.pulsechain.com/address/0xc78011A35A2416515750C1f095e559b341BF6706) |
| 10,000 DAI | [`0x22a62AdcD8307Ca2C3934AC851a1fc4bebfe5Af7`](https://scan.pulsechain.com/address/0x22a62AdcD8307Ca2C3934AC851a1fc4bebfe5Af7) |

### WETH Shields (V3)

| Denomination | Address |
|---|---|
| 0.01 WETH | [`0xAc4590446C34C2A470bd9F273CAD89e5F8E11df5`](https://scan.pulsechain.com/address/0xAc4590446C34C2A470bd9F273CAD89e5F8E11df5) |
| 0.1 WETH | [`0x91BE28f8342dE81ce4646B4e80Bf353ea1568f8C`](https://scan.pulsechain.com/address/0x91BE28f8342dE81ce4646B4e80Bf353ea1568f8C) |
| 1 WETH | [`0xC8666F477e954957b983c3CaE70B2E9Fb288661c`](https://scan.pulsechain.com/address/0xC8666F477e954957b983c3CaE70B2E9Fb288661c) |
| 10 WETH | [`0x62215cCcF17858fc21B3aA05C6184f9115F8c6Da`](https://scan.pulsechain.com/address/0x62215cCcF17858fc21B3aA05C6184f9115F8c6Da) |

### PrivX Shields (V3)

| Denomination | Address |
|---|---|
| 100 PrivX | [`0x25B19282552cc67D4C95Ad9986FCC154166Db5BB`](https://scan.pulsechain.com/address/0x25B19282552cc67D4C95Ad9986FCC154166Db5BB) |
| 1,000 PrivX | [`0xFFeADBA1cbe580aE98bEBcB7202aF546E6F92D68`](https://scan.pulsechain.com/address/0xFFeADBA1cbe580aE98bEBcB7202aF546E6F92D68) |
| 10,000 PrivX | [`0xF7EeC1FEE57A19102aa6227A851D9F5511310Bb9`](https://scan.pulsechain.com/address/0xF7EeC1FEE57A19102aa6227A851D9F5511310Bb9) |
| 100,000 PrivX | [`0x03EE452ea4049b97917Ea54e7fe06262290c5041`](https://scan.pulsechain.com/address/0x03EE452ea4049b97917Ea54e7fe06262290c5041) |

---

## PRIVX Token

PRIVX is the **Proof-of-Privacy mining token**. Fixed supply of 21 million. No minting ever.

**Value flywheel:**

```
Shield deposit (any of 6 Hurricane tokens / 3 Pay tokens, 42 total pools)
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

PrivX Hurricane's cryptographic foundation rests on the **Hermez Network Powers of Tau** — a multi-party computation ceremony with **54 independent contributors** from across the world. The security guarantee is unconditional: every single one of those 54 participants would need to have secretly preserved their randomness and coordinated together to compromise the system.

### Why PLONK Changes Everything

Unlike Groth16 — used by earlier privacy protocols — **PLONK requires no circuit-specific trusted setup**. There is no secondary ceremony, no per-circuit toxic waste, and no privileged developer key. The universal SRS derived from the Hermez ceremony is all that is needed, permanently and for every token PrivX Hurricane ever shields.

- Adding a new shielded token requires **no new ceremony**
- There is **no single point of failure** at circuit compile time
- The proving key is a mathematical consequence of the ceremony — not a secret

### Ceremony Fingerprint

```
SHA256: 489be9e5ac65d524f7b1685baac8a183c6e77924fdb73d2b8105e335f277895d
```

To cryptographically verify the full contribution chain (54 contributors):
```bash
snarkjs powersoftau verify build/powersOfTau28_hez_final_14.ptau
```

The proving key (`PrivXMixer14_final.zkey`) is pinned to IPFS and served directly to the browser for fully client-side proof generation.

---

## Security Properties

| Property | Status |
|---|---|
| Trusted setup | ✅ Hermez MPC — 54 contributors |
| No phase-2 / circuit toxic waste | ✅ PLONK universal SRS |
| Proving key publicly verifiable | ✅ SHA256 fingerprint published |
| Proof generated client-side | ✅ Never leaves your browser |
| Recipient bound into ZK proof | ✅ MEV-proof withdrawals |
| Double-spend prevention | ✅ On-chain nullifier mapping |
| Field-element aliasing (V3) | ✅ All 4 public signals checked < SNARK_FIELD before verification |
| Cross-denomination replay blocked | ✅ nullifierHash = Poseidon(nullifier, denomination) |
| Zero-root deposits blocked | ✅ require(commitment != 0) |
| No owner / admin key on shields | ✅ Fully immutable |
| No upgrade proxy | ✅ |
| No pause function | ✅ |
| Reentrancy protection | ✅ OpenZeppelin ReentrancyGuard |
| Safe token transfers | ✅ OpenZeppelin SafeERC20 |
| Pre-proof spent-note detection | ✅ On-chain check before proof generation — no wasted compute |

The shield contracts are immutable from the moment of deployment. The development team cannot change the fee, pause withdrawals, blacklist addresses, or alter any parameter. **If you know the note, you can withdraw — always, unconditionally, forever.**

### Circuit Analysis

The PrivXMixer(14) circuit was analysed using two independent methods: snarkjs R1CS constraint inspection and **Ecne** — a Julia-based SMT solver that mechanically verifies every signal in the R1CS is uniquely determined by the inputs.

**Signal counts verified (snarkjs R1CS):**

| Signal | Expected | Actual | |
|---|---|---|---|
| Private inputs | 30 | 30 | ✅ |
| Public inputs | 4 | 4 | ✅ |
| Total constraints | ~8,300 | 8,330 | ✅ |
| Wire / constraint gap | < 50 | 19 | ✅ |

**Ecne SMT analysis — under-constrained signal check:**

| Check | Result | |
|---|---|---|
| Variables solved | 8,349 / 8,349 | ✅ |
| Under-constrained signals | 0 | ✅ |
| Bad constraints | 0 | ✅ |

**Critical constraints confirmed:**

| Constraint | Method |
|---|---|
| nullifierHash = Poseidon(nullifier, denomination) | Wire aliasing — same R1CS wire |
| commitment = Poseidon(nullifier, secret) in Merkle tree | Explicit constraint chain |
| Merkle root matches computed tree root | Wire aliasing — same R1CS wire |
| pathIndices[i] ∈ {0,1} for all 14 levels | Explicit quadratic constraints |
| denomination in constraint system | Squaring constraint + nullifierHash use |
| recipient in constraint system | Squaring + PLONK public input commitment |

Ecne confirmed all 8,349 signals are uniquely determined — no signal can be freely set by a prover without violating a constraint. The wire/constraint gap of 19 is consistent with this result.

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
│   ├── PrivX_Shield_V3.sol            # Universal ERC-20 shield (HEX, PLSX, DAI, WETH, PrivX)
│   ├── PrivX_PLS_Shield_V3.sol        # Native PLS shield (wraps/unwraps WPLS internally)
│   ├── PrivX_FeeVault.sol             # Fee conversion → POL + rewards + burn
│   └── PrivX_Mining_Vault_V2.sol      # POP reward distributor
├── build/
│   ├── PrivXMixer14_final.zkey        # Proving key (pinned to IPFS)
│   ├── verification_key.json          # For verifier contract regeneration
│   ├── PrivXMixer.r1cs                # Compiled constraints
│   └── powersOfTau28_hez_final_14.ptau # Hermez ceremony file
├── privx.html                         # PrivX Hurricane dapp (single file, no build step)
├── relayer.html                       # Relayer UI — submit proofs on behalf of users
├── privx-pay.html                     # PrivX Pay ATM — deposit stablecoins, receive bearer notes
├── privx-pay-wallet.html              # PrivX Pay Wallet — PIN-protected, seed-derived note storage
├── PrivX-IFPS/                        # Combined IPFS build — entire protocol in one directory
│   ├── index.html                     #   PrivX Hurricane
│   ├── privx-pay.html                 #   PrivX Pay ATM
│   ├── privx-pay-wallet.html          #   PrivX Pay Wallet
│   ├── relayer.html
│   ├── sw.js                          #   Shared service worker (all pages, one scope)
│   ├── manifest.json                  #   Hurricane PWA manifest
│   ├── privx-pay-manifest.json        #   Pay ATM PWA manifest
│   └── privx-pay-wallet-manifest.json #   Wallet PWA manifest
└── scripts/
    └── build_circuit.sh               # Circuit compile + trusted setup + verifier export
```

---

## Running Locally

No build step required. Open `privx.html` directly or serve with any static file server:

```bash
npx serve .
# or
python3 -m http.server 8080
```

Requires MetaMask (or any EIP-1193 wallet) connected to PulseChain (chainId 369).

The proving key (~31MB) is fetched from IPFS on first use and cached in memory for the session. Proof generation takes 15–30 seconds depending on device.

---

## Deploying New Token Shields

Use `PrivX_Shield_V3.sol` for all new ERC-20 token shields (HEX, PLSX, DAI, WETH, PrivX, Pay stables). Use `PrivX_PLS_Shield_V3.sol` for PLS — it wraps/unwraps WPLS internally so recipients receive native PLS. Set `_miningRewardAmount` to the V3 tier value:

```
Hurricane fixed tiers (all tokens):
  d0 →    100e18   (~1 PRIVX reward at peak vault)
  d1 →  1_000e18
  d2 → 10_000e18
  d3 → 100_000e18

Pay stables (denomination × 10 PRIVX):
  $1  →    10e18   $5  →    50e18
  $10 →   100e18   $20 →   200e18
  $50 →   500e18   $100 → 1_000e18
```

**Setup flow:**
1. Deploy 4× shield contracts with token address, denominations, and `_miningRewardAmount`
2. Call `addShield()` × 4 on Mining Vault
3. Call `setTokenConfig()` on Fee Vault for the new token
4. Update UI with new shield addresses

The ZK circuit, proving key, and verifier contract do not change. No new ceremony required.

---

## PrivX Pay — Private Stablecoin Cash

PrivX Pay extends the protocol into a cash-like payment system built on the same ZK infrastructure.

### PrivX Pay ATM (`privx-pay.html`)

Desktop interface for shielding stablecoins (DAI, pSunDAI, USDC) into bearer notes. Works like a cash machine — deposit, receive an encrypted denomination note, scan the QR into your phone wallet.

- Notes are fixed denominations ($1 / $5 / $10 / $20 / $50 / $100)
- 0.5% deposit fee, PRIVX mining reward on redemption
- Automatic on-chain spent check before proof generation

### PrivX Pay Wallet (`privx-pay-wallet.html`)

PIN-protected mobile PWA for holding and redeeming notes. Designed to live on your phone's home screen.

- AES-256-GCM encryption, PBKDF2 250k iterations
- **Seed-derived notes:** every note deposited through the wallet is derived from a 128-bit master seed via `SHA-256(seed + ':n:' + index)` — full note history recoverable by scanning the blockchain with the seed alone
- Seed is masked at rest, tap-to-reveal with 30-second auto-hide
- Notes scanned in from the ATM are random (not seed-derived) and require the encrypted wallet backup for recovery
- Relayer-style **Redeem** tab for merchants: scan customer QR, ZK proof generated in browser, funds arrive instantly

### Deployed Contracts — PrivX Pay Shields

**Shared Infrastructure**

| Contract | Address |
|---|---|
| Mining Vault | [`0x7f6D1165a15a7DC4Bbbf27C6C18de7bfAA9E718C`](https://scan.pulsechain.com/address/0x7f6D1165a15a7DC4Bbbf27C6C18de7bfAA9E718C) |
| Fee Vault | [`0x54818356b47b5F7b52DceAbf2B6eF52Cf8b072Fd`](https://scan.pulsechain.com/address/0x54818356b47b5F7b52DceAbf2B6eF52Cf8b072Fd) |
| PRIVX Token | [`0x34310B5d3a8d1e5f8e4A40dcf38E48d90170E986`](https://scan.pulsechain.com/address/0x34310B5d3a8d1e5f8e4A40dcf38E48d90170E986) |

**DAI Shields (V4)** · Token: [`0xefD766cCb38EaF1dfd701853BFCe31359239F305`](https://scan.pulsechain.com/address/0xefD766cCb38EaF1dfd701853BFCe31359239F305)

| Denomination | Shield Contract |
|---|---|
| $1 | [`0xdDdf0fe3A1A85eA5A913347FF8069a04390e4C31`](https://scan.pulsechain.com/address/0xdDdf0fe3A1A85eA5A913347FF8069a04390e4C31) |
| $5 | [`0x1D57f03d48A2E5d9cE97d73F2f7710c313ee8577`](https://scan.pulsechain.com/address/0x1D57f03d48A2E5d9cE97d73F2f7710c313ee8577) |
| $10 | [`0xFe63926D5535EA3B6e1EA204bdDf93F4E2a4b906`](https://scan.pulsechain.com/address/0xFe63926D5535EA3B6e1EA204bdDf93F4E2a4b906) ← also Hurricane 10 DAI |
| $20 | [`0xE0fA07E91a4A1005C63f9414Fe11B9E84C9C599B`](https://scan.pulsechain.com/address/0xE0fA07E91a4A1005C63f9414Fe11B9E84C9C599B) |
| $50 | [`0x7cfe4718be7991fCA3979Fb0008Bd26e51D01980`](https://scan.pulsechain.com/address/0x7cfe4718be7991fCA3979Fb0008Bd26e51D01980) |
| $100 | [`0xDA6e061F10deE54DDcF8B3d054F2fdDC5848Ee79`](https://scan.pulsechain.com/address/0xDA6e061F10deE54DDcF8B3d054F2fdDC5848Ee79) ← also Hurricane 100 DAI |

**pSunDAI Shields (V4)** · Token: [`0x1c2a9d0d6c641F92284EeCF8aC62D1e39D703E4f`](https://scan.pulsechain.com/address/0x1c2a9d0d6c641F92284EeCF8aC62D1e39D703E4f)

| Denomination | Shield Contract |
|---|---|
| $1 | [`0x35187f9aa04297A17Ce123B99e19573fCa389b86`](https://scan.pulsechain.com/address/0x35187f9aa04297A17Ce123B99e19573fCa389b86) |
| $5 | [`0x163b7E39E9019245dF6648b7B9DE99eDe328705F`](https://scan.pulsechain.com/address/0x163b7E39E9019245dF6648b7B9DE99eDe328705F) |
| $10 | [`0x6b17dD5c9DCde755AF4f1797e626B23A7Ec33CD4`](https://scan.pulsechain.com/address/0x6b17dD5c9DCde755AF4f1797e626B23A7Ec33CD4) |
| $20 | [`0xc8aCD0E405939CF7c29F3e16037098F186d83B1A`](https://scan.pulsechain.com/address/0xc8aCD0E405939CF7c29F3e16037098F186d83B1A) |
| $50 | [`0xbEb3eb96F3379D664f314aeEf1D401D630bE8eA4`](https://scan.pulsechain.com/address/0xbEb3eb96F3379D664f314aeEf1D401D630bE8eA4) |
| $100 | [`0x1720103Ac2f5E8d50Cb52bf3f55A2da973E7959D`](https://scan.pulsechain.com/address/0x1720103Ac2f5E8d50Cb52bf3f55A2da973E7959D) |

**USDC Shields (V4)** · Token: [`0x15D38573d2feeb82e7ad5187aB8c1D52810B1f07`](https://scan.pulsechain.com/address/0x15D38573d2feeb82e7ad5187aB8c1D52810B1f07)

| Denomination | Shield Contract |
|---|---|
| $1 | [`0x6613d13bf8deB21cA06062904C875b36D053F04e`](https://scan.pulsechain.com/address/0x6613d13bf8deB21cA06062904C875b36D053F04e) |
| $5 | [`0x96A869E58B97736615e57742a920667100A801d7`](https://scan.pulsechain.com/address/0x96A869E58B97736615e57742a920667100A801d7) |
| $10 | [`0xe853A0966C4Add92D8c5935486B7E7fF7194a079`](https://scan.pulsechain.com/address/0xe853A0966C4Add92D8c5935486B7E7fF7194a079) |
| $20 | [`0x658b5d0793b6796D6E3e95671C183b4B2F8CC24A`](https://scan.pulsechain.com/address/0x658b5d0793b6796D6E3e95671C183b4B2F8CC24A) |
| $50 | [`0x835c48cF6270f2efF812254b1425400432652fB0`](https://scan.pulsechain.com/address/0x835c48cF6270f2efF812254b1425400432652fB0) |
| $100 | [`0xc9569CF23D706627d7901ad15d9fBfaA49B0D5E2`](https://scan.pulsechain.com/address/0xc9569CF23D706627d7901ad15d9fBfaA49B0D5E2) |

All 40 PrivX shield contracts are fully immutable — no admin key, no pause, no upgrade. The 0.5% deposit fee and PRIVX mining reward are fixed at construction.

### Note Format

```
hp-<token>-<denomination>-<nullifierHex(62)>-<secretHex(62)>

Example: hp-dai-20-a3f9...c1d2-b8e4...7f03
```

Bearer instruments — whoever holds the string can redeem it. Treat like cash.

---

## Why Privacy?

Financial privacy is a fundamental human right. Every transaction on a public blockchain is visible to every employer, government, creditor, and advertiser — permanently, immutably, forever. Transparency without the option of privacy is not a financial system. It is a surveillance system.

PrivX Hurricane exists to give people the option to transact privately. The contracts are ownerless. The math is the law.

---

## License

MIT

---

*Part of the [Sun Systems Protocol](https://elitev5.github.io/Sun-Systems/) · 2026 © PrivX Protocol*
