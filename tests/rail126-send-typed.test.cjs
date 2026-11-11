/**
 * tests/rail126-send-typed.test.cjs — RAIL-126 (a) under S33-T: POST /api/chits/send is a TOLERANT door whose every named key is typed.
 *
 * OWNS      the proof that an unknown key (zz_unknown) on POST /send is ignored (200, the same as without it, never named in an answer), that a JUNK VALUE in a known key is a 400 in the chits problem shape
 *           (CHIT_INVALID, the key named), that every key a caller really sends (the web screens, the counter, the api's own senders) is still accepted, and that the inbound tolerant reader (part b, the CTP envelope) is untouched.
 *           The door's tolerant entry and its end-to-end proof are in docs/contracts/api-hardening-scope.json and tests/api-tolerant-till.test.cjs; this file holds the per-key kinds.
 * CALLED BY scripts/guards.cjs (the offline gate).
 * FLOW      lib/chits-contract routeChecks('POST /send') (the same check routes/chits.js mounts) over a tiny express app; lib/ctpenvelope for part (b). No db, no network.
 * CARD      01-rail-core-the-chit/chits-routes
 * MIN unit-per-rule
 * MIN refusal-path
 * Run: node tests/rail126-send-typed.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const API = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
const contract = require(path.join(API, 'lib', 'chits-contract'));
const input = require(path.join(API, 'lib', 'chits-input'));
const envelope = require(path.join(API, 'lib', 'ctpenvelope'));

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + JSON.stringify(why).slice(0, 400) : '')); } };

/** every top-level key a caller really puts on a send (web: app.html compose · cap-readiness · cap-tasks · intake · till.html chitOf* · rollup · bank-recon · rail-advice; api: lib/books adviceChitBody, repeat-supply, autoraise, sit tools) */
const REAL_KEYS = [
  'recipients', 'receivers', 'purpose', 'manual_subject', 'subject', 'line_items', 'business_json', 'schema_values', 'is_draft', 'send_as_label',
  'external_priority', 'promote_draft_id', 'forwarded_from', 'self_copy', 'client_ref', 'message', 'trace', 'retention_days', 'expires_at'
];
/** one realistic body per caller, each as it goes on the wire */
const BODIES = {
  'compose (app.html sendChit)': { recipients: [{ name: 'A', role: 'to' }], is_draft: false, send_as_label: 'Order', subject: 'S', schema_values: {}, line_items: [], external_priority: 'normal', promote_draft_id: undefined, forwarded_from: undefined, purpose: 'order', business_json: { a: 1 }, self_copy: 'received' },
  'task / evidence (self)': { recipients: [{ name: 'self', role: 'to' }], manual_subject: 'x', subject: 'x', purpose: 'general', line_items: [] },
  'counter bill (till.html chitOf)': { recipients: [{ self: true, name: 'self' }], purpose: 'order', subject: 'B', manual_subject: 'B', client_ref: 'B-1', business_json: { till: { id: 'T' } }, line_items: [{ particulars: 'Tea', quantity: 1, price: 10 }] },
  'bank question (bank-recon)': { recipients: [{ entity_id: 'e1', role: 'to' }], purpose: 'general', manual_subject: 'q', client_ref: 'bankask:k', message: 'which bill?', business_json: { kind: 'bank_query' } },
  'payment advice (lib/books adviceChitBody)': { recipients: [{ entity_id: 'e1', role: 'to' }], purpose: 'general', manual_subject: 'a', client_ref: 'advice:pay:1', line_items: [], business_json: { kind: 'payment_advice' } },
  'repeat run (lib/repeat-supply runBody)': { recipients: [{ entity_id: 'e1', role: 'to' }], purpose: 'invoice', is_draft: false, manual_subject: 'r', line_items: [], business_json: {}, client_ref: 'rep:1' },
  'auto-raise (lib/autoraise)': { recipients: [{ self: true }], subject: 's', line_items: [], purpose: 'inquiry', business_json: {}, self_copy: 'received' },
  'old receivers shape + retention + trace': { receivers: [{ name: 'A' }], retention_days: 30, expires_at: '2027-01-01T00:00:00Z', trace: { product: 'Rice' } }
};

