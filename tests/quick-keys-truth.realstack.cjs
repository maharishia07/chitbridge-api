'use strict';
/**
 * tests/quick-keys-truth.realstack.cjs — the counter's Quick keys on a REAL Postgres, the api running as cb_app (RLS on).
 *
 * OWNS     what the card says the existing tests do not prove ("they prove refusal and shape, not creating a group, ordering keys, or the screen layout"):
 *          a group is created (201) and listed with its products in key order, keys are added and removed, a reorder is the order the list then reads,
 *          a stale version is refused 409 on edit and on delete, a delete is soft (the row stays, the products stay in the catalogue), the shop's default
 *          screen layout saved by PUT is what GET /screen-config/default reads back, and another shop sees none of it.
 * FLOW     fresh shop S with three products and a second shop X with one → routes only (POST/GET/PATCH/DELETE /api/quick-keys/groups[/..],
 *          PUT/GET /api/quick-keys/screen-config/default); the database is read with SELECT only (quick_key_group, quick_key_group_item, catalogue_items).
 * CARD     09-counter/quick-keys-and-screen-layout
 *
 *   Q-1  create a group: 201, version 1, it is on GET /groups with no keys; a nameless group is refused 400
 *   Q-2  add three products at positions 3, 1, 2: the list reads them 1, 2, 3 (by position); adding one twice keeps one key
 *   Q-3  reorder: PATCH items rewrites the order and the list reads the new order; remove takes one key off and the product stays in the catalogue
 *   Q-4  edit with the right version: version + 1; with a stale version: 409 and nothing written
 *   Q-5  delete (right version) is soft: gone from the list, the row stays with is_deleted, the products stay; a stale version is 409
 *   Q-6  screen layout: PUT the default config, GET reads the same config back
 *   Q-7  another shop: cannot see S's groups, cannot add to, edit, or delete S's group (404)
 *   Q-8  another shop cannot put S's product on its own group (404, nothing written; addItem proves the product is the caller's own)
 *   Q-9  the counter's POST /api/till/quick-keys/hide: S's own product is hidden (1 row); another shop's product and an unknown id answer 200 with `ignored` 1 and write no row (a queued offline replay never wedges, never a 500)
 *   Q-10 hide/unhide `also_counters`: the shop's own second counter is written/removed as before; another shop's counter and an unknown id write nothing, answer 200 and count in `ignored`; unhide deletes only the shop's own
 * CI: picked up by the T2 loop over tests/*-truth.realstack.cjs.
 */
const H = require('./lib/truth-harness.cjs');
const { Client } = require('pg');
const { j, ok, kase, expect, freshShop, finish, DB } = H;
const RUN = 'qk' + (Date.now() % 1e9).toString(36);
const asOwner = async (sql, args) => { const c = new Client({ connectionString: DB }); await c.connect(); try { return (await c.query(sql, args)).rows; } finally { await c.end(); } };
const QK = '/api/quick-keys';
let S, X, G, P = [], XP;
const groups = async (shop) => ok(await j(QK + '/groups', { token: (shop || S).token }), 'list groups').b.groups;
const mine = async (shop, id) => (await groups(shop)).find((g) => g.id === id);
const product = async (shop, name, price) => ok(await j('/api/products', { method: 'POST', token: shop.token, body: { item_data: { name, unit: 'piece', price } } }), 'product ' + name).b.item.item_id;

