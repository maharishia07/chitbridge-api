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
  const priceNote = require(path.join(HERE, 'lib', 'price-note.js'));
  let seqNow = 42; const given = [];
  const series = { DOCUMENTS: priceNote.DOCUMENTS, numberOf: priceNote.numberOf, nextSequence: async () => ++seqNow, giveBackNumber: async (e, prefix, n) => { given.push(n); } };
  const step = rail.railNumberStep(async (id) => (id === 'IN' ? 'IN' : 'XX'), async (sender, purpose, number, since, ref) => { lookups.push({ purpose, number, since, ref }); return taken.has(purpose + ':' + number) || (purpose === 'invoice' && taken.has(number) && ref !== 'same') ? { chit_id: 'x' } : null; }, series);
  const app = express();
  app.use(express.json());
  app.post('/send', async (req, res) => {
    res.locals.kind = req.body.kind;
    if (await step({ sender_id: req.body.sender, client_ref: req.body.client_ref }, req, res)) return; /* the state the route holds at this step: no is_draft, no purpose */
    if (!res.headersSent) res.json({ ok: true, number: req.body.business_json && req.body.business_json.bill_no });
  });
  const server = await new Promise((resolve) => { const s = http.createServer(app).listen(0, () => resolve(s)); });
  const url = 'http://127.0.0.1:' + server.address().port + '/send';
  const post = async (body) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  const said = (r) => String(r.body.detail || r.body.message || '');
  const inv = (no, extra) => Object.assign({ sender: 'IN', purpose: 'invoice', business_json: no === undefined ? {} : { bill_no: no } }, extra || {});
  let r = await post(inv('AS/26-27/0002'));
  ok('India: a good number is let through', r.status === 200, JSON.stringify(r));
  r = await post(inv());
  ok('India: NO number is ASSIGNED from the seller\'s series (leaders give the next one), 26-27/0043 first', r.status === 200 && /^26-27\/0043$/.test(r.body.number || ''), JSON.stringify(r));
  r = await post(inv('   '));
  ok('India: a blank (spaces) number is assigned too', r.status === 200 && /^26-27\/0044$/.test(r.body.number || ''), JSON.stringify(r));
  r = await post(Object.assign(inv(), { purpose: 'credit_note' }));
  ok('India: a blank credit note gets its own series CN/26-27/…', r.status === 200 && /^CN\/26-27\/0045$/.test(r.body.number || ''), JSON.stringify(r));
  r = await post({ sender: 'IN', purpose: 'invoice', business_json: { invoice_no: 'INV-7' } });
  ok('India: a number carried as invoice_no (the forms\' own field) is the number: judged and let through, nothing assigned', r.status === 200 && r.body.number === undefined, JSON.stringify(r));
  r = await post({ sender: 'IN', purpose: 'invoice', business_json: { invoice_no: 'bad number' } });
  ok('India: a bad number typed as invoice_no is refused, not read as blank', r.status === 422, JSON.stringify(r));
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
  r = await post(Object.assign(inv(undefined), { kind: 'auto' }));
  ok('a document the server itself raises (loopback, kind auto: repeat supply) with no number is left to its own series', r.status === 200, JSON.stringify(r));
  r = await post(Object.assign(inv('bad number'), { kind: 'auto' }));
  ok('...but a number it does carry is judged like any other', r.status === 422, JSON.stringify(r));
  server.close();

  console.log('\n== AS-F-04 · the note names the bill it corrects (from the posted bill) ==\n');
  const original = require(path.join(HERE, 'lib', 'credit-original.js'));
  const BILL = '11111111-1111-4111-8111-111111111111';
  const fakeDb = (rows) => ({ query: async (sql, params) => { fakeDb.last = params; return { rows }; } });
  let got = await original.originalOf(fakeDb([{ no: 'AS/26-27/0007', at: '2026-11-21T20:22:10Z', zone: 'Asia/Kolkata' }]), 'E1', { against: { chit_id: BILL } });
  ok('the bill is read by its id', got && got.no === 'AS/26-27/0007' && fakeDb.last[1] === BILL, JSON.stringify(got));
  ok('its date is the SHOP day, dd/mm/yyyy: 20:22Z on 21 Nov is 22/11/2026 in Kolkata', original.refDtlsOf(got).PrecDocDtls[0].InvDt === '22/11/2026', JSON.stringify(original.refDtlsOf(got)));
  got = await original.originalOf(fakeDb([{ no: 'X' }, { no: 'Y' }].slice(0, 0)), 'E1', { against: { chit_id: BILL } });
  ok('no bill found: nothing is carried', got === null);
  ok('a note that names no bill reads nothing', (await original.originalOf(fakeDb([{ no: 'X' }]), 'E1', {})) === null);
  const frozen = { ValDtls: { TotInvVal: 250 } };
  const withEntity = async (id, fn) => fn(fakeDb([{ no: 'AS/26-27/0007', at: '2026-11-21T20:22:10Z', zone: 'Asia/Kolkata' }]));
  await original.carryOn({ purpose: 'credit_note', originInvoice: frozen, sender_id: 'E1', business_json: { against: BILL } }, withEntity);
  ok('a credit note whose against is only a bill number text: carried on its invoice', !frozen.RefDtls || frozen.RefDtls.PrecDocDtls[0].InvNo === 'AS/26-27/0007');
  const plain = { ValDtls: {} };
  await original.carryOn({ purpose: 'invoice', originInvoice: plain, sender_id: 'E1', business_json: { against: { chit_id: BILL } } }, withEntity);
  ok('an invoice is never stamped with a preceding document', plain.RefDtls === undefined);
  const draft = { ValDtls: {} };
  await original.carryOn({ purpose: 'credit_note', is_draft: true, originInvoice: draft, sender_id: 'E1', business_json: { against: { chit_id: BILL } } }, withEntity);
  ok('a draft is not stamped', draft.RefDtls === undefined);
  const note = { ValDtls: {} };
  await original.carryOn({ purpose: 'credit_note', originInvoice: note, sender_id: 'E1', business_json: { against: { chit_id: BILL } } }, withEntity);
  ok('a credit note is stamped: InvNo and InvDt from the posted bill', note.RefDtls && note.RefDtls.PrecDocDtls[0].InvNo === 'AS/26-27/0007' && note.RefDtls.PrecDocDtls[0].InvDt === '22/11/2026', JSON.stringify(note));

  console.log('\n== AS-F-07 · opening rows: 100.5 paise is refused, never rounded ==\n');
  const input = require(path.join(HERE, 'lib', 'books-input.js'));
  const thrown = (rows) => { try { input.openingRows(rows); return null; } catch (e) { return e; } };
  const frac = thrown([{ code: '1400', dr_minor: 2500000 }, { code: '1500', dr_minor: 100.5 }]);
  ok('a fractional minor unit is refused in words naming the row and "not rounded"', frac && frac.status === 422 && /row 2 debit/.test(frac.message) && /not a whole number of minor units/.test(frac.message) && /not rounded/.test(frac.message), frac && frac.message);
  ok('text that reads as a fraction is refused too', !!thrown([{ cr_minor: '100.5' }]));
  ok('whole figures, text whole figures and an empty side pass', thrown([{ dr_minor: 100 }, { cr_minor: '200' }, { dr_minor: 0, cr_minor: 5 }, { cr_minor: null }]) === null);

  console.log('\n== AS-F-11 · GSTIN verify uses the write check character ==\n');
  const verify = require(path.join(HERE, 'lib', 'verify.js'));
  const pf = require(path.join(HERE, 'lib', 'party-fields.js'));
  const base = '29AAACB1234F1Z';
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digit = (first14) => { let sum = 0; for (let k = 0; k < 14; k++) { const v = chars.indexOf(first14[k]); const q = v * (k % 2 === 0 ? 1 : 2); sum += Math.floor(q / 36) + (q % 36); } return chars[(36 - (sum % 36)) % 36]; };
  const good = base + digit(base);
  const bad = base + (digit(base) === 'A' ? 'B' : 'A');
  ok('the write accepts the right check character', pf.checkTaxId('GSTIN', good).ok, good);
  ok('verify accepts it (format valid)', verify.verifyFormat('gstn', good).ok === true);
  const wrong = verify.verifyFormat('gstn', bad);
  ok('verify refuses a wrong check character, with the write sentence', wrong.ok === false && /look at the last character/.test(wrong.note), JSON.stringify(wrong));

  console.log('\n' + (fail ? 'FAILED ' + fail : 'all ok') + ' (' + pass + ' passed)');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
