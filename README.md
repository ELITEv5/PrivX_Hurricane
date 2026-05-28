# PrivX Hurricane — Proof of Privacy Protocol

> Zero-knowledge token shielding on PulseChain. Shield tokens. Generate a Proof of Privacy. Mine PRIVX.

**Live:** [Hurricane Shield](https://elitev5.github.io/PrivX_Hurricane/index.html) &nbsp;·&nbsp; **Chain:** PulseChain (chainId 369)

---

## What Is PrivX Hurricane?

PrivX Hurricane is a zero-knowledge privacy protocol built on PulseChain. It lets you deposit tokens into a shielded pool and withdraw them to a completely unlinked address — with no on-chain connection between sender and recipient.

The withdrawal proof is a **PLONK zero-knowledge proof** generated entirely in your browser. It proves you know a valid deposit note without revealing which deposit it came from. The on-chain verifier checks the math. The contract releases your tokens. No one — not the development team, not a node operator, not a block explorer — can link your deposit to your withdrawal.

Every withdrawal also produces a **Proof of Privacy (POP)** — a verifiable record that you used the protocol — which triggers an automatic PRIVX mining reward. No claim transaction. No staking. Just use the protocol, earn PRIVX.

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
  ├─ 0.5% fee → FeeVault                    ├─ 1,000 PRIVX → your fresh wallet
  └─ Save your private note                 └─ PRIVX mining reward paid instantly
```

**The note is the only key.** It encodes your nullifier and secret. Losing it means the funds are locked in the contract forever — there is no recovery mechanism.

---

## Architecture

### Shield Contract (`PrivX_Shield.sol`)

One contract per token per denomination. Fully immutable after deployment — no owner, no admin key, no upgrade proxy, no pause function.

- **Merkle tree:** 14-level incremental Poseidon Merkle tree (16,384 leaves)
- **Root history:** Last 100 roots stored, allowing ~100 concurrent pending withdrawals
- **Circuit:** `PrivXMixer(14)` — PLONK proof with public signals `[root, nullifierHash, denomination]`
- **Fee model:** 0.5% of denomination in the shielded token, sent to FeeVault on deposit
- **POP rewards:** `mineReward()` called on Mining Vault on every successful withdrawal

### Fee Vault (`PrivX_FeeVault.sol`)

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
- Supports any ERC-20 fee token; PRIVX and WPLS have optimised paths

### Mining Vault (`PrivX_Mining_Vault_V2.sol`)

Pays PRIVX rewards to withdrawal recipients. Sealed after shield registration.

- **Emission curve:** Quadratic decay relative to peak balance — rewards are highest when vault is full
- **Auto-refill:** Fee Vault calls `topUp()` on every conversion cycle
- **Cooldown:** 5-minute per-user cooldown prevents reward spam
- **Max rate:** 10% of the fee amount per withdrawal (hard cap)

### ZK Circuit (`circuits/PrivXMixer.circom`)

```
Private inputs:  nullifier, secret, pathIndices[14], siblings[14]
Public signals:  root, nullifierHash, denomination

Constraints:
  commitment    = Poseidon(nullifier, secret)
  commitment    ∈ Merkle tree with root
  nullifierHash = Poseidon(nullifier, denomination)
```

The circuit binds `nullifierHash` to the denomination, so a note from one shield cannot be replayed in a different denomination pool. The same circuit and proving key power every shield — adding a new token requires no circuit changes.

---

## Deployed Contracts — PulseChain Mainnet

### Shared Infrastructure

| Contract | Address |
|---|---|
| PLONK Verifier | [`0xcEDa1071542d537221B5a01BFd1cF920cF8B9829`](https://scan.pulsechain.com/address/0xcEDa1071542d537221B5a01BFd1cF920cF8B9829) |
| Poseidon Hasher | [`0x72740d65A93f2e9d9741234371d62FeE36AEf9dF`](https://scan.pulsechain.com/address/0x72740d65A93f2e9d9741234371d62FeE36AEf9dF) |
| PRIVX Token | [`0x34310B5d3a8d1e5f8e4A40dcf38E48d90170E986`](https://scan.pulsechain.com/address/0x34310B5d3a8d1e5f8e4A40dcf38E48d90170E986) |

### PRIVX Shield

| Contract | Address |
|---|---|
| Mining Vault | [`0x925D32ff834285E0faefFBAc83Fc641A71660057`](https://scan.pulsechain.com/address/0x925D32ff834285E0faefFBAc83Fc641A71660057) |
| Fee Vault | [`0xBfa76b6961600331BA83F409789ddA36183F09Bf`](https://scan.pulsechain.com/address/0xBfa76b6961600331BA83F409789ddA36183F09Bf) |
| Shield · 100 PRIVX | [`0x1e06B9A5D519241809701eD29142ef01dDfc9288`](https://scan.pulsechain.com/address/0x1e06B9A5D519241809701eD29142ef01dDfc9288) |
| Shield · 1,000 PRIVX | [`0x6aCC2D19b6cCe5FbeF91AF97e18592B215280161`](https://scan.pulsechain.com/address/0x6aCC2D19b6cCe5FbeF91AF97e18592B215280161) |
| Shield · 10,000 PRIVX | [`0xb2Ef8c01BcC3f5B39d2648d598b90ed98E3cb9Cb`](https://scan.pulsechain.com/address/0xb2Ef8c01BcC3f5B39d2648d598b90ed98E3cb9Cb) |
| Shield · 100,000 PRIVX | [`0xaa2E70cE38C40e07d529b9656124c96eA26197Be`](https://scan.pulsechain.com/address/0xaa2E70cE38C40e07d529b9656124c96eA26197Be) |

---

## PRIVX Token

PRIVX is the **Proof-of-Privacy mining token**. Fixed supply of 21 million. No minting ever.

**Value flywheel:**

```
Shield deposit (any token)
       │
       └─ 0.5% fee → FeeVault
                         │
              ┌──────────┼───────────┐
              ▼          ▼           ▼
          Buy PRIVX   Buy PRIVX   Buy PRIVX
          + add LP    → Vault      → Burn
          (80% POL)   (10% POP)   (10% 🔥)
```

Every token shielded creates buying pressure on PRIVX, deepens its liquidity permanently, and funds mining rewards. The protocol gets stronger the more it is used.

**POP Rewards:**
- Paid automatically on every withdrawal — no claim needed
- Rate = `BASE_RATE_BP × (vaultBalance / peakBalance)²` — quadratic decay
- At full vault: ~1% of fee amount per withdrawal
- Vault refills automatically from FeeVault conversions

---

## Security Properties

| Property | Status |
|---|---|
| No owner or admin key | ✅ |
| No upgrade proxy | ✅ |
| No pause function | ✅ |
| No fee change | ✅ |
| No withdrawal censorship | ✅ |
| Reentrancy protection | ✅ OpenZeppelin ReentrancyGuard |
| Safe token transfers | ✅ OpenZeppelin SafeERC20 |
| Double-spend prevention | ✅ Nullifier hash mapping |
| Root freshness | ✅ 100-root circular history |
| Denomination binding | ✅ nullifierHash = Poseidon(nullifier, denomination) |

The shield contracts are immutable from the moment of deployment. The development team cannot change the fee, pause withdrawals, blacklist addresses, or alter any parameter. **If you know the note, you can withdraw — always, unconditionally, forever.**

---

## Repository Structure

```
plonk-zk/
├── circuits/
│   └── PrivXMixer.circom          # 14-level Poseidon Merkle circuit
├── contracts/
│   ├── PrivX_Shield.sol           # Universal shield (any ERC-20)
│   ├── PrivX_FeeVault.sol         # Fee conversion → POL + rewards + burn
│   └── PrivX_Mining_Vault_V2.sol  # POP reward distributor
├── index.html                     # Single-file dapp (no build step)
└── privx-shield.png               # Logo
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

The proving key (~29MB) is fetched from IPFS on first use and cached in memory for the session. Proof generation takes 15–30 seconds depending on device.

---

## Deploying New Token Shields

`PrivX_Shield.sol` is universal — it shields any ERC-20 token. To add a new token:

1. Deploy `PrivX_Mining_Vault_V2` (if not reusing an existing vault)
2. Deploy `PrivX_FeeVault` with PulseX V2 router/factory (if not reusing)
3. Deploy 4× `PrivX_Shield` with the new token address and denominations (100 / 1,000 / 10,000 / 100,000)
4. Call `addShield()` × 4 on Mining Vault, then `sealVault()`
5. Add the token entry to the `SHIELDS` config in `index.html`

The ZK circuit, proving key, and verifier contract do not change. No new ceremony required.

---

## Coming Soon

- **pSunDAI Shield** — Autonomous Stable Asset on PulseChain
- **Additional token shields** — any approved ERC-20
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
