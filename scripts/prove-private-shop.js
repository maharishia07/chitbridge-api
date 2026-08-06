#!/usr/bin/env node
/**
 * prove-private-shop.js — make a shop private, open its storefront, and get NOTHING.
 *
 * Athi, 2026-08-06: *"I may not be able to understand it very clearly. What we can do is create a network, create
 * the entities, make the entity private and try to open the store using the storefront — it should say that such
 * entity does not exist. Is it not going to be simple?"*
 *
 * It is simpler, and it is a better test. The platform-scope route proves the OPERATOR CAP; this proves the thing
 * a person can actually see, with no special account and no SQL:
 *
 *     a private shop must be INDISTINGUISHABLE from a shop that was never created.
 *
 * That is a stronger claim than "it is hidden". If a private shop answers differently from a missing one, the two
 * messages are an existence oracle: walk the bridge-id space and you learn which ids are real businesses — the
 * private ones included.
 *
 *   node scripts/prove-private-shop.js
 *
 * Creates two throwaway shops, proves the property, and removes their products.
 */
'use strict';

const API = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
const OTP = process.env.DEV_OTP || '123456';

let pass = 0, fail = 0;
const ok = (c, cond, d) => { if (cond) { console.log('   ✓ ' + c + (d ? '  ' + d : '')); pass++; } else { console.log('   ✗ ' + c + (d ? '  ' + d : '')); fail++; } };
const note = (s) => console.log('     ' + s);
const step = (n, s) => console.log('\n── ' + n + ' · ' + s + ' ' + '─'.repeat(Math.max(0, 70 - s.length)));

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(API + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}
async function mint(email, name) {
  await api('/api/entities/register', { method: 'POST', body: { email, display_name: name } });
  const v = await api('/api/entities/verify', { method: 'POST', body: { email, otp: OTP } });
  const token = (v.json || {}).token;
  const me = await api('/api/entities/me', { token });
  const e = (me.json && (me.json.entity || me.json)) || {};
  return { token, bridge: e.bridge_id };
}

(async () => {
  console.log('\n╔' + '═'.repeat(72) + '╗');
  console.log('║  PRIVATE SHOP — indistinguishable from one that never existed        ║');
  console.log('╚' + '═'.repeat(72) + '╝');
  console.log('  ' + API);

  const s = Date.now().toString().slice(-6);

  // ── 1 · two shops, both with a real product ────────────────────────────────────────────────────────────────
  step(1, 'two shops, each with a product');
  const OPEN   = await mint(`shop-open-${s}@test-cb.com`,   `Open Shop ${s}`);
  const CLOSED = await mint(`shop-closed-${s}@test-cb.com`, `Closed Shop ${s}`);
  ok('both minted', !!OPEN.bridge && !!CLOSED.bridge, `${OPEN.bridge} · ${CLOSED.bridge}`);

  for (const sh of [OPEN, CLOSED]) {
    await api('/api/schemas/create-default', { method: 'POST', token: sh.token });
    await api('/api/schemas/visibility', { method: 'PATCH', token: sh.token, body: { visibility: 'public' } });
    await api('/api/products', { method: 'POST', token: sh.token,
      body: { item_data: { name: 'Cement Bag', unit: 'bag', price: 380 } } });
  }
  note('each shop has one product: Cement Bag ₹380');

  // ── 2 · one open, one closed ───────────────────────────────────────────────────────────────────────────────
  step(2, 'open one, close the other');
  const o1 = await api('/api/entities/profile', { method: 'PATCH', token: OPEN.token,   body: { catalogue_visibility: 'public' } });
  const o2 = await api('/api/entities/profile', { method: 'PATCH', token: CLOSED.token, body: { catalogue_visibility: 'private' } });
  ok('the open shop accepted "public"',  o1.status === 200);
  ok('the closed shop accepted "private"', o2.status === 200);

  // ── 3 · what the WORLD sees ────────────────────────────────────────────────────────────────────────────────
  step(3, 'open each storefront, as a stranger with no account');
  const seeOpen   = await api('/api/catalogue/' + OPEN.bridge);
  const seeClosed = await api('/api/catalogue/' + CLOSED.bridge);
  const seeGhost  = await api('/api/catalogue/CBZZZZZZZZ');          // a shop that was never created

  note(`OPEN     ${OPEN.bridge}   → ${seeOpen.status}  ${(seeOpen.json.items || []).length} product(s)`);
  note(`CLOSED   ${CLOSED.bridge}   → ${seeClosed.status}  ${JSON.stringify(seeClosed.json)}`);
  note(`NEVER EXISTED  CBZZZZZZZZ  → ${seeGhost.status}  ${JSON.stringify(seeGhost.json)}`);

  ok('the open shop shows its product', seeOpen.status === 200 && (seeOpen.json.items || []).length > 0);
  ok('the closed shop shows nothing', seeClosed.status === 404);
  ok('★★ CLOSED and NEVER-EXISTED are IDENTICAL — same status, same words',
    seeClosed.status === seeGhost.status && JSON.stringify(seeClosed.json) === JSON.stringify(seeGhost.json),
    'a different message would tell a stranger which bridge ids are real businesses');

  // ── 4 · and not through the back door either ───────────────────────────────────────────────────────────────
  step(4, 'the same shop, seen as a SUPPLIER by another business');
  const other = await mint(`shop-viewer-${s}@test-cb.com`, `Viewer ${s}`);
  await api('/api/relationships/suppliers', { method: 'POST', token: other.token, body: { supplier_bridge_id: CLOSED.bridge } });
  const sups = await api('/api/relationships/suppliers', { token: other.token });
  const row = ((sups.json && (sups.json.suppliers || sups.json)) || []).find((x) => x.bridge_id === CLOSED.bridge);
  if (row) {
    const viaSupplier = await api('/api/relationships/suppliers/' + row.supplier_entity_id + '/catalogue', { token: other.token });
    const items = (viaSupplier.json && viaSupplier.json.items) || [];
    ok('★ a closed shop stays closed to a business that added it as a supplier', items.length === 0,
      `${items.length} item(s) leaked`);
    note('adding a supplier is unilateral and self-asserted — it cannot authorise more than public.');
  } else {
    ok('the viewer could add the closed shop as a supplier', false, 'could not set up the supplier hop');
  }

  // ── cleanup ────────────────────────────────────────────────────────────────────────────────────────────────
  step('x', 'cleanup');
  for (const sh of [OPEN, CLOSED]) {
    const list = await api('/api/products', { token: sh.token });
    for (const it of ((list.json && list.json.items) || [])) {
      await api('/api/products/' + it.item_id, { method: 'DELETE', token: sh.token });
    }
  }
  note('products removed; the throwaway entities remain (there is no self-delete).');

  console.log('\n' + '═'.repeat(74));
  console.log(`  ${pass} proved · ${fail} failed`);
  console.log('═'.repeat(74) + '\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('\n  threw: ' + e.message + '\n'); process.exit(1); });
