'use strict';
/**
 * prove-itemversion.js — b146, against a LIVE environment.
 *
 * Athi ran the migration; this is what says it works. The offline suites cannot touch it: the whole mechanism is a
 * database trigger, so the only honest proof is a real write to a real table.
 *
 * ⚠️ THE ASSERTION THAT MATTERS MOST IS THE NEGATIVE ONE. Cutting a version on every write is the failure mode
 * this design exists to avoid — an hourly stock feed would produce 4.4 million rows a year on a 500-item
 * catalogue. So "a description-only edit does NOT cut a version" is the load-bearing test, not the happy path.
 *
 * ⚠️ THE HARNESS SIGNATURE IS ok(cond, msg, detail) — NOT ok(msg, cond). The first version of this file had them
 * the other way round, so every assertion was handed a non-empty string as its condition, every one "passed", and
 * the run reported green while proving nothing. A test that cannot fail is worse than no test, because it is
 * believed. Two of the lines it printed said "✓ false".
 *
 * Run: node scripts/prove-itemversion.js
 */
const P = require('./_proof');

P.run('b146 · catalogue_item_version', async (t) => {
  const stamp = String(process.hrtime.bigint()).slice(-9);
  const token = await P.signIn('ver' + stamp + '@proof.test', 'Version Proof ' + stamp);
  if (!token) throw new Error('could not sign in');
  const auth = { token };
  const base = { name: 'Paracetamol 500', unit: 'strip', sku: 'MED-500' };

  // ── 1 · a new item gets version 1 ─────────────────────────────────────────────────────────────────────────────
  const made = await P.j('/api/products', { method: 'POST', ...auth,
    body: { item_data: { ...base, price: 24, desc: 'first' } } });
  t.ok(made.status === 200 || made.status === 201, 'a product is created',
    'status ' + made.status + ' ' + JSON.stringify(made.b).slice(0, 200));
  const id = made.b && (made.b.item_id || (made.b.item || {}).item_id);
  if (!id) throw new Error('no item_id came back: ' + JSON.stringify(made.b).slice(0, 300));

  let v = await P.j('/api/products/' + id + '/versions', auth);
  if (v.status === 503) throw new Error('b146 is NOT applied here — ' + (v.b && v.b.message));
  t.ok(v.b.count === 1, 'the trigger cut version 1 on INSERT, with no application code involved',
    JSON.stringify(v.b).slice(0, 300));
  t.ok(v.b.current && v.b.current.version_no === 1 && v.b.current.valid_to === null,
    '…and it is the current one', JSON.stringify(v.b.current));
  t.ok(v.b.current && Number(v.b.current.price) === 24, '…carrying the price it was created with',
    'price ' + JSON.stringify((v.b.current || {}).price));
  const v1_at = v.b.current.valid_from;

  // ⚠️ PATCH, NOT PUT. The first run used PUT, got a 404 that nothing asserted on, and reported "a reprice
  // cuts no version" — a product defect that was entirely the test not editing anything. Every write is
  // status-checked now: an assertion about a change that never happened is not a test.
  // ── 2 · ⚠️ THE NEGATIVE CASE — a change outside the six fields must cut NOTHING ────────────────────────────────
  await P.j('/api/products/' + id, { method: 'PATCH', ...auth,
    body: { item_data: { ...base, price: 24, desc: 'CHANGED — description only' } } });
  v = await P.j('/api/products/' + id + '/versions', auth);
  t.ok(v.b.count === 1, '⭐ a description-only edit cuts NO version — the brake the whole design rests on',
    'count ' + v.b.count + ' — a version per write is the 4.4M-rows-a-year failure');

  // ── 3 · a REPRICE is a real change ────────────────────────────────────────────────────────────────────────────
  await P.j('/api/products/' + id, { method: 'PATCH', ...auth,
    body: { item_data: { ...base, price: 31, desc: 'CHANGED — description only' } } });
  v = await P.j('/api/products/' + id + '/versions', auth);
  t.ok(v.b.count === 2, '⭐ a reprice cuts version 2', 'count ' + v.b.count);
  t.ok(v.b.current && v.b.current.version_no === 2 && Number(v.b.current.price) === 31,
    '…and version 2 is current at the new price', JSON.stringify(v.b.current));
  const v1 = (v.b.versions || []).find((x) => x.version_no === 1);
  t.ok(v1 && v1.valid_to !== null && Number(v1.price) === 24,
    '⚠️ version 1 is CLOSED, not deleted — the old price is still answerable', JSON.stringify(v1));

  // ── 4 · status is one of the six, deliberately ────────────────────────────────────────────────────────────────
  const st = await P.j('/api/products/' + id + '/status', { method: 'PUT', ...auth,
    body: { status: 'unavailable', until: '2026-09-01' } });
  t.ok(st.status === 200, 'the item is marked unavailable', 'status ' + st.status + ' ' + JSON.stringify(st.b).slice(0, 160));
  v = await P.j('/api/products/' + id + '/versions', auth);
  t.ok(v.b.count === 3, '⭐ going out of stock cuts version 3 — status changes what can be ordered',
    'count ' + v.b.count);

  // ── 5 · AS-OF — the question the table exists for ─────────────────────────────────────────────────────────────
  const asof = await P.j('/api/products/' + id + '/versions?at=' + encodeURIComponent(v1_at), auth);
  t.ok(asof.b.version && asof.b.version.version_no === 1 && Number(asof.b.version.price) === 24,
    '⭐ as-of the moment it was created, the item reads back at its ORIGINAL price',
    JSON.stringify(asof.b.version));
  t.ok(asof.b.version && asof.b.version.snapshot && asof.b.version.snapshot.desc === 'first',
    '…and the snapshot carries the whole row, not only the six fields',
    String(JSON.stringify((asof.b.version || {}).snapshot)).slice(0, 200));

  const future = await P.j('/api/products/' + id + '/versions?at='
    + encodeURIComponent(new Date(Date.now() + 86400000).toISOString()), auth);
  t.ok(future.b.version && future.b.version.version_no === 3, 'as-of tomorrow returns the CURRENT version',
    JSON.stringify(future.b.version));

  // ── 6 · isolation ─────────────────────────────────────────────────────────────────────────────────────────────
  const other = await P.signIn('vero' + stamp + '@proof.test', 'Other Co ' + stamp);
  const peek = await P.j('/api/products/' + id + '/versions', { token: other });
  t.ok(peek.status === 404, '⚠️ another entity cannot read this history — 404, not an empty list',
    'status ' + peek.status + ' ' + JSON.stringify(peek.b).slice(0, 160));
});
