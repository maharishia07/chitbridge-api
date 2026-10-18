'use strict';
/**
 * tests/move-in-country-gate.test.cjs — MOVE-IN W1 (MOVE-IN-GAPS-REQUIREMENT, DECISIONS 2026-10-18:62-70): the country rule and the field gaps.
 *   1 the gate (lib/move-in-gate through plan): source country ≠ shop country → refused WHOLE (0 rows); unstated · a word · a foreign fingerprint · a second
 *     company → each its code; an unknown shop country is never given India's rules; a pack with no move-in map refuses; an IN stub map is used for an IN shop
 *     and the AU map is never asked
 *   2 holds: an unmatched tax code (item, a document's line) → HELD with code tax_code; an unknown unit → held (unit); a bill already open for the party → bill_key
 *   3 X-1: one reference on two parties' bills → both land, each kept with the party's number; no reference → one generated from the line
 *   4 W1.8 their contact id first: a renamed contact's bill lands · W1.3 the tax ID by the pack (IN: a GSTIN lands, no ABN refusal) · W1.7 kgs → kg
 *   5 the proof (lib/move-in-proof build): held items with code + reason, the stated country, the company id, a sub-cent difference SHOWN ("0.004"), not held
 *   7 W1.11 (DECISIONS 2026-10-18:83): IN, no map yet — contacts and untaxed items land; a taxed item (code · purchase code · HSN) is HELD, the clean
 *     rows land; bills · trial balance · chart refused; foreign source · no pack · US (no map, no say) refused; AU unchanged
 *   6 the doors, through real Express over the in-memory ledger: /move-in/preview + /move-in/import answer each refusal with 422 + its code and write nothing;
 *     GET /move-in/imports answers ready:false with the sentence before b765
 * No database, no network. Run: node tests/move-in-country-gate.test.cjs
 */
const assert = require('assert');
const path = require('path');
const http = require('http');
const MI = require('../lib/move-in');
const MP = require('../lib/move-in-proof');
const Gate = require('../lib/move-in-gate');
const R = require('../lib/regulation'), AU = require('../lib/reg-au'), IN = require('../lib/reg-in');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ok    ' + name); } catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + String(e.stack || e.message).split('\n').slice(0, 3).join('\n        ')); } };
const ta = async (name, fn) => { try { await fn(); pass++; console.log('  ok    ' + name); } catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + String(e.stack || e.message).split('\n').slice(0, 3).join('\n        ')); } };
const refusedWith = (fn, code) => { try { fn(); } catch (e) { assert.strictEqual(e.code, code, e.message); assert.strictEqual(e.refused, true); assert.strictEqual(e.status, 422); return e; } throw new Error('not refused (wanted ' + code + ')'); };

const ITEM = (o) => Object.assign({ line: 2, name: 'Flat white', code: 'FW', sales_price: '4.50', sales_tax: 'GST' }, o || {});
const plan = (kind, inp) => MI.plan(kind, Object.assign({ source: 'qbo', country: 'AU', source_country: 'AU', currency: 'AUD', world: { products: [] }, rows: [ITEM()] }, inp));
const CHART = () => [{ account_id: 'ar', code: '1300', name: 'Customers', role: 'debtors', is_group: false }, { account_id: 'ap', code: '2100', name: 'Suppliers', role: 'creditors', is_group: false }];
const PARTY = (id, no, name, side, extra) => Object.assign({ party_id: id, party_no: no, name, customer: side === 'customer', supplier: side === 'supplier' }, extra || {});

/* a test country with its own move-in map ('VAT 20%' is its code) — the foreign side of the fingerprint (C3) */
R.register(Object.assign({}, AU, { id: 'ZQ', country: 'ZQ', name: 'Testland', currency: 'GBP', moveIn: { sources: ['qbo'], supplyKindFor: (s, c) => (String(c).toUpperCase() === 'VAT 20%' ? { id: 'standard', name: 'Standard', rate: 20 } : undefined) } }));

