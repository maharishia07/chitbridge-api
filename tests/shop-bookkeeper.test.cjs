#!/usr/bin/env node
// @type: unit
/**
 * tests/shop-bookkeeper.test.cjs — slice A of the shop Bookkeeper (walk 19 Nov W22/W25/W26, REQ-2026-11-19-shop-bookkeeper). No database, no network: the real routers over a stand-in db and auth.
 * OWNS      the preset (hat manager = the RC-7 in-house accountant, never shown as Regional manager) · the first-step answer (GET /events may.post) and the preview gate · every owner-only refusal
 *           as a Bookkeeper seat (coded OWNER_ONLY, words name the owner) · the opening: the accountant before the books run, the owner alone after · the five other presets unchanged
 * CALLED BY scripts/guards.cjs · CI
 */
'use strict';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.DATABASE_URL = '';
const path = require('path');
const http = require('http');
const express = require('express');
const assert = require('assert');

const HERE = path.join(__dirname, '..');
const SHOP = '11111111-1111-4111-8111-111111111111';
const PARTY = '22222222-2222-4222-8222-222222222222';
const SETTING_ROW = { entity_id: SHOP, enabled: true, walkin_grain: 'day', fy_start_month: 4, functional_currency: 'INR', country: 'IN', pack_version: '1', timezone: 'Asia/Kolkata' };
const seat = (extra) => Object.assign({ identity_id: '44444444-4444-4444-8444-444444444444', parent_entity_id: SHOP, identity_type: 'actor', access_level: 'editor', whole_entity: true, can_see_costs: true, hat: 'manager' }, extra);
const BOOKKEEPER = seat({});
const COUNTER = seat({ hat: 'act', whole_entity: false, can_see_costs: false });
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Test shop' };
const world = { who: BOOKKEEPER, trading: false };

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
const mock = (relative, exported) => {
  const file = require.resolve(path.join(HERE, relative));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exported };
};
function installStubs() {
  const realAuth = require(path.join(HERE, 'middleware', 'auth'));
  const stubAuth = (req, res, next) => {
    req.identity = world.who;
    return next();
  };
  mock('middleware/auth', Object.assign(stubAuth, realAuth, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id }));
  const rowsFor = (sql) => {
    if (/FROM books_setting/.test(sql)) return { rows: [SETTING_ROW], rowCount: 1 };
    if (/FROM journal_entry WHERE entity_id = \$1 AND period > 0/.test(sql)) return world.trading ? { rows: [{ '?column?': 1 }], rowCount: 1 } : { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 0 };
  };
  const client = { query: async (sql) => rowsFor(sql) };
  const known = { query: async (sql) => rowsFor(sql), withEntity: async (id, run) => run(client), withTransaction: async (run) => run(client), readBatch: async () => [{ rows: [], rowCount: 0 }] };
  const db = new Proxy(known, { get: (target, name) => (name in target ? target[name] : typeof name === 'symbol' || name === 'then' ? undefined : async () => ({ rows: [], rowCount: 0 })) });
  mock('db', db);
  mock('db/index', db);
  mock('lib/country-setup', { COUNTRY_FIRST: 'Set the country first.', registrationOfShop: async () => 'unknown', registrationWord: (a) => a, registrationAsk: () => ({}), currencyStated: (...v) => v.find((x) => typeof x === 'string' && x.trim()) || null, gate: async () => ({ books: true, code: null, country: 'IN' }), status: async () => ({ books: true, code: null, country: 'IN' }) });
  console.error = () => undefined;
}
function send(port, method, urlPath, body) {
  return new Promise((resolve) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const headers = { 'idempotency-key': 'k' + Math.random() };
    if (data) Object.assign(headers, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) });
    const request = http.request({ port, path: urlPath, method, headers }, (response) => {
      let text = '';
      response.on('data', (part) => (text += part));
      response.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(text);
        } catch (e) {
          json = null;
        }
        resolve({ status: response.statusCode, json });
      });
    });
    request.setTimeout(4000, () => {
      request.destroy();
      resolve({ status: 0, json: null });
    });
    request.on('error', () => {});
    if (data) request.write(data);
    request.end();
  });
}

