/**
 * e2e/group-sum.cjs — a group sum totals PER CURRENCY and never across.
 *
 * Athi, 2026-08-21: *"we have a couple of places sum is there; what I want is a single group sum, gold
 * standard, a panel that comes with predefined details and allows other customisation."*
 *
 * ⚠️⚠️ THE PLATFORM ALREADY HELD THIS RULE IN TWO PLACES AND BROKE IT IN A THIRD. `lib/money.js` THROWS on
 * mixed currencies rather than adding them. `_gsMoney` in cap-folders renders them side by side and says why:
 * *"a figure spanning two currencies means nothing, most convincingly when it looks tidy."* And the chit list's
 * select bar did `rows.reduce((a, c) => a + c.amt, 0)` and rendered it with the READER's currency — so ticking
 * a ₹500 chit and a $2,000 chit produced one tidy total in a currency belonging to neither.
 *
 * ⭐ IT IS THE TIDINESS THAT MAKES IT DANGEROUS. A wrong number that looks broken gets questioned; a wrong
 * number that looks like a total gets used — in a quote, in a decision, in a message to a counterparty.
 *
 * ⚠️ AND THE ROWS ALREADY CARRIED THEIR CURRENCY. The list mapper sets `currency: sum.currency_code || 'INR'`;
 * the select bar discarded it one line before use. Nothing had to be fetched — only not thrown away.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const W = path.join(__dirname, '..', 'public');

const sandbox = {
  console, Intl,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    documentElement: { style: { setProperty() {}, removeProperty() {} }, setAttribute() {}, removeAttribute() {},
      classList: { add() {}, remove() {} } },
    body: { classList: { add() {}, remove() {} }, setAttribute() {} },
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} } },
  setTimeout, clearTimeout, fetch: async () => ({ ok: false }),
  navigator: { language: 'en-IN', languages: ['en-IN'] }, location: { origin: '', host: 'h', search: '' },
  tx: (s) => s, esc: (x) => String(x == null ? '' : x),
  myCur: () => 'INR',
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(W, 'engine', 'locale.js'), 'utf8'), ctx, { filename: 'locale.js' });
vm.runInContext(fs.readFileSync(path.join(W, 'app', 'helpers.js'), 'utf8'), ctx, { filename: 'helpers.js' });

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.error('  ✗ ' + name + (extra ? '   ' + extra : '')); }
};
const strip = (h) => String(h).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

const ROWS = [
  { id: 1, amt: 500,  currency: 'INR' },
  { id: 2, amt: 2000, currency: 'USD' },
  { id: 3, amt: 250,  currency: 'INR' },
];

console.log('\n── totals per currency ──');
const by = ctx.cbSumByCurrency(ROWS, 'amt', 'currency');
t('two currencies stay two figures', by.length === 2, JSON.stringify(by));
t('  …INR is added to INR', (by.find((x) => x.currency === 'INR') || {}).total === 750);
t('  …USD is left alone',   (by.find((x) => x.currency === 'USD') || {}).total === 2000);
/* ⭐ BIGGEST FIRST — the figure a reader most likely wants is the one they read first. */
t('  …ordered biggest first', by[0].currency === 'USD', by.map((x) => x.currency).join(' '));

console.log('\n── and they are never added together ──');
const out = ctx.cbMoneyList(by);
t('both appear', /2,000/.test(out) && /750/.test(out), strip(out));
/**
 * ⚠️⚠️ THE ASSERTION THAT WOULD HAVE CAUGHT THE BUG. 500 + 2000 + 250 = 2750. If that number ever appears, the
 * currencies have been added and the result is meaningless however tidy it looks.
 */
t('2,750 NEVER appears — that is the sum of unlike things', !/2,?750/.test(strip(out)), strip(out));
t('and it says so, rather than leaving the reader to guess',
  /not added together/i.test(strip(out)), strip(out));

console.log('\n── one currency reads as a plain total ──');
const one = ctx.cbMoneyList(ctx.cbSumByCurrency([{ amt: 500, currency: 'INR' }, { amt: 250, currency: 'INR' }], 'amt', 'currency'));
t('no caveat when there is nothing to disambiguate', !/not added/i.test(strip(one)), strip(one));
t('  …and the figure is right', /750/.test(strip(one)));

console.log('\n── the awkward inputs ──');
t('nothing ticked → an em dash, not ₹0',
  strip(ctx.cbMoneyList(ctx.cbSumByCurrency([], 'amt', 'currency'))) === '—');
/* ⚠️ A ROW WITH NO CURRENCY IS ALMOST ALWAYS THE READER'S OWN — grouping it as "unknown" would split one
   honest total into two for a field nobody filled in. */
t('a missing currency falls back to the reader\'s, not to a third group',
  ctx.cbSumByCurrency([{ amt: 100 }, { amt: 50, currency: 'INR' }], 'amt', 'currency').length === 1);
/* ⚠️ ZERO-VALUE ROWS MUST NOT INVENT A CURRENCY GROUP. A chit with no amount yet is not a second total. */
t('a zero-amount row does not create a group',
  ctx.cbSumByCurrency([{ amt: 0, currency: 'EUR' }, { amt: 5, currency: 'INR' }], 'amt', 'currency').length === 1);

console.log('\n── one renderer, both callers ──');
const admin = fs.readFileSync(path.join(W, 'app.html'), 'utf8');
const folders = fs.readFileSync(path.join(W, 'app', 'cap-folders.js'), 'utf8');
t('the select bar uses it', /cbSumByCurrency\(/.test(admin) && /cbMoneyList\(/.test(admin));
t('the folders panel uses it', /cbMoneyList\(/.test(folders));
/**
 * ⚠️ AND THE OLD SHAPE MUST NOT COME BACK. `reduce((a,c)=>a+c.amt,0)` is the exact line that summed across
 * currencies; if it reappears anywhere, this fails rather than waiting for someone to notice a tidy wrong total.
 */
t('nothing sums `amt` blindly any more',
  !/reduce\(\(a,\s*c\)\s*=>\s*a\s*\+\s*c\.amt,\s*0\)/.test(admin.replace(/\/\*[\s\S]*?\*\//g, ' ')));

console.log('\n  ══ ' + pass + ' passed · ' + fail + ' failed ══\n');
process.exit(fail ? 1 : 0);
