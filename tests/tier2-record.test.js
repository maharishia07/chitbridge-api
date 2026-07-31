'use strict';
// Regression — TIER 2: "the record must stop asserting things nobody agreed" (review 2026-07-29).
//
// These test the SHAPE of what gets sealed onto a chit, without a database: the route builds summary_json and the
// line items from pure inputs, so the decisions are testable by replicating them exactly. Where a test mirrors route
// logic it says so — a mirror that drifts is worse than no test, so each one also asserts against the real source
// file, which fails loudly if the route stops doing what the test claims.
// Run:  node tests/tier2-record.test.js
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const OI = require('../lib/order-input');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log('  \x1b[32mok\x1b[0m  ' + name); pass++; } catch (e) { console.log('  \x1b[31mXX\x1b[0m  ' + name + ' — ' + e.message); fail++; } };
const ROUTE = fs.readFileSync(path.join(__dirname, '..', 'routes', 'catalogue.js'), 'utf8');

// ── 2.1 · an OFFER must not carry an ORDER's money ────────────────────────────────────────────────────────────
// lib/kyb.js sums total_value into per-counterparty trade history, so a negotiation stamped with the SELLER's list
// price inflated the seller's trust signal by a figure neither party agreed.
t('2.1 · a negotiation is purpose "offer" with NO total_value', () => {
  assert.match(ROUTE, /const purpose = negotiation \? 'offer' : 'order';/, 'purpose must follow the negotiation flag');
  // Was pinned to the literal `total_value: negotiation ? null : …`. The condition gained a second term when a chit
  // with no currency (help desk / form) also stopped carrying a total, so the literal moved while the PROPERTY —
  // an offer carries no settled total — held and got stronger. Assert the property.
  assert.match(ROUTE, /total_value: \(!monetary \|\| negotiation\) \? null : Math\.round\(total \* 100\) \/ 100/,
    'an offer, and anything non-monetary, must carry no settled total');
  assert.match(ROUTE, /const monetary = oi\.pipeline === 'commerce'/, 'monetary must be derived from the pipeline, not a new flag');
});
t('2.1 · the indicative figure is kept, but under a name that cannot be mistaken for a total', () => {
  assert.match(ROUTE, /indicative_total: Math\.round\(total \* 100\) \/ 100/);
  assert.ok(!/total_value: Math\.round\(total \* 100\) \/ 100,\s*\n\s*currency_code/.test(ROUTE), 'the old unconditional total_value is gone');
});
t('2.1 · purpose reaches BOTH chit copies and both detail rows, on both write paths', () => {
  // `all_recipients, purpose, auto_subject` also appears in two SQL COLUMN LISTS, which are not JS and were always
  // spelled that way — so count only the JS object-literal form.
  const copies  = (ROUTE.match(/display_name, all_recipients, purpose, auto_subject,/g) || []).length;
  const details = (ROUTE.match(/detail_type: purpose,/g) || []).length;
  assert.strictEqual(copies, 2, 'both chit_deliver copies must take the resolved purpose');
  assert.strictEqual(details, 2, 'both detail rows must take it too');
  assert.ok(!/VALUES \(\$1,\$2,\$3,\$4,\$5,\$6,'order',/.test(ROUTE), 'the legacy fallback still hardcodes order');
  assert.ok(!/VALUES \(\$1,\$2,'order',/.test(ROUTE), 'a legacy detail insert still hardcodes order');
});
t('2.1 · deliverEdge (the NETWORK path) is untouched — `purpose` is not in scope there', () => {
  // A blanket rename briefly turned this into a ReferenceError that `node -c` cannot see.
  // Slice to the END OF THE FUNCTION, not a fixed byte count. This read `+ 1500` and broke the day a comment was
  // added above `detail_type`, reporting a regression that had not happened. The whole body is also the STRICTER
  // scope for the negative assertion below, so this widens what is guarded rather than narrowing it.
  const from = ROUTE.indexOf('async function deliverEdge');
  const edge = ROUTE.slice(from, ROUTE.indexOf("router.post('/network-store", from));
  assert.match(edge, /detail_type: 'order'/, 'the network path must keep its literal');
  assert.ok(!/detail_type: purpose/.test(edge), 'purpose is undefined in this function');
});
t("2.1 · KYB reads total_value, which is why null matters", () => {
  const kyb = fs.readFileSync(path.join(__dirname, '..', 'lib', 'kyb.js'), 'utf8');
  // This asserted `COALESCE(total_value, 0)` and said: "if this stops being true, revisit whether null is still the
  // right signal." Revisited. Null IS still the right signal — the COALESCE was the wrong consumer of it. Folding
  // null to 0 turned every unagreed offer and every help-desk chit into a zero-value TRADE, padding the row count
  // that the concentration percentage divides by. The invariant is now the opposite and stricter:
  assert.ok(!/COALESCE\(total_value/.test(kyb), 'kyb must NOT coalesce null away — null means "not applicable", not zero');
  assert.match(kyb, /SELECT[^`]*currency_code[^`]*FROM chit_header/s, 'kyb must read the currency it is summing');
  assert.match(kyb, /by_currency/, 'a money summary must be split by currency, never totalled across it');
  assert.match(kyb, /excluded: \{ non_monetary/, 'what is left out of the money view must be stated, not hidden');
});

// ── 2.3 · the conformance verdict must not be forgeable ───────────────────────────────────────────────────────
t('2.3 · `captured` is restricted to the fields this shop actually asks for', () => {
  assert.match(ROUTE, /captureFieldsForEntity\(entity\.identity_id\)/, 'the allow-list must come from the standards, not the request');
  assert.match(ROUTE, /if \(!allow\.has\(k\)\) continue;/, 'an unasked-for key must be dropped');
});
t('2.3 · captured values are scalars, length-capped, and an unresolvable allow-list carries NOTHING', () => {
  assert.match(ROUTE, /if \(v === null \|\| typeof v === 'object'\) continue;/, 'objects must not ride onto the chit');
  assert.match(ROUTE, /String\(v\)\.slice\(0, 200\)/, 'values must be capped');
  assert.match(ROUTE, /catch \(_\) \{ captured = \{\}; \}/, 'failing to resolve the allow-list must fail CLOSED');
});
t('2.3 · the allow-list reads the right key — `field`, not `key`', () => {
  // captureFieldsForEntity returns [{field, standard, facet, title}]. Reading `key` yields an EMPTY allow-list,
  // which silently drops every captured field instead of failing loudly. This caught exactly that during the build.
  const conf = fs.readFileSync(path.join(__dirname, '..', 'lib', 'conformance.js'), 'utf8');
  assert.match(conf, /out\.push\(\{ field: f,/, 'conformance still returns `field`');
  assert.match(ROUTE, /f\.field \|\| f\.key/, 'the route must read `field` first');
});

// ── 2.5 · an undeclared field must never be carried, on EITHER pipeline ───────────────────────────────────────
t('2.5 · `combination` is rejected when it is an object, and capped when it is text', () => {
  assert.match(ROUTE, /typeof comboRaw === 'object'\) throw _422/, 'a nested object must be rejected outright');
  assert.match(ROUTE, /String\(comboRaw\)\.slice\(0, 120\)/, 'a name must be length-capped');
});
t('2.5 · an item with NO declared combinations rejects one instead of storing it raw', () => {
  assert.match(ROUTE, /if \(combo && !fref\.combos\.size\) throw _422/, 'the guard used to be skipped entirely in this case');
});

// ── T1.1 follow-up · a declaration that cannot be enforced must be REFUSED at save time ───────────────────────
t('face save rejects a declaration using unsupported keywords', () => {
  const faceRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'catalogue-face.js'), 'utf8');
  assert.match(faceRoute, /Declaration not supported/, 'the owner must be told at the moment they write it');
  assert.match(faceRoute, /for \(const it of \(Array\.isArray\(face\.items\)/, 'per-ITEM declarations must be checked too');
  // and the check itself must actually flag the real case
  assert.ok(OI.resolve({ preset: 'form', schema: { properties: { g: { type: 'string', pattern: '^x$' } } } }).errors.length > 0);
  assert.deepStrictEqual(OI.resolve({ preset: 'form', schema: { properties: { g: { type: 'string', maxLength: 5 } } } }).errors, [],
    'a supportable declaration must still save cleanly');
});

// ── 2.2 / 3.10 · the documents commit WITH the chit ───────────────────────────────────────────────────────────
t('2.2 · the blob write is INSIDE the chit transaction, on both write paths', () => {
  const inTx = (ROUTE.match(/putForParticipantsInTx\(client,/g) || []).length;
  assert.strictEqual(inTx, 2, 'chit_deliver AND the legacy fallback must both write documents in-transaction');
  assert.ok(!/let documents_stored/.test(ROUTE), 'the post-commit best-effort path must be gone');
  assert.ok(!/documents_stored: false/.test(ROUTE), 'there is no partial-success state to report any more');
});
t('2.2 · the entity context is restored after switching it per participant', () => {
  // set_config(..., true) is transaction-local; switching to the shop and not switching back would leave the rest
  // of the transaction running as the wrong tenant.
  assert.match(ROUTE, /restore the customer's context/, 'the restore must be deliberate and commented');
  const after = ROUTE.slice(ROUTE.indexOf('putForParticipantsInTx'));
  assert.match(after, /set_config\('app\.current_entity', \$1, true\)`, \[String\(c\.identity_id\)\]/);
});
t('3.10 · the in-tx helper exists and sets the entity context per participant', () => {
  const storage = fs.readFileSync(path.join(__dirname, '..', 'lib', 'storage.js'), 'utf8');
  assert.match(storage, /async putForParticipantsInTx\(client,/);
  assert.match(storage, /set_config\('app\.current_entity', \$1, true\)/, 'RLS WITH CHECK needs the context at INSERT time');
  assert.match(storage, /async putForParticipants\(/, 'the original is kept — other callers still use it');
});

// ── 2.4 · the customer has an authenticated surface ───────────────────────────────────────────────────────────
t('2.4 · customerAuth accepts ONLY identity_type customer', () => {
  const mw = fs.readFileSync(path.join(__dirname, '..', 'middleware', 'customer-auth.js'), 'utf8');
  assert.match(mw, /decoded\.identity_type !== 'customer'/, 'an entity or actor token must be refused here');
  assert.match(mw, /algorithms: \['HS256'\]/, 'the algorithm must be pinned, as in auth.js');
});
t('2.4 · the customer routes use customerAuth, never the business `auth`', () => {
  for (const r of ['my-orders', 'my-documents']) {
    const line = ROUTE.split('\n').find((l) => l.includes(`/:bridge_id/${r}`) && l.includes('router.'));
    assert.ok(line, `route ${r} not found`);
    assert.ok(/customerAuth/.test(line), `${r} must be behind customerAuth`);
    assert.ok(!/[^r]auth,/.test(line.replace('customerAuth', '')), `${r} must not also accept a business token`);
  }
});
t('2.4 · a customer can PURGE their own copy — per-copy independence, honoured', () => {
  assert.match(ROUTE, /DELETE FROM cb_attachment WHERE id = \$1 AND entity_id = \$2/, 'scoped to their own row only');
  assert.match(ROUTE, /router\.delete\('\/:bridge_id\/my-documents\/:id', customerAuth/);
});
t('2.4 · my-orders lists OFFERS too, not just orders', () => {
  // T2.1 renamed negotiations to purpose 'offer'; a filter on 'order' alone would have hidden every offer.
  assert.match(ROUTE, /ch\.purpose IN \('order', 'offer'\)/);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
