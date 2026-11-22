/**
 * tests/walkf-1128-core.test.cjs — WALK F (India, 21 Nov 2026) P2 findings, batch 1128, hand figures in paise where money.
 *   F-F-01  a GSTIN's state code must be 01-38, 97 or 99 (the list the lane named: CBIC state codes) — 00, 39, 45, 50, 96 are refused WITH a right check digit
 *   F-F-02  the financial-year month cannot move once a chit or a books entry exists (409 FY_FIXED_AFTER_BOOKS); before then it may; the same month re-sent is no change
 *   F-F-04  a counter bill's bill_no over India's 16 characters, or with a character outside letters / digits / - and /, is refused 422 BILL_NO_BAD in words
 *   F-F-05  an EMPTY bill_no on a counter bill is refused (it used to return 200 and exist nowhere); a country with an unchecked number rule still takes a non-empty one
 *   F-F-10  a composition (or unregistered) seller's counter invoice carrying tax is refused 422 TAX_NOT_CHARGEABLE: CGST 500 + SGST 500 paise (the walk: 5.00 + 5.00); a regular seller's is not
 * Run: node tests/walkf-1128-core.test.cjs
 */
'use strict';
const path = require('path'), http = require('http');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
const HERE = path.join(__dirname, '..');
const IN_SHOP = '99999999-9999-4999-8999-999999999999';
const dbFile = require.resolve(path.join(HERE, 'db'));
const real = require(dbFile);
require.cache[dbFile].exports = Object.assign({}, real, {
  query: async (sql, params) => (/FROM identities WHERE identity_id/.test(sql) ? { rows: [{ country: params && params[0] === IN_SHOP ? 'IN' : 'XX', gstn: null }], rowCount: 1 } : { rows: [], rowCount: 0 })
});
const express = require('express');
const chits = require(path.join(HERE, 'routes', 'chits.js'));
const profile = require(path.join(HERE, 'lib', 'profile.js'));
const countrySetup = require(path.join(HERE, 'lib', 'country-setup.js'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

/* the check digit by the official base-36 weights (1, 2), worked here so a GSTIN with ANY state prefix carries the right digit — the state is the thing under test */
const digitOf = (first14) => { const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'; let sum = 0; for (let i = 0; i < 14; i++) { const v = chars.indexOf(first14[i]); let p = v * (i % 2 === 0 ? 1 : 2); p = Math.floor(p / 36) + (p % 36); sum += p; } return chars[(36 - (sum % 36)) % 36]; };
const gstin = (state) => { const b = state + 'AAACB1234F1Z'; return b + digitOf(b); };

(async () => {
  console.log('\n== F-F-01 · GSTIN state code ==\n');
  ok('33 (Tamil Nadu) is accepted; its digit is the walk\'s own G', gstin('33') === '33AAACB1234F1ZG' && profile.taxIdRefusal('IN', gstin('33')) === null);
  ok('01 and 38 (the ends of the list) are accepted', profile.taxIdRefusal('IN', gstin('01')) === null && profile.taxIdRefusal('IN', gstin('38')) === null);
  ok('97 is accepted; 99 is refused as IN-F-02 decided (the centre jurisdiction code is never a shop; fixWalkF had accepted it: cb-country to confirm)', profile.taxIdRefusal('IN', gstin('97')) === null && profile.taxIdRefusal('IN', gstin('99')) !== null);
  for (const st of ['00', '39', '45', '50', '96', '98']) {
    const r = profile.taxIdRefusal('IN', gstin(st));
    ok(st + ' with a right check digit is refused, in words naming the state code', r && r.code === 'TAX_ID_BAD' && /state code/.test(r.why), JSON.stringify(r));
  }
  const wrongDigit = gstin('33').slice(0, 14) + (gstin('33')[14] === 'A' ? 'B' : 'A');
  ok('a wrong check digit is still the check-digit sentence (not the state one)', /look at the last character/.test((profile.taxIdRefusal('IN', wrongDigit) || {}).why || ''));

  console.log('\n== F-F-02 · the FY month is fixed once books exist ==\n');
  const shop = (by, fy) => ({ fy_start_month: fy, constituted_by: by });
  ok('a chit exists, April → January: refused 409 FY_FIXED_AFTER_BOOKS', (countrySetup.fyLockRefusal_(shop({ chits: true }, 4), 1) || {}).code === 'FY_FIXED_AFTER_BOOKS');
  const words = countrySetup.fyLockRefusal_(shop({ entries: true }, 4), 3).message;
  ok('…the words name the held month and what fixed it', /April/.test(words) && /books entries/.test(words), words);
  ok('the same month re-sent is no change', countrySetup.fyLockRefusal_(shop({ chits: true }, 4), 4) === null && countrySetup.fyLockRefusal_(shop({ chits: true }, 4), '4') === null);
  ok('only a product exists (no chit, no entry): the year may still be corrected', countrySetup.fyLockRefusal_(shop({ products: true }, 4), 1) === null);
  ok('nothing exists: setup, the year may be corrected', countrySetup.fyLockRefusal_(shop({}, 4), 1) === null);

  console.log('\n== F-F-04 / F-F-05 · the bill number, over express ==\n');
  const app = express();
  app.use(express.json());
  app.post('/send', async (req, res) => {
    const state = { sender_id: req.body.sender, is_draft: !!req.body.is_draft };
    if (await chits.sendBillNumber(state, req, res)) return;
    if (!res.headersSent) res.json({ ok: true });
  });
  const server = await new Promise((resolve) => { const s = http.createServer(app).listen(0, () => resolve(s)); });
  const url = 'http://127.0.0.1:' + server.address().port + '/send';
  const post = async (body) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const till = (no, sender) => ({ sender: sender || IN_SHOP, business_json: { bill_no: no, till: { id: 'C1' } } });
  const said = (r) => String(r.body.detail || r.body.message || '');
  let r = await post(till('C1/26-27/0001'));
  ok('India: C1/26-27/0001 (13 characters) is let through', r.status === 200, JSON.stringify(r));
  r = await post(till('WKF/2026-27/ABCDEFG1234567890'));
  ok('India: the 29-character number is refused 422 BILL_NO_BAD, naming 29 and 16', r.status === 422 && r.body.code === 'BILL_NO_BAD' && /29 characters/.test(said(r)) && /16/.test(said(r)), JSON.stringify(r));
  r = await post(till('WK#F 9 ??'));
  ok('India: "WK#F 9 ??" is refused for its characters', r.status === 422 && /letters, numbers, \/ and -/.test(said(r)), JSON.stringify(r));
  r = await post(till(''));
  ok('India: an EMPTY bill_no is refused (the sale no longer vanishes)', r.status === 422 && r.body.code === 'BILL_NO_BAD' && /empty/.test(said(r)), JSON.stringify(r));
  r = await post(till('   '));
  ok('…a blank one too', r.status === 422, JSON.stringify(r));
  r = await post(till('C1/26-27/0001', '11111111-1111-4111-8111-111111111111'));
  ok('a country whose number rule is unchecked: a non-empty number is let through (recorded, as before)', r.status === 200, JSON.stringify(r));
  r = await post(till('', '11111111-1111-4111-8111-111111111111'));
  ok('…but an empty one is refused there too', r.status === 422, JSON.stringify(r));
  r = await post({ sender: IN_SHOP, business_json: { bill_no: '', note: 'no till' } });
  ok('no till block: not a counter bill, untouched', r.status === 200, JSON.stringify(r));
  r = await post({ sender: IN_SHOP, is_draft: true, business_json: { bill_no: '', till: { id: 'C1' } } });
  ok('a draft is never stopped', r.status === 200, JSON.stringify(r));
  server.close();

  console.log('\n== F-F-10 · a shop that may not charge tax cannot issue a tax invoice ==\n');
  const inv = (cgst, sgst) => ({ ValDtls: { AssVal: 100, CgstVal: cgst / 100, SgstVal: sgst / 100, IgstVal: 0, CesVal: 0, TotInvVal: 100 + (cgst + sgst) / 100 } });
  const entry = (reg) => ({ seller: { RegType: reg } });
  const refusal = chits.taxNotChargeableRefusal(entry('composition'), { invoice: inv(500, 500) });
  ok('composition, CGST 500 + SGST 500 paise: refused TAX_NOT_CHARGEABLE', refusal && refusal.code === 'TAX_NOT_CHARGEABLE' && refusal.registration === 'composition', JSON.stringify(refusal));
  ok('…the words give the 10.00 of tax and say bill of supply', /10\.00/.test(refusal.message) && /bill of supply/.test(refusal.message), refusal.message);
  ok('unregistered charging IGST 9.00: refused', (chits.taxNotChargeableRefusal(entry('unregistered'), { invoice: { ValDtls: { IgstVal: 9 } } }) || {}).code === 'TAX_NOT_CHARGEABLE');
  ok('a regular seller charging tax: not refused', chits.taxNotChargeableRefusal(entry('regular'), { invoice: inv(500, 500) }) === null);
  ok('a composition bill with no tax: not refused', chits.taxNotChargeableRefusal(entry('composition'), { invoice: inv(0, 0) }) === null);
  ok('a seller whose registration is not known keeps the older name-it path', chits.taxNotChargeableRefusal(entry('unknown'), { invoice: inv(500, 500) }) === null);

  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
