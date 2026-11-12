/**
 * acc-221-unreadable-number.test.cjs — ACC-221 (+ ACC-222): A FIGURE THAT IS NOT A NUMBER IS NAMED, NEVER PRICED AT 0 AND SAID OK.
 *
 *   The engine (adopted lib/tax.js, num()) reads "abc", NaN, Infinity and null as 0 with bridge.ok true — fixed in chitbridge-engines (follow-up);
 *   the api never hands it one. services.normLines marks every figure the caller sent that is not a number (`unread`, with the field and the
 *   text), routes/tax.js badLine and routes/invoice.js refuse it by name BEFORE any tax runs, and services.computeTax (the one call to the
 *   engine) throws line_unreadable for any line it would hand the engine with a non-finite figure. A valid line is byte-identical.
 *   No database, no server. Run: node tests/acc-221-unreadable-number.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://x:x@127.0.0.1:1/x';
const S = require('../lib/services');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const seller = { State: '27', Country: 'IN', Gstin: '27AAAAA0000A1Z5' }, buyer = { State: '27', Country: 'IN', Gstin: '27AAACB2230M1ZW' };
const line = (over) => Object.assign({ name: 'Tea', qty: 2, price: 100, gst_rate: 18 }, over);
const BAD = ['abc', NaN, Infinity, '', ' ', true, {}];

console.log('\n══ ACC-221 · a figure that is not a number is named, never 0 and ok ══\n');

/* 1 · normLines names it (every figure, every spelling) */
for (const field of [['qty', 'qty'], ['quantity', 'qty'], ['price', 'price'], ['unitPrice', 'price'], ['listPrice', 'price'], ['discount', 'discount'], ['gst_rate', 'gst_rate'], ['cess_rate', 'cess_rate']]) {
  for (const v of BAD) {
    if (['discount', 'gst_rate', 'cess_rate'].includes(field[0]) && typeof v === 'string' && v.trim() === '') continue; /* a blank optional field is absent (checked below) */
    const l = S.normLines({ lines: [line({ qty: undefined, price: undefined, gst_rate: undefined, [field[0]]: v })] })[0];
    const got = l.unread.map((u) => u.field);
    ok('normLines names ' + field[0] + ' = ' + String(typeof v === 'object' ? '{}' : v), got.includes(field[1]), JSON.stringify(l.unread));
  }
}
ok('a valid line has nothing unread', S.normLines({ lines: [line(), line({ qty: '3', price: '99.5', discount: 0, cess_rate: null })] }).every((l) => l.unread.length === 0));
ok('null and absent mean not sent (the shelf may answer)', S.normLines({ lines: [{ name: 'x', qty: 1, price: null }] })[0].unread.length === 0);

/* 2 · the refusal sentence names the line and the text */
const said = S.unreadSaid(S.normLines({ lines: [line(), line({ name: 'Rice', price: 'abc' })] }), (l) => '"' + l.name + '"');
ok('unreadSaid -> BAD_PRICE naming the line, the field and the text', !!said && said[0] === 'BAD_PRICE' && /"Rice"/.test(said[1]) && /price/.test(said[1]) && /"abc"/.test(said[1]), JSON.stringify(said));
ok('no unread -> null', S.unreadSaid(S.normLines({ lines: [line()] }), (l) => l.name) === null);

/* 3 · the one call to the engine refuses what it would price at 0 */
const call = (l) => { try { return S.computeTax({ seller, buyer, lines: [l] }); } catch (e) { return e; } };
const mapped = (over) => Object.assign({ key: '0', name: 'Tea', qty: 2, unit_price: 100, gst_rate: 18, discount: 0, cess_rate: 0, unread: [] }, over);
for (const f of ['qty', 'unit_price', 'gst_rate']) for (const v of ['abc', NaN, Infinity, null]) {
  if (f === 'gst_rate' && v === null) continue; /* a null rate is "not given" -> 0 by the caller's own default, as before */
  const e = call(mapped({ [f]: v, listPrice: undefined }));
  ok('computeTax refuses ' + f + ' = ' + v, e instanceof Error && e.code === 'line_unreadable' && e.unread[0].fields.length > 0, String(e && e.message));
}
const e1 = call(mapped({ unit_price: 0, unread: [{ field: 'price', value: 'abc' }] }));
ok('computeTax refuses a line marked unread even though its mapped figure is a number', e1 instanceof Error && e1.unread[0].fields[0] === 'price');
const good = call(mapped({}));
ok('a valid line still prices: 2 x 100 + 18% = 236', good.ValDtls.TotInvVal === 236 && good._cb.bridge.ok === true, JSON.stringify(good.ValDtls));

/* 4 · the engine itself (adopted lib/tax.js num()) still reads "abc" as 0 and says ok: that is the engines follow-up, NOT asserted here, so the
   next adopt of a fixed engine does not turn this file red; the api guard above stands in front of it either way */

