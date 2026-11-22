/**
 * tests/products-supply-kind.test.cjs - THE PRODUCT DOORS CHECK `tax_kind` AS THE SLAB AND ITEM WRITES DO (AE-F-11; the rest of the handover item 4).
 *
 * OWNS      the proof that routes/products.js POST / and PATCH /:id answer a `tax_kind` the shop pack does not hold (or beside a rate it does not mean) with the SAME sentence as the slab door and
 *           the item write (lib/catalogue-write.kindRefusal -> lib/supply-kind.kindWordsFor), and that a product with no kind costs no extra read (no default: a blank kind is nothing to judge).
 * CALLED BY scripts/guards.cjs - CI. No server, no database: the shop's country read is a stand-in. Needs the engines' packs (CB_ENGINES_DIR; without it the test SKIPs, said).
 * Hand figures: none (no money moves). Run: CB_ENGINES_DIR=../chitbridge-engines node tests/products-supply-kind.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const engines = process.env.CB_ENGINES_DIR ? path.join(path.resolve(process.env.CB_ENGINES_DIR), 'src') : path.join(__dirname, '..', '..', 'chitbridge-engines', 'src');
if (!fs.existsSync(path.join(engines, 'tax-slab.js'))) { console.log('skip: no engines checkout (set CB_ENGINES_DIR)'); process.exit(0); }
const COUNTRY = require('../lib/country');
COUNTRY.packFor = require(path.join(engines, 'country')).packFor; /* the engines' packs stand in for the adopted copy until the engines tag is adopted */
const db = require('../db');
let reads = 0, country = 'AE';
db.query = async () => { reads++; return { rows: [{ country, gstn: null }] }; };
const catwrite = require('../lib/catalogue-write');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

(async () => {
  console.log('\n== the product doors: tax_kind is judged by the shop pack ==\n');
  const SHOP = 'shop-1';
  ok('a product with no kind (absent, null, blank) costs no read and is not refused: there is NO default', await (async () => {
    const before = reads;
    const answers = [await catwrite.kindRefusal(SHOP, { name: 'Tea', gst_rate: 0 }), await catwrite.kindRefusal(SHOP, { tax_kind: null }), await catwrite.kindRefusal(SHOP, { tax_kind: '  ' }), await catwrite.kindRefusal(SHOP, undefined)];
    return answers.every((answer) => answer === null) && reads === before;
  })());
  ok('AE zero_rated beside 0% is kept', (await catwrite.kindRefusal(SHOP, { tax_kind: 'zero_rated', gst_rate: 0 })) === null);
  const wrongWord = await catwrite.kindRefusal(SHOP, { tax_kind: 'gst_free', gst_rate: 0 });
  ok('an AU word on a UAE shop is refused in words naming the kinds the pack holds', /not a supply kind your tax rules know/.test(wrongWord || '') && /standard, zero_rated, exempt/.test(wrongWord || ''), String(wrongWord));
  ok('zero-rated beside 5% is refused: the kind means 0%', /means a rate of 0%, not 5%/.test((await catwrite.kindRefusal(SHOP, { tax_kind: 'zero_rated', gst_rate: 5 })) || ''));
  ok('a kind already stored passes unchanged (a legacy row stays editable): PATCH hands the stored record', (await catwrite.kindRefusal(SHOP, { tax_kind: 'gst_free', gst_rate: 0 }, { tax_kind: 'gst_free' })) === null);
  country = 'IN';
  ok('India (pack 1.1.0): exempt beside 0% is kept; zero_rated is not an India kind', (await catwrite.kindRefusal(SHOP, { tax_kind: 'exempt', gst_rate: 0 })) === null && /not a supply kind your tax rules know/.test((await catwrite.kindRefusal(SHOP, { tax_kind: 'zero_rated', gst_rate: 0 })) || ''));

  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'products.js'), 'utf8');
  const post = src.slice(src.indexOf("router.post('/', auth"), src.indexOf("router.post('/bulk'"));
  const edit = src.slice(src.indexOf('async function editProductLocked'), src.indexOf('router.patch(', src.indexOf('async function editProductLocked')));
  ok('POST / calls the check before it mints, and answers 400 in the declined shape', /catwrite\.kindRefusal\(entity_id, req\.body\.item_data\)/.test(post) && post.indexOf('kindRefusal') < post.indexOf('mintProduct') && /status: 400, \.\.\.words\.declined/.test(post));
  ok('PATCH /:id (editProductLocked) calls it with the stored record before it declares, and answers 400', /catwrite\.kindRefusal\(entity_id, read\.bodyItem, read\.stored\)/.test(edit) && edit.indexOf('kindRefusal') < edit.indexOf('ensureDeclared') && /status: 400, \.\.\.words\.declined/.test(edit));

  console.log('\n   ' + pass + ' checks' + (fail ? ' - ' + fail + ' FAILED' : ''));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
