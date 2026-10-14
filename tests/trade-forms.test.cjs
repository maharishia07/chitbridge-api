/**
 * tests/trade-forms.test.cjs — PAPERS BY DEAL, THE DAY'S RATE, THE PACK'S TAX WORD (TRADE-SRV1 G5 · G6 · G7, 2026-10-14). No database.
 *
 *   G5  listInstances(entity, { context_ref, page, limit }) — the papers of ONE deal when context_ref names the chit; paginated with a
 *       top-level total that rides the same statement (one trip); a bad context_ref is ignored, not an error.
 *   G6  the commercial invoice carries `currency` and `exchange_rate`; the tax-id fields are labelled with the PACK's word (ABN · TRN · GSTIN),
 *       'Tax number' for a pack-less or unstated country; the country of origin is the shop's own, never "India" by default.
 *   G7  dayRateFor reads THE DAY'S RATE through fx-rates.rateOn (the one FX1 reader) for the deal's currency against the shop's on the invoice
 *       day — same currency or no rate → the field stays empty; the derived words name rate · source · day.
 * Run: node tests/trade-forms.test.cjs
 */
'use strict';
const assert = require('assert'), path = require('path');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';

const SHOP = '11111111-1111-4111-8111-111111111111', CHIT = '22222222-2222-4222-8222-222222222222';
let COUNTRY = 'AU', CURRENCY = 'AUD', RATE = { rate: 1.52, source: 'manual', date: '2027-04-05', source_ref: null };
const SQL = [];
async function answer(text, params) {
  SQL.push({ text: String(text).replace(/\s+/g, ' ').trim(), params });
  const t = String(text);
  if (/FROM identities WHERE identity_id/.test(t)) return { rows: [{ country: COUNTRY, currency_code: CURRENCY, display_name: 'Shop', gstn: null, address: null, phone: null, email: null, policy_flags: {} }] };
  if (/FROM chit_header/.test(t)) return { rows: [{ subject: 'INV-7', sender_entity_display_name: 'Shop', all_recipients: [{ role: 'receiver', display_name: 'Buyer LLC', entity_id: CHIT }], total_value: '1000', currency_code: 'usd', summary_json: { invoice_date: '2027-04-05' } }] };
  if (/FROM form_instance/.test(t)) return { rows: [{ form_id: 'f1', form_key: 'commercial-invoice', context_ref: CHIT, title: 'Commercial Invoice', content_hash: 'h', ready: true, signed_at: null, created_at: '2027-04-05T00:00:00Z', total: '3' }] };
  return { rows: [] };
}
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: answer, withEntity: async (_e, fn) => fn({ query: answer }), readBatch: async (_e, _a, stmts) => Promise.all(stmts.map((s) => answer(s.text, s.params))), withTransaction: async (fn) => fn({ query: answer }) } };
/* the FX1 reader, stubbed at its seam: rateOn(h, entity, from, to, date) */
const fxPath = require.resolve(path.join(API, 'lib', 'fx-rates'));
const asked = [];
require.cache[fxPath] = { id: fxPath, filename: fxPath, loaded: true, exports: { rateOn: async (_h, _e, from, to, date) => { asked.push([from, to, date]); return RATE; } } };

const F = require(path.join(API, 'lib', 'forms'));
const checks = [];
const it = (what, fn) => checks.push([what, fn]);

/* ── G5 ── */
it('listInstances by deal: context_ref filters, total rides the statement, top-level total/page/limit', async () => {
  SQL.length = 0;
  const out = await F.listInstances(SHOP, { context_ref: CHIT, page: 2, limit: 10 });
  const q = SQL.find((s) => /FROM form_instance/.test(s.text));
  assert.ok(/AND context_ref = \$2/.test(q.text), 'by deal');
  assert.ok(/COUNT\(\*\) OVER\(\) AS total/.test(q.text), 'the count in the same statement');
  assert.deepStrictEqual(q.params, [SHOP, CHIT, 10, 10]);
  assert.strictEqual(out.total, 3); assert.strictEqual(out.page, 2); assert.strictEqual(out.limit, 10); assert.strictEqual(out.context_ref, CHIT);
  assert.ok(out.instances[0].context_ref === CHIT && !('total' in out.instances[0]), 'rows carry context_ref, not the count');
});
it('listInstances without a deal: no filter, a bad context_ref ignored, defaults page 1 · limit 50 · max 200', async () => {
  SQL.length = 0;
  const out = await F.listInstances(SHOP, { context_ref: 'not-a-uuid', limit: 9999 });
  const q = SQL.find((s) => /FROM form_instance/.test(s.text));
  assert.ok(!/context_ref =/.test(q.text)); assert.deepStrictEqual(q.params, [SHOP, 200, 0]);
  assert.strictEqual(out.context_ref, null); assert.strictEqual(out.page, 1); assert.strictEqual(out.limit, 200);
});

