/**
 * tests/cat344-start-priced-1133.test.cjs — CAT-344: "Start your shop" works for a list with no prices of its own (a new AU / AE / country-less shop).
 * @type regression
 * OWNS      (1) the plan the route makes for hotel and veg in AU, AE and no country: the plain mint carries no price (the writer would refuse it), so the route
 *           hands the dialog the rows (unpricedRowsOf) and takes the priced ones back as {products} (catalogueStartPlan), refusing only a row left
 *           without a price and naming it; (2) the dialog (till.html startMint · startPriceRows · startPriced · startMintSend): an unpriced list shows an empty price
 *           box per row, sends {blueprint, products} with only the priced rows, and says what was left out; a list with its own prices still sends {blueprint}.
 * CALLED BY the api test run. No browser, no database.   node tests/cat344-start-priced-1133.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const BP = require('../lib/catalogue-blueprint');
const till = fs.readFileSync(path.join(__dirname, '..', 'routes', 'till.js'), 'utf8');
const page = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (name, fn) => Promise.resolve().then(fn).then(() => { pass++; console.log('   ok   ' + name); }, (e) => { fail++; console.log('   FAIL ' + name + '\n          ' + String(e.message).split('\n')[0]); });
const grab = (src, name) => {
  let i = src.indexOf('\nasync function ' + name + '(');
  if (i < 0) i = src.indexOf('\nfunction ' + name + '(');
  assert.ok(i >= 0, name + ' is not there');
  return src.slice(i + 1, src.indexOf('\n}\n', i + 1) + 2);
};
const said = (code, error, words, extra) => Object.assign({ code, error, message: words }, extra || {});
const shopCountry = { c: 'AU' };
const fakeRequire = (id) => {
  if (id === '../lib/catalogue-blueprint') return BP;
  if (id === '../lib/units') return require('../lib/units');
  if (id === '../lib/shop-country') return { shopCountryOf: async () => shopCountry.c };
  throw new Error('test has no ' + id);
};

(async () => {
  console.log('\ncat344 · start your shop with an unpriced list');
  const R = new Function('require', 'said', grab(till, 'catalogueStartPlan') + grab(till, 'unpricedRowsOf') + 'return { plan: catalogueStartPlan, rows: unpricedRowsOf };')(fakeRequire, said);

  for (const country of ['AU', 'AE', '']) {
    for (const key of ['hotel', 'veg']) {
      await ok(key + ' for ' + JSON.stringify(country) + ': the plain mint has no price, so the dialog is handed the rows to price', async () => {
        const plain = R.plan({ blueprint: key }, [], country);
        assert.ok(plain.items.length > 0 && plain.items.every((item) => item.price === undefined), 'plain mint carries a price');
        shopCountry.c = country;
        const shown = await R.rows(BP, key, 'e1');
        assert.strictEqual(shown.unpriced, true);
        assert.strictEqual(shown.rows.length, plain.items.length);
        assert.ok(shown.rows.every((row) => row.name && row.unit));
      });
      await ok(key + ' for ' + JSON.stringify(country) + ': two rows priced, the rest left out and NAMED, nothing invented', async () => {
        shopCountry.c = country;
        const shown = await R.rows(BP, key, 'e1');
        const sent = shown.rows.slice(0, 2).map((row, i) => Object.assign({}, row, { price: i ? '12.50' : '7' })).concat([Object.assign({}, shown.rows[2], { price: '' })]);
        const planned = R.plan({ blueprint: key, products: sent }, [], country);
        assert.strictEqual(planned.items.length, 2);
        assert.deepStrictEqual(planned.items.map((item) => item.price), [7, 12.5]);
        assert.strictEqual(planned.refused.length, 1);
        assert.ok(/no price/.test(planned.refused[0].why) && planned.refused[0].had.name === shown.rows[2].name);
      });
    }
  }
  await ok('India: the list carries its own prices, so the dialog mints it as it is', async () => {
    shopCountry.c = 'IN';
    const shown = await R.rows(BP, 'veg', 'e1');
    assert.strictEqual(shown.unpriced, false);
    assert.ok(R.plan({ blueprint: 'veg' }, [], 'IN').items.every((item) => item.price > 0));
  });
  await ok('no list asked for: the card answer is unchanged (no extra read)', async () => {
    assert.deepStrictEqual(await R.rows(BP, undefined, 'e1'), {});
  });

  /* the dialog */
  const posts = [];
  const boxes = {};
  const stub = {
    document: {
      getElementById: (id) => boxes[id] || (boxes[id] = { value: '', id, setAttribute() {}, removeAttribute() {}, set innerHTML(v) { this.html = v; }, get innerHTML() { return this.html || ''; } }),
      querySelectorAll: () => []
    },
    esc: (v) => String(v),
    HOST: { tillGet: async () => stub.answer, tillPost: async (url, body) => { posts.push([url, body]); return { ok: true, message: '2 products added' }; } },
    startSay: (t, bad) => { stub.said = [t, bad]; },
    refresh: async () => {}, startClose() {}, paintChips() {}, paintQuick() {}, paintHits() {}, cbQuiet() {}, Array, encodeURIComponent
  };
  const ctx = vm.createContext(stub);
  vm.runInContext('var START_PRICING = null;\n' + ['startMint', 'startPriceRows', 'startPriced', 'startMintSend'].map((n) => grab(page, n)).join('\n'), ctx);
  await ok('an unpriced list shows an empty price box per row, each with its id from the register', async () => {
    stub.answer = { unpriced: true, rows: [{ name: 'Tomato', unit: 'kg', category: 'V' }, { name: 'Onion', unit: 'kg', category: 'V' }, { name: 'Garlic', unit: 'kg', category: 'V' }] };
    await vm.runInContext("startMint('veg')", ctx);
    assert.strictEqual(posts.length, 0, 'nothing is posted before the owner prices');
    const html = boxes.startbody.html;
    assert.strictEqual((html.match(/<input/g) || []).length, 3);
    assert.ok(!/value=/.test(html), 'the price column starts empty');
    assert.ok((html.match(/data-cbsid="CTR006-I05"/g) || []).length === 3 && /data-cbsid="CTR006-B46"/.test(html) && /data-cbsid="CTR006-B47"/.test(html));
  });
  await ok('Add with no price typed says so and sends nothing', async () => {
    await vm.runInContext('startPriced()', ctx);
    assert.strictEqual(posts.length, 0);
    assert.strictEqual(stub.said[1], true);
  });
  await ok('Add sends {blueprint, products} with the priced rows only, and names the one left out', async () => {
    boxes.startprice0.value = '3.20'; boxes.startprice1.value = '1.1';
    await vm.runInContext('startPriced()', ctx);
    assert.strictEqual(posts.length, 1);
    const [url, body] = posts[0];
    assert.strictEqual(url, '/api/till/catalogue');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(body)), { blueprint: 'veg', products: [{ name: 'Tomato', unit: 'kg', category: 'V', price: '3.20' }, { name: 'Onion', unit: 'kg', category: 'V', price: '1.1' }] });
    assert.ok(/left out, no price: Garlic/.test(stub.said[0]), stub.said[0]);
  });
  await ok('a list with its own prices still sends {blueprint} alone', async () => {
    posts.length = 0; stub.answer = { unpriced: false };
    await vm.runInContext("startMint('veg')", ctx);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(posts[0][1])), { blueprint: 'veg' });
  });
  await ok('no answer to the rows read: falls through to the plain mint (the server says why)', async () => {
    posts.length = 0; stub.answer = null;
    await vm.runInContext("startMint('hotel')", ctx);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(posts[0][1])), { blueprint: 'hotel' });
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
