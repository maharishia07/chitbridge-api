/**
 * tests/ctry-148-gstr3b-composition-route.test.cjs — CTRY-148 at the ROUTE: GET /api/tax/gstr?form=gstr3b for a shop whose country setup says tax scheme composition.
 *
 * OWNS      the proof that the shop's registration type reaches gstr3b the normal way: country-setup saves tax.scheme 'composition' as identities.policy_flags.gst_registration
 *           (lib/country-setup.js), tax-copy ledgerFor reads the identities row (withRegistration, partyOf/regTypeOf) and the route hands that party to T.gstr3b.
 *           Composition (a shop WITH a GSTIN) -> 422 GSTR_REFUSED naming CMP-08 and GSTR-4; regular -> 200 with the figures; GSTR-1 stays 200 for both.
 *           Source: CGST Rules 2017 r.62 and Part B forms (cbic-gst.gov.in); GST portal CMP-08 FAQ 2, 11.
 * CALLED BY the test library (api T1). No database (stubbed as in acc-268). Run: node tests/ctry-148-gstr3b-composition-route.test.cjs
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
const SHOP = '11111111-1111-4111-8111-111111111111';
let fail = 0;
const ok = (name, cond, why) => { if (cond) console.log('   ok   ' + name); else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const AT = new Date().toISOString();
const month = AT.slice(0, 7);
const party = { role: 'sender', entity_id: SHOP, display_name: 'Cafe C' };
const invoice = { currency: 'INR', DocDtls: { Typ: 'INV' }, ItemList: [{ GstRt: 18, AssAmt: 500, CgstAmt: 45, SgstAmt: 45, IgstAmt: 0, CesAmt: 0 }], _cb: { supply: 'intra', slabs: [{ GstRt: 18, AssVal: 500, CgstVal: 45, SgstVal: 45, IgstVal: 0, CesVal: 0 }] }, ValDtls: { AssVal: 500, CgstVal: 45, SgstVal: 45, IgstVal: 0, CesVal: 0, TotInvVal: 590 } };
const bill = { chit_id: 'a0000000-0000-4000-8000-000000000001', sender_entity_id: SHOP, purpose: 'order', all_recipients: [party, Object.assign({}, party, { role: 'receiver' })], business_json: { customer: { name: 'Walk-in' }, till: { id: 'C1' }, bill_no: 'T1', billed_at: AT, invoice }, summary_json: { money: { total: 590 } }, sent_at: AT, created_at: AT, line_items: [{ line_id: 'l', particulars: 'x', quantity: 1, price: 500, total: 590, gst_rate: 18 }], currency_code: 'INR' };
/** the shop's identities row as country setup leaves it: tax.scheme saved as policy_flags.gst_registration */
const identity = (scheme) => ({ identity_id: SHOP, gstn: '33AAAAA0000A1Z5', display_name: 'Cafe C', country: 'IN', timezone: 'Asia/Kolkata', policy_flags: { price_includes_tax: 'no', gst_registration: scheme } });

(async () => {
  console.log('\n== CTRY-148 route: GSTR-3B for a composition shop ==\n');
  const authPath = require.resolve(path.join(API, 'middleware', 'auth')), taxPath = require.resolve(path.join(API, 'routes', 'tax'));
  const passAuth = new Proxy((req, res, next) => next(), { get: (fn, key) => (key === 'entityOf' ? () => SHOP : typeof fn[key] === 'undefined' ? () => (req, res, next) => next() : fn[key]) });
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: passAuth };
  const express = require('express'), http = require('http');
  const serve = async (scheme) => {
    const dbPath = require.resolve(path.join(API, 'db')), tcPath = require.resolve(path.join(API, 'lib', 'tax-copy'));
    require.cache[dbPath] = { exports: { query: async (sql) => ({ rows: /identities/.test(sql) ? [identity(scheme)] : [] }), withEntity: async (e, fn) => fn({ query: async () => ({ rows: [bill] }) }) } };
    delete require.cache[tcPath]; delete require.cache[taxPath];
    const app = express(); app.use('/api/tax', require(taxPath));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const get = (p) => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: server.address().port, path: p }, (res) => { let t = ''; res.on('data', (d) => { t += d; }); res.on('end', () => resolve({ status: res.statusCode, text: t })); }).on('error', reject));
    return { get, close: () => server.close() };
  };
  let s = await serve('composition');
  let r = await s.get('/api/tax/gstr?month=' + month + '&form=gstr3b'); s.close();
  ok('composition shop: GSTR-3B is 422 GSTR_REFUSED naming CMP-08 and GSTR-4', r.status === 422 && /GSTR_REFUSED/.test(r.text) && /CMP-08/.test(r.text) && /GSTR-4/.test(r.text), r.status + ' ' + r.text.slice(0, 300));
  s = await serve('regular');
  r = await s.get('/api/tax/gstr?month=' + month + '&form=gstr3b'); s.close();
  ok('regular shop: GSTR-3B is 200 with sup_details, unchanged', r.status === 200 && /sup_details/.test(r.text), r.status + ' ' + r.text.slice(0, 200));
  s = await serve('composition');
  r = await s.get('/api/tax/gstr?month=' + month + '&form=gstr1'); s.close();
  ok('composition shop: GSTR-1 is not changed by this fix (not 422 for composition)', r.status !== 422 || !/CMP-08/.test(r.text), r.status + ' ' + r.text.slice(0, 200));
  console.log(fail ? '\n' + fail + ' failed' : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
