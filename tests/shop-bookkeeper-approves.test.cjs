#!/usr/bin/env node
// @type: unit
/**
 * tests/shop-bookkeeper-approves.test.cjs — slice B of the shop Bookkeeper (REQ-2026-11-19-shop-bookkeeper items 5-8). No database, no network: the real gate (lib/books-approval.heldGate), the real prepare's refusals, the real setting.
 * OWNS      setting OFF (default) = the request goes on to the direct post · ON + Bookkeeper seat = 202 with the held action, the writer never reached · ON + owner / outside grant / counter staff = unchanged ·
 *           an unreadable setting never lets an entry through · staff cannot prepare lock, unlock, year_close or reverse (refused before the queue is asked) · the setting is the owner's alone, default off, one definition
 * CALLED BY scripts/guards.cjs · CI
 */
'use strict';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.DATABASE_URL = '';
const path = require('path');
const assert = require('assert');

const HERE = path.join(__dirname, '..');
const SHOP = '11111111-1111-4111-8111-111111111111';
const seat = (extra) => Object.assign({ identity_id: '44444444-4444-4444-8444-444444444444', parent_entity_id: SHOP, identity_type: 'actor', display_name: 'Ravi Books', access_level: 'editor', whole_entity: true, can_see_costs: true, hat: 'manager' }, extra || {});
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Test shop' };

let pass = 0;
let fail = 0;
const t = async (name, fn) => {
  try {
    await fn();
    pass++;
    console.log('  ok   ' + name);
  } catch (e) {
    fail++;
    console.log('  FAIL ' + name + '\n         ' + String((e && e.message) || e).slice(0, 400));
  }
};

/** the setting read and the queue's prepare are the two seams: the real policy module with `get` swapped, the real books-action with `prepareAction` recorded */
const world = { flag: 'off', readFails: false, prepared: [], reads: 0 };
const policy = require(path.join(HERE, 'lib', 'policy'));
policy.get = async () => {
  world.reads++;
  if (world.readFails) throw new Error('the flag could not be read');
  return { books_owner_approves: world.flag };
};
const action = require(path.join(HERE, 'lib', 'books-action'));
const realPrepare = action.prepareAction;
action.prepareAction = async (entity, actor, input) => {
  world.prepared.push({ entity, actor, input });
  return { action_id: 'a1', state: 'waiting_accept', kind: input.kind };
};
const approval = require(path.join(HERE, 'lib', 'books-approval'));
const refusalOf = (err) => ({ status: 500, code: 'BOOKS_FAULT', detail: String(err.message) });

/** one pass through the gate: { nexted, status, body } */
async function through(identity, kind, body, extra) {
  const req = Object.assign({ identity, body: body || {}, books: { enabled: true }, headers: {}, get: () => null }, extra || {});
  const out = { nexted: false, status: null, body: null };
  const res = {
    status(code) {
      out.status = code;
      return res;
    },
    json(payload) {
      out.body = payload;
      return res;
    },
    setHeader() {},
    type() {
      return res;
    },
    send(payload) {
      out.body = payload;
      return res;
    }
  };
  await approval.heldGate(kind, refusalOf)(req, res, () => {
    out.nexted = true;
  });
  return out;
}
const reset = () => {
  world.flag = 'off';
  world.readFails = false;
  world.prepared = [];
  world.reads = 0;
};

