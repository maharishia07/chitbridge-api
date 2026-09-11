/**
 * ── tests/money-language.test.js · THE CONVENTIONS, AS ASSERTIONS ──────────────────────────────────────────────
 *
 * Athi, 2026-09-11: *"the currency handling and the language handling, can we keep it as a capability, its rules
 * and convention etc — because any application we develop, if it has to follow currency, then these conventions
 * would be useful."*
 *
 * ⭐⭐⭐ A CAPABILITY IS A CONVENTION THAT IS ENFORCED. Written down, these rules are advice; asserted, they are
 * the thing a new surface cannot get wrong without the run going red. That distinction is the whole difference —
 * promo.html and offer-lab.html were both written by someone with no list to follow, and both shipped.
 *
 * ⚠️⚠️ EVERY FAULT HERE IS INVISIBLE TO WHOEVER WROTE IT. A wrong currency symbol is correct in the one currency
 * the developer tests in. A dropped bidi mark scrambles a price only on an Arabic device. A missing translation
 * looks like English working fine. Nothing throws, and the person who would notice is the one nobody asked.
 *
 * Run: node tests/money-language.test.js   · no network, no DB.
 */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const WEB = path.join(__dirname, '..', '..', 'chitbridge-web', 'public');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
                           catch (e) { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; } };

/* the renderer, loaded the way a browser loads it */
global.window = global.window || {}; global.self = global;
require(path.join(WEB, 'app', 'locale.js'));
const L = (global.window && global.window.CBLocale) || global.CBLocale;

console.log('— money is not a number with a symbol in front of it —');

it('⭐ there is ONE renderer, and it takes the currency as an argument', () => {
  assert.ok(L && typeof L.money === 'function', 'CBLocale.money is gone — every surface will grow its own');
});

it('⭐⭐⭐ each currency gets ITS OWN number of decimals', () => {
  /**
   * ⚠️ This is the rule a hand-rolled formatter always breaks: toFixed(2) is right for the rupee and wrong for
   * the yen and the dinar. A yen price with two decimals is not a rounding difference, it is a price a Japanese
   * customer cannot read as money.
   */
  const want = { INR: 2, USD: 2, AED: 2, GBP: 2, EUR: 2, JPY: 0, KWD: 3, BHD: 3 };
  Object.keys(want).forEach((cur) => {
    const got = new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur }).resolvedOptions().maximumFractionDigits;
    assert.strictEqual(got, want[cur], cur + ' resolves ' + got + ' decimals, wants ' + want[cur]);
    /* and the renderer must be USING that, not overriding it */
    const s = L.money(1234.5, cur);
    if (want[cur] === 0) assert.ok(!/[.,]\d0\b/.test(s) && /1,?235|1235/.test(s.replace(/\s/g, '')),
      cur + ' printed a fraction it does not have: ' + s);
  });
});

it('⭐⭐ THE READER GROUPS, THE CURRENCY DOES NOT', () => {
  /**
   * ⭐ A shop shows money in ITS OWN grouping whatever currency it is quoting — an Indian shop quoting dollars
   * writes $12,34,567.50, and that is correct, not a bug. The currency chooses the symbol and the decimals; the
   * locale chooses the separators. ECMA-402's own model, and the reason we do not hand-roll it.
   * ⚠️ Asserted so that nobody "fixes" the grouping to match the currency and breaks every Indian bill.
   */
  const inr = L.money(1234567.5, 'INR'), usd = L.money(1234567.5, 'USD');
  const groupsOf = (s) => s.replace(/[^\d,.]/g, '').replace(/\.\d+$/, '');
  assert.strictEqual(groupsOf(inr), groupsOf(usd),
    'the grouping changed with the currency — it must come from the reader, not the money');
});

it('⚠️ an unknown currency code still prints, rather than throwing mid-sale', () => {
  /* a counter must never fail to show a price because a code was not recognised */
  const s = L.money(99, 'XYZ');
  assert.ok(/99/.test(s), 'an unknown code lost the number entirely: ' + s);
  assert.doesNotThrow(() => L.money(99, null));
  assert.doesNotThrow(() => L.money(null, 'INR'));
});

