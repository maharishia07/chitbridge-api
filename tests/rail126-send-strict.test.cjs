/**
 * tests/rail126-send-strict.test.cjs — RAIL-126 (a): our own web send is a CLOSED schema (an unknown key on POST /api/chits/send is a 400 that names it).
 *
 * OWNS      the proof that POST /send refuses a key it does not list (one problem, CHIT_INVALID, the key named), that every key a caller really sends
 *           (the web screens, the counter, the api's own senders) is still accepted, and that the inbound tolerant reader (part b, the CTP envelope) is untouched.
 * CALLED BY scripts/guards.cjs (the offline gate).
 * FLOW      lib/chits-contract routeChecks('POST /send') (the same check routes/chits.js mounts) over a tiny express app; lib/ctpenvelope for part (b). No db, no network.
 * CARD      01-rail-core-the-chit/chits-routes
 * MIN unit-per-rule
 * MIN refusal-path
 * Run: node tests/rail126-send-strict.test.cjs
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
    /* 1 · an unknown key is a 400, in the one problem shape, naming the key */
    const stray = await post(port, { recipients: [{ self: true }], purpose: 'order', surprise_field: 1 });
    ok('an unknown key is refused 400', stray.status === 400, stray);
    ok('the refusal is the chits problem (CHIT_INVALID)', stray.body && stray.body.code === 'CHIT_INVALID', stray.body);
    ok('the refusal names the key', JSON.stringify(stray.body).includes('surprise_field'), stray.body);
    ok('the refusal says it is not accepted here', JSON.stringify(stray.body).includes('not accepted here'), stray.body);
    const two = await post(port, { recipients: [{ self: true }], zzz: 1, yyy: 2 });
    ok('every stray key is named, not only the first', two.status === 400 && JSON.stringify(two.body).includes('zzz') && JSON.stringify(two.body).includes('yyy'), two.body);
    const draftStray = await post(port, { is_draft: true, whatever: true });
    ok('a draft with a stray key is refused too', draftStray.status === 400, draftStray);

    /* 2 · every real caller's body still goes through */
    for (const [who, body] of Object.entries(BODIES)) {
      const got = await post(port, JSON.parse(JSON.stringify(body)));
      ok('real body accepted: ' + who, got.status === 200, got);
    }
    /* 3 · the allow-list holds exactly the keys callers send: none missing, and SEND_BODY names each of them */
    const listed = Object.keys(input.SEND_BODY);
    const missing = REAL_KEYS.filter((key) => !listed.includes(key));
    ok('SEND_BODY lists every key a caller sends (' + REAL_KEYS.length + ')', missing.length === 0, missing);
    const sentKeys = new Set(Object.values(BODIES).flatMap((body) => Object.keys(body)));
    ok('the sample bodies together use every real key', REAL_KEYS.every((key) => sentKeys.has(key)), REAL_KEYS.filter((key) => !sentKeys.has(key)));
    /* 4 · the existing typed rules are untouched */
    const wrongPurpose = await post(port, { recipients: [{ self: true }], purpose: 'nope' });
    ok('a wrong purpose is still its own 400', wrongPurpose.status === 400 && JSON.stringify(wrongPurpose.body).includes('purpose'), wrongPurpose.body);
    const nobody = await post(port, { purpose: 'order' });
    ok('no recipient is still its own 400', nobody.status === 400, nobody.body);
  } finally {
    server.close();
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
