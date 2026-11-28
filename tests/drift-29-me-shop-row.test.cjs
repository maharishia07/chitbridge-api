/**
 * drift-29-me-shop-row.test.cjs - DRIFT 29 GUARD (28 Nov 2026). The shop's clock, currency, country and GSTIN come from the SHOP's identities row, never the person's
 * (PROOF-2026-11-27 row 29: manager/cashier/view-only got the person's null zone, the web fell back to the browser clock, one chit read 06:43 for the owner and 08:13 for staff).
 * lib/me-shop.shopScoped gives an actor the shop's values (and nothing to an entity); routes/entities.js GET /me must read the parent row through shopRowOf and lay it over the answer.
 * MIN fail-closed: no shop row, an entity, or an unknown column lays nothing over the person row.
 * Run: node tests/drift-29-me-shop-row.test.cjs
 * CARD      settings/shop-clock
 */
'use strict';
const fs = require('fs'), path = require('path');
const { SHOP_SCOPED_COLS, shopScoped } = require('../lib/me-shop');
const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'entities.js'), 'utf8');
const bad = []; let n = 0;
const need = (ok, why) => { n++; if (!ok) bad.push(why); };
for (const k of ['timezone', 'currency_code', 'country', 'gstn']) need(SHOP_SCOPED_COLS.includes(k), 'SHOP_SCOPED_COLS lacks ' + k);
const shop = { capabilities: ['x'], timezone: 'Asia/Dubai', currency_code: 'AED', country: 'AE', gstn: null };
const got = shopScoped(shop, true);
need(got.timezone === 'Asia/Dubai' && got.currency_code === 'AED' && got.country === 'AE' && 'gstn' in got, 'an actor gets the shop zone, currency, country and gstn');
need(!('capabilities' in got), 'only the shop columns are laid over, not capabilities');
need(Object.keys(shopScoped(shop, false)).length === 0, 'an entity row IS the shop: nothing laid over');
need(Object.keys(shopScoped(null, true)).length === 0, 'no shop row: nothing laid over');
need(!/timezone/.test(JSON.stringify(shopScoped({ currency_code: 'AED' }, true))), 'a column the database lacks (b176) is not invented');
need(/await require\('\.\.\/lib\/me-shop'\)\.shopRowOf\(eid, _tzCol\)/.test(src), 'GET /me no longer reads the parent (shop) row through lib/me-shop.shopRowOf');
need(/Object\.assign\(result\.rows\[0\], require\('\.\.\/lib\/me-shop'\)\.shopScoped\(c\.rows\[0\], eid !== req\.identity\.identity_id\)\)/.test(src), 'GET /me no longer lays the shop values over an actor row');
if (bad.length) { for (const b of bad) console.log('   FAIL ' + b); console.log('  ' + n + ' checks'); process.exit(1); }
console.log('   ok   drift 29: /me lays the shop row over the person row for an actor\n  ' + n + ' checks');
