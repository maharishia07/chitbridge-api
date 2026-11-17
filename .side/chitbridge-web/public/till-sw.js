/* GENERATED — DO NOT EDIT. Written by chitbridge-api/scripts/vendor-till.cjs. Edit the master and re-run. */
// @stage tested
// @stage-note a byte-for-byte copy of the master, which is the thing the tests cover (scripts/vendor-till.cjs).
const SHELF = 'cb-till-v7';
const KEEP = ['/till.html', '/promo.html', '/config.js', '/app/signin-ui.js', '/app/their-bill.js', '/app/tax-slab-ui.js', '/engine/offers.js', '/engine/tax.js', '/engine/search.js', '/engine/gs1.js', '/engine/lots.js', '/engine/nums.js', '/engine/pricing.js', '/engine/locale.js', '/engine/rewards.js', '/engine/qr.js', '/engine/money.js', '/engine/docnumber.js', '/engine/screen.js', '/engine/variant.js', '/engine/units.js', '/engine/profilemap.js', '/engine/jurisdiction.js', '/engine/govcontext.js', '/engine/rollup.js', '/engine/verdict.js', '/engine/orders.js', '/engine/orderhub.js', '/engine/dayopen.js', '/engine/signin.js', '/engine/scalecode.js', '/engine/qty.js', '/engine/versions.json', '/till.webmanifest', '/till-icon.svg'];
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
