/**
 * tests/supply-kind-door.test.cjs — SUPPLY KIND ON THE CATALOGUE AND ON A PAID BILL (AE-F-11, finishes ACC-290; AE, AU and India 1.1.0).
 *
 * OWNS      the proof of lib/supply-kind.js's three new members: keepRefusal (the catalogue door: a `tax_kind` is a row of the SHOP PACK's own table, with the rate it means, none is no default),
 *           suggestFromName (a suggestion from a slab's OWN NAME: hostile fixtures first), withdrawUnknown (a PAID counter bill that names a kind the pack does not know is kept, never refused).
 * CALLED BY scripts/guards.cjs · CI. No database. The packs are the engines' own src (CB_ENGINES_DIR: the adopted copies carry them only after the engines tag is adopted).
 * Hand figures: none (no money moves here). Run: CB_ENGINES_DIR=../chitbridge-engines node tests/supply-kind-door.test.cjs
 */
'use strict';
const path = require('path');
const fs = require('fs');
const engines = process.env.CB_ENGINES_DIR ? path.join(path.resolve(process.env.CB_ENGINES_DIR), 'src') : path.join(__dirname, '..', '..', 'chitbridge-engines', 'src');
if (!fs.existsSync(path.join(engines, 'tax-slab.js'))) { console.log('skip: no engines checkout (set CB_ENGINES_DIR)'); process.exit(0); }
const COUNTRY = require('../lib/country'), ENGINE_COUNTRY = require(path.join(engines, 'country'));
COUNTRY.packFor = ENGINE_COUNTRY.packFor; /* the engines' packs (with `short`) stand in for the adopted copy until the engines tag is adopted */
const K = require('../lib/supply-kind');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); process.exitCode = 1; } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

console.log('\n== the catalogue door: a kind is a row of the shop pack, with its own rate ==\n');
ok('AE zero_rated beside rate 0 is kept', K.keepRefusal({ country: 'AE', kind: 'zero_rated', rate: 0 }) === null);
ok('the engine spelling is read ("Zero-Rated ")', K.keepRefusal({ country: 'AE', kind: ' Zero-Rated ', rate: 0 }) === null);
ok('no kind (undefined, null, blank) is nothing to judge: there is NO default', [undefined, null, '', '  '].every((blank) => K.keepRefusal({ country: 'AE', kind: blank, rate: 0 }) === null));
const bad = K.keepRefusal({ country: 'AE', kind: 'gst_free', rate: 0 });
ok('an AU word on a UAE shop is refused SUPPLY_KIND_UNKNOWN, with the kinds the pack does define', bad && bad.code === 'SUPPLY_KIND_UNKNOWN' && bad.kinds.join() === 'standard,zero_rated,exempt');
ok('zero-rated beside 5% is refused (a kind whose pack rate is 0 needs rate 0)', /means a rate of 0%, not 5%/.test((K.keepRefusal({ country: 'AE', kind: 'zero_rated', rate: 5 }) || {}).why || ''));
ok('AU input_taxed beside 10% is refused; AU taxable beside 10% is kept', !!K.keepRefusal({ country: 'AU', kind: 'input_taxed', rate: 10 }) && K.keepRefusal({ country: 'AU', kind: 'taxable', rate: 10 }) === null);
ok('India (pack 1.1.0) names nil, exempt and non_gst: each is kept beside rate 0; beside 5% or as an AE word it is refused', ['nil', 'exempt', 'non_gst'].every((word) => K.keepRefusal({ country: 'IN', kind: word, rate: 0 }) === null) && !!K.keepRefusal({ country: 'IN', kind: 'exempt', rate: 5 }) && !!K.keepRefusal({ country: 'IN', kind: 'zero_rated', rate: 0 }));

