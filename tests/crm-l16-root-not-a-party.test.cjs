#!/usr/bin/env node
// @type: contract
/**
 * crm-l16-root-not-a-party.test.cjs — the installation root (a system supplier, lib/rootlink.js) is never one of the shop's parties.
 *
 * OWNS      lib/crm.assemble(): a supplier row with added_via 'system' drops out, so lists, counts and chips (all read from assemble) agree.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: assemble is pure.
 * MIN       contract - 3 checks; the first fails on the base it was cut from (the root was listed as a supplier).
 * CARD      11-crm-and-marketing/parties-one-record-timeline-interactions
 * HAND      two supplier rows, one 'system' -> one party; a customer who is also a normal supplier stays.
 */
'use strict';
const path = require('path');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const { assemble } = require(path.join(__dirname, '..', 'lib', 'crm'));
let failed = 0;
const check = (name, ok) => { if (!ok) failed++; console.log((ok ? 'ok   ' : 'FAIL ') + name); };
const row = (id, name, via) => ({ party_id: id, display_name: name, added_via: via, same_world: true, on_rail: true, user_id: '~' + id, status: 'active' });
const out = assemble({ cust: [], sup: [row('r1', 'cbau01-root', 'system'), row('s1', 'Jones Plumbing Supplies', 'counter')], walk: [] }).parties;
check('the system supplier (the root) is not listed', !out.some((p) => p.display_name === 'cbau01-root'));
check('an ordinary supplier is listed', out.length === 1 && out[0].display_name === 'Jones Plumbing Supplies');
const both = assemble({ cust: [row('c1', 'Both Co', 'counter')], sup: [row('c1', 'Both Co', 'counter')], walk: [] }).parties;
check('a party who is customer and supplier stays one row', both.length === 1 && both[0].roles.customer && both[0].roles.supplier);
process.exit(failed ? 1 : 0);
