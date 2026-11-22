/**
 * tests/books-reclass-rate.test.cjs - A RECLASS THROUGH THE REAL +ENTRY DOOR CLEARS needs_answer (EGM-T1 major M1, 21 Nov; ACC-290 part A, critic change 4).
 *
 * OWNS      the proof that books-manual.givenLines (the ONE reader of a typed journal, used by POST /entries) carries a line's `rate`, so a reclass of 0% sales (Dr 4000 at rate 0,
 *           Cr the kind's ledger) is stored with tax_rate '0' and nets the books' 0% reading (S.zeroRateSales) to nothing; without the rate the Dr line carried none and the note stayed at the full amount.
 *           A rate outside 0..100 is refused in words. Needs the books engines with the manual-line rate (CB_ENGINES_DIR / BOOKS_ENGINES_SRC at the supply-kind checkout; without it SKIP).
 * CALLED BY scripts/guards.cjs - CI. No database: the in-memory books. Hand figures (AUD): a 0% sale of A$5,000.00 (500000 minor) sits on 4000; the reclass moves it to GST-free 4020 -> needs_answer 500000 before, null after.
 * Run: BOOKS_ENGINES_SRC=../chitbridge-engines/src node -r ./tests/support/engines-checkout.cjs tests/books-reclass-rate.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); process.exitCode = 1; } };

(async () => {
  console.log('\n== a reclass through givenLines (the +Entry door) clears needs_answer ==\n');
  const X = H.load({});
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); console.log('\n   0 checks'); return; }
  const manual = require(path.join(H.API, 'lib', 'books-manual'));
  const P = require(path.join(H.API, 'lib', 'books-period'));
  const SHOP = 'aaaaaaaa-1111-4111-8111-111111111111';
  await X.store.saveSetting(X.db, SHOP, { enabled: true, walkin_grain: 'day', country: 'AU', functional_currency: 'AUD', fy_start_month: 7 });
  const codeOf = (role) => require(path.join(X.src.dir, 'country')).packFor('AU').ledgers.filter((x) => x.role === role).map((x) => x.code)[0]; /* the AU pack's own chart */
  const BANKC = codeOf('bank'), SALESC = codeOf('sales'), FREEC = codeOf('sales_gst_free');
  const row = { id: 'unknown', role: 'sales', kinds: ['taxable', 'gst_free', 'input_taxed'], boxes: ['G3'], ask: 'Is this sale taxable, GST-free or input-taxed?', why: 'x' };
  const period = { start: '2026-07-01', end: '2026-09-30' };
  const need = () => P.unknownKindNeed(X.dbStub, SHOP, { returns: { unknownKind: row } }, period, 'AUD', true);
  /* the 0% sale itself: a typed journal that states its rate, as a till day close does (rate '0' on the sales credit) */
  const sale = manual.givenLines([{ code: BANKC, dr_minor: 500000 }, { code: SALESC, cr_minor: 500000, rate: 0 }], 'AUD');
  ok('the sale line carries its stated rate as text, the bank line none', sale[1].rate === '0' && sale[0].rate === undefined, JSON.stringify(sale));
  await X.B.postEntry(X.db, SHOP, { type: 'manual', owner: true, narration: '0% sale', date: '2026-08-10', currency: 'AUD', strict_date: true, lines: sale, source_ref: 'manual:sale-1' });
  let before = await need();
  ok('before the reclass: needs_answer holds A$5,000.00 (500000 minor)', !!before && before.total_minor === 500000, JSON.stringify(before));
  /* the reclass as POST /entries sends it: Dr 4000 5,000.00 at rate 0, Cr 4020 5,000.00 */
  const reclass = manual.givenLines([{ code: SALESC, dr_minor: 500000, rate: '0' }, { code: FREEC, cr_minor: 500000 }], 'AUD');
  ok('the Dr 4000 line keeps rate "0" (givenLines no longer drops it)', reclass[0].rate === '0');
  const posted = await X.B.postEntry(X.db, SHOP, { type: 'manual', owner: true, narration: 'reclass to GST-free', date: '2026-08-12', currency: 'AUD', strict_date: true, lines: reclass, source_ref: 'manual:reclass-1' });
  ok('the reclass posts', posted && posted.ok !== false, JSON.stringify(posted));
  ok('after the reclass through givenLines: needs_answer is gone (null)', (await need()) === null);
  /* the same reclass WITHOUT the rate (what POST /entries did before): the note would stay - shown once, so the test is not a tautology */
  const plain = manual.givenLines([{ code: SALESC, dr_minor: 100000 }, { code: FREEC, cr_minor: 100000 }], 'AUD');
  ok('a Dr line that states no rate carries none (so it cannot net a 0% reading: the sender must say it)', plain[0].rate === undefined);
  const refused = (fn) => { try { fn(); return null; } catch (e) { return e; } };
  ok('a rate of 150 or "abc" is refused in words', /rate of a line must be a number from 0 to 100/.test((refused(() => manual.givenLines([{ code: SALESC, dr_minor: 1, rate: 150 }], 'AUD')) || {}).message || '') && !!refused(() => manual.givenLines([{ code: SALESC, dr_minor: 1, rate: 'abc' }], 'AUD')));
  ok('an empty rate is no rate', manual.givenLines([{ code: SALESC, dr_minor: 1, rate: '' }], 'AUD')[0].rate === undefined);
  console.log('\n   ' + pass + ' checks' + (fail ? ' - ' + fail + ' FAILED' : ''));
})().catch((e) => { console.log('   FAIL threw ' + e.stack); process.exitCode = 1; });
