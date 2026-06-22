const CACHE = 'privxpay-v1';
const ASSETS = [
  './privx-pay-wallet.html',
  './privx-pay-wallet-manifest.json',
  './privx-shield.png',
  './favicon.png',
  './favicon-32x32.png',
  './favicon-16x16.png',
  'https://cdn.jsdelivr.net/npm/qrcode@1.4.4/build/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.allSettled(ASSETS.map(url => c.add(url).catch(() => {})))
    )
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Don't intercept RPC calls — always need fresh chain data
  if (url.hostname === 'rpc.pulsechain.com' || url.hostname === 'esm.sh') return;
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
