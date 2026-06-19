// circomlibjs is loaded as a defer script — checked lazily in initPoseidon() to handle IPFS load failures gracefully

// ══════════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════════
const RPCS = [
  'https://rpc.pulsechain.com',
  'https://rpc-pulsechain.g4mm4.io',
  'https://pulsechain.publicnode.com',
];
let _rpcIdx = 0;
const CHAIN_ID     = 369;
const TREE_LEVELS  = 14;
const ZERO         = 0n;
const WASM_URL     = './PrivXMixer14.wasm';
const ZKEY_CID     = 'bafybeiahcycu5sbkgdxfxt4py3qagjrce2nxrbxenwv7oxkg67xoy4qwmu';
const ZKEY_URLS    = [
  `https://amaranth-rear-platypus-218.mypinata.cloud/ipfs/${ZKEY_CID}`,          // dedicated gateway — most reliable for 53 MB
  `https://gateway.pinata.cloud/ipfs/${ZKEY_CID}`,
  `https://ipfs.io/ipfs/${ZKEY_CID}`,
  `https://${ZKEY_CID}.ipfs.dweb.link`,
  './PrivXMixer14_final.zkey',                                                    // last resort — only works when served locally
];
const BILL_GAS_PLS = 100000000000000000000n;  // 100 PLS gas budget sent to each bill wallet
const DEPOSIT_TOPIC = '0xa945e51eec50ab98c161376f0db4cf2aeba3ec92755fe2fcd388bdbbb80ff196';
const PRIVX_TOKEN   = '0x34310B5d3a8d1e5f8e4A40dcf38E48d90170E986';
// ── External relayer — update this one constant if the relayer moves ──────────
const EXTERNAL_RELAYER_URL = 'https://bafybeidhl7dh5iqzeudtjwqboy6fsagg4ljbmbtab2l6dzurifwn5nnzuu.ipfs.inbrowser.link/relayer.html';
// ─────────────────────────────────────────────────────────────────────────────

const TOKENS = {
  dai: {
    label:'DAI', addr:'0xefD766cCb38EaF1dfd701853BFCe31359239F305', decimals:18, feeBP:50,
    shields:{'1':'0xdDdf0fe3A1A85eA5A913347FF8069a04390e4C31','5':'0x1D57f03d48A2E5d9cE97d73F2f7710c313ee8577','10':'0xFe63926D5535EA3B6e1EA204bdDf93F4E2a4b906','20':'0xE0fA07E91a4A1005C63f9414Fe11B9E84C9C599B','50':'0x7cfe4718be7991fCA3979Fb0008Bd26e51D01980','100':'0xDA6e061F10deE54DDcF8B3d054F2fdDC5848Ee79'},
    denomWei:{'1':1000000000000000000n,'5':5000000000000000000n,'10':10000000000000000000n,'20':20000000000000000000n,'50':50000000000000000000n,'100':100000000000000000000n}
  },
  psundai: {
    label:'pSunDAI', addr:'0x0b5701078675870AaA121Da2AECD906A1720B008', decimals:18, feeBP:50,
    shields:{'1':'0xC78b470dB2E56CA273fa1aE6dE46aDFdeFa32aB1','5':'0x8D5A907c8d8bd422C7E054C762e6ed1928cc0546','10':'0x81AF3986228fd7fcE300bbD5791f3Eb3A674a6d0','20':'0x6436B944F68bb71eC396D232d6b8d828Bd6ead72','50':'0xFC59e5316f6Efd5002Aeb8C756EeADBBDc44B2CD','100':'0x7202a555d06159eD13adeF437c40B13d65387f8B'},
    denomWei:{'1':1000000000000000000n,'5':5000000000000000000n,'10':10000000000000000000n,'20':20000000000000000000n,'50':50000000000000000000n,'100':100000000000000000000n}
  },
  usdc: {
    label:'USDC', addr:'0x15D38573d2feeb82e7ad5187aB8c1D52810B1f07', decimals:6, feeBP:50,
    shields:{'1':'0x6613d13bf8deB21cA06062904C875b36D053F04e','5':'0x96A869E58B97736615e57742a920667100A801d7','10':'0xe853A0966C4Add92D8c5935486B7E7fF7194a079','20':'0x658b5d0793b6796D6E3e95671C183b4B2F8CC24A','50':'0x835c48cF6270f2efF812254b1425400432652fB0','100':'0xc9569CF23D706627d7901ad15d9fBfaA49B0D5E2'},
    denomWei:{'1':1000000n,'5':5000000n,'10':10000000n,'20':20000000n,'50':50000000n,'100':100000000n}
  }
};
const DENOMS = ['1','5','10','20','50','100'];
const NOTE_RE = /^hp-(dai|psundai|usdc)-(\d+)-([a-f0-9]{62,64})-([a-f0-9]{62,64})$/i;

// ══════════════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════════════
let poseidonFn = null;
let zkeyBlobUrl = null;
let primaryWallet = null;   // ethers.Wallet
let provider = null;
let bills = [];             // [{id,address,privateKey,denomination,token,gasReady,spent,createdAt}]
let notes = [];             // [{noteStr,token,denom,ts,withdrawn}]
let selectedNote = null;
let selectedToken = 'dai';
let selectedDenom = null;
let payBills = [];          // bills selected for current payment
let backupBannerDismissed = false;

// PIN / crypto state
let cryptoKey  = null;      // AES-GCM-256 CryptoKey, null when locked
let vaultSeed  = null;      // seed phrase in memory while unlocked
let pinBuffer  = [];        // digits being entered
let pinMode    = 'unlock';  // 'unlock' | 'create' | 'confirm'
let pinStage1  = [];        // first entry during 'create' flow
let proofRunning = false;
let lockTimer  = null;
let txHistory  = [];
let _relayChoiceResolve = null;

// ══════════════════════════════════════════════════════════════════════
// STORAGE
// ══════════════════════════════════════════════════════════════════════
const LS = {
  get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k,v) => localStorage.setItem(k, JSON.stringify(v)),
};

// ── Crypto helpers ────────────────────────────────────────────────────
function b64enc(buf) {
  // Avoid spread (...) — stack overflow on large ciphertexts with many bills
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64dec(s)   { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }

async function pbkdf2Key(pin, salt) {
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name:'PBKDF2', salt, iterations:200000, hash:'SHA-256' },
    base, { name:'AES-GCM', length:256 }, false, ['encrypt','decrypt']
  );
}

async function encItem(key, str) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({name:'AES-GCM',iv}, key, new TextEncoder().encode(str));
  return { iv:b64enc(iv), ct:b64enc(ct) };
}

async function decItem(key, obj) {
  const pt = await crypto.subtle.decrypt({name:'AES-GCM',iv:b64dec(obj.iv)}, key, b64dec(obj.ct));
  return new TextDecoder().decode(pt);
}

// ── Vault functions ───────────────────────────────────────────────────
async function sealVault(pin) {
  const salt = b64dec(localStorage.getItem('privxpay_pin_salt') || '');
  const s    = salt.length === 16 ? salt : crypto.getRandomValues(new Uint8Array(16));
  localStorage.setItem('privxpay_pin_salt', b64enc(s));
  cryptoKey = await pbkdf2Key(pin, s);
  await saveEncSeed(vaultSeed || localStorage.getItem('privxpay_seed_v1'));
  await saveBillsEnc();
  await saveNotesEnc();
  localStorage.removeItem('privxpay_seed_v1');
  localStorage.removeItem('privxpay_bills_v1');
  localStorage.removeItem('privxpay_notes_v1');
}

async function openVault(pin) {
  const saltB64 = localStorage.getItem('privxpay_pin_salt');
  if (!saltB64) throw new Error('No vault');
  const key     = await pbkdf2Key(pin, b64dec(saltB64));
  const encSeed = localStorage.getItem('privxpay_enc_seed');
  if (!encSeed) throw new Error('No encrypted seed');
  const seed    = await decItem(key, JSON.parse(encSeed)); // throws if wrong PIN
  cryptoKey = key;
  vaultSeed = seed;
  return seed;
}

async function saveEncSeed(seed) {
  if (!cryptoKey || !seed) return;
  const enc = await encItem(cryptoKey, seed);
  localStorage.setItem('privxpay_enc_seed', JSON.stringify(enc));
}

async function saveBillsEnc() {
  if (!cryptoKey) { LS.set('privxpay_bills_v1', bills); return; }
  const enc = await encItem(cryptoKey, JSON.stringify(bills));
  localStorage.setItem('privxpay_enc_bills', JSON.stringify(enc));
  localStorage.removeItem('privxpay_bills_v1');
}

async function saveNotesEnc() {
  if (!cryptoKey) { LS.set('privxpay_notes_v1', notes); return; }
  const enc = await encItem(cryptoKey, JSON.stringify(notes));
  localStorage.setItem('privxpay_enc_notes', JSON.stringify(enc));
  localStorage.removeItem('privxpay_notes_v1');
}

async function loadStorageEnc() {
  txHistory = LS.get('privxpay_history_v1') || [];
  if (cryptoKey) {
    const eb = localStorage.getItem('privxpay_enc_bills');
    const en = localStorage.getItem('privxpay_enc_notes');
    bills = eb ? JSON.parse(await decItem(cryptoKey, JSON.parse(eb))) : (LS.get('privxpay_bills_v1') || []);
    notes = en ? JSON.parse(await decItem(cryptoKey, JSON.parse(en))) : (LS.get('privxpay_notes_v1') || []);
  } else {
    bills = LS.get('privxpay_bills_v1') || [];
    notes = LS.get('privxpay_notes_v1') || [];
  }
}

function saveBills() { saveBillsEnc().catch(console.error); }
function saveNotes() { saveNotesEnc().catch(console.error); }
function loadStorage() { /* kept for backward compat, replaced by loadStorageEnc */ }

// ══════════════════════════════════════════════════════════════════════
// WALLET
// ══════════════════════════════════════════════════════════════════════
const HD_PATH = "m/44'/60'/0'/0/0";

function initProvider() {
  provider = new ethers.JsonRpcProvider(RPCS[_rpcIdx], { chainId: CHAIN_ID, name: 'pulsechain' });
}

async function loadOrCreateWallet() {
  const seed = localStorage.getItem('privxpay_seed_v1');
  if (!seed) return false;
  const mnemonic  = ethers.Mnemonic.fromPhrase(seed);
  const hdWallet  = ethers.HDNodeWallet.fromMnemonic(mnemonic, HD_PATH);
  primaryWallet   = new ethers.Wallet(hdWallet.privateKey, provider);
  return true;
}

// ══════════════════════════════════════════════════════════════════════
// ONBOARDING
// ══════════════════════════════════════════════════════════════════════
function showWelcome() {
  document.getElementById('ob-welcome').style.display = '';
  document.getElementById('ob-import').style.display  = 'none';
  document.getElementById('ob-seed').style.display    = 'none';
}

function showImport() {
  document.getElementById('ob-welcome').style.display = 'none';
  document.getElementById('ob-import').style.display  = '';
  document.getElementById('import-input').value       = '';
  document.getElementById('import-word-grid').style.display = 'none';
  document.getElementById('import-word-grid').innerHTML    = '';
  setStatus(document.getElementById('import-status'), '', '');
  document.getElementById('import-btn').disabled = true;
}

function onImportInput() {
  const raw   = document.getElementById('import-input').value;
  const words = raw.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const grid  = document.getElementById('import-word-grid');
  const st    = document.getElementById('import-status');
  const btn   = document.getElementById('import-btn');

  if (words.length < 2) {
    grid.style.display = 'none';
    setStatus(st, '', '');
    btn.disabled = true;
    return;
  }

  grid.style.display = 'grid';
  grid.innerHTML = '';
  words.forEach((w, i) => {
    const div = document.createElement('div'); div.className = 'seed-word';
    const num = document.createElement('span'); num.className = 'seed-num'; num.textContent = i + 1;
    const wrd = document.createElement('span'); wrd.className = 'seed-w';  wrd.textContent = w;
    div.appendChild(num); div.appendChild(wrd); grid.appendChild(div);
  });

  if (words.length !== 12 && words.length !== 24) {
    setStatus(st, `${words.length} words — need 12 or 24`, 'warn');
    btn.disabled = true;
    return;
  }

  try {
    ethers.Mnemonic.fromPhrase(words.join(' '));
    setStatus(st, `✓ Valid ${words.length}-word phrase`, 'ok');
    btn.disabled = false;
  } catch {
    setStatus(st, 'Invalid phrase — check spelling or word order', 'bad');
    btn.disabled = true;
  }
}

async function finishImport() {
  const raw    = document.getElementById('import-input').value;
  const phrase = raw.trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');
  try {
    ethers.Mnemonic.fromPhrase(phrase);
    vaultSeed = phrase;
    const mnemonic = ethers.Mnemonic.fromPhrase(phrase);
    const hd       = ethers.HDNodeWallet.fromMnemonic(mnemonic, HD_PATH);
    primaryWallet  = new ethers.Wallet(hd.privateKey, provider);
    bills = LS.get('privxpay_bills_v1') || [];
    notes = LS.get('privxpay_notes_v1') || [];
    txHistory = LS.get('privxpay_history_v1') || [];
    document.getElementById('screen-onboard').classList.remove('active');
    showPinSetup('Create a PIN to protect your wallet');
  } catch(e) {
    setStatus(document.getElementById('import-status'), 'Import failed: ' + e.message, 'bad');
  }
}

async function startGenerate() {
  document.getElementById('ob-welcome').style.display = 'none';
  const phrase = ethers.Mnemonic.entropyToPhrase(ethers.randomBytes(16));
  const words  = phrase.split(' ');
  const grid   = document.getElementById('seed-display');
  grid.innerHTML = '';
  words.forEach((w, i) => {
    const div = document.createElement('div'); div.className = 'seed-word';
    const num = document.createElement('span'); num.className = 'seed-num'; num.textContent = i + 1;
    const wrd = document.createElement('span'); wrd.className = 'seed-w';  wrd.textContent = w;
    div.appendChild(num); div.appendChild(wrd); grid.appendChild(div);
  });
  vaultSeed = phrase;
  document.getElementById('ob-seed').style.display = '';
}

function toggleCheck(boxId, btnId) {
  const box = document.getElementById(boxId);
  const btn = document.getElementById(btnId);
  box.classList.toggle('on');
  btn.disabled = !box.classList.contains('on');
}

async function finishOnboard() {
  const mnemonic = ethers.Mnemonic.fromPhrase(vaultSeed);
  const hd       = ethers.HDNodeWallet.fromMnemonic(mnemonic, HD_PATH);
  primaryWallet  = new ethers.Wallet(hd.privateKey, provider);
  document.getElementById('screen-onboard').classList.remove('active');
  showPinSetup('Create a PIN to protect your wallet');
}

function enterApp() {
  receiveRendered = false;
  document.getElementById('screen-onboard').classList.remove('active');
  document.getElementById('tabbar').classList.add('visible');
  document.getElementById('global-header').classList.add('visible');
  refreshHeader();
  switchTab('wallet');
  // Show iOS in-browser warning — storage is isolated from home screen PWA
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  if (isIOS && !isStandalone) {
    const banner = document.getElementById('hs-banner');
    if (banner) banner.style.display = 'block';
  }
  // Auto-lock on visibility change (only register once)
  if (!window._lockListenerAdded) {
    window._lockListenerAdded = true;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && !proofRunning) {
        lockTimer = setTimeout(() => { if (primaryWallet) lockApp(); }, 60000);
      } else {
        clearTimeout(lockTimer);
      }
    });
  }
  // Pre-warm Poseidon in the background so deposit/withdraw don't stall on first use.
  // Fire-and-forget — errors silently ignored here; doShield/runAutoRelay will surface them.
  initPoseidon().catch(() => {});
}

// ── PIN lock functions ────────────────────────────────────────────────
function lockApp() {
  clearTimeout(lockTimer);
  cryptoKey     = null;
  primaryWallet = null;
  vaultSeed     = null;
  showLockScreen('Enter PIN to unlock');
}

// Lockout durations per tier: 1st lockout 5 min, 2nd 30 min, 3rd+ 60 min
const PIN_LOCKOUT_TIERS = [5 * 60, 30 * 60, 60 * 60]; // seconds
const PIN_MAX_ATTEMPTS  = 5;

