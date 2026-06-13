window._buildPoseidon = window.circomlibjs?.buildPoseidon ?? null;

// ══════════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════════
const RPC          = 'https://rpc.pulsechain.com';
const CHAIN_ID     = 369;
const TREE_LEVELS  = 14;
const ZERO         = 0n;
const WASM_URL     = './PrivXMixer14.wasm';
const ZKEY_CID     = 'bafybeiahcycu5sbkgdxfxt4py3qagjrce2nxrbxenwv7oxkg67xoy4qwmu';
const ZKEY_URLS    = [
  './PrivXMixer14_final.zkey',                                                    // bundled — works offline, no gateway dependency
  `https://amaranth-rear-platypus-218.mypinata.cloud/ipfs/${ZKEY_CID}`,
  `https://gateway.pinata.cloud/ipfs/${ZKEY_CID}`,
  `https://ipfs.io/ipfs/${ZKEY_CID}`,
  `https://${ZKEY_CID}.ipfs.dweb.link`
];
const BILL_GAS_PLS      = 1000000000000000000000n; // 1000 PLS — covers gas up to ~10M gwei
const PROXY_OVERHEAD_PLS = 20000000000000000000n;   // 20 PLS for proxy wallet's own tx gas costs
const DEPOSIT_TOPIC = '0xa945e51eec50ab98c161376f0db4cf2aeba3ec92755fe2fcd388bdbbb80ff196';
const PRIVX_TOKEN   = '0x34310B5d3a8d1e5f8e4A40dcf38E48d90170E986';

