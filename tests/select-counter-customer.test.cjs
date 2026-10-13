'use strict';
/**
 * select-counter-customer.test.cjs — WX-O2C (2026-10-13): a counter bill's copy names its CUSTOMER, not the shop.
 * A counter bill is addressed to the shop itself (sender = recipient = holder); the customer lives in business_json.customer. Found on the
 * real stack: Unpaid bills › Issued named all 379 open credit bills "Simulated Stores". Offline: reads lib/select.js's SQL.
 * (Proved against the loader's database in the round: Ravi Stores · DHEF/26-27/0001.) Run: node tests/select-counter-customer.test.cjs
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };
const sql = fs.readFileSync(path.join(__dirname, '..', 'lib', 'select.js'), 'utf8');
const nameCase = /CASE WHEN ch\.sender_entity_id = cs\.entity_id AND ch\.all_recipients->1->>'entity_id' = cs\.entity_id::text\s+AND COALESCE\(ch\.business_json->'customer'->>'name', ''\) <> ''\s+THEN ch\.business_json->'customer'->>'name'\s+WHEN cs\.direction = 'received' THEN ch\.sender_entity_display_name/.test(sql);
ok(nameCase, 'counterparty_name: a self-addressed copy with a customer names the customer — FIRST, before the received branch');
ok(/THEN \(ch\.business_json->'customer'->>'identity_id'\)::uuid\s+WHEN cs\.direction = 'received' THEN ch\.sender_entity_id/.test(sql), 'counterparty_id: the customer\'s identity, first');
ok(/'customer'->>'identity_id' ~\* '\^\[0-9a-f\]\{8\}/.test(sql), 'the id is cast only when it IS a uuid (a typed name never 500s the list)');
console.log(n + ' checks passed');