function post(port, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ port, method: 'POST', path: '/send', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      let text = '';
      res.on('data', (part) => { text += part; });
      res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

(async () => {
  /* the same checks the route mounts (recipientsRule then the schema check), then a handler that only says it got through */
  const app = express();
  app.use(express.json());
  app.post('/send', input.recipientsRule(contract.operationFor('POST /send')), ...contract.routeChecks('POST /send'), (req, res) => res.status(200).json({ ok: true }));
  /* the problem() helper wants a request id and a route; a tiny stand-in keeps the shape the real server gives */
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const port = server.address().port;
  try {
    /* 1 · an unknown key is ignored (S33-T): the same answer as without it, and the answer never names it */
    const plain = await post(port, { recipients: [{ self: true }], purpose: 'order' });
    const stray = await post(port, { recipients: [{ self: true }], purpose: 'order', zz_unknown: 'zz_unknown_canary_value' });
    ok('an unknown key (zz_unknown) is ignored: 200 as without it', stray.status === 200 && plain.status === 200 && JSON.stringify(stray.body) === JSON.stringify(plain.body), stray);
    const draftStray = await post(port, { is_draft: true, zz_unknown: 1 });
    ok('a draft with an unknown key goes too', draftStray.status === 200, draftStray);
    /* 1b · a junk value in a known key is a 400 problem naming the key (the problem shape: code CHIT_INVALID) */
    const JUNK = { subject: { a: 1 }, schema_values: 'x', is_draft: 'maybe', send_as_label: 5, external_priority: 7, promote_draft_id: 3, forwarded_from: [], client_ref: 9, message: {}, trace: 'x', retention_days: 'soon', expires_at: 20270101, self_copy: 'everyone', line_items: 'none', business_json: 'x', purpose: 'nope', manual_subject: 5 };
    for (const [key, value] of Object.entries(JUNK)) {
      const refused = await post(port, Object.assign({ recipients: [{ self: true }] }, { [key]: value }));
      ok('junk in ' + key + ' is a 400 problem naming it', refused.status === 400 && refused.body && refused.body.code === 'CHIT_INVALID' && JSON.stringify(refused.body).includes(key), refused.body);
    }

    /* 2 · every real caller's body still goes through */
    for (const [who, body] of Object.entries(BODIES)) {
      const got = await post(port, JSON.parse(JSON.stringify(body)));
      ok('real body accepted: ' + who, got.status === 200, got);
    }
    /* 3 · SEND_BODY names every key a caller sends, and types each (an untyped key would fail the register's knownKeysTyped) */
    const listed = Object.keys(input.SEND_BODY);
    const missing = REAL_KEYS.filter((key) => !listed.includes(key) && !['recipients', 'receivers'].includes(key)); /* the two recipient lists are judged by recipientsRule, with its own words */
    ok('SEND_BODY types every key a caller sends but the two recipient lists (' + (REAL_KEYS.length - 2) + ')', missing.length === 0, missing);
    ok('every key SEND_BODY names is typed', Object.values(input.SEND_BODY).every((rule) => rule.type || rule.enum), Object.keys(input.SEND_BODY));
    const sentKeys = new Set(Object.values(BODIES).flatMap((body) => Object.keys(body)));
    ok('the sample bodies together use every real key', REAL_KEYS.every((key) => sentKeys.has(key)), REAL_KEYS.filter((key) => !sentKeys.has(key)));
    /* 4 · the existing typed rules are untouched */
    const wrongPurpose = await post(port, { recipients: [{ self: true }], purpose: 'nope' });
    ok('a wrong purpose is still its own 400', wrongPurpose.status === 400 && JSON.stringify(wrongPurpose.body).includes('purpose'), wrongPurpose.body);
    const lone = await post(port, { recipients: 'me' });
    ok('a recipients value that is not a list is still the recipients rule own 400', lone.status === 400 && JSON.stringify(lone.body).includes('recipient'), lone.body);
    const nobody = await post(port, { purpose: 'order' });
    ok('no recipient is still its own 400', nobody.status === 400, nobody.body);
  } finally {
    server.close();
  }

  /* 4b · the live proof scripts (they need a running server, so they are read, not run) send no key the send door never read */
  for (const file of ['scripts/prove-line-events.js', 'scripts/prove-line-threads.js', 'scripts/prove-partial.js', 'scripts/prove-three-party-messaging.js', 'scripts/prove-usecases.js']) {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', file), 'utf8');
    ok(file + ' sends no send_to_self (the door never read it)', !/send_to_selfs*:/.test(src), file);
  }

  /* 5 · part (b) is untouched: the CTP inbound reader still ignores a field it does not know */
  const FROM = { installation_key: 'platform-0', population: 'live', bridge_id: 'CBAAAAAAAA', display_name: 'A Shop' };
  const TO = { bridge_id: 'CBBBBBBBBB' };
  const CHIT = { chit_id: 'd07f5862-0fc2-45bb-9fc7-e7f9999b1943', header: { summary_json: {} }, copy: { entity_id: 'e1', business_json: {} } };
  const extra = Object.assign({}, envelope.sign(envelope.build(FROM, TO, CHIT), null), { future_field: { a: 1 } });
  ok('inbound CTP still ignores an unknown field (tolerant reader)', envelope.open(extra, { population: 'live', verify: () => true }).ok === true);

  console.log(pass + ' checks, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((error) => { console.log('   FAIL crashed: ' + error.stack); process.exit(1); });