console.log('\nmove-in W1 · 1 the country gate');
t('the gate itself: how the country was known is "stated" or "read", anything else is "stated"; one company id, trimmed; a second one refused', () => {
  assert.strictEqual(Gate.gate({ country: 'au', source_country: 'au', country_how: 'read' }).country_how, 'read');
  assert.strictEqual(Gate.gate({ country: 'AU', source_country: 'AU', country_how: 'guessed' }).country_how, 'stated');
  assert.strictEqual(Gate.company('  9341 ', ['9341']), '9341');
  assert.strictEqual(Gate.company('', ['9341']), null);
  refusedWith(() => Gate.company('9341', ['7777']), 'MOVE_IN_COMPANY');
});
t('⭐ AU shop, books stated as AU: planned; the plan carries the countries and how the source one was given', () => {
  const pl = plan('items', {});
  assert.strictEqual(pl.counts.add, 1); assert.deepStrictEqual(pl.country, { shop: 'AU', source: 'AU', how: 'stated' });
});
t('⭐ books from GB · CA · US into the AU shop: refused WHOLE with MOVE_IN_COUNTRY, before a row is read', () => {
  for (const cc of ['GB', 'CA', 'US', 'gb']) {
    const e = refusedWith(() => plan('items', { source_country: cc }), 'MOVE_IN_COUNTRY');
    assert.ok(/this shop is in Australia/.test(e.message) && /Nothing was imported/.test(e.message), e.message);
  }
});
t('a file with no stated country → MOVE_IN_COUNTRY_UNSTATED; a country as a word ("Australia") → MOVE_IN_COUNTRY_WORD (never guessed)', () => {
  refusedWith(() => plan('items', { source_country: '' }), 'MOVE_IN_COUNTRY_UNSTATED');
  refusedWith(() => plan('items', { source_country: null }), 'MOVE_IN_COUNTRY_UNSTATED');
  const e = refusedWith(() => plan('items', { source_country: 'Australia' }), 'MOVE_IN_COUNTRY_WORD');
  assert.ok(/AU for Australia/.test(e.message), e.message);
});
t('⭐ an unknown shop country is NEVER given India\'s rules: ZZ · none · a world whose pack fell back to India → refused MOVE_IN_COUNTRY', () => {
  refusedWith(() => plan('items', { country: 'ZZ', source_country: 'ZZ' }), 'MOVE_IN_COUNTRY');
  refusedWith(() => plan('items', { country: null, source_country: 'IN' }), 'MOVE_IN_COUNTRY');
  /* accounts-packs answers India for an unknown country: the gate reads the SETTING's country, never world.pack */
  refusedWith(() => plan('items', { country: undefined, source_country: 'IN', world: { pack: IN, setting: { country: 'ZZ' }, products: [] } }), 'MOVE_IN_COUNTRY');
});
t('a shop whose pack has no move-in map yet (US · IN today) → refused MOVE_IN_COUNTRY, never "every document held" (C2); IN: the lanes that carry tax', () => {
  const e = refusedWith(() => plan('items', { country: 'US', source_country: 'US' }), 'MOVE_IN_COUNTRY');
  assert.ok(/not ready for United States/.test(e.message), e.message);
  refusedWith(() => plan('trial_balance', { country: 'IN', source_country: 'IN', rows: [] }), 'MOVE_IN_COUNTRY');
});
t("⭐ behavioural guard: an IN shop with an IN stub map plans through IN's map — its own code lands at ITS rate, an unknown one is held, AU's GST is refused as foreign (never borrowed)", () => {
  IN.moveIn = { sources: ['qbo'], supplyKindFor: (s, c) => (String(c) === 'GST18' ? { id: 'taxable', name: 'Taxable 18%', rate: 18 } : undefined) };
  try {
    const pl = plan('items', { country: 'IN', source_country: 'IN', currency: 'INR', rows: [ITEM({ sales_tax: 'GST18' }), ITEM({ line: 3, code: 'X2', sales_tax: 'LOCAL5' })] });
    assert.strictEqual(pl.rows[0].action, 'add'); assert.strictEqual(pl.rows[0].data.rec.gst_rate, 18);
    assert.strictEqual(pl.rows[1].action, 'hold'); assert.strictEqual(pl.rows[1].code, 'tax_code');
    assert.ok(/India/.test(pl.rows[1].why), pl.rows[1].why);
    const e = refusedWith(() => plan('items', { country: 'IN', source_country: 'IN', currency: 'INR', rows: [ITEM({ sales_tax: 'GST' })] }), 'MOVE_IN_FOREIGN');
    assert.ok(/of Australia, not of India/.test(e.message), e.message);
  } finally { delete IN.moveIn; }
});
t('⭐ a foreign fingerprint: a tax code only ANOTHER country\'s map knows refuses the whole file (MOVE_IN_FOREIGN)', () => {
  const e = refusedWith(() => plan('items', { rows: [ITEM(), ITEM({ line: 3, code: 'X', sales_tax: 'VAT 20%' })] }), 'MOVE_IN_FOREIGN');
  assert.ok(/"VAT 20%" is a tax code of/.test(e.message), e.message);
});
t('W1.4 one company per shop and system: a second, different company → MOVE_IN_COMPANY; the same one → planned, its id on the plan', () => {
  refusedWith(() => plan('items', { source_company: '222', world: { products: [], companies: ['111'] } }), 'MOVE_IN_COMPANY');
  assert.strictEqual(plan('items', { source_company: '111', world: { products: [], companies: ['111'] } }).company_id, '111');
});