(async () => {
  console.log('\nshop Bookkeeper, slice B (owner approves)');

  await t('setting OFF (the default): the Bookkeeper goes straight on to the direct post, nothing is prepared', async () => {
    reset();
    const out = await through(seat(), 'event', { kind: 'expense', client_ref: 'r1' });
    assert.strictEqual(out.nexted, true);
    assert.strictEqual(out.status, null);
    assert.strictEqual(world.prepared.length, 0);
  });

  await t('setting ON, Bookkeeper seat: 202 with the held action; the direct post is never reached', async () => {
    reset();
    world.flag = 'on';
    const out = await through(seat(), 'event', { kind: 'expense', amount_minor: 500000, client_ref: 'r2' });
    assert.strictEqual(out.nexted, false);
    assert.strictEqual(out.status, 202);
    assert.strictEqual(out.body.state, 'waiting_accept');
    const got = world.prepared[0];
    assert.strictEqual(got.entity, SHOP);
    assert.strictEqual(got.input.kind, 'event');
    assert.strictEqual(got.input.client_ref, 'r2');
    assert.deepStrictEqual(got.input.body, { kind: 'expense', amount_minor: 500000, client_ref: 'r2' }, 'the body is exactly the /events body');
    assert.deepStrictEqual(got.actor, { identity_id: '44444444-4444-4444-8444-444444444444', name: 'Ravi Books', staff: true }, 'the real person, no firm, no grant');
  });

  await t('setting ON, a typed journal (POST /entries) is held as kind journal', async () => {
    reset();
    world.flag = 'on';
    const out = await through(seat(), 'journal', { narration: 'x', lines: [] });
    assert.strictEqual(out.status, 202);
    assert.strictEqual(world.prepared[0].input.kind, 'journal');
  });

  await t('setting ON: the owner posts directly and the setting is not even read for him', async () => {
    reset();
    world.flag = 'on';
    const out = await through(OWNER, 'event', {});
    assert.strictEqual(out.nexted, true);
    assert.strictEqual(world.reads, 0, 'no extra read for the owner');
    assert.strictEqual(world.prepared.length, 0);
  });

  await t('setting ON: an outside adviser under a grant, a device key and Regional-manager staff are not this gate\'s business', async () => {
    reset();
    world.flag = 'on';
    const granted = await through(seat(), 'event', {}, { acting_for_grant: 'g1' });
    const keyed = await through(seat(), 'event', {}, { api_key: 'k' });
    const counter = await through(seat({ hat: 'act', whole_entity: false, can_see_costs: false }), 'event', {});
    assert.ok(granted.nexted && keyed.nexted && counter.nexted, 'all three pass on to the route\'s own gates');
    assert.strictEqual(world.prepared.length, 0);
  });

  await t('an unreadable setting never lets the entry through: the answer is a refusal, not a post', async () => {
    reset();
    world.readFails = true;
    const out = await through(seat(), 'event', {});
    assert.strictEqual(out.nexted, false);
    assert.strictEqual(out.status, 500);
    assert.strictEqual(world.prepared.length, 0);
  });

  await t('a refusal of the held entry in words (err.words) is answered as it is', async () => {
    reset();
    world.flag = 'on';
    const kept = action.prepareAction;
    action.prepareAction = async () => {
      throw Object.assign(new Error('x'), { code: 'ACTION_REF_OPEN', status: 409, words: 'An action with this reference is already waiting.' });
    };
    const out = await through(seat(), 'event', { client_ref: 'r3' });
    action.prepareAction = kept;
    assert.strictEqual(out.nexted, false);
    assert.strictEqual(out.status, 409);
  });

  await t('staff cannot prepare lock, unlock, year_close or reverse: refused before the queue is asked', async () => {
    const maker = { identity_id: seat().identity_id, name: 'Ravi', staff: true };
    for (const kind of ['lock', 'unlock', 'year_close', 'reverse']) {
      await assert.rejects(() => realPrepare(SHOP, maker, { kind, body: {}, client_ref: 'x' }, {}), (err) => err.code === 'ACTION_KIND_NOT_FOR_STAFF' && err.status === 403 && /owner/i.test(err.words), kind);
    }
  });

  await t('a firm (not staff) cannot prepare a Day book event: that kind is the shop\'s own staff', async () => {
    await assert.rejects(() => realPrepare(SHOP, { identity_id: 'f1', name: 'Firm', grant_id: 'g1' }, { kind: 'event', body: { kind: 'expense' }, client_ref: 'x' }, {}), (err) => err.code === 'ACTION_KIND_INVALID');
  });

  await t('the setting: one definition, default off, the owner\'s alone', async () => {
    const flags = require(path.join(HERE, 'lib', 'policy'));
    assert.strictEqual(flags.defaults().books_owner_approves, 'off');
    assert.ok(flags.refusalFor({ books_owner_approves: 'on' }, false), 'a staff login is refused');
    assert.strictEqual(flags.refusalFor({ books_owner_approves: 'on' }, true), null, 'the owner is not');
    assert.strictEqual(flags.FLAGS ? flags.FLAGS.books_owner_approves.options.join() : 'off,on', 'off,on');
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