const TOKENS = {
  dai: {
    label:'DAI', addr:'0xefD766cCb38EaF1dfd701853BFCe31359239F305', decimals:18, feeBP:50,
    shields:{'1':'0xdDdf0fe3A1A85eA5A913347FF8069a04390e4C31','5':'0x1D57f03d48A2E5d9cE97d73F2f7710c313ee8577','10':'0xFe63926D5535EA3B6e1EA204bdDf93F4E2a4b906','20':'0xE0fA07E91a4A1005C63f9414Fe11B9E84C9C599B','50':'0x7cfe4718be7991fCA3979Fb0008Bd26e51D01980','100':'0xDA6e061F10deE54DDcF8B3d054F2fdDC5848Ee79'},
    denomWei:{'1':1000000000000000000n,'5':5000000000000000000n,'10':10000000000000000000n,'20':20000000000000000000n,'50':50000000000000000000n,'100':100000000000000000000n}
  },
  psundai: {
    label:'pSunDAI', addr:'0x1c2a9d0d6c641F92284EeCF8aC62D1e39D703E4f', decimals:18, feeBP:50,
    shields:{'1':'0x35187f9aa04297A17Ce123B99e19573fCa389b86','5':'0x163b7E39E9019245dF6648b7B9DE99eDe328705F','10':'0x6b17dD5c9DCde755AF4f1797e626B23A7Ec33CD4','20':'0xc8aCD0E405939CF7c29F3e16037098F186d83B1A','50':'0xbEb3eb96F3379D664f314aeEf1D401D630bE8eA4','100':'0x1720103Ac2f5E8d50Cb52bf3f55A2da973E7959D'},
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
function b64enc(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
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
  provider = new ethers.JsonRpcProvider(RPC, { chainId: CHAIN_ID, name: 'pulsechain' });
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
  grid.innerHTML = words.map((w,i) =>
    `<div class="seed-word"><span class="seed-num">${i+1}</span><span class="seed-w">${w}</span></div>`
  ).join('');

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
    localStorage.setItem('privxpay_seed_v1', phrase); // temp, will be encrypted
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
  grid.innerHTML = words.map((w,i) =>
    `<div class="seed-word"><span class="seed-num">${i+1}</span><span class="seed-w">${w}</span></div>`
  ).join('');
  localStorage.setItem('privxpay_seed_v1', phrase);
  document.getElementById('ob-seed').style.display = '';
}

function toggleCheck(boxId, btnId) {
  const box = document.getElementById(boxId);
  const btn = document.getElementById(btnId);
  box.classList.toggle('on');
  btn.disabled = !box.classList.contains('on');
}

async function finishOnboard() {
  vaultSeed = localStorage.getItem('privxpay_seed_v1');
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
}

// ── PIN lock functions ────────────────────────────────────────────────
function lockApp() {
  clearTimeout(lockTimer);
  cryptoKey     = null;
  primaryWallet = null;
  vaultSeed     = null;
  showLockScreen('Enter PIN to unlock');
}

async function unlockWithPin(pin) {
  const dot = document.getElementById('pin-status');
  try {
    const seed = await openVault(pin);
    const mnemonic = ethers.Mnemonic.fromPhrase(seed);
    const hd       = ethers.HDNodeWallet.fromMnemonic(mnemonic, HD_PATH);
    primaryWallet  = new ethers.Wallet(hd.privateKey, provider);
    await loadStorageEnc();
    hideLockScreen();
    enterApp();
  } catch {
    pinBuffer = [];
    renderPinDots();
    if (dot) { dot.textContent = 'Wrong PIN — try again'; setTimeout(()=>{ if(dot) dot.textContent=''; },1800); }
  }
}

function showLockScreen(subtitle = 'Enter PIN to unlock') {
  document.getElementById('lock-subtitle').textContent = subtitle;
  document.getElementById('screen-lock').style.display = 'flex';
  pinBuffer = [];
  renderPinDots();
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
  const r = await (await fetch(RPC, { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ jsonrpc:'2.0', id:1, method, params }) })).json();
  if (r.error) throw new Error(r.error.message);
  return r.result;
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
async function sendApprove(wallet, token, spender, amount) {
  const tx = await wallet.sendTransaction({ to:token, data:'0x095ea7b3'+addrArg(spender)+u256Arg(amount), gasLimit:100000n });
  return tx.wait();
}
async function sendTransfer(wallet, token, to, amount) {
  const tx = await wallet.sendTransaction({ to:token, data:'0xa9059cbb'+addrArg(to)+u256Arg(amount), gasLimit:100000n });
  return tx.wait();
}
async function sendPls(wallet, to, amount) {
  const tx = await wallet.sendTransaction({ to, value:amount, gasLimit:21000n });
  return tx.wait();
}

// ══════════════════════════════════════════════════════════════════════
// SHIELD / ZK
// ══════════════════════════════════════════════════════════════════════
async function initPoseidon() {
  if (poseidonFn) return;
  if (!window._buildPoseidon) throw new Error('circomlibjs not loaded — page may be loading, try again');
  const lib = await window._buildPoseidon();
  poseidonFn = (...inputs) => lib.F.toObject(lib(inputs.map(x => BigInt(x))));
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

const IDB_ZKEY_KEY = 'privxpay_zkey_v1';

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

async function getZkeyUrl(onStatus) {
  if (zkeyBlobUrl) return zkeyBlobUrl;
  const cached = await idbGet(IDB_ZKEY_KEY);
  if (cached) {
    onStatus('Loading proving key from cache…');
    zkeyBlobUrl = URL.createObjectURL(cached);
    return zkeyBlobUrl;
  }
  for (let i=0; i<ZKEY_URLS.length; i++) {
    try {
      onStatus(`Downloading proving key ${i>0?'(trying next source)':''}… (32 MB, WiFi recommended)`);
      const resp = await fetch(ZKEY_URLS[i]);
      if (!resp.ok) throw new Error('HTTP '+resp.status);
      const blob = await resp.blob();
      zkeyBlobUrl = URL.createObjectURL(blob);
      onStatus('Saving proving key to cache…');
      await idbSet(IDB_ZKEY_KEY, blob);
      return zkeyBlobUrl;
    } catch(e) { console.warn('zkey source failed:', e.message); }
  }
  throw new Error('Could not download proving key from any IPFS source.');
}

async function generateProof(circuitInput, onStatus) {
  const zkeyUrl = await getZkeyUrl(onStatus);
  onStatus('Generating ZK proof… (2–5 min on mobile, keep screen on)');
  const { proof, publicSignals } = await snarkjs.plonk.fullProve(circuitInput, WASM_URL, zkeyUrl);
  const calldata = await snarkjs.plonk.exportSolidityCallData(proof, publicSignals);
  const argv = calldata.replace(/\]\s*\[/g,',').replace(/["[\]\s]/g,'').split(',').filter(Boolean);
  return argv;
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
  const empty = document.getElementById('wallet-empty');
  const list  = document.getElementById('wallet-bills');
  if (!unspent.length) { empty.style.display=''; list.innerHTML=''; renderHistory(); return; }
  empty.style.display = 'none';
  list.innerHTML = unspent.map(b => {
    const age = Math.floor((Date.now()-b.createdAt)/86400000);
    const tok = TOKENS[b.token];
    const sid = 'bdetail-' + b.id;
    const badge = b.relayPending
      ? '<span class="badge" style="background:rgba(255,170,0,.12);color:#cc9900;border:1px solid rgba(255,170,0,.3)">relay pending</span>'
      : (!b.gasReady ? '<span class="badge">funding gas…</span>' : '');

    const pendingBlock = b.relayPending ? `
      <div style="background:rgba(255,170,0,0.06);border:1px solid rgba(255,170,0,0.2);border-radius:8px;padding:10px 12px;font-size:12px;color:#aa8800;margin-bottom:10px;line-height:1.65">
        ⏳ <strong style="color:#cc9900">Relay pending</strong> — open the <a href="./relayer.html" target="_blank" rel="noopener noreferrer" style="color:var(--accent);text-decoration:none;font-weight:700">Hurricane Proof Relayer ↗</a> and load your downloaded proof JSON. Once a relayer submits it, tap Check Relay, then Fund Gas.
      </div>
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <button class="btn btn-outline" style="flex:1;font-size:12px;padding:8px" onclick="event.stopPropagation();checkRelayStatus('${b.id}')">Check Relay</button>
        ${!b.gasReady?`<button class="btn btn-outline" style="flex:1;font-size:12px;padding:8px" onclick="event.stopPropagation();refuelBill('${b.id}')">Fund Gas (1000 PLS)</button>`:`<div style="flex:1;font-size:12px;padding:8px;text-align:center;color:var(--success)">✓ Gas ready</div>`}
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
      <div id="refuel-status-${b.id}" class="status" style="margin-top:8px"></div>
    </div>`;
  }).join('');
  renderHistory();
}

function clearSpentBills() {
  const n = bills.filter(b => b.spent).length;
  if (!n) return;
  bills = bills.filter(b => !b.spent);
  saveBills();
  renderWallet();
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

async function refuelBill(id) {
  const bill = bills.find(b => b.id === id);
  if (!bill || !primaryWallet) return;
  const btn = document.getElementById('refuel-btn-' + id);
  const st  = document.getElementById('refuel-status-' + id);
  btn.disabled = true;
  setStatus(st, 'Sending PLS…', 'info');
  try {
    const receipt = await sendPls(primaryWallet, bill.address, BILL_GAS_PLS);
    if (!bill.gasReady) { bill.gasReady = true; saveBills(); }
    setStatus(st, '✓ 1000 PLS sent — bill is ready to spend.', 'ok', receipt?.transactionHash || receipt?.hash);
    renderNotes();
  } catch(e) {
    setStatus(st, 'Error: ' + e.message, 'bad');
    btn.disabled = false;
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
  document.getElementById('pay-input').style.display   = '';
  document.getElementById('pay-confirm').style.display = 'none';
  document.getElementById('pay-done').style.display    = 'none';
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
  const btn = document.getElementById('sweep-btn');
  const st  = document.getElementById('sweep-status');
  btn.disabled = true;
  setStatus(st, 'Sweeping PRIVX…', 'info');

  let swept = 0n;
  let sweepTxHash = null;
  const errors = [];
  for (const item of _sweepItems) {
    try {
      // Need PLS in bill wallet for gas — send a small top-up from primary if needed
      const plsBal = await provider.getBalance(item.wallet.address);
      const gasNeeded = 60000n * 2000000000n; // 60k gas × 2 gwei
      if (plsBal < gasNeeded) {
        await sendPls(primaryWallet, item.wallet.address, gasNeeded - plsBal);
      }
      const receipt = await sendTransfer(item.wallet, PRIVX_TOKEN, primaryWallet.address, item.privxWei);
      sweepTxHash = receipt?.transactionHash || receipt?.hash || null;
      swept += item.privxWei;
    } catch (e) {
      errors.push(e.message);
    }
  }

  const fmt = v => (Number(v) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 4 });
  if (swept > 0n) {
    setStatus(st, `✓ ${fmt(swept)} PRIVX swept to your primary wallet.`, 'ok', sweepTxHash);
    btn.style.display = 'none';
  }
  if (errors.length) {
    setStatus(st, (swept > 0n ? st.textContent + '\n' : '') + 'Some failed: ' + errors.join('; '), 'warn');
    btn.disabled = false;
  }
  _sweepItems = [];
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
    QRCode.toCanvas(document.getElementById('qr-canvas-receive'), addr,
      { width:220, margin:2, color:{dark:'#000',light:'#fff'} }, ()=>{});
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
  receiveRendered = false; // force re-render
  QRCode.toCanvas(document.getElementById('qr-canvas-receive'), qrData,
    { width:220, margin:2, color:{dark:'#000',light:'#fff'} }, ()=>{});
  receiveRendered = true;
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
    div.innerHTML = `<div class="nc-top"><span class="nc-denom">$${n.denom} ${tok ? tok.label : n.token}</span><span class="nc-date">${new Date(n.ts).toLocaleDateString()}</span></div>`;
    div.onclick = () => { selectedNote = selectedNote === n.noteStr ? null : n.noteStr; renderNotes(); };
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
  // Preflight for full auto-relay cost: 1000 PLS bill + 20 PLS proxy overhead
  await preflightPls(BILL_GAS_PLS + PROXY_OVERHEAD_PLS + 5000000000000000000n);

  // Ephemeral proxy calls the shield — primary wallet never appears in the withdrawal tx
  const proxyWallet = ethers.Wallet.createRandom().connect(provider);

  setStatus(st, 'Funding relay proxy…', 'info');
  await sendPls(primaryWallet, proxyWallet.address, BILL_GAS_PLS + PROXY_OVERHEAD_PLS);

  setStatus(st, 'Submitting withdrawal via proxy…', 'info');
  const pad = v => BigInt(v).toString(16).padStart(64,'0');
  const withdrawData = '0x8172d2d0'
    + argv.slice(0,24).map(pad).join('')
    + argv.slice(24,28).map(pad).join('')
    + addrArg(billWallet.address);
  const wTx = await proxyWallet.sendTransaction({ to:parsed.shieldAddr, data:withdrawData, gasLimit:1000000n });
  await wTx.wait();
  bar.style.width = '85%';

  noteObj.withdrawn = true; saveNotes();
  const bill = {
    id: 'bill_'+Date.now()+'_'+Math.random().toString(36).slice(2),
    address: billWallet.address, privateKey: billWallet.privateKey,
    denomination: parsed.denom, token: parsed.token,
    createdAt: Date.now(), gasReady: false, spent: false
  };
  bills.push(bill); saveBills();

  try {
    setStatus(st, 'Funding bill wallet with gas…', 'info');
    await sendPls(proxyWallet, billWallet.address, BILL_GAS_PLS);
    bill.gasReady = true; saveBills();
  } catch(e) { console.warn('Gas funding failed:', e.message); }

  bar.style.width = '100%';
  barL.textContent = 'Done';
  setStatus(st, `✓ $${parsed.denom} ${TOKENS[parsed.token].label} bill ready to spend.`, 'ok', wTx.hash);
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
  setStatus(st, '✓ Proof downloaded. Load it into the relayer, then check status on your bill.', 'ok');
  const relayerLink = document.createElement('a');
  relayerLink.href = './relayer.html';
  relayerLink.target = '_blank';
  relayerLink.rel = 'noopener noreferrer';
  relayerLink.style.cssText = 'color:var(--accent);display:block;margin-top:6px;font-size:12px;text-decoration:none;font-weight:700';
  relayerLink.textContent = '↗ Open Hurricane Proof Relayer';
  st.appendChild(relayerLink);
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
    if (BigInt(result) === 1n) {
      bill.relayPending = false; saveBills();
      setStatus(st, '✓ Relay confirmed — withdrawal complete!', 'ok');
      renderWallet();
    } else {
      setStatus(st, 'Not yet relayed — nullifier still unspent. Try again after the relayer submits.', 'warn');
    }
  } catch(e) {
    setStatus(st, 'Error: ' + e.message, 'bad');
  }
}

// ── SHIELD ────────────────────────────────────────────────────────────
function renderShieldUI() {
  const tg = document.getElementById('token-grid');
  tg.innerHTML = Object.entries(TOKENS).map(([k,t]) =>
    `<div class="chip${k===selectedToken?' active':''}" onclick="selectToken('${k}')">
      <div class="cval">${t.label}</div></div>`
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
    const tx = await primaryWallet.sendTransaction({
      to: shieldAddr,
      data: '0xb214faa5'+gen.commitmentHex.slice(2),
      gasLimit: 2000000n  // Merkle tree update (14-level Poseidon) needs ~1–1.5M gas
    });
    await tx.wait();

    document.getElementById('note-reveal-text').textContent = gen.noteStr;
    document.getElementById('note-reveal').style.display = '';
    setStatus(st, `✓ $${selectedDenom} ${tok.label} shielded! Back up your note below, then go to Create Bills.`, 'ok', tx.hash);
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
    const tx = await primaryWallet.sendTransaction({
      to: PULSEX_ROUTER, value: swapQuote.plsWei, data, gasLimit: 400000n
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
  const wrap  = document.getElementById('cam-wrap');
  const video = document.getElementById('cam-video');
  wrap.classList.add('show');
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:'environment' } });
    video.srcObject = camStream;
    await video.play();
    startScan(video);
  } catch(e) {
    alert('Camera error: '+e.message);
    closeCamera();
  }
}

function startScan(video) {
  const canvas = document.getElementById('cam-canvas');
  const ctx    = canvas.getContext('2d');
  scanInterval = setInterval(() => {
    if (!video.videoWidth) return;
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const img  = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(img.data, img.width, img.height);
    if (code?.data) {
      const val = code.data.trim();
      if (camContext === 'pay') {
        // Handle both plain address and address?amount=X
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
  }, 200);
}

function closeCamera() {
  clearInterval(scanInterval);
  camStream?.getTracks().forEach(t=>t.stop());
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
    body: 'Go to the <strong>Receive tab</strong> and copy your wallet address. Send PLS from your clean, previously-shielded fresh wallet — not from an exchange. You need ~1,020 PLS per bill you plan to create (1,000 for the bill wallet, 20 for the relay proxy), plus a few PLS for shielding gas.',
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
// INIT
// ══════════════════════════════════════════════════════════════════════
async function init() {
  // Hard timeout — splash hides after 12s regardless, so users aren't stuck forever
  const splashTimer = setTimeout(() => {
    const s = document.getElementById('loading-splash');
    if (s) s.style.display = 'none';
  }, 12000);

  try {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    // Show iOS in-browser warning as early as possible — before onboarding or unlock
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
      // PIN-protected install — show lock screen
      pinMode = 'unlock';
      showLockScreen('Enter PIN to unlock');
    } else if (hasPlainSeed) {
      // Old unencrypted install — load wallet then prompt PIN migration
      vaultSeed = localStorage.getItem('privxpay_seed_v1');
      bills     = LS.get('privxpay_bills_v1') || [];
      notes     = LS.get('privxpay_notes_v1') || [];
      txHistory = LS.get('privxpay_history_v1') || [];
      const mnemonic = ethers.Mnemonic.fromPhrase(vaultSeed);
      const hd       = ethers.HDNodeWallet.fromMnemonic(mnemonic, HD_PATH);
      primaryWallet  = new ethers.Wallet(hd.privateKey, provider);
      document.getElementById('screen-onboard').classList.remove('active');
      showPinSetup('Secure your wallet — create a 6-digit PIN');
    }
    // else: no seed → show onboarding (screen-onboard is active by default)
  } catch (e) {
    console.error('PrivX Pay init error:', e);
    // Show a visible error banner so the user isn't just staring at a spinner
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