console.log('\nmove-in W1.11 · India: the lanes that carry no tax, before the IN map');
const inPlan = (kind, inp) => plan(kind, Object.assign({ country: 'IN', source_country: 'IN', currency: 'INR' }, inp));
const NOT_READY = /^Moving books in is not ready for India yet — its tax codes have no map here\./;
t('⭐ the gate itself: IN takes contacts and items with no map (map null); bills, trial balance and the chart are refused with the not-ready sentence', () => {
  for (const kind of ['contacts', 'items']) assert.strictEqual(Gate.gate({ kind, country: 'IN', source_country: 'IN' }).map, null, kind);
  for (const kind of ['open_bills', 'trial_balance', 'accounts', undefined]) {
    const e = refusedWith(() => Gate.gate({ kind, country: 'IN', source_country: 'IN' }), 'MOVE_IN_COUNTRY');
    assert.ok(NOT_READY.test(e.message) && /Nothing was imported/.test(e.message), e.message);
  }
  assert.strictEqual(Gate.taxBearing('items', { sales_tax: ' ' }), false); assert.strictEqual(Gate.taxBearing('items', { hsn: '0901' }), true);
  assert.strictEqual(Gate.taxBearing('contacts', { gstin: '33AAAAA0000A1Z5' }), false);
});
t('⭐ IN contacts land with no map: a GSTIN contact is added, the plan carries IN → IN', () => {
  const pl = inPlan('contacts', { side: 'customer', world: { parties: [] }, rows: [{ line: 2, name: 'Kumar Traders', gstin: '27AAPFU0939F1ZV' }, { line: 3, name: 'Selvi Stores' }] });
  assert.deepStrictEqual(pl.counts, { add: 2, merge: 0, skip: 0, hold: 0 });
  assert.strictEqual(pl.rows[0].data.gstin, '27AAPFU0939F1ZV'); assert.deepStrictEqual(pl.country, { shop: 'IN', source: 'IN', how: 'stated' });
});
t('⭐ IN items: an item with no tax field lands (no rate); one with a sales code, a purchase code or an HSN is HELD (tax_code), the not-ready sentence', () => {
  const pl = inPlan('items', { rows: [ITEM({ sales_tax: '' }), ITEM({ line: 3, code: 'T1', sales_tax: 'GST18' }), ITEM({ line: 4, code: 'T2', sales_tax: '', purchase_tax: 'IGST12' }), ITEM({ line: 5, code: 'T3', sales_tax: '', hsn: '0901' })] });
  assert.deepStrictEqual(pl.counts, { add: 1, merge: 0, skip: 0, hold: 3 });
  assert.strictEqual(pl.rows[0].action, 'add'); assert.strictEqual(pl.rows[0].data.rec.gst_rate, null);
  assert.ok(pl.rows.slice(1).every((r) => r.action === 'hold' && r.code === 'tax_code' && NOT_READY.test(r.why)), JSON.stringify(pl.rows.slice(1)));
  assert.deepStrictEqual(pl.tax_codes, []);
  assert.strictEqual(MI.guess('items', ['Item Name', 'HSN/SAC']).guess[1].field, 'hsn');
});
t('⭐ IN bills (open_bills), opening balances (trial_balance) and the chart: refused WHOLE before a row is read', () => {
  const bill = [{ line: 2, contact: 'Acme', invoice_no: 'B1', amount_due: '10' }];
  for (const [kind, rows] of [['open_bills', bill], ['trial_balance', [{ line: 2, account: 'Cash', debit: '10', credit: '' }]], ['accounts', [{ line: 2, name: 'Cash', type: 'Bank' }]]]) {
    const e = refusedWith(() => inPlan(kind, { side: 'payable', rows, world: { chart: CHART(), parties: [] } }), 'MOVE_IN_COUNTRY');
    assert.ok(NOT_READY.test(e.message), kind + ': ' + e.message);
  }
});
t('⭐ the country rule is unchanged on the no-tax lanes: AU books into the IN shop · an AU code in an IN items file · no pack · US (no map, no say)', () => {
  const e = refusedWith(() => inPlan('contacts', { source_country: 'AU', side: 'customer', world: { parties: [] }, rows: [{ line: 2, name: 'X' }] }), 'MOVE_IN_COUNTRY');
  assert.ok(/from Australia and this shop is in India/.test(e.message), e.message);
  refusedWith(() => inPlan('items', { rows: [ITEM({ sales_tax: '' }), ITEM({ line: 3, code: 'X', sales_tax: 'GST' })] }), 'MOVE_IN_FOREIGN');
  for (const cc of ['ZZ', 'GB']) refusedWith(() => plan('contacts', { country: cc, source_country: cc, side: 'customer', world: { parties: [] }, rows: [{ line: 2, name: 'X' }] }), 'MOVE_IN_COUNTRY');
  const us = refusedWith(() => plan('contacts', { country: 'US', source_country: 'US', side: 'customer', world: { parties: [] }, rows: [{ line: 2, name: 'X' }] }), 'MOVE_IN_COUNTRY');
  assert.ok(/not ready for United States/.test(us.message), us.message);
});
t('AU (has a map) unchanged: an item with GST lands at 10 %, an HSN column changes nothing; a taxed AU item is never held for "not ready"', () => {
  const pl = plan('items', { rows: [ITEM(), ITEM({ line: 3, code: 'H', hsn: '0901' })] });
  assert.deepStrictEqual(pl.counts, { add: 2, merge: 0, skip: 0, hold: 0 });
  assert.strictEqual(pl.rows[0].data.rec.gst_rate, 10); assert.ok(pl.tax_codes.length >= 1);
});

