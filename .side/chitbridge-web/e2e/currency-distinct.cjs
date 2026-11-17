/**
 * e2e/currency-distinct.cjs — two different currencies must never print as the same string.
 *
 * ⚠️⚠️ THE PLATFORM'S MONEY RULE MAKES THIS LOAD-BEARING. Amounts are never converted: "you always see the
 * currency the price was written in." If SGD 500 and USD 500 both render "$500.00", that promise is not merely
 * unhelpful — it is false, and falser than converting would be, because a converted number at least LOOKS
 * different. Two currencies wearing one glyph is an invisible ambiguity on a number people trade on.
 *
 * ⚠️ IT WAS REAL, AND THE OLD FOUR-CURRENCY ENVELOPE WAS HIDING IT. currencyDisplay:'narrowSymbol' collapses
 * USD/SGD/AUD/CAD to '$' and CNY/JPY to '¥' in every locale. INR, USD, MXN and EUR never collide, so while the
 * base constitution permitted only those four the bug could not be triggered. Widening the list to all 162 ISO
 * codes is what exposed it — a list that grows tests things that were never true, only untested.
 *
 * ⭐ SO THIS GUARD IS THE PAIR TO THAT WIDENING, not a separate idea: it fails the moment somebody "tidies"
 * money() back to the narrower symbol.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const store = {};
const sb = {
  console, Intl,
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  document: { getElementById: () => null,
    documentElement: { style: { setProperty(){}, removeProperty(){} }, setAttribute(){}, removeAttribute(){}, classList: { add(){}, remove(){} } },
    body: { classList: { add(){}, remove(){} }, setAttribute(){} },
    createElement: () => ({ style: {}, setAttribute(){}, appendChild(){} }), head: { appendChild(){} },
    querySelector: () => null, querySelectorAll: () => [] },
  setTimeout: () => 0, clearTimeout(){}, fetch: async () => ({ ok: false }),
  navigator: { language: 'en-IN', languages: ['en-IN'] }, location: { origin: '', host: 'h', search: '' },
};
sb.window = sb; sb.globalThis = sb;
const ctx = vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'engine', 'locale.js'), 'utf8'), ctx, { filename: 'locale.js' });
const C = ctx.CBLocale;

/**
 * ⚠️ THE PAIRS THAT ACTUALLY COLLIDE, NOT ALL 162 SQUARED. Every dollar and every yen — the families whose
 * members share a glyph. A full cross-product would be 13k comparisons to re-derive the same six answers, and
 * would fail on genuinely unrelated pairs the day CLDR reuses a mark somewhere obscure.
 */
const FAMILIES = [
  ['USD', 'SGD', 'AUD', 'CAD', 'NZD', 'HKD', 'TWD'],
  ['CNY', 'JPY'],
  ['INR', 'PKR', 'LKR', 'NPR'],
  ['EUR', 'GBP', 'CHF'],
];
/* Read in several places, because the collision is locale-dependent — en-SG disambiguates a different member
   of the dollar family than en-IN does. Passing in one locale proves nothing about the others. */
const READERS = ['IN', 'SG', 'US', 'JP', 'DE', 'AE'];

let pass = 0, fail = 0;
const seen = [];
for (const region of READERS) {
  store['cb_region'] = region; store['cb_format'] = '';
  for (const fam of FAMILIES) {
    const printed = new Map();
    for (const cur of fam) {
      const s = C.money(500, cur);
      if (printed.has(s)) {
        fail++;
        seen.push('  \u2717 reader in ' + region + ': ' + printed.get(s) + ' and ' + cur + ' both print "' + s + '"');
      } else { printed.set(s, cur); pass++; }
    }
  }
}

/* ⭐ AND THE SYMBOL ALONE, which the profile row shows beside the code. Its collisions are less dangerous
   (the code is right next to it) but it feeds other screens, so it is measured rather than assumed. */
store['cb_region'] = 'IN'; store['cb_format'] = '';
const symUS = C.symbol('USD'), symSG = C.symbol('SGD');
if (symUS === symSG) { fail++; seen.push('  \u2717 symbol(): USD and SGD are both "' + symUS + '"'); } else pass++;

console.log('\n  money() across ' + READERS.length + ' readers \u00d7 ' + FAMILIES.length + ' currency families\n');
if (seen.length) seen.forEach((l) => console.error(l));
console.log('  sample (reader in IN): ' + ['INR','USD','SGD','CNY','JPY'].map((c) => C.money(500, c)).join('   '));
console.log('\n  \u2550\u2550 ' + pass + ' distinct \u00b7 ' + fail + ' collisions \u2550\u2550\n');
process.exit(fail ? 1 : 0);
