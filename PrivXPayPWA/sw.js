const CACHE = 'privxpay-v15';
const ASSETS = ['./', './index.html', './app.js', './snarkjs.min.js', './circomlibjs.js', './ethers.umd.min.js', './PrivXMixer14.wasm', './qrcode.min.js', './jsqr.js', './icon.png', './privx_logo.png', './privx-shield.png', './favicon.png', './favicon-32x32.png', './manifest.json', './relayer.html', './web3.min.js'];
// PrivXMixer14_final.zkey (53 MB) is intentionally excluded from precache —
// it is fetched on first proof use and stored in IndexedDB by app.js.

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => e.respondWith(caches.match(e.request).then(r => r || fetch(e.request))));
