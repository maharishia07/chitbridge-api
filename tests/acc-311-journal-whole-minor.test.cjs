/**
 * acc-311-journal-whole-minor.test.cjs — ACC-311 + ACC-276: A TYPED JOURNAL LINE IS A WHOLE NUMBER OF MINOR UNITS, REFUSED, NEVER ROUNDED (SIT hunt ACC-H7).
 *
 * POST /api/books/entries through real express and the in-memory store. dr_minor 0.5 / cr_minor 0.5 answered 200 and posted MJ/..., the trial balance moved
 * (givenLines → fromMinor rounded the half unit up). The one reader, lib/books-manual givenLines, now asks lib/bounds (minor fragment: whole, below the chit ceiling).
 * Hand expectations (written before the code): 0.5/0.5 → 422 BOOKS_REFUSED, 0 entries; 1000.4 against 1000 → 422; 100.5/100.5 → 422; 1e16 → 422;
 * 500/500 → 200 and exactly two lines [1400 Dr 500] [3000 Cr 500]; -500 keeps the engine's own refusal (4xx, nothing written).
 * Run: node tests/acc-311-journal-whole-minor.test.cjs   (BOOKS_ENGINES_SRC=<chitbridge-engines/src>)
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 */
'use strict';
const { rig, counter } = require('./support/books-manual-rig.cjs');
const { ok, done } = counter();

(async () => {
  console.log('\n══ ACC-311 · a fractional minor unit is refused on the manual journal ══\n');
  const R = await rig(); if (!R) return;
  const { q, X } = R, T = X.T;
  const D = '2026-10-05';
  const body = (dr, cr, ref) => ({ narration: 'whole minor ' + ref, date: D, client_ref: ref, lines: [{ code: '1400', dr_minor: dr }, { code: '3000', cr_minor: cr }] });
  const n0 = T.entries.length;
  for (const [what, dr, cr] of [['0.5 / 0.5 (ACC-311)', 0.5, 0.5], ['1000.4 against 1000', 1000.4, 1000], ['100.5 / 100.5 (ACC-276)', 100.5, 100.5], ['"100.5" as text', '100.5', '100.5'], ['1e16 (beyond the ceiling)', 1e16, 1e16]]) {
    const r = await q('POST', '/entries', body(dr, cr, 'f-' + what.slice(0, 4)));
    ok(what + ' → 422 BOOKS_REFUSED, nothing written', r.status === 422 && r.body.code === 'BOOKS_REFUSED' && T.entries.length === n0, r.status + ' ' + JSON.stringify(r.body).slice(0, 160));
  }
  const frac = await q('POST', '/entries', body(0.5, 0.5, 'f-words'));
  ok('the sentence says whole minor units and that nothing was posted', /whole number of minor units/.test(JSON.stringify(frac.body)) && /Nothing was posted/.test(JSON.stringify(frac.body)), JSON.stringify(frac.body).slice(0, 200));
  const neg = await q('POST', '/entries', body(-500, -500, 'f-neg'));
  ok('a negative figure keeps the engine\'s own refusal (4xx, nothing written)', neg.status >= 400 && neg.status < 500 && T.entries.length === n0, neg.status + ' ' + JSON.stringify(neg.body).slice(0, 120));
  const good = await q('POST', '/entries', body(500, 500, 'g-ok'));
  const e = T.entries.find((x) => x.source_ref === 'manual:g-ok');
  const lines = e ? T.lines.filter((l) => l.entry_id === e.entry_id).sort((a, b) => a.line_no - b.line_no).map((l) => [l.code, l.dr_minor, l.cr_minor]) : [];
  ok('whole 500 / 500 still posts: Dr 1400 500, Cr 3000 500', good.status === 200 && JSON.stringify(lines) === JSON.stringify([['1400', 500, 0], ['3000', 0, 500]]), good.status + ' ' + JSON.stringify(lines));
  R.close(); done();
})().catch((x) => { console.error(x); process.exit(1); });
