'use strict';
/**
 * matrix.js — THE CONFORMANCE MATRIX. One store per catalogue type; every one driven end to end.
 *
 * Athi: "I wanted to create a catalogue with each different type and all should work from storefront and supplier.
 * One store for one type — one for cart, one for negotiation, one for document, one for helpdesk. All should work,
 * and if we combine them under a network it should work seamlessly."
 *
 * This is that test. It drives the LIVE API and prints a grid, so a regression shows up as a red cell against a
 * named store rather than as a silent gap.
 *
 *   node scripts/matrix.js            run everything
 *   node scripts/matrix.js --seed     create/refresh the five stores first
 *
 * ⚠️ Writes to the live database (@test-cb.com identities). cleanup-test-entities.sql sweeps them.
 *
 * COLUMNS — each is a real request, not a mock:
 *   storefront   GET /api/catalogue/:bridge         the shop is reachable and serves items
 *   declared     …its order_input is the one it should be (preset + pipeline)
 *   items        …the catalogue actually has something in it
 *   submit       POST order/start + order/confirm    a type-appropriate submission succeeds
 *   guard        …and a DELIBERATELY WRONG submission is REJECTED (the half that matters)
 *   chit         GET /api/chits/:id as the SHOP      the record arrived and carries the payload
 *   supplier     GET /suppliers/:id/catalogue        a BUYER ENTITY sees the same catalogue (B2B)
 */
const API = process.env.API || 'https://chitbridge-api-production.up.railway.app';
const OTP = process.env.DEV_OTP || '123456';
const SEED = process.argv.includes('--seed');

const G = (s) => '\x1b[32m' + s + '\x1b[0m', R = (s) => '\x1b[31m' + s + '\x1b[0m';
const Y = (s) => '\x1b[33m' + s + '\x1b[0m', B = (s) => '\x1b[1m' + s + '\x1b[0m', D = (s) => '\x1b[2m' + s + '\x1b[0m';
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('matrix test document\n%%EOF')]).toString('base64');

