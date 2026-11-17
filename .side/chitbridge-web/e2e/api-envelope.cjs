/**
 * api-envelope.cjs — A ROUTE MUST NOT ANSWER WITH A FIELD THE CLIENT ENVELOPE THROWS AWAY.
 *
 * ── ⚠️⚠️⚠️ WHY THIS EXISTS: THE SAME BUG, FIVE TIMES ────────────────────────────────────────────────────────
 *
 * `core.js` collapses a compound response to its array when the array's key is one of a known list — so
 * `{items:[…], total, truncated}` becomes the items array with a few siblings re-attached. The siblings it
 * re-attaches are a NAMED ALLOW-LIST (`SIBS`). Everything else is dropped, silently, with no error anywhere.
 *
 * It has now eaten five fields, and each one looked like a different bug:
 *   · `truncated`        → the catalogue search never asked the server and answered "no such product" about
 *                          96 products that exist. Athi found it.
 *   · `status_counts`    → the availability chips counted the 500 loaded rows and reported "495 / 5" for a
 *                          shop of 10,441. Athi found that one too.
 *   · `counts` / `open`  → the incident and requirement boards lost their filter chips.
 *   · `category_counts`  → the Categories screen read undefined and fell back to counting one page:
 *     and `uncategorised`  "Biscuits 19" for a shop holding 400 (2026-09-16).
 *
 * ⭐⭐ THE FAILURE IS ALWAYS SILENT AND ALWAYS FLATTERING. The value reads `undefined`, the screen shows a
 * smaller, tidier number, and nothing says a field was dropped. The server is right and the screen is wrong,
 * which is the hardest direction to debug because the API answers correctly when you test it by hand.
 *
 * ⚠️ core.js has carried a warning in CAPITALS about this since the second instance — "IF YOU ADD AN ENDPOINT
 * THAT RETURNS AN ARRAY BESIDE ANY OTHER KEY, IT BELONGS ON THIS LINE" — and the fifth instance happened on a
 * day that comment was read twice. A WARNING IS NOT A GUARD. This is the guard.
 *
 * Run: node e2e/api-envelope.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');

const API = path.join(__dirname, '..', '..', 'chitbridge-api', 'routes');
const CORE = path.join(__dirname, '..', 'public', 'app', 'core.js');

/* ── read the two lists out of core.js, never copy them ───────────────────────────────────────────────────
   ⚠️ PARSED, NOT DUPLICATED. A copy here would drift the moment somebody adds a sibling, and this guard would
   then be asserting a rule the client no longer follows — the exact failure it exists to prevent. */
