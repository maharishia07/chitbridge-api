'use strict';
/**
 * tests/books-truth.realstack.cjs — BOOKS TRUTH on the LOCAL stack (T2, real Postgres): R106 a short delivery from a LOCAL supplier.
 *
 * Library case TSK006b · walk row R106 (docs/walks/WALK-2026-10-24.md) · OPS-60 (PM/ATHI-DECISIONS.md:38): accept at the COUNTED figure, then hold or
 * note the gap — never post the full paper bill, no reversal. Received 10 kg, their bill says 15 kg (₹750 against ₹500 counted):
 *   BK-01 before accepting, the Waiting row asks ACCEPT and carries the three figures as integers (their ₹750 · ours ₹500 · ₹250 short)
 *   BK-02 accepted → ONE purchase_bill at ₹500, the gap in the narration and on the bill's note; the supplier's balance HOLDS at ₹500; no reversal
 *   BK-03 "Hold this bill" = the books' party_status 'disputed' on a LOCAL supplier: the answer carries the word, Payables leaves the bill out
 *   BK-04 "Release" puts it back
 *   BK-05 a rate difference (10 kg × ₹5) is a DEBIT NOTE through POST /events kind debit_note → purchase_return against the bill: balance ₹450; a second tap posts once
 *   BK-06 the books balance (Σ Dr = Σ Cr in journal_line) and the trial balance agrees
 *   BK-07 (gap, R104's area) stock shows the 10 kg counted, never 15
 * Shares tests/lib/truth-harness.cjs. LOCAL ONLY. Run: node tests/books-truth.realstack.cjs   (one realstack file at a time; API_BASE / TRUTH_DB as the harness says)
 * CARD 14-accounting/ledger-accounts-day-book-entries-reverse
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, j, ok, pause, kase, expect, receipt, freshShop, finish } = H;
const RUN = 'bk' + (Date.now() % 1e10).toString(36);
const THEIRS = 750, OURS = 500, SHORT = 250; /* 15 kg billed at ₹50, 10 kg counted */
let pg = null;

/** poll a read until `pick` returns something, for at most ms (the hook posts after the chit's commit, never awaited by the route) */
async function until(read, pick, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const r = await read(), got = pick(r);
    if (got || Date.now() > end) return got || null;
    await pause(250);
  }
}
const dues = (shop) => j('/api/books/dues?side=supplier&finance=1', { token: shop.token });
const supplierRow = (d, pid) => ((d.b && d.b.parties) || []).find((p) => String(p.party_id) === String(pid)) || null;

