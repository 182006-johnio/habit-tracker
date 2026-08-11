// Service Worker。オフラインでも起動できるようにする。
//
// ネットワーク優先（タイムアウト付き）でキャッシュに落ちる。キャッシュ優先にすると
// 更新が次回起動まで届かず「古い版に張り付く」事故が起きる。記録を扱うアプリで、
// 直したバグが届かないのは実害が大きい。全体で数十 KB しかないので、毎回取りに
// 行っても通信量は問題にならない。
//
// 更新するときは CACHE の名前を変える。古いキャッシュは activate で消える。

const CACHE = 'habit-tracker-v4';
const NETWORK_TIMEOUT = 3000;

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/dates.js',
  './js/schema.js',
  './js/stats.js',
  './js/storage.js',
  './js/weeks.js',
  './js/export.js',
  './js/ui/backup.js',
  './js/ui/confirm.js',
  './js/ui/grid.js',
  './js/ui/home.js',
  './js/ui/marks.js',
  './js/ui/record.js',
  './js/ui/swipe.js',
  './js/ui/week.js',
  './favicon.ico',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // 書き込み系と外部への通信には触れない（このアプリに外部通信は無いが念のため）。
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);

  try {
    const response = await withTimeout(fetch(request), NETWORK_TIMEOUT);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    // 電波が悪いだけの場合もここに来る。キャッシュがあればそれを返す。
    // ignoreSearch を付けるのは、?cb=... のようなクエリ付きで開かれても
    // 同じファイルとして拾えるようにするため。
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;

    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    throw new Error('オフラインで、キャッシュにもありません');
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}
