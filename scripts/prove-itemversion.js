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
 * Run: node scripts/prove-itemversion.js
 */
const P = require('./_proof');

P.run('b146 · catalogue_item_version', async (t) => {
  const stamp = String(process.hrtime.bigint()).slice(-9);
  const email = 'ver' + stamp + '@proof.test';
  const token = await P.signIn(email, 'Version Proof ' + stamp);
  if (!token) throw new Error('could not sign in');
  const auth = { token };

  // ── 1 · a new item gets version 1 ─────────────────────────────────────────────────────────────────────────────
  const made = await P.j('/api/products', { method: 'POST', ...auth,
    body: { item_data: { name: 'Paracetamol 500', unit: 'strip', price: 24, sku: 'MED-500', desc: 'first' } } });
  t.ok('a product is created', made.status === 200 || made.status === 201, 'status ' + made.status + ' ' + JSON.stringify(made.b).slice(0, 200));
  const id = made.b && (made.b.item_id || (made.b.item || {}).item_id);
  if (!id) throw new Error('no item_id came back: ' + JSON.stringify(made.b).slice(0, 300));

  let v = await P.j('/api/products/' + id + '/versions', auth);
  if (v.status === 503) throw new Error('b146 is NOT applied on this environment — ' + (v.b && v.b.message));
  t.ok('the trigger cut version 1 on INSERT, with no application code involved', v.b.count === 1, JSON.stringify(v.b).slice(0, 300));
  t.ok('…and it is the current one', v.b.current && v.b.current.version_no === 1 && v.b.current.valid_to === null);
  t.ok('…carrying the price it was created with', Number(v.b.current.price) === 24, 'price ' + (v.b.current || {}).price);

  const v1_at = v.b.current.valid_from;

  // ── 2 · ⚠️ THE NEGATIVE CASE — a change outside the six fields must cut NOTHING ────────────────────────────────
  await P.j('/api/products/' + id, { method: 'PUT', ...auth,
    body: { item_data: { name: 'Paracetamol 500', unit: 'strip', price: 24, sku: 'MED-500', desc: 'CHANGED — description only' } } });
  v = await P.j('/api/products/' + id + '/versions', auth);
  t.ok('⭐ a description-only edit cuts NO version — this is the brake the whole design rests on',
    v.b.count === 1, 'count ' + v.b.count + ' (a version per write is the 4.4M-rows-a-year failure)');

  // ── 3 · a REPRICE is a real change ────────────────────────────────────────────────────────────────────────────
  await P.j('/api/products/' + id, { method: 'PUT', ...auth,
    body: { item_data: { name: 'Paracetamol 500', unit: 'strip', price: 31, sku: 'MED-500', desc: 'CHANGED — description only' } } });
  v = await P.j('/api/products/' + id + '/versions', auth);
  t.ok('⭐ a reprice cuts version 2', v.b.count === 2, 'count ' + v.b.count);
  t.ok('…and version 2 is current at the new price',
    v.b.current && v.b.current.version_no === 2 && Number(v.b.current.price) === 31, JSON.stringify(v.b.current));
  const v1 = v.b.versions.find((x) => x.version_no === 1);
  t.ok('⚠️ version 1 is CLOSED, not deleted — the old price is still answerable',
    v1 && v1.valid_to !== null && Number(v1.price) === 24, JSON.stringify(v1));

  // ── 4 · status is one of the six, deliberately ────────────────────────────────────────────────────────────────
  const st = await P.j('/api/products/' + id + '/status', { method: 'PUT', ...auth, body: { status: 'unavailable', until: '2026-09-01' } });
  t.ok('the item is marked unavailable', st.status === 200, 'status ' + st.status);
  v = await P.j('/api/products/' + id + '/versions', auth);
  t.ok('⭐ going out of stock cuts version 3 — status changes what can be ordered, so it is a real change',
    v.b.count === 3, 'count ' + v.b.count);

  // ── 5 · AS-OF — the question the table exists for ─────────────────────────────────────────────────────────────
  const asof = await P.j('/api/products/' + id + '/versions?at=' + encodeURIComponent(v1_at), auth);
  t.ok('⭐ as-of the moment it was created, the item reads back at its ORIGINAL price',
    asof.b.version && asof.b.version.version_no === 1 && Number(asof.b.version.price) === 24,
    JSON.stringify(asof.b.version));
  t.ok('…and the as-of snapshot carries the whole row, not just the six fields',
    asof.b.version && asof.b.version.snapshot && asof.b.version.snapshot.desc === 'first',
    JSON.stringify((asof.b.version || {}).snapshot).slice(0, 200));

  const future = await P.j('/api/products/' + id + '/versions?at=' + encodeURIComponent(new Date(Date.now() + 86400000).toISOString()), auth);
  t.ok('as-of tomorrow returns the CURRENT version', future.b.version && future.b.version.version_no === 3);

  // ── 6 · isolation ─────────────────────────────────────────────────────────────────────────────────────────────
  const other = await P.signIn('vero' + stamp + '@proof.test', 'Other Co ' + stamp);
  const peek = await P.j('/api/products/' + id + '/versions', { token: other });
  t.ok('⚠️ another entity cannot read this item\'s history — 404, not an empty list',
    peek.status === 404, 'status ' + peek.status + ' ' + JSON.stringify(peek.b).slice(0, 160));
});
