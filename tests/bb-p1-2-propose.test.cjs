#!/usr/bin/env node
// @type: unit
/**
 * tests/bb-p1-2-propose.test.cjs — BB-P1-2 (28 Nov 2026): a firm under posting = owner_approves PROPOSES bank lines; nothing posts. No database, no network.
 * OWNS      the ONE bank-body test (lib/books-bank-body) · the propose doors' body test (single and per batch line) · the look's decision per posting policy (owner_approves → propose mark; adviser_posts → direct door unchanged and the batch still refused;
 *           NULL posting fails closed; /payments never proposes) · the terminal gate: 202 + held action per line, the writer never reached, a duplicate line is not a failure, a seat that cannot propose is refused, a throw never falls through ·
 *           prepareAction refuses a firm's `event` that is not a bank body.
 * CALLED BY scripts/guards.cjs · CI
 */
'use strict';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.DATABASE_URL = '';
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const HERE = path.join(__dirname, '..');
let pass = 0;
let fail = 0;
const t = async (name, fn) => {
  try {
    await fn();
    pass++;
    console.log('  ok   ' + name);
  } catch (e) {
    fail++;
    console.log('  FAIL ' + name + '\n         ' + String((e && e.message) || e).slice(0, 500));
  }
};
const body = require(path.join(HERE, 'lib', 'books-bank-body'));
const schema = require(path.join(HERE, 'lib', 'schema'));
schema.hasColumn = async () => true;
const grants = require(path.join(HERE, 'lib', 'books-grant'));
const front = require(path.join(HERE, 'middleware', 'books-grant'));
const action = require(path.join(HERE, 'lib', 'books-action'));
const approval = require(path.join(HERE, 'lib', 'books-approval'));

const line = (n, extra) => Object.assign({ kind: 'expense', class: 'bank_fees', amount: 12, client_ref: 'bank:abc:' + n }, extra);
const reqOf = (method, p, b) => ({ method, baseUrl: '/api/books', path: p, body: b, originalUrl: '/api/books' + p });
const fakeTx = (posting, cap) => ({ query: async () => ({ rows: [{ posting, posting_cap_minor: cap == null ? null : cap }] }) });
const live = () => ({ grant_id: 'g1', preset: 'adviser', revoked_at: null, unexpired: true, edge_live: true });
const asker = (extra) => Object.assign({ method: 'POST', listed: true, owner: true }, extra);

