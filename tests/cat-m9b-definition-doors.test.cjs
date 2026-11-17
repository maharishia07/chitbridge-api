#!/usr/bin/env node
// @type: contract
/**
 * cat-m9b-definition-doors.test.cjs — M9b (12 Nov 2026): the definitions / rewards write doors are bounded.
 *
 * OWNS      CAT-272  a reward programme is refused (422 DEFINITION_INCOMPLETE) for a redeem amount of -1, redeem points of 0, expires_months of -1 or 1e9; a sound one (100 points = 1,
 *                    expires after 12 months) is created
 *           CAT-273  five PARALLEL rule saves of one definition all answer 200 with versions 2 to 6 (the row is locked while the next version is read and written; the losers used to
 *                    die on the version key and be reported as a name clash); a save made on an older version than the shelf holds is 409 DEFINITION_STALE and writes nothing;
 *                    a collision on the version key is DEFINITION_STALE, a collision on the name is still DEFINITION_NAME_TAKEN
 *           CAT-333  POST /freeze with 10,000 ids is 400 (at most 500), an id that is no uuid is 400, a uuid list of two still answers
 *           The stand-in database keeps ONE definition and its versions, holds a row lock for a SELECT ... FOR UPDATE until the UPDATE of that row, and refuses a version it already
 *           holds with the key violation (23505, definition_version_pkey), so the race is real in the stand-in and the lock is what the cases prove.
 * CALLED BY scripts/guards.cjs · CI. No database, no network (tests/lib/problem-world.cjs).
 * CARD      08-rewards-and-loyalty/README
 * Run: node tests/cat-m9b-definition-doors.test.cjs
 */
'use strict';
const path = require('path');
const express = require('express');
const { harness } = require('./lib/problem-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const lab = harness({ here: HERE, mounts: ['/api/definitions'], routeFiles: { '/api/definitions': 'routes/definitions.js' }, legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json') });
const { world, check } = lab;
let port = 0;

