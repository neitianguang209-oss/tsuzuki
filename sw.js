// Service Worker(手書き・ビルド不要)。全パスは相対(GitHub Pages のサブパス配信で壊れないように)。
// アプリを更新して公開するたび、毎回 CACHE_NAME の数字を上げる(上げないと古い画面が出続ける)。
const CACHE_NAME = 'tsuzuki-v1';
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

  // アプリ本体: まず手元の控えを出し、裏で新しいものに入れ替えておく
  event.respondWith(
    caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then((cached) => {
      const fresh = fetch(req).then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return res;
      }).catch(() => cached || (req.mode === 'navigate' ? caches.match(INDEX_URL) : undefined));
      return cached || fresh;
    })
  );
});