(async () => {
  await t('bank body: the four kinds with a bank: ref pass; a foreign key, another kind, no ref do not', () => {
    assert(body.bankEventBody(line(1)));
    assert(body.bankEventBody(line(1, { kind: 'contra', from: 'bank', to: 'x' })));
    assert(!body.bankEventBody(line(1, { supplier: 's1' })), 'supplier is foreign');
    assert(!body.bankEventBody(line(1, { kind: 'drawings' })));
    assert(!body.bankEventBody({ kind: 'expense', client_ref: 'x1' }));
    assert(!body.bankEventBody(null));
  });
  await t('propose doors: one line, and a batch whose EVERY line is a bank line and whose body has no other key', () => {
    assert(front.proposeBodyOk(reqOf('POST', '/events', line(1))));
    assert(front.proposeBodyOk(reqOf('POST', '/events/batch', { events: [line(1), line(2)] })));
    assert(!front.proposeBodyOk(reqOf('POST', '/events/batch', { events: [line(1), line(2, { kind: 'drawings' })] })), 'one bad line refuses the whole batch');
    assert(!front.proposeBodyOk(reqOf('POST', '/events/batch', { events: [line(1)], store_id: 'x' })), 'a second key');
    assert(!front.proposeBodyOk(reqOf('POST', '/events/batch', { events: [] })));
    assert(!front.proposeBodyOk(reqOf('POST', '/events/batch', { events: Array.from({ length: 101 }, (_, i) => line(i)) })));
    assert(front.proposeDoor(reqOf('POST', '/events/batch', {})) && !front.proposeDoor(reqOf('POST', '/payments', {})));
  });
  await t('look: owner_approves → propose mark, never a direct post; /payments (write, no propose) → not_posting', async () => {
    const row = live();
    assert.strictEqual(await grants.finalOutcome(fakeTx('owner_approves'), row, asker({ bank_write: true, bank_propose: true, role: 'adviser' })), 'allowed');
    assert.strictEqual(row.bank_propose, true);
    const pay = live();
    assert.strictEqual(await grants.finalOutcome(fakeTx('owner_approves'), pay, asker({ bank_write: true, bank_propose: false })), 'not_posting');
    assert.notStrictEqual(pay.bank_propose, true);
  });
  await t('look: adviser_posts keeps the direct door and does NOT propose; the batch stays refused; a cap still fails closed; NULL fails closed', async () => {
    const direct = live();
    assert.strictEqual(await grants.finalOutcome(fakeTx('adviser_posts'), direct, asker({ bank_write: true, bank_propose: true })), 'allowed');
    assert.notStrictEqual(direct.bank_propose, true, 'adviser_posts must not turn into a proposal');
    assert.strictEqual(await grants.finalOutcome(fakeTx('adviser_posts'), live(), asker({ bank_write: false, bank_propose: true })), 'not_listed');
    assert.strictEqual(await grants.finalOutcome(fakeTx('adviser_posts', 5000), live(), asker({ bank_write: true, bank_propose: true })), 'posting_capped');
    assert.strictEqual(await grants.finalOutcome(fakeTx(null), live(), asker({ bank_write: true, bank_propose: true })), 'not_posting');
    assert.strictEqual(await grants.finalOutcome(fakeTx(null), live(), asker({ bank_write: false, bank_propose: true })), 'not_listed');
  });

  /* the terminal gate, with the queue's prepare recorded */
  const prepared = [];
  let writerReached = 0;
  const realPrepare = action.prepareAction;
  action.prepareAction = async (entity, actor, input) => {
    if (input.body.client_ref === 'bank:dup:1') {
      const err = new Error('open');
      err.code = 'ACTION_REF_OPEN';
      err.status = 409;
      throw err;
    }
    if (input.body.client_ref === 'bank:boom:1') throw new Error('queue down');
    prepared.push({ entity, actor, input });
    return { action_id: 'a' + prepared.length, state: 'waiting_review', kind: 'event', total_minor: 1200, currency: 'AUD' };
  };
  const refusalOf = (err) => ({ status: 500, code: 'BOOKS_FAULT', detail: String(err.message) });
  const gate = approval.grantProposeGate(refusalOf);
  const run = async (req) => {
    const out = { status: null, json: null, nextCalled: false };
    const res = { status(s) { out.status = s; return this; }, json(j) { out.json = j; return this; }, type() { return this; }, set() { return this; }, setHeader() { return this; } };
    await gate(req, res, () => { out.nextCalled = true; writerReached++; });
    return out;
  };
  const seatReq = (p, b, extra) => Object.assign({ method: 'POST', path: p, body: b, books: { enabled: true }, acting_for_grant: 'g1', acting_firm_name: 'Bayside Books', acting_bank_propose: true, identity: { identity_id: 'store1', display_name: 'Mia Maker', acting_preset: 'adviser', access_level: 'editor', identity_type: 'entity' }, realIdentity: { identity_id: 'mia', identity_type: 'actor', parent_entity_id: 'firm1' } }, extra);
  await t('gate: a request that is not a proposal passes straight through (the owner and the direct door)', async () => {
    const out = await run({ method: 'POST', path: '/events', body: line(1) });
    assert(out.nextCalled && out.status === null);
  });
  await t('gate: a proposed line → 202 with the held action, stamped firm + grant, the writer never reached', async () => {
    writerReached = 0;
    prepared.length = 0;
    const out = await run(seatReq('/events', line(1)));
    assert.strictEqual(out.status, 202);
    assert.strictEqual(out.json.state, 'waiting_review');
    assert(!out.nextCalled && writerReached === 0);
    assert.strictEqual(prepared[0].actor.grant_id, 'g1');
    assert.strictEqual(prepared[0].actor.firm_name, 'Bayside Books');
    assert.strictEqual(prepared[0].input.kind, 'event');
    assert.strictEqual(prepared[0].input.client_ref, 'bank:abc:1');
  });
  await t('gate: a batch → 202, one row per line; a line already waiting is a duplicate, a failing line is its own row, the rest go on', async () => {
    prepared.length = 0;
    const out = await run(seatReq('/events/batch', { events: [line(1), line(3, { client_ref: 'bank:dup:1' }), line(4, { client_ref: 'bank:boom:1' }), line(2)] }));
    assert.strictEqual(out.status, 202);
    const rows = out.json.results;
    assert.strictEqual(rows.length, 4);
    assert(rows[0].ok && rows[0].held && rows[0].action_id && rows[0].currency === 'AUD' && rows[0].total_minor === 1200);
    assert(rows[1].ok && rows[1].duplicate && !rows[1].held);
    assert(!rows[2].ok);
    assert(rows[3].ok && rows[3].held);
    assert.strictEqual(out.json.held, 2);
    assert.strictEqual(out.json.written, 0);
    assert(!out.nextCalled);
  });
  await t('gate: a bad body in the batch is refused whole (422); a viewer seat and an auditor are refused and never fall through', async () => {
    prepared.length = 0;
    writerReached = 0;
    const bad = await run(seatReq('/events/batch', { events: [line(1), line(2, { kind: 'drawings' })] }));
    assert.strictEqual(bad.status, 422);
    assert.strictEqual(prepared.length, 0);
    assert(!bad.nextCalled);
    const viewer = await run(seatReq('/events', line(1), { identity: { identity_id: 'store1', acting_preset: 'adviser', access_level: 'viewer', identity_type: 'actor', parent_entity_id: 'store1' } }));
    assert.strictEqual(viewer.status, 403);
    assert(!viewer.nextCalled);
    const auditor = await run(seatReq('/events', line(1), { identity: { identity_id: 'store1', acting_preset: 'auditor', access_level: 'editor', identity_type: 'entity' } }));
    assert.strictEqual(auditor.status, 403);
    assert(!auditor.nextCalled);
    assert.strictEqual(prepared.length, 0);
    assert.strictEqual(writerReached, 0);
  });
  await t('gate: a throw inside the queue is an answer, never a fall-through to the writer', async () => {
    writerReached = 0;
    const out = await run(seatReq('/events', line(1, { client_ref: 'bank:boom:1' })));
    assert(out.status >= 400 && !out.nextCalled && writerReached === 0);
  });
  action.prepareAction = realPrepare;

  await t('prepareAction: a firm event that is not a bank body is refused before anything is read', async () => {
    const firm = { identity_id: 'mia', grant_id: 'g1' };
    await assert.rejects(() => action.prepareAction('s1', firm, { kind: 'event', body: line(1, { kind: 'drawings' }), client_ref: 'bank:abc:1' }, {}), (e) => e.code === 'ACTION_KIND_INVALID');
    await assert.rejects(() => action.prepareAction('s1', firm, { kind: 'event', body: { kind: 'expense', client_ref: 'plain' }, client_ref: 'plain' }, {}), (e) => e.code === 'ACTION_KIND_INVALID');
  });
  await t('wiring: both doors carry the terminal gate after the contract check, and the proposer flag is read by no other file', () => {
    const single = fs.readFileSync(path.join(HERE, 'routes', 'books.js'), 'utf8');
    const batch = fs.readFileSync(path.join(HERE, 'routes', 'books-events-batch.js'), 'utf8');
    assert(single.includes("router.post('/events', auth, noKey, ownerOrAccountant, on, ...checked('POST /events'), require('../lib/books-approval').grantProposeGate(refusalOf)"));
    assert(batch.includes("router.post('/events/batch', auth, noKey, ownerOrAccountant, on, ...checked('POST /events/batch'), require('../lib/books-approval').grantProposeGate(refusalOf)"));
    const readers = [];
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        const file = path.join(dir, name);
        const stat = fs.statSync(file);
        if (stat.isDirectory()) walk(file);
        else if (name.endsWith('.js') && fs.readFileSync(file, 'utf8').includes('acting_bank_propose')) readers.push(path.relative(HERE, file).split(path.sep).join('/'));
      }
    };
    ['lib', 'routes', 'middleware', 'src'].forEach((dir) => fs.existsSync(path.join(HERE, dir)) && walk(path.join(HERE, dir)));
    assert.deepStrictEqual(readers.sort(), ['lib/books-approval.js', 'middleware/books-grant.js', 'routes/books.js']);
  });
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
