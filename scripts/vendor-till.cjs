/**
 * vendor-till.cjs — ONE COUNTER SCREEN, TWO HOSTS (the till, 2026-09-07).
 *
 * The page is served both by the little program on a shop PC (tools/tally-connector/till.js) and by the web, where a phone or a
 * tablet can open it directly. Two copies of a screen is how two screens drift, so there is ONE master — the kit's till.html — and
 * this script writes the web's copy, its three engine files, its manifest and its service worker.
 *
 * Run:  node scripts/vendor-till.cjs          (write)
 *       node scripts/vendor-till.cjs --check  (exit 1 if any copy is stale — what tests/till-vendor.test.js uses)
 */
'use strict';
const fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
const WEB = path.join(API, '..', 'chitbridge-web', 'public');
const GEN = '/* GENERATED — DO NOT EDIT. Written by chitbridge-api/scripts/vendor-till.cjs. Edit the master and re-run. */\n';

const MANIFEST = JSON.stringify({
  name: 'ChitBridge Counter', short_name: 'Counter', start_url: '/till.html', scope: '/', display: 'standalone',
  background_color: '#fdfbf7', theme_color: '#1c7a4a', orientation: 'any',
  description: 'Bill at the counter — works with the line down, syncs when it returns.',
  icons: [{ src: '/till-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
}, null, 2) + '\n';

/* a shop's counter, drawn rather than photographed: no binary in the repo, and it scales to any launcher size */
const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Counter">
  <rect width="512" height="512" rx="96" fill="#1c7a4a"/>
  <rect x="112" y="128" width="288" height="200" rx="20" fill="#fdfbf7"/>
  <rect x="144" y="160" width="224" height="56" rx="10" fill="#1c7a4a" opacity=".25"/>
  <g fill="#1c7a4a"><circle cx="176" cy="256" r="18"/><circle cx="240" cy="256" r="18"/><circle cx="304" cy="256" r="18"/>
  <circle cx="176" cy="300" r="18"/><circle cx="240" cy="300" r="18"/><circle cx="304" cy="300" r="18"/></g>
  <rect x="352" y="240" width="36" height="78" rx="10" fill="#a8410f"/>
  <rect x="96" y="352" width="320" height="40" rx="14" fill="#fdfbf7"/>
</svg>
`;

/**
 * ⭐ THE SERVICE WORKER IS A CUPBOARD, NOT A CACHE STRATEGY. It keeps the four files the counter needs to open at all — the page, the
 * two engines, the manifest — and serves them when the network is not there. Bills and the shop's own data live in IndexedDB, which is
 * the page's business, not this file's. Nothing else is cached, so nothing else goes stale.
 */
const SW = `${GEN}const SHELF = 'cb-till-v1';
const KEEP = ['/till.html', '/engine/offers.js', '/engine/tax.js', '/engine/search.js', '/till.webmanifest', '/till-icon.svg'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(SHELF).then((c) => c.addAll(KEEP)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELF).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;           /* the API is never cached: a bill must reach it or queue */
  if (!KEEP.includes(url.pathname)) return;
  e.respondWith(
    fetch(e.request).then((r) => { const copy = r.clone(); caches.open(SHELF).then((c) => c.put(e.request, copy)); return r; })
                    .catch(() => caches.match(e.request).then((m) => m || Response.error()))
  );
});
`;

const COPIES = () => [
  [path.join(API, 'tools', 'tally-connector', 'till.html'), path.join(WEB, 'till.html'), 'copy'],
  [path.join(WEB, 'app', 'offers.js'), path.join(WEB, 'engine', 'offers.js'), 'copy'],
  [path.join(WEB, 'app', 'tax-engine.js'), path.join(WEB, 'engine', 'tax.js'), 'copy'],
  /* ⭐ ONE SEARCH FOR BOTH SCREENS (Athi, 2026-09-08: "make it one shared file for both"). The counter and the app's Catalogue have to
     answer "ac co" the same way, so the master lives with the app and is copied here for the web and into the API, which serves the
     till's own cached copy. Two searches would be two definitions of what a shop's words mean. */
  [path.join(WEB, 'app', 'search.js'), path.join(WEB, 'engine', 'search.js'), 'copy'],
  [path.join(WEB, 'app', 'search.js'), path.join(API, 'lib', 'search-engine.js'), 'copy'],
  [null, path.join(WEB, 'till.webmanifest'), MANIFEST],
  [null, path.join(WEB, 'till-sw.js'), SW],
  [null, path.join(WEB, 'till-icon.svg'), ICON],
];

const norm = (s) => s.replace(/\r\n/g, '\n');
const want = (from, body) => (body === 'copy' ? norm(fs.readFileSync(from, 'utf8')) : body);

if (process.argv.includes('--check')) {
  for (const [from, to, body] of COPIES()) {
    const text = want(from, body);
    const have = fs.existsSync(to) ? norm(fs.readFileSync(to, 'utf8')) : '';
    if (have !== text) { console.log('STALE: ' + to + ' — run node scripts/vendor-till.cjs'); process.exit(1); }
  }
  console.log('the counter screen and its files are current'); process.exit(0);
}

for (const [from, to, body] of COPIES()) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, want(from, body));
  console.log('wrote ' + to);
}
