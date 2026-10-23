/*
 * OWNS      which API endpoints anything calls: the legacy ranking (--json · --called) and the wide run (--buckets · --md).
 * CALLED BY tests/round-trips-all.test.cjs (--json) · the web's tools/graph (--json) · docs/PERFORMANCE-TOOLS.md · by hand
 * FLOW      client registry + server routes -> legacy counts | endpoint-usage-run (callers -> buckets -> test evidence) -> endpoint-usage-md -> page
 * CARD      janitor/endpoint-usage
 */
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

/* ⭐ KG1 (2026-10-12): CB_API_DIR / CB_WEB_DIR let another checkout (the web's tools/graph fixture) point this scanner at
   its files — the same env names scripts/vendor-till.cjs uses. Unset, it reads the two repos side by side as before. */
const API = process.env.CB_API_DIR ? path.resolve(process.env.CB_API_DIR) : path.join(__dirname, '..');
const WEB = process.env.CB_WEB_DIR ? path.join(path.resolve(process.env.CB_WEB_DIR), 'public') : path.join(API, '..', 'chitbridge-web', 'public');

/* ── 1 · the client's endpoint registry: key -> method + path ───────────────────────────────────────────── */
const reg = {};
let clientText = '';
try {
  const files = [
    path.join(WEB, 'app.html'),
    path.join(WEB, 'shop.html'),
    ...fs
      .readdirSync(path.join(WEB, 'app'))
      .filter((item) => item.endsWith('.js'))
      .map((item) => path.join(WEB, 'app', item))
  ];
  clientText = files
    .filter((item) => fs.existsSync(item))
    .map((item) => fs.readFileSync(item, 'utf8'))
    .join('\n');
  for (const m of clientText.matchAll(/(\w+):\s*\{\s*m:\s*["'](\w+)["']\s*,\s*p:\s*["']([^"']+)["']/g)) {
    reg[m[1]] = { method: m[2], path: m[3] };
  }
} catch (e) {
  console.error('  could not read the web client: ' + e.message);
}

/* ── 2 · how many places call each key ──────────────────────────────────────────────────────────────────── */
const callsOf = (key) => {
  /* ⚠️ THE REGISTRY ENTRY ITSELF IS NOT A CALL. `defGet: {m:"GET", …}` mentions the name; only api('defGet')
     invokes it. Counting the declaration would have made every dead endpoint look used exactly once. */
  /* ⚠️ INT6b (14 Oct): T2-PAGING's testEvery(ep, key) calls api(ep) with the key in a variable (every page of a list the test board
     sums). Its first argument is a call too, or GET /api/testing/cases + /results read as "no longer called" and their budget lines fail. */
  let n = 0;
  for (const re of [new RegExp("(?:api|testEvery)\\(\\s*'" + key + "'", 'g'), new RegExp('(?:api|testEvery)\\(\\s*"' + key + '"', 'g')]) {
    n += (clientText.match(re) || []).length;
  }
  return n;
};

/* ── 3 · the server's routes ────────────────────────────────────────────────────────────────────────────── */
/* ⚠️ THE MOUNT LINE HAS MORE SHAPES THAN THE OBVIOUS ONE — inline require, or a router VARIABLE (actors, entities, governance…). Both are
   read by tools/server-mounts.cjs (EFF-TRIPS: one helper for this scanner and the round-trip harness; the old regex here knew only the first
   shape and reported its own blindness as "not called by the client" / "no mount in server.js"). */
let mounts = {};
try {
  mounts = require('./server-mounts.cjs').serverMounts(fs.readFileSync(path.join(API, 'server.js'), 'utf8'));
} catch (_) {
  /* no server.js — paths degrade to the route file's own path */
}

/* ⭐ 2026-10-23: the route list is tools/endpoint-usage-report.cjs serverRows (it adds the line and what a route declares about outside callers);
   the legacy rows below are its routes/ files exactly as before, so --json and the round-trip harness read the same 605. */
const { serverRows } = require('./endpoint-usage-report.cjs');
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
const norm = (text) =>
  text
    .split('?')[0]
    .replace(/\/$/, '')
    .replace(/:[A-Za-z_]+/g, ':p');
const rowsFor = (mountMap) =>
  serverRows(API, mountMap).map((item) => {
    const keys = Object.keys(reg).filter((name) => reg[name].method === item.method && norm(reg[name].path) === norm(item.full));
    const calls = keys.reduce((total, name) => total + callsOf(name), 0);
    return Object.assign(item, { route: item.method + ' ' + item.full, keys, calls });
  });
const everyRow = rowsFor(mounts);
const rows = everyRow
  .filter((item) => item.file.startsWith('routes/') && !item.helper)
  .map((item) => Object.assign({}, item, { file: path.basename(item.file) }));

const called = rows.filter((item) => item.calls > 0);

/* ⭐ --json: the called routes as data, for tests/round-trips-all.test.cjs (DB10) — one scan, not a second copy of it.
   KG1 (2026-10-12) widened it ADDITIVELY: `registry` (the client's key → method + path) and `routes` (every server row with
   the keys that name it) are what the web's tools/graph/graph.cjs joins screens to routes with — the same scan, spawned. */
/* ⭐ 2026-10-23 --buckets / --md: the WIDE run (tools/endpoint-usage-run.cjs). It reads every caller of the three repos, not only the
   web client's registry, puts each route in a bucket (A live · B internal · C external · D no caller found) and answers, for A/B/C,
   whether it is tested and verified. Read-only. --graph FILE is the web's tools/graph/out/graph.json (screens); --cycle FILE is the
   reviewer-cycle page; --out FILE writes the markdown there instead of stdout; --history adds dead-or-planned for bucket D (git, slow). */
const argOf = (flag) => (process.argv.indexOf(flag) >= 0 ? process.argv[process.argv.indexOf(flag) + 1] : '');
if (process.argv.indexOf('--buckets') >= 0 || process.argv.indexOf('--md') >= 0) {
  const webRoot = process.env.CB_WEB_DIR ? path.resolve(process.env.CB_WEB_DIR) : path.join(API, '..', 'chitbridge-web');
  const engRoot = process.env.CB_ENGINES_DIR ? path.resolve(process.env.CB_ENGINES_DIR) : path.join(API, '..', 'chitbridge-engines');
  /* ⚠️ the wide run reads server.js WITHOUT its comment lines: server.js:438 keeps a commented-out mount of src/routes/catalogue under /api/network, and server-mounts.cjs
     (shared with the round-trip harness, whose budget would then fail on 7 catalogue routes it has no line for) reads it as live. Reported, not changed here. */
  const liveText = fs.readFileSync(path.join(API, 'server.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  const allMounts = require('./server-mounts.cjs').serverMountsAll(liveText);
  const wide = require('./endpoint-usage-run.cjs').runWide({
    API,
    WEB_ROOT: webRoot,
    ENGINES_ROOT: engRoot,
    rows: rowsFor(allMounts),
    registryKeys: Object.keys(reg),
    graph: argOf('--graph'),
    cycle: argOf('--cycle')
  });
  require('./endpoint-usage-md.cjs').emit(wide, {
    json: process.argv.indexOf('--buckets') >= 0,
    out: argOf('--out'),
    history: process.argv.indexOf('--history') >= 0,
    webRoot
  });
} else if (process.argv.indexOf('--json') >= 0) {
  /* ⚠️ process.exit() straight after a write to a PIPE truncates at 64 KB (the pipe buffer; the rest is queued and lost) —
     the widened output crossed that line on 2026-10-12 and the first reader got "Unterminated string in JSON". Exit from
     the write's callback, after the bytes are out. */
  process.stdout.write(
    JSON.stringify({
      called: called.map((item) => ({ file: item.file, route: item.route, calls: item.calls })),
      mounts,
      registry: reg,
      routes: rows.map((item) => ({ file: item.file, route: item.route, keys: item.keys, calls: item.calls }))
    }),
    () => process.exit(0)
  );
} else {
  const known = rows.filter((item) => item.keys.length && item.calls === 0);
  const unknown = rows.filter((item) => !item.keys.length);

  console.log('\n  ' + rows.length + ' server endpoints  ·  ' + Object.keys(reg).length + ' registry entries in the client\n');
  console.log('    ' + String(called.length).padStart(3) + '  called by the web client');
  console.log('    ' + String(known.length).padStart(3) + '  IN the registry but never invoked — declared, then abandoned');
  console.log('    ' + String(unknown.length).padStart(3) + '  not in the registry at all (storefront, services, direct callers)\n');

  console.log('  DECLARED AND NEVER INVOKED — the registry entry exists, no api() call does:\n');
  known.slice(0, 25).forEach((item) => console.log('      ' + item.route.padEnd(46) + item.keys.join(', ')));
  if (known.length > 25) console.log('      … and ' + (known.length - 25) + ' more');

  if (process.argv.indexOf('--called') >= 0) {
    console.log('\n  CALLED, most-used first:\n');
    called
      .sort((first, second) => second.calls - first.calls)
      .forEach((item) => console.log('      ' + String(item.calls).padStart(3) + '  ' + item.route.padEnd(46) + item.keys.join(', ')));
  }
  console.log('\n  (--called lists the live ones by call count)\n');
}
