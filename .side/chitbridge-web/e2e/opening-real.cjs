/* opening-real.cjs — l16-openbal · the opening balances routes against a REAL Postgres (a SIT box's throwaway api + database: C:/dev/shots/l16-openbal/box/ob-*.sh). No browser.
 * Run on the box (ob-api.sh): env API (http://127.0.0.1:3988), TESTER_CODE (+ _TZ), OUT. Shops seeded by ob-seed.cjs: openbal-au (1 Jul year) and openbal-in (1 Apr year), no opening yet, two customers, one supplier.
 * EXPECTED (hand, before the run), cents: bank 1,234,050 Dr · debtors control 440,000 Dr = bills 330,000 + 110,000 · tax paid 20,000 Dr · creditors 220,000 Cr = one bill · tax collected 40,000 Cr.
 *   Debit 1,694,050 · Credit 260,000 · Difference 1,434,050 Cr until equity 1,434,050 Cr, then 0. Save while out → 422, nothing in Suspense. Bills 100,000 short of the typed debtors → refused.
 *   The same rows twice → 409 naming the entry. Replace bank → 1,230,450 with equity 1,430,450 and a reason → old reversed, new posted, trips read. A change that fails AFTER the reverse (a bill ref held by
 *   another party in a second opening of another day) leaves the old opening live and writes no log line (ATOMICITY on a real database). */
