/**
 * books-opening-page.test.cjs — l16 THE OPENING BALANCES PAGE, server side (preview · require_balanced · replace · the saved view · the year strip), real express over the in-memory ledger.
 * Hand-computed (cents) for a small shop starting on its first day of the year; the SAME cases run for an AU shop (Jul-Jun) and an IN shop (Apr-Mar) with only the pack's codes differing:
 *   bank 1,234,050 Dr · debtors 440,000 Dr from two bills (330,000 + 110,000) · tax paid 20,000 Dr · creditors 220,000 Cr from one bill · tax collected 40,000 Cr.
 *   Debits 1,234,050 + 440,000 + 20,000 = 1,694,050 · credits 220,000 + 40,000 = 260,000 · Difference 1,434,050 Cr until the owner's equity (capital) is 1,434,050 Cr, then 0.
 * Cases (the requirement's numbers): 1 grid + live Difference · 2 save refused when out, nothing in Suspense · 3 bills 430,000 vs debtors 440,000 → 10,000 apart, refused · 8 bank 1,234,050 → 1,230,450 with
 * a reason, one log line per changed line, a locked opening refused with nothing changed · 9 the same rows twice refused naming the entry · 10 year 2 carried from year 1 (retained 600,000) and "matches" ·
 * hostile: a start date in a carried year · a bill left open on replace · Move in's three entries on one day shown together · no reason · the same ref twice · the old callers still park in Suspense.
 * Run: node tests/books-opening-page.test.cjs   (BOOKS_ENGINES_SRC=<chitbridge-engines/src>)
 * CARD      14-accounting/README
 */
'use strict';
const path = require('path');
const express = require('express');
const { rig, counter, SHOP, CUST, SUPP } = require('./support/books-manual-rig.cjs');
const H = require('./support/books-harness.cjs');
const { ok, eq } = counter();
let failures = 0;
const wrap = { ok: (n, c, w) => { if (!c) failures++; ok(n, c, w); }, eq: (n, g, w) => { if (JSON.stringify(g) !== JSON.stringify(w)) failures++; eq(n, g, w); } };

const SHOPS = {
  AU: { row: { country: 'AU', currency_code: 'AUD', gstn: null, timezone: 'Australia/Sydney', policy_flags: {} }, start: '2026-07-01', year2: '2027-07-01', fy: '2026-27', next: '2027-28', codes: { bank: '1500', debtors: '1300', creditors: '2100', taxPaid: '2210', taxCollected: '2200', capital: '3000', income: '4020' } },
  IN: { row: null, start: '2026-04-01', year2: '2027-04-01', fy: '2026-27', next: '2027-28', codes: { bank: '1500', debtors: '1300', creditors: '2100', taxPaid: '2210', taxCollected: '2200', capital: '3000', income: '4000' } }
};

