const CACHE = 'privxpay-v85';
const ASSETS = ['./', './index.html', './app.js', './notes.html', './snarkjs.min.js', './circomlibjs.js', './ethers.umd.min.js', './PrivXMixer14.wasm', './qrcode.min.js', './jsqr.js', './icon.png', './icon-192.png', './apple-touch-icon.png', './privx_logo.png', './privx-shield.png', './favicon.png', './favicon-32x32.png', './manifest.json', './web3.min.js'];
// PrivXMixer14_final.zkey (53 MB) is intentionally excluded from precache —
// it is fetched on first proof use and stored in IndexedDB by app.js.

// Cache each asset individually — one slow/missing file on IPFS won't block the entire SW install.
self.addEventListener('install', e => e.waitUntil(
  caches.open(CACHE)
    .then(c => Promise.allSettled(ASSETS.map(url => c.add(url).catch(() => {}))))
    .then(() => self.skipWaiting())
));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  // Only handle GET requests
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then(r => {
    if (r) return r;
    return fetch(e.request).then(res => {
      // Cache successful fetches for assets that missed precache
      if (res && res.status === 200 && res.type !== 'opaque') {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {});
      }
      return res;
    });
    // No catch-all fallback — let script/asset failures surface naturally
  }));
});
