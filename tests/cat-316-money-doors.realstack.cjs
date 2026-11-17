'use strict';
/**
 * tests/cat-316-money-doors.realstack.cjs — CAT-316 / CAT-317 / CAT-318 on a REAL Postgres, the api running as cb_app (RLS on), every write through the doors.
 *
 * CAT-317  POST /api/products/:id/schedule judges the item it would leave behind with the SAME validator PATCH answers to
 *   S-1  a parked price of -5 · 1e18 · "abc" · a status "banana" · a 5000-character name is refused (4xx, never a 200), and nothing is parked
 *   S-2  a valid parked change is still accepted (price 70 parks)
 *   S-3  DEFERRED APPLY: a parked change that is not valid when it comes due (planted as a parked row, then made due) is NOT applied: the live price stays 60, the row is cancelled (applied_rows 0)
 *   S-4  a valid parked change that comes due IS applied (the control for S-3), and a parked status is stamped when it lands
 * CAT-316  every door that writes a status refuses an unknown word, and a changed one is recorded by itemstatus.stamp
 *   D-1  PATCH merge · PATCH replace · POST · POST /bulk · POST /bulk-update with status "banana" are refused with a sentence; the stored status is unchanged / nothing is created
 *   D-2  a valid change through PATCH merge and through bulk-update is stamped like PUT /:id/status (status_at · status_schema_org)
 *   D-3  (CAT-323) an item holding a legacy word ("approved") can still have its name edited (200); setting "banana" is still refused
CAT-318  the storefront order refuses a price that is not zero-or-more
 *   O-1  an order for 2 of a product whose live price is -5 (bare, or { amount, currency }) is a 422 ORDER_REJECTED with a plain sentence, no chit, no total
 *   O-2  the same order at a valid price is placed (control)
 * Run: API_BASE=http://127.0.0.1:3197 DATABASE_URL=postgres://cb_app:cblocal@127.0.0.1:55432/cb_local node tests/cat-316-money-doors.realstack.cjs   (CI: the S41 job's api on :3000, cb_app)
 * CARD      06-catalogue-pim/README
 */
