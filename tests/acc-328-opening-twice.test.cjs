/**
 * acc-328-opening-twice.test.cjs — ACC-328 + ACC-329, through real express over the in-memory ledger (the race is in the .realstack twin).
 *
 * ACC-328  the same opening posted twice doubled the books. Hand example (INR paise): Dr 1400 Cash 100000 / Cr 3000 Capital 100000 on 2026-04-01, ref "a"
 *          → JV/…/000001. The same rows under ref "b" must answer 409 BOOKS_CONFLICT (cash stays 100000, not 200000); the same ref "a" again is a RETRY and
 *          still answers 200 duplicate:true; another body posts (a DIFFERENT opening on the same date is allowed — move-in posts three); an unbalanced opening
 *          (Suspense 2900 added by the engine) twice is refused too; after the first is reversed the same rows post again.
 * ACC-329  a NEW opening dated later than tomorrow is refused "That date is in the future." (it started a future financial year); tomorrow passes; the
 *          REVERSAL of an opening already posted with a future date still works; the move-in preview refuses it in the same words.
 * ACC-246 a trial balance dated before the ledger's first day (2026-03-31, ledger began 2026-04-01) previewed clean and the import then refused it: the preview
 *          now answers the import's 422 and sentence (openingDateGate = before-start + future); the first day itself and a not-future date still pass.
 * Run: node tests/acc-328-opening-twice.test.cjs   (BOOKS_ENGINES_SRC=<chitbridge-engines/src>)
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 */
'use strict';
const { rig, counter } = require('./support/books-manual-rig.cjs');
const { ok, eq, done } = counter();

