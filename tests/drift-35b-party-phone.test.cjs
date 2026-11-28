/**
 * drift-35b-party-phone.test.cjs - DRIFT 35b GUARD (28 Nov 2026). The phone a party shows is ONE rule, party-fields.phoneOf(row): its published phone, else, for a
 * party THIS shop minted, the number the shop typed (otp_contact). The CRM party list and the customer list both read it. Fails if
 *   1. phoneOf stops giving a minted party's typed number / starts giving a registered business's sign-in phone,
 *   2. lib/crm.js or routes/relationships.js spells the rule out again (row.otp_contact outside phoneOf), or the customer list stops filling item.phone.
 * Run: node tests/drift-35b-party-phone.test.cjs
 * CARD      crm/party-contact
 */
'use strict';
const fs = require('fs'), path = require('path');
const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const bad = [];
const { phoneOf } = require('../lib/party-fields');
const eq = (got, want, why) => { if (got !== want) bad.push(why + ' (got ' + got + ')'); };
eq(phoneOf({ phone: null, otp_contact: '0501234567', user_id: '~walkin.shop' }), '0501234567', 'minted party: the number the shop typed');
eq(phoneOf({ phone: '0509999999', otp_contact: '0501234567', user_id: '~walkin.shop' }), '0509999999', 'published phone wins');
eq(phoneOf({ phone: null, otp_contact: '0501234567', user_id: 'real.business' }), null, 'registered business: its sign-in phone is never a contact');
if (!/phone: require\('\.\/party-fields'\)\.phoneOf\(row\)/.test(R('lib/crm.js'))) bad.push('lib/crm.js no longer reads party-fields.phoneOf');
if (/row\.otp_contact/.test(R('lib/crm.js'))) bad.push('lib/crm.js spells the phone rule itself (row.otp_contact)');
if (!/item\.phone = partyFields\.phoneOf\(item\)/.test(R('routes/relationships.js'))) bad.push('GET /customers no longer fills phone from party-fields.phoneOf');
if (bad.length) { for (const b of bad) console.log('   FAIL ' + b); process.exit(1); }
console.log('   PASS drift 35b: one phone rule (party-fields.phoneOf) on the CRM list and the customer list');
