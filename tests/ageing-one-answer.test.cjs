/**
 * tests/ageing-one-answer.test.cjs — W15-94 / W15-95 / W15-96 (l16-ageing): ONE ageing answer and the per-bill owed.
 * OWNS      the proof that the AU shop's Receivables and Payables age in the engine's days-past-due set (no pack month bucket, no "Other"), that a bill with no due date ages by its bill date and says so,
 *           that the per-bill owed adds up to the party's balance, and that lib/bill-checks joins each open bill to its entry, mark and the evidence flag the Day book uses
 * CALLED BY npm test (pure node, no database)
 * FLOW      items → books-engines.dues(.., creditDaysOf) → followRow · netOpen → bill-checks.attach (fake handle)
 */
'use strict';
const path = require('path');
const Module = require('module');
const H = require('./support/books-harness.cjs');
const AU_PACK = require(path.join(H.API, 'lib', 'regulation')).packFor('AU');
let pass = 0, fail = 0;
const t = (label, got, want) => {
  const same = JSON.stringify(got) === JSON.stringify(want);
  same ? pass++ : fail++;
  console.log('  ' + (same ? 'ok  ' : 'FAIL') + '  ' + label + (same ? '' : '\n        got  ' + JSON.stringify(got).slice(0, 400) + '\n        want ' + JSON.stringify(want).slice(0, 400)));
};
if (!H.enginesSrc().dir) { console.log('\n   SKIP: ' + H.enginesSrc().why + '\n'); process.exit(1); }
const E = require(path.join(H.API, 'lib', 'books-engines'));
const ASOF = '2026-11-16', NORTH = '00000000-0000-4000-8000-000000000001', METRO = '00000000-0000-4000-8000-000000000002';
let seq = 0;
const item = (party, o, side) => Object.assign({ item_id: 'i-' + (++seq), party, party_id: party, side: side || 'receivable', currency: 'AUD' }, o);
const bill = (party, ref, minor, date, due, side, entry) => item(party, { ref_kind: 'bill', kind: 'sale', ref, against_ref: ref, amount_minor: minor, date, doc_date: date, due_date: due, entry_id: entry || null }, side);
const FIVE = ['not_due', 'd0_30', 'd31_60', 'd61_90', 'd90_plus'];

/* Northside Medical, as the walk saw it: bills from 3 Aug, a receipt on account on 12 Sep, the rest still owed */
const north = [
  bill(NORTH, 'S042-01', 5000000, '2026-08-03', '2026-09-02', undefined, 'e1'),
  bill(NORTH, 'S042-02', 6000000, '2026-08-20', '2026-09-19', undefined, 'e2'),
  bill(NORTH, 'S042-03', 5000000, '2026-10-01', '2026-10-31', undefined, 'e3'),
  bill(NORTH, 'S042-04', 660000, '2026-11-10', '2026-12-10', undefined, 'e4'), /* not due yet */
  item(NORTH, { ref_kind: 'advance', kind: 'payment', ref: 'pay:1', against_ref: 'pay:1', amount_minor: -7920000, date: '2026-09-12' })
];
const owed = 5000000 + 6000000 + 5000000 + 660000 - 7920000;
const d = E.dues(north, ASOF, 'receivable', { pack: AU_PACK, creditDaysOf: () => null });
const row = E.followRow(d.follow, NORTH);
t('the AU pack months buckets hold names the old table never knew (that was the "Other")', Object.keys(d.ageing.by_party[NORTH].undisputed).some((key) => !FIVE.includes(key)), true);
t('the one answer has exactly the five keys, in order', d.follow.ageing.bucket_keys, FIVE);
t('and they add up to what the party owes (nothing in Other)', FIVE.reduce((sum, key) => sum + row[key], 0), owed);
t('the money not yet due is only the 10 Nov bill', row.not_due, 660000);
t('the oldest late bucket is named (a screen shows it, never "Not due")', row.worst, 'd31_60');
t('per bill: the netted owed adds up to the balance', Object.values(d.open.by_ref).reduce((sum, one) => sum + one.outstanding_minor, 0), owed);
t('and the receipt on account is the difference between the bills and the owed', north.filter((x) => x.ref_kind === 'bill').reduce((sum, x) => sum + x.amount_minor, 0) - owed, 7920000);