(async () => {
  console.log('\n══ ACC-328 / ACC-329 — an opening is posted once, and not in the future ══\n');
  const R = await rig(); if (!R) return;
  const { X, q } = R, T = X.T;
  const D = '2026-04-01';
  const rows = (amt) => [{ code: '1400', dr_minor: amt }, { code: '3000', cr_minor: amt }];
  const openings = () => T.entries.filter((e) => e.is_opening && !e.reverses_entry_id);
  const cashDr = () => T.lines.filter((l) => openings().some((e) => e.entry_id === l.entry_id) && T.accounts.find((a) => a.account_id === l.account_id).code === '1400').reduce((s, l) => s + (l.dr_minor || 0), 0);

  console.log('— ACC-328');
  const first = await q('POST', '/opening', { date: D, rows: rows(100000), client_ref: 'a' });
  ok('the first opening posts (200, an entry number)', first.status === 200 && /^JV\//.test(first.body.entry_no), JSON.stringify(first.body));
  const again = await q('POST', '/opening', { date: D, rows: rows(100000), client_ref: 'b' });
  eq('the same rows under another ref → 409 BOOKS_CONFLICT', [again.status, again.body.code], [409, 'BOOKS_CONFLICT']);
  ok('…in words: the date, the entry, what to do', /already posted on 2026-04-01 as JV\/\S+\. To change them, reverse that entry first\./.test(JSON.stringify(again.body)), JSON.stringify(again.body));
  eq('…and the books are not doubled: cash 100000, one opening', [cashDr(), openings().length], [100000, 1]);
  const retry = await q('POST', '/opening', { date: D, rows: rows(100000), client_ref: 'a' });
  ok('the SAME ref again is a retry: 200, duplicate:true, the first entry (never a 409)', retry.status === 200 && retry.body.duplicate === true && retry.body.entry_no === first.body.entry_no, retry.status + ' ' + JSON.stringify(retry.body));
  const noRef = await q('POST', '/opening', { date: D, rows: rows(100000) });
  eq('the same rows with no ref at all → 409', noRef.status, 409);
  const other = await q('POST', '/opening', { date: D, rows: rows(50000), client_ref: 'c' });
  ok('a DIFFERENT opening on the same date posts (move-in posts three)', other.status === 200 && other.body.entry_no !== first.body.entry_no, JSON.stringify(other.body));
  const lone = [{ code: '1400', dr_minor: 70000 }];
  const u1 = await q('POST', '/opening', { date: D, rows: lone, client_ref: 'u1' });
  ok('an unbalanced opening posts with Suspense 2900 carrying 70000', u1.status === 200 && u1.body.suspense_minor === 70000, JSON.stringify(u1.body));
  const u2 = await q('POST', '/opening', { date: D, rows: lone, client_ref: 'u2' });
  eq('the same unbalanced opening twice (the stored Suspense line is not counted) → 409', u2.status, 409);
  const rev = await q('POST', '/entries/' + first.body.entry_id + '/reverse', { reason: 'posted by mistake' });
  ok('the first opening can be reversed', rev.status === 200, JSON.stringify(rev.body));
  const afterRev = await q('POST', '/opening', { date: D, rows: rows(100000), client_ref: 'd' });
  ok('after the reversal the same rows post again', afterRev.status === 200 && afterRev.body.entry_no !== first.body.entry_no, JSON.stringify(afterRev.body));

  console.log("— ACC-329 (the shop's day is pinned to 2026-10-10)");
  const f1 = await q('POST', '/opening', { date: '2029-03-31', rows: rows(100000), client_ref: 'f1' });
  eq('an opening dated 2029-03-31 → 422', f1.status, 422);
  ok('…"That date is in the future."', /That date is in the future\./.test(JSON.stringify(f1.body)), JSON.stringify(f1.body));
  ok('…and no future financial year was started', !T.entries.some((e) => String(e.posting_date) >= '2027-04-01'), JSON.stringify(T.entries.map((e) => e.posting_date)));
  const f2 = await q('POST', '/opening', { date: '2026-10-12', rows: rows(10000), client_ref: 'f2' });
  eq('today + 2 → 422', f2.status, 422);
  const f3 = await q('POST', '/opening', { date: '2026-10-11', rows: rows(10000), client_ref: 'f3' });
  eq("tomorrow (the gate's own skew) posts", f3.status, 200);
  /* an opening already posted with a future date (as before the fix): writeReversal must still undo it */
  const old = await X.B.postEntry(X.db, R.SHOP, { type: 'opening', date: '2029-03-31', currency: 'INR', narration: 'old', lines: [{ account: '1400', dr: 10, cr: 0 }, { account: '3000', dr: 0, cr: 10 }], source_ref: 'opening:old' });
  ok('(set-up) a future-dated opening exists', old.ok && !!old.entry_id, JSON.stringify(old));
  const undo = await q('POST', '/entries/' + old.entry_id + '/reverse', { reason: 'wrong year' });
  ok('the reversal of an already posted future opening is NOT refused', undo.status === 200 && !!undo.body.entry_no, undo.status + ' ' + JSON.stringify(undo.body));
  const csv = 'Account Code,Debit,Credit\n1400,1000,0\n3000,0,1000\n';
  const mi = await q('POST', '/move-in/preview', { kind: 'trial_balance', source: 'xero', source_country: 'IN', as_at: '2029-03-31', csv });
  ok('the move-in preview refuses the future date in the same words', mi.status === 422 && /That date is in the future\./.test(JSON.stringify(mi.body)), mi.status + ' ' + JSON.stringify(mi.body).slice(0, 200));
  const mi2 = await q('POST', '/move-in/preview', { kind: 'trial_balance', source: 'xero', source_country: 'IN', as_at: '2026-10-10', csv });
  ok('…a date that is not future gets past this gate (any answer but the future sentence)', !/That date is in the future\./.test(JSON.stringify(mi2.body)), JSON.stringify(mi2.body).slice(0, 200));

  console.log('— ACC-246 (the ledger began 2026-04-01: a trial balance dated before it is refused by the preview as the import refuses it)');
  const bs = 'That date is before this ledger began (2026-04-01). What was owed before then goes in as an opening balance.';
  const b1 = await q('POST', '/opening', { date: '2026-03-31', rows: rows(10000), client_ref: 'b1' });
  ok('the import: an opening dated 2026-03-31 → 422 in words', b1.status === 422 && JSON.stringify(b1.body).includes(bs), b1.status + ' ' + JSON.stringify(b1.body));
  const mb = await q('POST', '/move-in/preview', { kind: 'trial_balance', source: 'xero', source_country: 'IN', as_at: '2026-03-31', csv });
  ok('the preview: the same date → the same 422 code and sentence', mb.status === 422 && mb.body.code === b1.body.code && JSON.stringify(mb.body).includes(bs), mb.status + ' ' + JSON.stringify(mb.body).slice(0, 240));
  const mo = await q('POST', '/move-in/preview', { kind: 'trial_balance', source: 'xero', source_country: 'IN', as_at: '2026-04-01', csv });
  ok('the preview: the ledger first day itself passes this gate', !/before this ledger began/.test(JSON.stringify(mo.body)), JSON.stringify(mo.body).slice(0, 200));
  const mf = await q('POST', '/move-in/preview', { kind: 'trial_balance', source: 'xero', source_country: 'IN', as_at: '2029-03-31', csv });
  ok('the preview: a future date is still refused', mf.status === 422 && /That date is in the future./.test(JSON.stringify(mf.body)), mf.status + ' ' + JSON.stringify(mf.body).slice(0, 200));

  R.close();
  done();
})().catch((e) => { console.error(e); process.exit(1); });
