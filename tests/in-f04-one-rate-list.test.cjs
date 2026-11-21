// tests/in-f04-one-rate-list.test.cjs — IN-F-04: ONE GST rate list for India, the pack's, read by the till and the item sheet.  node tests/in-f04-one-rate-list.test.cjs
// Hand figures: the menu in force is notification 19/2025-CT(Rate) from 1 Feb 2026: 0, 0.25, 1.5, 3, 5, 18, 40 (12 and 28 ended on 22 Sep 2025 / 1 Feb 2026).
const assert = require('node:assert/strict');
const G = require('../lib/tax-governance');
const packs = require('../lib/tax-packs');
let n = 0;
const ok = (name, cond) => { n++; assert.ok(cond, name); };
const old = [0, 5, 12, 18, 28].map((r) => ({ id: 'IN-GST-' + r, name: 'GST ' + r + '%', rate: r, effective_from: '2017-07-01', note: 'layer ' + r }));
const layer = { region_code: 'IN', currency: 'INR', jurisdiction: { tax: { scheme: 'GST', authority: 'CBIC', since: '2017-07-01', slabs: old } } };
const rows = G.slabsFromLayer(layer, 'IN');
const rates = rows.map((r) => r.rules.rate);
const menu = packs.menuAsOf(packs.packFor('IN'));
ok('the list is the pack menu in force, in its order', JSON.stringify(rates) === JSON.stringify(menu.rates) && JSON.stringify(rates) === '[0,0.25,1.5,3,5,18,40]');
ok('12 is gone (ended 22 Sep 2025)', rates.indexOf(12) < 0);
ok('28 is gone (ended 1 Feb 2026)', rates.indexOf(28) < 0);
ok('40, 3 and 0.25 are on it', [40, 3, 0.25].every((r) => rates.indexOf(r) >= 0));
ok('a layer rate keeps its id and name (a bill citing IN-GST-18 still resolves)', rows.find((r) => r.definition_id === 'IN-GST-18').note === 'layer 18');
ok('a new rate gets <country>-<scheme>-<rate>', rows.map((r) => r.definition_id).join() === 'IN-GST-0,IN-GST-0.25,IN-GST-1.5,IN-GST-3,IN-GST-5,IN-GST-18,IN-GST-40');
ok('40 takes effect 22 Sep 2025 (notification 9/2025)', rows.find((r) => r.definition_id === 'IN-GST-40').rules.effective_from === '2025-09-22');
ok('3 and 0.25 stand from 1 Jul 2017', rows.find((r) => r.definition_id === 'IN-GST-3').rules.effective_from === '2017-07-01' && rows.find((r) => r.definition_id === 'IN-GST-0.25').rules.effective_from === '2017-07-01');
ok('a new rate cites the pack notification', /19\/2025-Central Tax \(Rate\)/.test(rows.find((r) => r.definition_id === 'IN-GST-40').note));
ok('every id is a governed id', rows.every((r) => G.isGovernedId(r.definition_id)));
const au = { region_code: 'AU', currency: 'AUD', jurisdiction: { tax: { scheme: 'GST', slabs: [{ id: 'AU-GST-10', name: 'GST 10%', rate: 10 }] } } };
ok('a country whose pack has no dated menu keeps its layer list', G.slabsFromLayer(au, 'AU').map((r) => r.definition_id).join() === 'AU-GST-10');
console.log(n + ' checks');
