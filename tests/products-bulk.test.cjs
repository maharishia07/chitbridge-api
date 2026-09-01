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
/**
 * ⚠️ SLICE EACH ROUTE ON ITS OWN. A first version sliced from `/bulk` to `GET /` and silently swallowed every
 * route added between them — so "the schema is resolved ONCE" started counting three lookups across three
 * routes and failed for the right reason with the wrong explanation.
 */
function route(name) {
  const start = code.indexOf("router.post('/" + name + "'");
  if (start < 0) return '';
  const next = code.indexOf('\nrouter.', start + 10);
  return code.slice(start, next < 0 ? code.length : next);
}
const bulk = route('bulk');
const statusBulk = route('status/bulk');
const bulkUpdate = route('bulk-update');

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


console.log('\n-- ⭐⭐ availability for the TICKED SET --');
/* "I couldn't set the status of the product available / unavailable by selecting the product(s)." The single
   route existed; there was no way to reach it for more than one product. */
t('the bulk status route exists', statusBulk.length > 0);
/* ⚠️ retired and redundant carry a per-item argument — a bulk form cannot ask that forty times without
   stamping one answer onto rows it was never about. */
t('only available and unavailable are accepted',
  /BULK_STATUS = \['available', 'unavailable'\]/.test(code));
t('  ...and the refusal says where the other two live',
  /retired and redundant need a per-item reason/.test(statusBulk));
/* ⚠️ THE SAME LIBRARY CALL THE SINGLE ROUTE MAKES. A bulk path that re-implements the stamp is how the bulk
   answer and the single answer start disagreeing about what "unavailable" recorded. */
t('it stamps through itemstatus, not a copy', /itemstatus\.stamp\(/.test(statusBulk));
t('one UPDATE covers every id', /item_id = ANY\(\$3::uuid\[\]\)/.test(statusBulk));
t('  ...and it names the ids that did not move', /missed/.test(statusBulk));

console.log('\n-- ⚠️ the loop that made categorising slow --');
/* prodCategoriseApply looped one PATCH per product, sequentially — the round trips Athi actually reported. */
t('the bulk update route exists', bulkUpdate.length > 0);
t('the schema is resolved ONCE', (bulkUpdate.match(/defaultSchemaId/g) || []).length === 1);
t('the currency is resolved ONCE', (bulkUpdate.match(/currencyFor/g) || []).length === 1);
/* ⭐ unnest pairs each id with its OWN new item_data — one statement, not one per row. */
t('one statement pairs each id with its own data', /unnest\(\$1::uuid\[\], \$2::text\[\]\)/.test(bulkUpdate));
t('every item is validated before anything is written',
  bulkUpdate.indexOf('validateItem') < bulkUpdate.indexOf('UPDATE catalogue_items'));
t('  ...and a refusal names the failing ids', /id: items\[i\]\.id/.test(bulkUpdate));

console.log('\n-- ⚠️ and the caller no longer loops --');
const web2 = fs.readFileSync('C:/dev/chitbridge-web/public/app.html', 'utf8');
const webCode2 = web2.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const cat = webCode2.slice(webCode2.indexOf('async function prodCategoriseApply'),
                          webCode2.indexOf('function prodCatgFilter'));
t('categorise sends one request', /prodBulkUpdate/.test(cat));
t('  ...and the per-product prodEdit loop is gone', !/await api\('prodEdit'/.test(cat));
/* ⚠️ ATTACH IS ADDITIVE and removal is explicit — a bulk action that REPLACED the set would silently strip
   memberships that were never on screen. Matched loosely on whitespace: an assertion that also pins the
   formatting fails on a reformat and teaches everyone to distrust it. */
t('  ...attach is still additive, removal still explicit',
  /cur\.indexOf\(c\)\s*<\s*0/.test(cat) && /!B\.remove\.has\(c\)/.test(cat));
t('availability is offered on the same ticked bar', /data-testid="cat-availability"/.test(web2));


console.log('\n-- ⭐⭐ an unavailable product is not shown AND cannot be ordered --');
/* Athi, 2026-09-01: "if stock unavailable is set, then it should not appear at all for the customer to select.
   It is a temp retirement."

   ⚠️⚠️ THESE THREE ASSERTIONS PASSED WHILE THE FEATURE WAS BROKEN, and that is worth more than the fix.
   They checked that the gate CALLS `isMatchable` — and `MATCHABLE` deliberately includes `unavailable`, so the
   storefront went on listing out-of-stock products and the tests went on agreeing. A test that pins the NAME OF
   THE FUNCTION CALLED cannot tell you the function was the wrong one; it just freezes the author's belief.
   Written against `isOfferable` now, and the behavioural half lives in tests/offerable.test.cjs, which asserts
   what the two predicates ANSWER rather than which one appears in the source. */
const view = fs.readFileSync(API + '/lib/catalogue-view.js', 'utf8');
const viewCode = view.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
t('the storefront filters its own items by availability', /itemstatus\.isOfferable/.test(viewCode));
t('  ...and NOT by isMatchable, which keeps unavailable on purpose', !/itemstatus\.isMatchable/.test(viewCode));
/* ⚠️ HIDDEN AND COUNTED, the same shape as unpriced_hidden — "where did my items go" needs an answer on the
   screen that caused it. */
t('  ...and the owner is told how many are hidden', /unavailable_hidden/.test(viewCode));
t('  ...named apart from unpriced_hidden', /unpriced_hidden/.test(viewCode)
  && viewCode.indexOf('unavailable_hidden') !== viewCode.indexOf('unpriced_hidden'));
/* ⭐ The opt-in: a counted zero may hide, for a business that keeps counts. Off by default, and it HIDES rather
   than stamping a status — so the product returns the instant the count does. */
t('  ...and a counted zero can hide too, when the owner asks', /qty_zero_hidden/.test(viewCode)
  && /countedZero/.test(viewCode));

const catr = fs.readFileSync(API + '/routes/catalogue.js', 'utf8');
const catrCode = catr.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const reprice = catrCode.slice(catrCode.indexOf('async function repriceAgainstCatalogue'),
                               catrCode.indexOf('async function repriceAgainstCatalogue') + 2500);
/* ⚠️ HIDING IT FROM THE LIST IS NOT ENOUGH — this path prices by item_id or by name, and both are reachable
   from an open tab, a bookmark or a repeat order. */
t('the order path skips an unavailable item', /isOfferable\(d\)/.test(reprice));
t('  ...so it never enters the price maps', /if \(!itemstatus\.isOfferable\(d\)\) continue;/.test(reprice));

/* ⚠️ AND THE MATCHER KEEPS isMatchable. Its behaviour is correct and load-bearing: an out-of-stock tomato named
   in a message must still resolve, or the request comes back "no catalogue match" — indistinguishable from a
   product nobody sells — and silently loses the line. Two questions, two predicates. */
const matchers = (fs.readFileSync(API + '/lib/itemmatch.js', 'utf8').match(/isMatchable/g) || []).length;
t('the message matcher still honours it too', matchers > 0);

console.log('\n  == ' + pass + ' passed - ' + fail + ' failed ==\n');
process.exitCode = fail ? 1 : 0;
