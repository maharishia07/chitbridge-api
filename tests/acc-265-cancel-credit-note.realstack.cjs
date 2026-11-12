'use strict';
/**
 * tests/acc-265-cancel-credit-note.realstack.cjs — ACC-265: A SALE WITH A LIVE CREDIT NOTE AGAINST IT CANNOT BE CANCELLED (real Postgres, api as cb_app).
 *
 * Before (SIT run 15, probed on api main 6a1f48d7): an unpaid credit sale with a credit note against it, PUT /void → 200; the books ended Receivables -30000 and Sales returns +25424 with no sale left.
 * Now: 409 CHIT_HAS_CREDIT_NOTE (why has_credit_note, the note ids in notes[]) at BOTH doors (PUT /void, PUT /status → cancelled); nothing written; cancel the note first, then the sale.
 * Hand figures (IN): sale 1 x 1,000.00 + 18% = 1,180.00 = 118000 minor (AssVal 100000 + CGST 9000 + SGST 9000), on credit, unpaid.
 *   note 0.3 x 1,000.00 + 18% = 354.00 = 35400 minor (30000 + 2700 + 2700), credit-only.
 *   books with the sale: 1300 Receivables +118000 · 4000 Sales -100000 · 2200 CGST -9000 · 2201 SGST -9000
 *   books with the note too: 1300 82600 · 4090 Sales returns +30000 · 2200 -6300 · 2201 -6300
 *   note cancelled: back to the sale-only figures · sale cancelled too: every account nets 0.
 *   AC-1 refused at /void, words + code + note id, books and statuses unchanged   AC-2 same at PUT /status (a self-chit)   AC-3 a retry (same Idempotency-Key and a fresh one) answers the same
 *   AC-4 a cash sale + a cash note: refused by the older rule, not as a credit-note case (paid-before-note order: tests/acc-265-cancel-credit-note.test.cjs)   AC-5 a note on ANOTHER till with the same bill_no does not block; the right one does
 *   AC-6 cancel the note, then the sale: 200, 200, every account nets 0
 * Run: node tests/acc-265-cancel-credit-note.realstack.cjs   (API_BASE / TRUTH_DB as tests/lib/truth-harness.cjs says; LOCAL ONLY)
 * CARD 01-rail-core-the-chit/status-the-one-status-writer (ACC-265)
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { API, j, ok, pause, kase, expect, bill, creditNote, freshShop, finish } = H;
const RUN = 'a265' + (Date.now() % 1e9).toString(36);
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
  console.log('\n── ACC-265 cancel a sale that has a credit note · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  const pg = new Client({ connectionString: H.DB }); await pg.connect();
  try {
    const S = await freshShop(RUN, 'Cancel note', { tax: { registered: true, number: SHOP_GSTIN, scheme: 'regular' } });
    ok(await j('/api/books/enable', { method: 'POST', token: S.token, body: { walkin_grain: 'bill' } }), 'books on');
    const made = ok(await j('/api/relationships/customers', { method: 'POST', token: S.token, body: { name: 'Murugan ' + RUN, phone: '98400' + String(Date.now()).slice(-5), gstin: BUYER_GSTIN } }), 'customer').b; /* a credit sale posts to a named customer's receivable */
    const customer = { name: 'Murugan ' + RUN, identity_id: made.customer && made.customer.customer_identity_id, gstin: BUYER_GSTIN, phone: null };
    const saleOf = (no, opts) => bill(no, [[piece, 1]], Object.assign({ invoice: SALE_INV, customer, parts: ON_CREDIT, slip: 'credit', terms: { due_date: '2099-12-01' } }, opts || {}));
    const noteOf = (no, against, againstId, opts) => creditNote(no, against, [[piece, 0.3]], Object.assign({ againstId, invoice: NOTE_INV, parts: [], customer }, opts || {}));
    const sale = ok(await send(S, saleOf('S1/' + RUN)), 'sale'); const saleId = idOf(sale);
    const note = ok(await send(S, noteOf('CN1/' + RUN, 'S1/' + RUN, saleId)), 'note'); const noteId = idOf(note);
    const withNote = await tb(S.token);
    let beforeRows;
    await kase('AC-0', 'the books before: sale and note posted as hand-computed (118000 receivable, 30000 returns)', async () => {
      expect(same(withNote, NOTE_TB), 'books ' + JSON.stringify(withNote) + ' expected ' + JSON.stringify(NOTE_TB));
      beforeRows = await rowsOf(pg, S.entity, saleId);
    });
    const refused = (r) => expect(r.status === 409 && r.b.code === 'CHIT_HAS_CREDIT_NOTE' && r.b.why === 'has_credit_note' && Array.isArray(r.b.notes) && r.b.notes[0] === noteId && /credit note/i.test(String(r.b.detail || r.b.message)),
      'expected 409 CHIT_HAS_CREDIT_NOTE naming the note, got ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 300));
    const unchanged = async (why) => {
      expect(same(await tb(S.token), withNote), why + ': the books moved');
      const now = await rowsOf(pg, S.entity, saleId);
      expect(now.voided === beforeRows.voided && now.status === beforeRows.status, why + ': a status or history row was written ' + JSON.stringify(now) + ' vs ' + JSON.stringify(beforeRows));
    };
    await kase('AC-1', 'PUT /void with a live note: 409 CHIT_HAS_CREDIT_NOTE in words, books and statuses unchanged', async () => {
      refused(await j('/api/chits/' + saleId + '/void', { method: 'PUT', token: S.token, body: { reason: 'cancel' } }));
      await unchanged('void');
    });
    await kase('AC-2', "PUT /status cancelled (the sender's status door): the same 409 and the same code, nothing written", async () => {
      refused(await j('/api/chits/' + saleId + '/status', { method: 'PUT', token: S.token, body: { status: 'cancelled', note: 'cancel' } }));
      await unchanged('status');
    });
    await kase('AC-3', 'a retry answers the same: the same Idempotency-Key replays it, a fresh key asks again', async () => {
      const key = require('crypto').randomUUID();
      const call = () => fetch(API + '/api/chits/' + saleId + '/void', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + S.token, 'idempotency-key': key }, body: JSON.stringify({ reason: 'cancel' }) }).then(async (r) => ({ status: r.status, b: await r.json().catch(() => ({})) }));
      const first = await call(), again = await call();
      refused(first); refused(again);
      expect(first.b.code === again.b.code, 'replay answered another code');
      refused(await j('/api/chits/' + saleId + '/void', { method: 'PUT', token: S.token, body: { reason: 'cancel' } }));
      await unchanged('retry');
    });
    await kase('AC-4', 'a CASH sale with a cash note is refused too, and not as a credit-note case (the older refusals keep their place: paid, a finished sale)', async () => {
      const cash = ok(await send(S, saleOf('S2/' + RUN, { parts: [{ how: 'cash', amount: 1180 }], slip: 'cash' })), 'cash sale');
      ok(await send(S, noteOf('CN2/' + RUN, 'S2/' + RUN, idOf(cash), { parts: [{ how: 'cash', amount: 354 }] })), 'cash note');
      const r = await j('/api/chits/' + idOf(cash) + '/void', { method: 'PUT', token: S.token, body: { reason: 'cancel' } });
      expect(r.status === 409 && r.b.code !== 'CHIT_HAS_CREDIT_NOTE', 'expected the older 409 (paid / already completed), got ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
    });
    await kase('AC-5', "a note that names the bill number on ANOTHER till does not block; the note on the bill's own till does", async () => {
      /* a bill number lives inside its own till's series: a note that names the number on counter C2 is not a note against the C1 bill of that number (lib/credit-cap earlierNotes) */
      const mine = ok(await send(S, saleOf('Y-' + RUN, { till: { id: 'C1' } })), 'sale Y on C1'), other = ok(await send(S, saleOf('X-' + RUN, { till: { id: 'C1' } })), 'sale X on C1');
      ok(await send(S, noteOf('CN3/' + RUN, 'Y-' + RUN, undefined, { till: { id: 'C1' } })), 'note by number on C1');
      ok(await send(S, noteOf('CN4/' + RUN, 'X-' + RUN, undefined, { till: { id: 'C2', name: 'Counter 2' } })), 'note by number struck on C2');
      const free = await j('/api/chits/' + idOf(other) + '/void', { method: 'PUT', token: S.token, body: { reason: 'cancel' } });
      expect(free.status === 200, 'the bill was blocked by a note struck on another till: ' + free.status + ' ' + JSON.stringify(free.b).slice(0, 200));
      const held = await j('/api/chits/' + idOf(mine) + '/void', { method: 'PUT', token: S.token, body: { reason: 'cancel' } });
      expect(held.status === 409 && held.b.code === 'CHIT_HAS_CREDIT_NOTE', 'the C1 bill with its note was not refused: ' + held.status + ' ' + JSON.stringify(held.b).slice(0, 200));
    });
    await kase('AC-6', 'cancel the note first: the sale cancels after it and its figures reverse (hand: 35400 receivable / 30000 returns / 2700+2700 tax, then 118000 / 100000 / 9000 / 9000)', async () => {
      const state = await tb(S.token); /* the other cases leave their own bills in the books: this case reads the pair as a difference */
      const gone = await j('/api/chits/' + noteId + '/void', { method: 'PUT', token: S.token, body: { reason: 'wrong return' } });
      expect(gone.status === 200, 'the note could not be cancelled: ' + gone.status + ' ' + JSON.stringify(gone.b).slice(0, 200));
      const afterNote = await tb(S.token);
      expect((afterNote[4090] || 0) === (state[4090] || 0) - 30000 && afterNote[1300] === state[1300] + 35400 && afterNote[2200] === state[2200] - 2700 && afterNote[2201] === state[2201] - 2700,
        'cancelling the note did not take back 30000 returns / 2700+2700 tax / 35400 receivable: ' + JSON.stringify(afterNote) + ' from ' + JSON.stringify(state));
      const gone2 = await j('/api/chits/' + saleId + '/void', { method: 'PUT', token: S.token, body: { reason: 'cancel' } });
      expect(gone2.status === 200, 'the sale was still refused after the note went: ' + gone2.status + ' ' + JSON.stringify(gone2.b).slice(0, 200));
      const end = await tb(S.token);
      expect((end[1300] || 0) === afterNote[1300] - 118000 && (end[4000] || 0) === afterNote[4000] + 100000 && (end[2200] || 0) === afterNote[2200] + 9000 && (end[2201] || 0) === afterNote[2201] + 9000 && (end[4090] || 0) === (afterNote[4090] || 0),
        'cancelling the sale did not reverse it (118000 / 100000 / 9000 / 9000): ' + JSON.stringify(end) + ' from ' + JSON.stringify(afterNote));
    });
  } finally { await pg.end(); }
  finish('acc-265');
})().catch((e) => { console.error('FATAL ' + e.message); process.exit(1); });
