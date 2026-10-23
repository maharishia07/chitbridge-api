/**
 * tests/pay-fix-void.test.cjs — PAY-FIX H3: WITHDRAWING A POSTED INVOICE POSTS THE REVERSAL (REVIEW-CLAUDE-2026-10-15 H3).
 *
 * Before: PUT /chits/:id/void ran the status gates and never looked at the books — the customer cancelled, the sent copy went
 * `cancelled`, and Dues · sales · output tax still carried the invoice (the classifier posts a sent invoice at send time).
 * Now, over the REAL chits router on the in-memory ledger (tests/support/books-harness): the withdrawal and the reversal of
 * `chit:<id>` are one transaction; the bill drops out of the party's open items; a chit that posted nothing says { none }; the
 * sender's own cancel through PUT /chits/:id/status reverses the same way; a counter's walk-in day leaves a cancelled bill out.
 * Offline. Run: node tests/pay-fix-void.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-pay-fix';
const H = require('./support/books-harness.cjs');
const jwt = require('jsonwebtoken');
const express = require('express');

let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };

const SHOP = '11111111-1111-4111-8111-111111111111', MALA = '22222222-2222-4222-8222-222222222222';
const C1 = '0000c417-0000-4000-8000-0000000000c1', C2 = '0000c417-0000-4000-8000-0000000000c2';
const one = (s) => String(s).replace(/\s+/g, ' ').trim();

(async () => {
  console.log('\n══ PAY-FIX H3 · withdraw → the books reverse the sale, in the same transaction ══');
  if (!H.enginesSrc().dir) { console.log('\n   SKIP: ' + H.enginesSrc().why + '\n'); process.exit(1); }
  const X = H.load();

  /* ── the chit world: chit_status rows + every statement, the books' own SQL (savepoints) handed to the harness ── */
  let STATUS = [], SENT = [];
  function rowsFor(sql, p) {
    const s = one(sql); p = p || []; SENT.push(s);
    const dir = (s.match(/direction = '(received|sent)'/) || [])[1];
    const mine = STATUS.filter((r) => r.chit_id === p[0] && r.entity_id === p[1] && (!dir || r.direction === dir));
    if (/^SELECT current_status FROM chit_status/.test(s)) return mine.map((r) => ({ current_status: r.current_status }));
    /* ORD-FIX O6: the write is compare-and-set (… AND current_status = $4) and RETURNING chit_id: only a row still holding the status the gate read moves, and the stub answers it so rowCount is real */
    if (/^UPDATE chit_status SET current_status = \$1/.test(s)) { const hit = STATUS.filter((r) => r.chit_id === p[1] && r.entity_id === p[2] && r.direction === dir && r.current_status === p[3]); hit.forEach((r) => { r.current_status = p[0]; }); return hit.map((r) => ({ chit_id: r.chit_id })); }
    if (/SELECT sender_entity_id FROM chit_header/.test(s)) return [{ sender_entity_id: SHOP }];
    if (/SELECT all_recipients FROM chit_header/.test(s)) return [{ all_recipients: [] }];
    return null;
  }
  const q = async (sql, p) => { const rows = rowsFor(sql, p); if (rows) return { rows, rowCount: rows.length }; try { return await X.db.query(sql, p); } catch (e) { if (/ran real SQL/.test(e.message)) return { rows: [], rowCount: 0 }; throw e; } };
  const tx = { query: q };
  Object.assign(X.dbStub, { query: q, pool: { query: q, connect: async () => Object.assign({ release() {} }, tx) }, withEntity: async (id, fn) => fn(tx), withTransaction: async (fn) => fn(tx), onEntity: async (id, db, fn) => fn(tx), readBatch: async () => ({}) });
  const sc = require(path.join(H.API, 'lib', 'schema')); sc.hasColumn = async () => false; sc.hasTable = async () => false;
  try { require(path.join(H.API, 'lib', 'whatsapp-out')).notifyChitStatus = async () => null; } catch (_) { /* not every checkout carries it */ }
  const origErr = console.error; console.error = () => {};
  const chits = require(path.join(H.API, 'routes', 'chits'));
  const app = express(); app.use(express.json()); app.use('/api/chits', chits);
  const tok = jwt.sign({ identity_id: SHOP, identity_type: 'entity', display_name: 'Chola Auto Care' }, process.env.JWT_SECRET, { algorithm: 'HS256' });
  function call(method, url, body) {
    return new Promise((done) => {
      const srv = app.listen(0, '127.0.0.1', () => {
        const data = body ? JSON.stringify(body) : '';
        const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: url, method, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
          let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => { srv.close(); let j = null; try { j = JSON.parse(b); } catch (_) { j = {}; } done({ status: res.statusCode, body: j || {} }); });
        });
        r.on('error', (e) => { srv.close(); done({ status: 'ERR ' + e.code, body: {} }); });
        r.end(data);
      });
    });
  }

  /* ── the books: on, one customer, the invoice C1 posted at send (as books-hooks.classify posts a sent invoice) ── */
  X.T.parties.push({ owner: SHOP, party_id: MALA, party_no: 'P-00001', name: 'Mala', customer: true, credit_days: 10 });
  await X.B.enable(X.db, SHOP, {});
  const posted = await X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: '2026-09-25', currency: 'INR', party: MALA, source_chit_id: C1, source_ref: 'chit:' + C1,
    by_rate: [{ rate: 18, taxable: 1000, cgst: 90, sgst: 90, igst: 0 }], paid: {}, round_off: 0 });
  const openOf = async (ref) => { const items = await X.B.partyItems(X.db, SHOP, MALA, null); const o = X.E.receivables().outstanding(items).by_ref[ref]; return o ? o.outstanding_minor : null; };
  t('the invoice is in the books before the withdrawal: ₹1,180 open from Mala', posted.ok && (await openOf(C1)) === 118000, JSON.stringify(posted));

  console.log('\n— A · PUT /chits/:id/void on a posted invoice —');
  STATUS = [{ chit_id: C1, entity_id: SHOP, direction: 'sent', current_status: 'delivered' }]; SENT = [];
  const entriesBefore = X.T.entries.length;
  let r = await call('PUT', '/api/chits/' + C1 + '/void', { reason: 'customer cancelled' });
  t('200, the sent copy cancelled through the gate', r.status === 200 && STATUS[0].current_status === 'cancelled', r.status + ' ' + JSON.stringify(r.body));
  const rev = X.T.entries.find((e) => e.source_ref === 'reverse:' + posted.entry_id);
  t('…and the books posted the REVERSAL of the invoice (source reverse:<entry>), named on the answer', !!rev && r.body.books && r.body.books.ok === true && r.body.books.reverses === posted.entry_no && r.body.books.entry_no === rev.entry_no, JSON.stringify(r.body.books));
  t('…the sale is out of Dues: ₹0 open from Mala on that bill', (await openOf(C1)) === 0, String(await openOf(C1)));
  t('…one entry was added, no second status writer, the reason on the narration', X.T.entries.length === entriesBefore + 1 && /Withdrawn: customer cancelled/.test(rev.narration), rev && rev.narration);
  const srcRoute = fs.readFileSync(path.join(H.API, 'routes', 'chits.js'), 'utf8');
  const voidSrc = srcRoute.slice(srcRoute.indexOf("router.put('/:chit_id/void'"), srcRoute.indexOf('// POST /chits/assign-bulk')); /* that route's opening line was re-wrapped; its comment is the stable end */
  t('the reversal is posted INSIDE the gate transaction (after g.write(), before the handle returns) — a refusal rolls the withdrawal back and answers 409 in words',
    voidSrc.indexOf('chitWithdrawn(db, entity_id, chit_id, reason') > voidSrc.indexOf('for (const g of gates) await g.write();')
    && /withdrawFailure\(req, res, err\)/.test(voidSrc) && /status: 409, \.\.\.said\(\{\s*error: 'Cannot withdraw',\s*code: err\.code \|\| 'BOOKS_REFUSED',\s*why: 'books_refused'/.test(srcRoute));

  console.log('\n— B · a chit the books never posted —');
  STATUS = [{ chit_id: C2, entity_id: SHOP, direction: 'sent', current_status: 'delivered' }]; SENT = [];
  r = await call('PUT', '/api/chits/' + C2 + '/void', { reason: 'ordered twice' });
  t('200 with books: { none } — nothing to reverse, nothing invented', r.status === 200 && r.body.books && r.body.books.none === true && X.T.entries.length === entriesBefore + 1, JSON.stringify(r.body));

  console.log('\n— C · the sender\'s own cancel (PUT /chits/:id/status) reverses the same way —');
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const posted3 = await X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: '2026-09-26', currency: 'INR', party: MALA, source_chit_id: C2, source_ref: 'chit:' + C2,
    by_rate: [{ rate: 0, taxable: 500, cgst: 0, sgst: 0, igst: 0 }], paid: {}, round_off: 0 });
  const w = await X.dbStub.withEntity(SHOP, (db) => K.chitWithdrawn(db, SHOP, C2, 'changed their mind', SHOP));
  const w2 = await X.dbStub.withEntity(SHOP, (db) => K.chitWithdrawn(db, SHOP, C2, 'changed their mind', SHOP));
  t('chitWithdrawn: the ONE helper both doors call — reverses once; the second call answers duplicate', w.ok === true && w.reverses === posted3.entry_no && w2.duplicate === true && (await openOf(C2)) === 0, JSON.stringify([w, w2]));
  const moveSrc = srcRoute.slice(srcRoute.indexOf('async function moveStatus('), srcRoute.indexOf("router.put('/:chit_id/void'"));
  const cancelSrc = srcRoute.slice(srcRoute.indexOf('async function cancelSentCopy('), srcRoute.indexOf('async function moveStatus('));
  t('moveStatus: the sender-cancel leg (cancelSentCopy) calls chitWithdrawnSaid on the sent copy\'s handle, after g.write(), and carries `books` on the answer (a refusal in words, never swallowed)',
    /if \(isSender && new_status === 'cancelled'\) booksOnCancel = await cancelSentCopy\(/.test(moveSrc) && cancelSrc.indexOf('chitWithdrawnSaid(db, entity_id, chit_id, note, by.id)') > cancelSrc.indexOf('await gate.write()')
    && /books: booksOnCancel/.test(moveSrc) && /refused: err\.message/.test(fs.readFileSync(path.join(H.API, 'lib', 'books-hooks.js'), 'utf8')));

  console.log('\n— D · the walk-in day leaves a cancelled bill out —');
  const storeSrc = fs.readFileSync(path.join(H.API, 'lib', 'books-store.js'), 'utf8');
  const cb = storeSrc.slice(storeSrc.indexOf('async function counterBills('), storeSrc.indexOf('async function unpostedChits('));
  t('counterBills: NOT EXISTS a cancelled / rejected status row for the bill', /NOT EXISTS \(SELECT 1 FROM chit_status cs WHERE cs\.chit_id = h\.chit_id AND cs\.entity_id = h\.entity_id AND cs\.current_status IN \('cancelled', 'rejected'\)\)/.test(cb));

  console.error = origErr;
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