console.log('\nmove-in W1 · 2 holds — nothing lands unmatched');
t('⭐ an item whose tax code AU does not know (Adjustment · GST free exports) is HELD with code tax_code, never 0 % or skipped', () => {
  const pl = plan('items', { rows: [ITEM(), ITEM({ line: 3, code: 'A', sales_tax: 'Adjustment' }), ITEM({ line: 4, code: 'B', sales_tax: 'GST free exports' })] });
  assert.deepStrictEqual(pl.counts, { add: 1, merge: 0, skip: 0, hold: 2 });
  assert.ok(pl.rows.slice(1).every((r) => r.code === 'tax_code' && /pick one of your own codes/.test(r.why)));
  const held = pl.tax_codes.filter((x) => x.verdict === 'held').map((x) => x.code);
  assert.deepStrictEqual(held, ['Adjustment', 'GST free exports']);
});
t('W1.7 units: "kgs" → kg, blank → unit, an unknown unit ("box12") is HELD with code unit and said', () => {
  const pl = plan('items', { rows: [ITEM({ unit: 'kgs' }), ITEM({ line: 3, code: 'B', unit: '' }), ITEM({ line: 4, code: 'C', unit: 'box12' })] });
  assert.strictEqual(pl.rows[0].data.rec.unit, 'kg'); assert.strictEqual(pl.rows[1].data.rec.unit, 'unit');
  assert.strictEqual(pl.rows[2].action, 'hold'); assert.strictEqual(pl.rows[2].code, 'unit'); assert.ok(/"box12" is not one of ours/.test(pl.rows[2].why));
});