/* ── G6 · G7 ── */
it('the commercial invoice of a USD deal from an AU shop: currency USD (the chit\'s), the day\'s rate from the server, the ABN label', async () => {
  COUNTRY = 'AU'; CURRENCY = 'AUD'; asked.length = 0;
  const r = await F.resolveForm(SHOP, 'commercial-invoice', { context_ref: CHIT });
  const f = (id) => r.fields.find((x) => x.id === id);
  assert.strictEqual(f('currency').value, 'USD'); assert.strictEqual(f('currency').source, 'order');
  assert.deepStrictEqual(asked, [['USD', 'AUD', '2027-04-05']], 'rateOn asked ONCE: the deal\'s currency against the shop\'s, on the invoice day');
  assert.strictEqual(f('exchange_rate').value, '1.52 USD to AUD (manual, 2027-04-05)');
  assert.strictEqual(f('exchange_rate').source, 'derive'); assert.strictEqual(f('exchange_rate').rung, 'derived');
  assert.strictEqual(f('seller_gstin').label, 'Seller ABN');
});
it('no rate for the day → the exchange rate stays empty and is not required (nothing computed, nothing fetched)', async () => {
  RATE = null; asked.length = 0;
  const r = await F.resolveForm(SHOP, 'commercial-invoice', { context_ref: CHIT });
  const x = r.fields.find((f) => f.id === 'exchange_rate');
  assert.strictEqual(x.value, null); assert.strictEqual(x.required, false); assert.strictEqual(r.ready, false, 'other required fields still decide readiness');
  RATE = { rate: 1.52, source: 'manual', date: '2027-04-05', source_ref: null };
});
it('same currency as the books → the reader is not even asked; a shop with no money → not asked', async () => {
  asked.length = 0; CURRENCY = 'USD';
  await F.resolveForm(SHOP, 'commercial-invoice', { context_ref: CHIT });
  assert.deepStrictEqual(asked, []);
  CURRENCY = null;
  await F.resolveForm(SHOP, 'commercial-invoice', { context_ref: CHIT });
  assert.deepStrictEqual(asked, []);
  CURRENCY = 'AUD';
});
it('the country of origin is the shop\'s own (Australia), never "India" by default; unstated → asked (null), the label says Tax number', async () => {
  COUNTRY = 'AU';
  const r = await F.resolveForm(SHOP, 'certificate-of-origin', {});
  assert.strictEqual(r.fields.find((f) => f.id === 'origin_country').value, 'Australia');
  COUNTRY = null; CURRENCY = null;
  const r2 = await F.resolveForm(SHOP, 'certificate-of-origin', {});
  const oc = r2.fields.find((f) => f.id === 'origin_country');
  assert.strictEqual(oc.value, null); assert.ok(r2.unresolved_required.some((u) => u.id === 'origin_country'), 'asked, not guessed');
  const a = await F.resolveForm(SHOP, 'authority-application', {});
  assert.strictEqual(a.fields.find((f) => f.id === 'gstin').label, 'Tax number');
  COUNTRY = 'IN'; CURRENCY = 'INR';
  const ci = await F.resolveForm(SHOP, 'commercial-invoice', {});
  assert.strictEqual(ci.fields.find((f) => f.id === 'seller_gstin').label, 'Seller GSTIN');
  COUNTRY = 'AE'; CURRENCY = 'AED';
  assert.strictEqual((await F.resolveForm(SHOP, 'commercial-invoice', {})).fields.find((f) => f.id === 'seller_gstin').label, 'Seller TRN');
  COUNTRY = 'AU'; CURRENCY = 'AUD';
});
it('deriveValue: india is gone (null); home_country · home_currency · day_rate read the context', () => {
  assert.strictEqual(F.deriveValue('india'), null);
  assert.strictEqual(F.deriveValue('home_country', { home: { name: 'United Arab Emirates' } }), 'United Arab Emirates');
  assert.strictEqual(F.deriveValue('home_currency', { home: { currency: 'AED' } }), 'AED');
  assert.strictEqual(F.deriveValue('day_rate', {}), null);
});

(async () => {
  let pass = 0, fail = 0;
  for (const [what, fn] of checks) {
    try { await fn(); pass++; console.log('   ok   ' + what); } catch (e) { fail++; console.log('   FAIL ' + what + '\n          ' + (e && e.message)); }
  }
  console.log('\n  ' + pass + ' passed · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
