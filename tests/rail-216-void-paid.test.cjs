/**
 * tests/rail-216-void-paid.test.cjs — RAIL-216 (P1): THE SELLER CANNOT VOID AN INVOICE THAT HAS A PAYMENT ON IT.
 *
 * Hand figures: an invoice of 70.00 + 10% tax 7.00 = 77.00 (7,700 minor). Over the REAL chits router (the real statusGate, the real void and
 * Mark-paid doors) on the in-memory ledger. Each way an invoice is made (tests/lib/bill-total-fixtures.cjs columns; PM/RULE-MATRIX.md C1/C2):
 *   B2B invoice         buyer marks it paid on THEIR copy → the sender learns through the rail's notice, not a shared row
 *   counter bill        the tender is on the bill (business_json.payment.parts) → paid at issue
 *   named counter bill  a named customer's bill paid LATER: the seller's own books hold the receipt allocated to it
 * and the cases: full · half (30.00 of 77.00) · paid then cleared (the buyer unmarks / the receipt is reversed) → void allowed again · unpaid → allowed ·
 * an ORDER with a mark → allowed (not an invoice) · a credit note → not asked.
 * The refusal is an RFC 9457 problem, 409, code CHIT_CONFLICT (registered), why 'paid', words that name the credit note; the sale stays (no reversal entry, no
 * status written, no state_log 'voided', no cancel message).
 * Offline. Run: node tests/rail-216-void-paid.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-rail-216';
const H = require('./support/books-harness.cjs');
const jwt = require('jsonwebtoken');
const express = require('express');
const fs = require('fs');

let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };

const SHOP = '11111111-1111-4111-8111-111111111111', BUYER = '33333333-3333-4333-8333-333333333333', MALA = '22222222-2222-4222-8222-222222222222';
const id = (n) => '0000c216-0000-4000-8000-0000000000' + String(n).padStart(2, '0');
const one = (s) => String(s).replace(/\s+/g, ' ').trim();
const IDEM = { n: 0 };

(async () => {
  console.log('\n══ RAIL-216 · a payment on the invoice blocks the seller\'s void ══');
  if (!H.enginesSrc().dir) { console.log('\n   SKIP: ' + H.enginesSrc().why + '\n'); process.exit(1); }
  const X = H.load();

  /* ── the chit world: one header per chit (sender · purpose · tender on the SENDER's copy · the buyer's mark on the BUYER's copy), statuses, timelines ── */
  const HEAD = {}; let STATUS = [], LOG = [], MSGS = 0;
  const counterBill = { bill_no: 'B-1', till: { id: 'T-1' } };
  const copyBusiness = (chit, entity) => (entity === chit.sender ? chit.sellerBusiness : chit.buyerBusiness) || {};
  function rowsFor(sql, p) {
    const s = one(sql); p = p || [];
    const dir = (s.match(/direction = '(received|sent)'/) || [])[1];
    const mine = STATUS.filter((r) => r.chit_id === p[0] && r.entity_id === p[1] && (!dir || r.direction === dir));
    if (/^SELECT current_status FROM chit_status/.test(s)) return mine.map((r) => ({ current_status: r.current_status }));
    if (/^UPDATE chit_status SET current_status = \$1/.test(s)) { const hit = STATUS.filter((r) => r.chit_id === p[1] && r.entity_id === p[2] && r.direction === dir && r.current_status === p[3]); hit.forEach((r) => { r.current_status = p[0]; }); return hit.map((r) => ({ chit_id: r.chit_id })); }
    if (/SELECT sender_entity_id FROM chit_header/.test(s)) return HEAD[p[0]] ? [{ sender_entity_id: HEAD[p[0]].sender }] : [];
    if (/SELECT all_recipients FROM chit_header/.test(s)) return [{ all_recipients: [] }];
    if (/^SELECT purpose, sender_entity_id, business_json FROM chit_header/.test(s)) return HEAD[p[0]] ? [{ purpose: HEAD[p[0]].purpose, sender_entity_id: HEAD[p[0]].sender, business_json: copyBusiness(HEAD[p[0]], p[1]) }] : [];
    if (/^SELECT business_json->'payment' AS payment FROM chit_header/.test(s)) return HEAD[p[0]] ? [{ payment: copyBusiness(HEAD[p[0]], p[1]).payment || null }] : [];
    if (/^SELECT 1 FROM state_log WHERE chit_id/.test(s)) return LOG.filter((r) => r.chit_id === p[0] && r.entity_id === p[1] && r.action === 'payment_marked').slice(0, 1).map(() => ({ '?column?': 1 }));
    if (/^SELECT chit_log_targets\(/.test(s)) { LOG.push({ chit_id: p[0], entity_id: p[1], action: p[2], actor: p[3] }); return [{ chit_log_targets: null }]; }
    if (/^INSERT INTO state_log/.test(s)) { LOG.push({ chit_id: p[0], entity_id: p[1], action: p[2] }); return []; }
    if (/jsonb_build_object\('payment'/.test(s)) { const c = HEAD[p[1]]; c.buyerBusiness = Object.assign({}, c.buyerBusiness, { payment: JSON.parse(p[0]) }); return [{ chit_id: p[1] }]; }
    if (/- 'payment' WHERE chit_id/.test(s)) { const c = HEAD[p[0]]; delete (c.buyerBusiness || {}).payment; return [{ chit_id: p[0] }]; }
    if (/FROM chit_header h .*WHERE h\.chit_id = \$1 AND h\.entity_id = \$2/.test(s)) { const c = HEAD[p[0]]; return c ? [{ chit_id: p[0], entity_id: p[1], sender_entity_id: c.sender, purpose: c.purpose, current_status: 'accepted', business_json: copyBusiness(c, p[1]), summary_json: { money: { total: 77 } } }] : []; }
    return null;
  }
  const q = async (sql, p) => { const rows = rowsFor(sql, p); if (rows) return { rows, rowCount: rows.length }; try { return await X.db.query(sql, p); } catch (e) { if (/ran real SQL/.test(e.message)) return { rows: [], rowCount: 0 }; throw e; } };
  const tx = { query: q };
  Object.assign(X.dbStub, { query: q, pool: { query: q, connect: async () => Object.assign({ release() {} }, tx) }, withEntity: async (eid, fn) => fn(tx), withTransaction: async (fn) => fn(tx), onEntity: async (eid, db, fn) => fn(tx), readBatch: async () => ({}) });
  const sc = require(path.join(H.API, 'lib', 'schema')); sc.hasColumn = async () => false; sc.hasTable = async () => false;
  try { require(path.join(H.API, 'lib', 'whatsapp-out')).notifyChitStatus = async () => null; } catch (_) { /* not every checkout carries it */ }
  try { require(path.join(H.API, 'lib', 'messages')).postMessageCopies = async () => { MSGS++; }; } catch (_) { /* the route's own import is used */ }
  /* the BUYER's books are not under test (their ledger is off in this world): the Mark-paid door's own mark + notice are */
  require(path.join(H.API, 'lib', 'books-hooks')).chitPaid = async () => ({ off: true });
  const origErr = console.error; console.error = () => {};
  const chits = require(path.join(H.API, 'routes', 'chits'));
  const app = express(); app.use(express.json()); app.use('/api/chits', chits);
  const tokOf = (who, name) => jwt.sign({ identity_id: who, identity_type: 'entity', display_name: name }, process.env.JWT_SECRET, { algorithm: 'HS256' });
  const TOK = { [SHOP]: tokOf(SHOP, 'Chola Auto Care'), [BUYER]: tokOf(BUYER, 'Mala Traders') };
  function call(as, method, url, body) {
    return new Promise((done) => {
      const srv = app.listen(0, '127.0.0.1', () => {
        const data = body ? JSON.stringify(body) : '';
        const headers = { Authorization: 'Bearer ' + TOK[as], 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'Idempotency-Key': 'rail216-' + (++IDEM.n) };
        const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: url, method, headers }, (res) => {
          let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => { srv.close(); let j = null; try { j = JSON.parse(b); } catch (_) { j = {}; } done({ status: res.statusCode, ctype: String(res.headers['content-type'] || ''), body: j || {} }); });
        });
        r.on('error', (e) => { srv.close(); done({ status: 'ERR ' + e.code, body: {} }); });
        r.end(data);
      });
    });
  }

  /* ── the books of the SELLER: on, one customer; each invoice posted at send (as books-hooks.classify posts a sent invoice) ── */
  X.T.parties.push({ owner: SHOP, party_id: MALA, party_no: 'P-00001', name: 'Mala', customer: true, credit_days: 10 });
  await X.B.enable(X.db, SHOP, {});
  const post = (chit) => X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: '2026-11-09', currency: 'INR', party: MALA, source_chit_id: chit, source_ref: 'chit:' + chit,
    by_rate: [{ rate: 10, taxable: 70, cgst: 3.5, sgst: 3.5, igst: 0 }], paid: {}, round_off: 0 });
  const reversalOf = (entry) => X.T.entries.find((e) => e.source_ref === 'reverse:' + entry.entry_id);
  const makeInvoice = async (n, purpose, extra) => {
    const chit = id(n);
    HEAD[chit] = Object.assign({ sender: SHOP, purpose, sellerBusiness: {}, buyerBusiness: {} }, extra || {});
    STATUS.push({ chit_id: chit, entity_id: SHOP, direction: 'sent', current_status: 'delivered' }, { chit_id: chit, entity_id: BUYER, direction: 'received', current_status: 'accepted' });
    return { chit, entry: purpose !== 'credit_note' ? await post(chit) : null };
  };
  const sentStatus = (chit) => STATUS.find((r) => r.chit_id === chit && r.entity_id === SHOP).current_status;
  const VOID = (chit) => call(SHOP, 'PUT', '/api/chits/' + chit + '/void', { reason: 'wrong customer' });
  const BUYER_PAYS = (chit, amount) => call(BUYER, 'POST', '/api/chits/' + chit + '/payment', { method: 'cash', amount });
  const registered = JSON.parse(fs.readFileSync(path.join(H.API, 'docs', 'error-codes.json'), 'utf8'));
  const codes = new Set((Array.isArray(registered) ? registered : registered.codes || []).map((x) => x.code));
  const refusedPaid = (name, r, chit, entry) => {
    t(name + ' · 409 in the problem shape (application/problem+json, type · title · status · detail)', r.status === 409 && /problem\+json/.test(r.ctype) && r.body.type && r.body.title && r.body.status === 409 && r.body.detail, r.status + ' ' + r.ctype + ' ' + JSON.stringify(r.body));
    t(name + ' · a REGISTERED code (CHIT_CONFLICT) and why "paid", the words name the credit note', r.body.code === 'CHIT_CONFLICT' && codes.has('CHIT_CONFLICT') && r.body.why === 'paid' && /credit note/i.test(r.body.detail || r.body.message || ''), JSON.stringify(r.body));
    t(name + ' · the sale stays: copy not cancelled, no reversal posted, no "voided" row, no cancel message', sentStatus(chit) === 'delivered' && !reversalOf(entry) && !LOG.some((x) => x.chit_id === chit && x.action === 'voided'), sentStatus(chit));
  };

  console.log('\n— 1 · B2B invoice, the BUYER pays, the SELLER voids —');
  let inv = await makeInvoice(1, 'invoice');
  let pay = await BUYER_PAYS(inv.chit, 77);
  t('the buyer\'s Mark-paid answers 200 (the payment stands on the buyer\'s copy)', pay.status === 200, pay.status + ' ' + JSON.stringify(pay.body));
  let v = await VOID(inv.chit);
  refusedPaid('full payment', v, inv.chit, inv.entry);
  const msgs = MSGS;
  t('…and the buyer was never written by the void (their copy stays accepted)', STATUS.find((r) => r.chit_id === inv.chit && r.entity_id === BUYER).current_status === 'accepted' && MSGS === msgs);

  console.log('\n— 2 · half paid (30.00 of 77.00) —');
  inv = await makeInvoice(2, 'invoice');
  pay = await BUYER_PAYS(inv.chit, 30);
  v = await VOID(inv.chit);
  refusedPaid('half payment', v, inv.chit, inv.entry);

  console.log('\n— 3 · paid, then the buyer clears the mark: the notice is monotonic, the void stays refused (refund = credit note) —');
  inv = await makeInvoice(3, 'invoice');
  await BUYER_PAYS(inv.chit, 77);
  const unmark = await call(BUYER, 'DELETE', '/api/chits/' + inv.chit + '/payment');
  v = await VOID(inv.chit);
  t('the buyer\'s DELETE /payment answers 200 and the void is STILL refused (the buyer\'s books keep the payment)', unmark.status === 200, String(unmark.status));
  refusedPaid('paid then cleared', v, inv.chit, inv.entry);

  console.log('\n— 4 · unpaid invoice, an order with a mark, a credit note —');
  inv = await makeInvoice(4, 'invoice');
  v = await VOID(inv.chit);
  t('unpaid invoice → 200 and the sale reversed (nothing changed for the ordinary void)', v.status === 200 && sentStatus(inv.chit) === 'cancelled' && !!reversalOf(inv.entry), v.status + ' ' + JSON.stringify(v.body));
  inv = await makeInvoice(5, 'order');
  await BUYER_PAYS(inv.chit, 77);
  v = await VOID(inv.chit);
  t('an ORDER the buyer marked paid → 200 (the rule is the invoice\'s: an order\'s cancel stays a request)', v.status === 200 && sentStatus(inv.chit) === 'cancelled', v.status + ' ' + JSON.stringify(v.body));
  inv = await makeInvoice(6, 'credit_note', { sellerBusiness: { payment: { method: 'cash' } } });
  v = await VOID(inv.chit);
  t('a credit note (own purpose) is not asked → 200', v.status === 200, v.status + ' ' + JSON.stringify(v.body));

  console.log('\n— 5 · counter bill: the tender is on the bill (paid at issue) —');
  inv = await makeInvoice(7, 'order', { sellerBusiness: { ...counterBill, payment: { parts: [{ how: 'cash', amount: 77 }] } } });
  v = await VOID(inv.chit);
  refusedPaid('counter bill with tender', v, inv.chit, inv.entry);

  inv = await makeInvoice(9, 'order', { sellerBusiness: { ...counterBill, payment: { parts: [{ how: 'credit', amount: 77 }] } } });
  v = await VOID(inv.chit);
  t('a counter bill sold on CREDIT (no money came) → 200, the credit sale can be withdrawn', v.status === 200 && sentStatus(inv.chit) === 'cancelled', v.status + ' ' + JSON.stringify(v.body));

  console.log('\n— 6 · named counter bill, paid LATER: the seller\'s own books hold the receipt —');
  inv = await makeInvoice(8, 'order', { sellerBusiness: { ...counterBill, customer: { name: 'Mala' } } });
  const rec = await X.B.recordPayment(X.db, SHOP, { party_id: MALA, direction: 'in', mode: 'cash', amount_minor: 3000, currency: 'INR', received_at: '2026-11-09', client_ref: 'rail216-rec-1', by: SHOP, allocations: [{ against_ref: inv.chit, amount_minor: 3000 }] });
  v = await VOID(inv.chit);
  t('a partial receipt (30.00) allocated in the seller\'s books was recorded', rec && (rec.ok !== false), JSON.stringify(rec).slice(0, 200));
  refusedPaid('named bill with a receipt in the books', v, inv.chit, inv.entry);
  const payEntry = await X.store.entryBySource(X.db, SHOP, 'pay:' + rec.payment.payment_id);
  const undone = await X.B.reverseEntry(X.db, SHOP, payEntry.entry_id, { reason: 'receipt entered in error', by: SHOP });
  v = await VOID(inv.chit);
  t('…the seller reverses that receipt in the seller\'s own books (the seller recorded it) → the void is allowed again', undone && undone.ok !== false && v.status === 200 && !!reversalOf(inv.entry), v.status + ' ' + JSON.stringify(v.body).slice(0, 300) + ' ' + JSON.stringify(undone).slice(0, 200));

  console.log('\n— 6b · the sender\'s own cancel through PUT /status is the same gate (self-chit: both copies mine) —');
  inv = await makeInvoice(10, 'invoice', { sellerBusiness: { payment: { method: 'cash', amount: 77 } } });
  STATUS.push({ chit_id: inv.chit, entity_id: SHOP, direction: 'received', current_status: 'accepted' });
  const st = await call(SHOP, 'PUT', '/api/chits/' + inv.chit + '/status', { status: 'cancelled' });
  t('a paid invoice cancelled by its sender through the status door → 409 why paid, nothing reversed', st.status === 409 && st.body.why === 'paid' && !reversalOf(inv.entry), st.status + ' ' + JSON.stringify(st.body).slice(0, 300));

  console.log('\n— 7 · the rule lives in the ONE gate, not in the route —');
  const gateSrc = fs.readFileSync(path.join(H.API, 'lib', 'rail-status.js'), 'utf8'), routeSrc = fs.readFileSync(path.join(H.API, 'routes', 'chits.js'), 'utf8');
  const voidSrc = routeSrc.slice(routeSrc.indexOf("router.put('/:chit_id/void'"), routeSrc.indexOf('// POST /chits/assign-bulk'));
  t('statusGate asks paidRefusal; the void route only words the verdict (no paidFactsOf in the route, no second status path)', /paidRefusal\(db, entity_id, chit_id/.test(gateSrc) && !/paidFactsOf/.test(voidSrc) && !/SET current_status/.test(voidSrc));

  console.log('\n— 8 · a buyer whose payment folder (R-1400) is restricted still counts; the marker is not news —');
  const policy = require(path.join(H.API, 'lib', 'policy')); const policyGet = policy.get;
  policy.get = async () => { throw new Error('the folder level must not be consulted by the paid notice'); };
  inv = await makeInvoice(11, 'invoice');
  const payR = await BUYER_PAYS(inv.chit, 77);
  v = await VOID(inv.chit);
  policy.get = policyGet;
  t('the buyer\'s Mark-paid delivers the marker whatever the folder level (policy never read) → void 409 paid', payR.status === 200 && v.status === 409 && v.body.why === 'paid', payR.status + '/' + v.status);
  const notifSrc = fs.readFileSync(path.join(H.API, 'routes', 'notifications.js'), 'utf8');
  t('the marker carries no actor (action_by_identity_id NULL), so the bell feed and badge never count it', LOG.some((x) => x.action === 'payment_marked') && LOG.filter((x) => x.action === 'payment_marked').every((x) => x.actor === null));
  t('the seller\'s detail timeline leaves the marker out', /action NOT IN \('read', 'payment_marked'\)/.test(routeSrc));

  console.log('\n— 9 · lib/chit-paid, unit: one rule per fact, the refusal path, fail-closed —');
  const chitPaid = require(path.join(H.API, 'lib', 'chit-paid'));
  const dead = { query: async () => { throw new Error('database down'); } };
  let failedClosed = false; try { await chitPaid.paidFactsOf(dead, SHOP, id(1)); } catch (e) { failedClosed = /database down/.test(e.message); }
  t('fail-closed: a read that fails THROWS (the void then answers an error, it never reads "unpaid" and reverses the sale)', failedClosed);
  let noticeThrows = false; try { await chitPaid.tellPaid(dead, BUYER, id(1)); } catch (e) { noticeThrows = true; }
  t('fail-closed: a notice that cannot be delivered throws, so the buyer\'s mark is not saved without it', noticeThrows);
  t('unit per rule: an order, a credit note and a chit I did not send are not asked (false)', (await chitPaid.paidFactsOf(tx, SHOP, id(5))) === false && (await chitPaid.paidFactsOf(tx, SHOP, id(6))) === false && (await chitPaid.paidFactsOf(tx, BUYER, id(1))) === false);
  t('unit per rule: the refusal words name the credit note and carry why "paid"', chitPaid.PAID_SAID.why === 'paid' && /credit note/.test(chitPaid.PAID_SAID.message) && chitPaid.NOTICE.marked === 'payment_marked');

  console.log('\n— 10 · every reader of state_log is named: none can show the payment marker —');
  const READERS = { 'lib/bill-steps.js': 1, 'routes/chits.js': 1, 'routes/notifications.js': 1, 'lib/chit-paid.js': 1 }; /* bill-steps: allow-list of actions · chits.js: name subqueries read action created only, the pulse reads MAX(created_at), the detail timeline excludes payment_marked · notifications: NULL actor never passes <> me, clear-all inserts ids and shows nothing · chit-paid: reads it by its exact action */
  const readsLog = /\b(FROM|JOIN)\s+state_log\b/i;
  const hits = []; for (const dir of ['routes', 'lib']) for (const f of fs.readdirSync(path.join(H.API, dir))) { if (/\.js$/.test(f) && readsLog.test(fs.readFileSync(path.join(H.API, dir, f), 'utf8').replace(/INSERT INTO state_log[^;`]*?SELECT[^;`]*?FROM state_log/gi, ''))) hits.push(dir + '/' + f); }
  const unknown = hits.filter((f) => !READERS[f]);
  t('a file that reads state_log and is not in the reviewed list fails here (name it: exclude payment_marked or say why it cannot surface): ' + JSON.stringify(unknown), unknown.length === 0);
  t('the feed keeps the NULL-actor comment and the <> test (not IS DISTINCT FROM)', /ON PURPOSE/.test(notifSrc) && /sl\.action_by_identity_id <> \$2/.test(notifSrc) && !/action_by_identity_id IS DISTINCT FROM \$2/.test(notifSrc));

  console.error = origErr;
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { process.stderr.write(String(e && e.stack) + String.fromCharCode(10)); process.exit(1); });