console.log('\nmove-in W1 · 3 X-1 the bill key is (party, reference)');
const BILLS_WORLD = (extra) => Object.assign({ chart: CHART(), parties: [PARTY('s1', 'P-1', 'Acme', 'supplier'), PARTY('s2', 'P-2', 'Bolt', 'supplier')] }, extra || {});
const bills = (rows, extra) => plan('open_bills', { source: 'xero', side: 'payable', rows, world: BILLS_WORLD(extra) });
t('⭐ two suppliers both use "AP": both land, each kept as "AP · <their number>"; a bill with no number gets one from its line', () => {
  const pl = bills([{ line: 2, contact: 'Acme', invoice_no: 'AP', amount_due: '100.00' }, { line: 3, contact: 'Bolt', invoice_no: 'AP', amount_due: '50.00' }, { line: 4, contact: 'Bolt', invoice_no: '', amount_due: '7.00' }]);
  assert.deepStrictEqual(pl.counts, { add: 3, merge: 0, skip: 0, hold: 0 });
  assert.deepStrictEqual(pl.rows.map((r) => r.data.bill_ref), ['AP · P-1', 'AP · P-2', 'MI-4 · P-2']);
  assert.deepStrictEqual(pl.rows.map((r) => r.data.ref_given), ['AP', 'AP', null]);
});
t('a reference the books already hold for ANOTHER party is kept with this party\'s number; the same party\'s open bill again is HELD (bill_key)', () => {
  const pl = bills([{ line: 2, contact: 'Acme', invoice_no: 'B-9', amount_due: '10' }, { line: 3, contact: 'Bolt', invoice_no: 'B-7', amount_due: '10' }],
    { billOwners: [{ ref: 'B-9', party_id: 's2' }, { ref: 'B-7', party_id: 's2' }] });
  assert.strictEqual(pl.rows[0].data.bill_ref, 'B-9 · P-1');
  assert.strictEqual(pl.rows[1].action, 'hold'); assert.strictEqual(pl.rows[1].code, 'bill_key');
});
t('a document whose line carries a code AU does not know is HELD (tax_code); its known codes land', () => {
  const pl = bills([{ line: 2, contact: 'Acme', invoice_no: 'B1', amount_due: '10', tax_codes: 'INPUT;GSTONIMPORTS' }, { line: 3, contact: 'Acme', invoice_no: 'B2', amount_due: '10', tax_codes: 'INPUT;MYSTERY' }]);
  assert.strictEqual(pl.rows[0].action, 'add'); assert.strictEqual(pl.rows[1].action, 'hold'); assert.strictEqual(pl.rows[1].code, 'tax_code');
});

console.log('\nmove-in W1 · 4 their contact id · the tax ID by the pack');
t('⭐ W1.8 a renamed contact\'s bill lands: their contact id finds the party before the name does', () => {
  const pl = bills([{ line: 2, contact: 'Acme Pty Ltd (renamed)', contact_ref: 'XC-77', invoice_no: 'B1', amount_due: '10' }], { sourceRefs: [{ side: 'supplier', party_id: 's1', source_system: 'xero', source_ref: 'XC-77' }] });
  assert.strictEqual(pl.rows[0].action, 'add'); assert.strictEqual(pl.rows[0].data.party_id, 's1');
});
t('W1.8 a contact row keeps their id: a new one carries the pair; a party already here gains it on a merge', () => {
  const W = { parties: [PARTY('c1', 'P-3', 'Harbour Cafe', 'customer')], taxIds: [], phones: [], sourceRefs: [] };
  const pl = plan('contacts', { side: 'customer', world: W, rows: [{ line: 2, name: 'New Co', source_ref: 'Q-1' }, { line: 3, name: 'Harbour Cafe', source_ref: 'Q-2' }] });
  assert.deepStrictEqual([pl.rows[0].action, pl.rows[0].data.source_system, pl.rows[0].data.source_ref], ['add', 'qbo', 'Q-1']);
  assert.deepStrictEqual([pl.rows[1].action, pl.rows[1].data.sets.source_ref], ['merge', 'Q-2']);
});
t('W1.3 the tax ID is the PACK\'s: AU checks an ABN (refused with its sentence); an IN shop (stub map) takes a GSTIN, no ABN refusal', () => {
  const bad = plan('contacts', { side: 'customer', world: { parties: [] }, rows: [{ line: 2, name: 'X', abn: '123' }] });
  assert.strictEqual(bad.rows[0].action, 'skip'); assert.ok(/^ABN 123:/.test(bad.rows[0].why), bad.rows[0].why);
  IN.moveIn = { sources: ['qbo'], supplyKindFor: () => undefined };
  try {
    const pl = plan('contacts', { country: 'IN', source_country: 'IN', side: 'customer', world: { parties: [] }, rows: [{ line: 2, name: 'Kumar Traders', abn: '33AAAAA0000A1Z5', gstin: '' }] });
    assert.strictEqual(pl.rows[0].action, 'add', pl.rows[0].why); assert.strictEqual(pl.rows[0].data.tax_scheme, 'GSTIN');
  } finally { delete IN.moveIn; }
});

