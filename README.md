# PrivX Hurricane — Proof of Privacy Protocol

> Zero-knowledge token shielding on PulseChain. Shield tokens. Generate a Proof of Privacy. Mine PRIVX.

**PrivX Hurricane** &nbsp;·&nbsp; [Live](https://elitev5.github.io/PrivX_Hurricane/privx.html) &nbsp;·&nbsp; [IPFS](https://ipfs.io/ipfs/bafybeihyohefvtegd6e7v7lclzaofhaokcqbaewd2n4xrxaatrkquyxpea/index.html)

**PrivX Pay ATM** &nbsp;·&nbsp; [Live](https://elitev5.github.io/PrivX_Hurricane/privx-pay.html) &nbsp;·&nbsp; [IPFS](https://ipfs.io/ipfs/bafybeihyohefvtegd6e7v7lclzaofhaokcqbaewd2n4xrxaatrkquyxpea/privx-pay.html) — private stablecoin cash, desktop ATM

**PrivX Pay Wallet** &nbsp;·&nbsp; [Live](https://elitev5.github.io/PrivX_Hurricane/privx-pay-wallet.html) &nbsp;·&nbsp; [IPFS](https://ipfs.io/ipfs/bafybeihyohefvtegd6e7v7lclzaofhaokcqbaewd2n4xrxaatrkquyxpea/privx-pay-wallet.html) — PIN-protected mobile wallet with seed recovery

**Chain:** PulseChain (chainId 369)

---

## What Is PrivX Hurricane?

PrivX Hurricane is PulseChain's first PLONK-based privacy protocol, and the first of its kind to shield multiple tokens simultaneously. Deposit any of 9 supported tokens into a shielded pool and withdraw them to a completely unlinked address. Every withdrawal generates a **Proof of Privacy (POP)** and automatically pays PRIVX mining rewards. No PRIVX required to deposit — it is what you earn, not what you spend.

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

## Supported Tokens — 9 Tokens, 36 Pools

| Token | Denominations | Token CA |
|---|---|---|
| PLS | 100K / 1M / 10M / 100M | Native |
| HEX | 1K / 10K / 100K / 1M | `0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39` |
| PLSX | 100K / 1M / 10M / 100M | `0x95B303987A60C71504D99Aa1b13B4DA07b0790ab` |
| DAI | 10 / 100 / 1K / 10K | `0xefD766cCb38EaF1dfd701853BFCe31359239F305` |
| WETH | 0.01 / 0.1 / 1 / 10 | `0x02DcdD04e3F455D838cd1249292C58f3B79e3C3C` |
| pSunDAI | 10 / 100 / 1K / 10K | `0x1c2a9d0d6c641F92284EeCF8aC62D1e39D703E4f` |
| pDAI | 1K / 10K / 100K / 1M | `0x6B175474E89094C44Da98b954EedeAC495271d0F` |
| pCOCK | 100 / 1K / 10K / 100K | `0xc10A4Ed9b4042222d69ff0B374eddd47ed90fC1F` |
| PrivX | 100 / 1K / 10K / 100K | `0x34310B5d3a8d1e5f8e4A40dcf38E48d90170E986` |

---

## Architecture

### Shield Contracts

Two shield contract variants share the same ZK circuit:

**`PrivX_Shield_V2.sol`** — Universal ERC-20 shield. Used for all tokens except native PLS. Fully immutable after deployment — no owner, no admin key, no upgrade proxy, no pause function.

**`PrivX_PLS_Shield.sol`** — Native PLS shield. Wraps PLS → WPLS on deposit and unwraps WPLS → PLS on withdrawal. Same immutability guarantees.

Both use `miningRewardAmount` — a constructor parameter that normalises POP rewards across all tokens regardless of denomination size or token decimals. Every d0 denomination earns the same PRIVX regardless of which token is shielded:

| Tier | `miningRewardAmount` | PRIVX reward at peak vault |
|---|---|---|
| d0 | `1_000e18` | ~10 PRIVX |
| d1 | `10_000e18` | ~100 PRIVX |
| d2 | `100_000e18` | ~1,000 PRIVX |
| d3 | `1_000_000e18` | ~10,000 PRIVX |

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

LP tokens are permanently locked — Protocol-Owned Liquidity that compounds with every deposit across all 36 pools.

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

### PLS Shields

| Denomination | Address |
|---|---|
| 100,000 PLS | [`0xFdbd8a02f112e722543C12bce3596f42b9Bb3b72`](https://scan.pulsechain.com/address/0xFdbd8a02f112e722543C12bce3596f42b9Bb3b72) |
| 1,000,000 PLS | [`0xfD03a99A337931de9a217E5836046CBF13578B18`](https://scan.pulsechain.com/address/0xfD03a99A337931de9a217E5836046CBF13578B18) |
| 10,000,000 PLS | [`0xE97135be5b9D6A3020C733AD122c4A6092ABF1F7`](https://scan.pulsechain.com/address/0xE97135be5b9D6A3020C733AD122c4A6092ABF1F7) |
| 100,000,000 PLS | [`0xEB4297A2c769eD02778Fa9D3197a58665beD8834`](https://scan.pulsechain.com/address/0xEB4297A2c769eD02778Fa9D3197a58665beD8834) |

### HEX Shields

| Denomination | Address |
|---|---|
| 1,000 HEX | [`0x833F7eDDbCe1e713e83b83006A793C3A51d00eE2`](https://scan.pulsechain.com/address/0x833F7eDDbCe1e713e83b83006A793C3A51d00eE2) |
| 10,000 HEX | [`0xAdd967989567A8cD6a5473e79B43A44fca139d2C`](https://scan.pulsechain.com/address/0xAdd967989567A8cD6a5473e79B43A44fca139d2C) |
| 100,000 HEX | [`0x7FC864dA7aAcc6EcAf6E9D5baC442429734a66Ee`](https://scan.pulsechain.com/address/0x7FC864dA7aAcc6EcAf6E9D5baC442429734a66Ee) |
| 1,000,000 HEX | [`0x7D33b4ace754062d17256a65c046068a7f49651C`](https://scan.pulsechain.com/address/0x7D33b4ace754062d17256a65c046068a7f49651C) |

### PLSX Shields

| Denomination | Address |
|---|---|
| 100,000 PLSX | [`0x9632527f45A93579C0c26b58c7d99267997264Fb`](https://scan.pulsechain.com/address/0x9632527f45A93579C0c26b58c7d99267997264Fb) |
| 1,000,000 PLSX | [`0x0C0aFe4Df8DBf983A3045AC1FB04d6b2f503d4fe`](https://scan.pulsechain.com/address/0x0C0aFe4Df8DBf983A3045AC1FB04d6b2f503d4fe) |
| 10,000,000 PLSX | [`0x951bde47464C6a1BB34BF10bC85a7cAE9C418534`](https://scan.pulsechain.com/address/0x951bde47464C6a1BB34BF10bC85a7cAE9C418534) |
| 100,000,000 PLSX | [`0xF039cEc211769bdc29De85FF19c3dAe85aabA75d`](https://scan.pulsechain.com/address/0xF039cEc211769bdc29De85FF19c3dAe85aabA75d) |

### DAI Shields

| Denomination | Address |
|---|---|
| 10 DAI | [`0x34FC19C51f3CdD7E644f551db6698C3A90112667`](https://scan.pulsechain.com/address/0x34FC19C51f3CdD7E644f551db6698C3A90112667) |
| 100 DAI | [`0x73B23CD11ca4260A266A05539b077CF4CD746bcd`](https://scan.pulsechain.com/address/0x73B23CD11ca4260A266A05539b077CF4CD746bcd) |
| 1,000 DAI | [`0x59f51683F93a2Fe8eE4b34408539Eb982Bbd94B2`](https://scan.pulsechain.com/address/0x59f51683F93a2Fe8eE4b34408539Eb982Bbd94B2) |
| 10,000 DAI | [`0x8491102480Ce130ECA02f68fEBF6867c64FA69ea`](https://scan.pulsechain.com/address/0x8491102480Ce130ECA02f68fEBF6867c64FA69ea) |

### WETH Shields

| Denomination | Address |
|---|---|
| 0.01 WETH | [`0xD446cbF3BBae6f90E7a1a48E853F35A269cE7Cde`](https://scan.pulsechain.com/address/0xD446cbF3BBae6f90E7a1a48E853F35A269cE7Cde) |
| 0.1 WETH | [`0xC028eacB0c047bA28Df00Ab7399f5F60fE6D9a99`](https://scan.pulsechain.com/address/0xC028eacB0c047bA28Df00Ab7399f5F60fE6D9a99) |
| 1 WETH | [`0xEE47263286265Db0551a9895FB02CA892821251F`](https://scan.pulsechain.com/address/0xEE47263286265Db0551a9895FB02CA892821251F) |
| 10 WETH | [`0xb7b951763A8794d2366C0cb9bd5FA79B239de6ee`](https://scan.pulsechain.com/address/0xb7b951763A8794d2366C0cb9bd5FA79B239de6ee) |

### pSunDAI Shields

| Denomination | Address |
|---|---|
| 10 pSunDAI | [`0xB2C642DB931B9E8FdC0A2014C71E8C6Da480f3f9`](https://scan.pulsechain.com/address/0xB2C642DB931B9E8FdC0A2014C71E8C6Da480f3f9) |
| 100 pSunDAI | [`0xD8F8D437210EfE57F0161606F62C594290e17A7C`](https://scan.pulsechain.com/address/0xD8F8D437210EfE57F0161606F62C594290e17A7C) |
| 1,000 pSunDAI | [`0xcd47aea1ff4cF308CF467B939C0Bb95aFA55DeFC`](https://scan.pulsechain.com/address/0xcd47aea1ff4cF308CF467B939C0Bb95aFA55DeFC) |
| 10,000 pSunDAI | [`0x085f0f464fF5cc5C50e176A50f3EF8bE3513B652`](https://scan.pulsechain.com/address/0x085f0f464fF5cc5C50e176A50f3EF8bE3513B652) |

### pDAI Shields

| Denomination | Address |
|---|---|
| 1,000 pDAI | [`0x94D0Df289cE310462Fee8137aF945381844B94D1`](https://scan.pulsechain.com/address/0x94D0Df289cE310462Fee8137aF945381844B94D1) |
| 10,000 pDAI | [`0xc00D854d2fCBEdBe8A717c01a15C1351722858E7`](https://scan.pulsechain.com/address/0xc00D854d2fCBEdBe8A717c01a15C1351722858E7) |
| 100,000 pDAI | [`0x5136467D3E81bF2a722f364900DF2982adeE02EE`](https://scan.pulsechain.com/address/0x5136467D3E81bF2a722f364900DF2982adeE02EE) |
| 1,000,000 pDAI | [`0xBbaFF183588FAB20cC24F67De7cd4263670a09E5`](https://scan.pulsechain.com/address/0xBbaFF183588FAB20cC24F67De7cd4263670a09E5) |

### pCOCK Shields

| Denomination | Address |
|---|---|
| 100 pCOCK | [`0x8F63010C4e5FE11f09654B9ff3471e81C36b4883`](https://scan.pulsechain.com/address/0x8F63010C4e5FE11f09654B9ff3471e81C36b4883) |
| 1,000 pCOCK | [`0x9DB59C1dc7C047d2c54ADb7c34f5E160cc94f52A`](https://scan.pulsechain.com/address/0x9DB59C1dc7C047d2c54ADb7c34f5E160cc94f52A) |
| 10,000 pCOCK | [`0x81529f59F47Ed1f12D934e9cCa61a1637Ed1D02c`](https://scan.pulsechain.com/address/0x81529f59F47Ed1f12D934e9cCa61a1637Ed1D02c) |
| 100,000 pCOCK | [`0xAe177f2e240FE3001addeFb93AAB69E853C5abAb`](https://scan.pulsechain.com/address/0xAe177f2e240FE3001addeFb93AAB69E853C5abAb) |

### PrivX Shields

| Denomination | Address |
|---|---|
| 100 PrivX | [`0x74471E88588c2dF518379c4f9feC981158f741F4`](https://scan.pulsechain.com/address/0x74471E88588c2dF518379c4f9feC981158f741F4) |
| 1,000 PrivX | [`0xAbbF7729949eb15Ba2A9e739b591db7585d252ae`](https://scan.pulsechain.com/address/0xAbbF7729949eb15Ba2A9e739b591db7585d252ae) |
| 10,000 PrivX | [`0x7DBc9558DA5aA494302d2099f5F36F307988a84a`](https://scan.pulsechain.com/address/0x7DBc9558DA5aA494302d2099f5F36F307988a84a) |
| 100,000 PrivX | [`0x72DDf291c8cE3e2DCb7C555b48E09Cd353CE9177`](https://scan.pulsechain.com/address/0x72DDf291c8cE3e2DCb7C555b48E09Cd353CE9177) |

---

## PRIVX Token

PRIVX is the **Proof-of-Privacy mining token**. Fixed supply of 21 million. No minting ever.

**Value flywheel:**

```
Shield deposit (any of 9 tokens, any of 36 pools)
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
│   ├── PrivX_Shield_V2.sol            # Universal ERC-20 shield (all tokens except PLS)
│   ├── PrivX_PLS_Shield.sol           # Native PLS shield (wraps/unwraps WPLS internally)
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

Use `PrivX_Shield_V2.sol` for all new ERC-20 token shields. Set `_miningRewardAmount` to the standard tier value, not the raw denomination wei:

```
d0 → 1_000e18    (~10 PRIVX reward at peak vault)
d1 → 10_000e18
d2 → 100_000e18
d3 → 1_000_000e18
```

For native PLS use `PrivX_PLS_Shield.sol` with the same values.

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
| HP Mining Vault | [`0xf7Abeb9a3ccea1B8c30ca8a6d359c609B0751650`](https://scan.pulsechain.com/address/0xf7Abeb9a3ccea1B8c30ca8a6d359c609B0751650) |
| Fee Vault | [`0x54818356b47b5F7b52DceAbf2B6eF52Cf8b072Fd`](https://scan.pulsechain.com/address/0x54818356b47b5F7b52DceAbf2B6eF52Cf8b072Fd) |
| PRIVX Token | [`0x34310B5d3a8d1e5f8e4A40dcf38E48d90170E986`](https://scan.pulsechain.com/address/0x34310B5d3a8d1e5f8e4A40dcf38E48d90170E986) |

**DAI Shields** · Token: [`0xefD766cCb38EaF1dfd701853BFCe31359239F305`](https://scan.pulsechain.com/address/0xefD766cCb38EaF1dfd701853BFCe31359239F305)

| Denomination | Shield Contract |
|---|---|
| $1 | [`0x9ABb21e92f4f589515A65aEa79dc920b40A799D4`](https://scan.pulsechain.com/address/0x9ABb21e92f4f589515A65aEa79dc920b40A799D4) |
| $5 | [`0x0840430d8870933614EFE7f3F45119CcA738B6E2`](https://scan.pulsechain.com/address/0x0840430d8870933614EFE7f3F45119CcA738B6E2) |
| $10 | [`0x19a9Db059A2C1777Ea4d09dC8d234aD79b21F406`](https://scan.pulsechain.com/address/0x19a9Db059A2C1777Ea4d09dC8d234aD79b21F406) |
| $20 | [`0x1eeB506568054d0bb7e6977c8030B0ffd05Ef0D2`](https://scan.pulsechain.com/address/0x1eeB506568054d0bb7e6977c8030B0ffd05Ef0D2) |
| $50 | [`0xc88c22f57a24A2559a3dd3780cE160241aec709F`](https://scan.pulsechain.com/address/0xc88c22f57a24A2559a3dd3780cE160241aec709F) |
| $100 | [`0x9e85fDdD5d231265b247d3cBC4dB80505582486b`](https://scan.pulsechain.com/address/0x9e85fDdD5d231265b247d3cBC4dB80505582486b) |

**pSunDAI Shields** · Token: [`0x1c2a9d0d6c641F92284EeCF8aC62D1e39D703E4f`](https://scan.pulsechain.com/address/0x1c2a9d0d6c641F92284EeCF8aC62D1e39D703E4f)

| Denomination | Shield Contract |
|---|---|
| $1 | [`0x38e1D3fd69F7A978e6fe5e4de787Cf96b71Fa688`](https://scan.pulsechain.com/address/0x38e1D3fd69F7A978e6fe5e4de787Cf96b71Fa688) |
| $5 | [`0xfd2d44332a54eB89016f95705fBb7C84f917a9B3`](https://scan.pulsechain.com/address/0xfd2d44332a54eB89016f95705fBb7C84f917a9B3) |
| $10 | [`0x3007cFf2B4b79998905146bF41a6730f4f22c629`](https://scan.pulsechain.com/address/0x3007cFf2B4b79998905146bF41a6730f4f22c629) |
| $20 | [`0x7c3CAC0556F00e48fB0E5400EF1877f966609952`](https://scan.pulsechain.com/address/0x7c3CAC0556F00e48fB0E5400EF1877f966609952) |
| $50 | [`0x91EF673aECE26703D9B72E8eB591253F7b26F6B6`](https://scan.pulsechain.com/address/0x91EF673aECE26703D9B72E8eB591253F7b26F6B6) |
| $100 | [`0xcDff42f6803Df9B9D76723263E73F017c97F68F7`](https://scan.pulsechain.com/address/0xcDff42f6803Df9B9D76723263E73F017c97F68F7) |

**USDC Shields** · Token: [`0x15D38573d2feeb82e7ad5187aB8c1D52810B1f07`](https://scan.pulsechain.com/address/0x15D38573d2feeb82e7ad5187aB8c1D52810B1f07)

| Denomination | Shield Contract |
|---|---|
| $1 | [`0x2856661A94483486e25dE8F37DCf867938a13778`](https://scan.pulsechain.com/address/0x2856661A94483486e25dE8F37DCf867938a13778) |
| $5 | [`0x53B91dB1485f687D8d162f1268D8485EBB85dF13`](https://scan.pulsechain.com/address/0x53B91dB1485f687D8d162f1268D8485EBB85dF13) |
| $10 | [`0x59f40474834C6Cb3Bf3A5189f6B6f525d22f80A4`](https://scan.pulsechain.com/address/0x59f40474834C6Cb3Bf3A5189f6B6f525d22f80A4) |
| $20 | [`0x5965FEa1E24472d64F3a24Edb9e663Bc728Caee6`](https://scan.pulsechain.com/address/0x5965FEa1E24472d64F3a24Edb9e663Bc728Caee6) |
| $50 | [`0x124A85fDB4ec3F11Ab257F6d4fC2eD8A4A6661fe`](https://scan.pulsechain.com/address/0x124A85fDB4ec3F11Ab257F6d4fC2eD8A4A6661fe) |
| $100 | [`0x883c74eFC878105cbDd15FB546A1a32F4fA45d5b`](https://scan.pulsechain.com/address/0x883c74eFC878105cbDd15FB546A1a32F4fA45d5b) |

All 18 PrivX Pay shield contracts are fully immutable — no admin key, no pause, no upgrade. The 0.5% deposit fee and PRIVX mining reward are fixed at construction.

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
