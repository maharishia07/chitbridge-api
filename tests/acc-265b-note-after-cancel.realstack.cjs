'use strict';
/**
 * tests/acc-265b-note-after-cancel.realstack.cjs — ACC-265b: A NOTE AFTER THE CANCEL IS REFUSED; A REJECT WITH A LIVE NOTE IS REFUSED (real Postgres, api as cb_app).
 *
 * Before (probed on #1201 head 0fafccf3): a note struck after the sale was cancelled answered 200 (Receivables -35400, Sales returns +30000, tax +2700 +2700, no sale left); a sale with a live note moved to rejected answered 200.
 * Now: 409 BILL_WITHDRAWN and 409 CHIT_HAS_CREDIT_NOTE; nothing written. Hand figures as acc-265-cancel-credit-note.realstack.cjs (sale 118000 = 100000 + 9000 + 9000; note 35400 = 30000 + 2700 + 2700).
 * Run: node tests/acc-265-cancel-credit-note.realstack.cjs   (API_BASE / TRUTH_DB as tests/lib/truth-harness.cjs says; LOCAL ONLY)
 * CARD 01-rail-core-the-chit/status-the-one-status-writer (ACC-265)
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { API, j, ok, pause, kase, expect, bill, creditNote, freshShop, finish } = H;
const RUN = 'b265' + (Date.now() % 1e9).toString(36);
const piece = { id: undefined, name: 'Steel box ' + RUN, unit: 'piece', price: 1000, gst_rate: 18 };
const tax = require('../lib/tax');
const ON_CREDIT = [{ how: 'On credit', amount: 1180 }];
/** a GSTIN the api's own checksum accepts (lib/profile-map) */
const gstinOf = (pan) => { const base = '33' + pan + '1Z'; return base + require('../lib/profile-map').gstinChecksum(base + '0').expected; };
const SHOP_GSTIN = gstinOf('AAKCK' + String(Date.now()).slice(-4) + 'F'), BUYER_GSTIN = gstinOf('AABFS4821K');
/** the engine's own invoice for `qty` x 1,000.00 + 18% (the carried invoice the till sends: lib/tax determine) — the hand figures above are asserted on the books, not on this */
const invoiceOf = (qty) => tax.determine({ seller: { Gstin: SHOP_GSTIN, LglNm: 'Cancel note', TrdNm: 'Cancel note', Addr1: '', Ph: '', State: '33', Country: 'IN', RegType: 'regular' }, buyer: { LglNm: 'Murugan', Gstin: BUYER_GSTIN, State: '33', RegType: 'regular', Country: 'IN', Pos: '33' }, lines: [{ id: '1', name: 'Steel box', unit: 'piece', hsn: '7323', qty, unit_price: 1000, discount: 0, gst_rate: 18, cess_rate: 0 }], priceIncludesTax: false });
const SALE_INV = invoiceOf(1), NOTE_INV = invoiceOf(0.3);

const NOTE_TB = { 1300: 82600, 4000: -100000, 4090: 30000, 2200: -6300, 2201: -6300 };