/* 5 · the routes use the guard (a source read, so a deleted call goes red) */
const rt = fs.readFileSync(path.join(__dirname, '..', 'routes', 'tax.js'), 'utf8'), ri = fs.readFileSync(path.join(__dirname, '..', 'routes', 'invoice.js'), 'utf8');
/* CTRY-134: the guard moved to services.badLine, the one for every door; tax/compute still goes through it */
const rs = fs.readFileSync(path.join(__dirname, '..', 'lib', 'services.js'), 'utf8');
ok('services.badLine asks unreadSaid, and returns it, before any other check', /function badLine\(lines, opts\) \{[\s\S]*?const unread = unreadSaid\(lines, lineName\)[^\n]*\n\s*if \(unread\) return unread;/.test(rs));
ok('routes/tax.js compute goes through S.badLine', /S\.badLine\(lines, \{ needQty: true/.test(rt));
/* the invoice route has no check of its own: normLines marks the line, computeTax throws, and readFault answers the throw as a named 400 (a handler that already runs at its size limit gets no new branch) */
const TC = require('../lib/tax-contract');
const thrown = call(mapped({ unit_price: null, listPrice: null }));
const spec = TC.readFault(thrown, {});
ok('a line with no price at all -> computeTax throws, readFault answers a named 400 BAD_PRICE', spec.status === 400 && spec.code === 'BAD_PRICE' && /Tea/.test(spec.detail) && /price/.test(spec.detail), JSON.stringify(spec));
ok('readFault on an ordinary error is still the 500 that says nothing of its cause', TC.readFault(new Error('x'), {}).status === 500);
ok('routes/invoice.js reaches computeTax with the normLines lines (the throw is its guard)', ri.includes('S.normLines(req.body)') && ri.includes('S.computeTax(') && ri.includes('readFault(e, req)'));

/* 6 · ACC-222 (folded): a rate below 0 or above 100 would answer a negative tax with bridge ok - refused, named, for every caller */
for (const [field, v] of [['gst_rate', -5], ['gst_rate', 101], ['cess_rate', -1]]) {
  const e = call(mapped({ [field]: v }));
  ok('computeTax refuses ' + field + ' = ' + v + ' (outside 0-100%)', e instanceof Error && e.code === 'line_unreadable' && e.said[0] === 'BAD_RATE' && (e.said[1].includes('outside 0') || e.said[1].includes('below 0')), String(e && e.message));
}
ok('rates 0 and 18 are still priced (100 is in range but off the menu: M2 refuses it, RATE_NOT_ON_MENU)', [0, 18].every((v) => !(call(mapped({ gst_rate: v })) instanceof Error)));

/* 7 · review of #919: cess is uncapped (tobacco cess was above 100% to Jan 2026); a blank optional field is absent; a blank qty / price is not */
const cess160 = call(mapped({ cess_rate: 160 }));
ok('cess 160 passes (never refused above 100)', !(cess160 instanceof Error), String(cess160 && cess160.message));
const cessAbc = call(mapped({ cess_rate: NaN }));
ok('cess NaN is refused, BAD_RATE', cessAbc instanceof Error && cessAbc.said[0] === 'BAD_RATE');
const cessNeg = call(mapped({ cess_rate: -1 }));
ok('cess -1 says "below 0"', cessNeg instanceof Error && cessNeg.said[1].includes('below 0'), String(cessNeg && cessNeg.message));
const blankOk = S.normLines({ lines: [line({ discount: '', cess_rate: ' ', gst_rate: '' }), line({ discount: null })] });
ok('a blank or null discount / cess / rate means absent (no unread)', blankOk.every((l) => l.unread.length === 0), JSON.stringify(blankOk.map((l) => l.unread)));
const blankQty = S.normLines({ lines: [line({ qty: '' }), line({ price: '  ' })] });
ok('a blank qty or price is still refused', blankQty[0].unread[0].field === 'qty' && blankQty[1].unread[0].field === 'price', JSON.stringify(blankQty.map((l) => l.unread)));
const disc = S.normLines({ lines: [line({ discount: 'abc' })] })[0];
ok('discount "abc" is refused (BAD_PRICE)', disc.unread[0].field === 'discount' && S.unreadSaid([disc], () => 'x')[0] === 'BAD_PRICE');

/* 8 · re-check of #919: a blank or null GST rate is NO rate - the shelf fills it in; with no shelf rate it is refused, never taxed at 0% */
const shelf18 = { items: [{ item_id: 'i2', item_data: { name: 'Sunflower Oil', price: 150 } }], slabs: [{ definition_id: 'IN-GST-18', name: 'GST 18%', rules: { rate: 18 } }], categories: [], face: { tax: { default_slab: 'IN-GST-18' } } };
const oil = (rate) => ({ name: 'Sunflower Oil', qty: 1, price: 150, gst_rate: rate });
for (const blank of ['', ' ', null, undefined]) {
  const n = S.normLines({ lines: [oil(blank)] });
  ok('gst_rate ' + JSON.stringify(blank) + ' reads as no rate (null), not 0', n[0].gst_rate === null, String(n[0].gst_rate));
  ok('gst_rate ' + JSON.stringify(blank) + ' + a shelf rate of 18 -> 18%', S.rateLines(n, shelf18)[0].gst_rate === 18);
  const e = call(Object.assign(mapped({}), { gst_rate: n[0].gst_rate }));
  ok('gst_rate ' + JSON.stringify(blank) + ' with no shelf rate -> BAD_RATE, never 0%', e instanceof Error && e.said[0] === 'BAD_RATE' && e.said[1].includes('no tax rate'), String(e && e.message));
}
const zero = S.rateLines(S.normLines({ lines: [oil(0)] }), shelf18)[0];
ok('an explicit 0 stays 0% even where the shelf says 18', zero.gst_rate === 0);
const zeroTax = call(mapped({ gst_rate: 0 }));
ok('an explicit 0 prices: 2 x 100, no tax = 200', !(zeroTax instanceof Error) && zeroTax.ValDtls.TotInvVal === 200, JSON.stringify(zeroTax.ValDtls || zeroTax.message));

const noGstin = S.rateLines(S.normLines({ lines: [oil('')] }), { shelf: null, productOf: () => null, idOf: () => null })[0];
ok('a shop with no tax shelf (no GSTIN, no GST) rates a rate-less line 0% on purpose', noGstin.gst_rate === 0);

console.log('' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