/* a bill with no due date ages from its bill date, and is marked no_terms (the screen says "no due date") */
const nodue = [bill(NORTH, 'N-1', 100000, '2026-09-01', null)];
const dn = E.dues(nodue, ASOF, 'receivable', { pack: AU_PACK, creditDaysOf: () => null });
const rn = E.followRow(dn.follow, NORTH);
t('no due date: aged by the bill date (76 days late = 61-90) and flagged no_terms', [rn.d61_90, rn.no_terms_minor, rn.terms], [100000, 100000, 'not_set']);
const dc = E.dues(nodue, ASOF, 'receivable', { pack: AU_PACK, creditDaysOf: () => 14 });
t('the shop credit days give it a due date: 1 Sep + 14 = 15 Sep, 62 days late, no_terms 0', [E.followRow(dc.follow, NORTH).d61_90, E.followRow(dc.follow, NORTH).no_terms_minor], [100000, 0]);

/* Payables: Metro Trade Supplies, the same set, the same five keys */
const metro = [bill(METRO, 'S042-19', 2125730, '2026-09-01', '2026-10-01', 'payable', 'e19')];
const dm = E.dues(metro, ASOF, 'payable', { pack: AU_PACK, creditDaysOf: () => null });
const rm = E.followRow(dm.follow, METRO);
t('Payables: the same five keys, 46 days late = 31-60, nothing in Other', [FIVE.filter((key) => key in rm).length, rm.d31_60, rm.worst], [5, 2125730, 'd31_60']);
t('and the side is payable', dm.follow.ageing.side, 'payable');

/* the join of an open bill to its entry, its mark and its evidence flag (lib/bill-checks) with a fake handle */
Module._load = ((load) => function (request) {
  if (/mark-embed$/.test(request)) return { marksIn: async (h, req, adopter, ids) => ({ byId: Object.fromEntries(ids.map((id) => [id, id === 'e19' ? { class: 'hold', kind: 'on_hold' } : null])), actions: { set: { ok: false } }, vocabulary: {} }) };
  return load.apply(this, arguments);
})(Module._load);
(async () => {
  const evidence = require(path.join(H.API, 'lib', 'books-evidence'));
  evidence.attach = async (h, list) => list.forEach((one) => { one.item.evidence = { flag: one.entry.entry_id === 'e19' ? 'no_tax_invoice' : null, count: 0 }; });
  const BC = require(path.join(H.API, 'lib', 'bill-checks'));
  const h = { query: async () => ({ rows: [{ entry_id: 'e19', entry_no: 'J-19', event_type: 'purchase_bill', doc_date: '2026-09-01', posting_date: '2026-09-01', source_chit_id: 'c19', reverses_entry_id: null, reversed_by_id: null, account_role: 'gst_paid', dr_minor: 100 }] }) };
  const prop = { items: metro, proposal: [{ against_ref: 'S042-19', open_minor: 2125730, due_minor: 2125730, apply_minor: 0, disputed: false }, { against_ref: 'GONE', open_minor: 1, due_minor: 1, apply_minor: 0, disputed: false }] };
  const out = await BC.attach(h, 'shop', {}, prop, { pack: AU_PACK, cur: 'AUD' });
  const one = prop.proposal[0], gone = prop.proposal[1];
  t('the bill carries its own amount, its day and its entry', [one.bill_minor, one.bill_date, one.entry_id], [2125730, '2026-09-01', 'e19']);
  t('the auditor\'s mark comes from the Day book\'s own read (On hold)', one.mark && one.mark.kind, 'on_hold');
  t('the evidence flag is the Day book\'s rule (No tax invoice)', one.evidence_flag, 'no_tax_invoice');
  t('mark_actions ride at the root, as the Day book sends them', out.mark_actions, { set: { ok: false } });
  t('a bill with no row in the items carries nulls, never a guess', [gone.bill_minor, gone.entry_id, gone.mark, gone.evidence_flag], [null, null, null, null]);
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((failure) => { console.log('FAIL ' + failure.stack); process.exit(1); });
