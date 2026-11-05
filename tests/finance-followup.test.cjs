/**
 * tests/finance-followup.test.cjs — FIN-72: the follow-up view of Collections, 0-30 / 31-60 / 61-90 / 90+ DAYS past due, "Not due yet" apart.
 *
 * OWNS      the proof of books-engines.dues(.., { creditDaysOf }) · followRow · followTotal (the ONE reader: CBLedger.ageing set 'followup', engines
 *           v1.76.0) and of GET /api/books/dues?finance=1 for one INDIAN shop and one AUSTRALIAN shop: every figure below is HAND-COMPUTED
 *           (asOf 2026-11-05, 100000 minor = 1,000.00 a bill). Edge days 0/30/31/60/61/90/91 · a bill not due · a bill with no due date (the
 *           party's credit days, the shop's, and none: aged from its bill date and flagged) · part-paid · a receipt on account · disputed ·
 *           a party on both lists · a supplier row (no follow_up) · the cost-blind rule · the Schedule III default call unchanged.
 * CALLED BY scripts/guards.cjs · CI. No database, no network. Needs the engines at v1.76.0 (BOOKS_ENGINES_SRC, or ../chitbridge-engines/src).
 * FLOW      party items → E.dues(.., creditDaysOf) → E.followRow → GET /dues?finance=1 row.follow_up + follow_up_total
 * CARD      16-finance/collections
 *
 * Run: node tests/finance-followup.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const t = (label, got, want) => {
  const same = JSON.stringify(got) === JSON.stringify(want);
  same ? pass++ : fail++;
  console.log('  ' + (same ? 'ok  ' : 'FAIL') + '  ' + label + (same ? '' : '\n        got  ' + JSON.stringify(got).slice(0, 400) + '\n        want ' + JSON.stringify(want).slice(0, 400)));
};
const ASOF = '2026-11-05', TEN = 100000;

/* ── the world: one customer per case, so each row is one hand sum ── */
const SHOP = '11111111-1111-4111-8111-111111111111';
const id = (n) => '00000000-0000-4000-8000-0000000000' + String(n).padStart(2, '0');
const P = { FOUR: id(1), E0: id(2), E30: id(3), E31: id(4), E60: id(5), E61: id(6), E90: id(7), E91: id(8), NOT: id(9), PART: id(10), ACCT: id(11), OVER: id(12),
  DISP: id(13), BOTH: id(14), SUP: id(15), NODUE_SHOP: id(16), NODUE_OWN: id(17), NODUE_NONE: id(18) };
/** the late days of each due date below, counted from 5 Nov by hand; the test re-counts them once from the calendar */
const DUE = { late10: '2026-10-26', late40: '2026-09-26', late75: '2026-08-22', late120: '2026-07-08', late0: '2026-11-05', late30: '2026-10-06', late31: '2026-10-05',
  late60: '2026-09-06', late61: '2026-09-05', late90: '2026-08-07', late91: '2026-08-06', tomorrow: '2026-11-06' };
const LATE = { late10: 10, late40: 40, late75: 75, late120: 120, late0: 0, late30: 30, late31: 31, late60: 60, late61: 61, late90: 90, late91: 91, tomorrow: -1 };
const BILL_DATE_50 = '2026-09-16'; /* 50 days before 5 Nov */

let seq = 0;
const item = (party, o, side) => Object.assign({ item_id: 'i-' + (++seq), party, side: side || 'receivable', currency: 'INR' }, o);
const bill = (party, ref, minor, due, date, side) => item(party, { ref_kind: 'bill', kind: 'sale', ref, against_ref: ref, amount_minor: minor, date: date || '2026-07-01', due_date: due }, side);
/** a payment: its own advance row (money on account) + the allocation pair against a bill (what it settles), as CBReceivables writes them */
const receipt = (party, ref, minor) => item(party, { ref_kind: 'advance', kind: 'payment', ref, against_ref: ref, amount_minor: -minor, date: '2026-10-10' });
const settle = (party, ref, against, minor) => [
  item(party, { ref_kind: 'allocation', kind: 'payment', ref, against_ref: against, amount_minor: -minor, date: '2026-10-10' }),
  item(party, { ref_kind: 'allocation', kind: 'payment', ref, against_ref: ref, amount_minor: minor, date: '2026-10-10' })
];

