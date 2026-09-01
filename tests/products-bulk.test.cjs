/**
 * tests/products-bulk.test.cjs — many products, one round trip.
 *
 * ⚠️⚠️ THE DEFECT THIS REPLACES: the catalogue wizard posted `POST /api/products` once per item, STRICTLY
 * SEQUENTIALLY, and each request paid for its own schema lookup, currency lookup, BEGIN, set_config, INSERT and
 * COMMIT. At the measured ~500 ms floor for an authed round trip, forty items was twenty seconds — which is
 * exactly what Athi reported on 2026-09-01.
 */
const API = 'C:/dev/chitbridge-api';
const fs = require('fs');

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.error('  ✗ ' + name + (extra ? '   ' + extra : '')); }
};

const src = fs.readFileSync(API + '/routes/products.js', 'utf8');
/* Read the CODE, not the prose — a source assertion that matches a comment proves nothing. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const bulk = code.slice(code.indexOf("router.post('/bulk'"), code.indexOf("router.get('/', auth"));

console.log('\n-- ⭐⭐ the whole set in ONE transaction --');
t('the bulk route exists', bulk.length > 0);
/* ⭐ The point of the route: these two are the same for every item, and were being re-resolved per request. */
t('the schema is resolved ONCE', (bulk.match(/defaultSchemaId/g) || []).length === 1);
t('the currency is resolved ONCE', (bulk.match(/currencyFor/g) || []).length === 1);
/* ⭐ One INSERT for the lot, not one per item — unnest, the same shape query-shape.test.js enforces elsewhere. */
t('one INSERT covers every item', /unnest\(\$3::jsonb\[\]\)/.test(bulk));
t('  ...and there is no per-item insert loop',
  !/for\s*\([^)]*\)\s*\{[\s\S]{0,300}INSERT INTO catalogue_items/.test(bulk));

console.log('\n-- ⚠️ nothing half-written --');
/* The sequential version skipped a failing item and carried on, so a typo in item 30 left 29 created and no
   record of what went missing. */
t('every item is validated before anything is written',
  bulk.indexOf('validateItem') < bulk.indexOf('INSERT INTO catalogue_items'));
t('  ...and a refusal names the failing indexes', /invalid: bad/.test(bulk) && /index: i/.test(bulk));
t('  ...and writes nothing when any is bad',
  /if \(bad\.length\)[\s\S]{0,200}return res\.status\(400\)/.test(bulk));

console.log('\n-- ⚠️ the guards a write route needs --');
t('it is authed', /router\.post\('\/bulk', auth/.test(bulk));
t('the payload must be a non-empty array', /body\('items'\)\.isArray\(\{ min: 1 \}\)/.test(bulk));
t('a request is capped', /BULK_MAX/.test(bulk) && /Too many/.test(bulk));
/* ⚠️ An array member that is an array still passes isArray on the parent — jsonb would take it and the schema
   would not. */
t('every member must be an object', /typeof it === 'object' && !Array\.isArray\(it\)/.test(bulk));
/* ⚠️ RLS: catalogue_items is a tenant table, so the insert must run inside withEntity. */
t('the insert runs inside withEntity', /withEntity\(entity_id/.test(bulk));

console.log('\n-- ⚠️ route ORDER, which Express decides and nothing else checks --');
/* `bulk` is a perfectly good :id. Declared after /:id, every call would be read as a product by that name. */
const iBulk = code.indexOf("router.post('/bulk'");
const iParam = code.indexOf("router.patch('/:id'");
t('/bulk is declared before /:id', iBulk > 0 && iParam > 0 && iBulk < iParam);

console.log('\n-- ⚠️ and the caller no longer loops --');
const web = fs.readFileSync('C:/dev/chitbridge-web/public/app/cap-catalogue.js', 'utf8');
const webCode = web.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const persist = webCode.slice(webCode.indexOf('var persistProducts'), webCode.indexOf('var isValue'));
t('the wizard sends one request', /prodAddMany/.test(persist));
t('  ...and the sequential step() loop is gone', !/step\(\);/.test(persist));
t('  ...and a refusal reports which item', /inv\[0\]\.index/.test(persist));

console.log('\n  == ' + pass + ' passed - ' + fail + ' failed ==\n');
process.exitCode = fail ? 1 : 0;
