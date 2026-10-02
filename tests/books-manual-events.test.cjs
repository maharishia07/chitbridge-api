/**
 * books-manual-events.test.cjs — THE EVERYDAY OWNER EVENTS (POST /api/books/events) and the grid (GET /events), through real express and the in-memory store.
 *
 * Proves, per event: the entry is the engine's own lines (hand-worked, golden-books style) · Dr = Cr · it is numbered MJ/<fy>/<n> with its voucher type kept
 * beside it (Payment · Receipt · Purchase · Contra · Journal) · a double tap posts ONCE (same entry, duplicate: true) · a locked month is refused and leaves
 * nothing · owner-only (a co-assist 403) · the numbers are gap-free (a preview takes none) · a shop's own ledger takes the next free code and refuses a typed one
 * · the grid lists every event, its fields and the pack's classes, and names what could not be composed.
 * Run: node tests/books-manual-events.test.cjs   (BOOKS_ENGINES_SRC=<lib/ or chitbridge-engines/src>)
 */
'use strict';
const { rig, addStaffLedger, counter, SUPP } = require('./support/books-manual-rig.cjs');
const { ok, eq, done } = counter();

(async () => {
  console.log('\n══ POST /api/books/events — the owner\'s everyday events ══\n');
  const R = await rig(); if (!R) return;
  const { X, q } = R, T = X.T;
  const D = '2026-10-05';
  const staff = await addStaffLedger(R, 'Advance — Ravi');
  const entryOf = (ref) => T.entries.find((e) => e.source_ref === ref);
  const linesOf = (e) => T.lines.filter((l) => l.entry_id === e.entry_id).sort((a, b) => a.line_no - b.line_no).map((l) => [l.code, l.dr_minor, l.cr_minor]);
  const sum = (ls, i) => ls.reduce((t, l) => t + l[i], 0);

  /* [name, body, ref prefix → source_ref, hand-worked lines, voucher type] — each worked by hand from the golden rules, not read back from the engine */
  const GST = { supplier_gstin: '33AAAAA0000A1Z5', my_gstin: '33BBBBB0000B1Z5', lines: [{ name: 'Shop rent', qty: 1, unit_price: 10000, gst_rate: 18 }] };
  const IGST = { supplier_gstin: '27AAAAA0000A1Z5', my_gstin: '33BBBBB0000B1Z5', lines: [{ name: 'Courier', qty: 1, unit_price: 1000, gst_rate: 18 }] };
  const EVENTS = [
    ['expense paid in cash', { kind: 'expense', class: 'repairs', amount: 2500, paid_from: 'cash', date: D, client_ref: 'e1' }, 'ev:expense:e1', [['6060', 250000, 0], ['1400', 0, 250000]], 'Payment'],
    ['expense with GST (rent, same state)', { kind: 'expense', class: 'rent', paid_from: 'bank', date: D, bill: GST, client_ref: 'e2' }, 'ev:expense:e2',
      [['6010', 1000000, 0], ['2210', 90000, 0], ['2211', 90000, 0], ['1500', 0, 1180000]], 'Payment'],
    ['expense with GST (other state → IGST)', { kind: 'expense', class: 'transport', paid_from: 'upi', date: D, bill: IGST, client_ref: 'e3' }, 'ev:expense:e3',
      [['6050', 100000, 0], ['2212', 18000, 0], ['1510', 0, 118000]], 'Payment'],
    ['expense on credit (supplier owed)', { kind: 'expense', class: 'electricity', supplier: SUPP, amount: 1800, date: D, client_ref: 'e4' }, 'ev:expense:e4', [['6030', 180000, 0], ['2100', 0, 180000]], 'Purchase'],
    ['other income', { kind: 'other_income', class: 'interest_received', into: 'bank', amount: 640, date: D, client_ref: 'e5' }, 'ev:other_income:e5', [['1500', 64000, 0], ['4200', 0, 64000]], 'Receipt'],
    ['capital introduced', { kind: 'capital', into: 'cash', amount: 20000, date: D, client_ref: 'e6' }, 'ev:capital:e6', [['1400', 2000000, 0], ['3000', 0, 2000000]], 'Receipt'],
    ['drawings (cash)', { kind: 'drawings', from: 'cash', amount: 3000, date: D, client_ref: 'e7' }, 'ev:drawings:e7', [['3100', 300000, 0], ['1400', 0, 300000]], 'Payment'],
    ['staff advance', { kind: 'staff_advance', ledger: staff.code, from: 'cash', amount: 4000, date: D, client_ref: 'e8' }, 'ev:staff_advance:e8', [[staff.code, 400000, 0], ['1400', 0, 400000]], 'Payment'],
    ['advance recovered', { kind: 'advance_recovered', ledger: staff.code, into: 'cash', amount: 1000, date: D, client_ref: 'e9' }, 'ev:advance_recovered:e9', [['1400', 100000, 0], [staff.code, 0, 100000]], 'Receipt'],
  ];

  const nos = [];
  for (const [name, body, ref, want, vtype] of EVENTS) {
    const r = await q('POST', '/events', { event: body });
    const e = entryOf(ref);
    ok(name + ': 200, posted, one entry', r.status === 200 && r.body.ok && !r.body.duplicate && e, JSON.stringify(r.body));
    if (!e) continue;
    const ls = linesOf(e);
    eq('…its lines are the hand-worked journal', ls, want);
    ok('…Dr = Cr', sum(ls, 1) === sum(ls, 2) && sum(ls, 1) > 0);
    ok('…numbered MJ/2026-27/n with its voucher type kept: ' + vtype, /^MJ\/2026-27\/\d{6}$/.test(e.entry_no) && e.series === 'MJ' && e.voucher_type === vtype, e.entry_no + ' ' + e.voucher_type);
    ok('…source recorded as the event (the person\'s own ref)', e.source_ref === ref);
    nos.push(Number(String(e.entry_no).split('/')[2]));
  }
  eq('MJ numbers run 1…9 with no gap (nine events, nine numbers)', nos, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const supplierItems = T.items.filter((i) => String(i.party_id) === SUPP).length;
  ok('the credit expense put its bill on the supplier\'s account (one party item)', supplierItems === 1, String(supplierItems));

  /* ── a double tap posts once ── */
  const n0 = T.entries.length;
  const again = await q('POST', '/events', { event: EVENTS[5][1] });
  ok('a double tap: 200 with the FIRST entry and duplicate: true', again.status === 200 && again.body.duplicate === true && again.body.entry_no === entryOf('ev:capital:e6').entry_no, JSON.stringify(again.body));
  ok('…and nothing new was written (entries, lines, MJ counter)', T.entries.length === n0);
  const prev = await q('POST', '/preview', { event: { kind: 'capital', into: 'cash', amount: 1, date: D } });
  const next = await q('POST', '/events', { event: { kind: 'capital', into: 'cash', amount: 100, date: D, client_ref: 'e10' } });
  ok('a preview in between took no number: the next entry is MJ…000010', prev.body.ok && /\/000010$/.test(next.body.entry_no), next.body.entry_no);

  /* ── the other doors on the same builders ── */
  const con = await q('POST', '/events', { event: { kind: 'contra', from: 'cash', to: 'bank', amount: 5000, date: D, client_ref: 'e11' } });
  const ce = entryOf('contra:ev:e11') || entryOf('contra:e11');
  ok('contra through /events: MJ, voucher type Contra', con.body.ok && con.body.entry_no && /^MJ\//.test(con.body.entry_no) && T.entries.find((e) => e.entry_no === con.body.entry_no).voucher_type === 'Contra', JSON.stringify(con.body));
  const jv = await q('POST', '/events', { event: { kind: 'journal', narration: 'Move a mis-posting', date: D, lines: [{ code: '6190', dr_minor: 500 }, { code: '6060', cr_minor: 500 }], client_ref: 'e12' } });
  ok('a free journal through /events: MJ, voucher type Journal', jv.body.ok && T.entries.find((e) => e.entry_no === jv.body.entry_no).voucher_type === 'Journal', JSON.stringify(jv.body));
  const unbal = await q('POST', '/events', { event: { kind: 'journal', narration: 'Off by a rupee', date: D, lines: [{ code: '6190', dr_minor: 500 }, { code: '6060', cr_minor: 400 }] } });
  ok('a journal that does not balance is refused (422) and posts nothing', unbal.status === 422 && !T.entries.some((e) => e.narration === 'Off by a rupee'), JSON.stringify(unbal.body));

  /* ── locked month, owner only, plain questions ── */
  await q('POST', '/periods/2026-27/7/lock', { reason: 'GSTR-1 filed' });
  const nl = T.entries.length;
  const locked = [];
  for (const [name, body] of EVENTS) { const r = await q('POST', '/events', { event: Object.assign({}, body, { client_ref: body.client_ref + '-L', date: '2026-10-06' }) }); if (r.status !== 409 || r.body.code !== 'PERIOD_LOCKED') locked.push(name + ' → ' + r.status); }
  ok('a locked month refuses every event (409 PERIOD_LOCKED)', locked.length === 0, locked.join(' · '));
  ok('…and leaves nothing behind', T.entries.length === nl);
  await q('POST', '/periods/2026-27/7/unlock', { reason: 'test' });
  R.asStaff();
  const refused = [];
  for (const [name, body] of EVENTS) { const r = await q('POST', '/events', { event: Object.assign({}, body, { client_ref: body.client_ref + '-S' }) }); if (r.status !== 403) refused.push(name + ' → ' + r.status); }
  ok('owner-only: a co-assist is refused (403) on every event', refused.length === 0, refused.join(' · '));
  R.asOwner();
  const bad = await q('POST', '/events', { event: { kind: 'staff_advance', ledger: '6010', from: 'cash', amount: 10, date: D } });
  ok('a staff advance must name a shop ledger under Loans and advances (400, in words)', bad.status === 400 && /ledger/i.test(bad.body.message), JSON.stringify(bad.body));
  const chq = await q('POST', '/events', { event: { kind: 'expense', class: 'rent', amount: 10, paid_from: 'cheque', date: D } });
  ok('a cheque is not offered (it posts when it clears): 400 "cash, bank, upi or card"', chq.status === 400 && /cash, bank, upi or card/.test(chq.body.message), JSON.stringify(chq.body));
  const cls = await q('POST', '/events', { event: { kind: 'expense', class: 'sales', amount: 10, paid_from: 'cash', date: D } });
  ok('an expense to a non-expense ledger is refused by the engine (422), never posted', cls.status === 422, JSON.stringify(cls.body));

  /* ── POST /accounts: the system gives the code ── */
  const accs = (await q('GET', '/accounts')).body.accounts;
  const grp = accs.find((a) => a.is_group && a.name === 'Indirect Expenses');
  const a1 = await q('POST', '/accounts', { name: 'Generator diesel', parent_code: grp.code });
  const a2 = await q('POST', '/accounts', { name: 'Security guard', parent_code: grp.code });
  ok('POST /accounts assigns the next free code in the group, role null', a1.status === 200 && /^6\d{3}$/.test(a1.body.account.code) && a2.body.account.code !== a1.body.account.code && Number(a2.body.account.code) > Number(a1.body.account.code), JSON.stringify([a1.body, a2.body]));
  const row = T.accounts.find((a) => a.code === a1.body.account.code);
  ok('…its role is null (Books v2)', row && row.role == null);
  const typed = await q('POST', '/accounts', { name: 'My own code', parent_code: grp.code, code: '6999' });
  ok('a code typed by the person is REFUSED (the system gives it)', typed.status === 422 && /code/i.test(typed.body.message) && !T.accounts.some((a) => a.name === 'My own code'), JSON.stringify(typed.body));
  const typed2 = await q('POST', '/accounts', { name: 'Another', parent_code: grp.code, account_code: '6998' });
  ok('…under either field name', typed2.status === 422);
  const dsl = await q('POST', '/events', { event: { kind: 'expense', class: a1.body.account.code, amount: 300, paid_from: 'cash', date: D, client_ref: 'e13' } });
  ok('the new ledger takes an expense by its code', dsl.status === 200 && dsl.body.ok, JSON.stringify(dsl.body));

  /* ── GET /events: the grid, so the screen holds no rules ── */
  const g = await q('GET', '/events');
  const kinds = (g.body.events || []).map((e) => e.kind);
  ok('GET /events lists the grid: the six everyday events, contra, journal, and the routed period-end ones', g.status === 200 && ['expense', 'other_income', 'capital', 'drawings', 'staff_advance', 'advance_recovered', 'contra', 'journal', 'asset', 'loan', 'closing_stock'].every((k) => kinds.indexOf(k) >= 0), kinds.join(','));
  ok('…each says its words (≤ 3), icon, band, voucher type, fields and ledger group', g.body.events.every((e) => e.words && e.words.split(/\s+/).length <= 3 && e.icon && e.band && (e.voucher || e.route) && ('ledger_group' in e)), JSON.stringify(g.body.events.filter((e) => !(e.words && e.icon))));
  ok('…the picks are the pack\'s own classes (EXPENSE_CLASSES / INCOME_CLASSES) and the cash modes', g.body.picks.expense_class.some((c) => c.role === 'rent' && c.code === '6010') && g.body.picks.income_class.some((c) => c.role === 'interest_received') && g.body.picks.mode.join() === 'cash,bank,upi,card');
  ok('…it names what could not be composed from existing engine events', g.body.pending.length >= 1 && g.body.pending.every((p) => p.kind && p.why));
  ok('…and the golden rules in words', g.body.golden.personal.dr === 'Dr the receiver' && g.body.golden.nominal.cr === 'Cr incomes and gains');
  R.asStaff(); ok('a co-assist may read the grid', (await q('GET', '/events')).status === 200); R.asOwner();
  R.close(); done();
})().catch((e) => { console.error(e); process.exit(1); });
