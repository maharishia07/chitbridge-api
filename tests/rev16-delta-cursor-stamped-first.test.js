const { routeAt } = require('./support/src-find.cjs'); /* iter1: route anchors survive the formatter */
/**
 * ── ⭐⭐ [REV-16] "THE DELTA CURSOR IS STAMPED AFTER THE READ, SO EDITS VANISH PERMANENTLY" ─────────────────────
 *
 * External review, 2026-09-25: routes/till.js:157-159 vs :514.
 *
 * GET /api/till/snapshot?since=T hands the till a cursor (`body.at`) to ask for next time. The item SELECT ran
 * on `updated_at > since`; the OLD code stamped `body.at = new Date().toISOString()` at body-construction time,
 * AFTER the tax shelf, the live offers and the network-offers lookups had all also run. Item SELECT at
 * 10:00:00.300, back office saves a price at 10:00:00.700, the old stamp lands at 10:00:01.100 — that edit's
 * updated_at (10:00:00.700) is already ≤ the cursor just handed out, so the NEXT poll (`updated_at > 10:00:01.100`)
 * never sees it. The counter goes on selling at the old price forever, "prices as at 10:00" reading fresh.
 *
 * The fix: capture the timestamp as the FIRST statement in the handler, before any query runs, and use that
 * same value for body.at — a cursor that is at worst slightly conservative (may re-send a row that settled a
 * moment later; a harmless repeat) rather than silently unsafe (a permanent miss).
 *
 * ⚠️ Structural, not a live integration test: GET /api/till/snapshot pulls in auth, tax-shelf, offers-live and
 * network-offers, real DB stubs for which are out of scope here. What is checked is exactly the shape of the
 * regression — that readAt is captured before the item SELECT and body.at uses that same value, not a fresh
 * `new Date()` call at construction time.
 */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (name, cond, why) => {
  if (cond) { pass++; console.log('  ok    ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (why ? '\n        ' + why : '')); }
};

const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'till.js'), 'utf8');
const snapshotStart = routeAt(src, 'get', '/snapshot');
const itemSelectAt = src.indexOf('FROM catalogue_items WHERE entity_id = $1 AND updated_at > $2');
const readAtDeclAt = src.indexOf('const readAt = new Date().toISOString();');
/* ⚠️ MOVED, NOT DELETED (2026-09-28): the cursor is readAt, or — for a delta sent in parts — the last row it carries.
   Never a fresh "now" taken after the read, which is the defect this file exists for. */
const bodyAtAt = src.search(/at: deltaCursor \|\| readAt\b/);

console.log('\n── the snapshot route exists, and in the order this test assumes ──\n');
ok('the /snapshot route is present', snapshotStart >= 0);
ok('the delta item SELECT is present', itemSelectAt > snapshotStart);

console.log('\n── the cursor is captured BEFORE the read, not after it ──\n');
ok('readAt is declared', readAtDeclAt > snapshotStart, 'the fix\'s own timestamp capture is missing');
ok('readAt is declared before the item SELECT runs', readAtDeclAt > 0 && readAtDeclAt < itemSelectAt,
  'readAt at ' + readAtDeclAt + ', item SELECT at ' + itemSelectAt + ' — a cursor captured after the read is the exact defect this fixes');

console.log('\n── body.at is that SAME captured moment, not a fresh "now" taken later ──\n');
ok('body.at uses readAt', bodyAtAt > itemSelectAt, 'body.at should read `at: readAt`, captured above, not call new Date() again here');
const bodyLiteralStart = src.indexOf('const body = {');
const bodyWindow = src.slice(bodyLiteralStart, bodyLiteralStart + 400);
ok('the body literal\'s own `at:` field is `readAt`, not a fresh new Date()',
  /at:\s*(deltaCursor\s*\|\|\s*)?readAt\s*(\/\*[\s\S]*?\*\/)?\s*,/.test(bodyWindow) && !/at:\s*new Date\(\)/.test(bodyWindow),
  'body literal opens with: ' + bodyWindow.slice(0, 80).replace(/\s+/g, ' '));

/* ⚠️⚠️ external review 2026-09-25: newest-first LIMIT 20000 dropped the OLDEST changes past the cap while the cursor jumped */
console.log('\n── a delta longer than the cap is sent in PARTS, never cut ──\n');
const snap = src.slice(snapshotStart, src.indexOf('router.', snapshotStart + 30) > 0 ? src.indexOf('\nrouter.', snapshotStart + 30) : src.length);
ok('the delta reads OLDEST first, one past the cap', /updated_at > \$2 ORDER BY updated_at ASC LIMIT \$3',\s*\[entity_id, since, DELTA_CAP \+ 1\]/.test(snap),
  'a newest-first delta cuts the oldest changes');
ok('the delta goes through deltaPage, and the answer carries more', /const pg = deltaPage\(all, DELTA_CAP\)/.test(snap) && /more: deltaMore,/.test(snap));

/* ⭐ SEC-SMALL item 5 (2026-10-14): the FULL read was still `ORDER BY updated_at DESC NULLS LAST LIMIT 20000`, cut in silence — a shop past
   the cap never received its oldest items, and the till's total check pulled the whole (cut) shop again on every refresh */
console.log('\n── the FULL read pages by the same rule, and says its limit ──\n');
ok('⭐ the full read is oldest-first, one past the cap, through the same parameter', /is_active = true ORDER BY updated_at ASC LIMIT \$2',\s*\[entity_id, DELTA_CAP \+ 1\]/.test(snap),
  'a full read that is newest-first LIMIT 20000 cuts the oldest items in silence');