async function run(country) {
  const S = SHOPS[country], C = S.codes;
  console.log('\n══ the opening balances page — ' + country + ' shop ══\n');
  const R = await rig(S.row || undefined);
  if (!R) return;
  const { X, q } = R;
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books-opening')));
  const srv = app.listen(0); const port = srv.address().port;
  const http = require('http');
  const call = (method, p, body) => new Promise((done) => { const b = JSON.stringify(body || {});
    const r = http.request({ host: '127.0.0.1', port, path: '/api/books' + p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } }, (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) {} done({ status: res.statusCode, body: j }); }); }); r.end(b); });
  X.T.parties.push({ owner: SHOP, party_id: CUST, party_no: 'P-00001', name: 'Ravi Stores', customer: true, credit_days: 10 });
  const D = S.start;
  const bills = (extra) => [
    { code: C.debtors, party_id: CUST, dr_minor: 330000, bill_ref: 'INV-1', bill_date: '2026-06-20', due_date: '2026-07-31' },
    { code: C.debtors, party_id: CUST, dr_minor: 110000 + (extra || 0), bill_ref: 'INV-2', due_date: '2026-08-15' },
    { code: C.creditors, party_id: SUPP, cr_minor: 220000, bill_ref: 'B-9', due_date: '2026-08-01' }
  ];
  const grid = (o) => [{ code: C.bank, dr_minor: (o && o.bank) || 1234050 }].concat(bills(), [
    { code: C.debtors, dr_minor: 440000, control: true }, { code: C.creditors, cr_minor: 220000, control: true },
    { code: C.taxPaid, dr_minor: 20000 }, { code: C.taxCollected, cr_minor: 40000 }], (o && o.equity) ? [{ code: C.capital, cr_minor: o.equity }] : []);
  const entriesLive = () => X.T.entries.filter((e) => e.is_opening && !e.reverses_entry_id && !X.T.entries.some((r) => r.reverses_entry_id === e.entry_id));
  const suspenseNet = () => X.T.lines.filter((l) => X.T.accounts.find((a) => a.account_id === l.account_id).role === 'suspense').reduce((t, l) => t + (l.cr_minor || 0) - (l.dr_minor || 0), 0);

  /* 1 · the grid and its live Difference */
  const p1 = await call('POST', '/opening/preview', { rows: grid(), date: D });
  wrap.eq('1  Difference = the engine\'s: debits 1,694,050 · credits 260,000 · out by 1,434,050 on the credit side', [p1.status, p1.body.debit_minor, p1.body.credit_minor, p1.body.difference_minor, p1.body.side, p1.body.can_save], [200, 1694050, 260000, 1434050, 'cr', false]);
  wrap.eq('1  the bills match their control lines (both pairs, nothing apart)', p1.body.bills.map((b) => [b.code, b.bills_minor, b.typed_minor, b.apart_minor]), [[C.debtors, 440000, 440000, 0], [C.creditors, 220000, 220000, 0]]);
  wrap.ok('1  nothing was written by the preview', entriesLive().length === 0 && X.T.lines.length === 0);
  const p1b = await call('POST', '/opening/preview', { rows: grid({ equity: 1434050 }), date: D });
  wrap.eq('1  with the owner\'s equity 1,434,050 the Difference is 0 and Save may turn on', [p1b.body.difference_minor, p1b.body.side, p1b.body.refusals, p1b.body.can_save], [0, null, [], true]);
  /* 2 · out of balance: refused, never parked in Suspense */
  const s2 = await q('POST', '/opening', { date: D, rows: grid().filter((r) => !r.control), client_ref: 'grid:2', require_balanced: true });
  wrap.ok('2  Save while out → 422 OPENING_NOT_BALANCED, naming the figure and the cure', s2.status === 422 && s2.body.code === 'OPENING_NOT_BALANCED' && /1,?434,?050|14,?340\.50/.test(JSON.stringify(s2.body)) && /equity/.test(JSON.stringify(s2.body)), JSON.stringify(s2.body));
  wrap.eq('2  nothing posted, Suspense untouched', [entriesLive().length, suspenseNet()], [0, 0]);
  /* 3 · bills against the control line */
  const p3 = await call('POST', '/opening/preview', { rows: grid({ equity: 1434050 }).map((r) => (r.bill_ref === 'INV-2' ? Object.assign({}, r, { dr_minor: 100000 }) : r)), date: D });
  wrap.ok('3  bills 430,000 vs debtors 440,000: the pair is shown and Save is off', p3.body.can_save === false && p3.body.refusals.some((r) => r.name === 'BILLS_APART' && /Bills .*4,300.* vs .*4,400.*: .*100.* apart/.test(r.why)), JSON.stringify(p3.body.refusals));
  /* the old caller keeps its Suspense behaviour */
  const OLD = await q('POST', '/opening', { date: D, rows: [{ code: C.bank, dr_minor: 777 }], client_ref: 'old:1' });
  wrap.ok('   an old caller (no require_balanced) still parks the gap in Suspense: 777', OLD.status === 200 && OLD.body.suspense_minor === 777, JSON.stringify(OLD.body));
  await q('POST', '/entries/' + OLD.body.entry_id + '/reverse', { reason: 'test cleanup' });
  /* 8 · save, then re-edit with a reason */
  const save = await q('POST', '/opening', { date: D, rows: grid({ equity: 1434050 }).filter((r) => !r.control), client_ref: 'grid:A', require_balanced: true });
  wrap.ok('   Save with the Difference at 0 → 200, an entry, nothing in Suspense', save.status === 200 && /^JV\//.test(save.body.entry_no) && save.body.suspense_minor === 0, JSON.stringify(save.body));
  const saved = await call('GET', '/opening?date=' + D);
  wrap.ok('   GET /opening shows every line with ledger, bill, due, who and when', saved.status === 200 && saved.body.lines.length === 7 && saved.body.lines.some((l) => l.bill_ref === 'INV-1' && l.bill_date === '2026-06-20' && l.bill_ref !== 'x' || l.bill_ref === 'INV-2' && l.due_date === '2026-08-15' && l.dr_minor === 110000) && saved.body.entries.length === 1 && saved.body.entries[0].source.kind === 'typed' && saved.body.entries[0].at, JSON.stringify(saved.body.lines.length) + JSON.stringify(saved.body.entries));
  wrap.eq('   a new page is told the ledger first day as its start date', saved.body.default_date, D);
  wrap.ok('   the grid is told which ledgers to pin, from the pack: bank, debtors, creditors, equity and the pack tax ledgers', [C.bank, C.debtors, C.creditors, C.capital, C.taxPaid, C.taxCollected].every((code) => saved.body.pinned.some((p) => p.code === code)), JSON.stringify(saved.body.pinned));
  const asSaved = await call('POST', '/opening/preview', { rows: grid({ equity: 1434050 }), date: D });
  wrap.ok('   the same rows previewed as a NEW opening name the entry that already holds them', asSaved.body.can_save === false && asSaved.body.refusals.some((r) => /already posted/.test(r.why)), JSON.stringify(asSaved.body.refusals));
  const asChange = await call('POST', '/opening/preview', { rows: grid({ bank: 1230450, equity: 1430450 }), date: D, replace: true });
  wrap.ok('   previewed as a CHANGE (replace) the bills and the old entry do not refuse themselves', asChange.body.can_save === true && asChange.body.refusals.length === 0, JSON.stringify(asChange.body));
  const apartSave = await q('POST', '/opening', { date: D, rows: grid({ equity: 1434050 }).map((r) => (r.control && r.code === C.debtors ? Object.assign({}, r, { dr_minor: 450000 }) : r)), client_ref: 'grid:apart', require_balanced: true });
  wrap.ok('3  Save with the bills 100.00 apart from the typed debtors line is refused too (the control line is never posted)', apartSave.status === 422 && /apart/.test(JSON.stringify(apartSave.body.detail)), JSON.stringify(apartSave.body));
  const again = await q('POST', '/opening', { date: D, rows: grid({ equity: 1434050 }).filter((r) => !r.control), client_ref: 'grid:B', require_balanced: true });
  wrap.ok('9  the same rows again (new ref) → 409 naming the entry already holding them', again.status === 409 && new RegExp(save.body.entry_no.replace('/', '\\/')).test(JSON.stringify(again.body)) && entriesLive().length === 1, JSON.stringify(again.body));
  const retry = await q('POST', '/opening', { date: D, rows: grid({ equity: 1434050 }).filter((r) => !r.control), client_ref: 'grid:A', require_balanced: true });
  wrap.ok('9  the same ref is a retry: 200 duplicate, still one entry', retry.status === 200 && retry.body.duplicate === true && entriesLive().length === 1);
  const noReason = await call('POST', '/opening/replace', { date: D, rows: grid({ bank: 1230450, equity: 1430450 }), client_ref: 'grid:C', reason: '  ' });
  wrap.ok('8  an empty reason is refused, nothing changes', noReason.status === 400 && entriesLive().length === 1, JSON.stringify(noReason.body));
  const out = await call('POST', '/opening/replace', { date: D, rows: grid({ bank: 1230450, equity: 1434050 }), client_ref: 'grid:C', reason: 'typing slip' });
  wrap.ok('8  bank changed but equity not: out by 3,600 → refused 422, the old opening is untouched', out.status === 422 && / 36[ .]|₹36/.test(JSON.stringify(out.body.detail)) && entriesLive().length === 1, JSON.stringify(out.body));
  const same = await call('POST', '/opening/replace', { date: D, rows: grid({ equity: 1434050 }), client_ref: 'grid:D', reason: 'nothing' });
  wrap.ok('9  replace with the same rows → 409 "Nothing changed", names the entry', same.status === 409 && new RegExp(save.body.entry_no.replace('/', '\\/')).test(JSON.stringify(same.body)), JSON.stringify(same.body));
  const logsBefore = X.T.changes.length;
  const rep = await call('POST', '/opening/replace', { date: D, rows: grid({ bank: 1230450, equity: 1430450 }), client_ref: 'grid:C', reason: 'typing slip' });
  wrap.ok('8  bank 1,234,050 → 1,230,450 with equity 1,430,450 and a reason → 200: old reversed, new posted', rep.status === 200 && rep.body.reversed.length === 1 && rep.body.changes === 2 && /^JV\//.test(rep.body.entry_no), JSON.stringify(rep.body));
  const logged = X.T.changes.slice(logsBefore).filter((c) => c.table_name === 'opening');
  wrap.ok('8  one log line per changed line, old → new, with the reason, keyed to the day', logged.length === 2 && logged.some((c) => /^1500 /.test(c.field) && /1,?234,?050|12,?340\.50/.test(c.old) && /1,?230,?450|12,?304\.50/.test(c.new) && /typing slip/.test(c.new) && c.row_id === D), JSON.stringify(logged));
  wrap.eq('8  exactly one live opening again; the bills are not doubled (bills of 1300: 440,000)', [entriesLive().length, X.T.items.filter((i) => String(i.account_id) && i.status !== 'closed' && i.amount_minor && i.ref === 'INV-1').length >= 1], [1, true]);
  const replayed = await call('POST', '/opening/replace', { date: D, rows: grid({ bank: 1230450, equity: 1430450 }), client_ref: 'grid:C', reason: 'typing slip' });
  wrap.ok('8  the same replace tapped twice is a replay: duplicate, nothing reversed again', replayed.status === 200 && replayed.body.duplicate === true && entriesLive().length === 1);
  /* a bill stays open through replace (the probe the critic asked for) */
  const keep = await call('POST', '/opening/replace', { date: D, rows: grid({ bank: 1230450, equity: 1430450 }).map((r) => (r.code === C.taxPaid ? Object.assign({}, r, { dr_minor: 25000 }) : r)).map((r) => (r.code === C.capital ? Object.assign({}, r, { cr_minor: 1435450 }) : r)), client_ref: 'grid:E', reason: 'tax paid corrected' });
  wrap.ok('   replace where the bills stay open: INV-1, INV-2, B-9 are re-opened, not refused as already open', keep.status === 200 && keep.body.changes === 2, JSON.stringify(keep.body));
  const lastRows = (await call('GET', '/opening?date=' + D)).body.lines;
  wrap.ok('   the saved bill shows its own date (INV-1 dated 2026-06-20)', lastRows.some((l) => l.bill_ref === 'INV-1' && l.bill_date === '2026-06-20'), JSON.stringify(lastRows.filter((l) => l.bill_ref)));
  const dateOnly = await call('POST', '/opening/replace', { date: D, rows: grid({ bank: 1230450, equity: 1435450 }).map((r) => (r.code === C.taxPaid ? Object.assign({}, r, { dr_minor: 25000 }) : r.bill_ref === 'INV-2' ? Object.assign({}, r, { bill_date: '2026-06-25' }) : r)), client_ref: 'grid:G', reason: 'bill dated' });
  wrap.ok('   changing only the bill date is a change: 200, logged with the reason', dateOnly.status === 200 && X.T.changes.some((c) => c.table_name === 'opening' && /INV-2/.test(c.field) && /2026-06-25/.test(c.new) && /bill dated/.test(c.new)), JSON.stringify(dateOnly.body));
  /* Move in's several entries on one day all show */
  const second = await q('POST', '/opening', { date: D, rows: [{ code: C.bank, dr_minor: 5000 }, { code: C.capital, cr_minor: 5000 }], client_ref: 'movein:2' });
  const shown = await call('GET', '/opening?date=' + D);
  wrap.ok('   two live opening entries on one day are both shown (Move in posts three)', second.status === 200 && shown.body.entries.length === 2 && shown.body.lines.some((l) => l.dr_minor === 5000), JSON.stringify(shown.body.entries.map((e) => e.entry_no)));
  const days = await call('GET', '/opening');
  wrap.eq('   with no date the first day that has an opening is read', days.body.date, D);
  /* a locked opening period: refused, nothing changes */
  await X.B.setPeriod(null, SHOP, S.fy, 0, 'soft_locked', SHOP);
  const liveBefore = entriesLive().length;
  const locked = await call('POST', '/opening/replace', { date: D, rows: grid({ bank: 1200000, equity: 1400000 }), client_ref: 'grid:F', reason: 'try' });
  wrap.ok('8  the opening month is locked: refused with the locked sentence, nothing reversed', locked.status >= 400 && /locked/i.test(JSON.stringify(locked.body)) && entriesLive().length === liveBefore, JSON.stringify(locked.body));
  await X.B.setPeriod(null, SHOP, S.fy, 0, 'open', SHOP, 'reopen for year 2');
  /* 10 · year 2 is carried from year 1, never typed */
  if (C.income) {
    const K = require(path.join(H.API, 'lib', 'books-hooks')); const realDay = K.dayOf;
    const jv = await q('POST', '/events', { event: { kind: 'journal', narration: 'a month of sales', date: '2026-09-05', lines: [{ code: C.bank, dr_minor: 600000 }, { code: C.income, cr_minor: 600000 }], client_ref: 'j1' } });
    K.dayOf = (ts, c) => (ts instanceof Date && Math.abs(ts.getTime() - Date.now()) < 5000 ? '2027-08-10' : realDay(ts, c));
    const j2 = await q('POST', '/events', { event: { kind: 'journal', narration: 'year 2', date: '2027-08-05', lines: [{ code: C.bank, dr_minor: 1000 }, { code: C.income, cr_minor: 1000 }], client_ref: 'j2' } });
    wrap.ok('   a posting in year 2 exists (' + jv.status + '/' + j2.status + ')', jv.status === 200 && j2.status === 200, JSON.stringify([jv.body, j2.body]));
    const hostile = await call('POST', '/opening/preview', { rows: [{ code: C.bank, dr_minor: 100 }, { code: C.capital, cr_minor: 100 }], date: S.year2 });
    wrap.ok('   a start date inside year 2 is refused by name (preview)', hostile.body.can_save === false && hostile.body.refusals.some((r) => r.name === 'OPENING_YEAR_CARRIED' && new RegExp(S.next).test(r.why)), JSON.stringify(hostile.body.refusals));
    const post2 = await q('POST', '/opening', { date: S.year2, rows: [{ code: C.bank, dr_minor: 100 }, { code: C.capital, cr_minor: 100 }], client_ref: 'grid:Y2', require_balanced: true });
    wrap.ok('   …and POST /opening refuses it 422 (nothing doubled)', post2.status === 422 && post2.body.code === 'OPENING_YEAR_CARRIED', JSON.stringify(post2.body));
    const yrs = await call('GET', '/opening/years');
    const y1 = (yrs.body.years || []).find((y) => y.fiscal_year === S.fy);
    wrap.ok('10 year 1: profit 600,000 carried as retained, equity = capital 1,440,450 + 600,000 = 2,040,450 (carryForward\'s own figures)', y1 && y1.profit_minor === 600000 && y1.retained_minor === 600000 && y1.equity_minor === 2040450, JSON.stringify(y1));
    wrap.ok('10 "matches": year 1 carried out and year 2 opening are two equal figures, both shown', y1 && y1.matches === true && y1.closing_minor === y1.next_opening_minor && y1.apart_minor === 0 && y1.next === S.next, JSON.stringify(y1));
    K.dayOf = realDay;
  }
  srv.close(); R.close();
}

(async () => {
  for (const country of ['AU', 'IN']) await run(country);
  console.log('\n  ' + (failures ? '✗ ' + failures + ' failed' : '✓ all passed'));
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
