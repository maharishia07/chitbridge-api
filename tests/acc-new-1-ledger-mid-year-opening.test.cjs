/**
 * acc-new-1-ledger-mid-year-opening.test.cjs — ACC-new-1 (l16 consistency run, 15 Nov 2026): a move-in opening dated MID-year was counted twice on the ledger.
 * Through real express over the in-memory ledger (the shop's day pinned to 2026-10-10, FY 2026-27 from 1 Apr).
 *
 * HAND (INR paise): opening JV dated 2026-10-01: Dr 1400 Cash 1,000,000 / Cr 3000 Capital 1,000,000 (period 0). A rent payment dated 2026-10-05:
 * Dr 6010 16,500 / Cr 1400 16,500. The trial balance's Cash at 31 Oct = 1,000,000 - 16,500 = 983,500, so the Cash ledger must close at 983,500 whatever
 * `from` is, and its opening is the carried 1,000,000 (period 0 is in the opening, never a line):
 *   from 2026-04-01 (year start)   opening 1,000,000 · lines 1 (the rent)  · closing 983,500
 *   from 2026-09-30 (day before)   opening 1,000,000 · lines 1             · closing 983,500
 *   from 2026-10-01 (opening day)  opening 1,000,000 · lines 1             · closing 983,500   ← was 1,983,500 (the bug)
 *   from 2026-10-02 (day after)    opening 1,000,000 · lines 1             · closing 983,500
 *   from 2026-10-06 (after rent)   opening  983,500 · lines 0              · closing 983,500
 * The same on the paged read (?limit=) and its page sums.
 * Run: node tests/acc-new-1-ledger-mid-year-opening.test.cjs   (BOOKS_ENGINES_SRC=<chitbridge-engines/src>) — on a SIT box or CI, not the laptop.
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 */
'use strict';
const { rig, counter } = require('./support/books-manual-rig.cjs');
const { ok, eq, done } = counter();

(async () => {
  console.log('\n══ ACC-new-1 — a mid-year opening is on the ledger once, whatever the from date ══\n');
  const R = await rig(); if (!R) return;
  const { q } = R;
  const op = await q('POST', '/opening', { date: '2026-10-01', rows: [{ code: '1400', dr_minor: 1000000 }, { code: '3000', cr_minor: 1000000 }], client_ref: 'mid' });
  ok('(set-up) the opening dated 2026-10-01 posts', op.status === 200, JSON.stringify(op.body));
  const rent = await q('POST', '/entries', { narration: 'Rent', date: '2026-10-05', client_ref: 'rent', lines: [{ code: '6010', dr_minor: 16500 }, { code: '1400', cr_minor: 16500 }] });
  ok('(set-up) the rent dated 2026-10-05 posts', rent.status === 200, JSON.stringify(rent.body));
  const tb = await q('GET', '/trial-balance?asOf=2026-10-31');
  const cash = ((tb.body && tb.body.rows) || []).find((r) => String(r.code) === '1400') || { dr_minor: 0, cr_minor: 0 };
  eq('the trial balance carries Cash 983,500 (hand)', Number(cash.dr_minor) - Number(cash.cr_minor), 983500);
  const cases = [['2026-04-01', 1000000, 1], ['2026-09-30', 1000000, 1], ['2026-10-01', 1000000, 1], ['2026-10-02', 1000000, 1], ['2026-10-06', 983500, 0]];
  for (const [from, opening, n] of cases) {
    for (const paged of ['', '&limit=50']) {
      const r = await q('GET', '/ledger/1400?from=' + from + '&to=2026-10-31' + paged);
      eq('from ' + from + (paged ? ' (paged)' : '') + ' → opening / lines / closing', [r.body.opening_minor, (r.body.lines || []).length, r.body.closing_minor], [opening, n, 983500]);
      ok('…no opening JV among the lines', !(r.body.lines || []).some((l) => /^JV\//.test(l.ref)), JSON.stringify(r.body.lines));
    }
  }
  R.close();
  done();
})().catch((e) => { console.error(e); process.exit(1); });
