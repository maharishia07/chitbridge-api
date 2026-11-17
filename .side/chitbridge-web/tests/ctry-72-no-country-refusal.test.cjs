'use strict';
/* CTRY-72 (Athi, 11 Nov): a shop with no country or pack data gets plain words, never India, 18 % GST or INR.
   Doors driven here (each: no country -> the words / no number; IN -> unchanged; AU -> unchanged):
     app/cap-print.js   previewFor(me)  : the tax words and the refusal the sample bill is told
     bill-print.html   render()         : the slip paints no tax lines for a shop with no country, a link to Country setup instead
     product-lab.html  tableFits / paintNoMoney : no rupee suggestion and the api's one sentence for a shop with no money
     promo.html        money / live / paintNoMoney : no figure and the till snapshot's one sentence
     standards.html : no India default (source check: the literal is gone)
   a11y: the refusal block carries no colour of its own (the slip's AA contrast is unchanged).
   Run: node tests/ctry-72-no-country-refusal.test.cjs */
const fs = require('fs'), vm = require('vm'), assert = require('assert');
let n = 0;
const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };
const PUB = __dirname + '/../public/';
const read = (f) => fs.readFileSync(PUB + f, 'utf8');
const inline = (html) => (html.match(/<script>([\s\S]*?)<\/script>/g) || []).map((s) => s.replace(/^<script>|<\/script>$/g, '')).join('\n');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function sandbox(extra) {
  const nodes = {};
  const el = (id) => nodes[id] || (nodes[id] = { id, innerHTML: '', textContent: '', value: '', hidden: false, style: {}, children: [], firstChild: null, setAttribute() {}, appendChild() {}, classList: { toggle() {}, add() {}, remove() {} } });
  const sb = Object.assign({
    console, setTimeout, clearTimeout, Intl, Date, Math, JSON,
    location: { search: '?preview=1', hash: '' },
    navigator: { language: 'en-IN' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [], createElement: () => el('x' + Math.random()), addEventListener() {}, head: { appendChild() {} }, body: el('body'), documentElement: { setAttribute() {} } }
  }, extra || {});
  sb.window = sb; sb.self = sb; sb.addEventListener = () => {};
  return { cx: vm.createContext(sb), el, nodes };
}
const run = (cx, src) => vm.runInContext(src, cx);

/* ── 1 · cap-print.js: the tax words the sample bill is told ─────────────────────────────────────────────── */
{
  const { cx } = sandbox();
  for (const f of ['engine/money.js', 'engine/tax.js', 'engine/locale.js', 'app/helpers.js']) run(cx, read(f));
  run(cx, read('app/cap-print.js'));
  const P = vm.runInContext('CBPrint', cx);
  ok(typeof P.previewFor === 'function', 'CBPrint.previewFor exists');
  const none = P.previewFor({});
  ok(none.tax === null, 'no country: no tax words are sent (no GST, no 18 %)');
  ok(typeof none.refusal === 'string' && /country/i.test(none.refusal), 'no country: the refusal is the engine\'s sentence (' + none.refusal + ')');
  ok(none.refusal === vm.runInContext('CBRegulation.status(null).why', cx), 'no country: the words are CBRegulation.status(null).why, not a second copy');
  const nopack = P.previewFor({ country: 'ZZ' });
  ok(nopack.tax === null && /ZZ/.test(nopack.refusal), 'a country with no pack: no tax words, the engine says so (' + nopack.refusal + ')');
  const inn = P.previewFor({ country: 'IN' });
  ok(inn.tax && inn.tax.word === 'GST' && inn.tax.split === true && inn.refusal === '', 'IN shop: GST, split by state, no refusal (unchanged)');
  ok(inn.tax.rate === vm.runInContext('CBRegulation.packFor("IN").tax.standard_rate || CBRegulation.packFor("IN").tax.rates[CBRegulation.packFor("IN").tax.rates.length-1]', cx), 'IN shop: the rate is the pack\'s own');
  const au = P.previewFor({ country: 'AU' });
  ok(au.tax && au.tax.word === 'GST' && au.tax.split === false && Number(au.tax.rate) === 10 && au.refusal === '', 'AU shop: GST 10 % on one line, no refusal (unchanged)');
}

