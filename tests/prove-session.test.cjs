/**
 * tests/prove-session.test.cjs — tools/tally-connector/prove.js session(): every write is ONE attempt with its OWN Idempotency-Key.
 *
 * prove.js is a dev proof script (it needs a live api and CB_TOKEN, ships to no shop). FIN-51 made Mark paid and the books' money doors
 * REQUIRE a key, so the script's session() now sends a fresh one on every write and none on a read. Held here with fetch stubbed:
 * no network, no api. Hand-computed: 4 writes (POST, POST, PATCH, DELETE) -> 4 keys, all different; 1 GET -> 0 keys.
 *
 * Run: node tests/prove-session.test.cjs
 */
'use strict';
const prove = require('../tools/tally-connector/prove.js');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const calls = [];
let reply = { status: 200, text: '{"ok":true}' };
global.fetch = async (url, init) => { calls.push({ url, init }); return { status: reply.status, text: async () => reply.text }; };

(async () => {
  prove.aim('http://stub.invalid', 'tok-1');
  for (const verb of ['POST', 'POST', 'PATCH', 'DELETE', 'GET']) await prove.session(verb, '/api/x', verb === 'GET' ? undefined : { a: 1 });
  const keys = calls.map((c) => c.init.headers['Idempotency-Key']);
  const writes = keys.slice(0, 4);

  ok('a write (POST) carries an Idempotency-Key that is a v4 UUID', UUID.test(String(keys[0])), String(keys[0]));
  ok('PATCH and DELETE carry one too', UUID.test(String(keys[2])) && UUID.test(String(keys[3])));
  ok('four writes -> four DIFFERENT keys (each call is its own attempt, never a replay)', new Set(writes).size === 4, writes.join(' '));
  ok('a GET carries no Idempotency-Key', calls[4].init.method === 'GET' && !('Idempotency-Key' in calls[4].init.headers));
  ok('every call carries the bearer token and the target api', calls.every((c) => c.init.headers.Authorization === 'Bearer tok-1' && c.url === 'http://stub.invalid/api/x'));
  ok('a write sends its body as JSON; a GET sends none', calls[0].init.body === '{"a":1}' && calls[4].init.body === undefined);

  reply = { status: 409, text: '{"code":"ALREADY_PAID"}' };
  const refused = await prove.session('POST', '/api/chits/c1/payment', { method: 'upi' });
  ok('a refusal comes back as its status and parsed body (the ALREADY_PAID assert reads these)', refused.status === 409 && refused.j.code === 'ALREADY_PAID');

  reply = { status: 502, text: '<html>bad gateway</html>' };
  const raw = await prove.session('GET', '/api/x');
  ok('an answer that is not JSON is kept as raw text, not thrown', raw.status === 502 && raw.j.raw === '<html>bad gateway</html>');

  console.log('\n  ' + (fail ? '✗ ' : '✓ ') + pass + ' passed · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   FAIL threw: ' + (e && e.stack || e)); process.exit(1); });