const url = process.env.DATABASE_URL || '';
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts || parts[1] !== 'cb_app' || !/^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/.test(parts[2])) { console.error('REFUSED: needs DATABASE_URL as cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
const H = require('./lib/truth-harness.cjs');
const { withEntity } = require('../db');
const { j, ok, kase, expect, freshShop, CUSTOMER_OTP } = H;
const RUN = 'c316' + (Date.now() % 1e9).toString(36);

const stored = (shop, id) => withEntity(shop.entity, async (db) => (await db.query('SELECT item_data FROM catalogue_items WHERE item_id=$1', [id])).rows[0].item_data);
const amount = (d) => (d.price && typeof d.price === 'object' ? d.price.amount : Number(d.price));
const newProduct = async (shop, extra) => ok(await j('/api/products', { method: 'POST', token: shop.token, body: { item_data: Object.assign({ name: 'Rice ' + RUN, unit: 'piece', price: 60 }, extra || {}) } }), 'product').b.item.item_id;
const park = (shop, id, item_data) => j('/api/products/' + id + '/schedule', { method: 'POST', token: shop.token, body: { effective_at: new Date(Date.now() + 86400e3).toISOString(), item_data } });
const pending = async (shop, id) => ok(await j('/api/products/' + id + '/schedule', { token: shop.token }), 'pending').b.pending;
/** plant a parked row exactly as an older version (or a changed shop) could have left it, already due */
const plantDue = (shop, id, patch) => withEntity(shop.entity, (db) => db.query("INSERT INTO catalogue_item_schedule (entity_id, item_id, effective_at, patch) VALUES ($1,$2, NOW() - interval '1 minute', $3::jsonb) RETURNING schedule_id", [shop.entity, id, JSON.stringify(patch)]));
const makeDue = (shop, sid) => withEntity(shop.entity, (db) => db.query("UPDATE catalogue_item_schedule SET effective_at = NOW() - interval '1 minute' WHERE schedule_id=$1", [sid]));
const row = (shop, sid) => withEntity(shop.entity, async (db) => (await db.query('SELECT applied_at, applied_rows, cancelled_at FROM catalogue_item_schedule WHERE schedule_id=$1', [sid])).rows[0]);
const refused = (r, what) => expect(r.status >= 400 && r.status < 500 && String(r.b.message || r.b.detail || r.b.error || '').trim(), what + ' → HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
const readList = (shop) => j('/api/products', { token: shop.token }); /* a read: parked changes that are due land first */

(async () => {
  console.log('\n── CAT-316/317/318 money doors on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  const A = await freshShop(RUN, 'Money doors');
  const P = await newProduct(A);

  await kase('S-1', 'a parked -5 · 1e18 · "abc" · status "banana" · 5000-character name is refused and nothing is parked', async () => {
    for (const [k, v] of [['price', -5], ['price', 1e18], ['price', 'abc'], ['status', 'banana'], ['name', 'x'.repeat(5000)]]) {
      refused(await park(A, P, { [k]: v }), 'schedule ' + k + '=' + String(v).slice(0, 12));
    }
    expect((await pending(A, P)).length === 0, 'something was parked: ' + JSON.stringify(await pending(A, P)).slice(0, 200));
  });
  await kase('S-2', 'a valid parked price is accepted', async () => {
    const r = await park(A, P, { price: 70 });
    expect(r.status === 200 && r.b.scheduled, 'HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
    await withEntity(A.entity, (db) => db.query('UPDATE catalogue_item_schedule SET cancelled_at = NOW() WHERE item_id=$1 AND applied_at IS NULL', [P]));
  });
  await kase('S-3', 'DEFERRED: a parked -5 that comes due is not applied; the price stays 60 and the row is cancelled', async () => {
    const sid = (await plantDue(A, P, { price: { amount: -5, currency: 'INR' } })).rows[0].schedule_id;
    ok(await readList(A), 'read (applies what is due)');
    const d = await stored(A, P), r = await row(A, sid);
    expect(amount(d) === 60, 'live price is now ' + JSON.stringify(d.price));
    expect(!r.applied_at && r.cancelled_at && r.applied_rows === 0, 'schedule row ' + JSON.stringify(r));
  });
  await kase('S-3b', 'DEFERRED: a parked status "banana" that comes due is not applied either', async () => {
    const sid = (await plantDue(A, P, { status: 'banana' })).rows[0].schedule_id;
    ok(await readList(A), 'read');
    const d = await stored(A, P), r = await row(A, sid);
    expect(d.status !== 'banana' && !r.applied_at && r.cancelled_at, 'status ' + d.status + ' · row ' + JSON.stringify(r));
  });
  await kase('S-4', 'a valid parked change that comes due is applied, and a parked status is stamped as it lands', async () => {
    const r1 = await park(A, P, { price: 75 }), r2 = await park(A, P, { status: 'unavailable' });
    expect(r1.status === 200 && r2.status === 200, 'park ' + r1.status + ' ' + r2.status);
    await makeDue(A, r1.b.scheduled.schedule_id); await makeDue(A, r2.b.scheduled.schedule_id);
    ok(await readList(A), 'read');
    const d = await stored(A, P);
    expect(amount(d) === 75 && d.price.currency === 'INR', 'price ' + JSON.stringify(d.price));
    expect(d.status === 'unavailable' && d.status_at && d.status_schema_org, 'status stamp ' + JSON.stringify({ s: d.status, at: d.status_at, so: d.status_schema_org }));
  });

  await kase('D-1', 'PATCH merge · PATCH replace · POST · POST /bulk · POST /bulk-update with status "banana" are refused; nothing changes or is created', async () => {
    const id = await newProduct(A, { name: 'Dal ' + RUN });
    const before = JSON.stringify(await stored(A, id));
    refused(await j('/api/products/' + id, { method: 'PATCH', token: A.token, body: { merge: true, item_data: { status: 'banana' } } }), 'PATCH merge');
    refused(await j('/api/products/' + id, { method: 'PATCH', token: A.token, body: { item_data: { name: 'Dal ' + RUN, price: 60, status: 'banana' } } }), 'PATCH replace');
    refused(await j('/api/products', { method: 'POST', token: A.token, body: { item_data: { name: 'Banana ' + RUN, price: 5, status: 'banana' } } }), 'POST');
    refused(await j('/api/products/bulk', { method: 'POST', token: A.token, body: { items: [{ name: 'Banana b ' + RUN, price: 5, status: 'banana' }] } }), 'POST /bulk');
    refused(await j('/api/products/bulk-update', { method: 'POST', token: A.token, body: { items: [{ id, item_data: { name: 'Dal ' + RUN, price: 60, status: 'banana' } }] } }), 'POST /bulk-update');
    expect(JSON.stringify(await stored(A, id)) === before, 'the stored product changed: ' + JSON.stringify(await stored(A, id)).slice(0, 200));
    const made = await withEntity(A.entity, (db) => db.query("SELECT count(*)::int AS n FROM catalogue_items WHERE entity_id=$1 AND item_data->>'name' LIKE $2", [A.entity, 'Banana%' + RUN]));
    expect(made.rows[0].n === 0, made.rows[0].n + ' banana product(s) were created');
  });
  await kase('D-2', 'a valid status through PATCH merge and bulk-update is stamped like PUT /:id/status; a redundant with no replaced_by is refused', async () => {
    const id = await newProduct(A, { name: 'Tea ' + RUN }), id2 = await newProduct(A, { name: 'Sugar ' + RUN });
    ok(await j('/api/products/' + id, { method: 'PATCH', token: A.token, body: { merge: true, item_data: { status: 'unavailable', status_until: '2030-01-31' } } }), 'PATCH merge');
    const d = await stored(A, id);
    expect(d.status === 'unavailable' && d.status_at && d.status_until === '2030-01-31' && d.status_schema_org, 'PATCH ' + JSON.stringify(d).slice(0, 300));
    ok(await j('/api/products/bulk-update', { method: 'POST', token: A.token, body: { items: [{ id: id2, item_data: { name: 'Sugar ' + RUN, price: 60, status: 'retired' } }] } }), 'bulk-update');
    const e = await stored(A, id2);
    expect(e.status === 'retired' && e.status_at && e.status_schema_org, 'bulk-update ' + JSON.stringify(e).slice(0, 300));
    refused(await j('/api/products/' + id, { method: 'PATCH', token: A.token, body: { merge: true, item_data: { status: 'redundant' } } }), 'redundant with no replaced_by');
  });

  await kase('D-3', 'CAT-323: an item holding a legacy status word ("approved", raw insert) can still be edited on another field; setting an unknown word is still refused', async () => {
    const id = await newProduct(A, { name: 'Legacy ' + RUN });
    await withEntity(A.entity, (db) => db.query("UPDATE catalogue_items SET item_data = item_data || '{\"status\": \"approved\"}'::jsonb WHERE item_id=$1", [id]));
    const r = await j('/api/products/' + id, { method: 'PATCH', token: A.token, body: { merge: true, item_data: { name: 'Legacy renamed ' + RUN } } });
    expect(r.status === 200, 'PATCH name on a legacy-status item: HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
    const d = await stored(A, id);
    expect(d.name === 'Legacy renamed ' + RUN && d.status === 'approved', 'stored ' + JSON.stringify(d).slice(0, 200));
    const r2 = await j('/api/products/' + id, { method: 'PATCH', token: A.token, body: { item_data: { name: 'Legacy again ' + RUN, price: 60 } } });
    expect(r2.status === 200, 'PATCH replace without a status: HTTP ' + r2.status);
    await withEntity(A.entity, (db) => db.query("UPDATE catalogue_items SET item_data = item_data || '{\"status\": \"approved\"}'::jsonb WHERE item_id=$1", [id])); /* the replace above (no status) erased the legacy word: plant it again */
    const rb = await j('/api/products/bulk-update', { method: 'POST', token: A.token, body: { items: [{ id, item_data: { name: 'Legacy bulk ' + RUN, price: 60, status: 'approved' } }] } });
    expect(rb.status === 200, 'bulk-update resending the legacy word: HTTP ' + rb.status + ' ' + JSON.stringify(rb.b).slice(0, 200));
    refused(await j('/api/products/' + id, { method: 'PATCH', token: A.token, body: { merge: true, item_data: { status: 'banana' } } }), 'status banana on the same item');
    expect((await stored(A, id)).status !== 'banana', 'banana was stored');
  });

  const door = '/api/catalogue/' + A.bridge, email = RUN + '-c@local.test';
  await kase('O-1', 'a storefront order for 2 at a live price of -5 (bare or stamped) is refused in words; no chit', async () => {
    const bare = await newProduct(A, { name: 'Bare ' + RUN }), stamped = await newProduct(A, { name: 'Stamped ' + RUN });
    await withEntity(A.entity, async (db) => {
      await db.query('UPDATE catalogue_items SET item_data = item_data || \'{"price": -5}\'::jsonb WHERE item_id=$1', [bare]);
      await db.query('UPDATE catalogue_items SET item_data = item_data || \'{"price": {"amount": -5, "currency": "INR"}}\'::jsonb WHERE item_id=$1', [stamped]);
    });
    for (const id of [bare, stamped]) {
      ok(await j(door + '/order/start', { method: 'POST', body: { email, name: 'Money Door' } }), 'order start');
      const r = await j(door + '/order/confirm', { method: 'POST', body: { email, otp: CUSTOMER_OTP, line_items: [{ item_id: id, quantity: 2 }] } });
      expect(r.status === 422 && r.b.code === 'ORDER_REJECTED' && /price/i.test(r.b.message || r.b.detail || ''), 'HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 240));
      expect(!r.b.chit_id && r.b.total === undefined, 'an order came back: ' + JSON.stringify(r.b).slice(0, 200));
    }
  });
  await kase('O-2', 'the same order at a valid price is placed (control)', async () => {
    const good = await newProduct(A, { name: 'Good ' + RUN });
    ok(await j(door + '/order/start', { method: 'POST', body: { email, name: 'Money Door' } }), 'order start');
    const r = await j(door + '/order/confirm', { method: 'POST', body: { email, otp: CUSTOMER_OTP, line_items: [{ item_id: good, quantity: 2 }] } });
    expect(r.status === 200 && r.b.chit_id, 'HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 240));
  });

  H.finish('CAT-316/317/318 money doors');
})().catch((e) => { console.error(e); process.exit(1); });
