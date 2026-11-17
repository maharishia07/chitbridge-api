'use strict';
/** tests/till-network-unpriced.test.cjs — PRICE-FIX F5: the counter sells a network line only at the STORE's own price (as the storefront does), never the brand's. */
const fs = require('fs'), path = require('path');
const read = require('../lib/catalogue-read');
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n); } };
const src = { source_key: 's@v1', title: 'Brand', owner_entity_id: 'brand' };
const unpriced = read.referencedLine(src, { name: 'Masala Tea', price: 180, commercials: { available: true } }, 'store', null);
const priced = read.referencedLine(src, { name: 'Masala Tea', price: 180, commercials: { price: 200 } }, 'store', null);
const perLitre = read.referencedLine(src, { name: 'Oil', commercials: { price_per_litre: 150 } }, 'store', null);
t('the store never priced it → not priced by the store', typeof read.isPricedByStore === 'function' && read.isPricedByStore(unpriced, 180) === false);
t('the store priced it → priced', read.isPricedByStore(priced, 200) === true);
t('price_per_litre counts like the storefront', read.isPricedByStore(perLitre, 150) === true);
t('a zero price is never priced', read.isPricedByStore(priced, 0) === false);
t('the counter snapshot asks the one rule', /isPricedByStore\(\w+, \w+\.price\)/.test(fs.readFileSync(path.join(__dirname, '..', 'routes', 'till.js'), 'utf8')));
console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