/* ── 2 · bill-print.html: the slip itself ──────────────────────────────────────────────────────────────── */
{
  const html = read('bill-print.html');
  const { cx, el } = sandbox();
  for (const f of ['engine/money.js', 'app/helpers.js', 'engine/locale.js', 'engine/tax.js', 'engine/docnumber.js', 'engine/profilemap.js']) run(cx, read(f));
  el('kind').value = 'tax'; el('w').value = '80';
  run(cx, inline(html));
  const slip = () => el('slip').innerHTML;
  ok(slip() === '', 'a preview not yet told anything paints no slip (no flash of a guessed tax)');
  const send = (m) => vm.runInContext('onPreviewMessage', cx)({ data: Object.assign({ cb_preview: true, paper: '80', kind: 'tax' }, m) });
  send({ tax: null, refusal: 'Set the shop country first. The books never open on a guess.', country: '', currency: undefined });
  ok(/data-testid="slip-no-country"/.test(slip()) && /Set the shop country first/.test(slip()), 'no country: the slip shows the refusal words where the bill was');
  ok(/href="\/settings.html#\/country"/.test(slip()) && /Country setup/.test(slip()), 'no country: with the link to Country setup');
  ok(!/GST|CGST|SGST|18\s?%|TAX INVOICE/.test(slip()), 'no country: no tax word, no rate, no invoice title is painted');
  send({ tax: { word: 'GST', split: true, rate: 18, rates: [0, 5, 12, 18, 28], id_word: 'GSTIN' }, refusal: '', country: 'IN', currency: 'INR' });
  ok(!/slip-no-country/.test(slip()) && /CGST/.test(slip()) && /TAX INVOICE/.test(slip()), 'IN shop: the tax invoice with CGST/SGST is painted (unchanged)');
  send({ tax: { word: 'GST', split: false, rate: 10, id_word: 'ABN' }, refusal: '', country: 'AU', currency: 'AUD' });
  ok(!/slip-no-country/.test(slip()) && /GST/.test(slip()) && !/CGST/.test(slip()) && /TAX INVOICE/.test(slip()), 'AU shop: one GST line, no CGST/SGST (unchanged)');
  send({ tax: { word: 'GST', split: true, rate: 18, id_word: 'GSTIN' }, refusal: '', country: 'IN', currency: undefined });
  ok(/slip-no-country/.test(slip()) && /No money is set/.test(slip()) && !/₹|INR|TAX INVOICE/.test(slip()), 'tax but no currency: the no-money words show, never rupees');
  ok(!/currency:\s*'INR'/.test(stripComments(inline(html))), 'bill-print.html: the sample money does not start as INR');
  const lone = sandbox(); /* the page opened on its own (no ?preview=1, no message): the print test is gone, the sample needs a shop */
  lone.cx.location.search = '';
  for (const f of ['engine/money.js', 'app/helpers.js', 'engine/locale.js', 'engine/tax.js', 'engine/docnumber.js', 'engine/profilemap.js']) run(lone.cx, read(f));
  lone.el('kind').value = 'tax';
  lone.el('w').value = '80';
  run(lone.cx, inline(html));
  ok(/slip-no-country/.test(lone.el('slip').innerHTML) && !/GST|TAX INVOICE/.test(lone.el('slip').innerHTML), 'opened on its own: the slip says to open Print setup, no guessed tax');
  const code = stripComments(inline(html));
  ok(!/rate:\s*18/.test(code) && !/\|\|\s*'IN'/.test(code), 'bill-print.html names no 18 rate default and no IN default in code');
}

