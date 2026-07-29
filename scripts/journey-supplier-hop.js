'use strict';
/**
 * journey-supplier-hop.js — "I'll call the document from Alpha Timbers; in the supplier of Alpha Timbers I can call
 * the document and should be able to see the document entity." (Athi, 2026-07-29)
 *
 * Runs the B2B hop against the LIVE API: Alpha Timbers adds Document Services as a supplier, then tries to reach its
 * templates from inside its own account — as opposed to the public storefront link, which already works.
 *
 *   Run:  node scripts/journey-supplier-hop.js
 *
 * ⚠️ Creates real entities (@test-cb.com) — cleanup-test-entities.sql sweeps them.
 */
const API = process.env.API || 'https://chitbridge-api-production.up.railway.app';
const OTP = process.env.DEV_OTP || '123456';
const B = (s) => '\x1b[1m' + s + '\x1b[0m', G = (s) => '\x1b[32m' + s + '\x1b[0m';
const R = (s) => '\x1b[31m' + s + '\x1b[0m', Y = (s) => '\x1b[33m' + s + '\x1b[0m';
const hr = (c) => console.log((c || '─').repeat(80));
let step = 0, gaps = 0;
const head = (t) => console.log('\n' + B(`STEP ${++step} · ${t}`));
const ok   = (m) => console.log('   ' + G('✓ ') + m);
const gap  = (m) => { console.log('   ' + R('✗ ') + m); gaps++; };
const note = (m) => console.log('   ' + Y('· ') + m);

async function call(method, path, { token, body } = {}) {
  const res = await fetch(API + path, { method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}
async function signIn(email, display_name) {
  const reg = await call('POST', '/api/entities/register', { body: { email, display_name } });
  if (reg.status >= 400) throw new Error(`register ${reg.status}: ${JSON.stringify(reg.json)}`);
  const ver = await call('POST', '/api/entities/verify', { body: { email, otp: (reg.json && reg.json.dev_otp) || OTP } });
  if (ver.status >= 400) throw new Error(`verify ${ver.status}: ${JSON.stringify(ver.json)}`);
  const j = ver.json || {}, e = j.entity || j;
  return { token: j.token, bridge_id: e.bridge_id, id: e.identity_id, name: e.display_name };
}

(async () => {
  hr('═'); console.log(B('  THE SUPPLIER HOP — reaching Document Services from inside Alpha Timbers'));
  console.log('  API: ' + API); hr('═');

  head('Both entities');
  const doc  = await signIn('document.store@test-cb.com', 'Document Services');
  const alpha = await signIn('alphatimbers@test-cb.com', 'Alpha Timbers');
  ok(`supplier: ${doc.name} (${doc.bridge_id})`);
  ok(`buyer:    ${alpha.name} (${alpha.bridge_id})`);

  head('Alpha Timbers adds Document Services as a SUPPLIER');
  {
    const r = await call('POST', '/api/relationships/suppliers', { token: alpha.token, body: { supplier_bridge_id: doc.bridge_id } });
    if (r.status < 400 || r.status === 409) ok(r.status === 409 ? 'already a supplier' : 'supplier added');
    else gap(`add supplier ${r.status}: ${JSON.stringify(r.json)}`);
  }

  head('From inside Alpha Timbers — can I SEE the document entity?');
  let sid = null;
  {
    const r = await call('GET', '/api/relationships/suppliers', { token: alpha.token });
    const list = Array.isArray(r.json) ? r.json : ((r.json && r.json.suppliers) || []);
    const found = list.find((s) => (s.supplier_bridge_id === doc.bridge_id) || (s.bridge_id === doc.bridge_id) || (s.supplier_entity_id === doc.id));
    if (found) { sid = found.supplier_entity_id || found.identity_id || doc.id; ok(`"${found.display_name || found.supplier_display_name || doc.name}" is listed under Suppliers`); }
    else gap(`Document Services is NOT in Alpha Timbers' supplier list (${list.length} supplier(s))`);
  }

  head('Now CALL the supplier\'s catalogue from inside Alpha Timbers');
  {
    const r = await call('GET', `/api/relationships/suppliers/${encodeURIComponent(sid || doc.id)}/catalogue`, { token: alpha.token });
    if (r.status >= 400) { gap(`supplier catalogue ${r.status}: ${JSON.stringify(r.json)}`); }
    else {
      const j = r.json || {};
      note(`returned keys: ${Object.keys(j).join(', ')}`);
      note(`schema: ${j.schema ? j.schema.schema_name : 'null'} · items: ${(j.items || []).length}`);
      if ((j.items || []).length) ok(`items visible: ${(j.items || []).map((i) => (i.item_data || {}).name).join(' · ')}`);
      else gap('NO items returned — the templates are not reachable this way');
      if (j.finishes) ok('finishes (adopted/published templates) are included');
      else gap('NO `finishes` key — the supplier view does not carry the adopted reference catalogue, which is where the TEMPLATES live');
      if (j.order_input) ok('order_input (the declaration) is included');
      else gap('NO `order_input` — Alpha Timbers cannot know what fields the form asks for');
    }
  }

  head('For contrast — the PUBLIC storefront of the same supplier');
  {
    const r = await call('GET', `/api/catalogue/${encodeURIComponent(doc.bridge_id)}`);
    const j = r.json || {};
    const fin = (j.finishes || []).flatMap((f) => f.items || []);
    if (fin.length) ok(`storefront shows ${fin.length} template(s): ${fin.map((i) => i.name).join(' · ')}`);
    const oi = (j.shop || {}).order_input;
    if (oi) ok(`storefront carries the declaration → preset=${oi.preset} pipeline=${oi.pipeline}`);
    fin.forEach((i) => { if (i.order_input) note(`${i.name} → its own form (${Object.keys((i.order_input.schema || {}).properties || {}).length} fields)`); });
  }

  hr('─');
  if (gaps) {
    console.log(R(`  ${gaps} gap(s). The supplier VIEW is the blocker, not the rail.`));
    console.log('  GET /api/relationships/suppliers/:id/catalogue (routes/relationships.js:128) returns only');
    console.log('  {supplier, schema, fields, items} — where `items` is the supplier\'s OWN catalogue_items, gated on');
    console.log('  a PUBLIC default entity_schemas row. It predates the reference-catalogue model, so it carries');
    console.log('  neither `finishes` (where published/adopted TEMPLATES live) nor `order_input` (the declaration).');
    console.log(Y('  The same templates ARE reachable right now via the public storefront link above.'));
  } else console.log(G('  The supplier hop reaches the templates.'));
  hr('═');
  process.exit(0);
})().catch((e) => { console.error(R('crashed: ') + (e && e.stack || e)); process.exit(1); });
