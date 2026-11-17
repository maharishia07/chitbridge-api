'use strict';
/*
 * ctp-query-answer-keys.test.cjs — API-7 (S34): the answer to a signed CTP question names its keys.
 *
 * OWNS      the pin on lib/ctp-contract.js QUERY_ANSWER_KEYS: the exact top-level keys, one sample per question (resolve · catalogue · search · attachment · certificate · directory · locate · registry_changes),
 *           and the proof that a column no handler names is dropped while every key a peer installation reads stays.
 * CALLED BY the offline gate (scripts/guards.cjs lists tests/*.test.cjs); runs alone: node tests/ctp-query-answer-keys.test.cjs
 * FLOW      QUERY_OPERATION 200 schema -> prune(schema, sample) -> dropped [] for each sample, ['planted'] for a sample with one extra key
 * CARD      28-platform-and-operations/api-standard
 */
const path = require('path');
const { prune } = require(path.join(__dirname, '..', 'lib', 'output-allowlist.js'));
const contract = require(path.join(__dirname, '..', 'lib', 'ctp-contract.js'));
let failed = 0;
const check = (label, ok, info) => { if (!ok) failed++; console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + (ok || info === undefined ? '' : '\n        ' + JSON.stringify(info).slice(0, 400))); };

const PINNED = ['address', 'catalogue_summary', 'categories', 'changes', 'data_base64', 'directory', 'display_name', 'entities', 'fields', 'finishes', 'found', 'groups', 'hints', 'installation_key', 'items', 'last_seq', 'lines', 'membership', 'mime', 'name', 'offers', 'ok', 'results', 'schema', 'searched', 'sealed', 'sells_outside', 'sha256', 'shop', 'sign_in', 'size', 'unpriced_hidden', 'user_id', 'why', 'bridge_id'].sort();
const schema = contract.QUERY_OPERATION.responses[200].content['application/json'].schema;
check('the answer is a closed allow-list', schema.additionalProperties === false && schema.required.join() === 'ok');
check('its keys are exactly the ' + PINNED.length + ' the eight questions name (a new key is added here on purpose, with its reader)', JSON.stringify(Object.keys(schema.properties).sort()) === JSON.stringify(PINNED), Object.keys(schema.properties).sort());

/* one answer per question, built the way its handler builds it (routes/ctp.js, lib/ctpreturn.js attachmentFor, lib/netmember.js) */
const SAMPLES = {
  'resolve (found)': { ok: true, found: true, bridge_id: 'CBR1', display_name: 'R', user_id: 'r', address: 'CBR1@x.example', installation_key: 'k', sells_outside: true },
  'resolve (not found)': { ok: true, found: false, why: 'no business here called x' },
  catalogue: { ok: true, found: true, bridge_id: 'CBR1', shop: 'R', schema: {}, fields: [], items: [], groups: [], lines: [], catalogue_summary: {}, unpriced_hidden: 0, offers: [], categories: [], finishes: [] },
  'catalogue (sign-in card)': { ok: true, found: true, bridge_id: 'CBR1', shop: 'R', sign_in: { card: true } },
  search: { ok: true, found: true, results: [{ bridge_id: 'CBR1' }], searched: 3 },
  attachment: { ok: true, found: true, name: 'a.pdf', mime: 'application/pdf', size: 3, sha256: 'ab', data_base64: 'AAA=' },
  certificate: { ok: true, found: true, membership: { cert: {}, sealed: {} } },
  directory: { ok: true, found: true, directory: { v: 1 }, sealed: { alg: 'ed25519' } },
  locate: { ok: true, found: true, hints: [{ installation_key: 'k', domain: 'd' }] },
  registry_changes: { ok: true, found: true, changes: [{ seq: 1 }], entities: 1, last_seq: 1 }
};
Object.keys(SAMPLES).forEach((name) => {
  check(name + ': every key survives', prune(schema, SAMPLES[name]).dropped.length === 0, prune(schema, SAMPLES[name]).dropped);
  const planted = prune(schema, Object.assign({}, SAMPLES[name], { planted: 'x', cost_price: 5 }));
  check(name + ': a planted column is dropped, nothing else', planted.dropped.sort().join() === 'cost_price,planted' && !('planted' in planted.value) && Object.keys(SAMPLES[name]).every((key) => key in planted.value), planted.dropped);
});

/* the accept/reject decision answer, one shape for both (lib/chit-proposal decide) */
const decision = require(path.join(__dirname, '..', 'lib', 'chit-proposals-contract.js')).OPERATIONS['POST /api/chits/:chit_id/proposals/:proposal_id/accept'];
const out = decision.responses[200].content['application/json'].schema;
const kept = prune(out, { proposal_id: 'p', status: 'accepted', round: 2, ctp: { sent: true }, cost_price: 5 });
check('accept: a planted column is dropped, the four keys a caller reads stay', kept.dropped.join() === 'cost_price' && ['proposal_id', 'status', 'round', 'ctp'].every((key) => key in kept.value), kept.dropped);

console.log('\n  ' + (failed ? failed + ' failed' : 'all ok'));
process.exit(failed ? 1 : 0);