const DEF = '33333333-3333-4333-8333-333333333333';
const SHOP = '11111111-1111-4111-8111-111111111111';
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** one definition with a version history in memory, and the lock a SELECT ... FOR UPDATE takes until the row is updated */
function shelfWith(startVersion) {
  const state = { version: startVersion, versions: new Set(Array.from({ length: startVersion }, (v, i) => i + 1)), lock: null, saved: 0 };
  const rowOf = () => ({ definition_id: DEF, entity_id: SHOP, kind: 'reward', sub_kind: null, name: 'Points', note: null, status: 'live', current_version: state.version });
  state.sql = (sql, params) => {
    if (/^\s*SELECT \* FROM definition WHERE definition_id/.test(sql)) {
      const wantsLock = /FOR UPDATE/.test(sql);
      return (async () => {
        while (wantsLock && state.lock) await state.lock;
        if (wantsLock) {
          let release;
          state.lock = new Promise((done) => (release = done));
          state.release = release;
          setTimeout(() => state.release === release && (state.lock = null, state.release = null, release()), 80); /* a request that ends without an UPDATE (a refusal) ends its transaction: the lock goes with it */
        }
        const seen = rowOf(); /* what this save read: without the lock every parallel save reads the same version */
        await sleep(15);
        return { rows: [seen], rowCount: 1 };
      })();
    }
    if (/^\s*INSERT INTO definition_version/.test(sql)) {
      const version = params[1];
      if (state.versions.has(version)) throw Object.assign(new Error('duplicate key value violates unique constraint "definition_version_pkey"'), { code: '23505', constraint: 'definition_version_pkey' });
      state.versions.add(version);
      state.saved += 1;
      return { rows: [], rowCount: 1 };
    }
    if (/^\s*UPDATE definition\b/.test(sql)) {
      state.version = params[4];
      const row = rowOf();
      if (state.release) {
        const release = state.release;
        state.lock = null;
        state.release = null;
        release();
      }
      return { rows: [row], rowCount: 1 };
    }
    return null;
  };
  return state;
}
const ask = (method, url, body, rows) => {
  Object.assign(world, { realAuth: false, who: lab.world.who, asKey: false, db: 'ok', sqlRows: rows || null });
  return lab.send(port, method, url, body);
};
const D = '/api/definitions';
const words = (answer) => String((answer.json && (answer.json.detail || answer.json.message)) || '');
const code = (answer) => (answer.json && answer.json.code) || null;
const REWARD = { earn: { kind: 'per_amount', per: 100, points: 1 }, redeem: [{ kind: 'money', points: 100, amount: 1 }], expires_months: 12 };
const withRules = (more) => Object.assign({}, REWARD, more);
const create = (rules) => ask('POST', D, { kind: 'reward', name: 'Points ' + Math.random(), status: 'live', rules }, (sql) => (/^\s*INSERT INTO definition \(/.test(sql) ? { rows: [{ definition_id: DEF, kind: 'reward', status: 'live', current_version: 1 }], rowCount: 1 } : null));

async function rewardNumbers() {
  console.log('\n── CAT-272 · the numbers of a reward programme ──\n');
  /* hand: 100 points = 1 (money) is a sound rule; a redeem amount of -1 would ADD 0.01 to the bill per point; points 0 is worth nothing; 1e9 months overflows the date */
  let r = await create(withRules({ redeem: [{ kind: 'money', points: 100, amount: -1 }] }));
  check('redeem amount -1 → 422 DEFINITION_INCOMPLETE "needs an amount above 0"', r.status === 422 && code(r) === 'DEFINITION_INCOMPLETE' && /amount above 0/.test(words(r)), r.json);
  r = await create(withRules({ redeem: [{ kind: 'money', points: 0, amount: 1 }] }));
  check('redeem points 0 → 422', r.status === 422 && /points above 0/.test(words(r)), r.json);
  r = await create(withRules({ expires_months: -1 }));
  check('expires_months -1 → 422', r.status === 422 && /0 to 1200 months/.test(words(r)), r.json);
  r = await create(withRules({ expires_months: 1e9 }));
  check('expires_months 1e9 → 422 (it made every later call for the holder a 500)', r.status === 422 && /0 to 1200 months/.test(words(r)), r.json);
  r = await create(withRules({ expires_months: 1200 }));
  check('expires_months 1200 (100 years) → 201', r.status === 201, r.json);
  r = await create(REWARD);
  check('100 points = 1, expires after 12 months → 201 (control)', r.status === 201, r.json);
  r = await create(withRules({ redeem: [{ kind: 'thing', points: 20000, name: 'a weekend away' }] }));
  check('a named thing for 20,000 points (no amount) → 201', r.status === 201, r.json);
}

async function parallelSaves() {
  console.log('\n── CAT-273 · five parallel saves, a stale save, the two collisions ──\n');
  const shelf = shelfWith(1);
  const edit = (i) => ask('PUT', D + '/' + DEF, { rules: withRules({ expires_months: 12 + i }) }, shelf.sql);
  const answers = await Promise.all([0, 1, 2, 3, 4].map(edit));
  const versions = answers.map((a) => a.json && a.json.version).sort();
  check('5 parallel PUTs → five 200s, no 409', answers.every((a) => a.status === 200), answers.map((a) => a.status + ':' + code(a)));
  check('…with versions 2,3,4,5,6 (hand: 1 + 5 saves)', JSON.stringify(versions) === JSON.stringify([2, 3, 4, 5, 6]), versions);
  check('…and the shelf now holds version 6', shelf.version === 6, shelf.version);

  const old = shelfWith(4);
  let r = await ask('PUT', D + '/' + DEF, { expected_version: 1, rules: REWARD }, old.sql);
  check('made on version 1 while the shelf holds 4 → 409 DEFINITION_STALE naming both, nothing written', r.status === 409 && code(r) === 'DEFINITION_STALE' && /version 4, you had 1/.test(words(r)) && old.saved === 0, [r.status, code(r), words(r)]);
  r = await ask('PUT', D + '/' + DEF, { expected_version: 4, rules: REWARD }, old.sql);
  check('made on version 4 → 200, version 5', r.status === 200 && r.json.version === 5, r.json);
  r = await ask('PUT', D + '/' + DEF, { rules: REWARD }, old.sql);
  check('no expected_version said → saved as before (200, version 6)', r.status === 200 && r.json.version === 6, r.json);

  const { definitionFault } = require(path.join(HERE, 'lib', 'definitions-contract.js'));
  const pkey = definitionFault(Object.assign(new Error('x'), { code: '23505', constraint: 'definition_version_pkey' }), {}, { nameTaken: true });
  const name = definitionFault(Object.assign(new Error('x'), { code: '23505', constraint: 'definition_entity_kind_name_key' }), {}, { nameTaken: true });
  check('a collision on the VERSION key is DEFINITION_STALE (409)', pkey.status === 409 && pkey.code === 'DEFINITION_STALE', pkey);
  check('a collision on the NAME stays DEFINITION_NAME_TAKEN (409)', name.status === 409 && name.code === 'DEFINITION_NAME_TAKEN', name);
}

async function freezing() {
  console.log('\n── CAT-333 · the list a snapshot is made of ──\n');
  const uuid = (i) => '00000000-0000-4000-8000-' + String(i).padStart(12, '0');
  let r = await ask('POST', D + '/freeze', { definition_ids: Array.from({ length: 10000 }, (v, i) => uuid(i)) });
  check('10,000 ids → 400 "At most 500 definitions"', r.status === 400 && /At most 500 definitions/.test(words(r)), [r.status, words(r)]);
  r = await ask('POST', D + '/freeze', { definition_ids: Array.from({ length: 501 }, (v, i) => uuid(i)) });
  check('501 ids → 400 (the limit is 500)', r.status === 400, r.status);
  r = await ask('POST', D + '/freeze', { definition_ids: [uuid(1), 'not-an-id'] });
  check('an id that is no uuid → 400 "Every definition id must be an id from your shelf"', r.status === 400 && /must be an id from your shelf/.test(words(r)), [r.status, words(r)]);
  r = await ask('POST', D + '/freeze', { definition_ids: [uuid(1), uuid(2)] });
  check('two uuids that name nothing → 200, both missing', r.status === 200 && r.json.missing.length === 2, r.json);
  r = await ask('POST', D + '/freeze', { definition_ids: [] });
  check('an empty list → 200, nothing frozen (as before)', r.status === 200 && r.json.frozen.length === 0, r.json);
}

(async () => {
  console.log('\n══ M9b · the definitions and rewards doors are bounded ══');
  lab.installStubs();
  const app = express();
  app.use((req, res, next) => {
    req.id = 'req-test';
    next();
  });
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/definitions', require(path.join(HERE, 'routes', 'definitions.js')));
  const server = app.listen(0);
  port = server.address().port;
  try {
    await rewardNumbers();
    await parallelSaves();
    await freezing();
  } finally {
    server.close();
  }
  console.log('\n' + lab.count.passed + ' passed, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();
