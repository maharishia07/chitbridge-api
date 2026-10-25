/**
 * tests/chit-proposals-route.test.cjs — the doors of routes/chit-proposals.js (RAIL-106: list · propose · accept · reject · counter), driven over HTTP on the REAL router with the library
 * (lib/chit-proposal) and the login stood in. The library's own rules are tested in tests/chit-proposals.test.cjs; this proves what the DOORS promise.
 * MIN one-success-path · contract · auth-refused · bad-input-4xx · idempotent-replay · error-never-leaks
 *   · one success path: propose, accept, reject, counter and list each answer 200 with the library's answer
 *   · contract: every refusal is the one problem shape (type, title, status, code, detail, request_id) with a registered code
 *   · auth refused: a login below the amend level is refused 403 before the library is asked; no login is refused 401
 *   · bad input 4xx: a refusal the library meant (PROPOSAL_BAD 400, NOT_FOUND 404) keeps its status and words
 *   · idempotent replay: deciding the same proposal twice answers 409 PROPOSAL_CLOSED the second time and changes nothing more
 *   · error never leaks: an unexpected fault answers 500 with the safe sentence, never the cause
 * Run: node tests/chit-proposals-route.test.cjs
 */
'use strict';
const assert = require('assert');
const http = require('http');
const path = require('path');
const express = require('express');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const API = path.join(__dirname, '..');
const mock = (relative, exported) => {
  const file = require.resolve(path.join(API, relative));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exported };
};

const SECRET = 'relation "chit_proposal" does not exist -- INSERT INTO vault';
const world = { calls: [], decided: new Set(), identity: { identity_id: 'e-1', display_name: 'Asha', identity_type: 'entity', access_level: 'owner' }, noLogin: false, propose: null, fault: false };

const refuse = (status, code, message) => Object.assign(new Error(message), { status, code, refused: true });
mock('lib/chit-proposal', {
  list: async (entity, chit) => (chit === 'missing' ? null : { migrated: true, proposals: [{ proposal_id: 'p-1', round: 2 }] }),
  propose: async (entity, chit, input, actor) => {
    world.calls.push(['propose', chit, input, actor]);
    if (world.fault) throw new Error(SECRET);
    if (world.propose !== null) return world.propose;
    if (!input.lines && !input.terms && !input.note) throw refuse(400, 'PROPOSAL_BAD', 'Say what you are asking for: the lines and quantities, or a note.');
    return { proposal_id: 'p-2', round: 3, kind: 'pro_forma', status: 'proposed' };
  },
  decide: async (entity, chit, proposalId, decision, actor) => {
    world.calls.push(['decide', proposalId, decision]);
    if (world.decided.has(proposalId)) throw refuse(409, 'PROPOSAL_CLOSED', 'This proposal is already accepted.');
    world.decided.add(proposalId);
    return { proposal_id: proposalId, status: decision === 'accept' ? 'accepted' : 'rejected', round: 2 };
  }
});
mock('middleware/auth', Object.assign(
  (req, res, next) => {
    if (world.noLogin) return res.status(401).json({ error: 'Unauthorized' });
    req.identity = world.identity;
    next();
  },
  { entityOf: (req) => req.identity.identity_id }
));

const router = require(path.join(API, 'routes', 'chit-proposals'));
const app = express();
app.use(express.json());
app.use('/api/chits', router);

let pass = 0,
  fail = 0;
const t = async (name, fn) => {
  try {
    await fn();
    pass++;
    console.log('   ok   ' + name);
  } catch (e) {
    fail++;
    console.log('   FAIL ' + name + '\n          ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n          ') : e));
  }
};

