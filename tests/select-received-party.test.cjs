'use strict';
/**
 * select-received-party.test.cjs — R124 (2026-10-24): a paper bill RECEIVED at the counter names its SUPPLIER and THEIR bill number.
 * Such a copy is self-addressed (sender = recipient = holder) like a counter sale; the supplier lives in business_json.party and their number in
 * business_json.their_bill.no. Found on the real stack: Unpaid bills › Received (BKS011) named both of Sri Ganesh Provisions' bills "kaveri-tiffins"
 * (the shop itself) with BILL NO "—"; the pay sheet (R123) showed the chit id instead of SG-1022. Offline: reads lib/select.js's SQL and the one
 * lifted helper (folder-inventory.theirNoSql). The T2 on real Postgres is tests/bills-truth.realstack.cjs. Run: node tests/select-received-party.test.cjs
 * CARD 16-finance/payables
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };
const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'lib', f), 'utf8');
const sel = src('select.js'), store = src('books-store.js');
const INV = require('../lib/folder-inventory');

/* the ONE helper, and its text */
ok(INV.theirNoSql('h') === "NULLIF(btrim(h.business_json->'their_bill'->>'no'), '')", 'theirNoSql(h): their number, blank = NULL');
ok(INV.docSql('ch', 'cs').includes(INV.theirNoSql('ch') + ' IS NOT NULL'), 'docSql\'s their_bill term reads the same helper');
ok(!/'their_bill'->>'no'/.test(sel) && !/'their_bill'->>'no'/.test(store), 'select.js and books-store.js spell their number through the helper only (no second spelling)');

/* counterparty_name: customer (issued side) → party (received paper bill) → the header */
const nameArms = /THEN ch\.business_json->'customer'->>'name'[\s\S]*?WHEN \$\{SELF_ADDRESSED_SQL\}\s+AND COALESCE\(ch\.business_json->'party'->>'name', ''\) <> ''\s+THEN ch\.business_json->'party'->>'name'\s+WHEN cs\.direction = 'received' THEN ch\.sender_entity_display_name/;
ok(nameArms.test(sel), 'counterparty_name: a self-addressed copy with a party names the party — after the customer arm, BEFORE the received branch');

/* counterparty_id: the same arm, cast only when party_id IS a uuid (the filter counterparty_ids and the scorecard read this expression) */
const idArms = /THEN \(ch\.business_json->'customer'->>'identity_id'\)::uuid\s+WHEN \$\{SELF_ADDRESSED_SQL\}\s+AND ch\.business_json->'party'->>'party_id' ~\* \$\{UUID_SQL\}\s+THEN \(ch\.business_json->'party'->>'party_id'\)::uuid\s+WHEN cs\.direction = 'received' THEN ch\.sender_entity_id/;
ok(idArms.test(sel), 'counterparty_id: the party\'s id, uuid-guarded, before the received branch');
ok(/const UUID_SQL = `'\^\[0-9a-f\]\{8\}-/.test(sel), 'the uuid guard is one named constant');

/* bill_no: mine first (nothing issued changes), else theirs; never the frozen invoice */
ok(/COALESCE\(ch\.business_json->>'bill_no', \$\{INV\.theirNoSql\('ch'\)\}\) AS bill_no/.test(sel), 'bill_no = COALESCE(bill_no, their number)');
ok(!/'invoice'->>'no'/.test(sel) && !/'invoice'->>'no'/.test(store), 'business_json.invoice (the frozen tax invoice) is never read as a number');

/* R123: the pay sheet's numbers come from billNos — printed_as → bill_no → their number */
ok(/COALESCE\(h\.business_json->>'printed_as', h\.business_json->>'bill_no', \$\{require\('\.\/folder-inventory'\)\.theirNoSql\('h'\)\}\) AS no/.test(store), 'billNos: printed_as, bill_no, then their number (the pay sheet names SG-1022, not a chit id)');
console.log(n + ' checks passed');
