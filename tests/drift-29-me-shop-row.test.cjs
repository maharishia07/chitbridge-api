/**
 * drift-29-me-shop-row.test.cjs - DRIFT 29 GUARD (28 Nov 2026). Offline static guard.
 * The shop's clock, currency, country and GSTIN come from the SHOP's identities row, never the person's: GET /me must read them for an actor from
 * entityOf(req) (the parent) and lay them over the person's own row in the answer. Otherwise a manager, cashier or view-only seat gets the person's
 * null/other zone, the web falls back to the browser's clock and one chit reads 06:43 for the owner and 08:13 for staff (PROOF-2026-11-27 row 29).
 * Fails if routes/entities.js loses: the one list SHOP_SCOPED_COLS, the parent-row read (shopRowOf) that selects it, or the overlay (shopScoped) on the answer.
 * Run: node tests/drift-29-me-shop-row.test.cjs
 * CARD      settings/shop-clock
 */
'use strict';
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'entities.js'), 'utf8');
const bad = [];
const list = (src.match(/const SHOP_SCOPED_COLS = \[([^\]]*)\]/) || [])[1] || '';
for (const k of ['timezone', 'currency_code', 'country', 'gstn']) if (!list.includes("'" + k + "'")) bad.push('SHOP_SCOPED_COLS lacks ' + k);
if (!/SELECT capabilities, \$\{SHOP_SCOPED_COLS/.test(src)) bad.push('shopRowOf no longer selects SHOP_SCOPED_COLS');
if (!/await shopRowOf\(eid, _tzCol\)/.test(src)) bad.push('GET /me no longer reads the parent (shop) row through shopRowOf');
if (!/Object\.assign\(result\.rows\[0\], shopScoped\(c\.rows\[0\], eid !== req\.identity\.identity_id\)\)/.test(src)) bad.push('GET /me no longer lays the shop values over an actor row');
if (!/isActor && shopRow \?/.test(src)) bad.push('shopScoped lost its actor-only rule');
if (bad.length) { for (const b of bad) console.log('   FAIL ' + b); process.exit(1); }
console.log('   PASS drift 29: /me lays the shop row (timezone, currency_code, country, gstn) over the person row for an actor');
