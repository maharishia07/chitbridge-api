/**
 * tests/catalogue-enquiry-msg-type.test.cjs — A MESSAGE KIND THE TABLE WOULD REFUSE IS REFUSED AT THE ENQUIRY DOOR TOO (CATALOGUE, batch G 14 Nov).
 *
 * OWNS      the rule that POST /api/catalogue/enquiry/:item_id answers 400 "Pick a message type" for a msg_type outside message-limit MSG_TYPES, before any write
 * CALLED BY scripts/guards.cjs (offline, no DB); stacks on rail-msg-type.test.cjs (the rail door, api #1304)
 * FLOW      the route's operation (lib/catalogue-contract) → each kind of the one list passes · left out / empty / null pass (info) · any other word is refused with the words
 *           · the contract holds no list of its own: its pattern is built from message-limit MSG_TYPES
 * CARD      storefront-and-catalogue/products-routes
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
const { bodyEngine, bodySchemaOf, errorsOf } = require(path.join(API, 'middleware', 'validate'));
const contract = require(path.join(API, 'lib', 'catalogue-contract.js'));
const { MSG_TYPES } = require(path.join(API, 'lib', 'message-limit.js'));

let failed = 0;
let checks = 0;
const ok = (cond, label) => { checks++; console.log((cond ? '  ok   ' : '  FAIL ') + label); if (!cond) failed++; };

const ROUTE = 'POST /enquiry/:item_id';
const options = contract.schemaOptionsFor(ROUTE);
const compiled = bodyEngine.compile(bodySchemaOf(contract.catalogue.operationFor(ROUTE)));
const base = { message_text: 'Is this in stock?', thread_type: 'external' };

/** the body through the route's own schema and the old 400 words: { refused, details } */
function ask(body) {
  const failures = errorsOf(compiled, body);
  return { refused: failures.length > 0, details: failures.length ? options.legacy(failures).details : [] };
}
const withType = (msg_type) => ask(Object.assign({}, base, { msg_type }));

(() => {
  console.log('\n-- the contract holds no second list --');
  const pattern = contract.catalogue.operationFor(ROUTE).requestBody.content['application/json'].schema.properties.msg_type.pattern;
  ok(MSG_TYPES.length === 8 && pattern === '^(?:' + MSG_TYPES.join('|') + ')?$', 'the enquiry pattern is built from MSG_TYPES: ' + pattern);

  console.log('\n-- a kind in the list passes --');
  for (const kind of MSG_TYPES) ok((withType(kind)).refused === false, kind + ' is accepted');
  ok((ask(base)).refused === false, 'left out is accepted (posts as info)');
  ok((withType('')).refused === false, 'empty is accepted');
  ok((withType(null)).refused === false, 'null is accepted');

  console.log('\n-- any other word is a 400 with the words --');
  for (const bad of ['Info', ' info', 'note', 'cancel_request', 'x'.repeat(17), 'info;drop', 7, true]) {
    const out = withType(bad);
    const detail = out.details.find((d) => d.field === 'msg_type');
    ok(out.refused && out.details.length === 1 && !!detail && detail.message === 'Pick a message type', JSON.stringify(bad).slice(0, 24) + ' is refused: ' + (detail ? detail.message : 'passed'));
  }

  console.log('\n' + checks + ' checks' + (failed ? '\nFAILED: ' + failed : '\nall ok'));
  process.exit(failed ? 1 : 0);
})();
