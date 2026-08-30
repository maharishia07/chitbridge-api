/**
 * tests/itemmatch-qualifier.test.cjs — a different qualifier is not a misspelling.
 *
 * ⚠️⚠️ FOUR DIFFERENT PARTS WERE COLLAPSING INTO ONE. Found 2026-08-30 in Athi's own WhatsApp
 * test message: "AC filter-um maathidunga" produced an Oil filter line. Stage 4 read its tolerance
 * from the CANDIDATE'S TOTAL LENGTH, so "Oil filter" (10 chars) earned a tolerance of 3 — and because
 * both strings share the long suffix "filter", the entire distance sits in the short word that names
 * the product:
 *
 *   AC filter   -> Oil filter   distance 3, tolerance 3   ACCEPTED
 *   Air filter  -> Oil filter   distance 2, tolerance 3   ACCEPTED
 *   Fuel filter -> Oil filter   distance 3, tolerance 3   ACCEPTED
 *
 * ⭐ Edit distance cannot tell a typo from a different qualifier — and it gets the ORDER wrong:
 * "Oil fillter" is 1 edit while "Air filter" is 2, so the WRONG PRODUCT scores worse than the typo and
 * still passes. In a workshop those are four parts at four prices, and the customer gets the wrong one.
 *
 * ⭐⭐ THE RULE IS PER WORD NOW, and a near miss becomes AMBIGUOUS WITH CANDIDATES rather than a
 * refusal (Athi's call): the person is asked "you said AC filter, the nearest we sell is Oil filter"
 * instead of being handed the wrong part silently. capture.js already turns that into needs_human.
 */
const im = require('C:/dev/chitbridge-api/lib/itemmatch');

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.error('  ✗ ' + name + (extra ? '   ' + extra : '')); }
};
const mk = (name, syn = []) => ({ name, variant: null, synonyms: syn.map(im.norm) });
const CAT = { items: [mk('Oil filter'), mk('Engine oil'), mk('Brake pad'), mk('Coolant'), mk('Battery')],
              variantsOf: {} };
const m = (phrase) => im.match(phrase, '', CAT);

console.log('\n-- ⭐⭐ a different qualifier must NOT be taken as a misspelling --');
for (const ph of ['AC filter', 'Air filter', 'Fuel filter']) {
  const r = m(ph);
  t(ph + ' does not become Oil filter', !r.item, r.item ? 'MATCHED ' + r.item.name : 'not matched');
  t('  ...and is offered as ambiguous', !!r.ambiguous);
  t('  ...carrying the near candidate', (r.candidates || []).some((c) => /Oil filter/i.test(c.name || '')),
    JSON.stringify((r.candidates || []).map((c) => c.name)));
}

console.log('\n-- ⚠️ real misspellings must still resolve, or this made things worse --');
const typos = [['oil filtr', 'Oil filter'], ['oil fillter', 'Oil filter'],
               ['coolent', 'Coolant'], ['batery', 'Battery'], ['brak pad', 'Brake pad']];
for (const [ph, want] of typos) {
  const r = m(ph);
  t(ph + ' still resolves to ' + want, !!r.item && r.item.name === want,
    r.item ? r.item.name : (r.ambiguous ? 'ambiguous' : 'unmatched'));
}

console.log('\n-- exact and synonym paths are untouched --');
t('an exact name still matches exactly', m('Oil filter').how === 'exact');
t('Brake pad still matches exactly', m('Brake pad').how === 'exact');
/* ⚠️ A single word falls through to the OLD whole-string rule — the per-word rule needs two sides to
   compare word for word, and one-word catalogues (Coolant, Battery) are most of a real one. */
t('a one-word phrase uses the whole-string rule', m('coolent').how === 'fuzzy');

console.log('\n-- nothing close stays unmatched, not ambiguous --');
for (const ph of ['AC gas', 'wheel alignment']) {
  const r = m(ph);
  t(ph + ' is unmatched', !!r.unmatched, r.ambiguous ? 'ambiguous' : (r.item ? r.item.name : 'unmatched'));
}

console.log('\n-- ⚠️⚠️ the exact numbers, so a future tolerance tweak cannot pass silently --');
t('lev(ac filter, oil filter) is 3', im.lev(im.norm('AC filter'), im.norm('Oil filter')) === 3);
t('lev(air filter, oil filter) is 2', im.lev(im.norm('Air filter'), im.norm('Oil filter')) === 2);
t('lev(oil fillter, oil filter) is 1', im.lev(im.norm('oil fillter'), im.norm('Oil filter')) === 1);
/* ⭐ The proof that distance alone cannot decide: the WRONG PRODUCT sits between two real typos. */
t('a wrong product scores WORSE than a typo and still used to pass',
  im.lev(im.norm('Air filter'), im.norm('Oil filter')) > im.lev(im.norm('oil fillter'), im.norm('Oil filter')));

console.log('\n  == ' + pass + ' passed - ' + fail + ' failed ==\n');
process.exitCode = fail ? 1 : 0;