const server = app.listen(0, '127.0.0.1', async () => {
  const call = async (method, url, body) => {
    const reply = await fetch('http://127.0.0.1:' + server.address().port + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: reply.status, type: reply.headers.get('content-type') || '', body: await reply.json().catch(() => ({})) };
  };
  const PROBLEM_KEYS = ['type', 'title', 'status', 'code', 'detail', 'request_id'];
  const isProblem = (res, status, code) => {
    assert.strictEqual(res.status, status, JSON.stringify(res.body));
    assert.ok(/application\/problem\+json/.test(res.type), 'content-type ' + res.type);
    for (const key of PROBLEM_KEYS) assert.ok(res.body[key] !== undefined, 'the problem carries ' + key);
    assert.strictEqual(res.body.status, status);
    if (code) assert.strictEqual(res.body.code, code);
  };
  const reset = () => Object.assign(world, { calls: [], decided: new Set(), noLogin: false, propose: null, fault: false, identity: { identity_id: 'e-1', display_name: 'Asha', identity_type: 'entity', access_level: 'owner' } });

  try {
    await t('one success path: list · propose · accept · reject · counter each answer 200 with the library’s answer', async () => {
      reset();
      assert.deepStrictEqual((await call('GET', '/api/chits/c-1/proposals')).body.proposals[0].round, 2);
      const proposed = await call('POST', '/api/chits/c-1/proposals', { lines: [{ line_id: 'l-1', price: 95 }] });
      assert.strictEqual(proposed.status, 200);
      assert.strictEqual(proposed.body.proposal_id, 'p-2');
      assert.deepStrictEqual(world.calls[0][3], { id: 'e-1', name: 'Asha' }, 'the library is told WHO acts');
      assert.strictEqual((await call('POST', '/api/chits/c-1/proposals/p-5/accept', { note: 'ok' })).body.status, 'accepted');
      assert.strictEqual((await call('POST', '/api/chits/c-1/proposals/p-6/reject', {})).body.status, 'rejected');
      const counter = await call('POST', '/api/chits/c-1/proposals/p-2/counter', { lines: [{ line_id: 'l-1', requested_price: '90' }] });
      assert.strictEqual(counter.status, 200);
      assert.strictEqual(world.calls.find((call2) => call2[0] === 'propose' && call2[2].counter_of).length > 0, true, 'a counter is a proposal that names the round it answers');
    });
    await t('contract: a refusal is the one problem shape with a registered code (a chit with nobody else on it: 409 PROPOSAL_NO_COUNTERPARTY)', async () => {
      reset();
      world.propose = undefined; /* the library answers nothing: a chit with nobody else on it */
      const none = await call('POST', '/api/chits/c-1/proposals', { note: 'hello' });
      world.propose = null;
      isProblem(none, 409, 'PROPOSAL_NO_COUNTERPARTY');
      const missing = await call('GET', '/api/chits/missing/proposals');
      isProblem(missing, 404, 'NOT_FOUND');
      const codes = require(path.join(API, 'docs', 'error-codes.json')).codes.map((row) => row.code);
      for (const code of ['PROPOSAL_NO_COUNTERPARTY', 'PROPOSAL_BAD', 'PROPOSAL_CLOSED', 'NOT_FOUND']) assert.ok(codes.includes(code), code + ' is registered');
    });
    await t('auth refused: a view-only login is refused 403 BEFORE the library is asked; no login at all is refused 401', async () => {
      reset();
      world.identity = Object.assign({}, world.identity, { identity_type: 'actor', access_level: 'viewer' });
      const refused = await call('POST', '/api/chits/c-1/proposals', { note: 'x' });
      isProblem(refused, 403, 'CHIT_NOT_PERMITTED');
      assert.strictEqual(world.calls.length, 0, 'the library was never asked');
      reset();
      world.noLogin = true;
      assert.strictEqual((await call('GET', '/api/chits/c-1/proposals')).status, 401);
      assert.strictEqual((await call('POST', '/api/chits/c-1/proposals/p-1/accept', {})).status, 401);
      assert.strictEqual(world.calls.length, 0);
    });
    await t('bad input 4xx: a refusal the library meant keeps its status, its code and its words', async () => {
      reset();
      const bad = await call('POST', '/api/chits/c-1/proposals', {});
      isProblem(bad, 400, 'PROPOSAL_BAD');
      assert.ok(/Say what you are asking for/.test(bad.body.detail));
    });
    await t('idempotent replay: deciding the same proposal twice changes nothing the second time (409 PROPOSAL_CLOSED)', async () => {
      reset();
      const first = await call('POST', '/api/chits/c-1/proposals/p-9/accept', {});
      assert.strictEqual(first.status, 200);
      const again = await call('POST', '/api/chits/c-1/proposals/p-9/accept', {});
      isProblem(again, 409, 'PROPOSAL_CLOSED');
      assert.strictEqual(world.decided.size, 1);
    });
    await t('error never leaks: an unexpected fault answers 500 with the safe sentence, and nothing of the cause', async () => {
      reset();
      world.fault = true;
      const log = console.error;
      console.error = () => {};
      const broken = await call('POST', '/api/chits/c-1/proposals', { note: 'x' });
      console.error = log;
      isProblem(broken, 500);
      assert.ok(!JSON.stringify(broken.body).includes('vault') && !JSON.stringify(broken.body).includes('chit_proposal'), 'no SQL, no table name');
    });
  } finally {
    console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
    process.exitCode = fail ? 1 : 0;
    server.close();
  }
});