function getPinLockoutState() {
  const until  = parseInt(localStorage.getItem('privxpay_pin_lockout_until') || '0', 10);
  const fails  = parseInt(localStorage.getItem('privxpay_pin_fails') || '0', 10);
  const tier   = parseInt(localStorage.getItem('privxpay_pin_lockout_tier') || '0', 10);
  const secsLeft = Math.ceil((until - Date.now()) / 1000);
  return { until, fails, tier, locked: secsLeft > 0, secsLeft: Math.max(0, secsLeft) };
}

function recordPinFail() {
  const { fails, tier } = getPinLockoutState();
  const newFails = fails + 1;
  localStorage.setItem('privxpay_pin_fails', newFails);
  if (newFails >= PIN_MAX_ATTEMPTS) {
    const newTier  = Math.min(tier + 1, PIN_LOCKOUT_TIERS.length - 1);
    const duration = PIN_LOCKOUT_TIERS[newTier - 1] ?? PIN_LOCKOUT_TIERS[0];
    localStorage.setItem('privxpay_pin_lockout_until', Date.now() + duration * 1000);
    localStorage.setItem('privxpay_pin_lockout_tier',  newTier);
    localStorage.setItem('privxpay_pin_fails', '0');
    return { lockedOut: true, secsLeft: duration };
  }
  return { lockedOut: false, remaining: PIN_MAX_ATTEMPTS - newFails };
}

function clearPinFails() {
  localStorage.removeItem('privxpay_pin_fails');
  localStorage.removeItem('privxpay_pin_lockout_until');
  localStorage.removeItem('privxpay_pin_lockout_tier');
}

let _lockoutTimer = null;
function startLockoutCountdown() {
  clearInterval(_lockoutTimer);
  const dot = document.getElementById('pin-status');
  const pad = document.getElementById('pin-pad');
  const update = () => {
    const { locked, secsLeft } = getPinLockoutState();
    if (!locked) {
      clearInterval(_lockoutTimer);
      if (dot) dot.textContent = '';
      if (pad) pad.style.opacity = '1';
      pinBuffer = []; renderPinDots();
      return;
    }
    const m = Math.floor(secsLeft / 60), s = secsLeft % 60;
    const timeStr = m > 0 ? `${m}m ${s}s` : `${s}s`;
    if (dot) dot.textContent = `Too many attempts — try again in ${timeStr}`;
    if (pad) pad.style.opacity = '0.3';
  };
  update();
  _lockoutTimer = setInterval(update, 1000);
}

async function unlockWithPin(pin) {
  const dot = document.getElementById('pin-status');
  const { locked, secsLeft } = getPinLockoutState();
  if (locked) {
    pinBuffer = []; renderPinDots();
    startLockoutCountdown();
    return;
  }
  try {
    const seed = await openVault(pin);
    clearPinFails();
    const mnemonic = ethers.Mnemonic.fromPhrase(seed);
    const hd       = ethers.HDNodeWallet.fromMnemonic(mnemonic, HD_PATH);
    primaryWallet  = new ethers.Wallet(hd.privateKey, provider);
    await loadStorageEnc();
    hideLockScreen();
    enterApp();
  } catch {
    pinBuffer = [];
    renderPinDots();
    const result = recordPinFail();
    if (result.lockedOut) {
      startLockoutCountdown();
    } else {
      const warn = result.remaining === 1 ? `Wrong PIN — 1 attempt left before lockout` : `Wrong PIN — ${result.remaining} attempts left`;
      if (dot) { dot.textContent = warn; setTimeout(() => { if (dot) dot.textContent = ''; }, 2000); }
    }
  }
}

function showLockScreen(subtitle = 'Enter PIN to unlock') {
  document.getElementById('lock-subtitle').textContent = subtitle;
  document.getElementById('screen-lock').style.display = 'flex';
  pinBuffer = [];
  renderPinDots();
  if (getPinLockoutState().locked) startLockoutCountdown();
}

function hideLockScreen() {
  document.getElementById('screen-lock').style.display = 'none';
}

function renderPinDots() {
  const container = document.getElementById('pin-dots');
  if (!container) return;
  container.innerHTML = Array.from({length:6}, (_,i) =>
    `<div class="pin-dot${i < pinBuffer.length ? ' filled' : ''}"></div>`
  ).join('');
}

function pinKey(d) {
  if (pinBuffer.length >= 6) return;
  if (pinMode === 'unlock' && getPinLockoutState().locked) return;
  pinBuffer.push(d);
  renderPinDots();
  if (pinBuffer.length === 6) setTimeout(pinSubmit, 120);
}

function pinBackspace() {
  pinBuffer.pop();
  renderPinDots();
}

async function pinSubmit() {
  const pin = pinBuffer.join('');
  if (pin.length < 6) return;
  const dot = document.getElementById('pin-status');

  if (pinMode === 'unlock') {
    if (dot) dot.textContent = 'Verifying…';
    await unlockWithPin(pin);
    return;
  }

  if (pinMode === 'create') {
    pinStage1 = pinBuffer.slice();
    pinBuffer  = [];
    renderPinDots();
    pinMode = 'confirm';
    if (dot) dot.textContent = '';
    document.getElementById('lock-subtitle').textContent = 'Confirm your PIN';
    return;
  }

  if (pinMode === 'confirm') {
    if (pinStage1.join('') !== pin) {
      pinBuffer = []; pinStage1 = []; pinMode = 'create';
      renderPinDots();
      document.getElementById('lock-subtitle').textContent = 'PINs did not match — try again';
      return;
    }
    if (dot) dot.textContent = 'Securing wallet…';
    try {
      await sealVault(pin);
      hideLockScreen();
      enterApp();
    } catch(e) {
      if (dot) dot.textContent = 'Error: ' + e.message;
    }
  }
}

function showPinSetup(subtitle = 'Create a 6-digit PIN to protect your wallet') {
  pinMode = 'create';
  pinBuffer = []; pinStage1 = [];
  showLockScreen(subtitle);
}

function nukeClearData() {
  if (!confirm('This will DELETE all your data including bills and seed phrase. You cannot undo this. Proceed?')) return;
  if (!confirm('Are you 100% sure? All funds will be inaccessible without your seed phrase backup.')) return;
  localStorage.clear();
  location.reload();
}

// ══════════════════════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════════════════════
const TABS = ['wallet','pay','receive','restock','guide'];

function switchTab(t) {
  TABS.forEach(id => {
    document.getElementById('screen-'+id).classList.toggle('active', id === t);
    document.getElementById('tab-'+id).classList.toggle('active', id === t);
  });
  if (t === 'wallet')   { renderWallet(); refreshWalletBalances(false); renderHistory(); }
  if (t === 'receive')  renderReceive();
  if (t === 'restock')  renderNotes();
  if (t === 'pay')      renderPayAvail();
  if (t === 'guide')    renderWalkthrough();
}

function toggleAccord(id) {
  document.getElementById(id).classList.toggle('open');
}

// ── HEADER + BALANCE REFRESH ───────────────────────────────────────────
async function refreshHeader() {
  if (!primaryWallet) return;
  const addr = primaryWallet.address;
  const short = addr.slice(0,6) + '…' + addr.slice(-4);
  document.getElementById('gh-addr-text').textContent = short;

  // PLS balance + connection check
  try {
    const raw = await rpc('eth_getBalance', [addr, 'latest']);
    const pls = Number(BigInt(raw)) / 1e18;
    const fmt = pls >= 1000
      ? pls.toLocaleString(undefined, {maximumFractionDigits:0}) + ' PLS'
      : pls.toLocaleString(undefined, {maximumFractionDigits:2}) + ' PLS';
    document.getElementById('gh-pls-bal').textContent = fmt;
    document.getElementById('gh-dot').className = 'gh-dot ok';
  } catch {
    document.getElementById('gh-pls-bal').textContent = '— PLS';
    document.getElementById('gh-dot').className = 'gh-dot err';
  }
}

let _balRefreshing = false;
async function refreshWalletBalances(force = false) {
  if (!primaryWallet) return;
  if (_balRefreshing && !force) return;
  _balRefreshing = true;

  const btn   = document.getElementById('bal-refresh-btn');
  const label = document.getElementById('bal-refresh-label');
  if (btn) btn.classList.add('spinning');
  if (label) label.textContent = 'Refreshing…';

  try {
    const addr = primaryWallet.address;
    const [rawPls, rawDai, rawSun, rawUsdc] = await Promise.all([
      rpc('eth_getBalance', [addr, 'latest']),
      balanceOf(TOKENS.dai.addr, addr),
      balanceOf(TOKENS.psundai.addr, addr),
      balanceOf(TOKENS.usdc.addr, addr),
    ]);

    const fmtPls  = v => { const n = Number(BigInt(v))/1e18; return n>=10000?Math.round(n).toLocaleString():n.toLocaleString(undefined,{maximumFractionDigits:1}); };
    const fmtD18  = v => { const n = Number(v)/1e18; return n===0?'0':n<0.01?'<0.01':n.toLocaleString(undefined,{maximumFractionDigits:2}); };
    const fmtUsdc = v => { const n = Number(v)/1e6;  return n===0?'0':n.toLocaleString(undefined,{maximumFractionDigits:2}); };

    document.getElementById('wb-pls').textContent     = fmtPls(rawPls);
    document.getElementById('wb-dai').textContent     = fmtD18(rawDai);
    document.getElementById('wb-psundai').textContent = fmtD18(rawSun);
    document.getElementById('wb-usdc').textContent    = fmtUsdc(rawUsdc);

    // sync header PLS too
    const plsNum = Number(BigInt(rawPls))/1e18;
    document.getElementById('gh-pls-bal').textContent =
      (plsNum>=1000 ? plsNum.toLocaleString(undefined,{maximumFractionDigits:0})
                    : plsNum.toLocaleString(undefined,{maximumFractionDigits:2})) + ' PLS';
    document.getElementById('gh-dot').className = 'gh-dot ok';

    if (label) label.textContent = 'Wallet balances';
  } catch {
    if (label) label.textContent = 'Wallet balances (offline)';
    document.getElementById('gh-dot').className = 'gh-dot err';
  } finally {
    if (btn) btn.classList.remove('spinning');
    _balRefreshing = false;
  }
}

// ══════════════════════════════════════════════════════════════════════
// RAW RPC HELPERS
// ══════════════════════════════════════════════════════════════════════
async function rpc(method, params) {
  const start = _rpcIdx;
  for (let i = 0; i < RPCS.length; i++) {
    const url = RPCS[(start + i) % RPCS.length];
    try {
      const r = await (await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ jsonrpc:'2.0', id:1, method, params }) })).json();
      if (r.error) throw new Error(r.error.message);
      if (i > 0) { _rpcIdx = (start + i) % RPCS.length; initProvider(); } // stick to working endpoint
      return r.result;
    } catch(e) {
      if (i === RPCS.length - 1) throw e;
      console.warn(`RPC ${url} failed, trying next:`, e.message);
    }
  }
}
const addrArg = a => a.toLowerCase().replace('0x','').padStart(64,'0');
const u256Arg = v => BigInt(v).toString(16).padStart(64,'0');
const hexU    = h => h === '0x' ? 0n : BigInt(h);

async function ethCall(to, sel, arg='') {
  return rpc('eth_call',[{to, data: sel+(arg||'')}, 'latest']);
}
async function ethLogs(address, topic) {
  return rpc('eth_getLogs',[{ address, topics:[topic], fromBlock:'0x0', toBlock:'latest' }]);
}

// ══════════════════════════════════════════════════════════════════════
// ERC20
// ══════════════════════════════════════════════════════════════════════
async function balanceOf(token, owner) {
  return hexU(await ethCall(token, '0x70a08231', addrArg(owner)));
}
async function allowanceOf(token, owner, spender) {
  return hexU(await ethCall(token, '0xdd62ed3e', addrArg(owner)+addrArg(spender)));
}
// Fetch the real network gas price and add a 25% buffer so type-0 legacy transactions
// are reliably included even if the base fee ticks up between fetch and block inclusion.
// Use eth_gasPrice directly — ethers getFeeData() can return maxFeePerGas (2× baseFee)
// on EIP-1559 networks like PulseChain, producing wildly inflated gas cost estimates.
async function getGasPrice() {
  try {
    const raw = await rpc('eth_gasPrice', []);
    return BigInt(raw) * 125n / 100n;
  } catch {
    return 6250000000n; // fallback: 5 gwei + 25%
  }
}
async function sendApprove(wallet, token, spender, amount) {
  const gasPrice = await getGasPrice();
  const tx = await wallet.sendTransaction({ to:token, data:'0x095ea7b3'+addrArg(spender)+u256Arg(amount), gasLimit:100000n, type:0, gasPrice });
  return tx.wait();
}
async function sendTransfer(wallet, token, to, amount, gasPrice) {
  if (!gasPrice) gasPrice = await getGasPrice();
  const tx = await wallet.sendTransaction({ to:token, data:'0xa9059cbb'+addrArg(to)+u256Arg(amount), gasLimit:100000n, type:0, gasPrice });
  return tx.wait();
}
async function sendPls(wallet, to, amount) {
  const gasPrice = await getGasPrice();
  const tx = await wallet.sendTransaction({ to, value:amount, gasLimit:21000n, type:0, gasPrice });
  return tx.wait();
}

// ══════════════════════════════════════════════════════════════════════
// SHIELD / ZK
// ══════════════════════════════════════════════════════════════════════
async function ensureCircomlib() {
  if (window.circomlibjs?.buildPoseidon) return;
  // Script may have failed or timed out on IPFS — inject a fresh script tag to retry
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = './circomlibjs.js';
    s.onload  = resolve;
    s.onerror = () => reject(new Error('circomlibjs.js failed to load — check your connection and reload the page.'));
    document.head.appendChild(s);
  });
  if (!window.circomlibjs?.buildPoseidon) throw new Error('circomlibjs loaded but buildPoseidon not found.');
}

let _poseidonInitP = null; // coalesce concurrent callers onto one build

async function initPoseidon() {
  if (poseidonFn) return;
  if (!_poseidonInitP) {
    _poseidonInitP = (async () => {
      await ensureCircomlib();
      const lib = await window.circomlibjs.buildPoseidon();
      poseidonFn = (...inputs) => lib.F.toObject(lib(inputs.map(x => BigInt(x))));
    })();
  }
  await _poseidonInitP;
}

function buildFullTree(leaves) {
  const size = 1 << TREE_LEVELS;
  const padded = [...leaves];
  while (padded.length < size) padded.push(ZERO);
  const tree = [padded];
  for (let lvl=0; lvl<TREE_LEVELS; lvl++) {
    const prev = tree[lvl], next = [];
    for (let i=0; i<prev.length; i+=2) next.push(poseidonFn(prev[i], prev[i+1]));
    tree.push(next);
  }
  return { tree, root: tree[TREE_LEVELS][0] };
}

async function getMerkleProof(shieldAddr, targetCommitment) {
  const logs = await ethLogs(shieldAddr, DEPOSIT_TOPIC);
  if (!logs.length) throw new Error('No deposits found in this shield.');
  const events = logs.map(l => ({
    commitment: BigInt(l.topics[1]),
    leafIndex:  Number(BigInt('0x'+l.data.slice(2,66)))
  })).sort((a,b) => a.leafIndex - b.leafIndex);

  const leaves = events.map(e => e.commitment);
  const leafIndex = leaves.findIndex(l => l === targetCommitment);
  if (leafIndex === -1) throw new Error('Commitment not found — wrong note?');

  const { tree, root } = buildFullTree(leaves);
  const siblings = [], pathIndices = [];
  let idx = leafIndex;
  for (let lvl=0; lvl<TREE_LEVELS; lvl++) {
    siblings.push(tree[lvl][idx^1].toString());
    pathIndices.push(idx & 1);
    idx >>= 1;
  }

  const onChainRoot = await ethCall(shieldAddr, '0xba70f757');
  const localHex = '0x'+root.toString(16).padStart(64,'0');
  if (localHex.toLowerCase() !== onChainRoot.toLowerCase())
    throw new Error('Merkle root mismatch — a deposit just happened, please retry.');

  return { pathIndices, siblings, proofRoot: root };
}

