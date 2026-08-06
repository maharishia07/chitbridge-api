#!/usr/bin/env node
/**
 * dept-store-demo.js — Athi's departmental store, walked.
 *
 * *"A departmental store has N product lines like clothing, medicine and so on. Each department will have its own
 * entity and catalogue and business model. The consumer, when they browse the network, sees all of it and can
 * search… If there are internal departments where the entity is protected, those catalogues will not be visible
 * outside — but the entities within the network CAN see those. They are like their warehouse."*
 *
 *                         DEPT STORE  (the network root)
 *                              │
 *        ┌───────────────┬─────┴────────┬──────────────────┐
 *     Clothing        Pharmacy       Grocery            Warehouse
 *     public          public         public             NETWORK-only
 *
 * ── TWO PHASES, ON PURPOSE ─────────────────────────────────────────────────────────────────────────────────────
 * Network WRITES are 503 behind NETWORK_WRITE_ENABLED, and I am not turning that on to run a demo — it would open
 * every cb_* mutation on a live server for the sake of five rows. So:
 *
 *   RUN 1  creates the five entities through the ordinary app API, sets their visibility, and PRINTS the one SQL
 *          statement that places them on the network tree.
 *   YOU    run that SQL.
 *   RUN 2  same command — it sees the membership and walks the whole matrix.
 *
 * Idempotent: register is create-or-reuse, so re-running never duplicates anything.
 *
 *   node scripts/dept-store-demo.js
 */
'use strict';

const API = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
const OTP = process.env.DEV_OTP || '123456';

let pass = 0, fail = 0;
const ok   = (c, cond, d) => { if (cond) { console.log('   ✓ ' + c + (d ? '  ' + d : '')); pass++; } else { console.log('   ✗ ' + c + (d ? '  ' + d : '')); fail++; } };
const note = (s) => console.log('     ' + s);
const step = (n, s) => console.log('\n── ' + n + ' · ' + s + ' ' + '─'.repeat(Math.max(0, 68 - s.length)));

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(API + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}
async function shop(key, name) {
  const email = `dept-${key}@test-cb.com`;
  await api('/api/entities/register', { method: 'POST', body: { email, display_name: name } });
  const v = await api('/api/entities/verify', { method: 'POST', body: { email, otp: OTP } });
  const token = (v.json || {}).token;
  const me = await api('/api/entities/me', { token });
  const e = (me.json && (me.json.entity || me.json)) || {};
  return { key, name, email, token, bridge: e.bridge_id, id: e.identity_id, vis: e.catalogue_visibility };
}

const DEPTS = [
  { key: 'clothing', name: 'DeptStore · Clothing',  vis: 'public',  product: 'Cotton Shirt',   price: 899 },
  { key: 'pharmacy', name: 'DeptStore · Pharmacy',  vis: 'public',  product: 'Paracetamol 500', price: 32 },
  { key: 'grocery',  name: 'DeptStore · Grocery',   vis: 'public',  product: 'Basmati Rice 5kg', price: 640 },
  { key: 'warehouse', name: 'DeptStore · Warehouse', vis: 'network', product: 'Pallet — mixed stock', price: 14500 },
];

