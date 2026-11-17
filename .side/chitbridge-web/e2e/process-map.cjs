/**
 * e2e/process-map.cjs — THE PROCESS MAP MUST MATCH THE CODE (PM1, 2026-10-12). Offline: no browser, no server, no npm install.
 *
 * docs/process/flows.json names, per flow step, the screen file, the engine function, the API route file and the test file.
 * A moved or renamed function must break the map LOUDLY, by name, or the map rots into the document nobody trusts
 * (e2e/docs-guard.cjs learned this with MODULES.md). So:
 *   1. every `web:` file exists in this repo, and a named function is declared or assigned in it
 *   2. every `api:` / `engines:` file exists in the sibling checkout (C:/dev/chitbridge-api · C:/dev/chitbridge-engines) and
 *      names its function; without the sibling (CI) the row is checked for SHAPE only, said so — the pattern of e2e/cmdb-records.cjs
 *   3. every route's path tail is a literal in its route file ('/payments' in routes/books.js), so a route that moved is named
 *   4. a MISSING step names NO file (a file on a MISSING step is a contradiction) and carries its evidence in `note`
 *   5. docs/process/*.md are what tools/gen-process-docs.cjs writes from the JSON (--check)
 *   6. the guard bites: an invented file is caught
 *   7. a row says what the code DOES (T1-INV, 2026-10-14): a route or function whose meaning is pinned in MEANINGS may not sit on a
 *      step that claims the opposite — POST /api/till/stock is an availability switch, not a goods receipt; a supply purchase
 *      posts nothing, so it may not sit on a step whose ledger posts
 *
 * Run: node e2e/process-map.cjs
 */
'use strict';
const fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REPOS = {
  web: ROOT,
  api: path.join(ROOT, '..', 'chitbridge-api'),
  engines: path.join(ROOT, '..', 'chitbridge-engines'),
};
const MAP = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'process', 'flows.json'), 'utf8'));
const STATUSES = ['ok', 'warn', 'missing'];

let bad = 0, shapeOnly = 0, checked = 0, quiet = false;
const fail = (what) => { bad++; if (!quiet) console.log('  ✗ ' + what); };
const srcCache = new Map();
const readSrc = (abs) => { if (!srcCache.has(abs)) srcCache.set(abs, fs.readFileSync(abs, 'utf8')); return srcCache.get(abs); };

/** "repo:path" → { repo, rel, abs, present: true | false | null (no sibling) } */
function resolveRef(ref) {
  const m = /^(web|api|engines):(.+)$/.exec(String(ref || ''));
  if (!m) return null;
  const root = REPOS[m[1]];
  if (m[1] !== 'web' && !fs.existsSync(root)) return { repo: m[1], rel: m[2], abs: null, present: null };
  const abs = path.join(root, m[2]);
  return { repo: m[1], rel: m[2], abs, present: fs.existsSync(abs) };
}