(async () => {
  console.log('\n── Quick keys on ' + H.API + ' · run ' + RUN + ' ──');
  const au = { country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: 'Australia/Sydney', tax: { registered: false } };
  S = await freshShop(RUN + 's', 'Shop', au);
  X = await freshShop(RUN + 'x', 'Other', au);
  for (const [n, pr] of [['Tea', 20], ['Biscuit', 10], ['Juice', 30]]) P.push(await product(S, n + ' ' + RUN, pr));
  XP = await product(X, 'Foreign ' + RUN, 5);

  await kase('Q-1', 'create a group: 201, version 1, listed with no keys; a nameless group is 400', async () => {
    const r = await j(QK + '/groups', { method: 'POST', token: S.token, body: { name: 'Morning ' + RUN, color: '#aa5500', sort_order: 1 } });
    expect(r.status === 201 && r.b.group && r.b.group.id, 'HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 300));
    G = r.b.group.id;
    const g = await mine(S, G);
    expect(g && Number(g.version) === 1 && g.items.length === 0 && g.name === 'Morning ' + RUN, 'listed as: ' + JSON.stringify(g));
    const bad = await j(QK + '/groups', { method: 'POST', token: S.token, body: { name: '   ' } });
    expect(bad.status === 400, 'a blank name: HTTP ' + bad.status + ' ' + JSON.stringify(bad.b).slice(0, 200));
  });
  await kase('Q-2', 'three products at positions 3, 1, 2 read back 1, 2, 3; adding one twice keeps one key', async () => {
    for (const [i, pos] of [[0, 3], [1, 1], [2, 2]]) {
      const r = await j(QK + '/groups/' + G + '/items', { method: 'POST', token: S.token, body: { product_id: P[i], position: pos } });
      expect(r.status === 201, 'add ' + i + ': HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
    }
    const dup = await j(QK + '/groups/' + G + '/items', { method: 'POST', token: S.token, body: { product_id: P[0], position: 3 } });
    expect(dup.status === 201, 'the same product again: HTTP ' + dup.status);
    const g = await mine(S, G);
    expect(g.items.map((x) => x.product_id).join() === [P[1], P[2], P[0]].join(), 'order: ' + JSON.stringify(g.items.map((x) => [x.name, x.position])));
    expect(g.items.length === 3, 'a duplicate key was made: ' + g.items.length);
    /* the key's price is the catalogue's own money value as text (item_data->>'price' is the JSON of {amount,currency}, lib/quick-keys.js listGroups): read as it is */
    const pr = JSON.parse(g.items[0].price);
    expect(g.items[0].name === 'Biscuit ' + RUN && Number(pr.amount) === 10 && pr.currency === 'AUD', 'the key shows the product name and its price: ' + JSON.stringify(g.items[0]));
  });
  await kase('Q-3', 'reorder rewrites the order; remove takes a key off and the product stays in the catalogue', async () => {
    const re = await j(QK + '/groups/' + G + '/items', { method: 'PATCH', token: S.token, body: { items: [{ product_id: P[0], position: 1 }, { product_id: P[1], position: 2 }, { product_id: P[2], position: 3 }] } });
    expect(re.status === 200 && re.b.ok === true, 'reorder: HTTP ' + re.status + ' ' + JSON.stringify(re.b).slice(0, 200));
    expect((await mine(S, G)).items.map((x) => x.product_id).join() === P.join(), 'the list does not read the new order');
    const rm = await j(QK + '/groups/' + G + '/items/' + P[1], { method: 'DELETE', token: S.token });
    expect(rm.status === 200 && rm.b.removed === true, 'remove: HTTP ' + rm.status + ' ' + JSON.stringify(rm.b).slice(0, 200));
    expect((await mine(S, G)).items.map((x) => x.product_id).join() === [P[0], P[2]].join(), 'the key is still on the group');
    const still = await asOwner('SELECT count(*)::int AS n FROM catalogue_items WHERE item_id = $1', [P[1]]);
    expect(Number(still[0].n) === 1, 'removing the key deleted the product');
    const again = await j(QK + '/groups/' + G + '/items/' + P[1], { method: 'DELETE', token: S.token });
    expect(again.status === 200 && again.b.removed === false, 'removing a key that is not there says so: ' + JSON.stringify(again.b));
  });
  await kase('Q-4', 'edit with the right version bumps it; a stale version is 409 and writes nothing', async () => {
    const ok1 = await j(QK + '/groups/' + G, { method: 'PATCH', token: S.token, body: { version: 1, name: 'Breakfast ' + RUN } });
    expect(ok1.status === 200 && Number(ok1.b.group.version) === 2 && ok1.b.group.name === 'Breakfast ' + RUN, 'HTTP ' + ok1.status + ' ' + JSON.stringify(ok1.b).slice(0, 300));
    const stale = await j(QK + '/groups/' + G, { method: 'PATCH', token: S.token, body: { version: 1, name: 'Lost update ' + RUN } });
    expect(stale.status === 409, 'stale: HTTP ' + stale.status + ' ' + JSON.stringify(stale.b).slice(0, 200));
    expect((await mine(S, G)).name === 'Breakfast ' + RUN, 'the stale edit wrote');
  });
  await kase('Q-5', 'delete is soft: off the list, the row and the products stay; a stale version is refused', async () => {
    const stale = await j(QK + '/groups/' + G, { method: 'DELETE', token: S.token, body: { version: 1 } });
    expect(stale.status === 409, 'stale delete: HTTP ' + stale.status + ' ' + JSON.stringify(stale.b).slice(0, 200));
    expect(!!(await mine(S, G)), 'a stale delete removed the group');
    const del = await j(QK + '/groups/' + G, { method: 'DELETE', token: S.token, body: { version: 2 } });
    expect(del.status === 200, 'delete: HTTP ' + del.status + ' ' + JSON.stringify(del.b).slice(0, 200));
    expect(!(await mine(S, G)), 'the deleted group is still listed');
    const row = await asOwner('SELECT is_deleted FROM quick_key_group WHERE id = $1', [G]);
    expect(row.length === 1 && row[0].is_deleted === true, 'the row is gone or not flagged: ' + JSON.stringify(row));
    const prods = await asOwner('SELECT count(*)::int AS n FROM catalogue_items WHERE item_id = ANY($1::uuid[])', [P]);
    expect(Number(prods[0].n) === 3, 'a deleted group took products with it');
    const gone = await j(QK + '/groups/' + G, { method: 'DELETE', token: S.token, body: { version: 3 } });
    expect(gone.status === 404, 'a deleted group deleted again: HTTP ' + gone.status);
  });
  await kase('Q-6', 'the shop\'s default screen layout saved by PUT is what GET reads back', async () => {
    const cfg = { columns: 4, key_size: 'large', note: RUN };
    const put = await j(QK + '/screen-config/default', { method: 'PUT', token: S.token, body: { config: cfg } });
    expect(put.status === 200, 'PUT: HTTP ' + put.status + ' ' + JSON.stringify(put.b).slice(0, 200));
    const get = await j(QK + '/screen-config/default', { token: S.token });
    expect(get.status === 200 && JSON.stringify(Object.entries(get.b.config).sort()) === JSON.stringify(Object.entries(cfg).sort()), 'GET: HTTP ' + get.status + ' ' + JSON.stringify(get.b).slice(0, 300));
    const other = await j(QK + '/screen-config/default', { token: X.token });
    expect(other.status === 200 && JSON.stringify(other.b.config || {}) === '{}', "X reads S's layout: " + JSON.stringify(other.b).slice(0, 200));
  });
  await kase('Q-7', "another shop cannot see, add to, edit or delete S's group", async () => {
    const g2 = ok(await j(QK + '/groups', { method: 'POST', token: S.token, body: { name: 'Second ' + RUN } }), 'second group').b.group;
    expect((await groups(X)).every((g) => g.id !== g2.id), "X's list shows S's group");
    const add = await j(QK + '/groups/' + g2.id + '/items', { method: 'POST', token: X.token, body: { product_id: XP } });
    expect(add.status === 404, 'add to S\'s group: HTTP ' + add.status);
    const edit = await j(QK + '/groups/' + g2.id, { method: 'PATCH', token: X.token, body: { name: 'stolen' } });
    expect(edit.status === 404, 'edit: HTTP ' + edit.status);
    const del = await j(QK + '/groups/' + g2.id, { method: 'DELETE', token: X.token, body: {} });
    expect(del.status === 404, 'delete: HTTP ' + del.status);
  });
  await kase('Q-8', "another shop cannot put S's product on its own group (the product is not X's)", async () => {
    const xg = ok(await j(QK + '/groups', { method: 'POST', token: X.token, body: { name: 'Mine ' + RUN } }), 'X group').b.group;
    const foreign = await j(QK + '/groups/' + xg.id + '/items', { method: 'POST', token: X.token, body: { product_id: P[0] } });
    expect(foreign.status === 404, "X put S's product on its own group: HTTP " + foreign.status + ' ' + JSON.stringify(foreign.b).slice(0, 200));
    const left = await asOwner('SELECT count(*)::int AS n FROM quick_key_group_item WHERE group_id = $1', [xg.id]);
    expect(Number(left[0].n) === 0, "S's product sits on X's group in the database");
  });
  await kase('Q-9', "hide: only the shop's own product is written; a foreign or unknown id is ignored with 200, never a 500", async () => {
    const c = ok(await j('/api/counters', { method: 'POST', token: S.token, body: { name: 'Hide ' + RUN } }), 'make counter').b.counter;
    const key = ok(await j('/api/counters/' + c.id + '/open', { method: 'POST', token: S.token }), 'open counter').b.key;
    const HIDE = '/api/till/quick-keys/hide';
    const rows = async (pid) => Number((await asOwner('SELECT count(*)::int AS n FROM counter_hidden_item WHERE product_id::text = $1', [pid]))[0].n);
    const own = await j(HIDE, { method: 'POST', token: key, body: { product_id: P[0] } });
    expect(own.status === 200 && own.b.hidden.length === 1 && own.b.ignored === 0, 'own product: HTTP ' + own.status + ' ' + JSON.stringify(own.b).slice(0, 200));
    const again = await j(HIDE, { method: 'POST', token: key, body: { product_id: P[0] } });
    expect(again.status === 200 && again.b.hidden.length === 1 && (await rows(P[0])) === 1, 'a replay is one row: HTTP ' + again.status);
    const foreign = await j(HIDE, { method: 'POST', token: key, body: { product_id: XP } });
    expect(foreign.status === 200 && foreign.b.ignored === 1 && foreign.b.hidden.length === 0, "X's product: HTTP " + foreign.status + ' ' + JSON.stringify(foreign.b).slice(0, 200));
    expect((await rows(XP)) === 0, "X's product was written to S's hidden list");
    for (const bad of ['00000000-0000-4000-8000-000000000000', 'not-a-uuid']) {
      const r = await j(HIDE, { method: 'POST', token: key, body: { product_id: bad } });
      expect(r.status === 200 && r.b.ignored === 1 && r.b.hidden.length === 0, 'unknown id ' + bad + ': HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
    }
  });
  await kase('Q-10', "hide/unhide also_counters: only the shop's own counters are written or deleted; foreign ones are ignored with 200", async () => {
    const mk = async (shop, name) => ok(await j('/api/counters', { method: 'POST', token: shop.token, body: { name } }), 'make counter ' + name).b.counter;
    const c1 = await mk(S, 'Qa ' + RUN), c2 = await mk(S, 'Qb ' + RUN);
    let xc;
    for (let i = 0; i < 5; i++) xc = await mk(X, 'Qx' + i + ' ' + RUN); /* counter ids are per shop (C1, C2..): take one X has and S lacks */
    const key = ok(await j('/api/counters/' + c1.id + '/open', { method: 'POST', token: S.token }), 'open counter').b.key;
    const HIDE = '/api/till/quick-keys/hide', UNHIDE = '/api/till/quick-keys/unhide';
    const on = async (cid) => Number((await asOwner('SELECT count(*)::int AS n FROM counter_hidden_item WHERE product_id::text = $1 AND counter_id = $2', [P[1], String(cid)]))[0].n);
    const h = await j(HIDE, { method: 'POST', token: key, body: { product_id: P[1], also_counters: [c2.id, xc.id, 'NOPE-' + RUN] } });
    expect(h.status === 200 && h.b.hidden.length === 2 && h.b.ignored === 2, 'hide: HTTP ' + h.status + ' ' + JSON.stringify(h.b).slice(0, 300));
    expect((await on(c2.id)) === 1 && (await on(xc.id)) === 0 && (await on('NOPE-' + RUN)) === 0, 'own second counter written, foreign and unknown not');
    await asOwner("INSERT INTO counter_hidden_item (entity_id, counter_id, product_id) SELECT entity_id, $2, product_id FROM counter_hidden_item WHERE product_id::text = $1 LIMIT 1", [P[1], String(xc.id)]);
    const u = await j(UNHIDE, { method: 'POST', token: key, body: { product_id: P[1], also_counters: [c2.id, xc.id] } });
    expect(u.status === 200 && u.b.removed === 2, 'unhide: HTTP ' + u.status + ' ' + JSON.stringify(u.b).slice(0, 200));
    expect((await on(c2.id)) === 0 && (await on(c1.id)) === 0, 'own rows removed');
    expect((await on(xc.id)) === 1, 'unhide deleted a row of a counter that is not the shops');
  });
  finish('quick-keys', process.env.TRUTH_JSON);
})().catch((e) => { console.error(e); process.exit(1); });
