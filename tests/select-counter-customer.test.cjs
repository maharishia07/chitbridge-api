'use strict';
/**
 * select-counter-customer.test.cjs — WX-O2C (2026-10-13): a counter bill's copy names its CUSTOMER, not the shop.
 * A counter bill is addressed to the shop itself (sender = recipient = holder); the customer lives in business_json.customer. Found on the
 * real stack: Unpaid bills › Issued named all 379 open credit bills "Simulated Stores". Offline: reads lib/select.js's SQL.
 * (Proved against the loader's database in the round: Ravi Stores · DHEF/26-27/0001.) R124 (2026-10-24) lifted the self-addressed test into
 * SELF_ADDRESSED_SQL and the uuid guard into UUID_SQL, and added the received side (tests/select-received-party.test.cjs).
 * Run: node tests/select-counter-customer.test.cjs
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };
const sql = fs.readFileSync(path.join(__dirname, '..', 'lib', 'select.js'), 'utf8');
ok(/const SELF_ADDRESSED_SQL = `ch\.sender_entity_id = cs\.entity_id AND ch\.all_recipients->1->>'entity_id' = cs\.entity_id::text`/.test(sql), 'self-addressed = sender is the holder AND the first receiver is the holder');
const nameCase = /CASE WHEN \$\{SELF_ADDRESSED_SQL\}\s+AND COALESCE\(ch\.business_json->'customer'->>'name', ''\) <> ''\s+THEN ch\.business_json->'customer'->>'name'[\s\S]*?WHEN cs\.direction = 'received' THEN ch\.sender_entity_display_name/.test(sql);
ok(nameCase, 'counterparty_name: a self-addressed copy with a customer names the customer — FIRST, before the received branch');
ok(/CASE WHEN \$\{SELF_ADDRESSED_SQL\}\s+AND ch\.business_json->'customer'->>'identity_id' ~\* \$\{UUID_SQL\}\s+THEN \(ch\.business_json->'customer'->>'identity_id'\)::uuid/.test(sql), 'counterparty_id: the customer\'s identity, first');
ok(/const UUID_SQL = `'\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}\$'`/.test(sql), 'the id is cast only when it IS a uuid (a typed name never 500s the list)');
console.log(n + ' checks passed');