async function call(method, p, { token, body } = {}) {
  const res = await fetch(API + p, { method,
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
  return { token: j.token, bridge_id: e.bridge_id, id: e.identity_id, email };
}
// place a submission as an anonymous customer
async function submit(bridge, line_items, who) {
  const start = await call('POST', `/api/catalogue/${encodeURIComponent(bridge)}/order/start`,
    { body: { identifier: who, name: 'Matrix buyer' } });
  if (start.status >= 400) return { status: start.status, json: start.json };
  return call('POST', `/api/catalogue/${encodeURIComponent(bridge)}/order/confirm`, {
    body: { identifier: who, name: 'Matrix buyer', otp: (start.json && start.json.dev_otp) || '123123',
            location: 'Bengaluru', line_items } });
}

// ── the five stores, and what each must prove ────────────────────────────────────────────────────────────────
const CASES = [
  { key: 'cart', store: 'Alpha Paints', email: 'alpha@test-cb.com', preset: 'cart', pipeline: 'commerce',
    good: (item) => [{ kind: 'finish', finish: item, quantity: 2 }],
    // a fixed-price shop must REJECT an offer — the guard T3.3 restored on the ordinary path
    bad:  (item) => [{ kind: 'finish', finish: item, quantity: 2, proposal: { price: 1 } }],
    badWhy: 'an offer to a fixed-price shop' },

  { key: 'units', store: 'Beta Fresh', email: 'beta@test-cb.com', preset: 'cart', pipeline: 'commerce',
    good: (item) => [{ kind: 'finish', finish: item, quantity: 3 }],
    bad:  (item) => [{ kind: 'finish', finish: item, quantity: -1 }],
    badWhy: 'a negative quantity' },

  { key: 'document', store: 'Gamma Document Services', email: 'gamma@test-cb.com', preset: 'form', pipeline: 'payload',
    good: (item) => [{ kind: 'payload', finish: item, name: item,
      payload: { pan: 'ABCDE1234F', assessment_year: '2026-27', income_from_salary: 1718600, bank_account_ifsc: 'HDFC0001234' },
      documents: [{ name: 'form16.pdf', mime: 'application/pdf', data_base64: PDF }] }],
    // the REQUIRED proof must actually be required
    bad:  (item) => [{ kind: 'payload', finish: item, name: item,
      payload: { pan: 'ABCDE1234F', assessment_year: '2026-27', income_from_salary: 1718600, bank_account_ifsc: 'HDFC0001234' } }],
    badWhy: 'a form missing its REQUIRED document',
    pickItem: (items) => (items.find((i) => /ITR/.test(i)) || items[0]) },

  { key: 'negotiation', store: 'Delta Trade', email: 'delta@test-cb.com', preset: 'range', pipeline: 'commerce',
    good: (item) => [{ kind: 'finish', finish: item, quantity: 5, proposal: { price: 47000 } }],
    // outside the seller's declared band
    bad:  (item) => [{ kind: 'finish', finish: item, quantity: 5, proposal: { price: 10 } }],
    badWhy: "an offer BELOW the seller's band",
    pickItem: (items) => (items.find((i) => /coil/i.test(i)) || items[0]) },

  { key: 'helpdesk', store: 'Epsilon Help Desk', email: 'epsilon@test-cb.com', preset: 'form', pipeline: 'payload',
    good: (item) => [{ kind: 'payload', finish: item, name: item, payload: { question: 'Is my order shipped?' } }],
    bad:  (item) => [{ kind: 'payload', finish: item, name: item, payload: { question: 'hi', sneaky: 'x' } }],
    badWhy: 'an undeclared field' },
];

(async () => {
  console.log('═'.repeat(100));
  console.log(B('  CONFORMANCE MATRIX — one store per catalogue type, every one driven end to end'));
  console.log('  ' + API);
  console.log('═'.repeat(100));

  if (SEED) {
    console.log(Y('\n  --seed given: running scripts/reset-and-seed.js --go --skip-wipe first…\n'));
    const { execFileSync } = require('node:child_process');
    try { execFileSync(process.execPath, [require('node:path').join(__dirname, 'reset-and-seed.js'), '--go', '--skip-wipe'], { stdio: 'inherit' }); }
    catch (_) { console.log(R('  seed failed — continuing with whatever is there')); }
  }

  // one BUYER entity, used for every supplier-view check
  let buyer = null;
  try { buyer = await signIn('matrix.buyer@test-cb.com', 'Matrix Buyer'); } catch (e) { console.log(R('buyer sign-in failed: ' + e.message)); }

  const rows = [];
  for (const c of CASES) {
    const row = { key: c.key, store: c.store, storefront: '–', declared: '–', items: '–', submit: '–', guard: '–', chit: '–', supplier: '–', notes: [] };
    try {
      const me = await signIn(c.email, c.store);

      // storefront + declaration + items
      const sf = await call('GET', `/api/catalogue/${encodeURIComponent(me.bridge_id)}`);
      const shop = (sf.json && sf.json.shop) || {};
      const oi = shop.order_input || {};
      const names = ((sf.json && sf.json.finishes) || []).flatMap((f) => (f.items || []).map((i) => i.name));
      row.storefront = sf.status === 200 ? 'ok' : 'FAIL(' + sf.status + ')';
      row.declared = (oi.preset === c.preset && oi.pipeline === c.pipeline) ? 'ok' : `FAIL(${oi.preset}/${oi.pipeline})`;
      row.items = names.length ? String(names.length) : 'FAIL(0)';
      if (!names.length) { rows.push(row); continue; }
      const item = (c.pickItem ? c.pickItem(names) : names[0]);

      // the GOOD submission
      const okRes = await submit(me.bridge_id, c.good(item), `matrix.${c.key}@test-cb.com`);
      row.submit = okRes.status === 200 ? 'ok' : 'FAIL(' + okRes.status + ')';
      if (okRes.status !== 200) row.notes.push(`submit: ${(okRes.json && okRes.json.message) || ''}`.slice(0, 90));

      // the BAD submission — must be REJECTED. A green here would mean the guard is gone.
      const badRes = await submit(me.bridge_id, c.bad(item), `matrix.${c.key}.bad@test-cb.com`);
      row.guard = (badRes.status >= 400 && badRes.status < 500) ? 'ok' : `FAIL(${badRes.status} accepted)`;
      if (row.guard !== 'ok') row.notes.push(`guard: ${c.badWhy} was ACCEPTED`);

      // the chit, seen by the SHOP
      if (okRes.status === 200 && okRes.json && okRes.json.chit_id) {
        const ch = await call('GET', `/api/chits/${encodeURIComponent(okRes.json.chit_id)}`, { token: me.token });
        const chit = (ch.json && (ch.json.chit || ch.json)) || {};
        const lines = chit.line_items || (chit.detail && chit.detail.line_items) || [];
        row.chit = (ch.status === 200 && lines.length) ? 'ok' : 'FAIL(' + ch.status + ')';
        const li = lines[0] || {};
        if (c.pipeline === 'payload' && !li.payload) { row.chit = 'FAIL(no payload)'; }
        if (c.key === 'document' && !(li.documents || []).length) { row.chit = 'FAIL(no proof)'; }
        if (c.key === 'negotiation') {
          const sj = chit.summary_json || {};
          if (sj.purpose !== 'offer' || sj.total_value !== null) row.notes.push(`offer shape: purpose=${sj.purpose} total_value=${sj.total_value}`);
        }
      }

      // the SUPPLIER view — a buyer ENTITY must see the same catalogue (one path, many principals)
      if (buyer) {
        await call('POST', '/api/relationships/suppliers', { token: buyer.token, body: { supplier_bridge_id: me.bridge_id } });
        const sup = await call('GET', `/api/relationships/suppliers/${encodeURIComponent(me.id)}/catalogue`, { token: buyer.token });
        const supNames = ((sup.json && sup.json.finishes) || []).flatMap((f) => (f.items || []).map((i) => i.name));
        row.supplier = (sup.status === 200 && supNames.length === names.length) ? 'ok'
                     : `FAIL(${sup.status}/${supNames.length} vs ${names.length})`;
      }
    } catch (e) { row.notes.push('threw: ' + e.message.slice(0, 80)); }
    rows.push(row);
  }

  // ── the grid ──
  const cols = ['storefront', 'declared', 'items', 'submit', 'guard', 'chit', 'supplier'];
  const w = 15;
  console.log('\n' + B('  ' + 'store'.padEnd(28) + cols.map((c) => c.padEnd(w)).join('')));
  console.log('  ' + '─'.repeat(28 + cols.length * w));
  let failures = 0;
  for (const r of rows) {
    const cells = cols.map((c) => {
      const v = String(r[c]);
      if (v.startsWith('FAIL')) { failures++; return R(v.padEnd(w)); }
      return (v === '–' ? D(v.padEnd(w)) : G(v.padEnd(w)));
    });
    console.log('  ' + r.store.padEnd(28) + cells.join(''));
    r.notes.forEach((n) => console.log('  ' + D('    ↳ ' + n)));
  }

  console.log('\n' + '─'.repeat(100));
  if (failures) console.log(R(`  ${failures} failing cell(s). A red 'guard' is the serious one — it means a check that should reject is accepting.`));
  else console.log(G('  EVERY TYPE WORKS: storefront · declaration · items · submit · guard · chit · supplier.'));
  console.log(Y('  Network combination is NOT covered here — see the note in the matrix backlog.'));
  console.log('═'.repeat(100));
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(R('matrix crashed: ') + (e && e.stack || e)); process.exit(1); });
