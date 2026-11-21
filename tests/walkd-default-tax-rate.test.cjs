/**
 * tests/walkd-default-tax-rate.test.cjs — WALK-D D-F-08: A NEW PRODUCT IN A TAX-REGISTERED SHOP CARRIES THE COUNTRY'S RATE (lib/default-tax-rate.js).
 *
 * OWNS      defaultRateOf (pure) and stampDefault with a shop stand-in: AU registered (ABN) → gst_rate 10 from the pack (tax-packs AU standard_rate); AE registered → 5; AU unregistered → none;
 *           IN (slab-rated, no standard rate) → none; a typed rate (even 0), a slab or a category → left alone. Hand figure: the stamped item billed at A$19.80 tax-in: 19.80 / 11 = 1.80 GST, 18.00 taxable
 *           (the engine's own answer, services.computeTax); an item with NO rate is refused by that engine (BAD_RATE), which is what the walker's till posted at 0% instead.
 * CALLED BY by hand: node tests/walkd-default-tax-rate.test.cjs
 * FLOW      item → stampDefault(shop read) → item + gst_rate | item as sent
 * CARD      15-tax-and-country-packs/tax-compute-rate-invoice-tax
 */
'use strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
const path = require('path');
const HERE = path.join(__dirname, '..');
const countrySetup = require(path.join(HERE, 'lib', 'country-setup'));
const dflt = require(path.join(HERE, 'lib', 'default-tax-rate'));
const services = require(path.join(HERE, 'lib', 'services'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

(async () => {
  console.log('\n== WALK-D D-F-08 · a registered shop\'s new product carries the country rate ==\n');
  let shop = {};
  let registration = 'regular';
  countrySetup.registrationOfShop = async () => registration;
  const query = async () => ({ rows: [shop] });
  const stamp = async (items, s, reg) => { shop = s; registration = reg || 'regular'; return dflt.stampDefault('e1', items, query); };
  const yoghurt = () => ({ name: 'WKD Yoghurt', price: 5 });

  let out = await stamp([yoghurt()], { country: 'AU', gstn: '12345678901', policy_flags: {} });
  ok('AU registered (ABN): a new product with no rate gets gst_rate 10 (pack standard_rate)', out[0].gst_rate === 10, JSON.stringify(out));
  out = await stamp([yoghurt()], { country: 'AE', gstn: '100123456700003', policy_flags: {} });
  ok('AE registered (TRN): gets 5', out[0].gst_rate === 5, JSON.stringify(out));
  out = await stamp([yoghurt()], { country: 'AU', gstn: null, policy_flags: {} }, 'unregistered');
  ok('AU unregistered: no rate is handed over', out[0].gst_rate === undefined, JSON.stringify(out));
  out = await stamp([yoghurt()], { country: 'AU', gstn: null, policy_flags: {} }, 'unknown');
  ok('AU registration nobody said: no rate is handed over', out[0].gst_rate === undefined, JSON.stringify(out));
  out = await stamp([yoghurt()], { country: 'IN', gstn: '27AAPFU0939F1ZV', policy_flags: {} });
  ok('IN registered: slab-rated, the pack has no one standard rate → none', out[0].gst_rate === undefined, JSON.stringify(out));
  out = await stamp([{ name: 'Zero', price: 1, gst_rate: 0 }, { name: 'Typed', price: 1, gst_rate: '5' }, { name: 'Slab', price: 1, tax_slab: 's1' }, { name: 'Cat', price: 1, categories: ['c1'] }], { country: 'AU', gstn: '12345678901', policy_flags: {} });
  ok('a typed rate (even 0), a slab and a category are left alone', out[0].gst_rate === 0 && out[1].gst_rate === '5' && out[2].gst_rate === undefined && out[3].gst_rate === undefined, JSON.stringify(out));
  const input = yoghurt();
  await stamp([input], { country: 'AU', gstn: '12345678901', policy_flags: {} });
  ok('the input item is not changed (a copy is stamped)', input.gst_rate === undefined);
  ok('defaultRateOf: pure, no standard rate → null', dflt.defaultRateOf(yoghurt(), undefined) === null && dflt.defaultRateOf(yoghurt(), 10) === 10);
  const failing = await dflt.stampDefault('e1', [yoghurt()], async () => { throw new Error('db down'); });
  ok('a shop that cannot be read leaves the item as sent (fails open)', failing[0].gst_rate === undefined);

  /* the money: A$19.80 tax-in at the stamped rate → GST 1.80 (the walker's bill posted 0) */
  const rate = (await stamp([yoghurt()], { country: 'AU', gstn: '12345678901', policy_flags: {} }))[0].gst_rate;
  const bill = (gst_rate) => services.computeTax({ seller: { Country: 'AU', Gstin: '12345678901', RegType: 'regular', Name: 'S' }, buyer: { Country: 'AU', Name: 'B' }, lines: [{ id: 'a', name: 'WKD Yoghurt', qty: 1, unit_price: 19.8, discount: 0, gst_rate, cess_rate: 0 }], priceIncludesTax: true });
  const row = bill(rate).ItemList[0];
  ok('A$19.80 tax-in at the stamped rate: taxable 18.00, GST 1.80 (19.80 / 11)', row.AssAmt === 18 && row.TaxAmt === 1.8, JSON.stringify(row));
  let refused = null;
  try { bill(undefined); } catch (e) { refused = e; }
  ok('the same line with NO rate is refused by the engine (BAD_RATE), never taxed at 0%', !!refused && refused.said && refused.said[0] === 'BAD_RATE');

  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