console.log('\nmove-in W1 · 5 the match proof');
t('⭐ the proof holds the stated country, the company id, each held item with code + reason, and a sub-cent difference SHOWN, not held', () => {
  const pl = MI.plan('open_bills', { source: 'xero', side: 'payable', country: 'AU', source_country: 'AU', source_company: 'org-1', currency: 'AUD', world: BILLS_WORLD(),
    rows: [{ line: 2, contact: 'Acme', invoice_no: 'B1', amount_due: '10.004' }, { line: 3, contact: 'Acme', invoice_no: 'B2', amount_due: '5', tax_codes: 'MYSTERY' }] });
  const proof = MP.build(pl, { added: 1, merged: 0, skipped: 0, held: 1 }, { currency: 'AUD', as_at: '2026-07-01' });
  assert.deepStrictEqual([proof.source_country, proof.country_how, proof.shop_country, proof.company_id], ['AU', 'stated', 'AU', 'org-1']);
  assert.deepStrictEqual(proof.held, [{ line: 3, what: 'Acme · B2', code: 'tax_code', why: pl.rows[1].why }]);
  assert.strictEqual(proof.documents[0].rounded, '0.004'); assert.strictEqual(proof.documents[0].action, 'add'); assert.strictEqual(proof.documents[0].ours_minor, -1000);
  assert.deepStrictEqual(proof.parties, [{ party_id: 's1', documents: 1, net_minor: -1000 }]);
  assert.strictEqual(proof.differences, 1);
  assert.ok(proof.held.every((h) => MP.HOLD_CODES.includes(h.code) && h.why));
});

