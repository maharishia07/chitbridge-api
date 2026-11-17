/**
 * tests/rail-msg-type.test.cjs — A MESSAGE KIND THE TABLE WOULD REFUSE IS REFUSED AT THE DOOR (RAIL, batch F gate 14 Nov).
 *
 * OWNS      the rule that POST /:chit_id/messages answers 400 "Pick a message type" for a msg_type outside chk_chit_messages_msg_type, before any write
 * CALLED BY scripts/guards.cjs (offline, no DB)
 * FLOW      the route's body schema (lib/chits-contract + chits-input) → each kind in the one list passes · left out / empty / null pass (info) · any other word is refused with the words
 *           · the list in lib/message-limit.js equals the list the CHECK holds in the baseline migration (read from the file, so a changed CHECK reds this)
 * CARD      docs/01-rail-core-the-chit/functions/thread-messages-on-a-chit.md
 */
'use strict';
const fs = require('fs');
const path = require('path');
const API = path.join(__dirname, '..');
const { bodyEngine, bodySchemaOf, errorsOf } = require(path.join(API, 'middleware', 'validate'));
const contract = require(path.join(API, 'lib', 'chits-contract.js'));
const input = require(path.join(API, 'lib', 'chits-input.js'));
const { MSG_TYPES } = require(path.join(API, 'lib', 'message-limit.js'));

let failed = 0;
const ok = (cond, label) => { console.log((cond ? '  ok   ' : '  FAIL ') + label); if (!cond) failed++; };

const ROUTE = 'POST /:chit_id/messages';
const check = compile => body => errorsOf(compile, body);
const compiled = bodyEngine.compile(bodySchemaOf(contract.operationFor(ROUTE)));
const run = check(compiled);
const base = { message_text: 'Hello', thread_type: 'external' };
const withType = (msg_type) => run(Object.assign({}, base, { msg_type }));

console.log('\n-- the list is the one the database holds --');
const sql = fs.readFileSync(path.join(API, 'migrations', '000_baseline_2026-10-21.sql'), 'utf8');
const line = sql.split('\n').find((l) => l.includes('CONSTRAINT chk_chit_messages_msg_type'));
const held = (line.match(/'([a-z_]+)'::character varying/g) || []).map((w) => w.slice(1, w.indexOf("'", 1)));
ok(held.length === 8 && JSON.stringify(held) === JSON.stringify(MSG_TYPES), 'MSG_TYPES equals the CHECK list in the baseline (' + MSG_TYPES.join(', ') + ')');

console.log('\n-- a kind in the list passes --');
MSG_TYPES.forEach((kind) => ok(withType(kind).length === 0, kind + ' is accepted'));
ok(run(base).length === 0, 'left out is accepted (posts as info)');
ok(withType('').length === 0, 'empty is accepted');
ok(withType(null).length === 0, 'null is accepted');

console.log('\n-- any other word is refused with the words --');
['Info', ' info', 'info ', 'note', 'cancel_request', 'x'.repeat(17), 'info;drop'].forEach((bad) => {
  const failures = withType(bad);
  const details = failures.length ? input.invalidChit(failures, ROUTE).details : [];
  ok(details.length === 1 && details[0].field === 'msg_type' && details[0].message === 'Pick a message type', JSON.stringify(bad).slice(0, 24) + ' is refused: ' + (details[0] ? details[0].message : 'passed'));
});
ok(withType(7).length > 0 && withType(true).length > 0, 'a number and a boolean are refused');

console.log(failed ? '\nFAILED: ' + failed : '\nall ok');
process.exit(failed ? 1 : 0);