(async () => {
  console.log('\nshop Bookkeeper, slice A');
  const access = require('../lib/access');

  await t('presets: facts + hat manager = Bookkeeper; the same facts with hat act (or no hat) stay Regional manager', () => {
    assert.strictEqual(access.presetFor('editor', true, true, false, 'manager').key, 'bookkeeper');
    assert.strictEqual(access.presetFor('editor', true, true, false, 'act').key, 'regional');
    assert.strictEqual(access.presetFor('editor', true, true).key, 'regional');
    const kept = access.PRESETS.find((x) => x.key === 'bookkeeper');
    assert.strictEqual(kept.hat, 'manager');
    assert.strictEqual(kept.label, 'Bookkeeper');
  });
  await t('presets: the other five keep today\'s answer (hat does not move them)', () => {
    const want = { auditor: ['commenter', true, true], reports: ['commenter', true, false], view_only: ['viewer', false, false], counter: ['editor', false, false] };
    Object.keys(want).forEach((key) => {
      ['act', 'manager', 'audit', 'mis', 'view_only', undefined].forEach((hat) => {
        assert.strictEqual(access.presetFor(want[key][0], want[key][1], want[key][2], false, hat).key, key, key + ' with hat ' + hat);
      });
    });
  });
  await t('presets: a firm\'s own Bookkeeper (practice words) is not changed by the hat', () => {
    assert.strictEqual(access.presetFor('editor', true, true, true, 'manager').key, 'bookkeeper');
    assert.match(access.presetFor('editor', true, true, true, 'act').label, /does the work/);
  });
  await t('GET /api/actors names the seat: preset "bookkeeper" for hat manager, "regional" for hat act', () => {
    const { listedActor } = require('../lib/actors-contract');
    const row = (hat) => ({ access_level: 'editor', whole_entity: true, can_see_costs: true, hat, connector_config: null });
    assert.strictEqual(listedActor(row('manager')).preset, 'bookkeeper');
    assert.strictEqual(listedActor(row('act')).preset, 'regional');
  });
  await t('Add a person: the picker offers Bookkeeper with the hat it is written with; the people list says "Bookkeeper"', () => {
    const people = require('../lib/people');
    const base = { actor_key: 'ravi', display_name: 'Ravi', break_status: 'active', status: 'active', access_level: 'editor', whole_entity: true, can_see_costs: true, hat: 'manager', identity_id: PARTY };
    const out = people.view([base], { owner: true, country: 'IN', firm: false });
    const choice = out.access_choices.find((x) => x.key === 'bookkeeper');
    assert.ok(choice, 'offered');
    assert.strictEqual(choice.hat, 'manager');
    assert.strictEqual(out.people[0].access.label, 'Bookkeeper');
    assert.strictEqual(out.access_choices.filter((x) => x.hat).length, 1, 'only the Bookkeeper is pinned to a hat');
  });

  installStubs();
  const books = require(path.join(HERE, 'routes', 'books.js'));
  const app = express();
  app.use((req, res, next) => {
    req.id = 'req-test';
    next();
  });
  app.use(express.json());
  app.use('/api/books', books);
  const server = app.listen(0);
  const port = server.address().port;
  const as = (who, trading) => {
    world.who = who;
    world.trading = !!trading;
  };

  await t('first step: GET /events tells a Bookkeeper and the owner they may post (may.post.ok), a Counter staff seat not, with a code', async () => {
    as(BOOKKEEPER);
    const mine = await send(port, 'GET', '/api/books/events');
    assert.strictEqual(mine.status, 200, JSON.stringify(mine.json));
    assert.strictEqual(mine.json.may.post.ok, true);
    as(OWNER);
    assert.strictEqual((await send(port, 'GET', '/api/books/events')).json.may.post.ok, true);
    as(COUNTER);
    const refused = await send(port, 'GET', '/api/books/events');
    assert.strictEqual(refused.json.may.post.ok, false);
    assert.strictEqual(refused.json.may.post.code, 'OWNER_ONLY');
    assert.match(refused.json.may.post.why, /owner/i);
  });
  await t('preview: a Bookkeeper\'s preview no longer carries "Only the owner may record this."; a Counter staff seat\'s still does', async () => {
    const body = { event: { kind: 'expense', class: 'rent', amount_minor: 500000, paid_from: 'cash' } }; /* a built event: the refusal words come after the build, so the body must be valid */
    as(BOOKKEEPER);
    const mine = await send(port, 'POST', '/api/books/preview', body);
    assert.ok(!(mine.json && JSON.stringify(mine.json.refusals || []).includes('Only the owner may record this.')), JSON.stringify(mine.json).slice(0, 300));
    as(COUNTER);
    const other = await send(port, 'POST', '/api/books/preview', body);
    assert.ok(other.json && JSON.stringify(other.json.refusals || []).includes('Only the owner may record this.'), JSON.stringify(other.json).slice(0, 300));
  });
  await t('POST /events and /entries are not refused at the gate for a Bookkeeper; a Counter staff seat is OWNER_ONLY', async () => {
    as(BOOKKEEPER);
    for (const route of ['/api/books/events', '/api/books/entries', '/api/books/entries/' + PARTY + '/reverse']) {
      const got = await send(port, 'POST', route, { event: 'expense', narration: 'x', lines: [], reason: 'x' });
      assert.notStrictEqual(got.status, 403, route + ' ' + JSON.stringify(got.json));
    }
    as(COUNTER);
    for (const route of ['/api/books/events', '/api/books/entries', '/api/books/entries/' + PARTY + '/reverse']) {
      const got = await send(port, 'POST', route, { event: 'expense' });
      assert.strictEqual(got.status, 403, route);
      assert.strictEqual(got.json.code, 'OWNER_ONLY');
    }
  });

  const OWNER_ONLY_DOORS = [
    ['POST', '/api/books/periods/2026-27/6/lock', 'lock a month'],
    ['POST', '/api/books/periods/2026-27/6/unlock', 'unlock a month'],
    ['POST', '/api/books/year/2026-27/close', 'close the year'],
    ['POST', '/api/books/write-off', 'write off'],
    ['POST', '/api/books/setting', 'books settings'],
    ['POST', '/api/books/terms', 'terms'],
    ['POST', '/api/books/accounts', 'add an account'],
    ['POST', '/api/books/enable', 'switch the ledger on'],
    ['POST', '/api/books/move-in/import', 'move in'],
    ['POST', '/api/books/recurring', 'recurring']
  ];
  for (const [method, url, what] of OWNER_ONLY_DOORS) {
    await t('Bookkeeper refused: ' + what + ' — 403 OWNER_ONLY, in words naming the owner', async () => {
      as(BOOKKEEPER);
      const got = await send(port, method, url, {});
      assert.strictEqual(got.status, 403, JSON.stringify(got.json));
      assert.strictEqual(got.json.code, 'OWNER_ONLY');
      assert.match(got.json.detail, /owner/i);
    });
  }
  await t('no door that files a return is open to the owner\'s accountant: every POST route with "return"/"file"/"lodge" in its path is owner-gated or absent', () => {
    const doors = books.stack.filter((layer) => layer.route && layer.route.methods.post && /return|lodge|\/file\b/.test(layer.route.path));
    doors.forEach((layer) => {
      const gates = layer.route.stack.map((s) => s.handle.name);
      assert.ok(!gates.includes('ownerOrAccountant'), layer.route.path + ' is open to the accountant');
    });
  });

  await t('opening: the accountant may type it before the books run, the owner alone once anything is posted', async () => {
    const body = { rows: [] }; /* the gate runs first: an empty body reaches the handler's own 400 */
    as(BOOKKEEPER, false);
    const before = await send(port, 'POST', '/api/books/opening', body);
    assert.notStrictEqual(before.status, 403, JSON.stringify(before.json));
    as(BOOKKEEPER, true);
    const after = await send(port, 'POST', '/api/books/opening', body);
    assert.strictEqual(after.status, 403);
    assert.strictEqual(after.json.code, 'OWNER_ONLY');
    assert.match(after.json.detail, /only the owner/i);
    as(OWNER, true);
    const owner = await send(port, 'POST', '/api/books/opening', body);
    assert.notStrictEqual(owner.status, 403, 'the owner is never asked');
  });

  server.close();

  await t('grants and people stay the owner\'s: every write door of routes/actors.js and the books-grants router carries the owner gate', () => {
    const owners = (router) => router.stack.filter((layer) => layer.route && Object.keys(layer.route.methods).some((m) => m !== 'get')).map((layer) => ({ path: layer.route.path, roles: layer.route.stack.map((s) => s.handle.roleGate).filter(Boolean) }));
    const files = ['routes/actors.js', 'routes/books-grants.js'].filter((file) => require('fs').existsSync(path.join(HERE, file)));
    assert.ok(files.length >= 1);
    files.forEach((file) => {
      const rows = owners(require(path.join(HERE, file)));
      const open = rows.filter((row) => !row.roles.includes('owner'));
      /* the self-service writes of a person (own PIN, own profile) are the only exceptions: they are not about who sees the books */
      const allowed = /^\/(practice\/baseline|login|suggest-key|set-pin|change-pin|break|assign\/:chit_id)$/; /* a person's own PIN and break, the key suggestion, the assign door: none changes who may see the books */
      const bad = open.filter((row) => !allowed.test(row.path));
      assert.deepStrictEqual(bad.map((x) => file + ' ' + x.path), [], 'doors without the owner gate');
    });
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