ok('deltaPage runs for a delta AND a full read (no `if (since)` around it)', !/if \(since\) \{\s*const pg = deltaPage/.test(snap) && /\{\s*const pg = deltaPage\(all, DELTA_CAP\);\s*all = pg\.rows;/.test(snap));
ok('the answer says its limit beside more · at · total', /limit: DELTA_CAP,/.test(snap));
ok('no bare LIMIT 20000 is left in the snapshot route', !/LIMIT 20000/.test(snap.replace(/\/\*[\s\S]*?\*\//g, '')), 'a silent cap remains');
ok('the dues aggregate reads one past the cap and, cut, sends balances as UNKNOWN (absent) with a warn line',
  /LIMIT \$2`,\s*\[entity_id, DELTA_CAP \+ 1\]/.test(snap) && /dues\.rows\.length > DELTA_CAP/.test(snap) && /duesCut = true;\s*dues = \{ rows: \[\] \}/.test(snap)
  && /warn\('till\.snapshot\.dues\.cut'/.test(snap) && /x\.has_party_item && !duesCut\)/.test(snap));

/* ⭐ and the counter follows: the master reads a snapshot in parts to its end before comparing it with total or storing it */
const till = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8');
let partsDone = null;   /* the async part of the till check — awaited before the verdict below */
const fn = till.match(/async function snapParts\(snap\)\{[\s\S]*?\n\}/);
ok('⭐ the till master has snapParts', !!fn);
ok('refresh() reads the parts before the merge with the stored copy, and the rebuild read does too',
  (till.match(/snap = await snapParts\.call\(this, snap\);/g) || []).length === 1 && /snap = await snapParts\.call\(this, await full\.json\(\)\); snap\.rebuilt = true;/.test(till));
/* the loop itself, driven by a stub fetch: three parts of four rows, a removal in part two, the cursor followed, total taken from the last part */
if (fn) {
  const PARTS = {
    'a': { at: 'b', more: true,  items: [{ item_id: 'i5' }, { item_id: 'i6' }], removed: ['i1'], entity_id: 'shop' },
    'b': { at: 'c', more: false, items: [{ item_id: 'i7' }], removed: [], total: 6, entity_id: 'shop' },
  };
  const seen = [];
  const sandbox = { fetchBy: async (url) => { const since = decodeURIComponent(url.split('since=')[1]); seen.push(since);
    const p = PARTS[since]; return { ok: !!p, json: async () => p }; }, SLOW: 1, encodeURIComponent, String, Object, Array };
  const snapParts = new Function('fetchBy', 'SLOW', fn[0] + '; return snapParts;')(sandbox.fetchBy, 1);
  const store = { api: 'http://x', auth: () => ({}) };
  partsDone = snapParts.call(store, { at: 'a', more: true, items: [{ item_id: 'i1' }, { item_id: 'i2' }, { item_id: 'i3' }, { item_id: 'i4' }], entity_id: 'shop', total: 4 })
    .then((s) => {
      ok('⭐⭐ the parts are followed by cursor (a → b) and the loop stops when more is false', seen.join(',') === 'a,b' && s.more === false && s.at === 'c', JSON.stringify({ seen, at: s.at, more: s.more }));
      ok('the rows add up: four, minus the one removed, plus three — six, and total is the last part\'s', s.items.length === 6 && s.total === 6 && !s.items.some((i) => i.item_id === 'i1'), s.items.map((i) => i.item_id).join(','));
      ok('the removals ride on the snapshot for the merge with the stored copy', Array.isArray(s.removed) && s.removed.indexOf('i1') >= 0);
    });
}

/* ⭐ and the behaviour itself: a counter that follows the cursor receives EVERY row, however many parts it takes */
const fnSrc = src.match(/function deltaPage\(rows, cap\) \{[\s\S]*?\n\}/);
ok('deltaPage exists', !!fnSrc);
const deltaPage = new Function(fnSrc[0] + '; return deltaPage;')();
const t0 = Date.parse('2026-09-28T10:00:00.000Z');
/* 11 changed rows, two sharing a millisecond at a part boundary — the case a strict ">" could skip */
const ROWS = [0, 1, 2, 3, 3, 4, 5, 6, 7, 8, 9].map((ms, i) => ({ item_id: 'i' + i, updated_at: new Date(t0 + ms) }));
const fetch = (since, cap) => ROWS.filter((r) => r.updated_at.getTime() > Date.parse(since)).slice(0, cap + 1);
let since = new Date(t0 - 1).toISOString(), got = new Set(), parts = 0, more = true;
while (more && parts < 20) { const pg = deltaPage(fetch(since, 3), 3); pg.rows.forEach((r) => got.add(r.item_id)); more = pg.more; if (pg.cursor) since = pg.cursor; parts++; }
ok('⭐⭐ following the cursor delivers all 11 rows — none skipped at a part boundary', got.size === ROWS.length,
  'received ' + got.size + ' of ' + ROWS.length + ' in ' + parts + ' parts');
ok('a delta that fits is one part, cursor null (readAt stands)', deltaPage(ROWS.slice(0, 2), 3).cursor === null && deltaPage(ROWS.slice(0, 2), 3).more === false);

Promise.resolve(partsDone).then(() => {
  console.log('\n' + (fail ? '✗ ' + fail + ' failed' : '✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
});