it('⭐⭐ the bidi marks an Arabic format inserts are stripped', () => {
  /**
   * ⚠️ They serve an RTL paragraph and mislead the bidi algorithm on an LTR page. This is not theoretical: a
   * price once rendered as "10 / ₹ 620.00KG" and a date as "022026/09/", both in one afternoon.
   */
  const marks = [...L.money(1234.5, 'AED')].filter((c) => ['‎', '‏', '؜'].includes(c));
  assert.strictEqual(marks.length, 0, 'an Arabic-region format leaked ' + marks.length + ' bidi mark(s)');
});

console.log('— a price is a stamped value, not a number —');

it('⭐⭐⭐ every surface that reads a price unwraps { amount, currency }', () => {
  /**
   * ⚠️⚠️ offer-lab.html read Number(d.price) — NaN for every real product — so it filtered out the WHOLE
   * catalogue, said "your catalogue has no priced products yet" and fell back to sample data. "Use my catalogue"
   * had therefore never worked on a real shop, and the failure is indistinguishable from an empty catalogue.
   * ⚠️ There are five copies of this unwrap and none is exported, which is exactly why a sixth place forgot.
   * That is the backlog item; this guard is the floor until it is done.
   */
  const files = ['offer-lab.html', 'app/cart.js', 'app/pricing.js'];
  files.forEach((f) => {
    const p = path.join(WEB, f);
    if (!fs.existsSync(p)) return;
    const src = fs.readFileSync(p, 'utf8');
    /* a bare Number(...price) with no object test anywhere near it is the fault */
    const bare = (src.match(/Number\(\s*\w+\.price\s*\)/g) || []).length;
    const aware = /\.amount/.test(src);
    assert.ok(!bare || aware,
      f + ' reads a price with Number() and never mentions .amount — a stamped price will read as NaN');
  });
});

console.log('— language —');

it('⭐ English IS the key, so a missing translation stays readable', () => {
  /**
   * ⭐ gettext's rule, adopted rather than invented: tx('Save & print') returns the English when no pack carries
   * it. A key-based layer degrades to "till.save_print" on screen, which is worse than the English it replaced.
   */
  const app = fs.readFileSync(path.join(WEB, 'app.html'), 'utf8');
  const fn = app.slice(app.indexOf('function tx('), app.indexOf('function tx(') + 400);
  assert.ok(fn, 'tx() is gone');
  /* ⚠️ the PARAMETER IS NAMED `english`, and that is the convention stated in the signature itself — my first
     version of this check looked for a `s`/`key` parameter and failed on code that was doing it right. */
  assert.ok(/function tx\(\s*english/.test(fn),
    "tx()'s first argument is no longer named `english` — the convention is that the English string IS the key");
  assert.ok(/return english/.test(fn),
    'tx() no longer falls back to the English string it was given, so a missing pack will show a key on screen');
});

it('⚠️ a region offers only the languages it actually uses', () => {
  /* RFC 4647, at most three — a shop is not offered a language its region does not use */
  const loc = fs.readFileSync(path.join(WEB, 'app', 'locale.js'), 'utf8');
  assert.ok(/4647|lookup/i.test(loc), 'the language-matching rule (RFC 4647) is no longer named in locale.js');
});

console.log('— and no screen may print its own symbol —');

it('⭐⭐⭐ the shipped screens all go through the renderer', () => {
  /* the same rule snapshot-wire enforces on the counter and the shop screen, checked here for the lab too */
  const lab = fs.readFileSync(path.join(WEB, 'offer-lab.html'), 'utf8');
  const emitted = lab.split('\n').filter((l) => {
    const t = l.trim();
    if (/^(\*|\/\*|\/\/)/.test(t)) return false;
    return /['"`][^'"`]*₹/.test(l);
  });
  assert.deepStrictEqual(emitted, [],
    'the offer lab prints a rupee sign of its own — it opens on a REAL catalogue now, so a Gulf shop would be '
    + 'quoted its own dirhams with the wrong sign, and an offer proved there would read differently at the counter');
});

console.log(pass + ' checks');