const core = fs.readFileSync(CORE, 'utf8');
const sibsM = /var SIBS = \[([^\]]*)\]/.exec(core);
const collM = /for\s*\(const k of \[([^\]]*)\]\)\s*if\s*\(Array\.isArray/.exec(core);
if (!sibsM) { console.error('api-envelope: could not find SIBS in core.js'); process.exit(1); }
if (!collM) { console.error('api-envelope: could not find the collapse list in core.js'); process.exit(1); }
const names = (s) => (s.replace(/\/\*[\s\S]*?\*\//g, '').match(/(["'])([^"']+)\1/g) || []).map((x) => x.slice(1, -1));
const SIBS = new Set(names(sibsM[1]));
const COLLAPSE = new Set(names(collM[1]));

/* responses that core.js hands back WHOLE — it checks for these keys and returns untouched */
const WHOLE = new Set(['token', 'my_disputes', 'header', 'has_catalogue', 'searched']);

/**
 * ── ⭐ ONLY WHAT THE APP ACTUALLY CALLS THROUGH api() ───────────────────────────────────────────────────────
 *
 * The envelope is core.js's, so it can only eat a field on a route the APP fetches through `api()`. The till's
 * connector, the simulator and the storefront each have their own client and are none of this rule's business —
 * flagging them would make the guard noisy, and a noisy guard is the thing that let five of these ship.
 *
 * ⚠️ So the route paths come from `EP` in app.html — the app's own list of what it calls — and a response is
 * judged only if its file serves one of them.
 */
const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8');
const epBlock = /const EP = \{([\s\S]*?)\n\s*\};/.exec(APP); // the closing brace may be indented (MNT-4 formatting)
if (!epBlock) { console.error('api-envelope: could not find EP in app.html'); process.exit(1); }
const EP_PATHS = new Set((epBlock[1].match(/p:\s*(['"])([^'"]+)\1/g) || []).map((s) => /(['"])([^'"]+)\1/.exec(s)[2])); // either quote style
/* silence is the bug: a reader that matches almost nothing would pass every route unchecked */
if (EP_PATHS.size < 50) { console.error('api-envelope: only ' + EP_PATHS.size + ' EP paths read from app.html; the reader no longer matches EP'); process.exit(1); }
/* routes/<name>.js serves /api/<mount>; a file counts if ANY endpoint the app calls lives under its mount */
const mountOf = (file) => file.replace(/\.js$/, '');
const APP_FILES = new Set();
for (const p of EP_PATHS) {
  const seg = String(p).split('/')[2];
  if (seg) APP_FILES.add(seg);
}
/* a few files serve a mount spelled differently from their filename */
/* QA-20 · nine of the ten identity entries were already in APP_FILES (every EP mount); only `connectors` is
   not called through app.html's EP, and it is kept on purpose: connectors.js collapses responses the Node
   connector reads, so it must still be checked. */
const ALIAS = { connectors: 'connectors' };

/** the balanced `{…}` starting at `from`, or null */
function objectAt(src, from) {
  let d = 0, q = null, i = from;
  for (; i < src.length; i++) {
    const c = src[i], p = src[i - 1];
    if (q) { if (c === q && p !== '\\') q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '{') d++;
    else if (c === '}') { d--; if (!d) return src.slice(from, i + 1); }
  }
  return null;
}

/**
 * Top-level keys of an object literal — depth 1 only, strings and comments skipped.
 *
 * ⚠️⚠️ POSITION IS EVERYTHING, and the first version of this got it wrong. It matched any identifier followed
 * by `:` `,` or `}`, so it read the VALUES in `{ ok: true, basis: null }` as keys and reported "true" and
 * "null" as dropped fields. A key can only appear where a key is expected: right after the opening brace or
 * after a comma. After a colon we are in a value until the next depth-1 comma.
 */
function topKeys(obj) {
  const out = [];
  let d = 0, q = null, expectKey = false;
  for (let i = 0; i < obj.length; i++) {
    const c = obj[i], p = obj[i - 1];
    if (q) { if (c === q && p !== '\\') q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && obj[i + 1] === '*') { const e = obj.indexOf('*/', i); i = e < 0 ? obj.length : e + 1; continue; }
    if (c === '/' && obj[i + 1] === '/') { const e = obj.indexOf('\n', i); i = e < 0 ? obj.length : e; continue; }
    if (c === '{' || c === '[' || c === '(') { d++; if (d === 1) expectKey = true; continue; }
    if (c === '}' || c === ']' || c === ')') { d--; continue; }
    if (d !== 1) continue;
    if (c === ',') { expectKey = true; continue; }
    if (c === ':') { expectKey = false; continue; }
    if (!expectKey) continue;
    if (/\s/.test(c)) continue;
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^([A-Za-z_$][\w$]*)\s*([:,}])/.exec(obj.slice(i));
      if (m) {
        out.push(m[1]);
        /* a shorthand key IS also its value, so the next thing is a fresh key; a `key:` opens a value */
        expectKey = (m[2] !== ':');
        i += m[1].length - 1;
        continue;
      }
    }
    /* anything else where a key was expected (a spread, a computed key, a quoted key) — not our business */
    expectKey = false;
  }
  return out;
}

/**
 * ── ⚠️ THE BASELINE, AND WHY IT IS NOT AN EXCUSE ───────────────────────────────────────────────────────────
 *
 * Responses that answer with a sibling this envelope drops. Each is a LATENT instance: the field is sent and
 * thrown away, and it becomes a live bug the moment a screen reads it — which is exactly how all seven confirmed
 * ones happened. They are listed rather than fixed blind, because "stop sending it" and "carry it" are different
 * answers and only somebody who knows what reads it can choose.
 *
 * ⭐ THE POINT OF THE LIST IS THAT IT SHRINKS, AND IT HAS: ten → five on 2026-09-16, by tracing every one to its
 * readers rather than guessing.
 *   · `migrated` was NOT latent at all — it was live. `messages` is a collapse key, so the product-enquiry
 *     thread read `r.messages` off the array itself and rendered EMPTY every time, which reads as "nobody has
 *     asked": the most flattering possible wrong answer. Carried now, and the call site fixed.
 *   · `supplier` and `groups` ARE read — but only because supCatalogueFull() bypasses api() to keep them.
 *     Carried, so that bypass can eventually be retired.
 *   · `view`, `pagination` and `history` had no reader anywhere: a query param echoed back, three numbers
 *     spelled a second time, and a branch label. Those routes stopped sending them.
 *
 * ⚠️ WHAT IS LEFT IS LEFT ON PURPOSE, not unexamined:
 *   · relationships.js `schema, fields, finishes` — no reader on this payload, but these two are the
 *     not-found and unavailable FALLBACKS of a route whose success path builds the same keys from
 *     buildPublicView(). Making a fallback a different shape from the success it stands in for is a worse
 *     fault than an unread field.
 *   · products.js — `prodAddMany` has no call site in the web app at all; the only caller is the Node
 *     connector, which does not pass through core.js and discards the response. Deleting the dead endpoint
 *     entry is the real fix and it is a decision, not a tidy-up.
 *   · till.js — that route never goes through core.js (the counter fetches it raw), so it is not a SIBS
 *     hazard at all. It stays listed only so the guard's arithmetic stays honest.
 *   · actors.js `summary` — no reader; a genuine candidate to stop sending, left for a day when the
 *     workforce screens are being touched anyway.
 *
 * ⚠️ Keyed by file + the dropped names, NOT by line number — a baseline that moves when somebody adds a blank
 * line above it is a baseline that gets deleted in frustration.
 */
/* QA-20 (19 Oct 2026) kept 3 known entries here; QA-154 (13 Nov 2026) moved them, with the findings that had no baseline, into the
   ONE ratchet file e2e/scanner-known.json (key = file|dropped names, no line). Only a NEW finding fails; the list may only shrink. */

const files = fs.readdirSync(API).filter((f) => f.endsWith('.js'));
const all = [];
let checked = 0;

const skipped = [];
for (const f of files) {
  /* ⚠️ only files serving a path the app calls through api() — see EP_PATHS above */
  if (!APP_FILES.has(mountOf(f)) && !ALIAS[mountOf(f)]) { skipped.push(f); continue; }
  const src = fs.readFileSync(path.join(API, f), 'utf8');
  const re = /res\.json\(\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    const obj = objectAt(src, src.indexOf('{', m.index));
    if (!obj) continue;
    const keys = topKeys(obj);
    if (!keys.length) continue;
    /* does this response carry one of the keys core.js collapses on? */
    const arrKey = keys.find((k) => COLLAPSE.has(k));
    if (!arrKey) continue;
    /* a response core.js hands back whole is never collapsed */
    if (keys.some((k) => WHOLE.has(k))) continue;
    checked++;
    const lost = keys.filter((k) => k !== arrKey && !SIBS.has(k) && !COLLAPSE.has(k));
    if (lost.length) {
      const line = src.slice(0, m.index).split('\n').length;
      const key = f + '|' + lost.slice().sort().join(',');
      all.push({ key, show: { file: f, line, arrKey, lost } });
    }
  }
}

console.log('\n── a route must not answer with a field the client throws away ──\n');
console.log('  collapse keys : ' + [...COLLAPSE].join(', '));
console.log('  carried (SIBS): ' + [...SIBS].join(', ') + '\n');

const RK = require('./lib/known-findings.cjs').ratchet('api-envelope', all, { owner: 'api' });
const findings = RK.fresh.map((i) => i.show);
if (RK.known) {
  console.log('  ⚠ ' + RK.line.trim() + ' — sent and dropped, not yet read');
  console.log('    ⭐ the list is meant to SHRINK\n');
}
if (!findings.length) {
  console.log('  ✓ ' + checked + ' collapsing response(s) checked — no NEW field is dropped\n');
  process.exit(0);
}
console.log('  ✗ ' + findings.length + ' response(s) answer with a field core.js will DROP:\n');
for (const x of findings) {
  console.log('      routes/' + x.file + ':' + x.line + '  (collapses on "' + x.arrKey + '")');
  console.log('          lost: ' + x.lost.join(', '));
}
console.log('\n    Either add the field to SIBS in public/app/core.js, or stop sending it.');
console.log('    ⚠️ A dropped field reads as `undefined` at every call site, with no error anywhere —');
console.log('       which is why this has now happened five times.\n');
process.exit(1);
