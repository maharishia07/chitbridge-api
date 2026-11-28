/**
 * drift-35b-party-phone.test.cjs - DRIFT 35b GUARD (28 Nov 2026). The phone a party shows is ONE rule, lib/party-phone.phoneOf(row): its published phone, else, for a party THIS shop
 * minted, the number the shop typed (otp_contact); never a registered business's sign-in phone. The CRM party list and the customer list both read it (PROOF-2026-11-27 row 35b).
 * Fails if the rule changes, or lib/crm.js / routes/relationships.js spell it out again or stop calling it.
 * MIN fail-closed: a registered business gives no phone at all (never its sign-in phone).
 * Run: node tests/drift-35b-party-phone.test.cjs
 * CARD      crm/party-contact
 */
'use strict';
const fs = require('fs'), path = require('path');
const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const bad = []; let n = 0;
const { phoneOf } = require('../lib/party-phone');
const eq = (got, want, why) => { n++; if (got !== want) bad.push(why + ' (got ' + got + ')'); };
eq(phoneOf({ phone: null, otp_contact: '0501234567', user_id: '~walkin.shop' }), '0501234567', 'minted party: the number the shop typed');
eq(phoneOf({ phone: '0509999999', otp_contact: '0501234567', user_id: '~walkin.shop' }), '0509999999', 'published phone wins');
eq(phoneOf({ phone: null, otp_contact: '0501234567', user_id: 'real.business' }), null, 'registered business: its sign-in phone is never a contact');
const need = (ok, why) => { n++; if (!ok) bad.push(why); };
need(/phone: require\('\.\/party-phone'\)\.phoneOf\(row\)/.test(R('lib/crm.js')), 'lib/crm.js no longer reads party-phone.phoneOf');
need(!/row\.otp_contact/.test(R('lib/crm.js')), 'lib/crm.js spells the phone rule itself (row.otp_contact)');
need(/item\.phone = require\('\.\.\/lib\/party-phone'\)\.phoneOf\(item\)/.test(R('routes/relationships.js')), 'GET /customers no longer fills phone from party-phone.phoneOf');
if (bad.length) { for (const b of bad) console.log('   FAIL ' + b); console.log('  ' + n + ' checks'); process.exit(1); }
console.log('   ok   drift 35b: one phone rule (lib/party-phone) on the CRM list and the customer list\n  ' + n + ' checks');
