/**
 * tools/endpoint-usage.cjs — which API endpoints anything actually calls.
 *
 * Athi, 2026-08-21, mid-sweep: *"is definitions used internally? Is it having a role in the systems?"*
 *
 * ⚠️⚠️ HE ASKED BECAUSE I WAS OPTIMISING BY COST RANK, NOT BY USAGE — and he was right to. I had just
 * collapsed two transactions in `GET /definitions/:id` and it turned out **nothing calls that endpoint**. The
 * change is correct and harmless and bought exactly nothing. A ranked list of round trips says how expensive a
 * call is; it says nothing about whether anyone makes it.
 *
 * ⭐ SO COST × USAGE, NOT COST. Multiply the round-trip rank by "does a caller exist" and the work sorts
 * itself: expensive AND called is where the time goes, expensive AND uncalled is dead surface to delete rather
 * than tune.
 *
 * ⚠️ "NOT CALLED BY THE WEB CLIENT" IS NOT "DEAD". Three real callers this cannot see: the storefront
 * (`shop.html`), other services, and anything a person or a script hits directly. It ranks; a human deletes.
 *
 * Read-only.
 */
const fs = require('fs');
const path = require('path');

const API = path.join(__dirname, '..');
const WEB = path.join(API, '..', 'chitbridge-web', 'public');

/* ── 1 · the client's endpoint registry: key -> method + path ───────────────────────────────────────────── */
const reg = {};
let clientText = '';
try {
  const files = [path.join(WEB, 'app.html'), path.join(WEB, 'shop.html'),
    ...fs.readdirSync(path.join(WEB, 'app')).filter((f) => f.endsWith('.js')).map((f) => path.join(WEB, 'app', f))];
  clientText = files.filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  for (const m of clientText.matchAll(/(\w+):\s*\{\s*m:\s*["'](\w+)["']\s*,\s*p:\s*["']([^"']+)["']/g)) {
    reg[m[1]] = { method: m[2], path: m[3] };
  }
} catch (e) { console.error('  could not read the web client: ' + e.message); }

/* ── 2 · how many places call each key ──────────────────────────────────────────────────────────────────── */
const callsOf = (key) => {
  /* ⚠️ THE REGISTRY ENTRY ITSELF IS NOT A CALL. `defGet: {m:"GET", …}` mentions the name; only api('defGet')
     invokes it. Counting the declaration would have made every dead endpoint look used exactly once. */
  let n = 0;
  for (const re of [new RegExp("api\\(\\s*'" + key + "'", 'g'), new RegExp('api\\(\\s*"' + key + '"', 'g')]) {
    n += (clientText.match(re) || []).length;
  }
  return n;
};

/* ── 3 · the server's routes ────────────────────────────────────────────────────────────────────────────── */
const mounts = {};
try {
  const app = fs.readFileSync(path.join(API, 'server.js'), 'utf8');
  /**
   * ⚠️ THE MOUNT LINE HAS MORE SHAPES THAN THE OBVIOUS ONE. A pattern demanding
   * `require('./routes/<lowercase>')` found 14 of 24 route files: it missed `./src/routes/network`, and it
   * missed any mount carrying middleware between the path and the require. Every route file it fails to place
   * gets an empty base path, so none of its endpoints can ever match a registry entry — the tool then reports
   * its own blindness as "not called by the client".
   */
  for (const m of app.matchAll(/app\.use\(\s*['"]([^'"]+)['"][\s\S]{0,120}?require\(['"][^'"]*routes\/([A-Za-z0-9_-]+)['"]\)/g)) {
    if (!mounts[m[2] + '.js']) mounts[m[2] + '.js'] = m[1];
  }
} catch (_) { /* no server.js — paths degrade to the route file's own path */ }

const rows = [];
for (const f of fs.readdirSync(path.join(API, 'routes')).filter((x) => x.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(API, 'routes', f), 'utf8');
  const base = mounts[f] || '';
  for (const d of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]*)\2/g)) {
    const full = (base + d[3]).replace(/\/$/, '') || base;
    /* a registry entry whose path matches, ignoring the query string it may carry */
    /**
     * ⚠️⚠️ PARAM NAMES ARE NOT PART OF THE PATH, and comparing them literally made this tool useless. The
     * client registers `/api/chits/:id`; the server declares `router.get('/:chit_id')` mounted at `/api/chits`.
     * Same endpoint, different word, so 222 of 264 routes came back "not in the registry at all" — which reads
     * as an enormous amount of dead API surface and is nothing but a string mismatch.
     *
     * ⭐ Third tool this session that needed its MATCHING fixed before its OUTPUT could be trusted. The finding
     * is always the same shape: a scan that under-matches reports its own blindness as a fact about the code.
     */
    const norm = (p) => p.split('?')[0].replace(/\/$/, '').replace(/:[A-Za-z_]+/g, ':p');
    const keys = Object.keys(reg).filter((k) => reg[k].method === d[1].toUpperCase()
      && norm(reg[k].path) === norm(full));
    const calls = keys.reduce((s, k) => s + callsOf(k), 0);
    rows.push({ file: f, route: d[1].toUpperCase() + ' ' + full, keys, calls });
  }
}

const called = rows.filter((r) => r.calls > 0);
const known = rows.filter((r) => r.keys.length && r.calls === 0);
const unknown = rows.filter((r) => !r.keys.length);

console.log('\n  ' + rows.length + ' server endpoints  ·  ' + Object.keys(reg).length + ' registry entries in the client\n');
console.log('    ' + String(called.length).padStart(3) + '  called by the web client');
console.log('    ' + String(known.length).padStart(3) + '  IN the registry but never invoked — declared, then abandoned');
console.log('    ' + String(unknown.length).padStart(3) + '  not in the registry at all (storefront, services, direct callers)\n');

console.log('  DECLARED AND NEVER INVOKED — the registry entry exists, no api() call does:\n');
known.slice(0, 25).forEach((r) => console.log('      ' + r.route.padEnd(46) + r.keys.join(', ')));
if (known.length > 25) console.log('      … and ' + (known.length - 25) + ' more');

if (process.argv.indexOf('--called') >= 0) {
  console.log('\n  CALLED, most-used first:\n');
  called.sort((a, b) => b.calls - a.calls).forEach((r) =>
    console.log('      ' + String(r.calls).padStart(3) + '  ' + r.route.padEnd(46) + r.keys.join(', ')));
}
console.log('\n  (--called lists the live ones by call count)\n');
