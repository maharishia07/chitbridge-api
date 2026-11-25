'use strict';
/* WALK I I-F-07 (21 Nov 2026): a counter bill that names its customer (business_json.customer.name, no rail entity) puts that customer on the ONE party list
   (customer_list, through lib/local-identity.addCustomer — the one way a local customer is made), best-effort after the commit; the CRM said "customers appear when
   you bill them" and showed none. Source guard (the DB-backed run is the SIT walk: bill "Acme Trading LLC" -> GET /api/crm/parties count 1).
   Run: node tests/walki-named-customer-party.test.cjs */
const fs = require('fs'), assert = require('assert');
const src = require('../tools/chits-files.cjs').read(require('path').join(__dirname, '..'));
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };
ok(/async function addNamedCounterCustomer\(owner, business\)/.test(src), 'the named-customer hook exists');
ok(/if \(!is_draft\) await addNamedCounterCustomer\(sender_id, sendState\.business_json\)/.test(src), 'sendCustomers (after the commit) calls it for a sent chit');
ok(/li\.addCustomer\(db, owner, person\)/.test(src), 'it uses local-identity.addCustomer, the one way to make a local customer');
ok(src.includes("!cust.entity_id && name && name !== 'Customer' && require('./bill-paper').buyerNamed({ name })") && src.includes("namesLocalPerson(cust, name) && !require('./crm').namedParty(business) ? cust : null"), 'a rail customer, an unnamed or Walk-in bill, or a party the bill already names (counted once by crm.traded) adds nothing here');
ok(/cbLog\.fellBack\('chits send: the named customer/.test(src), 'a failure is logged, never raised');
console.log(n + ' passed');
