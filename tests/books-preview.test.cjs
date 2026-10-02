/**
 * books-preview.test.cjs — POST /api/books/preview: THE JOURNAL AN EVENT WOULD POST, from the writer's own function (lib/books.js composeEntry).
 *
 * Proves, for every "＋ Entry" event: the preview's lines EQUAL the lines the posting route stores (code, Dr, Cr) · Dr = Cr · each line names its
 * type (personal / real / nominal) and the golden rule that placed it · the voucher is the MJ series with its type kept · a LOCKED month is refused in
 * both · a bill's blocked credit (s.17(5)) is flagged and its tax goes into the expense · a co-assist may look but not post · and the preview WRITES
 * NOTHING: no entry, no line, no balance, no counter, no month (composeEntry's readOnly reads a year not yet started instead of creating it).
 * Run: node tests/books-preview.test.cjs   (BOOKS_ENGINES_SRC=<lib/ or chitbridge-engines/src>)
 */
'use strict';
const { rig, addStaffLedger, counter, SUPP } = require('./support/books-manual-rig.cjs');
const { ok, eq, done } = counter();

(async () => {
  console.log('\n══ POST /api/books/preview — the same composition as the writer, writing nothing ══\n');
  const R = await rig(); if (!R) return;
  const { X, q } = R, T = X.T;
  const staff = await addStaffLedger(R, 'Advance — Ravi');
  const snap = () => JSON.stringify([T.entries.length, T.lines.length, T.balances.size, [...T.counters.entries()], T.periods.length, T.items.length]);
  const D = '2026-10-05';
  const GST = { supplier_gstin: '33AAAAA0000A1Z5', my_gstin: '33BBBBB0000B1Z5', lines: [{ name: 'Shop rent', qty: 1, unit_price: 10000, gst_rate: 18 }] };
  /* every event of the grid, each with its own client_ref (the posting half uses the same body) */
  const CASES = [
    ['expense, no GST', { kind: 'expense', class: 'repairs', amount: 2500, paid_from: 'cash', date: D, client_ref: 'p-exp' }],
    ['expense with a bill (GST by the tax engine)', { kind: 'expense', class: 'rent', paid_from: 'bank', date: D, bill: GST, client_ref: 'p-rent' }],
    ['expense on a supplier\'s credit', { kind: 'expense', class: 'transport', supplier: SUPP, amount: 900, date: D, client_ref: 'p-cr' }],
    ['other income', { kind: 'other_income', class: 'commission_received', into: 'bank', amount: 1200, date: D, client_ref: 'p-inc' }],
    ['capital introduced', { kind: 'capital', into: 'bank', amount: 50000, date: D, client_ref: 'p-cap' }],
    ['drawings', { kind: 'drawings', from: 'cash', amount: 3000, date: D, client_ref: 'p-dr' }],
    ['staff advance', { kind: 'staff_advance', ledger: staff.code, from: 'cash', amount: 4000, date: D, client_ref: 'p-adv' }],
    ['advance recovered', { kind: 'advance_recovered', ledger: staff.code, into: 'cash', amount: 1000, date: D, client_ref: 'p-rec' }],
    ['contra', { kind: 'contra', from: 'cash', to: 'bank', amount: 7000, date: D, client_ref: 'p-con' }],
    ['journal', { kind: 'journal', narration: 'Correct a mis-posting', date: D, lines: [{ code: '6190', dr_minor: 500 }, { code: '6060', cr_minor: 500 }], client_ref: 'p-jv' }],
  ];

  /* ── 1. the preview writes nothing — snapshot of every table the writer touches ── */
  const before = snap();
  const pre = {};
  for (const [name, body] of CASES) pre[name] = await q('POST', '/preview', { event: body });
  ok('a preview writes nothing: no entry, line, balance, counter, month or party item', snap() === before, before + ' → ' + snap());
  for (const [name] of CASES) {
    const p = pre[name].body;
    ok(name + ': ok, balanced, Dr = Cr, voucher MJ', pre[name].status === 200 && p.ok === true && p.balanced === true && p.totals.dr_minor === p.totals.cr_minor && p.voucher && p.voucher.series === 'MJ', JSON.stringify(p));
    ok('…each line names its code, ledger, type and the golden rule', p.lines.length >= 2 && p.lines.every((l) => l.code && l.ledger && ['personal', 'real', 'nominal'].indexOf(l.type) >= 0 && l.rule), JSON.stringify(p.lines));
  }

  /* ── 2. hand-worked journals (golden-books style) ── */
  const view = (p) => p.lines.map((l) => [l.code, l.dr_minor, l.cr_minor, l.type, l.rule]);
  eq('capital 50,000 into the bank: Dr Bank (real, comes in) · Cr Capital (personal, the giver)', view(pre['capital introduced'].body),
    [['1500', 5000000, 0, 'real', 'Dr what comes in'], ['3000', 0, 5000000, 'personal', 'Cr the giver']]);
  eq('…its voucher type is Receipt', pre['capital introduced'].body.voucher, { series: 'MJ', type: 'Receipt' });
  eq('drawings 3,000 in cash: Dr Drawings · Cr Cash (real, goes out) — a Payment', [view(pre['drawings'].body), pre['drawings'].body.voucher.type],
    [[['3100', 300000, 0, 'personal', 'Dr the receiver'], ['1400', 0, 300000, 'real', 'Cr what goes out']], 'Payment']);
  eq('rent 10,000 + 18% on a bill (intra-state): Dr Rent 10,000 · Dr Input CGST 900 · Dr Input SGST 900 · Cr Bank 11,800', view(pre['expense with a bill (GST by the tax engine)'].body).map((r) => r.slice(0, 3)),
    [['6010', 1000000, 0], ['2210', 90000, 0], ['2211', 90000, 0], ['1500', 0, 1180000]]);
  const rp = pre['expense with a bill (GST by the tax engine)'].body;
  ok('…credit claimed, the bill\'s heads read from the tax engine, and the nominal rule named on the expense', rp.credit === 'claimed' && rp.bill.cgst === 900 && rp.bill.sgst === 900 && rp.bill.total === 11800 && rp.lines[0].rule === 'Dr expenses and losses', JSON.stringify(rp.bill));
  eq('an expense on a supplier\'s credit is a Purchase voucher (the engine\'s voucherTypeOf)', pre['expense on a supplier\'s credit'].body.voucher.type, 'Purchase');
  ok('a staff advance: Dr the shop\'s own ledger (personal) · Cr Cash', view(pre['staff advance'].body)[0][0] === staff.code && view(pre['staff advance'].body)[0][3] === 'personal' && view(pre['staff advance'].body)[1][0] === '1400');

  /* ── 3. preview lines EQUAL the posted lines, event by event ── */
  let nCases = 0;
  for (const [name, body] of CASES) {
    const posted = await q('POST', '/events', { event: body });
    const entry = T.entries.find((e) => e.entry_id === posted.body.entry_id);
    const stored = entry ? T.lines.filter((l) => l.entry_id === entry.entry_id).sort((a, b) => a.line_no - b.line_no).map((l) => [l.code, l.dr_minor, l.cr_minor]) : null;
    const p = pre[name].body;
    if (JSON.stringify(stored) === JSON.stringify(p.lines.map((l) => [l.code, l.dr_minor, l.cr_minor])) && entry && entry.voucher_type === p.voucher.type && String(entry.entry_no).split('/')[0] === p.voucher.series) nCases++;
    else console.log('   ' + name + ': preview ' + JSON.stringify(p.lines.map((l) => [l.code, l.dr_minor, l.cr_minor])) + ' posted ' + JSON.stringify(stored) + ' ' + JSON.stringify(posted.body));
  }
  ok('all ' + CASES.length + ' events: the preview\'s lines, voucher type and series EQUAL what the posting route stored', nCases === CASES.length, nCases + ' of ' + CASES.length);
  const again = await q('POST', '/preview', { event: CASES[0][1] });
  ok('previewing an event already posted says so (duplicate) and still writes nothing', again.body.duplicate && again.body.duplicate.entry_no && again.body.ok === true);

  /* ── 4. a locked month is refused — in the preview and in the post ── */
  await q('POST', '/periods/2026-27/7/lock', { reason: 'GSTR-1 filed' });
  const lockedBody = { kind: 'expense', class: 'fuel', amount: 100, paid_from: 'cash', date: '2026-10-06', client_ref: 'p-lock' };
  const s0 = snap();
  const lp = await q('POST', '/preview', { event: lockedBody });
  ok('preview, locked month: ok false, PERIOD_LOCKED, one plain sentence, no lines', lp.status === 200 && lp.body.ok === false && lp.body.code === 'PERIOD_LOCKED' && lp.body.refusals.length === 1 && /locked|open it again/i.test(lp.body.refusals[0]) && lp.body.lines.length === 0, JSON.stringify(lp.body));
  const lw = await q('POST', '/events', { event: lockedBody });
  ok('post, locked month: 409 PERIOD_LOCKED, nothing written', lw.status === 409 && lw.body.code === 'PERIOD_LOCKED' && snap() === s0, JSON.stringify(lw.body));
  await q('POST', '/periods/2026-27/7/unlock', { reason: 'test' });

  /* ── 5. the blocked credit (s.17(5)) ── */
  const blk = await q('POST', '/preview', { event: { kind: 'expense', class: 'staff_welfare', paid_from: 'cash', date: D, blocked_credit: 'food', bill: { supplier_gstin: '33AAAAA0000A1Z5', my_gstin: '33BBBBB0000B1Z5', lines: [{ name: 'Team lunch', qty: 1, unit_price: 1000, gst_rate: 5 }] } } });
  const bk = blk.body;
  ok('blocked credit: flagged in plain words, credit "blocked"', bk.ok === true && bk.credit === 'blocked' && bk.flags.length === 1 && /s\.17\(5\)/.test(bk.flags[0]), JSON.stringify(bk));
  eq('…the tax is a cost: Dr Staff welfare 1,050 (1,000 + 50 GST) · Cr Cash 1,050, and no Input GST line', view(bk).map((r) => r.slice(0, 3)), [['6130', 105000, 0], ['1400', 0, 105000]]);
  const claim = await q('POST', '/preview', { event: { kind: 'expense', class: 'staff_welfare', paid_from: 'cash', date: D, blocked_credit: 'food', claim_credit: true, bill: { supplier_gstin: '33AAAAA0000A1Z5', my_gstin: '33BBBBB0000B1Z5', lines: [{ name: 'Lunch', qty: 1, unit_price: 1000, gst_rate: 5 }] } } });
  ok('asking to claim a blocked credit is REFUSED in words', claim.body.ok === false && claim.body.refusals.length === 1 && /cannot be claimed/.test(claim.body.refusals[0]), JSON.stringify(claim.body));
  const nogst = await q('POST', '/preview', { event: { kind: 'expense', class: 'rent', paid_from: 'bank', date: D, bill: { supplier_gstin: '33AAAAA0000A1Z5', lines: [{ name: 'Rent', qty: 1, unit_price: 100, gst_rate: 18 }] } } });
  ok('a bill with no way to tell CGST + SGST from IGST is asked, never posted with no tax', nogst.body.ok === false && /GST number|place of supply/.test(nogst.body.refusals[0] || ''), JSON.stringify(nogst.body));

  /* ── 6. plain questions, and who may ── */
  const miss = await q('POST', '/preview', { event: { kind: 'capital', into: 'bank', date: D } });
  ok('a missing amount is a plain question in `refusals` (200), not an error', miss.status === 200 && miss.body.ok === false && /how much/i.test(miss.body.refusals[0]), JSON.stringify(miss.body));
  const unk = await q('POST', '/preview', { event: { kind: 'teleport' } });
  ok('an unknown event is a plain question too', unk.status === 200 && unk.body.ok === false && unk.body.refusals.length === 1);
  const goods = await q('POST', '/preview', { event: { kind: 'drawings', what: 'goods', amount: 100, from: 'cash', date: D } });
  ok('drawings of goods is refused in words (it needs an engine rule), not guessed', goods.body.ok === false && /engine rule/.test(goods.body.refusals[0]), JSON.stringify(goods.body));
  R.asStaff();
  const sp = await q('POST', '/preview', { event: CASES[0][1] });
  ok('a co-assist may preview: the lines show, but ok is false with "Only the owner…"', sp.status === 200 && sp.body.ok === false && sp.body.lines.length === 2 && /only the owner/i.test(sp.body.refusals[0]), JSON.stringify(sp.body.refusals));
  const sw = await q('POST', '/events', { event: Object.assign({}, CASES[0][1], { client_ref: 'staff-try' }) });
  ok('…and cannot post (403)', sw.status === 403);
  R.asOwner();
  R.close(); done();
})().catch((e) => { console.error(e); process.exit(1); });
