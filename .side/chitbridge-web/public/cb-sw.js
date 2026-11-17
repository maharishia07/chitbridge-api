// cb-sw.js — Chit & Bridge service worker (offline Phase 3). Makes the app OPEN with no connection and serve the last-seen
// app shell. Strategy = NETWORK-FIRST with cache fallback: when online you ALWAYS get fresh content (safe for a fast-
// deploying app — no stale-code trap); the cache only answers when the network fails. Mutations (non-GET) are never touched
// here — they are the outbox's job (cb-offline.js). Bump CB_SW_VERSION to invalidate all caches on the next load.
//
// SCOPE = SAME-ORIGIN app shell/static + fonts ONLY. The cross-origin API (Railway) is deliberately NOT intercepted: a
// service worker on Firefox/Safari REJECTS a re-fetch of a cross-origin request, so intercepting it handed back a bogus 503
// for LIVE data (a just-created chit wouldn't appear). The page's own fetch works on every engine, so we stay out of its
// way. (Offline API read-cache is dropped for now — it only ever worked on Chromium; re-add later via a SAME-ORIGIN API
// proxy the SW can actually cache, and restore the logout cache-clear hook then.)
/*
 * OWNS      the offline app-shell service worker: network-first with cache fallback, same-origin only
 * CALLED BY CBOffline.registerSW('/cb-sw.js') at public/app.html:30369 and public/shop.html:576; the default path in public/cb-offline.js:516
 * FLOW      install -> network-first fetch -> cache answers only when the network fails; non-GET never touched
 * CARD      28-platform-and-operations/offline
 */
const CB_SW_VERSION = 'v5';
const SHELL = 'cb-shell-' + CB_SW_VERSION; // same-origin app shell + static JS
const EXT = 'cb-ext-' + CB_SW_VERSION; // cross-origin static (fonts)
const KEEP = [SHELL, EXT];

// app shell + all lazily-injected cap modules (they are NOT <script> tags, so precache them explicitly)
const PRECACHE = [
  '/app.html',
  '/app/core.js',
  '/app/helpers.js',
  '/app/cap-admin.js',
  '/app/cap-dispute.js',
  '/app/cap-connector.js',
  '/app/cap-workforce.js',
  '/app/cap-folders.js',
  '/app/cap-readiness.js',
  '/app/cap-legend.js',
  '/cb-offline.js',
  '/authority-forms.html',
  '/know-your-business.html',
  '/intake.html',
  '/shop.html',
  '/embed.html'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(SHELL).then((reply) =>
      // best-effort: a missing/renamed asset must NOT fail the whole install
      Promise.all(PRECACHE.map((item) => reply.add(item).catch(() => null)))
    )
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((item) => item.startsWith('cb-') && !KEEP.includes(item)).map((item) => caches.delete(item))))
      .then(() => self.clients.claim())
  );
});

// SAME-ORIGIN network-first: fresh when online, cached shell when the network fails; a navigation falls back to app.html.
function networkFirst(req) {
  return fetch(req)
    .then((res) => {
      if (res && (res.ok || res.type === 'opaqueredirect')) {
        const cp = res.clone();
        caches
          .open(SHELL)
          .then((reply) => reply.put(req, cp))
          .catch(() => {});
      }
      return res;
    })
    .catch(() =>
      caches.match(req).then((reply) => {
        if (reply) return reply;
        if (req.mode === 'navigate') return caches.match('/app.html'); // last-resort shell so a navigation still opens
        return Response.error();
      })
    );
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // mutations pass straight through (outbox owns them)
  let url;
  try {
    url = new URL(req.url);
  } catch (_) {
    return;
  }
  // SAME-ORIGIN app shell / static → network-first so the app OPENS offline (safe: bump CB_SW_VERSION avoids a stale-code trap)
  if (url.origin === self.location.origin) {
    e.respondWith(networkFirst(req));
    return;
  }
  // CROSS-ORIGIN fonts → cache-first (avoid repeat external calls)
  if (/(^|\.)(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(
      caches.match(req).then(
        (reply) =>
          reply ||
          fetch(req)
            .then((res) => {
              const cp = res.clone();
              caches
                .open(EXT)
                .then((response) => response.put(req, cp))
                .catch(() => {});
              return res;
            })
            .catch(() => reply || Response.error())
      )
    );
  }
  // CROSS-ORIGIN API (Railway) and anything else → NOT intercepted (see header note); the browser fetches it natively.
});
