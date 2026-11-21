/**
 * tests/auae-1129.test.cjs - WALK AU (UAE) money findings AU-F-01 and AU-F-05 (22 Nov 2026).
 *
 * AU-F-01: PUT /chits/:id/void on a GOODS RECEIPT answered "Order withdrawn" and left the stock (60 + 10 received, the 60 voided: stock 70, hand 10).
 *   Now (lib/stock-void) the receipt's 'purchase' movements, found by the document's ref, are given back as 'purchase_return' under ref 'void:<ref>' through
 *   lib/stock-store.post (the ONE writer, idempotent on ref + line + reason + lot), and the answer says "Goods receipt withdrawn". Proved over the REAL chits router
 *   with an in-memory stock log standing in for the table; an order still says "Order withdrawn" and moves no stock; a second void moves nothing twice.
 * AU-F-05: a till bill with a quantity BELOW 0 is refused in words (BAD_QTY), because the engine floors a negative line to tax 0 so the books posted 841.00
 *   against the till's 821.00. Quantity 0 is NOT newly refused (the counter's queue retries a refusal for ever).
 * Hand: receipt 60 x 6.00 then 10 x 6.00; void the 60 -> 10 on the shelf.
 * Offline. Run: node tests/auae-1129.test.cjs · MIN unit-per-rule · refusal-path · fail-closed (a line the store refuses is SAID in the answer, never reported as taken back; a quantity below 0 is refused, never priced)
 */
'use strict';
const path = require('path');
const http = require('http');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-auae';
const H = require('./support/books-harness.cjs');
const jwt = require('jsonwebtoken');
const express = require('express');
let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };
const one = (s) => String(s).replace(/\s+/g, ' ').trim();
const SHOP = '11111111-1111-4111-8111-111111111111';
const R1 = '0000c417-0000-4000-8000-0000000000a1', R3 = '0000c417-0000-4000-8000-0000000000a4', O1 = '0000c417-0000-4000-8000-0000000000a3';
const ITEM = '44444444-4444-4444-8444-444444444444';

