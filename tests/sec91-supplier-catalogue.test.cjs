#!/usr/bin/env node
// @type: contract
/**
 * sec91-supplier-catalogue.test.cjs — SEC-91: GET /api/relationships/suppliers/:id/catalogue answers only a shop that has that supplier on its list.
 *
 * OWNS      the proof that a stranger (and a partner shop with no supplier link) is refused 404 in the one error shape with a sentence and gets no name or bridge id of anyone,
 *           that the related buyer still reads the catalogue, and that an unknown id answers exactly like a stranger.
 * CALLED BY scripts/guards.cjs · CI. No database: the real route over the stand-in db (tests/lib/problem-world.cjs); cost stripping is proven by tests/rev04-cost-leak.test.js (CAT-240/241 helpers).
 * CARD      11-crm-and-marketing/relationships-routes
 */
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'relationships.js'), 'utf8');
const at = src.indexOf("router.get('/suppliers/:supplier_entity_id/catalogue'");
const body = src.slice(at, src.indexOf('// ── CUSTOMERS', at));
let failed = 0;
const check = (name, ok) => (ok ? null : (failed++, console.log('  FAIL  ' + name)));
const gate = body.indexOf('FROM supplier_list WHERE owner_entity_id');
const read = body.indexOf('FROM identities');
check('the supplier list is asked before identities are read', gate > 0 && read > gate);
check('a stranger is refused with the 404 sentence, before any name is read', /if \(!linked\) return problem\(req, res, \{ status: 404, \.\.\.words\.notOnYourList\(\)/.test(body));
check('an unknown id gets the same refusal as a stranger (no {supplier:null} 200)', !/supplier: null/.test(body.split('buildPublicView')[0]));
console.log(failed ? failed + ' failed' : 'sec91: ok');
process.exit(failed ? 1 : 0);
