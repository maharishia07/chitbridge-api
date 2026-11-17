'use strict';
// @type: unit
/**
 * ui-money.test.cjs - the money field (CMP055-I05, public/app/ui-money.js, lifted from cap-books.js bkMoneyInput): ACC-347 and its two sisters, CUR-1, the 2^53 refusal.
 *
 * OWNS      the proof that (1) the HTML of the 7 call sites is byte-identical to origin/main's (tests/fixtures/money-input-before.json, taken before the lift) except the element code,
 *           (2) a typed amount is KEPT by the per-keystroke clamp and REFUSED at read with a sentence (wrong mark, digit of another script, extra place, sign, letter, foreign symbol,
 *           above 2^53) per locale IN / AU / AE (en and ar digits) / fr (comma decimal), minor units asserted as integers, (3) a BEFORE / AFTER table over the old clamp+reader,
 *           and the assertion that every outcome that changed was silent before, (4) currency is a code or 'unknown' and never defaulted, and the existing CBMoney operator refuses null.
 * DOES NOT  test CBMoney (cur1-money-reader.test.cjs does); no arithmetic here.
 * CALLED BY ci.yml (QA gate, beside ui-field.test); by hand: node e2e/ui-money.test.cjs
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const PUB = path.join(__dirname, '..', 'public');
const read = (file) => fs.readFileSync(path.join(PUB, file), 'utf8');
let failures = 0;
const check = (ok, message) => { console.log((ok ? '  ok ' : '  FAIL ') + message); if (!ok) failures++; };
const throwsWith = (fn, part) => { try { fn(); return false; } catch (error) { return String(error.message).indexOf(part) >= 0; } };
const same = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || a === b;

/** one page: ui.js + ui-field.js + ui-money.js over the real money and locale engines; `session` is the ledger currency, `chip` the screen chip */
function page(session, chip) {
  const cx = vm.createContext({
    console, tx: (t) => t, CBAction: { run: () => Promise.resolve() }, setTimeout, clearTimeout, SESSION: session,
    esc: (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    localStorage: { getItem: () => null, setItem() {} }, navigator: { language: 'en-IN' },
    document: { documentElement: { setAttribute() {}, style: {} }, addEventListener() {}, querySelectorAll: () => [], querySelector: () => chip || null }
  });
  cx.window = cx; cx.self = cx;
  cx.bkMountAttribute = (component) => { const screen = chip ? chip.getAttribute('data-cbsid') : ''; return screen ? ' data-cbmount="' + screen + '-U1' + String(component).slice(-2) + '"' : ''; };
  for (const f of ['engine/money.js', 'engine/locale.js', 'app/ui.js', 'app/ui-field.js', 'app/ui-money.js']) vm.runInContext(read(f), cx);
  return cx;
}
const chip = { getAttribute: (n) => (n === 'data-cbsid' ? 'BKS001' : null) };

/* ---------- 1. byte-identical HTML for the call sites ---------- */
console.log('the 7 call sites draw the same HTML as before the lift (only the element code moves CMP040-I01 -> CMP055-I05)');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tests', 'fixtures', 'money-input-before.json'), 'utf8'));
const LEDGERS = { INR: [{ currency: 'INR' }, true], AUD: [{ currency: 'AUD' }, false], JPY: [{ currency: 'JPY' }, true], OMR: [{ currency: 'OMR' }, false], none: [undefined, true] };
let identical = 0, total = 0;
Object.keys(LEDGERS).forEach((ledger) => {
  const cx = page(LEDGERS[ledger][0], LEDGERS[ledger][1] ? chip : null);
  Object.keys(fixture.SITES).forEach((site) => {
    const before = fixture.html[ledger + ' | ' + site].replace('CMP040-I01', 'CMP055-I05').replace('-U140"', '-U155"');
    const after = cx.CBUiMoney.input(fixture.SITES[site]);
    total++;
    if (before === after) identical++; else { failures++; console.log('  FAIL ' + ledger + ' | ' + site + '\n    before ' + before + '\n    after  ' + after); }
  });
});
check(identical === total && total === 40, identical + ' of ' + total + ' snapshots (8 option shapes x 5 ledger currencies) are byte-identical after the element code');

/* ---------- 2. the reader, per locale ---------- */
const M = {
  IN: { mark: '.', group: ',', lakh: true },
  AU: { mark: '.', group: ',', lakh: false },
  AE: { mark: '.', group: ',', lakh: false },
  FR: { mark: ',', group: ' ', lakh: false }
};
const money = page({ currency: 'INR' }, chip).CBUiMoney;
const minor = (typed, cur, marks) => money.minor(typed, cur, marks);
const refused = (typed, cur, marks) => { const r = money.refusal(typed, cur, marks); return Number.isNaN(minor(typed, cur, marks)) && r.length > 0; };

console.log('India (INR, 2 places, lakh grouping)');
check(minor('1,23,456.50', 'INR', M.IN) === 12345650, '"1,23,456.50" = 12345650');
check(minor('1,234.50', 'INR', M.IN) === 123450, '"1,234.50" (thousands) = 123450');
check(refused('1,50', 'INR', M.IN) && /\./.test(money.refusal('1,50', 'INR', M.IN)), '"1,50" is refused with a sentence that names the mark "."');
check(refused('12,34.5', 'INR', M.IN), '"12,34.5" (a comma in a place India does not group) is refused');
check(refused('1.505', 'INR', M.IN) && /2 decimals/.test(money.refusal('1.505', 'INR', M.IN)), '"1.505" is refused, the sentence says 2 decimals');
check(minor('₹1,000', 'INR', M.IN) === 100000, 'the field\'s own symbol is ignored: "₹1,000" = 100000');
check(minor('.5', 'INR', M.IN) === 50 && minor('5.', 'INR', M.IN) === 500 && minor('0', 'INR', M.IN) === 0, '".5" = 50, "5." = 500, "0" = 0');
check(Number.isNaN(minor('', 'INR', M.IN)) && money.refusal('', 'INR', M.IN) === '', 'empty is NaN with no sentence (the screen says what it needs)');

console.log('Australia (AUD)');
check(minor('1,234.50', 'AUD', M.AU) === 123450, '"1,234.50" = 123450');
check(refused('1,50', 'AUD', M.AU), '"1,50" is refused');
check(refused('1.505', 'AUD', M.AU), '"1.505" is refused (never cut to 1.50)');
check(minor('1,234,567.89', 'AUD', M.AU) === 123456789, '"1,234,567.89" = 123456789');
check(minor('A$5', 'AUD', M.AU) === 500 && minor('AUD 5', 'AUD', M.AU) === 500, 'the AUD symbol and code are the field\'s own: "A$5" and "AUD 5" = 500');
check(refused('$5', 'AUD', M.AU), 'a bare "$" could be any dollar: refused, never dropped');
check(refused('€5', 'AUD', M.AU), 'another currency\'s symbol is refused, never dropped');

console.log('UAE (AED 2 places, OMR 3 places; en and ar digits)');
check(minor('1,234.500', 'OMR', M.AE) === 1234500, 'OMR "1,234.500" = 1234500');
check(minor('1.5', 'OMR', M.AE) === 1500, 'OMR "1.5" = 1500');
check(refused('1,50', 'OMR', M.AE) && refused('1,50', 'AED', M.AE), '"1,50" is refused for OMR and for AED');
check(refused('1.5055', 'OMR', M.AE), 'OMR "1.5055" is refused (4 places)');
check(minor('١٫٥٠', 'AED', M.AE) === 150, 'Arabic digits and decimal mark "١٫٥٠" = 150');
check(refused('١,٥٠', 'AED', M.AE), 'Arabic digits with a comma "١,٥٠" is refused');
check(minor('١٬٢٣٤٫٥٠', 'AED', M.AE) === 123450, 'Arabic digits with Arabic grouping "١٬٢٣٤٫٥٠" = 123450');

console.log('a comma-decimal locale (fr, EUR)');
check(minor('1,50', 'EUR', M.FR) === 150, '"1,50" = 150');
check(refused('1.50', 'EUR', M.FR), '"1.50" is refused');
check(minor('1 234,50', 'EUR', M.FR) === 123450 && minor('1 234,50', 'EUR', M.FR) === 123450, '"1 234,50" (narrow space grouping) = 123450');

console.log('no decimals (JPY) and the other refusals');
check(minor('1500', 'JPY', M.AU) === 1500 && minor('1,500', 'JPY', M.AU) === 1500, 'JPY "1500" and "1,500" = 1500');
check(refused('1500.5', 'JPY', M.AU) && /no decimals/.test(money.refusal('1500.5', 'JPY', M.AU)), 'JPY "1500.5" is refused: "no decimals"');
check(refused('-5', 'INR', M.IN) && /minus/.test(money.refusal('-5', 'INR', M.IN)), '"-5" is refused with the minus sentence (it used to read 5)');
check(refused('abc', 'INR', M.IN) && refused('1e5', 'INR', M.IN), '"abc" and "1e5" are refused (the latter used to read 15)');
check(refused('9007199254740993', 'INR', M.IN) && /too large/.test(money.refusal('9007199254740993', 'INR', M.IN)), '"9007199254740993" is refused: above 2^53, never rounded');
check(minor('90071992547409.91', 'INR', M.IN) === 9007199254740991, '"90071992547409.91" = 9007199254740991 (the largest exact minor amount) reads exactly');
check(refused('90071992547409.92', 'INR', M.IN), 'one minor unit above that is refused');

console.log('minor -> text -> minor is the identity, per currency');
let trips = 0, tripBad = 0;
['INR', 'AUD', 'AED', 'JPY', 'OMR'].forEach((cur) => ['AU', 'FR'].forEach((loc) => [0, 1, 99, 100, 123456789].forEach((n) => {
  const text = money.minorText(n, cur, M[loc]);
  trips++; if (minor(text, cur, M[loc]) !== n) { tripBad++; console.log('    trip failed ' + cur + ' ' + loc + ' ' + n + ' -> ' + text); }
})));
check(tripBad === 0, trips + ' round trips (5 currencies x 2 mark sets x 5 amounts) are the identity');
check(money.minorText(12345, 'INR', M.AU) === '123.45' && money.minorText(12345, 'JPY', M.AU) === '12345' && money.minorText(12345, 'OMR', M.AU) === '12.345' && money.minorText(1, 'INR', M.FR) === '0,01', 'text shapes: INR 123.45, JPY 12345, OMR 12.345, fr 0,01');

console.log('the per-keystroke clamp keeps what was typed');
const box = (value) => ({ value, getAttribute: () => null });
const typedKept = ['1,50', '1.505', 'abc', '-5', '1,23,456.50', '$5', '1e5'].every((typed) => { const el = box(typed); money.clamp(el); return el.value === typed; });
check(typedKept, 'wrong mark, extra place, letters, sign, grouping, a symbol: the box keeps every character');
const arabic = box('١٫٥٠'); money.clamp(arabic);
check(arabic.value === '1.50', 'a digit of another script is mapped to ASCII (not deleted): "١٫٥٠" -> "1.50"');

/* ---------- 3. before / after ---------- */
console.log('BEFORE / AFTER over the old clamp + reader (the old bodies are copied here as the reference)');
const oldClamp = (value, d) => {
  let text = String(value || '').replace(/[^0-9.]/g, ''); const i = text.indexOf('.');
  if (i >= 0) text = text.slice(0, i + 1) + text.slice(i + 1).replace(/\./g, '').slice(0, d);
  if (d === 0) text = text.replace(/\./g, '');
  return text;
};
const oldRead = (text, d) => {
  const m = /^(\d*)(?:\.(\d*))?$/.exec(String(text == null ? '' : text).replace(/[,\s]/g, ''));
  if (!m || (!m[1] && !m[2]) || (m[2] || '').length > d) return NaN;
  return Number((m[1] || '0') + (m[2] || '').padEnd(d, '0'));
};
const DEC = { INR: 2, AUD: 2, AED: 2, EUR: 2, OMR: 3, JPY: 0 };
/* [locale, currency, typed, why this row is here, silent before?]  silent = the old answer was a wrong or empty figure with no word */
const ROWS = [
  ['IN', 'INR', '1,23,456.50', 'lakh grouping', false], ['IN', 'INR', '1,234.50', 'thousands grouping', false], ['IN', 'INR', '1234.5', 'plain', false], ['IN', 'INR', '0.5', 'plain', false],
  ['IN', 'INR', '.5', 'no leading zero', false], ['IN', 'INR', '5.', 'trailing mark', false], ['IN', 'INR', '12 345.60', 'a space', false], ['IN', 'INR', '₹1,000', 'own symbol', false],
  ['IN', 'INR', '1,50', 'wrong mark: 100x', true], ['IN', 'INR', '12,34.5', 'comma in an ungrouped place', true], ['IN', 'INR', '1.505', 'extra place cut', true],
  ['IN', 'INR', '$5', 'foreign symbol dropped', true], ['IN', 'INR', '-5', 'sign dropped', true], ['IN', 'INR', '1e5', 'letter dropped', true], ['IN', 'INR', 'abc', 'letters only', false],
  ['IN', 'INR', '', 'empty', false], ['IN', 'INR', '9007199254740993', 'beyond 2^53', true], ['IN', 'INR', '90071992547409.91', 'largest exact', false],
  ['AU', 'AUD', '1,234.50', 'thousands', false], ['AU', 'AUD', '1,50', 'wrong mark: 100x', true], ['AU', 'AUD', '1.505', 'extra place cut', true], ['AU', 'AUD', 'A$5', 'own symbol', false], ['AU', 'AUD', '$5', 'a bare dollar sign dropped', true], ['AU', 'AUD', '€5', 'foreign symbol dropped', true],
  ['AE', 'OMR', '1,234.500', 'three places', false], ['AE', 'OMR', '1.5', 'one place', false], ['AE', 'OMR', '1,50', 'wrong mark: 1000x', true], ['AE', 'OMR', '1.5055', 'fourth place cut', true],
  ['AE', 'AED', '1,50', 'wrong mark: 100x', true], ['AE', 'AED', '١٫٥٠', 'Arabic digits: emptied', true], ['AE', 'AED', '١,٥٠', 'Arabic digits, wrong mark', true], ['AE', 'AED', '١٬٢٣٤٫٥٠', 'Arabic digits and marks', true],
  ['FR', 'EUR', '1,50', 'comma decimal: 100x', true], ['FR', 'EUR', '1.50', 'the other mark (read before, refused now)', false], ['FR', 'EUR', '1 234,50', 'comma decimal with grouping', true],
  ['AU', 'JPY', '1500', 'no decimals', false], ['AU', 'JPY', '1,500', 'grouping', false], ['AU', 'JPY', '1500.5', 'point glued into 15005', true], ['AU', 'JPY', '1,5', 'wrong mark: 10x', true]
];
let changed = 0, kept = 0, flips = 0, bad = 0;
const lines = [];
ROWS.forEach(([loc, cur, typed, why, silent]) => {
  const d = DEC[cur];
  const before = oldRead(oldClamp(typed, d), d), after = minor(typed, cur, M[loc]);
  const fmt = (n) => (Number.isNaN(n) ? 'refused' : String(n));
  const move = same(before, after) ? 'same' : 'CHANGED';
  lines.push('    ' + [loc, cur, JSON.stringify(typed), fmt(before), fmt(after), move, why].join(' | '));
  if (same(before, after)) { kept++; return; }
  changed++;
  if (!silent && !(loc === 'FR' && typed === '1.50')) { bad++; console.log('  FAIL unexpected change on a value that read correctly: ' + loc + ' ' + typed); }
  if (loc === 'FR' && typed === '1.50') flips++;
});
console.log('    locale | cur | typed | BEFORE | AFTER | | why');
lines.forEach((line) => console.log(line));
check(bad === 0, 'every value that read correctly before reads the same after (' + kept + ' rows unchanged)');
check(bad === 0 && flips === 1 && changed + kept === ROWS.length, changed + ' of ' + ROWS.length + ' rows changed: every one a previously silent case, plus the single comma-locale flip FR "1.50" (the critic asked for it: the other mark is refused, never guessed)');

/* ---------- 4. currency (CUR-1), the operator, show-action, the field ---------- */
console.log('currency is a code or "unknown", never defaulted; the existing operator refuses null');
const cx = page({ currency: 'INR' }, chip), ui = cx.ui, CBMoney = cx.CBMoney;
const base = { mount: 'ACC001-U01', kind: 'money', label: 'Amount', id: 'amt' };
check(throwsWith(() => ui.field(base), 'currency is required'), 'ui.field money without a currency throws (never INR, never the ledger)');
check(throwsWith(() => ui.field(Object.assign({}, base, { currency: 'aud' })), 'currency is required') && throwsWith(() => ui.field(Object.assign({}, base, { currency: '' })), 'currency is required'), 'a lower-case or empty currency throws');
check(throwsWith(() => ui.field(Object.assign({}, base, { currency: 'AUD', minor: 1, value: '1' })), 'not both') && throwsWith(() => ui.field(Object.assign({}, base, { currency: 'AUD', minor: 1.5 })), 'safe integer'), 'minor and value together, or a fractional minor, throw');
check(throwsWith(() => ui.field({ mount: 'ACC001-U01', kind: 'text', label: 'x', currency: 'AUD' }), 'money'), 'currency on another kind throws');
const drawn = ui.field(Object.assign({}, base, { currency: 'AUD', minor: 123450, hint: 'Before tax' }));
check(/data-cbsid="CMP055-I05"/.test(drawn) && /data-cbname="field"/.test(drawn) && /data-cbkind="money"/.test(drawn) && /data-cbmount="ACC001-U01"/.test(drawn), 'the field carries CMP055-I05, the field name, the money kind and the mount');
check(/<label class="cbf-l" for="amt">Amount<\/label>/.test(drawn) && /data-cur="AUD"/.test(drawn) && /value="1234.50"/.test(drawn) && /aria-describedby="amt-h"/.test(drawn), 'label for = id, data-cur="AUD", minor 123450 drawn as 1234.50, the hint is described-by');
const unknown = ui.field(Object.assign({}, base, { currency: 'unknown' }));
check(/data-cur=""/.test(unknown) && /<span class="mi-sym" aria-hidden="true"><\/span>/.test(unknown), '"unknown" draws no symbol and stamps no currency');
const element = (html, value) => {
  const attrs = {}; (/<input ([^>]*)>/.exec(html)[1].match(/[\w-]+="[^"]*"/g) || []).forEach((p) => { const k = p.slice(0, p.indexOf('=')); attrs[k] = p.slice(k.length + 2, -1); });
  return { value, getAttribute: (n) => (n in attrs ? attrs[n] : null), id: attrs.id };
};
const got = cx.ui.field.read(element(drawn, '1,234.50'));
check(got.value === 123450 && got.currency === 'AUD' && got.error === undefined, 'ui.field.read gives { value: 123450, currency: "AUD" }, minor units as an integer');
const bad2 = cx.ui.field.read(element(drawn, '1,50'));
check(Number.isNaN(bad2.value) && bad2.error && bad2.currency === 'AUD', 'a refused amount gives { value: NaN, error: sentence }, never a number beside an error');
const none = cx.ui.field.read(element(unknown, '12.50'));
check(none.value === 1250 && none.currency === null, 'an "unknown" field reads { value: 1250, currency: null }');
check(throwsWith(() => CBMoney.makeMinor(none.value, none.currency), 'needs its currency'), 'the existing operator (CBMoney.makeMinor) refuses the null currency; no new operator');
const aud = CBMoney.makeMinor(got.value, got.currency), inr = CBMoney.makeMinor(100, 'INR');
check(throwsWith(() => CBMoney.plusMoney(aud, inr), 'different currencies'), 'two fields of different currencies fed to the existing plusMoney are refused');
const locked = ui.field(Object.assign({}, base, { currency: 'AUD', value: '5', role: { ok: false, why: 'Only the owner sets the limit' } }));
check(/ readonly(?= |>)/.test(locked) && /Only the owner sets the limit/.test(locked) && /<input /.test(locked), 'show-action: a role-refused money field is drawn, read-only, with its sentence');
check(!/role="alert"/.test(drawn) && !/aria-invalid/.test(drawn), 'a first render has no role="alert" and no aria-invalid');

/* ---------- 5. the wrappers in cap-books.js, the pages, the guard ---------- */
console.log('cap-books.js keeps its names as one-line wrappers; the pages load the file');
const books = read('app/cap-books.js');
check(['bkMoneyInput', 'bkMoneyMinor', 'bkMoneyRead', 'bkMoneyClamp', 'bkMinorText', 'bkSymbol', 'bkCur', 'bkDec'].every((name) => new RegExp('function ' + name + '\\([^)]*\\) \\{\\n  (return |var el)').test(books)), 'bkMoneyInput, bkMoneyMinor, bkMoneyRead, bkMoneyClamp, bkMinorText, bkSymbol, bkCur, bkDec are thin wrappers');
['accounts.html', 'crm.html', 'finance.html', 'tasks.html'].forEach((page2) => {
  const html = read(page2), at = html.indexOf('/app/ui-money.js'), fieldAt = html.indexOf('/app/ui-field.js'), booksAt = html.indexOf('/app/cap-books.js');
  check(at > 0 && fieldAt > 0 && fieldAt < at && at < booksAt, page2 + ' loads ui-field.js, then ui-money.js, then cap-books.js');
});

console.log(failures ? '\nui-money: ' + failures + ' FAIL' : '\nui-money: all ok');
process.exit(failures ? 1 : 0);
