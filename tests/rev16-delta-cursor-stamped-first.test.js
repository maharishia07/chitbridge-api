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
const snapshotStart = src.indexOf("router.get('/snapshot'");
const itemSelectAt = src.indexOf('FROM catalogue_items WHERE entity_id = $1 AND updated_at > $2');
const readAtDeclAt = src.indexOf('const readAt = new Date().toISOString();');
const bodyAtAt = src.indexOf('at: readAt,');

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
const bodyWindow = src.slice(bodyLiteralStart, bodyLiteralStart + 200);
ok('the body literal\'s own `at:` field is `readAt`, not a fresh new Date()',
  /at:\s*readAt\s*,/.test(bodyWindow) && !/at:\s*new Date\(\)/.test(bodyWindow),
  'body literal opens with: ' + bodyWindow.slice(0, 80).replace(/\s+/g, ' '));

console.log('\n' + (fail ? '✗ ' + fail + ' failed' : '✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
process.exit(fail ? 1 : 0);