/* ═══ 6 · the doors, through real Express over the in-memory ledger ═══ */
(async () => {
  console.log('\nmove-in W1 · 6 the doors (/move-in/preview · /move-in/import · /move-in/imports)');
  const H = require('./support/books-harness.cjs');
  const SHOP = 'aaaaaaaa-7777-4111-8111-111111111111';
  const authStub = Object.assign((req, res, next) => { req.identity = { identity_id: SHOP, identity_type: 'entity', display_name: 'Bondi Grocer' }; next(); },
    { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (req, res, next) => next() });
  const X = H.load({ auth: authStub });
  if (!X.src.dir) { console.log('  SKIP  ' + X.src.why); return done(); }
  const IDS = { [SHOP]: { identity_id: SHOP, gstn: null, display_name: 'Bondi Grocer', country: 'AU', policy_flags: {} } };
  const q0 = X.dbStub.query;
  X.dbStub.query = async (sql, p) => (/FROM identities WHERE identity_id = ANY/.test(String(sql)) ? { rows: p[0].map((id) => IDS[id]).filter(Boolean) } : q0(sql, p));
  require.cache[require.resolve(path.join(H.API, 'lib', 'storage-object'))] = { exports: { available: async () => false } };
  const express = require('express');
  const app = express(); app.use(express.json({ limit: '5mb' })); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0), port = srv.address().port;
  const call = (method, p, body) => new Promise((ok) => {
    const b = JSON.stringify(body || {});
    const r = http.request({ host: '127.0.0.1', port, path: '/api/books' + p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
      (res) => { let raw = ''; res.on('data', (c) => { raw += c; }); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { j = { raw }; } ok({ status: res.statusCode, body: j }); }); });
    r.end(b);
  });
  await X.store.saveSetting(X.db, SHOP, { enabled: false, country: 'AU' });
  const en = await call('POST', '/enable', {});
  const csv = 'Product/Service,SKU,Sales price,Tax code\nFlat white,FW,4.50,GST\nMystery,MY,1.00,Adjustment\n';
  const dec = [{ incoming: 'Product/Service', field: 'name' }, { incoming: 'SKU', field: 'code' }, { incoming: 'Sales price', field: 'sales_price' }, { incoming: 'Tax code', field: 'sales_tax' }];
  const body = (o) => Object.assign({ kind: 'items', source: 'qbo', csv, decisions: dec, source_country: 'AU' }, o || {});
  await ta('the shop is on (AU)', async () => { assert.ok(en.status === 200, JSON.stringify(en.body)); });
  await ta('⭐ preview, stated AU: 200 — one to add, one HELD with code tax_code', async () => {
    const r = await call('POST', '/move-in/preview', body());
    assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.deepStrictEqual(r.body.counts, { add: 1, merge: 0, skip: 0, hold: 1 });
    assert.strictEqual(r.body.rows[1].code, 'tax_code'); assert.deepStrictEqual(r.body.country, { shop: 'AU', source: 'AU', how: 'stated' });
  });
  for (const [label, o, code] of [['unstated', { source_country: undefined }, 'MOVE_IN_COUNTRY_UNSTATED'], ['mismatched (GB)', { source_country: 'GB' }, 'MOVE_IN_COUNTRY'],
    ['given as a word', { source_country: 'Australia' }, 'MOVE_IN_COUNTRY_WORD'],
    ['a foreign fingerprint', { csv: 'Product/Service,SKU,Sales price,Tax code\nTea,T1,3.00,VAT 20%\n' }, 'MOVE_IN_FOREIGN']]) {
    await ta('preview ' + label + ': 422 with code ' + code + ' and the sentence', async () => {
      const r = await call('POST', '/move-in/preview', body(o));
      assert.strictEqual(r.status, 422, JSON.stringify(r.body)); assert.strictEqual(r.body.code, code); assert.ok(/Nothing was imported/.test(r.body.message), r.body.message);
    });
  }
  await ta('⭐ import from GB into the AU shop: 422 MOVE_IN_COUNTRY and nothing written (no product, no proof)', async () => {
    const before = JSON.stringify(X.T.entries || []).length;
    const r = await call('POST', '/move-in/import', body({ source_country: 'GB', confirm: true }));
    assert.strictEqual(r.status, 422); assert.strictEqual(r.body.code, 'MOVE_IN_COUNTRY');
    assert.strictEqual(JSON.stringify(X.T.entries || []).length, before);
  });
  await ta('⭐ W1.11 the door, shop set to IN: an items preview lands the clean row and HOLDS the HSN one; open bills answer 422 MOVE_IN_COUNTRY', async () => {
    await X.store.saveSetting(X.db, SHOP, { enabled: true, country: 'IN' });
    try {
      const inCsv = 'Product/Service,SKU,Sales price,HSN/SAC\nRice 5kg,R5,320.00,\nCoffee,CF,250.00,0901\n';
      const inDec = [{ incoming: 'Product/Service', field: 'name' }, { incoming: 'SKU', field: 'code' }, { incoming: 'Sales price', field: 'sales_price' }, { incoming: 'HSN/SAC', field: 'hsn' }];
      const r = await call('POST', '/move-in/preview', { kind: 'items', source: 'qbo', csv: inCsv, decisions: inDec, source_country: 'IN' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.deepStrictEqual(r.body.counts, { add: 1, merge: 0, skip: 0, hold: 1 });
      assert.strictEqual(r.body.rows[1].code, 'tax_code'); assert.ok(/not ready for India/.test(r.body.rows[1].why), r.body.rows[1].why);
      const billCsv = 'Contact,Invoice number,Amount due\nAcme,B1,10.00\n';
      const billDec = [{ incoming: 'Contact', field: 'contact' }, { incoming: 'Invoice number', field: 'invoice_no' }, { incoming: 'Amount due', field: 'amount_due' }];
      const b = await call('POST', '/move-in/preview', { kind: 'open_bills', source: 'qbo', side: 'payable', csv: billCsv, decisions: billDec, source_country: 'IN' });
      assert.strictEqual(b.status, 422, JSON.stringify(b.body)); assert.strictEqual(b.body.code, 'MOVE_IN_COUNTRY'); assert.ok(/not ready for India/.test(b.body.message), b.body.message);
    } finally { await X.store.saveSetting(X.db, SHOP, { enabled: true, country: 'AU' }); }
  });
  await ta('GET /move-in/imports before b765: ready false, with the sentence (never a 500)', async () => {
    const r = await call('GET', '/move-in/imports');
    assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.ready, false); assert.ok(/b765/.test(r.body.why), r.body.why);
  });
  srv.close();
  done();
})().catch((e) => { console.error(e); process.exit(1); });

function done() {
  console.log('\n' + pass + ' checks' + (fail ? ' · ' + fail + ' FAILED' : ''));
  process.exit(fail ? 1 : 0);
}
