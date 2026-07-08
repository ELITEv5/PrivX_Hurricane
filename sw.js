const CACHE = 'privx-v5';

const STATIC = [
  './index.html',
  './relayer.html',
  './privx-relayer.html',
  './privx-pay.html',
  './privx-pay-wallet.html',
  './privx-notes.html',
  './manifest.json',
  './privx-pay-manifest.json',
  './privx-pay-wallet-manifest.json',
  './privx_logo.png',
  './privx-shield.png',
  './favicon-16x16.png',
  './favicon-32x32.png',
  './favicon.png',
  './PrivXMixer14.wasm',
  './web3.min.js',
  './snarkjs.min.js',
  './circomlibjs.js',
  './jsQR.js',
  './qrcode.min.js'
];

// Install: cache all static assets on first visit
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(STATIC))
      .then(() => self.skipWaiting())
  );
});

// Activate: remove old caches from previous versions
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Fetch: cache-first for all static assets, network-first for RPC/blockchain calls
self.addEventListener('fetch', e => {
  const req = e.request;

  // Cache-first for local static assets
  if (STATIC.some(s => req.url.endsWith(s.replace('./', '')))) {
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => {
      if (res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()));
      return res;
    })));
    return;
  }

  // Cache zkey from any IPFS gateway after first download (fallback path)
  if (req.url.includes('bafybei')) {
    e.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(req).then(cached => {
          if (cached) return cached;
          return fetch(req).then(res => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          });
        })
      )
    );
    return;
  }

  // Network-first for everything else (RPC calls, PulseChain, etc.)
  e.respondWith(fetch(req).catch(() => caches.match(req)));
});
