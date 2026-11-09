// Service Worker(手書き・ビルド不要)。全パスは相対(GitHub Pages のサブパス配信で壊れないように)。
// アプリを更新して公開するたび、毎回 CACHE_NAME の数字を上げる(上げないと古い画面が出続ける)。
const CACHE_NAME = 'tsuzuki-v5';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './styles.css',
  './src/main.js',
  './src/api.js',
  './src/util.js',
  './src/store.js',
  './src/player.js',
  './src/views.js',
  './src/reco.js',
  './icons/icon-192.png',
  './icons/icon-180.png',
  './icons/favicon-32.png',
].map((p) => new URL(p, self.registration.scope).toString());
const INDEX_URL = new URL('./index.html', self.registration.scope).toString();

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(APP_SHELL.map((u) => cache.add(new Request(u, { cache: 'reload' })).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tsuzuki-') && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // データのやりとり・YouTube・サムネイルは、いつも通信に任せる
  if (url.origin !== self.location.origin) return;
  // 同じ github.io にあるほかのアプリには手を出さない
  if (!req.url.startsWith(self.registration.scope)) return;

  // アプリ本体: 通信できるときはいつも新しいものを取り(新旧のファイルが混ざらないように)、
  // 通信できないときや遅いときだけ手元の控えを出す
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const net = fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    });
    event.waitUntil(net.catch(() => {}));
    const timeout = new Promise((r) => setTimeout(r, 4000));
    try {
      const res = await Promise.race([net, timeout]);
      if (res) return res;
    } catch (_) { /* 通信できない */ }
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const idx = await cache.match(INDEX_URL);
      if (idx) return idx;
    }
    return net;
  })());
});
