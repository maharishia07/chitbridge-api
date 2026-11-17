'use strict';
/* PRINT-1 S1b (2026-11-13) — public/bill-print.html makes its sample bill ONCE, by the till's own pair CBTax.determine -> CBTax.moneyOf, and render() only reads it.
   The page's old second calculation (calc · r2 · lineTax · the slab and HSN sums · the float paid/change) is gone.
   HAND VALUES (computed on paper first, then compared to the page's own painted figures — never to a second run of the engine):
     2 x 118.00 incl 18 % ........ total 236.00 · taxable 200.00 · tax 36.00 (CGST 18.00 + SGST 18.00)
     1 x 100.00 incl 18 % ........ taxable 84.74 · tax 15.26 · CGST 7.63 + SGST 7.63 · total 100.00
     118.00 @18 + 105.00 @5 ...... taxable 100.00 + 100.00 · tax 18.00 + 5.00 · CGST 9.00 + 2.50 · SGST 9.00 + 2.50 · total 223.00
     3 x 30.00 -10 % @5 incl ..... items 90.00 · saved 9.00 · taxable 77.14 · tax 3.86 (1.93 + 1.93) · total 81.00
     AU 2 x 50.00 GST-free + 110.00 incl 10 % . taxable 100.00 + 100.00 · GST 10.00 · total 210.00 · the free line prints no GST
     JP 2 x 118 incl 10 % ........ total 236 · taxable 215 · tax 21 (whole yen, no decimals)
   The odd minor unit: the engine rounds each head once and adds them, so CGST = SGST and tax = their sum for every price (asserted over 1.00..20.00, never hand-halved).
   CUR-1: a line in a second currency prints the money engine's refusal and no figure.
   BREAK TEST: a re-added qty*price product, a reduce over line tax, or the deleted functions makes secondSums() find it (the guard is run on a doctored copy of the page).
   Run: node tests/bill-print-sample.test.cjs */
const fs = require('fs'), vm = require('vm'), assert = require('assert');
let n = 0;
const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };
const PUB = __dirname + '/../public/';
const read = (f) => fs.readFileSync(PUB + f, 'utf8');
const inline = (html) => (html.match(/<script>([\s\S]*?)<\/script>/g) || []).map((s) => s.replace(/^<script>|<\/script>$/g, '')).join('\n');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const PAGE = read('bill-print.html');