'use strict';
const fs = require('fs'), path = require('path');
const L = require('./lib/live-harbour.cjs');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const trips = [];
async function run(handle, S) {
  console.log('\n== ' + handle + ' ==');
  fs.rmSync(path.join(process.env.OUT || '.', 'token.json'), { force: true }); /* the sign-in cache is one file: one shop at a time */
  const token = await L.signIn(handle);
  const call = async (m, u, b) => { const res = await fetch(L.API + u, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: b === undefined ? undefined : JSON.stringify(b) }); const text = await res.text(); let json = {}; try { json = JSON.parse(text); } catch (_) {} return { status: res.status, body: json, trips: res.headers.get('x-db-trips') }; };
  const note = (name, r) => trips.push({ route: name, status: r.status, trips: r.trips == null ? null : Number(r.trips) });
  const per = (await call('GET', '/api/books/periods')).body.periods || [];
  const cset = (await call('GET', '/api/governance/country-setup')).body;
  console.log('   periods ' + JSON.stringify(per.slice(0, 3).map((r) => [r.fiscal_year, r.period, r.start_date])) + ' · setup fy_start_month ' + cset.fy_start_month + ' · country ' + JSON.stringify(cset.country));
  const chart = (await call('GET', '/api/books/accounts')).body.accounts;
  const code = (role) => (chart.find((a) => a.role === role) || {}).code;
  const parties = (await call('GET', '/api/crm/parties')).body.parties || [];
  const pid = (name) => (parties.find((p) => /Ravi|Anil|Kumar/.test(p.name || p.display_name || '') && new RegExp(name).test(p.name || p.display_name || '')) || {}).party_id;
  const A = pid('Ravi'), B = pid('Anil');
  ok(!!A && !!B, 'two customers found');
  const C = { bank: code('bank'), debtors: code('debtors'), creditors: code('creditors'), capital: code('capital') };
  const taxPaid = S.taxPaid, taxColl = S.taxColl;
  const SUP = (parties.find((p) => /Kumar/.test(p.name || '')) || {}).party_id;
  const D = S.start;
  const grid = (o) => [{ code: C.bank, dr_minor: (o && o.bank) || 1234050 },
    { code: C.debtors, party_id: A, dr_minor: 330000, bill_ref: 'INV-1', bill_date: S.billDate, due_date: S.due },
    { code: C.debtors, party_id: A, dr_minor: 110000 + ((o && o.short) || 0), bill_ref: 'INV-2', due_date: S.due },
    { code: C.creditors, party_id: SUP, cr_minor: 220000, bill_ref: 'B-9', due_date: S.due },
    { code: C.debtors, dr_minor: 440000, control: true }, { code: C.creditors, cr_minor: 220000, control: true },
    { code: taxPaid, dr_minor: 20000 }, { code: taxColl, cr_minor: 40000 }].concat((o && o.equity) ? [{ code: C.capital, cr_minor: o.equity }] : []);
  const p1 = await call('POST', '/api/books/opening/preview', { rows: grid(), date: D }); note('POST /api/books/opening/preview', p1);
  ok(p1.status === 200 && p1.body.debit_minor === 1694050 && p1.body.credit_minor === 260000 && p1.body.difference_minor === 1434050 && p1.body.side === 'cr' && p1.body.can_save === false, '1  Difference 1,434,050 Cr from the engine: ' + JSON.stringify([p1.status, p1.body.debit_minor, p1.body.credit_minor, p1.body.difference_minor]));
  const p1b = await call('POST', '/api/books/opening/preview', { rows: grid({ equity: 1434050 }), date: D });
  ok(p1b.body.difference_minor === 0 && p1b.body.can_save === true, '1  with equity the Difference is 0 and Save is allowed');
  const p3 = await call('POST', '/api/books/opening/preview', { rows: grid({ equity: 1434050, short: -10000 }), date: D });
  ok(p3.body.can_save === false && (p3.body.refusals || []).some((r) => /apart/.test(r.why)), '3  bills short of the typed debtors line: refused — ' + ((p3.body.refusals || [])[0] || {}).why);
  const out = await call('POST', '/api/books/opening', { date: D, rows: grid().filter((r) => !r.control), client_ref: 'grid:2' + handle, require_balanced: true });
  ok(out.status === 422 && out.body.code === 'OPENING_NOT_BALANCED', '2  Save while out → 422 OPENING_NOT_BALANCED: ' + out.status);
  const rowsOnly = (o) => grid(o).filter((r) => !r.control);
  const save = await call('POST', '/api/books/opening', { date: D, rows: rowsOnly({ equity: 1434050 }), client_ref: 'grid:A' + handle, require_balanced: true }); note('POST /api/books/opening', save);
  ok(save.status === 200 && save.body.suspense_minor === 0 && /\//.test(save.body.entry_no || ''), 'Save at 0 → ' + save.status + ' ' + save.body.entry_no + ' suspense ' + save.body.suspense_minor);
  const saved = await call('GET', '/api/books/opening?date=' + D); note('GET /api/books/opening', saved);
  ok(saved.status === 200 && saved.body.lines.length === 7 && saved.body.lines.some((l) => l.bill_ref === 'INV-1' && l.bill_date === S.billDate && l.due_date === S.due) && saved.body.entries[0].at && saved.body.pinned.length >= 5, 'saved view: 7 lines, INV-1 with its bill date and due, who/when, pinned ' + (saved.body.pinned || []).length);
  console.log('   saved bills ' + JSON.stringify(saved.body.lines.filter((l) => l.party_id).map((l) => [l.code, l.party_id, l.bill_ref, l.bill_date, l.due_date, l.cr_minor])) + ' supplier ' + SUP);
  const dup = await call('POST', '/api/books/opening', { date: D, rows: rowsOnly({ equity: 1434050 }), client_ref: 'grid:B' + handle, require_balanced: true });
  ok(dup.status === 409 && new RegExp(save.body.entry_no).test(JSON.stringify(dup.body)), '9  the same rows again → 409 naming ' + save.body.entry_no);
  const noWhy = await call('POST', '/api/books/opening/replace', { date: D, rows: grid({ bank: 1230450, equity: 1430450 }), client_ref: 'grid:C' + handle, reason: '' });
  ok(noWhy.status === 400, '8  an empty reason → 400');
  /* ATOMICITY: a failure AFTER the reverse. A second opening on ANOTHER day holds bill X-1 for customer B; the change names X-1 for customer A: the dry run cannot see it, the repost refuses it. */
  const day2 = S.day2;
  const second = await call('POST', '/api/books/opening', { date: day2, rows: [{ code: C.debtors, party_id: B, dr_minor: 5000, bill_ref: 'X-1' }, { code: C.capital, cr_minor: 5000 }], client_ref: 'grid:D2' + handle, require_balanced: true });
  ok(second.status === 200, 'a second opening on ' + day2 + ' holds bill X-1 for the other customer: ' + second.status + ' ' + JSON.stringify(second.body).slice(0, 120));
  const failing = grid({ bank: 1230450, equity: 1430450 }).concat([{ code: C.debtors, party_id: A, dr_minor: 100, bill_ref: 'X-1' }, { code: C.capital, cr_minor: 100 }]);
  const before = (await call('GET', '/api/books/opening?date=' + D)).body;
  const fl = await call('POST', '/api/books/opening/replace', { date: D, rows: failing.map((r) => (r.control && r.code === C.debtors ? Object.assign({}, r, { dr_minor: 440100 }) : r)), client_ref: 'grid:F' + handle, reason: 'forced failure after the reverse' });
  const after = (await call('GET', '/api/books/opening?date=' + D)).body;
  console.log('   failing change answered ' + fl.status + ' ' + JSON.stringify(fl.body).slice(0, 160));
  ok(fl.status >= 400, 'ATOMIC  the failing change is refused (' + fl.status + ')');
  ok(JSON.stringify(before.entries.map((e) => e.entry_no)) === JSON.stringify(after.entries.map((e) => e.entry_no)) && after.lines.length === before.lines.length, 'ATOMIC  the old opening is still the live one: entries ' + JSON.stringify(after.entries.map((e) => e.entry_no)) + ' (no reversal survived)');
  console.log('   (change lines follow the replace)');
  const rep = await call('POST', '/api/books/opening/replace', { date: D, rows: grid({ bank: 1230450, equity: 1430450 }), client_ref: 'grid:C' + handle, reason: 'typing slip' }); note('POST /api/books/opening/replace', rep);
  ok(rep.status === 200 && rep.body.reversed.length === 1 && rep.body.changes === 2, '8  bank 1,234,050 → 1,230,450 + equity 1,430,450 with a reason → 200, reversed ' + JSON.stringify(rep.body.reversed) + ', ' + rep.body.changes + ' changes');
  console.log('   changed: ' + JSON.stringify(rep.body.changed));
  const rep2 = await call('POST', '/api/books/opening/replace', { date: D, rows: grid({ bank: 1230450, equity: 1430450 }), client_ref: 'grid:C' + handle, reason: 'typing slip' });
  ok(rep2.status === 200 && rep2.body.duplicate === true, '8  the same change tapped twice is a replay');
  const yrs = await call('GET', '/api/books/opening/years'); note('GET /api/books/opening/years', yrs);
  ok(yrs.status === 200 && Array.isArray(yrs.body.years) && yrs.body.years.length >= 1, 'years strip read: ' + JSON.stringify(yrs.body.years).slice(0, 200));
  const lock = await call('POST', '/api/books/periods/' + (yrs.body.years[0] || {}).fiscal_year + '/0/lock', { reason: 'test' });
  const locked = await call('POST', '/api/books/opening/replace', { date: D, rows: grid({ bank: 1200000, equity: 1400000 }), client_ref: 'grid:L' + handle, reason: 'try' });
  ok(lock.status === 200 ? (locked.status >= 400 && /locked/i.test(JSON.stringify(locked.body))) : true, '8  a locked opening refuses the change in words (lock ' + lock.status + ', change ' + locked.status + ')');
  if (lock.status === 200) await call('POST', '/api/books/periods/' + yrs.body.years[0].fiscal_year + '/0/unlock', { reason: 'done' });
}
(async () => {
  await run('openbal-au', { start: '2026-07-01', day2: '2026-07-02', billDate: '2026-06-20', due: '2026-07-31', taxPaid: '2210', taxColl: '2200' });
  await run('openbal-in', { start: '2026-04-01', day2: '2026-04-02', billDate: '2026-03-20', due: '2026-04-30', taxPaid: '2210', taxColl: '2200' });
  console.log('\nTRIPS ' + JSON.stringify(trips));
  fs.writeFileSync(path.join(process.env.OUT || '.', 'opening-real-trips.json'), JSON.stringify(trips, null, 1));
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