(async () => {
  if (!H.enginesSrc().dir) { console.log('\n   SKIP: ' + H.enginesSrc().why + '\n'); process.exit(1); }
  const X = H.load();
  const HEADERS = { [R1]: { purpose: 'receipt', business_json: { client_ref: 'GRN-1' } }, [R3]: { purpose: 'receipt', business_json: { client_ref: 'GRN-3' } }, [O1]: { purpose: 'order', business_json: {} } };
  const LOG = [
    { entity_id: SHOP, item_id: ITEM, location: 'main', qty: 60, unit: 'kg', lot: '', expires_at: null, item_kind: 'catalogue', line_ref: 'L1', reason: 'purchase', ref: 'GRN-1' },
    { entity_id: SHOP, item_id: ITEM, location: 'main', qty: 10, unit: 'kg', lot: '', expires_at: null, item_kind: 'catalogue', line_ref: 'L1', reason: 'purchase', ref: 'GRN-2' }
  ];
  let STATUS = [];
  const onHand = () => LOG.reduce((sum, row) => sum + (row.reason === 'purchase' ? row.qty : -row.qty), 0);
  function rowsFor(sql, p) {
    const s = one(sql); p = p || [];
    const dir = (s.match(/direction = '(received|sent)'/) || [])[1];
    const mine = STATUS.filter((r) => r.chit_id === p[0] && r.entity_id === p[1] && (!dir || r.direction === dir));
    if (/^SELECT current_status FROM chit_status/.test(s)) return mine.map((r) => ({ current_status: r.current_status }));
    if (/^UPDATE chit_status SET current_status = \$1/.test(s)) { const hit = STATUS.filter((r) => r.chit_id === p[1] && r.entity_id === p[2] && r.direction === dir && r.current_status === p[3]); hit.forEach((r) => { r.current_status = p[0]; }); return hit.map((r) => ({ chit_id: r.chit_id })); }
    if (/SELECT sender_entity_id FROM chit_header/.test(s)) return [{ sender_entity_id: SHOP }];
    if (/SELECT all_recipients FROM chit_header/.test(s)) return [{ all_recipients: [] }];
    if (/^SELECT purpose, business_json FROM chit_header/.test(s)) return HEADERS[p[0]] ? [HEADERS[p[0]]] : [];
    if (/FROM stock_movement WHERE entity_id = \$1 AND ref = \$2 AND reason = 'purchase'/.test(s)) return LOG.filter((r) => r.ref === p[1] && r.reason === 'purchase');
    return null;
  }
  const q = async (sql, p) => { const rows = rowsFor(sql, p); if (rows) return { rows, rowCount: rows.length }; try { return await X.db.query(sql, p); } catch (e) { if (/ran real SQL/.test(e.message)) return { rows: [], rowCount: 0 }; throw e; } };
  const tx = { query: q };
  Object.assign(X.dbStub, { query: q, pool: { query: q, connect: async () => Object.assign({ release() {} }, tx) }, withEntity: async (id, fn) => fn(tx), withTransaction: async (fn) => fn(tx), onEntity: async (id, db, fn) => fn(tx), readBatch: async () => ({}) });
  const sc = require(path.join(H.API, 'lib', 'schema')); sc.hasColumn = async () => false; sc.hasTable = async () => false;
  try { require(path.join(H.API, 'lib', 'whatsapp-out')).notifyChitStatus = async () => null; } catch (_) { /* not every checkout carries it */ }
  /* the ONE stock writer, stood in for by an in-memory log with its idempotency key (entity, ref, line_ref, reason, lot) */
  const store = require(path.join(H.API, 'lib', 'stock-store'));
  store.post = async (entity_id, mv) => {
    if (mv.ref === 'void:GRN-3') return { ok: false, why: 'this product is kept per batch' };
    const dup = LOG.find((r) => r.ref === mv.ref && r.line_ref === mv.line_ref && r.reason === mv.reason && r.lot === (mv.lot || ''));
    if (dup) return { ok: true, duplicate: true };
    LOG.push({ entity_id, item_id: mv.item_id, location: mv.location, qty: mv.qty, unit: mv.unit, lot: mv.lot || '', expires_at: mv.expires_at, item_kind: mv.item_kind, line_ref: mv.line_ref, reason: mv.reason, ref: mv.ref });
    return { ok: true, duplicate: false, below_zero: onHand() < 0 };
  };
  const origErr = console.error; console.error = process.env.SHOW_ERR ? origErr : () => {};
  const stockVoid = require(path.join(H.API, 'lib', 'stock-void'));
  const chits = require(path.join(H.API, 'routes', 'chits'));
  const app = express(); app.use(express.json()); app.use('/api/chits', chits);
  const tok = jwt.sign({ identity_id: SHOP, identity_type: 'entity', display_name: 'Karak House' }, process.env.JWT_SECRET, { algorithm: 'HS256' });
  const call = (method, url, body) => new Promise((done) => {
    const srv = app.listen(0, '127.0.0.1', () => {
      const data = body ? JSON.stringify(body) : '';
      const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: url, method, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
        let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => { srv.close(); let j = {}; try { j = JSON.parse(b); } catch (_) { j = {}; } done({ status: res.statusCode, body: j }); });
      });
      r.on('error', (e) => { srv.close(); done({ status: 'ERR ' + e.code, body: {} }); });
      r.end(data);
    });
  });

  console.log('\n- AU-F-01 · voiding a goods receipt takes its stock back -');
  t('before: 60 + 10 on the shelf', onHand() === 70, String(onHand()));
  STATUS = [{ chit_id: R1, entity_id: SHOP, direction: 'sent', current_status: 'delivered' }, { chit_id: O1, entity_id: SHOP, direction: 'sent', current_status: 'delivered' }];
  let r = await call('PUT', '/api/chits/' + R1 + '/void', { reason: 'keyed twice' });
  t('200 and the words are a RECEIPT words, not an order words', r.status === 200 && /^Goods receipt withdrawn/.test(r.body.message || ''), r.status + ' ' + JSON.stringify(r.body));
  t('the shelf now holds 10 (hand: 70 - 60), through a purchase_return under ref void:GRN-1', onHand() === 10 && LOG.some((x) => x.reason === 'purchase_return' && x.ref === 'void:GRN-1' && x.qty === 60 && x.line_ref === 'L1'), JSON.stringify(LOG.slice(2)));
  r = await call('PUT', '/api/chits/' + R1 + '/void', { reason: 'keyed twice' });
  t('the same void again (a replay) moves nothing twice: still 10', r.status === 200 && onHand() === 10 && LOG.length === 3, onHand() + ' ' + LOG.length);
  r = await call('PUT', '/api/chits/' + O1 + '/void', { reason: 'ordered twice' });
  t('an ORDER still says "Order withdrawn" and moves no stock', r.status === 200 && r.body.message === 'Order withdrawn' && onHand() === 10 && LOG.length === 3, JSON.stringify(r.body));

  LOG.push({ entity_id: SHOP, item_id: ITEM, location: 'main', qty: 5, unit: 'kg', lot: 'B1', expires_at: null, item_kind: 'catalogue', line_ref: 'L1', reason: 'purchase', ref: 'GRN-3' }); /* a receipt whose line the store will refuse */
  const gone = await stockVoid.reverseReceipt(SHOP, R3, async (id, fn) => fn(tx), {});
  t('a line the store refuses is SAID (failed + the words), nothing is claimed taken back, nothing thrown', !!gone && gone.failed.length === 1 && gone.moved === 0 && /could not come off the shelf: this product is kept per batch/.test(stockVoid.wordsFor(gone)), JSON.stringify(gone));
  t('a chit that is no receipt answers null, and no words', (await stockVoid.reverseReceipt(SHOP, O1, async (id, fn) => fn(tx), {})) === null && stockVoid.wordsFor(null) === null);
  t('stock sold in the meantime is said: below zero, count it', /below zero/.test(stockVoid.wordsFor({ failed: [], below_zero: ['L1'] })));

  console.log('\n- AU-F-05 · a negative quantity on a sale is refused in words -');
  const SM = require(path.join(H.API, 'lib', 'send-money'));
  const neg = SM.unreadableLine([{ name: 'Karak', quantity: 80, price: 10.5 }, { name: 'Karak', quantity: -2, price: 10.5 }]);
  t('quantity -2 (line 2) is BAD_QTY in words: a return is a credit note', !!neg && neg.line === 1 && neg.code === 'BAD_QTY' && /below 0/.test(neg.message) && /credit note/.test(neg.message), JSON.stringify(neg));
  t('the same under the key qty, and a numeric string', SM.unreadableLine([{ particulars: 'Tea', qty: '-1', price: 5 }]).code === 'BAD_QTY');
  t('quantity 0 and a positive quantity are NOT newly refused', SM.unreadableLine([{ name: 'a', quantity: 0, price: 1 }, { name: 'b', quantity: 2.5, price: 1 }]) === null);
  t('a removed line is skipped, and a line with no quantity is left to the shelf', SM.unreadableLine([{ name: 'a', quantity: -1, removed: true }, { name: 'b', price: 1 }]) === null);

  console.error = origErr;
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