/** a function is "in" a file when it is DECLARED there: function fn(, const fn =, fn = function, fn: function, fn: (, or a method fn( { — a call is not enough */
function hasFn(src, fn) {
  const F = fn.replace(/[$]/g, '\\$');
  const forms = [
    /\bfunction\s+NAME\s*\(/,                                  // function fn(
    /\b(?:const|let|var)\s+NAME\s*=/,                          // const fn =
    /[{,;\s]NAME\s*:\s*(?:async\s+)?(?:function\b|\()/,        // fn: function  ·  fn: (
    /(?:^|[\s;])NAME\s*=\s*(?:async\s+)?(?:function\b|\()/,    // fn = function  ·  fn = (
    /^\s*(?:async\s+)?NAME\s*\([^)]*\)\s*\{/m,                 // a method:  fn(a, b) {
  ];
  return forms.some((f) => new RegExp(f.source.replace('NAME', F), f.flags).test(src));
}

/** '/api/books/payments/preview' → '/payments/preview'; '/api/people' → '/' — the literal a router file holds */
function routeTail(p) {
  const m = /^\/api\/[^/]+(\/.*)?$/.exec(p);
  return m ? (m[1] || '/') : p;
}

function checkFile(where, ref, fn) {
  const r = resolveRef(ref);
  if (!r) return fail(where + ': "' + ref + '" is not repo:path (web | api | engines)');
  if (r.present === null) { shapeOnly++; return; }
  checked++;
  if (!r.present) return fail(where + ': ' + ref + ' does not exist — moved or renamed? fix flows.json');
  if (fn) {
    if (!hasFn(readSrc(r.abs), fn)) fail(where + ': ' + ref + ' has no function ' + fn + '() — renamed? fix flows.json');
  }
}

function checkRoute(where, r) {
  if (!r || !r.m || !r.p || !r.file) return fail(where + ': a route needs { m, p, file }');
  const f = resolveRef(r.file);
  if (!f) return fail(where + ': route file "' + r.file + '" is not repo:path');
  if (f.present === null) { shapeOnly++; return; }
  checked++;
  if (!f.present) return fail(where + ': ' + r.file + ' does not exist');
  const tail = routeTail(r.p), src = readSrc(f.abs);
  if (src.indexOf("'" + tail + "'") < 0 && src.indexOf('"' + tail + '"') < 0) fail(where + ': ' + r.m + ' ' + r.p + ' — no literal \'' + tail + '\' in ' + r.file + ' (route moved?)');
}

/* ── 7: meanings pinned to the code (T1-INV) — each was once mapped wrong. `not(step)` true = the row contradicts the code ── */
const isReceipt = (s) => /receipt/i.test(String(s.step || ''));
const posts = (s) => !/^\s*none\b/i.test(String(s.ledger || ''));
const MEANINGS = [
  { route: 'POST /api/till/stock', says: 'an availability switch (item status available/unavailable), not a goods receipt', not: isReceipt },
  { route: 'POST /api/till/stock/bulk', says: 'an availability switch for many products, not a goods receipt', not: isReceipt },
  { route: 'POST /api/supplies/purchase', says: 'a record of a supply bought, which posts NOTHING to the books', not: posts },
  { engine: 'api:lib/supply-store.js#purchase', says: 'a record of a supply bought, which posts NOTHING to the books', not: posts },
];
function checkMeaning(where, s) {
  const routes = (s.route || []).map((r) => r.m + ' ' + r.p), engines = (s.engine || []).map((e) => e.file + '#' + e.fn);
  MEANINGS.forEach((m) => {
    const on = m.route ? routes.indexOf(m.route) >= 0 : engines.indexOf(m.engine) >= 0;
    if (on && m.not(s)) fail(where + ': ' + (m.route || m.engine) + ' is ' + m.says + ' — it does not belong on this step');
  });
}

/* ── 1–4: the rows ─────────────────────────────────────────────────────────────────────────────────────────────── */
console.log('');
const seen = new Set();
(MAP.flows || []).forEach((flow) => {
  if (!flow.id || seen.has(flow.id)) fail('a flow has no id, or a duplicate: ' + flow.id);
  seen.add(flow.id);
  (flow.steps || []).forEach((s, i) => {
    const where = flow.id + ' step ' + s.n + ' · ' + s.step;
    if (s.n !== i + 1) fail(where + ': steps must be numbered 1..n in order');
    if (STATUSES.indexOf(s.status) < 0) fail(where + ': status must be one of ' + STATUSES.join('/'));
    if (!MAP.modules.some((m) => m.id === s.module)) fail(where + ': module "' + s.module + '" is not in modules[]');
    if (s.status === 'missing') {
      if ((s.screen || []).length || (s.engine || []).length || (s.route || []).length || (s.test || []).length) fail(where + ': a MISSING step names a file — either it exists (then it is not missing) or the file is invented');
      if (!String(s.note || '').trim()) fail(where + ': a MISSING step must carry its evidence in note');
      return;
    }
    if (s.status === 'warn' && !String(s.note || '').trim()) fail(where + ': a ⚠️ step must say what the gap is in note');
    checkMeaning(where, s);
    (s.screen || []).forEach((f) => checkFile(where + ' screen', f.file, f.fn));
    (s.engine || []).forEach((f) => checkFile(where + ' engine', f.file, f.fn));
    (s.route || []).forEach((r) => checkRoute(where + ' route', r));
    (s.test || []).forEach((t) => checkFile(where + ' test', t, ''));
  });
});
(MAP.modules || []).forEach((m) => checkFile('module ' + m.id + ' page', m.page, ''));

/* ── 5: the pages are the JSON's rendering ─────────────────────────────────────────────────────────────────────── */
try {
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'gen-process-docs.cjs'), '--check'], { stdio: 'pipe' });
  console.log('  ✓ docs/process/*.md match flows.json');
} catch (e) {
  fail('docs/process/*.md have drifted from flows.json — run: node tools/gen-process-docs.cjs');
}

/* ── 6: the guard bites ────────────────────────────────────────────────────────────────────────────────────────── */
quiet = true;
const before = bad;
checkFile('bite', 'web:public/app/cap-invented-by-nobody.js', '');
if (bad === before) { console.log('  ✗ the guard did not catch an invented file'); process.exit(1); }
bad = before;
const fnBefore = bad;
checkFile('bite', 'web:public/app/cap-books.js', 'bkInventedFunctionNobodyWrote');
if (bad === fnBefore) { console.log('  ✗ the guard did not catch an invented function'); process.exit(1); }
bad = fnBefore;
const mBefore = bad;
checkMeaning('bite', { step: 'goods receipt', ledger: 'none', route: [{ m: 'POST', p: '/api/till/stock' }] });
if (bad === mBefore) { console.log('  ✗ the guard did not catch the availability switch mapped as a goods receipt'); process.exit(1); }
bad = mBefore;
checkMeaning('bite', { step: 'supplier bill', ledger: 'purchase_bill · Dr 5000', engine: [{ file: 'api:lib/supply-store.js', fn: 'purchase' }] });
if (bad === mBefore) { console.log('  ✗ the guard did not catch a supply purchase mapped as posting'); process.exit(1); }
bad = mBefore;
quiet = false;
console.log('  ✓ the guard bites: an invented file and an invented function are named; a wrong meaning (T1-INV) is named');

const rows = MAP.flows.reduce((n, f) => n + f.steps.length, 0);
console.log('  ' + rows + ' steps · ' + checked + ' files/routes checked' + (shapeOnly ? ' · ' + shapeOnly + ' api/engines refs by shape only (sibling repo not beside this one)' : ''));
console.log('\n' + (bad ? '✗ ' + bad + ' FAILED — the process map no longer matches the code\n' : '✓ the process map matches the code\n'));
process.exit(bad ? 1 : 0);
