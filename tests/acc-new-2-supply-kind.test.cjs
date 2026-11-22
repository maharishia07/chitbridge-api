/**
 * tests/acc-new-2-supply-kind.test.cjs — ACC-new-2 (l16-accfix): A SUPPLY KIND THE SHOP PACK DOES NOT DEFINE IS REFUSED, OVER REAL EXPRESS, FOR AU, AE AND IN.
 *
 * OWNS      lib/supply-kind.js refusalOf against the REAL packs + routes/chits.js sendSupplyKind (the real step, the real problem renderer): an AE shop that sends
 *           AU's `gst_free` → 422 SUPPLY_KIND_UNKNOWN listing standard, zero_rated, exempt; an AU shop's `zero_rated` → 422 listing taxable, gst_free, input_taxed;
 *           an India shop (the pack defines none) → 422 saying so; each country's OWN kinds, the spelling "Zero-Rated", no kind, a draft → 200 untouched.
 *           The e2e money test (16 Nov, AE) is the case: the books had posted `gst_free` to plain Sales with no VAT and VAT201 box 1 carried it.
 * CALLED BY by hand: node tests/acc-new-2-supply-kind.test.cjs
 * FLOW      POST body ──▶ express ──▶ sendSupplyKind(sendState from the body, db stand-in answers the shop country) ──▶ 422 problem | 200
 * CARD      counter/bill-slip
 */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
const HERE = path.join(__dirname, '..');
const SHOP = { AU: '11111111-1111-4111-8111-111111111111', AE: '22222222-2222-4222-8222-222222222222', IN: '99999999-9999-4999-8999-999999999999' };
const dbFile = require.resolve(path.join(HERE, 'db'));
const real = require(dbFile);
require.cache[dbFile].exports = Object.assign({}, real, {
  query: async (sql, params) => (/FROM identities WHERE identity_id/.test(sql) ? { rows: [{ country: Object.keys(SHOP).find((c) => SHOP[c] === (params && params[0])) || 'AU', gstn: null }], rowCount: 1 } : { rows: [], rowCount: 0 })
});
const express = require('express');
const chits = require(path.join(HERE, 'routes', 'chits.js'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

(async () => {
  console.log('\n== ACC-new-2 · a supply kind the pack does not define is refused (AU, AE, IN) ==\n');
  ok('routes/chits.js exports the real sendSupplyKind', typeof chits.sendSupplyKind === 'function');
  if (typeof chits.sendSupplyKind !== 'function') { console.log('\n' + pass + ' ok, ' + fail + ' failed'); process.exit(1); }
  const app = express();
  app.use(express.json());
  app.post('/send', async (req, res) => {
    const state = { sender_id: SHOP[req.body.country], business_json: req.body.business_json, is_draft: !!req.body.is_draft };
    if (await chits.sendSupplyKind(state, req, res)) return;
    if (!res.headersSent) res.json({ message: 'Chit sent successfully' });
  });
  const server = await new Promise((resolve) => { const s = http.createServer(app).listen(0, () => resolve(s)); });
  const url = 'http://127.0.0.1:' + server.address().port + '/send';
  const post = async (body) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const bill = (country, kind, extra) => Object.assign({ country, business_json: { bill_no: 'C1-1', invoice: { ItemList: [{ GstRt: 0 }, kind ? { GstRt: 0, supply_kind: kind } : { GstRt: 5 }] } } }, extra || {});
  const said = (r) => String(r.body.detail || r.body.message || '');

  /* the e2e case: AE shop, AU's word */
  let r = await post(bill('AE', 'gst_free'));
  ok('AE · "gst_free" → 422 SUPPLY_KIND_UNKNOWN', r.status === 422 && r.body.code === 'SUPPLY_KIND_UNKNOWN', JSON.stringify(r));
  ok('AE · the words name the line and list the pack kinds: standard, zero_rated, exempt', /Line 2/.test(said(r)) && /standard, zero_rated, exempt/.test(said(r)), said(r));
  ok('AE · the answer carries the kinds as data', JSON.stringify(r.body.kinds) === '["standard","zero_rated","exempt"]' && r.body.kind === 'gst_free', JSON.stringify(r.body));
  /* AU: the AE word */
  r = await post(bill('AU', 'zero_rated'));
  ok('AU · "zero_rated" → 422 listing taxable, gst_free, input_taxed', r.status === 422 && /taxable, gst_free, input_taxed/.test(said(r)), JSON.stringify(r));
  /* IN: the pack defines none */
  r = await post(bill('IN', 'gst_free'));
  ok('IN · an AU word (gst_free) → 422 listing the IN pack own kinds nil, exempt, non_gst (red1128: the IN pack defines kinds since tax01)', r.status === 422 && r.body.code === 'SUPPLY_KIND_UNKNOWN' && /nil, exempt, non_gst/.test(said(r)), JSON.stringify(r));
  /* the kinds each pack DOES define pass, spelt as the engine spells them */
  r = await post(bill('AE', 'zero_rated')); ok('AE · "zero_rated" → 200', r.status === 200, JSON.stringify(r));
  r = await post(bill('AE', 'Zero-Rated')); ok('AE · "Zero-Rated" (the engine spelling) → 200', r.status === 200, JSON.stringify(r));
  r = await post(bill('AE', 'exempt')); ok('AE · "exempt" → 200', r.status === 200);
  r = await post(bill('AU', 'gst_free')); ok('AU · "gst_free" → 200', r.status === 200, JSON.stringify(r));
  r = await post(bill('AU', 'input_taxed')); ok('AU · "input_taxed" → 200', r.status === 200);
  /* nothing named, a draft, no invoice */
  r = await post(bill('AE', null)); ok('AE · no kind named → 200', r.status === 200);
  r = await post(bill('IN', null)); ok('IN · no kind named → 200, untouched', r.status === 200);
  r = await post(bill('AE', 'gst_free', { is_draft: true })); ok('a draft is never stopped → 200', r.status === 200);
  r = await post({ country: 'AE', business_json: { bill_no: 'x' } }); ok('no invoice on the chit → 200', r.status === 200);
  /* the kind the engine recorded in _cb.kinds is read as well */
  r = await post({ country: 'AE', business_json: { invoice: { ItemList: [{ GstRt: 0 }], _cb: { kinds: [{ line: 0, kind: 'gst_free' }] } } } });
  ok('AE · a kind only in _cb.kinds (what the books read) → 422, line 1', r.status === 422 && /Line 1/.test(said(r)), JSON.stringify(r));
  server.close();

  /* the wire + the register */
  const src = require('../tools/chits-files.cjs').read(HERE);
  const steps = src.slice(src.indexOf('const SEND_STEPS = ['), src.indexOf('];', src.indexOf('const SEND_STEPS = [')));
  ok('SEND_STEPS runs sendSupplyKind right after sendCashStep', /sendCashStep,\s*sendSupplyKind,/.test(steps));
  const fn = src.slice(src.indexOf('async function sendSupplyKind('), src.indexOf('/** which copies a self-chit'));
  ok('sendSupplyKind has no try/catch (the refusal reaches the counter) and answers 422', fn.length > 0 && !/\btry\s*\{/.test(fn) && /status: 422/.test(fn));
  const reg = fs.readFileSync(path.join(HERE, 'docs', 'ERROR-CODES.md'), 'utf8');
  ok('SUPPLY_KIND_UNKNOWN is a row of the register, 422', /\| SUPPLY_KIND_UNKNOWN \| 422 \|/.test(reg));
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