/* ── 3 · product-lab.html ─────────────────────────────────────────────────────────────────────────────── */
{
  const html = read('product-lab.html');
  const { cx, el } = sandbox();
  run(cx, read('app/helpers.js'));
  const code = inline(html);
  const fns = ['tableFits', 'suggestedOf', 'paintNoMoney'].map((f) => { const m = code.match(new RegExp('function ' + f + '\\([\\s\\S]*?\\n\\}')); assert(m, f + ' found'); return m[0]; }).join('\n');
  run(cx, "var TABLE_CURRENCY = 'INR'; var DATA = null;\n" + fns);
  const set = (d) => vm.runInContext('DATA = ' + JSON.stringify(d) + ';', cx);
  const WHY = 'Set the shop’s money and the month its year starts (Country setup).';
  set({ currency: null, money_why: { code: 'NO_MONEY', why: WHY } });
  ok(vm.runInContext('tableFits()', cx) === false && vm.runInContext('suggestedOf({price: 40})', cx) === null, 'no money: no rupee suggestion is shown');
  vm.runInContext('paintNoMoney()', cx);
  ok(el('nomoney').hidden === false && el('nomoney').innerHTML.includes('Country setup).') && /href="\/settings.html#\/country"/.test(el('nomoney').innerHTML), 'no money: the api sentence and the link to Country setup are shown');
  set({ currency: 'INR', money_why: null });
  vm.runInContext('paintNoMoney()', cx);
  ok(vm.runInContext('suggestedOf({price: 40})', cx) === 40 && el('nomoney').hidden === true, 'IN shop: rupee suggestion kept, no banner (unchanged)');
  set({ currency: 'AUD', money_why: null });
  vm.runInContext('paintNoMoney()', cx);
  ok(vm.runInContext('suggestedOf({price: 40})', cx) === null && el('nomoney').hidden === true, 'AU shop: no rupee figure, no banner (unchanged)');
  ok(!/\|\|\s*'INR'/.test(stripComments(code)), 'product-lab.html names no INR default in code');
}

/* ── 4 · promo.html ────────────────────────────────────────────────────────────────────────────────── */
{
  const html = read('promo.html');
  const { cx, el } = sandbox();
  run(cx, read('app/helpers.js'));
  run(cx, read('engine/locale.js'));
  const code = inline(html);
  const fns = ['noMoneyWords', 'paintNoMoney', 'live', 'money'].map((f) => { const m = code.match(new RegExp('function ' + f + '\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}|function ' + f + '\\([^)]*\\)\\s*\\{[^\\n]*\\}')); assert(m, f + ' found'); return m[0]; }).join('\n');
  run(cx, 'var S = null;\n' + fns);
  const WHY = 'Set the shop’s money and the month its year starts (Country setup).';
  const set = (s) => vm.runInContext('S = ' + JSON.stringify(s) + ';', cx);
  const items = [{ item_id: 'a', price: 40, avail: 'in_stock' }];
  set({ shop: { currency: null, money_why: { code: 'NO_MONEY', why: WHY } }, items });
  ok(vm.runInContext('money(40)', cx) === '—', 'no money: a price prints a dash, not rupees');
  ok(vm.runInContext('live().length', cx) === 0, 'no money: no product is advertised');
  vm.runInContext('paintNoMoney()', cx);
  ok(el('nomoney').hidden === false && el('nomoney').innerHTML.includes('Country setup).') && /#\/country/.test(el('nomoney').innerHTML), 'no money: the sentence and the link show above the stage');
  set({ shop: { currency: 'INR' }, items });
  vm.runInContext('paintNoMoney()', cx);
  ok(/₹/.test(vm.runInContext('money(40)', cx)) && vm.runInContext('live().length', cx) === 1 && el('nomoney').hidden === true, 'IN shop: rupees, products advertised, no banner (unchanged)');
  set({ shop: { currency: 'AUD' }, items });
  ok(/\$/.test(vm.runInContext('money(40)', cx)) && !/₹/.test(vm.runInContext('money(40)', cx)) && vm.runInContext('live().length', cx) === 1, 'AU shop: dollars, products advertised (unchanged)');
  ok(!/\|\|\s*'INR'/.test(stripComments(code)), 'promo.html names no INR default in code');
}

/* ── 5 · standards.html: the India default is gone (shop.html's language/unit region is left as is: it needs the shop's country in the catalogue payload) ── */
{
  const std = read('standards.html');
  ok(!/CMP_COUNTRY_FALLBACK/.test(std) && /std_nocountry/.test(std) && /#\/country/.test(std), 'standards.html: no India fallback; the no-country line links Country setup');
}
console.log('\n' + n + ' ok');