console.log('\n== a suggestion from the slab\'s own name: hostile names first ==\n');
const suggest = (name, country) => K.suggestFromName(name, country || 'AE');
eq('"Zero-rated supply" (the whole kind name) → zero_rated', suggest('Zero-rated supply'), 'zero_rated');
eq('the walk shop\'s slab "VAT 0% zero-rated" → zero_rated', suggest('VAT 0% zero-rated'), 'zero_rated');
eq('the walk shop\'s slab "VAT exempt" → exempt', suggest('VAT exempt'), 'exempt');
eq('AU "GST-free bread" → gst_free', suggest('GST-free bread', 'AU'), 'gst_free');
['Not zero-rated', 'Non-exempt 0%', 'not exempt', 'Zero-rated or exempt', 'Exempt and zero-rated', 'Exempted', 'Unexempt', 'Nonzero-rated', 'Free sample 0%', 'Tax free delivery', 'Standard 5%', '', 'VAT 0%'].forEach((name) => eq('"' + name + '" → nothing selected', suggest(name), null));
['Not currently zero-rated', 'No longer exempt', 'Not yet exempt', 'Never zero-rated', "Isn't zero-rated", 'Exempt?? check with accountant', 'Zero-rated?', 'Maybe exempt', 'Not sure zero-rated', 'Exempt (check)', 'TBC exempt', 'Was not zero-rated last year'].forEach((name) => eq('hostile "' + name + '" → nothing selected', suggest(name), null));
['Rent, not exempt', 'Zero-rated exports', 'VAT 0% zero-rated', 'Zero-rated (exports)', 'Standard 5% / zero-rated exports'].forEach((name) => eq('control "' + name + '" → ' + (/^Rent/.test(name) ? 'nothing' : 'zero_rated'), suggest(name), /^Rent/.test(name) ? null : 'zero_rated'));
eq('AU "Free sample 0%" → nothing (the word "free" alone is not the kind GST-free)', suggest('Free sample 0%', 'AU'), null);
eq('AU "Not GST-free" → nothing', suggest('Not GST-free', 'AU'), null);
eq('AU "Input-taxed rent" → input_taxed', suggest('Input-taxed rent', 'AU'), 'input_taxed');
eq('India: "Exempt goods" gives exempt, "Nil-rated or exempt" and "Not exempt" give nothing, "Non-GST" gives non_gst', [suggest('Exempt goods', 'IN'), suggest('Nil-rated or exempt', 'IN'), suggest('Not exempt', 'IN'), suggest('Non-GST', 'IN')], ['exempt', null, null, 'non_gst']);
eq('a name that is not text gives nothing', [suggest(null), suggest(7), suggest(undefined)], [null, null, null]);
ok('the suggestion is never a rate or a save: it returns an id only', typeof suggest('VAT exempt') === 'string');

console.log('\n== a PAID counter bill is kept, never refused (offline replay after a pack or country change) ==\n');
const stale = () => ({ ItemList: [{ name: 'Tea', qty: 1, gst_rate: 0, tax_kind: 'gst_free' }, { name: 'Rice', qty: 1, gst_rate: 5 }], _cb: { kinds: [{ line: 0, kind: 'gst_free', rate: 0 }] } });
const inv = stale(), held = K.withdrawUnknown(inv, 'AE');
ok('a queued bill that carries an AU kind, synced to a UAE shop: the kind is taken off the line and out of _cb.kinds', held && !('tax_kind' in inv.ItemList[0]) && !inv._cb.kinds);
eq('it answers which line and which word, with SUPPLY_KIND_UNKNOWN as the code', [held.code, held.lines, held.kinds], ['SUPPLY_KIND_UNKNOWN', [1], ['gst_free']]);
ok('the sentence says the bill is saved and counts as 0% with no kind', /bill is saved/.test(held.why) && /0% with no kind/.test(held.why));
ok('the other lines are untouched (rate 5 stays)', inv.ItemList[1].gst_rate === 5 && inv.ItemList[0].gst_rate === 0);
const good = { ItemList: [{ name: 'Tea', qty: 1, gst_rate: 0, tax_kind: 'zero_rated' }], _cb: { kinds: [{ line: 0, kind: 'zero_rated', rate: 0 }] } };
ok('a bill whose kind the pack knows is not touched', K.withdrawUnknown(good, 'AE') === null && good.ItemList[0].tax_kind === 'zero_rated' && good._cb.kinds.length === 1);
const five = { ItemList: [{ name: 'Tea', qty: 1, gst_rate: 5, tax_kind: 'gst_free' }] }, heldFive = K.withdrawUnknown(five, 'AE');
ok('a 5% line whose stale kind is withdrawn is never called "0% with no kind": the sentence says the rate stays', heldFive && !/0% with no kind/.test(heldFive.why) && /keeps its rate/.test(heldFive.why) && five.ItemList[0].gst_rate === 5, heldFive && heldFive.why);
const mixed = { ItemList: [{ name: 'A', qty: 1, gst_rate: 0, tax_kind: 'gst_free' }, { name: 'B', qty: 1, GstRt: 5, tax_kind: 'gst_free' }] };
ok('one line at 0% and one at 5%: the sentence names both outcomes', /line at 0% counts as a sale with no kind/.test(K.withdrawUnknown(mixed, 'AE').why) && /keeps that rate/.test(K.withdrawUnknown({ ItemList: mixed.ItemList.map((i) => Object.assign({}, i, { tax_kind: 'gst_free' })) }, 'AE').why));
ok('no kind anywhere: null, nothing touched', K.withdrawUnknown({ ItemList: [{ name: 'x', qty: 1, gst_rate: 5 }] }, 'AE') === null);
ok('the route step does it for a counter bill and still refuses a non-counter one', (() => {
  const src = require('../tools/chits-files.cjs').read(path.join(__dirname, '..'));
  const at = src.indexOf('async function sendSupplyKind');
  const body = src.slice(at, src.indexOf('\n}\n', at));
  return /if \(sendState\.counterBill\)/.test(body) && /withdrawUnknown/.test(body) && /kindHeld/.test(body) && /status: 422/.test(body) && body.indexOf('counterBill') < body.indexOf('status: 422');
})());

console.log(String.fromCharCode(10) + (fail ? fail + ' FAILED, ' : '') + pass + ' checks');