const IDB_ZKEY_KEY  = 'privxpay_zkey_v1';
const ZKEY_MIN_SIZE = 30_000_000; // 30 MB — a valid zkey is ~53 MB; anything smaller is a gateway error page

async function idbGet(key) {
  return new Promise((res) => {
    const req = indexedDB.open('privxpay', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('kv');
    req.onerror = () => res(null);
    req.onsuccess = e => {
      const tx = e.target.result.transaction('kv','readonly');
      const r  = tx.objectStore('kv').get(key);
      r.onsuccess = () => res(r.result ?? null);
      r.onerror   = () => res(null);
    };
  });
}

async function idbSet(key, value) {
  return new Promise((res) => {
    const req = indexedDB.open('privxpay', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('kv');
    req.onerror = () => res();
    req.onsuccess = e => {
      const tx = e.target.result.transaction('kv','readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => res();
      tx.onerror    = () => res();
    };
  });
}

async function idbDel(key) {
  return new Promise((res) => {
    const req = indexedDB.open('privxpay', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('kv');
    req.onerror = () => res();
    req.onsuccess = e => {
      const tx = e.target.result.transaction('kv','readwrite');
      tx.objectStore('kv').delete(key);
      tx.oncomplete = () => res();
      tx.onerror    = () => res();
    };
  });
}

async function getZkeyUrl(onStatus) {
  if (zkeyBlobUrl) return zkeyBlobUrl;

  // Check IndexedDB cache — but validate size to reject HTML error pages stored in a previous attempt
  const cached = await idbGet(IDB_ZKEY_KEY);
  if (cached) {
    if (cached.size >= ZKEY_MIN_SIZE) {
      onStatus('Loading proving key from cache…');
      zkeyBlobUrl = URL.createObjectURL(cached);
      return zkeyBlobUrl;
    }
    // Cached blob is too small — it was a gateway error page. Delete and re-download.
    console.warn(`Cached zkey too small (${cached.size} bytes) — deleting bad cache`);
    await idbDel(IDB_ZKEY_KEY);
  }

  for (let i=0; i<ZKEY_URLS.length; i++) {
    try {
      onStatus(`Downloading proving key${i>0?' (trying next source)':''}… (53 MB — stay on WiFi)`);
      const resp = await fetch(ZKEY_URLS[i]);
      if (!resp.ok) throw new Error('HTTP '+resp.status);
      // Reject HTML error pages that IPFS gateways return with 200 status
      const ct = resp.headers.get('content-type') || '';
      if (ct.includes('text/html')) throw new Error('Gateway returned HTML instead of binary');
      const blob = await resp.blob();
      if (blob.size < ZKEY_MIN_SIZE) throw new Error(`File too small (${(blob.size/1e6).toFixed(1)} MB) — likely a gateway error page`);
      zkeyBlobUrl = URL.createObjectURL(blob);
      onStatus('Saving proving key to cache…');
      await idbSet(IDB_ZKEY_KEY, blob);
      return zkeyBlobUrl;
    } catch(e) { console.warn(`zkey source ${i+1} failed:`, e.message); }
  }
  throw new Error('Could not download proving key from any source. Check connection and try again.');
}

async function clearZkeyCache() {
  zkeyBlobUrl = null;
  await idbDel(IDB_ZKEY_KEY).catch(() => {});
}

async function generateProof(circuitInput, onStatus) {
  const zkeyUrl = await getZkeyUrl(onStatus);
  onStatus('Generating ZK proof… (2–5 min on mobile, keep screen on)');
  try {
    const { proof, publicSignals } = await snarkjs.plonk.fullProve(circuitInput, WASM_URL, zkeyUrl);
    const calldata = await snarkjs.plonk.exportSolidityCallData(proof, publicSignals);
    const argv = calldata.replace(/\]\s*\[/g,',').replace(/["[\]\s]/g,'').split(',').filter(Boolean);
    return argv;
  } catch(e) {
    // "Reading out of bounds" / "out of range" = snarkjs got corrupted binary (bad cached zkey)
    if (/out of bounds|out of range|wasm/i.test(e.message)) {
      await clearZkeyCache();
      throw new Error('Proving key was corrupted (gateway error page). Cache cleared — tap Create Bill again to re-download.');
    }
    throw e;
  }
}

function parseNote(raw) {
  const m = raw.trim().match(NOTE_RE);
  if (!m) throw new Error('Invalid note format.');
  const [,tokenKey,denomStr,nHex,sHex] = m;
  const token = TOKENS[tokenKey.toLowerCase()];
  if (!token) throw new Error('Unknown token: '+tokenKey);
  const nullifier     = BigInt('0x'+nHex);
  const secret        = BigInt('0x'+sHex);
  const denomWei      = token.denomWei[denomStr];
  const commitment    = poseidonFn(nullifier, secret);
  const nullifierHash = poseidonFn(nullifier, denomWei);
  const shieldAddr    = token.shields[denomStr];
  return { token:tokenKey.toLowerCase(), denom:denomStr, nullifier, secret, commitment, nullifierHash, shieldAddr, denomWei };
}

async function generateNote(tokenKey, denom) {
  const nBytes = crypto.getRandomValues(new Uint8Array(31));
  const sBytes = crypto.getRandomValues(new Uint8Array(31));
  const nHex   = [...nBytes].map(b=>b.toString(16).padStart(2,'0')).join('');
  const sHex   = [...sBytes].map(b=>b.toString(16).padStart(2,'0')).join('');
  const nullifier  = BigInt('0x'+nHex);
  const secret     = BigInt('0x'+sHex);
  const commitment = poseidonFn(nullifier, secret);
  return {
    noteStr: `hp-${tokenKey}-${denom}-${nHex}-${sHex}`,
    commitmentHex: '0x'+commitment.toString(16).padStart(64,'0')
  };
}

// ══════════════════════════════════════════════════════════════════════
// WALLET TAB
// ══════════════════════════════════════════════════════════════════════
function renderWallet() {
  const unspent = bills.filter(b => !b.spent);
  const total   = unspent.reduce((s,b) => s+Number(b.denomination), 0);
  document.getElementById('wallet-total').textContent = '$'+total.toFixed(2);
  document.getElementById('wallet-count').textContent =
    unspent.length === 0 ? '0 bills · tap Restock to add more'
    : `${unspent.length} bill${unspent.length===1?'':'s'}`;
  const low = document.getElementById('wallet-low');
  low.style.display = unspent.length > 0 && total < 20 ? '' : 'none';
  const banner = document.getElementById('backup-banner');
  if (banner) banner.style.display = unspent.length > 0 && !backupBannerDismissed ? '' : 'none';
  const empty = document.getElementById('wallet-empty');
  const list  = document.getElementById('wallet-bills');
  if (!unspent.length) {
    empty.style.display = '';
    list.innerHTML = '';
  } else {
    empty.style.display = 'none';
  }
  list.innerHTML = unspent.map(b => {
    const age = Math.floor((Date.now()-b.createdAt)/86400000);
    const tok = TOKENS[b.token];
    const sid = 'bdetail-' + b.id;
    const badge = b.relayPending
      ? '<span class="badge" style="background:rgba(255,170,0,.12);color:#cc9900;border:1px solid rgba(255,170,0,.3)">relay pending</span>'
      : (!b.gasReady ? '<span class="badge">funding gas…</span>' : '');

    const pendingBlock = b.relayPending ? `
      <div style="background:rgba(255,170,0,0.06);border:1px solid rgba(255,170,0,0.2);border-radius:8px;padding:10px 12px;font-size:12px;color:#aa8800;margin-bottom:10px;line-height:1.65">
        ⏳ <strong style="color:#cc9900">Relay pending</strong> — load your proof JSON into the relayer, or submit it here via proxy. Come back and tap Check Relay once submitted — gas funds automatically.
      </div>
      <a href="${EXTERNAL_RELAYER_URL}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" style="display:block;width:100%;margin-bottom:6px">
        <button class="btn btn-primary" style="width:100%;font-size:13px">Open Hurricane Relayer ↗ <span style="font-size:10px;opacity:.7;font-weight:400">(max privacy — any wallet)</span></button>
      </a>
      <button class="btn btn-outline" style="width:100%;font-size:12px;padding:8px;margin-bottom:8px" onclick="event.stopPropagation();submitProofFromJson('${b.id}')">Submit via Proxy (in-app)</button>
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <button class="btn btn-outline" style="flex:1;font-size:12px;padding:8px" onclick="event.stopPropagation();checkRelayStatus('${b.id}')">Check Relay</button>
        ${!b.gasReady?`<button class="btn btn-outline" style="flex:1;font-size:12px;padding:8px" onclick="event.stopPropagation();refuelBill('${b.id}')">Fund Gas</button>`:`<div style="flex:1;font-size:12px;padding:8px;text-align:center;color:var(--success)">✓ Gas ready</div>`}
      </div>
      <div id="relay-status-${b.id}" class="status" style="margin-bottom:8px"></div>
    ` : '';

    const refuelRow = !b.relayPending ? `
      <button class="btn btn-outline" style="flex:1;font-size:12px;padding:8px" id="refuel-btn-${b.id}" onclick="event.stopPropagation();refuelBill('${b.id}')">Refuel Gas</button>
    ` : '';

    return `<div class="bill-card" onclick="toggleBillDetail('${b.id}')" style="cursor:pointer">
      <div>
        <div class="bill-denom">$${b.denomination}</div>
        <div class="bill-token tok-${b.token}">${tok?tok.label:b.token}</div>
        ${badge}
      </div>
      <div class="bill-age">${age===0?'today':age+'d ago'}</div>
    </div>
    <div id="${sid}" style="display:none;background:rgba(138,43,226,0.06);border:1px solid rgba(138,43,226,0.2);border-radius:10px;padding:12px 14px;margin-bottom:8px;font-size:12px">
      <div style="color:var(--muted);margin-bottom:6px">Bill wallet address</div>
      <div style="font-family:monospace;word-break:break-all;color:var(--accent);margin-bottom:10px">${b.address}</div>
      ${pendingBlock}
      <div style="display:flex;gap:8px">
        <button class="btn btn-outline" style="flex:1;font-size:12px;padding:8px" onclick="event.stopPropagation();copyText('${b.address}')">Copy Address</button>
        ${refuelRow}
      </div>
      ${b.gasReady && !b.relayPending ? `
      <a href="./notes.html#privxpay:${b.privateKey}:${b.token}:${b.denomination}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="display:block;margin-top:8px">
        <button class="btn btn-outline" style="width:100%;font-size:12px;padding:8px">🖨 Print Note</button>
      </a>` : ''}
      <button class="btn btn-outline" style="width:100%;font-size:12px;padding:8px;margin-top:8px;opacity:.7" onclick="event.stopPropagation();verifyBillBalance('${b.id}')">Verify Balance</button>
      <div id="refuel-status-${b.id}" class="status" style="margin-top:8px"></div>
    </div>`;
  }).join('');

  // Spent bills — shown so user can reclaim any PRIVX mining rewards before clearing
  const spent    = bills.filter(b => b.spent);
  const spentEl  = document.getElementById('wallet-spent');
  if (spentEl) {
    if (!spent.length) {
      spentEl.innerHTML = '';
    } else {
      spentEl.innerHTML =
        '<div class="label" style="margin-top:16px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">' +
          '<span>Spent Bills</span>' +
          '<span style="font-size:11px;color:var(--dim);font-weight:400">PRIVX rewards may still be claimable</span>' +
        '</div>' +
        spent.map(b => {
          const tok = TOKENS[b.token];
          return `<div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:10px 12px;margin-bottom:6px;font-size:12px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
              <span style="font-weight:700;color:var(--muted)">$${b.denomination} ${tok?tok.label:b.token}</span>
              <span style="color:var(--dim);font-size:10px">spent</span>
            </div>
            <div style="font-family:monospace;color:var(--dim);font-size:10px;word-break:break-all;margin-bottom:8px">${b.address}</div>
            <div id="reclaim-form-${b.id}">
              <button class="btn btn-outline" style="width:100%;font-size:12px;padding:6px" onclick="showReclaimForm('${b.id}')">Check & Reclaim PRIVX</button>
            </div>
          </div>`;
        }).join('');
    }
  }

  renderHistory();
}

function clearSpentBills() {
  const n = bills.filter(b => b.spent).length;
  if (!n) return;
  bills = bills.filter(b => !b.spent);
  saveBills();
  renderWallet();
}

// ── BACKUP / RESTORE ───────────────────────────────────────────────────────
// Key derives from the seed phrase so the same backup decrypts on any device
// running the same seed — no PIN dependency, no server needed.
async function _backupKey() {
  return pbkdf2Key(vaultSeed, new TextEncoder().encode('PrivXPayBackup_v1'));
}

function dismissBackupBanner() {
  backupBannerDismissed = true;
  const banner = document.getElementById('backup-banner');
  if (banner) banner.style.display = 'none';
}

async function exportBackup() {
  const st = document.getElementById('backup-status');
  setStatus(st, 'Preparing…', 'info');
  try {
    const key     = await _backupKey();
    const payload = JSON.stringify({ bills, notes, history: txHistory });
    const iv      = crypto.getRandomValues(new Uint8Array(12));
    const ct      = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, new TextEncoder().encode(payload));
    const out     = JSON.stringify({
      format:  'privxpay-backup-v1',
      created: Date.now(),
      address: primaryWallet.address,
      iv: b64enc(iv),
      ct: b64enc(ct)
    });
    const blob = new Blob([out], { type:'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `privxpay-backup-${Date.now()}.json`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
    const activeBills = bills.filter(b => !b.spent).length;
    const activeNotes = notes.filter(n => !n.withdrawn).length;
    setStatus(st, `✓ Backup downloaded — ${activeBills} bill${activeBills!==1?'s':''}, ${activeNotes} active note${activeNotes!==1?'s':''}.`, 'ok');
    dismissBackupBanner();
  } catch(e) {
    setStatus(st, 'Export failed: ' + e.message, 'bad');
  }
}

async function handleBackupFile(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  const st = document.getElementById('backup-status');
  setStatus(st, 'Restoring…', 'info');
  try {
    let bk;
    try { bk = JSON.parse(await file.text()); } catch { throw new Error('File is not valid JSON'); }
    if (bk.format !== 'privxpay-backup-v1') throw new Error('Not a PrivX Pay backup file');

    const key = await _backupKey();
    let pt;
    try {
      pt = await crypto.subtle.decrypt({ name:'AES-GCM', iv:b64dec(bk.iv) }, key, b64dec(bk.ct));
    } catch {
      throw new Error('Decryption failed — backup must be opened with the same seed phrase that created it');
    }
    const payload = JSON.parse(new TextDecoder().decode(pt));

    // Merge — add what's missing, never overwrite existing records
    const seenBills = new Set(bills.map(b => b.id));
    const newBills  = (payload.bills   || []).filter(b => b.id      && !seenBills.has(b.id));
    bills.push(...newBills); if (newBills.length) saveBills();

    const seenNotes = new Set(notes.map(n => n.noteStr));
    const newNotes  = (payload.notes   || []).filter(n => n.noteStr && !seenNotes.has(n.noteStr));
    notes.push(...newNotes); if (newNotes.length) saveNotes();

    const seenTs   = new Set(txHistory.map(h => h.ts));
    const newHist  = (payload.history  || []).filter(h => h.ts      && !seenTs.has(h.ts));
    txHistory.push(...newHist); if (newHist.length) LS.set('privxpay_history_v1', txHistory);

    const parts = [
      newBills.length ? `${newBills.length} bill${newBills.length!==1?'s':''}` : '',
      newNotes.length ? `${newNotes.length} note${newNotes.length!==1?'s':''}` : '',
      newHist.length  ? `${newHist.length} history item${newHist.length!==1?'s':''}` : ''
    ].filter(Boolean);
    setStatus(st, parts.length ? `✓ Restored: ${parts.join(', ')}.` : '✓ Already up to date — nothing new.', 'ok');
    renderWallet();
  } catch(e) {
    setStatus(st, 'Error: ' + e.message, 'bad');
  }
}

function renderHistory() {
  const el = document.getElementById('wallet-history');
  if (!el) return;
  if (!txHistory.length) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.innerHTML = '<div class="label" style="margin-top:16px">Recent Payments</div>' +
    txHistory.slice().reverse().slice(0, 10).map(h => {
      const d = new Date(h.ts);
      const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.05)">
        <div>
          <div style="font-size:15px;font-weight:800;color:#fff">$${h.total}</div>
          <div style="font-size:11px;color:var(--muted);font-family:monospace">${h.to.slice(0,10)}…${h.to.slice(-6)}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:11px;color:var(--dim)">${dateStr}</div>
          <div style="font-size:10px;color:var(--dim)">${h.bills.map(b=>'$'+b.denom).join(' + ')}</div>
        </div>
      </div>`;
    }).join('');
}

function toggleBillDetail(id) {
  const el = document.getElementById('bdetail-' + id);
  if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
}

async function verifyBillBalance(id) {
  const bill = bills.find(b => b.id === id);
  if (!bill) return;
  const st = document.getElementById('refuel-status-' + id);
  setStatus(st, 'Checking on-chain balance…', 'info');
  try {
    const tok = TOKENS[bill.token];
    const bal = await balanceOf(tok.addr, bill.address);
    if (bal === 0n) {
      bill.spent = true;
      saveBills();
      setStatus(st, 'No balance found — bill marked as spent.', 'ok');
      setTimeout(() => renderWallet(), 1000);
    } else {
      const fmt = tok.decimals === 6
        ? (Number(bal) / 1e6).toFixed(2)
        : (Number(bal / 10n**16n) / 100).toFixed(2);
      setStatus(st, `Balance confirmed: ${fmt} ${tok.label} — bill is still valid.`, 'ok');
    }
  } catch(e) {
    setStatus(st, 'Error: ' + e.message, 'bad');
  }
}

async function refuelBill(id) {
  const bill = bills.find(b => b.id === id);
  if (!bill || !primaryWallet) return;
  const btn = document.getElementById('refuel-btn-' + id); // may be null in relay-pending state
  const st  = document.getElementById('refuel-status-' + id)
           || document.getElementById('relay-status-' + id); // fallback for relay-pending layout
  if (btn) btn.disabled = true;
  setStatus(st, 'Sending PLS…', 'info');
  try {
    const receipt = await sendPls(primaryWallet, bill.address, BILL_GAS_PLS);
    if (!bill.gasReady) { bill.gasReady = true; saveBills(); }
    setStatus(st, '✓ 100 PLS sent — bill is ready to spend.', 'ok', receipt?.transactionHash || receipt?.hash);
    renderWallet();
  } catch(e) {
    setStatus(st, 'Error: ' + e.message, 'bad');
    if (btn) btn.disabled = false;
  }
}

// ══════════════════════════════════════════════════════════════════════
// PAY TAB
// ══════════════════════════════════════════════════════════════════════
function renderPayAvail() {
  const ready = bills.filter(b=>!b.spent && b.gasReady);
  const el = document.getElementById('pay-avail');
  if (!ready.length) { el.textContent = 'No bills ready — restock first.'; el.className='status warn show'; return; }
  el.textContent = 'Available: '+ready.map(b=>'$'+b.denomination).join(' · ');
  el.className = 'status info show';
}

function showPayInput() {
  document.getElementById('pay-input').style.display        = '';
  document.getElementById('pay-confirm').style.display      = 'none';
  document.getElementById('pay-done').style.display         = 'none';
  document.getElementById('pay-note-redeem').style.display  = 'none';
}

function reviewPayment() {
  const addr    = document.getElementById('pay-addr').value.trim();
  const rawAmt  = document.getElementById('pay-amount').value.trim();
  const st = document.getElementById('pay-status');
  if (!addr.startsWith('0x') || addr.length !== 42)
    return setStatus(st, 'Invalid address.', 'bad');
  if (!/^\d+$/.test(rawAmt) || rawAmt === '')
    return setStatus(st, 'Enter a whole dollar amount (no decimals).', 'bad');
  const amount = Number(rawAmt);
  if (amount <= 0)
    return setStatus(st, 'Amount must be greater than zero.', 'bad');

  const ready  = bills.filter(b => !b.spent && b.gasReady);
  ready.sort((a,b) => Number(b.denomination)-Number(a.denomination));
  const selected = [];
  let rem = amount;
  for (const b of ready) {
    if (rem <= 0) break;
    const d = Number(b.denomination);
    if (d <= rem) { selected.push(b); rem -= d; }
  }
  if (rem !== 0) return setStatus(st, `Cannot make exact $${amount} from your bills. Available: ${ready.map(b=>'$'+b.denomination).join(' ')}`, 'bad');

  payBills = selected;
  document.getElementById('pc-addr').textContent   = addr.slice(0,10)+'…'+addr.slice(-8);
  document.getElementById('pc-total').textContent  = `$${amount}`;
  document.getElementById('pc-count').textContent  = `${selected.length} bill${selected.length===1?'':'s'}`;
  document.getElementById('pc-bills').innerHTML    = selected.map(b =>
    `<div class="bill-card" style="margin-bottom:6px">
      <div><div class="bill-denom">$${b.denomination}</div><div class="bill-token tok-${b.token}">${TOKENS[b.token].label}</div></div>
      <div class="bill-age mono">${b.address.slice(0,10)}…</div>
    </div>`
  ).join('');
  document.getElementById('pay-input').style.display   = 'none';
  document.getElementById('pay-confirm').style.display = '';
  setStatus(document.getElementById('pc-status'), '', '');
}

async function sendPayment() {
  const addr = document.getElementById('pay-addr').value.trim();
  const btn  = document.getElementById('pc-send-btn');
  const st   = document.getElementById('pc-status');
  btn.disabled = true;
  const total = payBills.reduce((s,b)=>s+Number(b.denomination),0);
  let sentCount = 0;
  let lastTxHash = null;
  try {
    for (let i=0; i<payBills.length; i++) {
      const b   = payBills[i];
      const tok = TOKENS[b.token];
      setStatus(st, `Checking bill ${i+1}/${payBills.length} gas…`, 'info');
      const plsBal = await provider.getBalance(b.address);
      const MIN_GAS = 5000000000000000000n; // 5 PLS minimum
      if (plsBal < MIN_GAS) {
        btn.disabled = false;
        return setStatus(st,
          `Bill $${b.denomination} ${tok.label} has insufficient gas (${(Number(plsBal)/1e18).toFixed(2)} PLS — need at least 5). Open the bill detail and tap Refuel Gas, then try again.`,
          'bad'
        );
      }
      setStatus(st, `Sending bill ${i+1}/${payBills.length}: $${b.denomination} ${tok.label}…`, 'info');
      const w = new ethers.Wallet(b.privateKey, provider);
      const receipt = await sendTransfer(w, tok.addr, addr, BigInt(tok.denomWei[b.denomination]));
      lastTxHash = receipt?.transactionHash || receipt?.hash || null;
      b.spent = true;
      sentCount++;
      saveBills();
    }
    // Record payment history
    txHistory.push({
      ts: Date.now(),
      to: addr,
      total,
      bills: payBills.map(b => ({ denom: b.denomination, token: b.token }))
    });
    LS.set('privxpay_history_v1', txHistory);

    document.getElementById('pay-done-msg').textContent = `$${total} sent to ${addr.slice(0,10)}…`;
    const pdl = document.getElementById('pay-done-link');
    if (pdl && lastTxHash) {
      pdl.innerHTML = '';
      const a = document.createElement('a');
      a.href = 'https://scan.pulsechain.com/tx/' + lastTxHash;
      a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.style.cssText = 'color:var(--accent);font-size:13px;text-decoration:none;font-weight:700';
      a.textContent = '↗ View last tx on PulseChain Scan';
      pdl.appendChild(a);
    }
    document.getElementById('pay-confirm').style.display = 'none';
    document.getElementById('pay-done').style.display    = '';
    checkSweepablePrivx(payBills); // async — shows sweep card if PrivX found
  } catch(e) {
    saveBills();
    const remaining = payBills.length - sentCount;
    const sentAmt   = payBills.slice(0, sentCount).reduce((s,b)=>s+Number(b.denomination),0);
    if (sentCount > 0) {
      setStatus(st, `Partial failure: $${sentAmt} of $${total} sent (${sentCount} bill${sentCount===1?'':'s'}). ${remaining} bill${remaining===1?'':'s'} not sent.\n\nError: ${e.message}`, 'warn');
    } else {
      setStatus(st, 'Error: '+e.message, 'bad');
    }
    btn.disabled = false;
  }
}

function resetPay() {
  document.getElementById('pay-addr').value   = '';
  document.getElementById('pay-amount').value = '';
  payBills = [];
  hideSweepCard();
  showPayInput();
  renderPayAvail();
}

// ── PRIVX SWEEP ────────────────────────────────────────────────────────
// Spent bill wallets receive PrivX mining rewards on Hurricane withdrawal.
// After payment the DAI is gone but PrivX sits in the ephemeral address.
// Sweeping links bill wallet → primary wallet (minor privacy tradeoff).

let _sweepItems = []; // [{wallet, privxWei}]
const _billPrivxBal = {}; // billId → BigInt, populated by showReclaimForm

async function checkSweepablePrivx(spentBillList) {
  _sweepItems = [];
  const card = document.getElementById('sweep-card');
  if (!card) return;
  card.style.display = 'none';

  const checks = spentBillList.map(async b => {
    try {
      const bal = await balanceOf(PRIVX_TOKEN, b.address);
      if (bal > 0n) {
        const w = new ethers.Wallet(b.privateKey, provider);
        _sweepItems.push({ wallet: w, privxWei: bal, billId: b.id });
      }
    } catch (_) {}
  });
  await Promise.all(checks);

  if (_sweepItems.length === 0) return;

  const total = _sweepItems.reduce((s, i) => s + i.privxWei, 0n);
  const fmt   = v => (Number(v) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 4 });
  document.getElementById('sweep-amount').textContent = fmt(total) + ' PRIVX';
  card.style.display = '';
}

function hideSweepCard() {
  const card = document.getElementById('sweep-card');
  if (card) card.style.display = 'none';
  _sweepItems = [];
}

async function executeSweep() {
  if (!_sweepItems.length || !primaryWallet) return;
  const btn  = document.getElementById('sweep-btn');
  const st   = document.getElementById('sweep-status');
  const dest = (document.getElementById('sweep-dest')?.value || '').trim();
  if (!dest.startsWith('0x') || dest.length !== 42)
    return setStatus(st, 'Enter a valid destination address (0x…).', 'bad');

  btn.disabled = true;
  setStatus(st, 'Claiming PRIVX…', 'info');

  let claimed = 0n;
  let claimTxHash = null;
  const errors = [];
  for (const item of _sweepItems) {
    try {
      // Top up PLS if the bill wallet needs gas — use same price for both
      const gasPrice  = await getGasPrice();
      const gasNeeded = gasPrice * 120000n; // 100k gas limit + 20% headroom
      const plsBal    = await provider.getBalance(item.wallet.address);
      if (plsBal < gasNeeded) {
        await sendPls(primaryWallet, item.wallet.address, gasNeeded - plsBal + 10n**16n);
      }
      const receipt = await sendTransfer(item.wallet, PRIVX_TOKEN, dest, item.privxWei, gasPrice);
      claimTxHash = receipt?.transactionHash || receipt?.hash || null;
      claimed += item.privxWei;
    } catch (e) {
      errors.push(e.message);
    }
  }

  const fmt = v => (Number(v) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 4 });
  if (claimed > 0n) {
    setStatus(st, `✓ ${fmt(claimed)} PRIVX claimed.`, 'ok', claimTxHash);
    btn.style.display = 'none';
  }
  if (errors.length) {
    setStatus(st, (claimed > 0n ? st.textContent + '\n' : '') + 'Some failed: ' + errors.join('; '), 'warn');
    btn.disabled = false;
  }
  _sweepItems = [];
}

async function showReclaimForm(id) {
  const bill = bills.find(b => b.id === id);
  if (!bill) return;
  const container = document.getElementById('reclaim-form-' + id);
  if (!container) return;
  container.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:4px 0">Checking PRIVX balance…</div>';
  try {
    const bal = await balanceOf(PRIVX_TOKEN, bill.address);
    _billPrivxBal[id] = bal;
    const fmt = v => (Number(v) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 4 });
    if (bal === 0n) {
      container.innerHTML = '<div style="font-size:11px;color:var(--dim);padding:4px 0">No PRIVX in this bill wallet.</div>';
      return;
    }
    container.innerHTML = `
      <div style="font-size:12px;color:var(--accent);margin-bottom:6px">${fmt(bal)} PRIVX available</div>
      <input id="reclaim-dest-${id}" type="text" placeholder="Destination address (0x…)" autocomplete="off" spellcheck="false"
        style="width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(138,43,226,0.3);border-radius:8px;color:#fff;padding:8px 10px;font-size:11px;font-family:monospace;margin-bottom:6px;outline:none;box-sizing:border-box">
      <div id="reclaim-status-${id}" class="status"></div>
      <button class="btn btn-primary" style="width:100%;font-size:12px;padding:7px" onclick="executeReclaimPrivx('${id}')">Claim ${fmt(bal)} PRIVX</button>`;
  } catch(e) {
    const errDiv = document.createElement('div'); errDiv.style.cssText='font-size:11px;color:var(--error);padding:4px 0'; errDiv.textContent='Error: '+e.message; container.innerHTML=''; container.appendChild(errDiv);
  }
}

async function executeReclaimPrivx(id) {
  const bill = bills.find(b => b.id === id);
  if (!bill || !primaryWallet) return;
  const privxWei = _billPrivxBal[id];
  if (!privxWei || privxWei === 0n) return;
  const dest = (document.getElementById('reclaim-dest-' + id)?.value || '').trim();
  const st   = document.getElementById('reclaim-status-' + id);
  if (!dest.startsWith('0x') || dest.length !== 42)
    return setStatus(st, 'Enter a valid destination address (0x…).', 'bad');

  const container = document.getElementById('reclaim-form-' + id);
  const claimBtn  = container?.querySelector('button.btn-primary');
  if (claimBtn) claimBtn.disabled = true;
  setStatus(st, 'Claiming PRIVX…', 'info');

  try {
    const billWallet = new ethers.Wallet(bill.privateKey, provider);
    const gasPrice  = await getGasPrice();
    const gasNeeded = gasPrice * 120000n; // 100k gas limit + 20% headroom
    const plsBal    = await provider.getBalance(bill.address);
    if (plsBal < gasNeeded) {
      await sendPls(primaryWallet, bill.address, gasNeeded - plsBal + 10n**16n);
    }
    const receipt = await sendTransfer(billWallet, PRIVX_TOKEN, dest, privxWei, gasPrice);
    const txHash  = receipt?.transactionHash || receipt?.hash || null;
    const fmt = v => (Number(v) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 4 });
    setStatus(st, `✓ ${fmt(privxWei)} PRIVX claimed.`, 'ok', txHash);
    delete _billPrivxBal[id];
    if (claimBtn) claimBtn.style.display = 'none';
  } catch(e) {
    setStatus(st, 'Error: ' + e.message, 'bad');
    if (claimBtn) claimBtn.disabled = false;
  }
}

// ══════════════════════════════════════════════════════════════════════
// RECEIVE TAB
// ══════════════════════════════════════════════════════════════════════
let receiveRendered = false;
async function renderReceive() {
  if (!primaryWallet) return;
  const addr = primaryWallet.address;
  document.getElementById('receive-addr').textContent = addr;

  if (!receiveRendered) {
    renderQr(addr);
    receiveRendered = true;
  }

  // Reset amount field
  const reqAmt = document.getElementById('req-amount');
  if (reqAmt) reqAmt.value = '';

  try {
    const bal = await provider.getBalance(addr);
    document.getElementById('pls-bal').textContent =
      (Number(ethers.formatEther(bal))).toFixed(4)+' PLS';
  } catch {}
}

function updateRequestQr() {
  if (!primaryWallet) return;
  const addr = primaryWallet.address;
  const amt  = document.getElementById('req-amount')?.value.trim();
  const qrData = (amt && Number(amt) > 0) ? `${addr}?amount=${Math.floor(Number(amt))}` : addr;
  renderQr(qrData);
  receiveRendered = false; // allow re-render next tab visit if address changes
}

function renderQr(data) {
  const size = Math.min(window.innerWidth - 64, 280);
  QRCode.toDataURL(data, { width: size, margin: 2, color: { dark: '#000000', light: '#ffffff' } },
    (err, url) => {
      if (err) { console.error('QR render error:', err); return; }
      const img = document.getElementById('qr-img-receive');
      if (img) { img.src = url; img.width = size; img.height = size; }
    });
}

async function copyAddress() {
  const addr = primaryWallet?.address;
  if (!addr) return;
  await navigator.clipboard.writeText(addr).catch(()=>{});
  const btn = document.getElementById('copy-btn');
  btn.textContent = 'Copied!';
  setTimeout(()=>{ btn.textContent = 'Copy Address'; }, 2000);
}

// ══════════════════════════════════════════════════════════════════════
// RESTOCK TAB
// ══════════════════════════════════════════════════════════════════════
function setRestockTab(t) {
  document.getElementById('rst-bills').style.display  = t==='bills' ? '' : 'none';
  document.getElementById('rst-shield').style.display = t==='shield'? '' : 'none';
  document.getElementById('rst-swap').style.display   = t==='swap'  ? '' : 'none';
  document.getElementById('rst-tab-bills').classList.toggle('active', t==='bills');
  document.getElementById('rst-tab-shield').classList.toggle('active', t==='shield');
  document.getElementById('rst-tab-swap').classList.toggle('active', t==='swap');
  if (t==='shield') renderShieldUI();
  if (t==='swap')   renderSwapUI();
}

// ── NOTES ─────────────────────────────────────────────────────────────
function renderNotes() {
  const list  = document.getElementById('notes-list');
  const empty = document.getElementById('notes-empty');
  const ctrl  = document.getElementById('bills-controls');
  list.innerHTML = '';

  const active    = notes.filter(n => !n.withdrawn);
  const withdrawn = notes.filter(n =>  n.withdrawn);

  if (!notes.length) {
    empty.style.display = ''; ctrl.style.display = 'none'; selectedNote = null;
    setRestockTab('shield');
    return;
  }
  if (!active.length && withdrawn.length) {
    empty.style.display = 'none';
    ctrl.style.display  = 'none';
    selectedNote        = null;
  } else {
    empty.style.display = 'none';
  }

  // Render active notes
  active.forEach(n => {
    const tok = TOKENS[n.token];
    const div = document.createElement('div');
    div.className = 'note-card' + (selectedNote === n.noteStr ? ' active' : '');
    const isBad = n.error === 'commitment_not_found';
    const top = document.createElement('div');
    top.className = 'nc-top';
    const denom = document.createElement('span');
    denom.className = 'nc-denom';
    denom.textContent = `$${n.denom} ${tok ? tok.label : n.token}`;
    top.appendChild(denom);
    if (isBad) {
      const badge = document.createElement('span');
      badge.style.cssText = 'color:#e05;font-size:10px;font-weight:800;letter-spacing:0.03em';
      badge.textContent = 'deposit failed';
      top.appendChild(badge);
      const rmBtn = document.createElement('button');
      rmBtn.textContent = 'Remove';
      rmBtn.style.cssText = 'margin-top:8px;padding:4px 12px;font-size:11px;background:#2a0a0a;color:#e05;border:1px solid #e05;border-radius:6px;cursor:pointer;width:100%';
      rmBtn.onclick = e => { e.stopPropagation(); removeInvalidNote(n.noteStr); };
      div.appendChild(top);
      div.appendChild(rmBtn);
    } else {
      const date = document.createElement('span');
      date.className = 'nc-date';
      date.textContent = new Date(n.ts).toLocaleDateString();
      top.appendChild(date);
      div.appendChild(top);
      div.onclick = () => { selectedNote = selectedNote === n.noteStr ? null : n.noteStr; renderNotes(); };
    }
    list.appendChild(div);
  });

  // Render withdrawn notes (greyed out, not selectable)
  if (withdrawn.length) {
    const sep = document.createElement('div');
    sep.style.cssText = 'font-size:10px;color:var(--dim);letter-spacing:1px;text-transform:uppercase;margin:12px 0 6px;font-weight:700';
    sep.textContent = 'Used notes';
    list.appendChild(sep);
    withdrawn.forEach(n => {
      const tok = TOKENS[n.token];
      const div = document.createElement('div');
      div.className = 'note-card';
      div.style.cssText = 'opacity:0.45;pointer-events:none';
      div.innerHTML = `<div class="nc-top"><span class="nc-denom">$${n.denom} ${tok ? tok.label : n.token}</span><span class="nc-date" style="color:var(--success);font-size:10px;font-weight:800">withdrawn ✓</span></div>`;
      list.appendChild(div);
    });
  }

  ctrl.style.display = selectedNote ? '' : 'none';
}

function clearWithdrawnNotes() {
  notes = notes.filter(n => !n.withdrawn);
  saveNotes();
  renderNotes();
}

function removeInvalidNote(noteStr) {
  const n = notes.find(n => n.noteStr === noteStr);
  if (!n || n.error !== 'commitment_not_found') return; // guard: only bad notes
  if (!confirm('Remove this invalid note? The deposit never went through — no funds are at risk.')) return;
  notes = notes.filter(n => n.noteStr !== noteStr);
  if (selectedNote === noteStr) selectedNote = null;
  saveNotes();
  renderNotes();
}

async function verifyNoteCommitment() {
  if (!selectedNote) return;
  const noteObj = notes.find(n => n.noteStr === selectedNote);
  if (!noteObj || noteObj.withdrawn) return;
  const st = document.getElementById('bills-status');
  const btn = document.getElementById('verify-btn');
  btn.disabled = true;
  try {
    setStatus(st, 'Initialising…', 'info');
    await initPoseidon();
    const parsed = parseNote(selectedNote);
    setStatus(st, 'Checking deposit on-chain…', 'info');
    const logs = await ethLogs(parsed.shieldAddr, DEPOSIT_TOPIC);
    const found = logs.some(l => BigInt(l.topics[1]) === parsed.commitment);
    if (found) {
      setStatus(st, 'Deposit confirmed on-chain ✓ — note is valid.', 'ok');
    } else {
      noteObj.error = 'commitment_not_found';
      saveNotes();
      selectedNote = null;
      renderNotes();
    }
  } catch(e) {
    setStatus(st, 'Error: ' + e.message, 'bad');
  } finally {
    btn.disabled = false;
  }
}

// ── CREATE BILLS ───────────────────────────────────────────────────────
function startCreateBills() {
  if (!selectedNote) return;
  // Show proof warning modal, then createBills() continues via confirmProofWarn()
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const el = document.getElementById('pw-time');
  if (el) el.textContent = isMobile ? '~2–5 min on mobile' : '~15–30 sec on desktop';
  document.getElementById('proof-warn').classList.add('show');
}

let _proofWarnResolve = null;

function confirmProofWarn() {
  document.getElementById('proof-warn').classList.remove('show');
  createBills();
}

async function createBills() {
  if (!selectedNote) return;
  const noteObj = notes.find(n=>n.noteStr===selectedNote);
  if (!noteObj) return;

  const btn  = document.getElementById('create-btn');
  const st   = document.getElementById('bills-status');
  const prog = document.getElementById('bills-progress');
  const bar  = document.getElementById('bills-bar');
  const barL = document.getElementById('bills-bar-label');
  btn.disabled = true;
  prog.style.display = '';
  bar.style.width = '0%';
  barL.textContent = '';

  let wakeLock = null;
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
  proofRunning = true;

  try {
    setStatus(st, 'Checking PLS balance…', 'info');
    // Auto-relay path needs 1000+20+5; export path only needs a few PLS for gas
    await preflightPls(5000000000000000000n); // minimum 5 PLS — real check happens in auto relay

    setStatus(st, 'Initialising Poseidon…', 'info');
    await initPoseidon();

    const parsed = parseNote(selectedNote);

    const nhHex  = parsed.nullifierHash.toString(16).padStart(64,'0');
    const spentR = await ethCall(parsed.shieldAddr, '0x17cc915c', nhHex);
    if (BigInt(spentR) === 1n) {
      noteObj.withdrawn = true; saveNotes();
      setStatus(st, 'This note has already been spent on-chain.', 'bad');
      selectedNote = null; renderNotes();
      return;
    }

    setStatus(st, 'Building Merkle proof…', 'info');
    const merkle = await getMerkleProof(parsed.shieldAddr, parsed.commitment);
    bar.style.width = '20%';

    // Bill wallet — fresh ephemeral address that will receive the withdrawn funds
    const billWallet = ethers.Wallet.createRandom();

    const circuitInput = {
      nullifier:     parsed.nullifier.toString(),
      secret:        parsed.secret.toString(),
      pathIndices:   merkle.pathIndices.map(String),
      siblings:      merkle.siblings,
      root:          merkle.proofRoot.toString(),
      denomination:  parsed.denomWei.toString(),
      nullifierHash: parsed.nullifierHash.toString(),
      recipient:     BigInt(billWallet.address).toString()
    };

    bar.style.width = '35%';
    const argv = await generateProof(circuitInput, msg => setStatus(st, msg, 'info'));
    bar.style.width = '70%';
    barL.textContent = 'Proof ready';

    // Proof done — release wake lock, let user decide relay method
    proofRunning = false;
    wakeLock?.release?.().catch(()=>{}); wakeLock = null;

    const choice = await showRelayChoice();
    if (choice === 'cancel') {
      setStatus(st, '', '');
      bar.style.width = '0%';
      barL.textContent = '';
      return;
    }

    if (choice === 'auto') {
      await runAutoRelay({ argv, billWallet, parsed, noteObj, st, bar, barL });
    } else {
      await runExportRelay({ argv, billWallet, parsed, noteObj, st, bar, barL });
    }

  } catch(e) {
    if (e.message && e.message.includes('Commitment not found')) {
      const stuck = notes.find(n => n.noteStr === selectedNote);
      if (stuck) { stuck.error = 'commitment_not_found'; saveNotes(); renderNotes(); }
    }
    setStatus(st, 'Error: '+e.message, 'bad');
  } finally {
    proofRunning = false;
    wakeLock?.release?.().catch(()=>{});
    document.getElementById('relay-choice').style.display = 'none';
    btn.disabled = false;
  }
}

function showRelayChoice() {
  return new Promise(resolve => {
    _relayChoiceResolve = resolve;
    document.getElementById('relay-choice').style.display = '';
  });
}

function resolveRelayChoice(choice) {
  document.getElementById('relay-choice').style.display = 'none';
  if (_relayChoiceResolve) { _relayChoiceResolve(choice); _relayChoiceResolve = null; }
}

async function runAutoRelay({ argv, billWallet, parsed, noteObj, st, bar, barL }) {
  // Fetch actual gas price so we can fund the proxy exactly and pin all proxy txs to
  // legacy type-0 pricing. EIP-1559 auto-estimates maxFeePerGas ~100–1000× the real
  // gasPrice, so the node balance-check (maxFeePerGas × gasLimit + value) rejects the
  // withdrawal tx even though the actual gas cost is only a fraction of that.
  setStatus(st, 'Checking gas…', 'info');
  const feeData = await provider.getFeeData().catch(() => ({}));
  const gasPrice = (feeData.gasPrice || 5000000000n) * 125n / 100n; // +25% buffer

  // Proxy needs: 1M gas budget for withdrawal + 30k for bill PLS send + bill amount
  const proxyFund = gasPrice * 1030000n + BILL_GAS_PLS;

  // Primary preflight: proxyFund + gas for the sendPls to proxy + 2 PLS buffer
  await preflightPls(proxyFund + gasPrice * 30000n + 2000000000000000000n);

  // Ephemeral proxy calls the shield — primary wallet never appears in the withdrawal tx
  const proxyWallet = ethers.Wallet.createRandom().connect(provider);

  setStatus(st, 'Funding relay proxy…', 'info');
  // Inline with explicit legacy gasPrice so primary wallet's own send doesn't trip the
  // EIP-1559 maxFeePerGas × gasLimit balance check either.
  const fTx0 = await primaryWallet.sendTransaction({
    to: proxyWallet.address, value: proxyFund, gasLimit: 21000n, type: 0, gasPrice
  });
  await fTx0.wait();

  // Poll until the node serving us actually sees the proxy's balance.
  // RPC clusters can lag 1–2 blocks behind the node that mined the funding tx,
  // causing the withdrawal to fail with "insufficient funds" even though the
  // funding confirmed. Typically resolves in the first or second check.
  setStatus(st, 'Confirming proxy funds…', 'info');
  for (let i = 0; i < 8; i++) {
    const bal = await provider.getBalance(proxyWallet.address);
    if (bal >= proxyFund) break;
    await new Promise(r => setTimeout(r, 1500));
  }

  setStatus(st, 'Submitting withdrawal via proxy…', 'info');
  const pad = v => BigInt(v).toString(16).padStart(64,'0');
  const withdrawData = '0x8172d2d0'
    + argv.slice(0,24).map(pad).join('')
    + argv.slice(24,28).map(pad).join('')
    + addrArg(billWallet.address);
  // type:0 legacy tx — balance check is gasPrice×gasLimit (cheap), not maxFeePerGas×gasLimit
  const wTx = await proxyWallet.sendTransaction({
    to: parsed.shieldAddr, data: withdrawData, gasLimit: 1000000n, type: 0, gasPrice
  });

  // Save the bill key IMMEDIATELY after broadcast — before awaiting confirmation.
  // If the page closes or crashes while waiting, the key is already in localStorage
  // and the user can find their funds when the TX confirms on-chain.
  const bill = {
    id: 'bill_'+Date.now()+'_'+Math.random().toString(36).slice(2),
    address: billWallet.address, privateKey: billWallet.privateKey,
    denomination: parsed.denom, token: parsed.token,
    createdAt: Date.now(), gasReady: false, spent: false,
    withdrawalHash: wTx.hash
  };
  bills.push(bill); saveBills();

  await wTx.wait();
  bar.style.width = '85%';

  noteObj.withdrawn = true; saveNotes();

  try {
    setStatus(st, 'Funding bill wallet with gas…', 'info');
    const fTx1 = await proxyWallet.sendTransaction({
      to: billWallet.address, value: BILL_GAS_PLS, gasLimit: 21000n, type: 0, gasPrice
    });
    await fTx1.wait();
    bill.gasReady = true; saveBills();
  } catch(e) { console.warn('Gas funding failed:', e.message); }

  bar.style.width = '100%';
  barL.textContent = 'Done';
  setStatus(st, `✓ ${parsed.denom} ${TOKENS[parsed.token].label} bill is ready to spend.`, 'ok', wTx.hash);
  selectedNote = null; renderNotes(); renderWallet();
}

async function runExportRelay({ argv, billWallet, parsed, noteObj, st, bar, barL }) {
  // Build proof JSON in the exact format relayer.html expects
  const proofJson = {
    protocol:    'PrivX Hurricane',
    version:     '1',
    chainId:     369,
    shield:      parsed.shieldAddr,
    token:       parsed.token.toUpperCase(),
    denomination: parsed.denom,
    recipient:   billWallet.address,
    proof:       argv.slice(0, 24),
    pubSignals:  argv.slice(24, 28),
    generated:   Date.now()
  };

  // Trigger JSON download
  const blob = new Blob([JSON.stringify(proofJson, null, 2)], {type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `privx-proof-${parsed.token}-${parsed.denom}-${Date.now()}.json`;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);

  // Mark note withdrawn — nullifier committed once proof is shared
  noteObj.withdrawn = true; saveNotes();

  // Save bill in pending-relay state
  const bill = {
    id: 'bill_'+Date.now()+'_'+Math.random().toString(36).slice(2),
    address: billWallet.address, privateKey: billWallet.privateKey,
    denomination: parsed.denom, token: parsed.token,
    createdAt: Date.now(), gasReady: false, spent: false,
    relayPending: true,
    shieldAddr: parsed.shieldAddr,
    nullifierHash: parsed.nullifierHash.toString()
  };
  bills.push(bill); saveBills();

  bar.style.width = '100%';
  barL.textContent = 'Proof exported';
  setStatus(st, '✓ Proof downloaded — open the Hurricane Relayer, load the JSON and connect any wallet to submit. Once submitted, come back and tap Check Relay on your bill — gas funds automatically.', 'ok');
  const relayerA = document.createElement('a');
  relayerA.href = EXTERNAL_RELAYER_URL;
  relayerA.target = '_blank'; relayerA.rel = 'noopener noreferrer';
  relayerA.style.cssText = 'color:var(--accent);display:block;margin-top:8px;font-size:12px;font-weight:700;text-decoration:none';
  relayerA.textContent = '↗ Open Hurricane Relayer';
  st.appendChild(relayerA);
  selectedNote = null; renderNotes(); renderWallet();
}

async function checkRelayStatus(billId) {
  const bill = bills.find(b => b.id === billId);
  if (!bill || !bill.relayPending) return;
  const st = document.getElementById('relay-status-' + billId);
  if (!st) return;
  setStatus(st, 'Checking on-chain…', 'info');
  try {
    const nhHex = BigInt(bill.nullifierHash).toString(16).padStart(64, '0');
    const result = await ethCall(bill.shieldAddr, '0x17cc915c', nhHex);
    if (BigInt(result) !== 1n) {
      setStatus(st, 'Not yet relayed — nullifier still unspent. Try again after the relayer submits.', 'warn');
      return;
    }
    bill.relayPending = false; saveBills();
    setStatus(st, '✓ Relay confirmed — funding bill with gas…', 'ok');
    renderWallet();
    // Auto-fund gas so the bill is immediately ready to spend, same as auto-relay
    try {
      await sendPls(primaryWallet, bill.address, BILL_GAS_PLS);
      bill.gasReady = true; saveBills();
      setStatus(st, '✓ Bill ready to spend.', 'ok');
      renderWallet();
    } catch(e) {
      setStatus(st, `Relay confirmed but gas funding failed: ${e.message} — tap Fund Gas to retry.`, 'warn');
    }
  } catch(e) {
    setStatus(st, 'Error: ' + e.message, 'bad');
  }
}

async function submitProofFromJson(billId) {
  const bill = bills.find(b => b.id === billId);
  if (!bill || !primaryWallet) return;
  const st = document.getElementById('relay-status-' + billId);

  // Open native file picker
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());

      if (!json.proof || !json.pubSignals)
        throw new Error('Not a valid PrivX proof file — missing proof or pubSignals.');
      if (json.shield?.toLowerCase() !== bill.shieldAddr?.toLowerCase())
        throw new Error('Proof is for a different shield contract.');
      if (json.recipient?.toLowerCase() !== bill.address?.toLowerCase())
        throw new Error('Proof recipient does not match this bill wallet.');

      // Reconstruct argv the same way runAutoRelay uses it
      const argv = [...json.proof, ...json.pubSignals];

      setStatus(st, 'Checking gas…', 'info');
      const feeData = await provider.getFeeData().catch(() => ({}));
      const gasPrice = (feeData.gasPrice || 5000000000n) * 125n / 100n;
      const proxyFund = gasPrice * 1030000n + BILL_GAS_PLS;
      await preflightPls(proxyFund + gasPrice * 30000n + 2000000000000000000n);

      const proxyWallet = ethers.Wallet.createRandom().connect(provider);

      setStatus(st, 'Funding relay proxy…', 'info');
      const fTx0 = await primaryWallet.sendTransaction({
        to: proxyWallet.address, value: proxyFund, gasLimit: 21000n, type: 0, gasPrice
      });
      await fTx0.wait();

      setStatus(st, 'Confirming proxy funds…', 'info');
      for (let i = 0; i < 8; i++) {
        const bal = await provider.getBalance(proxyWallet.address);
        if (bal >= proxyFund) break;
        await new Promise(r => setTimeout(r, 1500));
      }

      setStatus(st, 'Submitting withdrawal via proxy…', 'info');
      const pad = v => BigInt(v).toString(16).padStart(64, '0');
      const withdrawData = '0x8172d2d0'
        + argv.slice(0, 24).map(pad).join('')
        + argv.slice(24, 28).map(pad).join('')
        + addrArg(bill.address);
      const wTx = await proxyWallet.sendTransaction({
        to: bill.shieldAddr, data: withdrawData, gasLimit: 1000000n, type: 0, gasPrice
      });
      await wTx.wait();

      bill.relayPending = false; saveBills();

      try {
        setStatus(st, 'Funding bill with gas…', 'info');
        const fTx1 = await proxyWallet.sendTransaction({
          to: bill.address, value: BILL_GAS_PLS, gasLimit: 21000n, type: 0, gasPrice
        });
        await fTx1.wait();
        bill.gasReady = true; saveBills();
      } catch(e) { console.warn('Gas funding failed:', e.message); }

      setStatus(st, '✓ Proof submitted — bill is ready to spend.', 'ok', wTx.hash);
      renderWallet();
    } catch(e) {
      setStatus(st, 'Error: ' + e.message, 'bad');
    }
  };
  input.click();
}

// ── SHIELD ────────────────────────────────────────────────────────────
function renderShieldUI() {
  const tg = document.getElementById('token-grid');
  tg.innerHTML = Object.entries(TOKENS).map(([k,t]) =>
    t.comingSoon
      ? `<div class="chip chip-soon"><div class="cval">${t.label}</div><div style="font-size:9px;opacity:.55;margin-top:2px;letter-spacing:.3px">SOON</div></div>`
      : `<div class="chip${k===selectedToken?' active':''}" onclick="selectToken('${k}')"><div class="cval">${t.label}</div></div>`
  ).join('');
  const dg = document.getElementById('denom-grid');
  dg.innerHTML = DENOMS.map(d =>
    `<div class="chip${d===selectedDenom?' active':''}" onclick="selectDenom('${d}')">
      <div class="cval">$${d}</div></div>`
  ).join('');
  updateShieldBtn();
}

function selectToken(k) {
  selectedToken = k; selectedDenom = null;
  renderShieldUI();
}
function selectDenom(d) {
  selectedDenom = d;
  renderShieldUI();
}
function updateShieldBtn() {
  const btn = document.getElementById('shield-btn');
  btn.disabled    = !selectedDenom;
  btn.textContent = selectedDenom
    ? `Review $${selectedDenom} ${TOKENS[selectedToken].label} Deposit`
    : 'Select denomination';
}

async function reviewShield() {
  if (!selectedDenom) return;
  const tok      = TOKENS[selectedToken];
  if (tok.comingSoon) return showToast('pSunDAI shields are coming soon — new contracts deploying.');
  const denomWei = tok.denomWei[selectedDenom];
  const feeWei   = (denomWei * BigInt(tok.feeBP)) / 10000n;
  const totalWei = denomWei + feeWei;
  const shield   = tok.shields[selectedDenom];
  const fmt      = (wei) => (Number(wei) / 10 ** tok.decimals).toFixed(tok.decimals === 6 ? 2 : 4);

  // Fetch balance
  let balText = '…';
  try {
    const bal = await balanceOf(tok.addr, primaryWallet.address);
    const balFmt = (Number(bal) / 10 ** tok.decimals).toFixed(tok.decimals === 6 ? 2 : 4);
    const enough = bal >= totalWei;
    balText = `${balFmt} ${tok.label}${!enough ? ' ⚠ insufficient' : ''}`;
    document.getElementById('sc-balance').style.color = enough ? '' : 'var(--err)';
  } catch { balText = 'Could not fetch'; }

  document.getElementById('sc-action').textContent   = `Shield $${selectedDenom} ${tok.label}`;
  document.getElementById('sc-contract').textContent = shield.slice(0,12)+'…'+shield.slice(-8);
  document.getElementById('sc-balance').textContent  = balText;
  document.getElementById('sc-amount').textContent   = `${fmt(denomWei)} ${tok.label}`;
  document.getElementById('sc-fee').textContent      = `${fmt(feeWei)} ${tok.label}`;
  document.getElementById('sc-total').textContent    = `${fmt(totalWei)} ${tok.label}`;

  document.getElementById('shield-confirm').style.display = '';
  document.getElementById('shield-btn').style.display     = 'none';
  document.getElementById('denom-grid').style.pointerEvents = 'none';
  document.getElementById('token-grid').style.pointerEvents = 'none';
}

function cancelShieldConfirm() {
  document.getElementById('shield-confirm').style.display = 'none';
  document.getElementById('shield-btn').style.display     = '';
  document.getElementById('denom-grid').style.pointerEvents = '';
  document.getElementById('token-grid').style.pointerEvents = '';
}

async function doShield() {
  if (!selectedDenom) return;
  const st      = document.getElementById('shield-status');
  const confBtn = document.getElementById('shield-confirm-btn');
  if (confBtn) confBtn.disabled = true;
  document.getElementById('note-reveal').style.display = 'none';

  let savedNoteStr = null;

  try {
    await preflightPls(5000000000000000000n); // need ~2–5 PLS for approve + deposit gas
    setStatus(st, 'Initialising Poseidon…', 'info');
    await initPoseidon();

    const tok        = TOKENS[selectedToken];
    const shieldAddr = tok.shields[selectedDenom];
    const denomWei   = tok.denomWei[selectedDenom];
    const feeWei     = (denomWei * BigInt(tok.feeBP)) / 10000n;
    const totalWei   = denomWei + feeWei;

    setStatus(st, 'Generating note…', 'info');
    const gen = await generateNote(selectedToken, selectedDenom);
    savedNoteStr = gen.noteStr;

    // Save note BEFORE deposit — if app crashes after deposit, note is still recoverable
    notes.push({ noteStr:gen.noteStr, token:selectedToken, denom:selectedDenom, ts:Date.now(), withdrawn:false });
    saveNotes();

    setStatus(st, `Checking ${tok.label} allowance…`, 'info');
    const allow = await allowanceOf(tok.addr, primaryWallet.address, shieldAddr);
    if (allow < totalWei) {
      setStatus(st, `Approving ${tok.label}…`, 'info');
      await sendApprove(primaryWallet, tok.addr, shieldAddr, totalWei);
    }

    // Check token balance before attempting deposit
    const balance = await balanceOf(tok.addr, primaryWallet.address);
    if (balance < totalWei) {
      const have = Number(balance) / 10 ** tok.decimals;
      const need = Number(totalWei) / 10 ** tok.decimals;
      throw new Error(`Insufficient ${tok.label} balance. Have ${have.toFixed(tok.decimals===6?2:4)}, need ${need.toFixed(tok.decimals===6?2:4)} (including 0.5% fee).`);
    }

    setStatus(st, 'Depositing into PrivX shield…', 'info');
    const depositGasPrice = await getGasPrice();
    const tx = await primaryWallet.sendTransaction({
      to: shieldAddr,
      data: '0xb214faa5'+gen.commitmentHex.slice(2),
      gasLimit: 2000000n, // Merkle tree update (14-level Poseidon) needs ~1–1.5M gas
      type: 0, gasPrice: depositGasPrice
    });
    await tx.wait();

    document.getElementById('note-reveal-text').textContent = gen.noteStr;
    document.getElementById('note-reveal').style.display = '';
    setStatus(st, `✓ ${selectedDenom} ${tok.label} shielded. Back up your note below, then go to Create Bills.`, 'ok', tx.hash);
    document.getElementById('shield-confirm').style.display = 'none';
    document.getElementById('denom-grid').style.pointerEvents = '';
    document.getElementById('token-grid').style.pointerEvents = '';
    selectedDenom = null; renderShieldUI();
    setRestockTab('bills'); renderNotes();
    refreshHeader();
  } catch(e) {
    if (savedNoteStr) {
      notes = notes.filter(n => n.noteStr !== savedNoteStr);
      saveNotes();
    }
    setStatus(st, 'Error: '+e.message, 'bad');
    // Re-enable confirm button so user can retry
    const confBtn = document.getElementById('shield-confirm-btn');
    if (confBtn) confBtn.disabled = false;
    document.getElementById('shield-btn').style.display = '';
    document.getElementById('shield-confirm').style.display = 'none';
    document.getElementById('denom-grid').style.pointerEvents = '';
    document.getElementById('token-grid').style.pointerEvents = '';
  }
}

function copyNote() {
  const text = document.getElementById('note-reveal-text').textContent;
  navigator.clipboard.writeText(text).catch(()=>{});
  const btn = document.getElementById('note-copy-btn');
  btn.textContent = '✓ Copied!';
  setTimeout(()=>{ btn.textContent = 'Copy Note'; }, 2500);
}

function copyText(text) {
  navigator.clipboard.writeText(text).catch(()=>{});
}

// ══════════════════════════════════════════════════════════════════════
// SWAP (PLS → stable via PulseX V2)
// ══════════════════════════════════════════════════════════════════════
// Verify these addresses at scan.pulsechain.com before deploying to mainnet
const WPLS          = '0xA1077a294dDE1B09bB078844df40758a5D0f9a27';
const PULSEX_ROUTER = '0x165C3410fC91EF562C50559f7d2289fEbed552d9'; // PulseX V2 Router
const SWAP_SLIPPAGE = 50n; // 0.5% in basis points

// Swap paths: try direct WPLS→token first; fallback routes via DAI for USDC/pSunDAI
const SWAP_PATHS = {
  dai:     [[WPLS, '0xefD766cCb38EaF1dfd701853BFCe31359239F305']],
  usdc:    [[WPLS, '0x15D38573d2feeb82e7ad5187aB8c1D52810B1f07'],
            [WPLS, '0xefD766cCb38EaF1dfd701853BFCe31359239F305', '0x15D38573d2feeb82e7ad5187aB8c1D52810B1f07']],
  psundai: [[WPLS, '0x1c2a9d0d6c641F92284EeCF8aC62D1e39D703E4f'],
            [WPLS, '0xefD766cCb38EaF1dfd701853BFCe31359239F305', '0x1c2a9d0d6c641F92284EeCF8aC62D1e39D703E4f']],
};

let swapToken    = 'dai';
let swapQuote    = null; // { amountOut: BigInt, amountOutMin: BigInt, path: string[] }
let swapDebounce = null;

// ABI-encode getAmountsOut(uint256 amountIn, address[] path)
function encodeGetAmountsOut(amountIn, path) {
  const h = v => BigInt(v).toString(16).padStart(64,'0');
  const a = addr => addr.slice(2).toLowerCase().padStart(64,'0');
  return '0xd06ca61f' + h(amountIn) + h(64) + h(path.length) + path.map(a).join('');
}

// ABI-encode swapExactETHForTokens(uint amountOutMin, address[] path, address to, uint deadline)
function encodeSwapExactETHForTokens(amountOutMin, path, to, deadline) {
  const h = v => BigInt(v).toString(16).padStart(64,'0');
  const a = addr => addr.slice(2).toLowerCase().padStart(64,'0');
  // params: amountOutMin, path (dynamic), to, deadline
  // path offset = 4 params * 32 = 128
  return '0x7ff36ab5'
    + h(amountOutMin)
    + h(128)
    + a(to)
    + h(deadline)
    + h(path.length)
    + path.map(a).join('');
}

// Decode uint256[] return from getAmountsOut — returns last element (amountOut)
function decodeAmountsOut(hex) {
  const data = hex.startsWith('0x') ? hex.slice(2) : hex;
  // layout: offset(32) + length(32) + amounts[0](32) + ... + amounts[n-1](32)
  const len = parseInt(data.slice(64, 128), 16);
  const lastStart = 128 + (len - 1) * 64;
  return BigInt('0x' + data.slice(lastStart, lastStart + 64));
}

async function fetchBestQuote(plsWei, tokenKey) {
  const paths = SWAP_PATHS[tokenKey];
  let bestOut = 0n, bestPath = null;
  for (const path of paths) {
    try {
      const data   = encodeGetAmountsOut(plsWei, path);
      const result = await rpc('eth_call', [{ to: PULSEX_ROUTER, data }, 'latest']);
      const out    = decodeAmountsOut(result);
      if (out > bestOut) { bestOut = out; bestPath = path; }
    } catch { /* pair may not exist */ }
  }
  if (!bestPath) throw new Error('No liquidity found for this pair on PulseX.');
  const amountOutMin = bestOut - (bestOut * SWAP_SLIPPAGE / 10000n);
  return { amountOut: bestOut, amountOutMin, path: bestPath };
}

function renderSwapUI() {
  const tg = document.getElementById('swap-token-grid');
  if (!tg) return;
  tg.innerHTML = Object.entries(TOKENS).map(([k,t]) =>
    `<div class="chip${k===swapToken?' active':''}" onclick="selectSwapToken('${k}')">
       <div class="cval">${t.label}</div></div>`
  ).join('');
}

function selectSwapToken(k) {
  swapToken = k;
  swapQuote = null;
  renderSwapUI();
  document.getElementById('swap-quote-box').style.display = 'none';
  document.getElementById('swap-btn').disabled = true;
  document.getElementById('swap-btn').textContent = 'Enter amount';
  triggerSwapQuote();
}

function onSwapInput() {
  swapQuote = null;
  document.getElementById('swap-quote-box').style.display = 'none';
  document.getElementById('swap-btn').disabled = true;
  document.getElementById('swap-btn').textContent = 'Get Quote';
  clearTimeout(swapDebounce);
  swapDebounce = setTimeout(triggerSwapQuote, 600);
}

async function triggerSwapQuote() {
  const rawPls = document.getElementById('swap-pls-input').value.trim();
  if (!rawPls || Number(rawPls) <= 0) return;
  const plsWei = BigInt(Math.floor(Number(rawPls) * 1e18));
  const st = document.getElementById('swap-status');
  const btn = document.getElementById('swap-btn');
  btn.disabled = true;
  btn.textContent = 'Getting quote…';
  setStatus(st, '', '');
  try {
    const q   = await fetchBestQuote(plsWei, swapToken);
    swapQuote = { ...q, plsWei };
    const tok = TOKENS[swapToken];
    const fmt = (wei) => (Number(wei) / 10 ** tok.decimals).toLocaleString(undefined, { maximumFractionDigits: 4 });
    const routeNames = q.path.map(a => {
      if (a.toLowerCase() === WPLS.toLowerCase()) return 'WPLS';
      return Object.entries(TOKENS).find(([,t]) => t.addr.toLowerCase()===a.toLowerCase())?.[1].label ?? a.slice(0,8);
    }).join(' → ');
    document.getElementById('swap-quote-amount').textContent = fmt(q.amountOut) + ' ' + tok.label;
    document.getElementById('swap-quote-min').textContent    = fmt(q.amountOutMin) + ' ' + tok.label;
    document.getElementById('swap-quote-route').textContent  = routeNames;
    document.getElementById('swap-quote-box').style.display = '';
    btn.disabled = false;
    btn.textContent = `Review Swap`;
  } catch(e) {
    setStatus(st, 'Quote failed: ' + e.message, 'bad');
    btn.textContent = 'Enter amount';
  }
}

function reviewSwap() {
  if (!swapQuote) return;
  const tok  = TOKENS[swapToken];
  const fmt  = (wei) => (Number(wei) / 10 ** tok.decimals).toLocaleString(undefined, { maximumFractionDigits: 4 });
  const plsFmt = (Number(swapQuote.plsWei) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 4 });
  document.getElementById('sc-pls-out').textContent   = plsFmt + ' PLS';
  document.getElementById('sc-token-in').textContent  = fmt(swapQuote.amountOutMin) + ' ' + tok.label;
  document.getElementById('sc-swap-to').textContent   = primaryWallet.address.slice(0,14)+'…'+primaryWallet.address.slice(-10);
  document.getElementById('swap-confirm').style.display = '';
  document.getElementById('swap-btn').style.display     = 'none';
  document.getElementById('swap-quote-box').style.display = 'none';
  document.getElementById('swap-pls-input').disabled   = true;
  document.getElementById('swap-token-grid').style.pointerEvents = 'none';
}

function cancelSwapConfirm() {
  document.getElementById('swap-confirm').style.display   = 'none';
  document.getElementById('swap-btn').style.display       = '';
  document.getElementById('swap-quote-box').style.display = swapQuote ? '' : 'none';
  document.getElementById('swap-pls-input').disabled      = false;
  document.getElementById('swap-token-grid').style.pointerEvents = '';
}

async function executeSwap() {
  if (!swapQuote) return;
  const btn = document.getElementById('swap-confirm-btn');
  const st  = document.getElementById('swap-status');
  btn.disabled = true;
  try {
    await preflightPls(swapQuote.plsWei + 2000000000000000000n); // swap amount + 2 PLS gas buffer
    setStatus(st, 'Sending swap transaction…', 'info');
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200); // 20 min
    const data = encodeSwapExactETHForTokens(
      swapQuote.amountOutMin, swapQuote.path, primaryWallet.address, deadline
    );
    const swapGasPrice = await getGasPrice();
    const tx = await primaryWallet.sendTransaction({
      to: PULSEX_ROUTER, value: swapQuote.plsWei, data, gasLimit: 400000n, type: 0, gasPrice: swapGasPrice
    });
    setStatus(st, 'Waiting for confirmation…', 'info');
    await tx.wait();
    const tok    = TOKENS[swapToken];
    const plsFmt = (Number(swapQuote.plsWei) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 2 });
    const outFmt = (Number(swapQuote.amountOutMin) / 10 ** tok.decimals).toLocaleString(undefined, { maximumFractionDigits: 4 });
    setStatus(st, `✓ Swapped ${plsFmt} PLS → ≥${outFmt} ${tok.label}. Now go to Shield to deposit.`, 'ok', tx.hash);
    // Reset UI
    document.getElementById('swap-pls-input').value        = '';
    document.getElementById('swap-confirm').style.display  = 'none';
    document.getElementById('swap-quote-box').style.display = 'none';
    document.getElementById('swap-btn').style.display      = '';
    document.getElementById('swap-btn').disabled           = true;
    document.getElementById('swap-btn').textContent        = 'Enter amount';
    document.getElementById('swap-pls-input').disabled     = false;
    document.getElementById('swap-token-grid').style.pointerEvents = '';
    swapQuote = null;
    refreshHeader();
  } catch(e) {
    setStatus(st, 'Swap failed: ' + e.message, 'bad');
    btn.disabled = false;
  }
}

// ══════════════════════════════════════════════════════════════════════
// CAMERA (QR scan)
// ══════════════════════════════════════════════════════════════════════
let camStream = null;
let camContext = 'pay';
let scanInterval = null;

async function openCamera(context) {
  camContext = context;
  clearInterval(scanInterval);
  scanInterval = null;

  const wrap  = document.getElementById('cam-wrap');
  const video = document.getElementById('cam-video');
  const hint  = document.getElementById('cam-hint');
  const title = document.getElementById('cam-title');
  wrap.classList.add('show');
  if (context === 'receive') {
    if (title) title.textContent = 'Scan Cash Note';
    if (hint)  hint.textContent  = 'Point at the QR code on a printed PrivX Pay note';
  } else {
    if (title) title.textContent = 'Scan to Pay';
    if (hint)  hint.textContent  = 'Point at a wallet address or PrivX Pay QR code';
  }

  try {
    // Try back camera first using 'ideal' (never hard-fails), fall back to any camera
    try {
      camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
      });
    } catch {
      camStream = await navigator.mediaDevices.getUserMedia({ video: true });
    }
    video.srcObject = camStream;
    video.play().catch(() => {}); // play() rejects are harmless — autoplay attr handles it
    startScan(video);
  } catch(e) {
    const msg = e.name === 'NotAllowedError'
      ? 'Camera permission denied — allow camera access in your browser settings.'
      : 'Camera unavailable: ' + e.message;
    if (title) title.textContent = 'Camera Error';
    if (hint)  hint.textContent  = msg;
    camStream = null;
    setTimeout(closeCamera, 3500);
  }
}

function startScan(video) {
  const canvas = document.getElementById('cam-canvas');
  const ctx    = canvas.getContext('2d');
  scanInterval = setInterval(() => {
    if (!video.videoWidth || !video.videoHeight) return;
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const img  = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(img.data, img.width, img.height);
    if (code?.data) {
      const val = code.data.trim();
      if (val.startsWith('privxpay:')) {
        closeCamera();
        handleRedeemNote(val, camContext);
        return;
      }
      if (camContext === 'pay') {
        let addr = val, amount = null;
        if (val.includes('?amount=')) {
          const [a, q] = val.split('?amount=');
          addr = a;
          const parsed = parseInt(q, 10);
          if (!isNaN(parsed) && parsed > 0) amount = parsed;
        }
        if (addr.startsWith('0x') && addr.length === 42) {
          document.getElementById('pay-addr').value = addr;
          if (amount) document.getElementById('pay-amount').value = amount;
          closeCamera();
        }
      }
    }
  }, 250);
}

function closeCamera() {
  clearInterval(scanInterval);
  scanInterval = null;
  camStream?.getTracks().forEach(t => t.stop());
  camStream = null;
  document.getElementById('cam-wrap').classList.remove('show');
}

// ══════════════════════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════════════════════
function setStatus(el, msg, type, txHash = null) {
  if (!el) return;
  el.className  = 'status' + (type ? ' ' + type : '') + (msg ? ' show' : '');
  el.textContent = msg;
  if (txHash) {
    const a = document.createElement('a');
    a.href = 'https://scan.pulsechain.com/tx/' + txHash;
    a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.style.cssText = 'color:var(--accent);display:block;margin-top:5px;font-size:12px;text-decoration:none;font-weight:700';
    a.textContent = '↗ View on PulseChain Scan';
    el.appendChild(a);
  }
}

async function preflightPls(minWei) {
  const bal = await provider.getBalance(primaryWallet.address);
  if (bal < minWei) {
    const have = (Number(bal) / 1e18).toLocaleString(undefined, {maximumFractionDigits:2});
    const need = (Number(minWei) / 1e18).toLocaleString(undefined, {maximumFractionDigits:0});
    throw new Error(`Low PLS: have ${have}, need ~${need} PLS. Send PLS to your wallet first.`);
  }
}

function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }

async function loadQRLibs() { /* no-op: bundled via script tags */ }

// ══════════════════════════════════════════════════════════════════════
// PRIVACY SETUP WALKTHROUGH
// ══════════════════════════════════════════════════════════════════════
const WT_STEPS = [
  {
    num: 1,
    title: 'Receive PLS for gas',
    body: 'Go to the <strong>Receive tab</strong> and copy your wallet address. Send PLS from your clean, previously-shielded fresh wallet — not from an exchange. You need ~120 PLS per bill you plan to create (100 for the bill wallet, ~20 for the relay proxy), plus a few PLS for shielding gas.',
    go: { label: 'Open Receive tab', action: () => switchTab('receive') },
    autoCheck: async () => {
      if (!primaryWallet) return false;
      const bal = await provider.getBalance(primaryWallet.address);
      return bal > 0n;
    },
    checkLabel: 'Check PLS balance'
  },
  {
    num: 2,
    title: 'Get stablecoins to shield',
    body: `You need DAI, pSunDAI, or USDC in your primary wallet to shield. Two ways — both are private since your PLS source is already clean:<br><br>
<strong>Option A — Swap in-app (easiest):</strong> Go to Restock → Swap. Enter a PLS amount, pick your token, review the quote, and confirm. No MetaMask, no external connections — the swap signs directly with your embedded key.<br><br>
<strong>Option B — Send from your clean source wallet:</strong> If the fresh Hurricane withdrawal wallet you funded from already holds stablecoins, send them directly to your PrivX Pay address.`,
    go: { label: 'Open Swap tab', action: () => { switchTab('restock'); setRestockTab('swap'); } },
    autoCheck: async () => {
      if (!primaryWallet) return false;
      for (const tok of Object.values(TOKENS)) {
        const r = await ethCall(tok.addr, '0x70a08231', primaryWallet.address.slice(2).padStart(64,'0'));
        if (BigInt(r) > 0n) return true;
      }
      return false;
    },
    checkLabel: 'Check stablecoin balance'
  },
  {
    num: 3,
    title: 'Shield your stablecoins',
    body: 'Go to <strong>Restock → Shield</strong>. Select a token and denomination ($1–$100). Tap Deposit. The app approves and deposits into the PrivX privacy pool — you get a ZK note. Back it up when it appears. Repeat for each denomination you want.',
    go: { label: 'Open Shield tab', action: () => { switchTab('restock'); setRestockTab('shield'); } },
    autoCheck: async () => notes.filter(n => !n.withdrawn).length > 0,
    checkLabel: 'Check for notes'
  },
  {
    num: 4,
    title: 'Wait — let the pool fill',
    body: 'More deposits from other users enter the pool over time, growing your anonymity set. <strong>Wait at least a few hours before creating bills.</strong> The longer you wait, the harder it is to link your deposit to your withdrawal. Come back later.',
    go: null,
    autoCheck: null,
    checkLabel: null
  },
  {
    num: 5,
    title: 'Create bills (ZK proof)',
    body: 'Go to <strong>Restock → Create Bills</strong>. Select a note and tap Create Bill. The app generates a PLONK ZK proof (2–5 min on mobile — keep screen on), then asks how to relay the withdrawal: <strong>Auto-Relay</strong> (fast, proxy wallet submits it) or <strong>Export Proof</strong> (download JSON for an independent relayer — max privacy). Repeat per denomination.',
    go: { label: 'Open Create Bills tab', action: () => { switchTab('restock'); setRestockTab('bills'); } },
    autoCheck: async () => bills.filter(b => !b.spent && b.gasReady).length > 0,
    checkLabel: 'Check for ready bills'
  },
  {
    num: 6,
    title: "You're set — pay privately!",
    body: null,
    go: { label: 'Go to Pay tab', action: () => switchTab('pay') },
    autoCheck: null,
    checkLabel: null
  }
];

let wtDone = new Set(JSON.parse(localStorage.getItem('privxpay_wt_v1') || '[]'));

function saveWt() {
  localStorage.setItem('privxpay_wt_v1', JSON.stringify([...wtDone]));
}

function wtAdvance(idx) {
  wtDone.add(idx);
  saveWt();
  renderWalkthrough();
}

function resetWalkthrough() {
  wtDone = new Set();
  saveWt();
  renderWalkthrough();
}

function renderWalkthrough() {
  const container = document.getElementById('wt-steps');
  if (!container) return;

  const total     = WT_STEPS.length - 1;
  const doneCount = Math.min([...wtDone].filter(i => i < total).length, total);
  const pct       = Math.round(doneCount / total * 100);
  document.getElementById('wt-bar').style.width = pct + '%';

  const allDone = doneCount >= total;
  container.innerHTML = '';

  if (allDone) {
    const card = document.createElement('div');
    card.className = 'wt-complete';
    card.innerHTML = `
      <div class="wt-complete-icon">🔒</div>
      <div class="wt-complete-title">Privacy setup complete</div>
      <div class="wt-complete-sub">Your bills are fully private — no on-chain link between your identity and your spending. Restock more bills anytime from Restock → Shield.</div>
    `;
    const goBtn = document.createElement('button');
    goBtn.className = 'wt-go';
    goBtn.textContent = 'Go to Pay tab →';
    goBtn.onclick = () => switchTab('pay');
    card.appendChild(goBtn);
    container.appendChild(card);
    return;
  }

  WT_STEPS.slice(0, total).forEach((step, i) => {
    const done   = wtDone.has(i);
    const active = !done && (i === 0 || wtDone.has(i - 1));
    const state  = done ? 'done' : active ? 'active' : 'pending';

    const div = document.createElement('div');
    div.className = `wt-step ${state}`;

    const hdr = document.createElement('div');
    hdr.className = 'wt-step-hdr';

    const dot = document.createElement('div');
    dot.className = `wt-dot ${state}`;
    dot.textContent = done ? '✓' : String(step.num);

    const title = document.createElement('div');
    title.className = 'wt-step-title';
    title.style.color = done ? 'var(--success)' : active ? 'var(--accent)' : 'var(--dim)';
    title.textContent = step.title;

    hdr.appendChild(dot);
    hdr.appendChild(title);
    div.appendChild(hdr);

    if (active) {
      const body = document.createElement('div');
      body.className = 'wt-body';
      body.innerHTML = step.body;
      div.appendChild(body);

      const btns = document.createElement('div');
      btns.className = 'wt-btns';

      if (step.go) {
        const goBtn = document.createElement('button');
        goBtn.className = 'wt-go';
        goBtn.textContent = step.go.label + ' →';
        goBtn.onclick = step.go.action;
        btns.appendChild(goBtn);
      }

      if (step.autoCheck && step.checkLabel) {
        const chkBtn = document.createElement('button');
        chkBtn.className = 'wt-check';
        chkBtn.textContent = step.checkLabel;
        chkBtn.onclick = async () => {
          chkBtn.disabled = true;
          chkBtn.textContent = 'Checking…';
          try {
            const ok = await step.autoCheck();
            if (ok) {
              wtAdvance(i);
            } else {
              chkBtn.textContent = 'Not yet — try again';
              chkBtn.style.color = 'var(--err)';
              chkBtn.style.borderColor = 'rgba(255,100,100,0.4)';
              setTimeout(() => {
                if (chkBtn.isConnected) {
                  chkBtn.disabled = false;
                  chkBtn.textContent = step.checkLabel;
                  chkBtn.style.color = '';
                  chkBtn.style.borderColor = '';
                }
              }, 2500);
            }
          } catch {
            chkBtn.disabled = false;
            chkBtn.textContent = step.checkLabel;
          }
        };
        btns.appendChild(chkBtn);
      }

      const markBtn = document.createElement('button');
      markBtn.className = 'wt-mark';
      markBtn.textContent = step.autoCheck ? 'Mark done manually' : "I've done this ✓";
      markBtn.onclick = () => wtAdvance(i);
      btns.appendChild(markBtn);

      div.appendChild(btns);
    }

    container.appendChild(div);
  });
}

// ══════════════════════════════════════════════════════════════════════
// BEARER NOTE REDEEM — scan a printed PrivX Pay cash note
// ══════════════════════════════════════════════════════════════════════
let _pendingNote = null;

function handleRedeemNote(data, context) {
  // data = "privxpay:{privateKey}:{token}:{denom}"
  const inner = data.slice('privxpay:'.length);
  const parts  = inner.split(':');
  if (parts.length < 3) return;
  const [privKey, tokenKey, denom] = parts;
  const tok = TOKENS[tokenKey];

  if (!primaryWallet) {
    alert('Unlock your wallet first to redeem a note.');
    return;
  }
  if (!tok || !DENOM_META_CHECK(denom)) {
    alert('Unrecognised note format — make sure you are scanning a PrivX Pay cash note.');
    return;
  }

  _pendingNote = { privKey, tokenKey, denom, tok, context: context || 'pay' };

  if (context === 'receive') {
    // Stay on Receive tab — execute immediately, show result inline
    const st = document.getElementById('receive-note-status');
    setStatus(st, `${denom} ${tok.label} note detected — redeeming…`, 'info');
    executeRedeemNote();
    return;
  }

  // Pay tab flow — show confirmation panel
  const destShort = primaryWallet.address.slice(0, 8) + '…' + primaryWallet.address.slice(-6);
  document.getElementById('nr-amount').textContent = `${denom} ${tok.label}`;
  document.getElementById('nr-dest').textContent   = destShort;
  document.getElementById('nr-status').className   = 'status';
  document.getElementById('nr-status').textContent = '';
  const btn = document.getElementById('nr-btn');
  if (btn) btn.disabled = false;

  document.getElementById('pay-input').style.display        = 'none';
  document.getElementById('pay-confirm').style.display      = 'none';
  document.getElementById('pay-done').style.display         = 'none';
  document.getElementById('pay-note-redeem').style.display  = '';
}

function DENOM_META_CHECK(d) { return ['1','5','10','20','50','100'].includes(String(d)); }

async function executeRedeemNote() {
  if (!_pendingNote || !primaryWallet) return;
  const { privKey, tok, context } = _pendingNote;
  const fromReceive = context === 'receive';
  const btn = fromReceive ? null : document.getElementById('nr-btn');
  const st  = fromReceive
    ? document.getElementById('receive-note-status')
    : document.getElementById('nr-status');
  if (btn) btn.disabled = true;
  setStatus(st, 'Checking balance…', 'info');
  try {
    const billWallet = new ethers.Wallet(privKey, provider);
    const balance = await balanceOf(tok.addr, billWallet.address);
    if (balance === 0n) {
      setStatus(st, 'This note has no balance — it may already have been redeemed.', 'bad');
      if (btn) btn.disabled = false;
      return;
    }

    // Ensure bill wallet has enough PLS to pay gas — top up from primary if not
    const gasPrice  = await getGasPrice();
    const gasNeeded = gasPrice * 120000n; // 100k ERC20 transfer limit + 20% headroom
    const plsBal    = await provider.getBalance(billWallet.address);
    if (plsBal < gasNeeded) {
      setStatus(st, 'Funding gas…', 'info');
      await sendPls(primaryWallet, billWallet.address, gasNeeded - plsBal + 10n**16n);
    }

    setStatus(st, 'Transferring…', 'info');
    const receipt = await sendTransfer(billWallet, tok.addr, primaryWallet.address, balance, gasPrice);
    const fmt = tok.decimals === 6
      ? (Number(balance) / 1e6).toFixed(2)
      : (Number(balance / 10n**16n) / 100).toFixed(2);

    // Auto-sweep any PRIVX mining reward sitting in the bill wallet
    let privxNote = '';
    try {
      const privxBal = await balanceOf(PRIVX_TOKEN, billWallet.address);
      if (privxBal > 0n) {
        const gp3    = await getGasPrice();
        const gnP    = gp3 * 120000n;
        const plsNow = await provider.getBalance(billWallet.address);
        if (plsNow < gnP) await sendPls(primaryWallet, billWallet.address, gnP - plsNow + 10n**16n);
        await sendTransfer(billWallet, PRIVX_TOKEN, primaryWallet.address, privxBal, gp3);
        const pFmt = (Number(privxBal) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 4 });
        privxNote = ` + ${pFmt} PRIVX`;
      }
    } catch {}

    setStatus(st, `✓ ${fmt} ${tok.label}${privxNote} received to your wallet.`, 'ok', receipt?.hash);
    _pendingNote = null;

    // Mark the bill as spent if it exists in this wallet's bill list
    const matchedBill = bills.find(b => b.privateKey?.toLowerCase() === privKey.toLowerCase());
    if (matchedBill) {
      matchedBill.spent = true;
      saveBills();
    }

    refreshHeader();
  } catch (e) {
    setStatus(st, 'Error: ' + e.message, 'bad');
    if (btn) btn.disabled = false;
  }
}

// ══════════════════════════════════════════════════════════════════════
// FEE VAULT — Convert accumulated fees to PRIVX POL + vault + burn
// ══════════════════════════════════════════════════════════════════════
const FEE_VAULT = '0x54818356b47b5F7b52DceAbf2B6eF52Cf8b072Fd';

function _fvIface() {
  return new ethers.Interface([
    'function accumulated(address) view returns (uint256)',
    'function quoteConvert(address) view returns (uint256)',
    'function convert(address,uint256,uint256,uint256,uint256)',
    'function splitConfig() view returns (uint256 pol, uint256 vault, uint256 burn)',
    'function totalPrivxBurned() view returns (uint256)',
    'function totalPrivxToVault() view returns (uint256)',
    'function polLpBalance() view returns (uint256)',
    'function wpls() view returns (address)',
    'function router() view returns (address)',
  ]);
}

async function _fvCall(iface, fn, args = []) {
  const data = iface.encodeFunctionData(fn, args);
  const raw  = await rpc('eth_call', [{ to: FEE_VAULT, data }, 'latest']);
  return iface.decodeFunctionResult(fn, raw);
}

async function _routerQuote(routerAddr, amountIn, path) {
  if (amountIn === 0n) return 0n;
  const iface = new ethers.Interface(['function getAmountsOut(uint256,address[]) view returns (uint256[])']);
  const data  = iface.encodeFunctionData('getAmountsOut', [amountIn, path]);
  const raw   = await rpc('eth_call', [{ to: routerAddr, data }, 'latest']);
  const [amounts] = iface.decodeFunctionResult('getAmountsOut', raw);
  return BigInt(amounts[amounts.length - 1]);
}

async function loadFeeVaultStats() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const iface = _fvIface();
  try {
    const [burnedR, vaultR, lpR] = await Promise.all([
      _fvCall(iface, 'totalPrivxBurned'),
      _fvCall(iface, 'totalPrivxToVault'),
      _fvCall(iface, 'polLpBalance'),
    ]);
    const fmt18 = v => Number(BigInt(v) / 10n**15n) / 1000;
    set('fv-burned', fmt18(burnedR[0]).toLocaleString() + ' PRIVX');
    set('fv-vault',  fmt18(vaultR[0]).toLocaleString()  + ' PRIVX');
    set('fv-lp',     fmt18(lpR[0]).toLocaleString()     + ' LP');

    for (const [key, tok] of Object.entries(TOKENS)) {
      const [acc] = await _fvCall(iface, 'accumulated', [tok.addr]);
      const fmtAcc = tok.decimals === 6
        ? (Number(acc) / 1e6).toFixed(2)
        : (Number(BigInt(acc) / 10n**15n) / 1000).toLocaleString(undefined, { maximumFractionDigits: 4 });
      set('fv-acc-' + key, fmtAcc + ' ' + tok.label);
    }
  } catch (e) {
    ['fv-burned','fv-vault','fv-lp','fv-acc-dai','fv-acc-psundai','fv-acc-usdc'].forEach(id => set(id, '—'));
    console.warn('loadFeeVaultStats:', e.message);
  }
}

async function triggerFeeConvert() {
  if (!primaryWallet) return alert('Unlock wallet first.');
  const tokenKey = document.getElementById('fv-token-sel')?.value;
  const tok = TOKENS[tokenKey];
  if (!tok) return;
  const slippageBP = parseInt(document.getElementById('fv-slippage')?.value || '200', 10);
  const btnEl = document.getElementById('fv-convert-btn');
  const stEl  = document.getElementById('fv-status');
  if (isNaN(slippageBP) || slippageBP < 1 || slippageBP > 800)
    return setStatus(stEl, 'Slippage must be 1–800 bp.', 'bad');
  if (btnEl) btnEl.disabled = true;
  setStatus(stEl, 'Fetching on-chain quotes…', 'info');
  try {
    const iface = _fvIface();
    const BP = 10000n;
    const applySlip = n => n * BigInt(10000 - slippageBP) / BP;

    const [splitsR, wplsR, routerR] = await Promise.all([
      _fvCall(iface, 'splitConfig'),
      _fvCall(iface, 'wpls'),
      _fvCall(iface, 'router'),
    ]);
    const polBP   = BigInt(splitsR.pol   ?? splitsR[0]);
    const vaultBP = BigInt(splitsR.vault ?? splitsR[1]);
    const wplsAddr   = wplsR[0];
    const routerAddr = routerR[0];
    const privxAddr  = PRIVX_TOKEN;

    const [wplsExpR] = await _fvCall(iface, 'quoteConvert', [tok.addr]);
    const wplsExpected = BigInt(wplsExpR);
    if (wplsExpected === 0n) throw new Error('No liquidity or no fees accumulated for this token.');
    const minWplsOut = applySlip(wplsExpected);

    const polW   = wplsExpected * polBP   / BP;
    const vaultW = wplsExpected * vaultBP / BP;
    const burnW  = wplsExpected - polW - vaultW;

    const [minPolLp, minVault, minBurn] = await Promise.all([
      _routerQuote(routerAddr, polW / 2n, [wplsAddr, privxAddr]).then(applySlip),
      _routerQuote(routerAddr, vaultW,    [wplsAddr, privxAddr]).then(applySlip),
      _routerQuote(routerAddr, burnW,     [wplsAddr, privxAddr]).then(applySlip),
    ]);

    setStatus(stEl, 'Sending transaction…', 'info');
    const gasPrice = await getGasPrice();
    const txData = iface.encodeFunctionData('convert', [tok.addr, minWplsOut, minPolLp, minVault, minBurn]);
    const tx = await primaryWallet.sendTransaction({ to: FEE_VAULT, data: txData, gasLimit: 800000n, type: 0, gasPrice });
    setStatus(stEl, 'Waiting for confirmation…', 'info');
    const receipt = await tx.wait();
    setStatus(stEl, '✓ Fees converted — PRIVX burned & liquidity deepened.', 'ok', receipt?.hash);
    loadFeeVaultStats();
  } catch (e) {
    setStatus(stEl, 'Error: ' + e.message, 'bad');
  } finally {
    if (btnEl) btnEl.disabled = false;
  }
}

// ══════════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════════
async function init() {
  // Hide onboarding immediately — splash covers the screen while we determine state.
  // We only re-add 'active' if this is confirmed to be a fresh install.
  document.getElementById('screen-onboard').classList.remove('active');

  // Safety net: hide splash after 25s if the finally block never runs
  const splashTimer = setTimeout(() => {
    const s = document.getElementById('loading-splash');
    if (s) s.style.display = 'none';
    // If scripts still haven't loaded after 25s, show appropriate screen
    const hasVault = !!localStorage.getItem('privxpay_enc_seed');
    if (hasVault) {
      showLockScreen('Enter PIN to unlock');
    } else {
      document.getElementById('screen-onboard').classList.add('active');
    }
  }, 25000);

  try {
    // Wait for deferred scripts — IPFS gateways can be slow delivering ethers.umd.min.js.
    // Without this guard, initProvider() crashes on hard refresh and the catch block
    // falls back to showing onboarding, causing the lock/onboard bounce on next reload.
    const splashMsg = document.getElementById('splash-msg');
    let waited = 0;
    while (typeof ethers === 'undefined' && waited < 20000) {
      if (waited === 2000 && splashMsg) splashMsg.innerHTML = 'LOADING…<br><span style="font-size:10px;opacity:.6">downloading scripts — stay on WiFi</span>';
      await new Promise(r => setTimeout(r, 300));
      waited += 300;
    }
    if (typeof ethers === 'undefined') throw new Error('Scripts failed to load — check connection and reload.');

    // Show iOS in-browser warning as early as possible
    const _isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const _isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    if (_isIOS && !_isStandalone) {
      const _hsBanner = document.getElementById('hs-banner');
      if (_hsBanner) _hsBanner.style.display = 'block';
    }

    initProvider();

    const hasEncSeed   = !!localStorage.getItem('privxpay_enc_seed');
    const hasPlainSeed = !!localStorage.getItem('privxpay_seed_v1');

    if (hasEncSeed) {
      // PIN-protected vault — show lock screen only (onboarding already hidden above)
      pinMode = 'unlock';
      showLockScreen('Enter PIN to unlock');
    } else if (hasPlainSeed) {
      // Legacy unencrypted install — migrate to PIN vault
      vaultSeed = localStorage.getItem('privxpay_seed_v1');
      bills     = LS.get('privxpay_bills_v1') || [];
      notes     = LS.get('privxpay_notes_v1') || [];
      txHistory = LS.get('privxpay_history_v1') || [];
      const mnemonic = ethers.Mnemonic.fromPhrase(vaultSeed);
      const hd       = ethers.HDNodeWallet.fromMnemonic(mnemonic, HD_PATH);
      primaryWallet  = new ethers.Wallet(hd.privateKey, provider);
      showPinSetup('Secure your wallet — create a 6-digit PIN');
    } else {
      // Fresh install — explicitly show onboarding
      document.getElementById('screen-onboard').classList.add('active');
    }

  } catch (e) {
    console.error('PrivX Pay init error:', e);
    // Never show onboarding to someone who has a vault — they'd think their data is gone
    const hasVault = !!localStorage.getItem('privxpay_enc_seed');
    if (hasVault) {
      showLockScreen('Enter PIN to unlock');
    } else {
      document.getElementById('screen-onboard').classList.add('active');
    }
    const banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;bottom:24px;left:16px;right:16px;background:rgba(255,80,80,.12);border:1px solid rgba(255,80,80,.3);border-radius:12px;padding:14px 16px;font-size:13px;color:#ff9999;z-index:9998;line-height:1.6';
    banner.textContent = 'Load error: ' + e.message + ' — pull to refresh or reopen the app.';
    document.body.appendChild(banner);
  } finally {
    clearTimeout(splashTimer);
    const splash = document.getElementById('loading-splash');
    if (splash) splash.style.display = 'none';
  }
}

init();