/** the bills both shops share; each shop adds its own no-due-date bills */
function commonItems() {
  const out = [];
  out.push(bill(P.FOUR, 'b:four-1', TEN, DUE.late10), bill(P.FOUR, 'b:four-2', TEN, DUE.late40), bill(P.FOUR, 'b:four-3', TEN, DUE.late75), bill(P.FOUR, 'b:four-4', TEN, DUE.late120));
  [['E0', 'late0'], ['E30', 'late30'], ['E31', 'late31'], ['E60', 'late60'], ['E61', 'late61'], ['E90', 'late90'], ['E91', 'late91'], ['NOT', 'tomorrow']]
    .forEach(([who, due]) => out.push(bill(P[who], 'b:' + who, TEN, DUE[due])));
  out.push(bill(P.PART, 'b:part', TEN, DUE.late40), receipt(P.PART, 'p:part', 60000), ...settle(P.PART, 'p:part', 'b:part', 60000)); /* 60000 paid on the 40-day bill */
  out.push(bill(P.ACCT, 'b:acct', TEN, DUE.late75), receipt(P.ACCT, 'p:acct', 30000)); /* 30000 on account, never allocated: it covers the 75-day bill (netOpen) */
  out.push(bill(P.OVER, 'b:over', TEN, DUE.late10), receipt(P.OVER, 'p:over', 150000)); /* a receipt beyond the bill: 50000 stays unapplied, never aged */
  out.push(bill(P.DISP, 'b:disp', TEN, DUE.late40), item(P.DISP, { ref_kind: 'status', kind: 'sale', ref: 'b:disp', against_ref: 'b:disp', amount_minor: 0, status: 'disputed', date: '2026-10-01' }));
  out.push(bill(P.BOTH, 'b:both-c', TEN, DUE.late10), bill(P.BOTH, 'b:both-s', 70000, DUE.late40, '2026-07-01', 'payable'));
  out.push(bill(P.SUP, 'b:sup', 50000, '2026-08-01', '2026-07-01', 'payable'));
  return out;
}
const split = (items) => ({ receivable: items.filter((x) => x.side === 'receivable'), payable: items.filter((x) => x.side === 'payable') });
const ZERO = { not_due: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
const fu = (o, worst, noTerms) => Object.assign({}, ZERO, o, { worst: worst || null, no_terms_minor: noTerms || 0, terms: noTerms ? 'not_set' : 'ok' });
/** what every row of the common world must say, by hand */
const COMMON = {
  [P.FOUR]: fu({ d0_30: TEN, d31_60: TEN, d61_90: TEN, d90_plus: TEN }, 'd90_plus'),
  [P.E0]: fu({ d0_30: TEN }, 'd0_30'), [P.E30]: fu({ d0_30: TEN }, 'd0_30'),
  [P.E31]: fu({ d31_60: TEN }, 'd31_60'), [P.E60]: fu({ d31_60: TEN }, 'd31_60'),
  [P.E61]: fu({ d61_90: TEN }, 'd61_90'), [P.E90]: fu({ d61_90: TEN }, 'd61_90'),
  [P.E91]: fu({ d90_plus: TEN }, 'd90_plus'), [P.NOT]: fu({ not_due: TEN }, null),
  [P.PART]: fu({ d31_60: 40000 }, 'd31_60'),
  [P.ACCT]: fu({ d61_90: 70000 }, 'd61_90'),
  [P.OVER]: fu({}, null),
  [P.DISP]: fu({ d31_60: TEN }, 'd31_60'),
  [P.BOTH]: fu({ d0_30: TEN }, 'd0_30') /* the customer half of a party on both lists */
};
const add = (...rows) => rows.reduce((total, row) => { Object.keys(ZERO).forEach((key) => { total[key] += row[key]; }); return total; }, Object.assign({}, ZERO));

/* ── part 1 · the pure reader ── */
function partOne() {
  const E = require(path.join(H.API, 'lib', 'books-engines'));
  console.log('\n== FIN-72 part 1 · books-engines.dues → followRow / followTotal (INR) ==\n');
  const days = (due) => Math.round((Date.UTC(2026, 10, 5) - Date.parse(due + 'T00:00:00Z')) / 86400000);
  t('the hand count of the late days holds against the calendar', Object.keys(DUE).map((key) => days(DUE[key])), Object.keys(DUE).map((key) => LATE[key]));
  t('and a bill dated 16 Sep is 50 days old', days(BILL_DATE_50), 50);

  const items = commonItems().filter((x) => x.side === 'receivable');
  const no = E.dues(items, ASOF, 'receivable');
  t('no creditDaysOf → no `follow` (the Schedule III answer is all a caller gets)', no.follow, undefined);
  const d = E.dues(items, ASOF, 'receivable', { creditDaysOf: () => null });
  Object.keys(COMMON).forEach((pid) => {
    const name = Object.keys(P).find((key) => P[key] === pid);
    t('follow_up · ' + name.padEnd(5) + ' · ' + JSON.stringify(COMMON[pid]).slice(0, 110), E.followRow(d.follow, pid), COMMON[pid]);
  });
  t('a party the engine never saw gets zeros and "ok", never a throw', E.followRow(d.follow, 'nobody'), fu({}));
  t('due TODAY is d0_30 here, and not_due in the Schedule III default call (both, one test)', [E.followRow(d.follow, P.E0).d0_30, d.ageing.by_party[P.E0].undisputed.not_due], [TEN, TEN]);
  t('the default call (no creditDaysOf) and the follow call agree on every party balance', Object.keys(d.outstanding.by_party).every((pid) => d.outstanding.by_party[pid] === no.outstanding.by_party[pid]), true);
  t('the five keys == the party balance − what is unapplied, for every receivable party', Object.keys(d.outstanding.by_party).map((pid) => {
    const row = E.followRow(d.follow, pid), five = Object.keys(ZERO).reduce((total, key) => total + row[key], 0);
    return five === d.outstanding.by_party[pid] + (d.open.unapplied_by_party[pid] || 0) ? 'ok' : pid.slice(-2) + ':' + five + '/' + d.outstanding.by_party[pid];
  }).filter((x) => x !== 'ok'), []);

  /* no due date: the party's days, else the shop's, else none (aged from the bill date and flagged) */
  const nodue = [bill(P.NODUE_SHOP, 'b:ns', TEN, null, BILL_DATE_50), bill(P.NODUE_OWN, 'b:no', TEN, null, BILL_DATE_50), bill(P.NODUE_NONE, 'b:nn', TEN, null, BILL_DATE_50)];
  const credit = { [P.NODUE_SHOP]: 15, [P.NODUE_OWN]: 45 }; /* the resolver's answer: the shop's 15, the party's own 45 over it, nothing for the third */
  const n = E.dues(nodue, ASOF, 'receivable', { creditDaysOf: (pid) => (credit[pid] === undefined ? null : credit[pid]) });
  t('no due date · the SHOP\'s 15 days: 16 Sep + 15 = 1 Oct, 35 late → d31_60', E.followRow(n.follow, P.NODUE_SHOP), fu({ d31_60: TEN }, 'd31_60'));
  t('no due date · the PARTY\'s own 45 days over the shop\'s: 16 Sep + 45 = 31 Oct, 5 late → d0_30', E.followRow(n.follow, P.NODUE_OWN), fu({ d0_30: TEN }, 'd0_30'));
  t('no due date · no credit days anywhere: aged from the bill date (50 late → d31_60), the amount flagged, terms not_set', E.followRow(n.follow, P.NODUE_NONE), fu({ d31_60: TEN }, 'd31_60', TEN));
  t('the bills\' own objects were not changed (no due_date written into the engine\'s answer)', Object.values(n.open.by_ref).every((x) => !x.due_date && !x.no_terms), true);
  /* the books writer stores due = bill date when it knows no terms (lib/books.js, credit_days 0): no days anywhere → still flagged; a party with 0 days SET → not flagged (SIT 6 Nov) */
  const sameDay = [bill(P.NODUE_NONE, 'b:sd', TEN, BILL_DATE_50, BILL_DATE_50), bill(P.NODUE_OWN, 'b:s0', TEN, BILL_DATE_50, BILL_DATE_50)];
  const s = E.dues(sameDay, ASOF, 'receivable', { creditDaysOf: (pid) => (pid === P.NODUE_OWN ? 0 : null) });
  t('due = bill date as the writer stores it · no credit days anywhere: 50 late → d31_60, flagged, terms not_set', E.followRow(s.follow, P.NODUE_NONE), fu({ d31_60: TEN }, 'd31_60', TEN));
  t('due = bill date · the party\'s own 0 days (cash, set on purpose): 50 late → d31_60, NOT flagged', E.followRow(s.follow, P.NODUE_OWN), fu({ d31_60: TEN }, 'd31_60'));
  t('page total of those three: 5 keys 100000 + 100000 + 100000, no_terms 100000, terms not_set', E.followTotal([{ follow_up: E.followRow(n.follow, P.NODUE_SHOP) }, { follow_up: E.followRow(n.follow, P.NODUE_OWN) }, { follow_up: E.followRow(n.follow, P.NODUE_NONE) }]),
    fu({ d0_30: TEN, d31_60: 2 * TEN }, 'd31_60', TEN));

  /* a foreign-currency party: the keys still add up (the books' own money is one currency; a party's USD bills are in that carried figure) */
  const usd = [Object.assign(bill(P.FOUR, 'b:usd', 8325000, DUE.late40), { currency: 'USD' })];
  const f = E.dues(usd, ASOF, 'receivable', { creditDaysOf: () => null }), fr = E.followRow(f.follow, P.FOUR);
  t('a USD-only party: d31_60 holds the whole 8325000 and the keys add to its balance', [fr.d31_60, Object.keys(ZERO).reduce((total, key) => total + fr[key], 0) === f.outstanding.by_party[P.FOUR]], [8325000, true]);

  /* the supplier side answers no follow-up */
  const pay = E.dues(commonItems().filter((x) => x.side === 'payable'), ASOF, 'payable', { creditDaysOf: () => null });
  t('the supplier side: no `follow`, however it is called', pay.follow, undefined);

  /* the page total */
  const rows = Object.keys(COMMON).map((pid) => ({ follow_up: COMMON[pid] }));
  t('follow_up_total = the keys added row by row (a row with none adds nothing)', E.followTotal(rows.concat([{}, { follow_up: null }])),
    fu({ not_due: TEN, d0_30: 400000, d31_60: 440000, d61_90: 370000, d90_plus: 200000 }, 'd90_plus'));
  t('the empty page: every key present, zeros, worst null', E.followTotal([]), fu({}));
}

/* ── part 2 · the Schedule III default call is untouched; AU months differ from the same bills' follow-up ── */
function partTwo() {
  const E = require(path.join(H.API, 'lib', 'books-engines'));
  const L = E.ledger();
  const R = require(path.join(H.API, 'lib', 'receivables'));
  console.log('\n== FIN-72 part 2 · the default months set is unchanged · the follow-up set is pack-free ==\n');
  const docs = commonItems().filter((x) => x.side === 'receivable' && x.ref_kind === 'bill' && [P.E0, P.E30, P.E31, P.E61, P.E91, P.NOT].includes(x.party))
    .map((x) => ({ ref: x.ref, party: x.party, date: x.date, due_date: x.due_date, outstanding_minor: x.amount_minor }));
  const unset = L.ageing(docs, ASOF, 'receivable'), inPack = L.ageing(docs, ASOF, 'receivable', { country: 'IN' });
  t('the default call equals the IN pack call byte for byte (one reader, no drift)', JSON.stringify(unset), JSON.stringify(inPack));
  const au = L.ageing(docs, ASOF, 'receivable', { country: 'AU' });
  t('AU months columns exist and differ from the day buckets (0-30 days is not "<1 month")', [au.bucket_keys.includes('d0_30'), Object.keys(au.buckets.undisputed).join()], [false, au.bucket_keys.join()]);
  const follow = L.ageing(docs, ASOF, 'receivable', { set: 'followup' });
  t('the follow-up set over the same bills: not_due 1 (tomorrow) · d0_30 2 (0 and 30) · d31_60 1 (31) · d61_90 1 (61) · d90_plus 1 (91)', follow.buckets.undisputed, { not_due: TEN, d0_30: 2 * TEN, d31_60: TEN, d61_90: TEN, d90_plus: TEN });
  t('and it names no pack: the same answer whatever the country asked', JSON.stringify(L.ageing(docs, ASOF, 'receivable', { set: 'followup', country: 'AU' })), JSON.stringify(follow));
  t('a set the engine does not have is refused in words, never answered', (() => { try { L.ageing(docs, ASOF, 'receivable', { set: 'weeks' }); return 'answered'; } catch (e) { return /no set named/.test(e.message); } })(), true);
  t('Receivables.dueDate is the reader of the credit days: date + days, its own due first', [R.dueDate({ date: BILL_DATE_50, credit_days: 15 }), R.dueDate({ date: BILL_DATE_50, credit_days: 45, due: '2026-12-01' })], ['2026-10-01', '2026-12-01']);
}

/* ── part 3 · the route, an Indian shop and an Australian shop ── */
async function partRoute(country) {
  const AU = country === 'AU';
  const who = { current: { identity_id: SHOP, identity_type: 'entity', display_name: 'Shop' } };
  const auth = Object.assign((req, res, next) => { req.identity = who.current; next(); }, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (req, res, next) => next() });
  const X = H.load({ auth });
  console.log('\n== FIN-72 part 3 · GET /api/books/dues?finance=1 · ' + (AU ? 'an AUSTRALIAN shop (AUD)' : 'an INDIAN shop (INR)') + ' ==\n');
  if (!X.src.dir) { t('books engines present (' + X.src.why + ')', 'absent', 'present'); return; }
  const cur = AU ? 'AUD' : 'INR';
  if (AU) X.db.countryRow = { country: 'AU', currency_code: 'AUD', gstn: null, timezone: 'Australia/Sydney', policy_flags: {} };
  const schema = require(path.join(H.API, 'lib', 'schema'));
  schema.hasColumn = async (table, column) => column === 'terms'; /* b298 has run in this world: the shop default and a party's own terms are read */
  X.T.shopTerms = AU ? null : { credit_days: 15 };
  const names = {};
  Object.keys(P).forEach((key) => { names[P[key]] = key; });
  Object.keys(P).forEach((key) => X.T.parties.push({ owner: SHOP, party_id: P[key], party_no: 'P-' + P[key].slice(-4), name: key, customer: key !== 'SUP', supplier: key === 'SUP' || key === 'BOTH',
    credit_days: key === 'NODUE_OWN' ? 45 : null, credit_limit_minor: null }));
  const express = require('express'), app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0), port = srv.address().port;
  const q = (p) => new Promise((done) => { http.get({ host: '127.0.0.1', port, path: '/api/books' + p }, (res) => { let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { j = { raw }; } done({ status: res.statusCode, body: j }); }); }); });
  const CLOCK = require(path.join(H.API, 'lib', 'shop-clock')); CLOCK.set('2026-11-05T06:00:00Z');
  try {
    await new Promise((done) => { const r = http.request({ host: '127.0.0.1', port, path: '/api/books/enable', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': 2 } }, (res) => { res.resume(); res.on('end', done); }); r.end('{}'); });
    const E = require(path.join(H.API, 'lib', 'books-engines'));
    const debtors = X.T.accounts.find((a) => a.entity_id === SHOP && a.role === 'debtors'), creditors = X.T.accounts.find((a) => a.entity_id === SHOP && a.role === 'creditors');
    const extra = AU ? [bill(P.NODUE_NONE, 'b:nn', TEN, null, BILL_DATE_50)] : [bill(P.NODUE_SHOP, 'b:ns', TEN, null, BILL_DATE_50), bill(P.NODUE_OWN, 'b:no', TEN, null, BILL_DATE_50)];
    const all = commonItems().concat(extra).map((x) => Object.assign({}, x, { currency: cur }));
    await X.store.insertItems(X.db, SHOP, all.map((x) => E.itemRow(x, (x.side === 'payable' ? creditors : debtors).account_id, { currency: cur })));
    const got = await q('/dues?finance=1&side=customer'), rowOf = (r, key) => (r.body.parties || []).find((p) => p.party_id === P[key]);
    t('200, the owner\'s door, and the page carries follow_up_total', [got.status, typeof got.body.follow_up_total], [200, 'object']);
    Object.keys(COMMON).forEach((pid) => {
      const row = (got.body.parties || []).find((p) => p.party_id === pid);
      t('row · ' + names[pid].padEnd(5) + ' follow_up', row && row.follow_up, COMMON[pid]);
    });
    t('row · DISP stays in its bucket AND in disputed_minor', [rowOf(got, 'DISP').follow_up.d31_60, rowOf(got, 'DISP').disputed_minor], [TEN, TEN]);
    t('row · OVER: nothing aged, balance −50000 (the unapplied rest), keys sum 0 = balance − unapplied', [rowOf(got, 'OVER').balance_minor, rowOf(got, 'OVER').follow_up.d0_30], [-50000, 0]);
    if (AU) {
      t('AU · no credit days anywhere: aged from the bill date (50 late → d31_60), flagged, terms not_set', rowOf(got, 'NODUE_NONE').follow_up, fu({ d31_60: TEN }, 'd31_60', TEN));
      t('AU · the row\'s months buckets are the unchanged Schedule III set (the /dues pack gap is filed apart) and carry no day keys', [Object.keys(rowOf(got, 'FOUR').buckets).includes('d0_30'), Object.keys(rowOf(got, 'FOUR').buckets).length > 0], [false, true]);
    } else {
      t('IN · no due date, the shop\'s 15 days → d31_60', rowOf(got, 'NODUE_SHOP').follow_up, fu({ d31_60: TEN }, 'd31_60'));
      t('IN · no due date, the party\'s own 45 days over the shop\'s → d0_30', rowOf(got, 'NODUE_OWN').follow_up, fu({ d0_30: TEN }, 'd0_30'));
    }
    t('the page total = every customer row added: 5 keys by hand, no_terms and terms as the shop sets them', got.body.follow_up_total,
      AU ? fu({ not_due: TEN, d0_30: 400000, d31_60: 540000, d61_90: 370000, d90_plus: 200000 }, 'd90_plus', TEN)
         : fu({ not_due: TEN, d0_30: 500000, d31_60: 540000, d61_90: 370000, d90_plus: 200000 }, 'd90_plus'));
    const sum = (rows) => rows.reduce((total, row) => total + Object.keys(ZERO).reduce((s, key) => s + row.follow_up[key], 0), 0);
    t('and its five keys add to the aged customer money (1,710,000 IN · 1,610,000 AU)', Object.keys(ZERO).reduce((total, key) => total + got.body.follow_up_total[key], 0), sum(got.body.parties.filter((p) => p.follow_up)));

    /* both sides: the supplier row has no follow_up; a party on both lists keeps the customer half */
    const both = await q('/dues?finance=1');
    t('supplier-only row: no follow_up key at all (Payables has its own view)', rowOf(both, 'SUP') && 'follow_up' in rowOf(both, 'SUP'), false);
    t('a party on both lists: side both, balance the NET (100000 − 70000 = 30000), follow_up the customer half', [rowOf(both, 'BOTH').side, rowOf(both, 'BOTH').balance_minor, rowOf(both, 'BOTH').follow_up], ['both', 30000, COMMON[P.BOTH]]);
    t('the both-sides page total is the customer rows\' follow-up (a supplier adds nothing)', both.body.follow_up_total, got.body.follow_up_total);
    const sup = await q('/dues?finance=1&side=supplier');
    t('?side=supplier&finance=1 (Payables): no follow_up_total, no follow_up on any row', [sup.status, 'follow_up_total' in sup.body, (sup.body.parties || []).some((p) => 'follow_up' in p)], [200, false, false]);
    const plain = await q('/dues?side=customer');
    t('without finance=1 the answer is the old one: no follow_up, no follow_up_total', ['follow_up_total' in plain.body, (plain.body.parties || []).some((p) => 'follow_up' in p)], [false, false]);
    t('the months buckets and balances are the same with and without the follow-up (nothing moved)', (got.body.parties || []).every((p) => { const o = plain.body.parties.find((x) => x.party_id === p.party_id); return o && JSON.stringify(o.buckets) === JSON.stringify(p.buckets) && o.balance_minor === p.balance_minor; }), true);
    who.current = { identity_id: 'A7', identity_type: 'actor', parent_entity_id: SHOP };
    const actor = await q('/dues?finance=1&side=customer');
    t('a co-assist never reaches it: ?finance=1 is the owner\'s door (403 OWNER_ONLY)', [actor.status, actor.body.code, 'follow_up_total' in actor.body], [403, 'OWNER_ONLY', false]);
  } finally {
    CLOCK.reset();
    srv.close();
  }
}

/* ── part 4 · the cost-blind rule (RAIL-146i R3b), pure ── */
function partBlind() {
  const DV = require('../lib/dues-view');
  console.log('\n== FIN-72 part 4 · a cost-blind reader (lib/dues-view) ==\n');
  const cust = { party_id: 'c', name: 'Ravi', side: 'customer', balance_minor: 100000, disputed_minor: 0, buckets: { not_due: 0 }, oldest_due: '2026-09-15', follow_up: fu({ d31_60: TEN }, 'd31_60') };
  const both = { party_id: 'b', name: 'Zed', side: 'both', balance_minor: 30000, disputed_minor: 0, buckets: { not_due: 0 }, oldest_due: '2026-10-01', follow_up: fu({ d0_30: TEN }, 'd0_30') };
  const sup = { party_id: 's', name: 'Anand', side: 'supplier', balance_minor: -50000, disputed_minor: 0, buckets: { not_due: 0 }, oldest_due: '2026-09-01' };
  const page = { currency: 'INR', asOf: ASOF, parties: [both, cust, sup], total_minor: 80000, follow_up_total: fu({ d31_60: TEN, d0_30: TEN }, 'd31_60') };
  const blind = DV.blindDuesAnswer(page);
  t('a both-sides row: follow_up null (the customer half is not shown alone, as the balance is not)', blind.parties.find((r) => r.party_id === 'b').follow_up, null);
  t('the customer row keeps its follow_up, untouched (same reference)', blind.parties.find((r) => r.party_id === 'c') === cust && cust.follow_up.d31_60 === TEN, true);
  t('a supplier row gains no follow_up key', 'follow_up' in blind.parties.find((r) => r.party_id === 's'), false);
  t('the page: total_minor null AND follow_up_total null together, cost_hidden', [blind.total_minor, blind.follow_up_total, blind.cost_hidden], [null, null, true]);
  t('the owner\'s object was not changed', [page.follow_up_total.d31_60, both.follow_up.d0_30], [TEN, TEN]);
  const custOnly = { currency: 'INR', asOf: ASOF, parties: [cust], total_minor: 100000, follow_up_total: fu({ d31_60: TEN }, 'd31_60') };
  t('a customer-only page comes back as it was (same reference, follow_up_total stands)', DV.blindDuesAnswer(custOnly) === custOnly, true);
}

(async () => {
  const part = process.argv[2];
  if (part === 'IN' || part === 'AU') { await partRoute(part); console.log('  ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }
  if (!H.enginesSrc().dir) { console.log('\n   SKIP: ' + H.enginesSrc().why + '\n'); process.exit(1); }
  partOne(); partTwo(); partBlind();
  const { spawnSync } = require('child_process');
  for (const child of ['IN', 'AU']) {
    const r = spawnSync(process.execPath, [__filename, child], { encoding: 'utf8', env: process.env });
    process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
    const m = /(\d+) passed, (\d+) failed/.exec(r.stdout || '');
    if (!m) { fail++; console.log('  FAIL  part ' + child + ' did not report'); } else { pass += Number(m[1]); fail += Number(m[2]); }
  }
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
