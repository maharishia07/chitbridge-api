/**
 * tests/stale-kind-rate-change.test.cjs - A RATE CHANGE NEVER KEEPS A STALE `tax_kind` (EGM-T1 blocker, 21 Nov; AE-F-11).
 *
 * OWNS      the proof that an item at 0% zero-rated (or exempt) that is moved to 5% bills 5% - on both write paths: the item PATCH (routes/products.js editProductLocked: merge-patch, then
 *           supply-kind.dropStaleKind) and the one product writer's merge edit (catalogue-write.patchItems: bulk update, categories; a merge that sets a non-zero rate unsets the kind).
 *           A kind the write itself sets is judged, not cleared (kindRefusal); a kind at rate 0 is kept.
 * CALLED BY scripts/guards.cjs - CI. No server, no database: the writer gets a recording stand-in. Needs the engines (CB_ENGINES_DIR; without it the test SKIPs, said).
 * Hand figures (AED, VAT 5%): AED 100.00 tea, price excludes VAT -> VAT 5.00, total 105.00. Stale kind (the bug): VAT 0.00.
 * Run: CB_ENGINES_DIR=../chitbridge-engines node tests/stale-kind-rate-change.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const engines = process.env.CB_ENGINES_DIR ? path.join(path.resolve(process.env.CB_ENGINES_DIR), 'src') : path.join(__dirname, '..', '..', 'chitbridge-engines', 'src');
if (!fs.existsSync(path.join(engines, 'tax-slab.js'))) { console.log('skip: no engines checkout (set CB_ENGINES_DIR)'); process.exit(0); }
const T = require(path.join(engines, 'tax'));
const db = require('../db');
db.query = async () => ({ rows: [{ country: 'AE', gstn: null }] });
const K = require('../lib/supply-kind');
const catwrite = require('../lib/catalogue-write');
const products = require('../routes/products');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const vatOn100 = (item) => {
  const bill = T.determine({ seller: { Country: 'AE', LglNm: 'Al Noor Trading LLC', TRN: '100000000000003' }, buyer: { Country: 'AE' }, priceIncludesTax: false,
    lines: [{ name: 'Tea', qty: 1, unit_price: 100, rate: Number(item.gst_rate), ...(item.tax_kind ? { tax_kind: item.tax_kind } : {}) }] });
  return bill.ValDtls.TaxVal;
};
/** what the writer's jsonb `||` leaves: stored overlaid by the merge data the writer sent */
async function viaWriter(stored, patch) {
  let sent = null;
  await catwrite.patchItems({ query: async (text, params) => { sent = JSON.parse(params[1][0]); return { rows: [] }; } }, 'shop-1', [{ item_id: '11111111-1111-4111-8111-111111111111', merge: patch }]);
  return Object.assign({}, stored, sent);
}

(async () => {
  console.log('\n== a rate change clears the kind that only meant 0% ==\n');
  const zero = { name: 'Tea', gst_rate: 0, tax_kind: 'zero_rated' };
  ok('the bug, on the engine: the stale kind at 5% bills AED 0.00 of VAT on AED 100', vatOn100({ gst_rate: 5, tax_kind: 'zero_rated' }) === 0);
  ok('control: 5% with no kind bills 5.00 on AED 100', vatOn100({ gst_rate: 5 }) === 5);
  const patched = K.dropStaleKind(products.mergePatch(zero, { gst_rate: 5 }), { gst_rate: 5 });
  ok('PATCH { gst_rate: 5 } on a 0% zero-rated item: the kind is gone, the rate is 5', patched.gst_rate === 5 && !('tax_kind' in patched), JSON.stringify(patched));
  ok('... and that item bills 5.00 on AED 100 (zero-rated -> 5%)', vatOn100(patched) === 5, String(vatOn100(patched)));
  const exemptPatched = K.dropStaleKind(products.mergePatch({ gst_rate: 0, tax_kind: 'exempt' }, { gst_rate: '5' }), { gst_rate: '5' });
  ok('an exempt item moved to 5% (rate sent as text) loses the kind too', !('tax_kind' in exemptPatched) && vatOn100(exemptPatched) === 5);
  const bulk = await viaWriter(zero, { gst_rate: 5 });
  ok('the one writer: a merge edit that sets 5% unsets the kind (a null reads as none)', bulk.gst_rate === 5 && !bulk.tax_kind && vatOn100(bulk) === 5, JSON.stringify(bulk));

  console.log('\n== what must NOT be cleared ==\n');
  ok('a PATCH that leaves the rate at 0 keeps the kind', K.dropStaleKind(products.mergePatch(zero, { name: 'Tea 2' }), { name: 'Tea 2' }).tax_kind === 'zero_rated');
  ok('a PATCH that sets rate 0 and a kind together keeps that kind', K.dropStaleKind({ gst_rate: 0, tax_kind: 'exempt' }, { gst_rate: 0, tax_kind: 'exempt' }).tax_kind === 'exempt');
  ok('a write that names the kind itself beside a non-zero rate is left for the door to judge (not silently cleared)', K.dropStaleKind({ gst_rate: 5, tax_kind: 'zero_rated' }, { gst_rate: 5, tax_kind: 'zero_rated' }).tax_kind === 'zero_rated');
  ok('a merge edit with no rate in it does not touch the kind', (await viaWriter(zero, { name: 'x' })).tax_kind === 'zero_rated');
  ok('a merge edit that sets 0% leaves the kind alone', (await viaWriter(zero, { gst_rate: 0 })).tax_kind === 'zero_rated');
  ok('rateIsNonZero: 0, "0", "", null, undefined, "abc" are not; 5 and "5.5" are', [0, '0', '', null, undefined, 'abc'].every((v) => !K.rateIsNonZero(v)) && K.rateIsNonZero(5) && K.rateIsNonZero('5.5'));

  console.log('\n== the door judges the new rate against the old kind ==\n');
  require('../lib/country').packFor = require(path.join(engines, 'country')).packFor;
  ok('a full-record write that moves the rate to 5 but still names the stored zero-rated kind is refused in words, not waved through as "stored"', /means a rate of 0%, not 5%/.test((await catwrite.kindRefusal('shop-1', { gst_rate: 5, tax_kind: 'zero_rated' }, { gst_rate: 0, tax_kind: 'zero_rated' })) || ''));
  ok('the same kind at the same stored rate still passes (a legacy row stays editable)', (await catwrite.kindRefusal('shop-1', { gst_rate: 0, tax_kind: 'zero_rated' }, { gst_rate: 0, tax_kind: 'zero_rated' })) === null);
  const edit = fs.readFileSync(path.join(__dirname, '..', 'routes', 'products.js'), 'utf8');
  const body = edit.slice(edit.indexOf('async function editProductLocked'), edit.indexOf('router.patch(', edit.indexOf('async function editProductLocked')));
  ok('editProductLocked drops the stale kind BEFORE the door judges and before it declares', body.indexOf('dropStaleKind') > 0 && body.indexOf('dropStaleKind') < body.indexOf('kindRefusal') && body.indexOf('kindRefusal') < body.indexOf('ensureDeclared'));

  console.log('\n   ' + pass + ' checks' + (fail ? ' - ' + fail + ' FAILED' : ''));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