/** the trial balance as { code: dr - cr } in minor units, zero rows dropped (books settle after the commit: a short wait first) */
async function tb(token) {
  await pause(3500);
  const r = ok(await j('/api/books/trial-balance?asOf=2026-11-30', { token }), 'trial balance').b;
  const out = {};
  (r.rows || []).forEach((row) => { const net = (row.dr_minor || 0) - (row.cr_minor || 0); if (net) out[row.code] = net; });
  return out;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rowsOf = async (pg, entity, chit) => (await pg.query("SELECT (SELECT count(*)::int FROM state_log WHERE chit_id = $1 AND entity_id = $2 AND action = 'voided') AS voided, (SELECT string_agg(direction || ':' || current_status, ',' ORDER BY direction) FROM chit_status WHERE chit_id = $1 AND entity_id = $2) AS status", [chit, entity])).rows[0];
const send = (shop, body) => j('/api/chits/send', { method: 'POST', token: shop.token, body });
const idOf = (r) => r.b.chit_id || (r.b.chit && r.b.chit.chit_id);

(async () => {
  console.log('\n── ACC-265b note after cancel / reject with a note · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  const pg = new Client({ connectionString: H.DB }); await pg.connect();
  try {
    const S = await freshShop(RUN, 'Note after cancel', { tax: { registered: true, number: SHOP_GSTIN, scheme: 'regular' } });
    ok(await j('/api/books/enable', { method: 'POST', token: S.token, body: { walkin_grain: 'bill' } }), 'books on');
    const made = ok(await j('/api/relationships/customers', { method: 'POST', token: S.token, body: { name: 'Murugan ' + RUN, phone: '98400' + String(Date.now()).slice(-5), gstin: BUYER_GSTIN } }), 'customer').b;
    const customer = { name: 'Murugan ' + RUN, identity_id: made.customer && made.customer.customer_identity_id, gstin: BUYER_GSTIN, phone: null };
    const saleOf = (no) => bill(no, [[piece, 1]], { invoice: SALE_INV, customer, parts: ON_CREDIT, slip: 'credit', terms: { due_date: '2099-12-01' } });
    const noteOf = (no, against, againstId) => creditNote(no, against, [[piece, 0.3]], { againstId, invoice: NOTE_INV, parts: [], customer });
    const send = (body) => j('/api/chits/send', { method: 'POST', token: S.token, body });
    const idOf = (r) => r.b.chit_id || (r.b.chit && r.b.chit.chit_id);
    const noteRows = async () => (await pg.query("SELECT count(*)::int AS n FROM chit_header WHERE entity_id = $1 AND purpose = 'credit_note' AND role <> 'Draft'", [S.entity])).rows[0].n;
    const refusedNote = (r) => expect(r.status === 409 && r.b.code === 'BILL_WITHDRAWN' && /cancelled/i.test(String(r.b.detail || r.b.message)), 'expected 409 BILL_WITHDRAWN in words, got ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 300));

    await kase('B-1', 'sale cancelled, then a note against it: 409 BILL_WITHDRAWN, no note chit, books stay at zero (hand: sale 118000/100000/9000/9000 reversed whole = every account 0)', async () => {
      const sale = ok(await send(saleOf('S1/' + RUN)), 'sale'); const id = idOf(sale);
      expect(same(await tb(S.token), { 1300: 118000, 4000: -100000, 2200: -9000, 2201: -9000 }), 'sale books');
      ok(await j('/api/chits/' + id + '/void', { method: 'PUT', token: S.token, body: { reason: 'cancel' } }), 'cancel');
      expect(same(await tb(S.token), {}), 'books after cancel not zero');
      refusedNote(await send(noteOf('CN1/' + RUN, 'S1/' + RUN, id)));
      refusedNote(await send(noteOf('CN1b/' + RUN, 'S1/' + RUN, undefined))); /* by number on its own till */
      expect(await noteRows() === 0, 'a note chit was saved');
      expect(same(await tb(S.token), {}), 'the books moved: ' + JSON.stringify(await tb(S.token)));
    });
    await kase('B-2', 'a sale with a live note moved to rejected (PUT /status): 409 CHIT_HAS_CREDIT_NOTE, status and books unchanged (hand: 1300 82600, 4000 -100000, 4090 30000, 2200 -6300, 2201 -6300)', async () => {
      const sale = ok(await send(saleOf('S2/' + RUN)), 'sale2'); const id = idOf(sale);
      const note = ok(await send(noteOf('CN2/' + RUN, 'S2/' + RUN, id)), 'note2');
      expect(same(await tb(S.token), { 1300: 82600, 4000: -100000, 4090: 30000, 2200: -6300, 2201: -6300 }), 'books with note');
      const r = await j('/api/chits/' + id + '/status', { method: 'PUT', token: S.token, body: { status: 'rejected', note: 'reject' } });
      expect(r.status === 409 && r.b.code === 'CHIT_HAS_CREDIT_NOTE' && r.b.notes && r.b.notes[0] === idOf(note), 'expected 409 CHIT_HAS_CREDIT_NOTE, got ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 300));
      const st = (await pg.query("SELECT string_agg(direction || ':' || current_status, ',' ORDER BY direction) AS s FROM chit_status WHERE chit_id = $1 AND entity_id = $2", [id, S.entity])).rows[0].s;
      expect(!/rejected|cancelled/.test(st), 'status moved: ' + st);
      expect(same(await tb(S.token), { 1300: 82600, 4000: -100000, 4090: 30000, 2200: -6300, 2201: -6300 }), 'books moved');
    });
    await kase('B-3', 'a sale with NO note rejected is still allowed (200, reversed whole), and a note after the reject is refused BILL_WITHDRAWN', async () => {
      const before = await tb(S.token);
      const sale = ok(await send(saleOf('S3/' + RUN)), 'sale3'); const id = idOf(sale);
      ok(await j('/api/chits/' + id + '/status', { method: 'PUT', token: S.token, body: { status: 'rejected', note: 'reject' } }), 'reject');
      expect(same(await tb(S.token), before), 'a rejected sale did not net to the books before it');
      refusedNote(await send(noteOf('CN3/' + RUN, 'S3/' + RUN, id)));
      expect(same(await tb(S.token), before), 'the books moved after the refused note');
    });
    await kase('B-4', 'a note on a LIVE bill is still accepted (35400 receivable credit, hand as ACC-265)', async () => {
      const before = await tb(S.token);
      const sale = ok(await send(saleOf('S4/' + RUN)), 'sale4');
      ok(await send(noteOf('CN4/' + RUN, 'S4/' + RUN, idOf(sale))), 'note4');
      const now = await tb(S.token);
      expect(now[1300] === (before[1300] || 0) + 82600 && now[4090] === (before[4090] || 0) + 30000, 'books ' + JSON.stringify(now));
    });
  } finally { await pg.end(); }
  finish('acc-265b');
})().catch((e) => { console.error('FATAL ' + e.message); process.exit(1); });