(async () => {
  console.log('\n╔' + '═'.repeat(70) + '╗');
  console.log('║  DEPARTMENTAL STORE — public · network · private, walked            ║');
  console.log('╚' + '═'.repeat(70) + '╝');
  console.log('  ' + API);

  // ── 1 · the store and its departments ──────────────────────────────────────────────────────────────────────
  step(1, 'the store and its four departments');
  const STORE = await shop('store', 'DeptStore (network)');
  const made = [];
  for (const d of DEPTS) made.push(Object.assign(await shop(d.key, d.name), { want: d.vis, product: d.product, price: d.price }));
  ok('all five entities exist', !!STORE.bridge && made.every((m) => m.bridge));
  note(`network root: ${STORE.name}  ${STORE.bridge}`);
  made.forEach((m) => note(`  ${m.name.padEnd(26)} ${m.bridge}  → wants ${m.want}`));

  // ── 2 · one product each, and the visibility each one wants ────────────────────────────────────────────────
  step(2, 'give each department a product and its visibility');
  for (const m of made) {
    await api('/api/schemas/create-default', { method: 'POST', token: m.token });
    await api('/api/schemas/visibility', { method: 'PATCH', token: m.token, body: { visibility: 'public' } });
    const list = await api('/api/products', { token: m.token });
    if (!((list.json && list.json.items) || []).length) {
      await api('/api/products', { method: 'POST', token: m.token,
        body: { item_data: { name: m.product, unit: 'each', price: m.price } } });
    }
    const r = await api('/api/entities/profile', { method: 'PATCH', token: m.token, body: { catalogue_visibility: m.want } });
    ok(`${m.name} → ${m.want}`, r.status === 200, r.status === 200 ? '' : JSON.stringify(r.json));
  }

  // ── 3 · are they on the network tree yet? ──────────────────────────────────────────────────────────────────
  step(3, 'network membership');
  const wh = made.find((m) => m.key === 'warehouse');
  const clothing = made.find((m) => m.key === 'clothing');
  // A member reading the warehouse proves membership resolves; nothing else can tell us from outside.
  const sup = await api('/api/relationships/suppliers', { method: 'POST', token: clothing.token, body: { supplier_bridge_id: wh.bridge } });
  const sups = await api('/api/relationships/suppliers', { token: clothing.token });
  const row = ((sups.json && (sups.json.suppliers || sups.json)) || []).find((x) => x.bridge_id === wh.bridge);
  const viaMember = row ? await api('/api/relationships/suppliers/' + row.supplier_entity_id + '/catalogue', { token: clothing.token }) : { json: {} };
  const memberSees = (((viaMember.json || {}).items) || []).length > 0;

  if (!memberSees) {
    const label = (b) => String(b).toUpperCase().replace(/-/g, '_');
    console.log('\n   ⚠ NOT ON THE NETWORK TREE YET — so `network` correctly resolves to `private` for everyone.');
    console.log('     A membership test that cannot resolve must fail CLOSED, which is what you are seeing.\n');
    console.log('   Run this once in Supabase, then run this script again:\n');
    console.log('   ── SQL ' + '─'.repeat(62));
    console.log(`   BEGIN;`);
    console.log(`   INSERT INTO cb_entity (bridge_id, name, mode, owner_scope, path, claimed)`);
    console.log(`   VALUES`);
    console.log(`     ('${STORE.bridge}', '${STORE.name}', 'b2b', 'entity', '${label(STORE.bridge)}'::ltree, true),`);
    made.forEach((m, i) => {
      const tail = i === made.length - 1 ? '' : ',';
      console.log(`     ('${m.bridge}', '${m.name}', 'b2c', 'entity', '${label(STORE.bridge)}.${label(m.bridge)}'::ltree, true)${tail}`);
    });
    console.log(`   ON CONFLICT (bridge_id) DO UPDATE SET path = EXCLUDED.path;`);
    console.log(`   -- every department hangs under the store, so subpath(path,0,1) is the same for all five`);
    console.log(`   SELECT bridge_id, name, path FROM cb_entity WHERE path <@ '${label(STORE.bridge)}'::ltree;`);
    console.log(`   COMMIT;`);
    console.log('   ' + '─'.repeat(68) + '\n');
    console.log(`   ${pass} proved so far · ${fail} failed · the walk needs the SQL above\n`);
    process.exit(fail ? 1 : 0);
  }
  ok('the departments are on one network tree', true);

  // ── 4 · THE WALK ───────────────────────────────────────────────────────────────────────────────────────────
  step(4, 'THE WALK — who sees what');
  const outsider = await shop('outsider', 'Random Outsider');

  for (const m of made) {
    const anon = await api('/api/catalogue/' + m.bridge);
    const anonSees = anon.status === 200 && ((anon.json.items || []).length > 0);

    // an outsider who added them as a supplier — the ROUTE, without the AUTHORITY
    await api('/api/relationships/suppliers', { method: 'POST', token: outsider.token, body: { supplier_bridge_id: m.bridge } });
    const os = await api('/api/relationships/suppliers', { token: outsider.token });
    const orow = ((os.json && (os.json.suppliers || os.json)) || []).find((x) => x.bridge_id === m.bridge);
    const viaOutsider = orow ? await api('/api/relationships/suppliers/' + orow.supplier_entity_id + '/catalogue', { token: outsider.token }) : { json: {} };
    const outsiderSees = (((viaOutsider.json || {}).items) || []).length > 0;

    // a fellow department — same route, but a member
    let memberSeesThis = false;
    if (m.key !== 'clothing') {
      await api('/api/relationships/suppliers', { method: 'POST', token: clothing.token, body: { supplier_bridge_id: m.bridge } });
      const ms = await api('/api/relationships/suppliers', { token: clothing.token });
      const mrow = ((ms.json && (ms.json.suppliers || ms.json)) || []).find((x) => x.bridge_id === m.bridge);
      const viaM = mrow ? await api('/api/relationships/suppliers/' + mrow.supplier_entity_id + '/catalogue', { token: clothing.token }) : { json: {} };
      memberSeesThis = (((viaM.json || {}).items) || []).length > 0;
    } else memberSeesThis = true;   // itself

    console.log(`   ${m.want.padEnd(8)} ${m.name.padEnd(26)} shopper:${(anonSees ? 'sees' : '—').padEnd(6)} outsider:${(outsiderSees ? 'sees' : '—').padEnd(6)} dept:${memberSeesThis ? 'sees' : '—'}`);

    if (m.want === 'public') {
      ok(`  ${m.key}: public — everyone sees it`, anonSees && outsiderSees && memberSeesThis);
    } else {
      ok(`  ${m.key}: network — the shopper does NOT`, !anonSees);
      ok(`  ${m.key}: network — an OUTSIDER who added them as a supplier does NOT`, !outsiderSees,
        'the supplier link is the route, not the authority');
      ok(`  ${m.key}: network — a fellow DEPARTMENT does`, memberSeesThis, 'the warehouse');
    }
  }

  console.log('\n' + '═'.repeat(72));
  console.log(`  ${pass} proved · ${fail} failed`);
  console.log('═'.repeat(72) + '\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('\n  threw: ' + e.message + '\n'); process.exit(1); });