/** the second-sum guard, scoped to this page: any of these in its code means a second calculation is back */
function secondSums(html) {
  const code = stripComments(inline(html)), found = [];
  const rules = [
    ['qty*price', /\b(?:qty|quantity)\s*\*|\*\s*[\w.]*\b(?:qty|quantity)\b|\bprice\s*\*|\*\s*[\w.]*\bprice\b/],
    ['reduce', /\.reduce\s*\(/],
    ['deleted function', /\b(?:calc|r2|lineTax)\s*\(/]
  ];
  rules.forEach(([name, re]) => { if (re.test(code)) found.push(name); });
  return found;
}

function page() {
  const nodes = {};
  const el = (id) => nodes[id] || (nodes[id] = { id, innerHTML: '', textContent: '', value: '', hidden: false, style: {}, setAttribute() {}, appendChild() {}, classList: { add() {}, remove() {}, toggle() {} } });
  const sb = { console, setTimeout, clearTimeout, Intl, Date, Math, JSON, location: { search: '?preview=1', hash: '' }, navigator: { language: 'en-IN' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [], createElement: () => el('x' + Math.random()), addEventListener() {}, head: { appendChild() {} }, body: el('body'), documentElement: el('html') } };
  sb.window = sb; sb.self = sb; sb.addEventListener = () => {};
  const cx = vm.createContext(sb);
  for (const f of ['engine/money.js', 'app/helpers.js', 'engine/locale.js', 'engine/tax.js', 'engine/docnumber.js', 'engine/profilemap.js']) vm.runInContext(read(f), cx);
  el('kind').value = 'tax'; el('w').value = '80';
  vm.runInContext(inline(PAGE), cx);
  const SHOPS = {
    IN: { tax: { word: 'GST', split: true, rate: 18, rates: [0, 5, 12, 18, 28], id_word: 'GSTIN' }, country: 'IN', currency: 'INR', tax_id: '33AABCK1234F1Z6' },
    AU: { tax: { word: 'GST', split: false, rate: 10, id_word: 'ABN' }, country: 'AU', currency: 'AUD', tax_id: '51824753556' },
    JP: { tax: { word: 'JCT', split: false, rate: 10, id_word: 'T' }, country: 'JP', currency: 'JPY', tax_id: 'T1234567890123' }
  };
  /** the settings page's one message, then (optionally) the sample's lines; returns the slip's painted figures read by test id */
  const paint = (shop, lines, kind) => {
    vm.runInContext('onPreviewMessage', cx)({ data: Object.assign({ cb_preview: true, paper: '80', kind: kind || 'tax', refusal: '' }, SHOPS[shop]) });
    if (lines) { vm.runInContext('BILL.lines = ' + JSON.stringify(lines) + ';', cx); vm.runInContext('show()', cx); }
    const html = el('slip').innerHTML;
    const figure = (id) => { const m = html.match(new RegExp('data-testid="' + id + '">(-?)([^<]*)<')); return m ? m[1] + m[2].replace(/[^\d.]/g, '') : null; };
    const heads = (html.match(/<span class="l">(?:CGST|SGST|GST|JCT) [\d.]+% <\/span><span class="v">[^<]*(?=<)/g) || []).map((r) => r.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
    return { html, total: figure('slip-total'), taxable: figure('slip-taxable'), tax: figure('slip-tax'), items: figure('slip-items'), saved: figure('slip-saved'), heads };
  };
  return { paint, cx, el };
}
const L = (name, qty, price, rate, extra) => Object.assign({ name, hsn: '0000', qty, unit: 'piece', price, rate, sample_rate: rate }, extra || {});
const num = (s) => Number(s);

/* ── 1 · the page has no second calculation ─────────────────────────────────────────────────────── */
ok(secondSums(PAGE).length === 0, 'bill-print.html: no qty*price, no reduce, no calc/r2/lineTax in its code (' + (secondSums(PAGE).join(',') || 'clean') + ')');
ok(/CBTax\.determine/.test(PAGE) && /CBTax\.moneyOf/.test(PAGE), 'bill-print.html: the sample is made by CBTax.determine then CBTax.moneyOf');
ok(/INTERIM, WEB-LOCAL/.test(PAGE) && /PRINT-1 S2/.test(PAGE), 'bill-print.html: the sample builder is named an interim web-local path that S2 moves into engines');

/* ── 2 · BREAK TEST: the guard fails on each way the second sum comes back ──────────────────────── */
{
  const put = (extra) => PAGE.replace("setW('80');\n", "setW('80');\n" + extra + '\n');
  ok(secondSums(put('function again(items) { var t = 0; items.forEach(function (item) { t += item.qty * item.price; }); return t; }')).indexOf('qty*price') >= 0, 'break test: a re-added item.qty * item.price is found');
  ok(secondSums(put('function again2(item) { return item.price * item.qty; }')).indexOf('qty*price') >= 0, 'break test: a re-added item.price * item.qty is found');
  ok(secondSums(put('function taxSum(lines) { return lines.reduce(function (t, line) { return t + line.tax; }, 0); }')).indexOf('reduce') >= 0, 'break test: a reduce over line tax is found');
  ok(secondSums(put('function r2(n) { return Math.round(n * 100) / 100; }\nvar m = calc("tax");')).indexOf('deleted function') >= 0, 'break test: r2 / calc / lineTax coming back is found');
  ok(secondSums(put('/* item.qty * item.price in a comment is not code */')).length === 0, 'the guard reads code, not comments');
}

/* ── 3 · hand values, India ─────────────────────────────────────────────────────────────────────── */
{
  const P = page();
  let r = P.paint('IN', [L('Shirt', 2, 118, 18)]);
  ok(num(r.total) === 236 && num(r.taxable) === 200 && num(r.tax) === 36, 'IN 2 x 118.00 incl 18 %: total 236.00, taxable 200.00, tax 36.00 (' + [r.total, r.taxable, r.tax] + ')');
  ok(r.heads.length === 2 && /^CGST 9% [^\d]*18\.00$/.test(r.heads[0]) && /^SGST 9% [^\d]*18\.00$/.test(r.heads[1]), 'IN 2 x 118.00: CGST 9% 18.00 and SGST 9% 18.00 (' + r.heads.join(' | ') + ')');
  r = P.paint('IN', [L('Item', 1, 100, 18)]);
  ok(num(r.total) === 100 && num(r.taxable) === 84.74 && num(r.tax) === 15.26, 'IN 100.00 incl 18 %: taxable 84.74 + tax 15.26 = 100.00 (' + [r.taxable, r.tax, r.total] + ')');
  ok(r.heads.length === 2 && r.heads.every((h) => /7\.63$/.test(h)), 'IN 100.00: CGST 7.63 and SGST 7.63 (' + r.heads.join(' | ') + ')');
  r = P.paint('IN', [L('A', 1, 118, 18), L('B', 1, 105, 5)]);
  ok(num(r.total) === 223 && num(r.taxable) === 200 && num(r.tax) === 23, 'IN mixed 18 % + 5 %: total 223.00, taxable 200.00, tax 23.00 (' + [r.total, r.taxable, r.tax] + ')');
  ok(r.heads.length === 4 && /^CGST 2\.5% [^\d]*2\.50$/.test(r.heads[0]) && /^SGST 2\.5% [^\d]*2\.50$/.test(r.heads[1]) && /^CGST 9% [^\d]*9\.00$/.test(r.heads[2]) && /^SGST 9% [^\d]*9\.00$/.test(r.heads[3]), 'IN mixed: the slabs listed separately, from the engine heads (' + r.heads.join(' | ') + ')');
  ok((r.html.match(/<tr><td>0000<\/td>/g) || []).length === 2, 'IN mixed: the HSN table has one row per taxed line');
  r = P.paint('IN', [L('Soap', 3, 30, 5, { off: 10, discount: 9 })]);
  ok(num(r.items) === 90 && num(r.saved) === -9 && num(r.taxable) === 77.14 && num(r.tax) === 3.86 && num(r.total) === 81, 'IN 3 x 30.00 -10 % @5: items 90.00, saved 9.00, taxable 77.14, tax 3.86, total 81.00 (' + [r.items, r.saved, r.taxable, r.tax, r.total] + ')');
  /* the odd minor unit: the engine decides, the page prints it */
  let uneven = 0, notSum = 0;
  for (let cents = 100; cents <= 2000; cents++) {
    const m = vm.runInContext('(function(){ BILL.lines=[{name:"x",hsn:"1",qty:1,unit:"piece",price:' + cents / 100 + ',rate:18,sample_rate:18}]; return sampleBill("tax").money; })()', P.cx);
    if (m.cgst !== m.sgst) uneven++;
    if (Math.round((m.cgst + m.sgst) * 100) !== Math.round(m.tax * 100)) notSum++;
  }
  ok(uneven === 0 && notSum === 0, 'the odd minor unit: the engine gives CGST = SGST and tax = their sum for every price 1.00..20.00 (' + uneven + ' uneven, ' + notSum + ' off), so no head is ever hand-halved here');
  r = P.paint('IN', [L('Shirt', 2, 118, 18)], 'cash');
  ok(num(r.total) === 236 && r.taxable === null && r.tax === null, 'IN cash memo: total 236.00, no tax rows');
}

/* ── 4 · the page's own sample: 881.00 in two tenders that add to it ────────────────────────────── */
{
  const P = page();
  vm.runInContext('onPreviewMessage', P.cx)({ data: { cb_preview: true, paper: '80', kind: 'tax', refusal: '', tax: { word: 'GST', split: true, rate: 18, rates: [0, 5, 12, 18, 28] }, country: 'IN', currency: 'INR', tax_id: '33AABCK1234F1Z6' } });
  const html = P.el('slip').innerHTML;
  const tender = (name) => { const m = html.match(new RegExp('<span class="l">' + name + '</span><span class="v">([^<]*)<')); return m ? Number(m[1].replace(/[^\d.]/g, '')) : null; };
  ok(tender('Cash') === 500 && tender('UPI') === 381 && /data-testid="slip-total">[^<]*881\.00/.test(html), 'the sample bill: TOTAL 881.00, paid 500.00 cash + 381.00 on UPI');
  ok(/data-testid="slip-saved">-[^<]*9\.00/.test(html) && /data-testid="slip-items">[^<]*890\.00/.test(html), 'the sample bill: Items 890.00 and You saved 9.00 are the engine\'s gross and savings');
  ok(!/Change/.test(html), 'the sample bill: no change line (the tenders are made to the total)');
}

/* ── 5 · Australia: GST-free + 10 % ─────────────────────────────────────────────────────────────── */
{
  const P = page();
  const r = P.paint('AU', [L('Fresh food', 2, 50, 0), L('Gadget', 1, 110, 10)]);
  ok(num(r.total) === 210 && num(r.taxable) === 200 && num(r.tax) === 10, 'AU GST-free + 10 %: total 210.00, taxable 200.00, GST 10.00 (' + [r.total, r.taxable, r.tax] + ')');
  ok(r.heads.length === 1 && /^GST 10% [^\d]*10\.00$/.test(r.heads[0]), 'AU: one GST head, 10 %, 10.00 (' + r.heads.join(' | ') + ')');
  ok(!/GST 0%/.test(r.html), 'AU: the GST-free line prints no GST % and no GST amount');
}

/* ── 6 · a currency with no decimals ────────────────────────────────────────────────────────────── */
{
  const P = page();
  const r = P.paint('JP', [L('Item', 2, 118, 10)]);
  ok(num(r.total) === 236 && num(r.taxable) === 215 && num(r.tax) === 21, 'JPY 2 x 118 incl 10 %: total 236, taxable 215, tax 21 (' + [r.total, r.taxable, r.tax] + ')');
  ok(r.total === '236' && r.taxable === '215', 'JPY: no decimals printed on the total or the taxable value');
}

/* ── 7 · CUR-1: a mixed-currency bill is refused in words ───────────────────────────────────────── */
{
  const P = page();
  const r = P.paint('AU', [L('Local', 1, 110, 10), L('Imported', 1, 50, 10, { currency: 'USD' })]);
  ok(r.total === null && /data-testid="slip-no-country"/.test(r.html) && /(AUD and USD|USD and AUD) cannot be combined/.test(r.html), 'CUR-1: a USD line on an AUD bill prints the refusal words and no figure');
  ok(/An amount is labelled, never converted/.test(r.html), 'CUR-1: the words are the money engine\'s own');
  ok(num(P.paint('AU', [L('Local', 1, 110, 10)]).total) === 110, 'CUR-1: with one currency again the slip comes back (110.00)');
}

console.log(n + ' checks passed');
