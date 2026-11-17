'use strict';
/* CAT-218 · the Product Lab's list: one row per product with its units as choices, each unit's GST unit code (UQC) from the engine's table,
   a whole figure without .00, and the sentence beside a grey Next. Run: node tests/product-lab-rows.test.cjs */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const R = require('../public/app/product-lab-rows.js');
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; console.log('  ok  ' + msg); };

const rows = [
  { name: 'Tomato', unit: 'kg', price: 40, category: 'Veg' },
  { name: 'Tomato', unit: 'box', price: 900, category: 'Veg' },
  { name: 'Onion', unit: 'kg', price: 30, category: 'Veg' },
  { name: 'Thali', unit: 'plate', price: 120, category: 'Meals' }
];
const grouped = R.groupRows(rows);
ok(grouped.length === 3, 'four list rows are three products: Tomato once, with its two units');
ok(grouped[0].units.map((u) => u.unit).join() === 'kg,box', "a product keeps its units in the list's order");
ok(grouped[0].units[0].uqc === 'KGS' && grouped[0].units[1].uqc === 'BOX', 'each unit carries the GST unit code the engine table holds (kg → KGS, box → BOX)');
ok(grouped[2].units[0].uqc === null, 'a unit the table has no code for (plate) shows none, never a guessed one');
ok(R.groupRows([{ name: 'Tomato', unit: 'kg', category: 'A' }, { name: 'Tomato', unit: 'kg', category: 'B' }]).length === 2, 'the same name on two shelves stays two products');
ok(R.groupRows(null).length === 0, 'no rows, no products');
ok(/\w/.test(R.nextWhy(0)) && R.nextWhy(0).split(/\s+/).length <= 12, 'with nothing chosen Next has a reason, within the 12-word budget');
ok(R.nextWhy(3) === '', 'with something chosen there is nothing to explain');

/* the whole-rupee helper, lifted from helpers.js and run against a stub fmtMoney */
const src = fs.readFileSync(__dirname + '/../public/app/helpers.js', 'utf8');
const at = src.indexOf('function fmtMoneyWhole(');
const lifted = src.slice(at, src.indexOf('\n}\n', at) + 3);
/* the stub puts the code AFTER the figure for AED (as Intl does for many locales), the case a lookahead typo once missed */
const ctx = vm.createContext({ fmtMoney: (a, c, e) => (a == null ? e : c === 'AED' ? Number(a).toFixed(2) + ' AED' : '₹' + Number(a).toFixed(2)) });
vm.runInContext(lifted, ctx);
const whole = (a, e, c) => vm.runInContext('fmtMoneyWhole(' + JSON.stringify(a) + ', "' + (c || 'INR') + '", ' + JSON.stringify(e) + ')', ctx);
ok(whole(40) === '₹40', 'a whole price drops its .00');
ok(whole(12.5) === '₹12.50', 'a price with paise keeps them');
ok(whole(40, '', 'AED') === '40 AED', 'a code AFTER the figure still drops its .00');
ok(whole(12.5, '', 'AED') === '12.50 AED', 'a code after the figure keeps paise (no mixed column)');
ok(whole(-40) === '₹-40' && whole(0) === '₹0', 'a negative whole and zero drop .00 too');
ok(whole(null, '—') === '—', 'no price shows the empty mark');
console.log(n + ' checks');