(async () => {
  console.log('\n── books truth (R106 · TSK006b) on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  pg = new Client({ connectionString: DB }); await pg.connect();
  try {
    const A = await freshShop(RUN + 'a', 'Books truth');
    ok(await j('/api/books/enable', { method: 'POST', token: A.token }), 'books on');
    const supName = 'Sri Ganesh ' + RUN;
    const sup = ok(await j('/api/relationships/suppliers', { method: 'POST', token: A.token, body: { name: supName, supply_kind: 'resale' } }), 'local supplier').b.supplier;
    const PID = sup.supplier_entity_id;
    const rice = ok(await j('/api/products', { method: 'POST', token: A.token, body: { item_data: { name: 'Rice ' + RUN, unit: 'kg', price: 60 } } }), 'product').b.item;
    const RICE = { id: rice.item_id, name: 'Rice ' + RUN, unit: 'kg' };
    /* the counter's Receive form: 10 kg counted at their ₹50, their bill no. and TOTAL typed (F10); lines at 0 % (an unregistered local supplier) */
    const chit = receipt(RUN + '-SG1022', [[RICE, 10, 50, 'kg']]);
    chit.business_json.party = { name: supName };
    chit.business_json.their_bill = { no: 'SG-1022', date: new Date().toISOString().slice(0, 10), total: THEIRS };
    chit.business_json.input_tax = { inclusive: false, vendor_state: null };
    chit.line_items.forEach((line) => { line.gst_rate = 0; });
    const sent = ok(await j('/api/chits/send', { method: 'POST', token: A.token, body: chit }), 'receipt sent').b;
    const CHIT = sent.chit_id || (sent.chit && sent.chit.chit_id);
    expect(CHIT, 'no chit id in ' + JSON.stringify(sent).slice(0, 200));

    await kase('BK-01', 'before accepting: the Waiting row asks ACCEPT and carries their ₹750 · ours ₹500 · ₹250 short as integers (never only words)', async () => {
      const row = await until(() => j('/api/books/health', { token: A.token }), (r) => ((r.b && r.b.waiting) || []).find((w) => String(w.chit_id) === String(CHIT)));
      expect(row, 'no Waiting row for the receipt');
      expect(row.todo === 'accept', 'todo ' + row.todo + ' (expected accept — the Accept action stays open)');
      expect(row.short && row.short.theirs_minor === THEIRS * 100 && row.short.ours_minor === OURS * 100 && row.short.short_minor === SHORT * 100, 'short ' + JSON.stringify(row.short));
      expect(/₹250 short, noted/.test(row.reason || ''), 'the sentence does not offer the accept: ' + row.reason);
      return row.reason;
    });

    let BILL = null;
    await kase('BK-02', 'accepted at the count: ONE purchase_bill at ₹500 (never ₹750, no reversal), the gap in the narration and on the bill; the balance holds at ₹500', async () => {
      ok(await j('/api/chits/' + CHIT + '/status', { method: 'PUT', token: A.token, body: { status: 'accepted' } }), 'accept');
      const row = await until(() => dues(A), (d) => { const p = supplierRow(d, PID); return p && p.balance_minor !== 0 ? p : null; });
      expect(row, 'the supplier never got a balance (dues: ' + JSON.stringify((await dues(A)).b).slice(0, 300) + ')');
      expect(row.balance_minor === -OURS * 100, 'balance ' + row.balance_minor + ' (expected −50000: ₹500 owed at the count)');
      const bills = (row.payable && row.payable.bills) || [];
      expect(bills.length === 1 && bills[0].open_minor === OURS * 100, 'bills ' + JSON.stringify(bills));
      BILL = bills[0].ref;
      expect(bills[0].note === '₹250 short against their ₹750', 'the Payables row\'s word: ' + bills[0].note);
      const entries = (await pg.query(`SELECT event_type, narration, total_minor FROM journal_entry WHERE entity_id = $1 AND source_ref = $2`, [A.entity, 'chit:' + CHIT])).rows;
      expect(entries.length === 1 && entries[0].event_type === 'purchase_bill' && Number(entries[0].total_minor) === OURS * 100, 'entries for the chit: ' + JSON.stringify(entries));
      expect(/₹250 short against their ₹750/.test(entries[0].narration || ''), 'narration: ' + entries[0].narration);
      const reversals = (await pg.query(`SELECT count(*)::int AS n FROM journal_entry WHERE entity_id = $1 AND (reverses_entry_id IS NOT NULL OR event_type = 'purchase_return')`, [A.entity])).rows[0].n;
      expect(reversals === 0, reversals + ' reversal / purchase_return entries (expected none: the gap is NOTED, not posted and reversed)');
      return entries[0].narration;
    });

    await kase('BK-03', '"Hold this bill" on a LOCAL supplier reuses the books\' disputed status: the answer carries the word, Payables leaves the bill out', async () => {
      const held = ok(await j('/api/books/parties/' + PID + '/dispute', { method: 'POST', token: A.token, body: { against_ref: BILL, side: 'supplier', note: 'R106: 5 kg short, holding' } }), 'hold').b;
      expect(held.status === 'disputed' && held.words === 'Held — in dispute with you', 'answer ' + JSON.stringify(held));
      const row = await until(() => dues(A), (d) => { const p = supplierRow(d, PID); return p && p.disputed_minor !== 0 ? p : null; });
      expect(row && row.disputed_minor === -OURS * 100, 'disputed ' + JSON.stringify(row && row.disputed_minor));
      expect(!((row.payable && row.payable.bills) || []).length && (!row.payable || row.payable.total_minor === 0), 'the held bill is still payable: ' + JSON.stringify(row.payable));
      return held.words;
    });

    await kase('BK-04', '"Release" undoes the hold: the bill is payable again', async () => {
      const rel = ok(await j('/api/books/parties/' + PID + '/dispute', { method: 'POST', token: A.token, body: { against_ref: BILL, side: 'supplier', disputed: false } }), 'release').b;
      expect(rel.status === 'undisputed' && rel.words === 'Released — payable again', 'answer ' + JSON.stringify(rel));
      const row = await until(() => dues(A), (d) => { const p = supplierRow(d, PID); return p && p.disputed_minor === 0 && p.payable && p.payable.bills.length ? p : null; });
      expect(row && row.payable.bills[0].open_minor === OURS * 100, 'after release: ' + JSON.stringify(row && row.payable));
      return rel.words;
    });

    await kase('BK-05', 'a rate difference (10 kg × ₹5) is a DEBIT NOTE: purchase_return set against the bill, balance ₹450; the same client_ref posts once', async () => {
      const body = { event: { kind: 'debit_note', supplier: PID, against_ref: BILL, reason: 'rate', client_ref: RUN + '-dn1', lines: [{ name: 'Rice: billed ₹50, agreed ₹45', qty: 10, unit_price: 5, gst_rate: 0 }] } };
      const dn = ok(await j('/api/books/events', { method: 'POST', token: A.token, body }), 'debit note').b;
      expect(dn.ok && !dn.duplicate && /^MJ\//.test(dn.entry_no || ''), 'answer ' + JSON.stringify(dn));
      const again = ok(await j('/api/books/events', { method: 'POST', token: A.token, body }), 'debit note again').b;
      expect(again.duplicate === true && again.entry_no === dn.entry_no, 'second tap ' + JSON.stringify(again));
      const row = await until(() => dues(A), (d) => { const p = supplierRow(d, PID); return p && p.balance_minor === -(OURS - 50) * 100 ? p : null; });
      expect(row, 'balance did not fall to ₹450: ' + JSON.stringify(supplierRow(await dues(A), PID)));
      const dnRows = (await pg.query(`SELECT voucher_type, total_minor, narration FROM journal_entry WHERE entity_id = $1 AND event_type = 'purchase_return'`, [A.entity])).rows;
      expect(dnRows.length === 1 && Number(dnRows[0].total_minor) === 5000 && dnRows[0].voucher_type === 'Debit note', 'purchase_return entries: ' + JSON.stringify(dnRows));
      return dn.entry_no + ' · ' + dnRows[0].narration;
    });

    await kase('BK-06', 'the books balance: Σ Dr = Σ Cr over every line, and the trial balance agrees', async () => {
      const sums = (await pg.query(`SELECT COALESCE(SUM(dr_minor),0)::bigint AS dr, COALESCE(SUM(cr_minor),0)::bigint AS cr FROM journal_line WHERE entity_id = $1`, [A.entity])).rows[0];
      expect(Number(sums.dr) === Number(sums.cr) && Number(sums.dr) > 0, 'Σ Dr ' + sums.dr + ' · Σ Cr ' + sums.cr);
      const tb = ok(await j('/api/books/trial-balance', { token: A.token }), 'trial balance').b;
      expect(tb.balanced === true && tb.total_dr_minor === tb.total_cr_minor && tb.total_dr_minor > 0, 'TB ' + JSON.stringify({ balanced: tb.balanced, dr: tb.total_dr_minor, cr: tb.total_cr_minor }));
      return 'Dr ' + sums.dr + ' = Cr ' + sums.cr;
    });

    await kase('BK-07', 'stock shows the 10 kg counted, never the 15 kg billed', async () => {
      const st = ok(await j('/api/till/stock?detail=1', { token: A.token }), 'stock').b;
      const bal = st.balances && st.balances[RICE.id];
      expect(bal && Number(bal.qty) === 10, 'on hand ' + JSON.stringify(bal));
    }, 'stock-from-chit is R104\'s area (another builder, this round); the books never book the 15 kg either way');
  } finally {
    await pg.end();
  }
  finish('books-truth', process.env.BOOKS_TRUTH_JSON);
})().catch((e) => { console.error('FAIL (threw): ' + (e && e.stack || e)); process.exit(1); });
