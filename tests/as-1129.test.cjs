/**
 * tests/as-1129.test.cjs — WALK AS (India, 21 Nov 2026) fixes, batch 1129.
 *   AS-F-03  a rail invoice's number is required, in the country's format (docnumber.check), unique per seller per financial year (same client_ref = a replay, not a duplicate)
 *   AS-F-04  the credit note document is Typ CRN and carries the original bill's number and date (tax-lines / send-money)
 *   AS-F-07  /books/opening refuses a fractional minor unit in words (never rounds 100.5 to 101)
 *   AS-F-11  GSTIN verify refuses a wrong check character (party-fields.checkTaxId, the one the write uses)
 * Run: node tests/as-1129.test.cjs
 */
'use strict';
const path = require('path'), http = require('http');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
const HERE = path.join(__dirname, '..');
const express = require('express');
const rail = require(path.join(HERE, 'lib', 'rail-invoice-number.js'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

(async () => {
  console.log('\n== AS-F-03 · the rail invoice number, over express ==\n');
  const taken = new Set(['AS/26-27/0001']);
  const lookups = [];
  const step = rail.railNumberStep(async (id) => (id === 'IN' ? 'IN' : 'XX'), async (sender, purpose, number, since, ref) => { lookups.push({ purpose, number, since, ref }); return taken.has(purpose + ':' + number) || (purpose === 'invoice' && taken.has(number) && ref !== 'same') ? { chit_id: 'x' } : null; });
  const app = express();
  app.use(express.json());
  app.post('/send', async (req, res) => {
    if (await step({ sender_id: req.body.sender, is_draft: !!req.body.is_draft, client_ref: req.body.client_ref }, req, res)) return;
    if (!res.headersSent) res.json({ ok: true });
  });
  const server = await new Promise((resolve) => { const s = http.createServer(app).listen(0, () => resolve(s)); });
  const url = 'http://127.0.0.1:' + server.address().port + '/send';
  const post = async (body) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  const said = (r) => String(r.body.detail || r.body.message || '');
  const inv = (no, extra) => Object.assign({ sender: 'IN', purpose: 'invoice', business_json: no === undefined ? {} : { bill_no: no } }, extra || {});
  let r = await post(inv('AS/26-27/0002'));
  ok('India: a good number is let through', r.status === 200, JSON.stringify(r));
  r = await post(inv());
  ok('India: NO number is refused 422 BILL_NO_BAD in words', r.status === 422 && r.body.code === 'BILL_NO_BAD' && /needs its number/.test(said(r)), JSON.stringify(r));
  r = await post(inv('   '));
  ok('India: a blank number is refused', r.status === 422 && r.body.code === 'BILL_NO_BAD', JSON.stringify(r));
  r = await post(inv('ASx walk invoice number one 26 chars'));
  ok('India: 26+ characters with spaces is refused, naming the limit 16', r.status === 422 && /16/.test(said(r)), JSON.stringify(r));
  r = await post(inv('as 1'));
  ok('India: a space is refused for its character', r.status === 422 && /letters, numbers, \/ and -/.test(said(r)), JSON.stringify(r));
  r = await post(inv('AS/26-27/0001'));
  ok('India: the same number twice in the year is refused, in words', r.status === 422 && /already on an earlier invoice/.test(said(r)), JSON.stringify(r));
  r = await post(inv('AS/26-27/0001', { client_ref: 'same' }));
  ok('…but the same client_ref is a replay, not a duplicate', r.status === 200, JSON.stringify(r));
  r = await post(Object.assign(inv('AS/26-27/0001'), { purpose: 'credit_note' }));
  ok('a credit note has its own series: the invoice number is free there', r.status === 200, JSON.stringify(r));
  r = await post(inv(undefined, { is_draft: true }));
  ok('a draft is not judged', r.status === 200);
  r = await post(Object.assign(inv(undefined), { purpose: 'order' }));
  ok('an order is not a billing document: no number needed', r.status === 200);
  r = await post(Object.assign(inv(undefined), { business_json: { till: { id: 'C1' } } }));
  ok('a counter bill is judged at the till door, not here', r.status === 200);
  r = await post(Object.assign(inv(undefined), { sender: 'OTHER' }));
  ok('a country whose number rule is not verified is not judged (law is the pack, not a guess)', r.status === 200, JSON.stringify(r));
  ok('the year the lookup reads starts on 1 April for India', /-04-01$/.test(lookups[0].since), lookups[0].since);
  server.close();

  console.log('\n' + (fail ? 'FAILED ' + fail : 'all ok') + ' (' + pass + ' passed)');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
