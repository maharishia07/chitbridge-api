'use strict';
/**
 * tests/ctr-234-creditnote-bill-truth.realstack.cjs — CTR-234: A COUNTER CREDIT NOTE NEEDS A BILL BEHIND IT (real Postgres, api as cb_app).
 *
 * Before: POST /api/chits/send purpose credit_note against a bill number / chit id the shop has no bill for answered 200 and a cash return posted;
 * the same note against ANOTHER shop's real bill did too (the over-the-bill cap in lib/credit-cap.js only ran when the bill was found).
 * Hand figures (SIT-HUNT night 6, M9c/M9d): 1 x 1,000.00 + 18% GST = 1,180.00, refunded in cash 1,180.00 (118000 minor).
 *   CN-01 a note against a bill number and chit id that do not exist: 409 BILL_NOT_RECORDED (RFC 9457 problem, registered code, a plain sentence), NO chit written
 *   CN-02 shop B's note against shop A's real bill number AND chit id: the SAME answer (code, status, sentence) as CN-01, nothing in B's folder, A's bill untouched
 *   CN-03 control: shop A's note against its own real bill is accepted (200), so the guard is not a blanket refusal
 *   CN-04 a note against its own bill for more than the bill is still 409 CREDIT_NOTE_OVER_BILL (the existing guard, unchanged)
 * Run: node tests/ctr-234-creditnote-bill-truth.realstack.cjs   (API_BASE / TRUTH_DB as tests/lib/truth-harness.cjs says; LOCAL ONLY)
 * CARD 09-counter (CTR-234)
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, j, ok, kase, expect, bill, creditNote, freshShop, finish } = H;
const RUN = 'c234' + (Date.now() % 1e9).toString(36);
const GHOST_CHIT = '00000000-0000-4000-8000-000000000000';
const BILL_MINOR = 118000; /* 1 x 1,000.00 + 18% = 1,180.00 */
const invoiceOf = () => ({ ValDtls: { AssVal: 1000, CgstVal: 90, SgstVal: 90, IgstVal: 0, TotInvVal: 1180 } });
const piece = { id: undefined, name: 'Item ' + RUN, unit: 'piece', price: 1000, gst_rate: 18 };

/** the number of chits of this purpose a shop holds with this number (read as the owner role, SELECT only) */
async function countNotes(pg, entity, no) {
  const r = await pg.query("SELECT count(*)::int AS n FROM chit_header WHERE entity_id = $1 AND purpose = 'credit_note' AND business_json ->> 'bill_no' = $2", [entity, no]);
  return r.rows[0].n;
}
/** what a refused send looks like to the till: status, code, the sentence */
const refusal = (r) => ({ status: r.status, code: r.b.code, detail: r.b.detail || r.b.message || r.b.error });

(async () => {
  console.log('\n── CTR-234 credit note needs a bill · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  const pg = new Client({ connectionString: DB }); await pg.connect();
  try {
    const A = await freshShop(RUN + 'a', 'CN bill A', { tax: { registered: true, number: '33AAAPK9001M1ZW', scheme: 'regular' } });
    const B = await freshShop(RUN + 'b', 'CN bill B', { tax: { registered: true, number: '33AAAPK9002M1ZV', scheme: 'regular' } });
    const aNo = 'A-' + RUN;
    const sold = ok(await j('/api/chits/send', { method: 'POST', token: A.token, body: bill(aNo, [[piece, 1]], { invoice: invoiceOf() }) }), 'shop A sells').b;
    const aChit = sold.chit_id || (sold.chit && sold.chit.chit_id);
    expect(aChit, 'shop A bill has no chit id: ' + JSON.stringify(sold).slice(0, 200));
    const note = (no, against, againstId, total) => creditNote(no, against, [[piece, 1]], { againstId, invoice: { ValDtls: Object.assign({}, invoiceOf().ValDtls, { TotInvVal: total || 1180 }) }, parts: [{ how: 'cash', amount: total || 1180 }] });
    const send = (shop, body) => j('/api/chits/send', { method: 'POST', token: shop.token, body });
    let ghost = null;

    await kase('CN-01', 'a note against a bill that does not exist is refused 409 BILL_NOT_RECORDED and nothing is written', async () => {
      const no = 'ghost-' + RUN;
      ghost = refusal(await send(A, note(no, 'ghost-' + RUN, GHOST_CHIT)));
      expect(ghost.status === 409 && ghost.code === 'BILL_NOT_RECORDED', 'expected 409 BILL_NOT_RECORDED, got ' + JSON.stringify(ghost));
      expect(/bill/i.test(String(ghost.detail)), 'no plain sentence: ' + JSON.stringify(ghost));
      const n = await countNotes(pg, A.entity, no);
      expect(n === 0, 'a credit note chit was written (' + n + ') with no bill behind it');
    });
    await kase('CN-02', "shop B's note against shop A's real bill looks exactly like a missing bill and writes nothing", async () => {
      const no = 'steal-' + RUN;
      const seen = refusal(await send(B, note(no, aNo, aChit)));
      expect(seen.status === 409 && seen.code === 'BILL_NOT_RECORDED', 'expected 409 BILL_NOT_RECORDED, got ' + JSON.stringify(seen));
      expect(ghost && seen.status === ghost.status && seen.code === ghost.code && seen.detail === ghost.detail, 'differs from a missing bill: ' + JSON.stringify(seen) + ' vs ' + JSON.stringify(ghost));
      expect((await countNotes(pg, B.entity, no)) === 0, "a credit note chit was written in shop B's books");
      expect((await countNotes(pg, A.entity, no)) === 0, "a credit note chit leaked into shop A's books");
    });
    await kase('CN-03', "control: shop A's note against its own bill is accepted", async () => {
      const r = await send(A, note('ok-' + RUN, aNo, aChit, 1180));
      expect(r.status === 200, 'own bill refused: ' + JSON.stringify(refusal(r)));
      expect((await countNotes(pg, A.entity, 'ok-' + RUN)) === 1, 'the accepted note is not in the books');
    });
    await kase('CN-04', 'the over-the-bill guard still answers 409 CREDIT_NOTE_OVER_BILL on a found bill', async () => {
      const r = await send(A, note('over-' + RUN, aNo, aChit, 1180));
      expect(r.status === 409 && r.b.code === 'CREDIT_NOTE_OVER_BILL', 'expected 409 CREDIT_NOTE_OVER_BILL (bill ' + BILL_MINOR + ' minor already credited), got ' + JSON.stringify(refusal(r)));
    });
  } finally { await pg.end(); }
  finish('ctr-234');
})().catch((e) => { console.error('FATAL ' + e.message); process.exit(1); });
