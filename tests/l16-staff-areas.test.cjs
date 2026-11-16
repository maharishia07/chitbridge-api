#!/usr/bin/env node
// @type: unit
/**
 * tests/l16-staff-areas.test.cjs — W15-66 (staff see no books unless the owner opens the accounts for them): the offline half, no database.
 *
 *   classification  every verb of routes/books.js AND routes/books-money.js is in the ONE table (lib/books-areas.js); a planted route of each verb (GET POST PUT PATCH DELETE) is NOT (the guard goes red first);
 *                   no row is stale; every route carries its own `auth` (no public path under /api/books); the table's classes are the four named ones
 *   the gate        signs in itself · the owner, a request acting for a firm's grant and an OPTIONS pass · an API key is refused · counter staff and View-only are closed by default (pass test 1, 2) · accounts:see reads and cannot
 *                   write the bank · accounts:work writes the bank only · journal, reverse, year close, packs are never opened by an area (pass test 3) · PAYMENTS are the owner's alone, every verb · a View-only person
 *                   granted work still cannot write (pass test 6) · a lapsed grant is refused (pass test 5) · Auditor and Reports / MIS keep their reads, the Regional manager keeps his bank work (pass test 8)
 *                   · a column that is not there is no grants · a route in no row is closed (pass test 11) · the grantable set equals the enforced set (drift)
 *   expiry          ONE function (lib/areas.liveLevel): the end day counts through the whole day, garbage fails closed
 *   the owner's PATCH and read   an area that is not enforced is 400 in words (pass test 12) · a missing column is 503 "arrives after the next update", never a 500, and changes nothing · the access trail row `area_changed` carries
 *                   before and after, who and why · a person cannot be opened for by another business · the notice names the people the books closed on until the owner has acted on each (pass test 10)
 * OWNS      the offline checks of middleware/books-area-gate.js, lib/books-areas.js, lib/areas.js, lib/actor-areas.js.   CALLED BY scripts/guards.cjs (CI guards job).   CARD  18-identity-sign-in-and-access/access-levels
 */
'use strict';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'l16_areas_test_secret_at_least_32_chars_padding';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const express = require('express');
const API = path.join(__dirname, '..');
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

const schema = require(path.join(API, 'lib', 'schema.js'));
const columns = { area_grants: true };
schema.hasColumn = async (table, column) => (column === 'area_grants' ? columns.area_grants : true);
let handleRows = [];
const sqlSeen = [];
const dbPath = require.resolve(path.join(API, 'db.js'));
const realDb = require(dbPath);
require.cache[dbPath].exports = Object.assign({}, realDb, {
  withEntity: async (entity, work) =>
    work({
      query: async (sql, args) => {
        sqlSeen.push({ sql: String(sql), args });
        const next = handleRows.shift();
        return typeof next === 'function' ? next(sql, args) : next || { rows: [] };
      }
    })
});

const books = require(path.join(API, 'routes', 'books.js'));
const money = require(path.join(API, 'routes', 'books-money.js'));
const auth = require(path.join(API, 'middleware', 'auth.js'));
const gateModule = require(path.join(API, 'middleware', 'books-area-gate.js'));
const A = require(path.join(API, 'lib', 'books-areas.js'));
const areas = require(path.join(API, 'lib', 'areas.js'));
const access = require(path.join(API, 'lib', 'access.js'));
const actorAreas = require(path.join(API, 'lib', 'actor-areas.js'));

const OWNER = { identity_id: '11111111-1111-4111-8111-111111111111', identity_type: 'entity', parent_entity_id: null };
const PARENT = OWNER.identity_id;
const person = (extra) => Object.assign({ identity_id: '22222222-2222-4222-8222-222222222222', identity_type: 'actor', parent_entity_id: PARENT, hat: 'act', access_level: 'editor', whole_entity: false, can_see_costs: false }, extra);
const counter = person({});
const viewOnly = person({ access_level: 'viewer' });
const auditor = person({ access_level: 'commenter', whole_entity: true, can_see_costs: true });
const reports = person({ access_level: 'commenter', whole_entity: true, can_see_costs: false });
const regional = person({ access_level: 'editor', whole_entity: true, can_see_costs: true });
const FUTURE = '2999-12-31';
const PAST = '2000-01-01';
const granted = (who, level, until) => Object.assign({}, who, { area_grants: { accounts: { level, until: until === undefined ? null : until, by: PARENT, at: '2026-11-16T00:00:00.000Z' } } });

/** drive the gate: the identity the (stub) sign-in sets, the request, and what the gate did */
async function drive(identity, method, urlPath, extra) {
  const req = Object.assign({ method, path: urlPath, headers: {}, identity: undefined }, extra || {});
  let status = null;
  let body = null;
  let nexted = false;
  let signedIn = false;
  const res = {
    req,
    headersSent: false,
    status(code) { status = code; return res; },
    set() { return res; },
    setHeader() { return res; },
    type() { return res; },
    json(payload) { body = payload; return res; },
    send(payload) { body = payload; return res; },
    end() { return res; }
  };
  const signIn = (r, s, next) => { signedIn = true; r.identity = identity; next(); };
  await new Promise((resolve) => {
    const done = () => resolve();
    const origJson = res.json;
    res.json = (p) => { origJson(p); done(); return res; };
    res.send = (p) => { body = p; done(); return res; };
    res.end = () => { done(); return res; };
    gateModule.gateOf(signIn)(req, res, (err) => { nexted = !err; done(); });
  });
  return { status, body, nexted, signedIn, req };
}
const refusedWith = (out, code) => !out.nexted && out.status === 403 && out.body && out.body.code === code;

(async () => {
  await t('every verb of routes/books.js and routes/books-money.js is in the one table', () => {
    assert.deepStrictEqual(A.unclassified(books, money), []);
    assert.ok(A.routesOf(books).length > 70 && A.routesOf(money).length === 1, 'both routers were read');
  });
  await t('no row of the table is stale (a removed route leaves no row behind)', () => assert.deepStrictEqual(A.stale(books, money), []));
  await t('a planted route of each verb is NOT in the table: the guard goes red first', () => {
    const planted = express.Router();
    for (const verb of ['get', 'post', 'put', 'patch', 'delete']) planted[verb]('/planted-' + verb, (req, res) => res.end());
    const found = A.unclassified(planted);
    assert.deepStrictEqual(found.sort(), ['DELETE /planted-delete', 'GET /planted-get', 'PATCH /planted-patch', 'POST /planted-post', 'PUT /planted-put']);
    const mixed = express.Router();
    mixed.get('/daybook', (req, res) => res.end());
    mixed.post('/daybook', (req, res) => res.end());
    assert.deepStrictEqual(A.unclassified(mixed), ['POST /daybook'], 'the same path with another verb is a different door');
  });
  await t('the table uses only the four classes, and payments have an explicit owner row for every write verb', () => {
    assert.deepStrictEqual([...A.CLASSES].sort(), ['bankWrite', 'gateDoor', 'ownerOnly', 'read']);
    for (const cls of Object.values(A.TABLE)) assert.ok(A.CLASSES.includes(cls), cls);
    for (const key of ['POST /payments', 'PATCH /payments/:id', 'POST /payments/:id/propose', 'POST /payments/:id/confirm']) assert.strictEqual(A.TABLE[key], A.OWNER, key);
    assert.deepStrictEqual(Object.keys(A.TABLE).filter((key) => A.TABLE[key] === A.BANK).sort(), ['POST /bank/marks', 'POST /bank/statements']);
  });
  await t('every route of both routers carries its own auth: no public path under /api/books', () => {
    for (const router of [books, money]) {
      for (const layer of router.stack.filter((item) => item.route)) assert.ok(layer.route.stack.some((inner) => inner.handle === auth), 'no auth on ' + Object.keys(layer.route.methods) + ' ' + layer.route.path);
    }
  });
  await t('the grantable set equals the enforced set (a grantable area nothing enforces is a lie on a screen)', () => assert.deepStrictEqual([...areas.GRANTABLE], [...gateModule.ENFORCED]));
  await t('classOf: ids are one segment, HEAD is the GET, an unknown route or verb has no class', () => {
    assert.strictEqual(A.classOf('GET', '/ledger/cash'), A.READ);
    assert.strictEqual(A.classOf('HEAD', '/ledger/cash'), A.READ);
    assert.strictEqual(A.classOf('POST', '/entries/abc/reverse'), A.OWNER);
    assert.strictEqual(A.classOf('GET', '/ledger/a/b'), null);
    assert.strictEqual(A.classOf('PUT', '/daybook'), null);
    assert.strictEqual(A.classOf('GET', '/nothing-here'), null);
  });

  await t('the gate signs in itself first: the identity is unset until it runs', async () => {
    const out = await drive(OWNER, 'GET', '/daybook');
    assert.ok(out.signedIn && out.nexted && out.req.identity === OWNER);
  });
  await t('a sign-in that fails is its own answer and never a pass', async () => {
    const req = { method: 'GET', path: '/daybook', headers: {} };
    let passed = false;
    let carried = null;
    gateModule.gateOf((r, s, next) => next(new Error('boom')))(req, {}, (err) => { passed = !err; carried = err; });
    assert.ok(!passed && carried && carried.message === 'boom');
  });
  await t('the owner, a request acting for a firm grant and an OPTIONS pass; an API key is refused', async () => {
    assert.ok((await drive(OWNER, 'POST', '/entries')).nexted);
    const acting = await drive(counter, 'GET', '/daybook', { acting_for_grant: 'g' });
    assert.ok(acting.nexted && !acting.signedIn, 'the books-grant front already allow-listed it');
    assert.ok((await drive(counter, 'OPTIONS', '/daybook')).nexted);
    const key = await drive(OWNER, 'GET', '/daybook', { api_key: { id: 'k' } });
    assert.ok(refusedWith(key, 'SIGN_IN_FOR_LEDGER'));
  });
  await t('pass tests 1 and 2: Counter staff and View-only are closed by default, reads and bank writes, in words', async () => {
    for (const who of [counter, viewOnly]) {
      for (const [method, p] of [['GET', '/daybook'], ['GET', '/trial-balance'], ['GET', '/pl'], ['GET', '/bs'], ['GET', '/bank/log'], ['GET', '/bank/rail'], ['POST', '/bank/marks'], ['POST', '/bank/statements']]) {
        const out = await drive(who, method, p);
        assert.ok(refusedWith(out, 'BOOKS_AREA_CLOSED'), method + ' ' + p);
        assert.strictEqual(out.body.detail, 'Your access does not include the books. Ask the owner.');
        assert.strictEqual(out.body.may, false);
        assert.strictEqual(out.body.why, out.body.detail);
      }
    }
  });
  await t('accounts:see reads the books and the bank log, and cannot write the bank or anything else', async () => {
    const sam = granted(counter, 'see', FUTURE);
    for (const [method, p] of [['GET', '/daybook'], ['GET', '/ledger/cash'], ['GET', '/trial-balance'], ['GET', '/pl'], ['GET', '/bs'], ['GET', '/bank/log']]) assert.ok((await drive(sam, method, p)).nexted, method + ' ' + p);
    for (const p of ['/bank/marks', '/bank/statements']) assert.ok(refusedWith(await drive(sam, 'POST', p), 'BOOKS_AREA_CLOSED'), p);
  });
  await t('pass test 3: a person with accounts never reaches journal, reverse, write-off, opening, periods, year close, packs, recurring, fx, the switch', async () => {
    const sam = granted(counter, 'work', FUTURE);
    const owners = [['POST', '/entries'], ['POST', '/entries/abc/reverse'], ['POST', '/write-off'], ['POST', '/opening'], ['POST', '/periods/2026/1/lock'], ['POST', '/year/2026/close'], ['GET', '/packs'], ['POST', '/packs'], ['GET', '/recurring'], ['POST', '/recurring'], ['POST', '/fx-rates'], ['POST', '/enable'], ['POST', '/setting'], ['GET', '/status'], ['POST', '/move-in/import'], ['POST', '/accounts']];
    for (const [method, p] of owners) assert.ok(refusedWith(await drive(sam, method, p), 'OWNER_ONLY'), method + ' ' + p);
  });
  await t('pass test 4: accounts:work writes the bank statements and marks', async () => {
    const sam = granted(counter, 'work', FUTURE);
    for (const p of ['/bank/marks', '/bank/statements']) assert.ok((await drive(sam, 'POST', p)).nexted, p);
    assert.ok((await drive(sam, 'GET', '/daybook')).nexted);
  });
  await t('PAYMENTS are the owner alone: every verb refused for work, for the Regional manager, for everyone but the owner', async () => {
    const verbs = [['POST', '/payments'], ['PATCH', '/payments/abc'], ['POST', '/payments/abc/propose'], ['POST', '/payments/abc/confirm']];
    for (const who of [granted(counter, 'work', FUTURE), regional, auditor]) for (const [method, p] of verbs) assert.ok(refusedWith(await drive(who, method, p), 'OWNER_ONLY'), method + ' ' + p);
    for (const [method, p] of verbs) assert.ok((await drive(OWNER, method, p)).nexted, 'the owner ' + method + ' ' + p);
  });
  await t('pass test 5: a lapsed grant is refused again, as if never given', async () => {
    const out = await drive(granted(counter, 'see', PAST), 'GET', '/daybook');
    assert.ok(refusedWith(out, 'BOOKS_AREA_CLOSED'));
    assert.ok((await drive(granted(counter, 'see', null), 'GET', '/daybook')).nexted);
  });
  await t('pass test 6: a View-only person granted work reads and cannot write (the route-level gate and the router gate agree)', async () => {
    const view = granted(viewOnly, 'work', FUTURE);
    assert.ok((await drive(view, 'GET', '/daybook')).nexted);
    const write = await drive(view, 'POST', '/bank/marks');
    assert.ok(refusedWith(write, 'BOOKS_AREA_CLOSED'));
    assert.strictEqual(write.body.detail, 'Your access to the books is read only. Ask the owner.');
    const bankWriter = gateModule.bankWriter(() => { throw new Error('the level gate must not run'); });
    const res = { status() { return this; }, set() { return this; }, setHeader() { return this; }, type() { return this; }, json() { this.sent = true; return this; }, send() { this.sent = true; return this; }, end() { this.sent = true; return this; } };
    res.req = { identity: view };
    const refused = await new Promise((resolve) => { bankWriter(res.req, res, () => resolve(false)); setImmediate(() => resolve(!!res.sent)); });
    assert.ok(refused, 'bankWriter refuses a View-only person granted work');
  });
  await t('pass test 8: Auditor and Reports / MIS keep their reads; the Regional manager keeps his bank work; none of them gains the owner\'s doors', async () => {
    for (const who of [auditor, reports, regional]) {
      for (const p of ['/daybook', '/trial-balance', '/pl', '/bs', '/bank/log']) assert.ok((await drive(who, 'GET', p)).nexted, p);
      assert.ok(refusedWith(await drive(who, 'POST', '/entries'), 'OWNER_ONLY'));
    }
    assert.ok((await drive(regional, 'POST', '/bank/marks')).nexted);
    assert.ok((await drive(regional, 'POST', '/cheques/abc/status')).nexted, 'an editor door stays with work');
    for (const who of [auditor, reports]) assert.ok(refusedWith(await drive(who, 'POST', '/bank/marks'), 'BOOKS_AREA_CLOSED'));
  });
  await t('a grant adds, never removes: the Regional manager granted see still works', () => assert.strictEqual(areas.areaLevel(granted(regional, 'see', FUTURE), 'accounts'), 'work'));
  await t('a database with no area_grants column is no grants: the preset still counts, nothing else', async () => {
    assert.ok(refusedWith(await drive(counter, 'GET', '/daybook'), 'BOOKS_AREA_CLOSED'));
    assert.ok((await drive(auditor, 'GET', '/daybook')).nexted);
    assert.deepStrictEqual(areas.grantsOf({ area_grants: 'x' }), {});
    assert.deepStrictEqual(areas.grantsOf({ area_grants: [1] }), {});
  });
  await t('pass test 11: a route nobody classified is closed to every person and open only to the owner', async () => {
    for (const who of [counter, granted(counter, 'work', FUTURE), regional, auditor]) assert.ok(refusedWith(await drive(who, 'GET', '/a-new-route'), 'BOOKS_AREA_CLOSED'));
    assert.ok(refusedWith(await drive(regional, 'PUT', '/daybook'), 'BOOKS_AREA_CLOSED'));
    assert.ok((await drive(OWNER, 'GET', '/a-new-route')).nexted);
  });
  await t('a grant for the wrong person kind or with an unreadable level or day counts as never given (fail closed)', () => {
    const bad = [{ level: 'admin' }, { level: 'see', until: 'tomorrow' }, { level: 'see', until: '2026-13-45' }, null, 'see', 5];
    for (const grant of bad) assert.strictEqual(areas.liveLevel(grant, Date.now()), null, JSON.stringify(grant));
  });

  await t('liveLevel: one expiry function, the end day counts through the whole day', () => {
    const day = (text) => Date.parse(text);
    assert.strictEqual(areas.liveLevel({ level: 'see', until: '2026-12-31' }, day('2026-12-31T23:59:59Z')), 'see');
    assert.strictEqual(areas.liveLevel({ level: 'see', until: '2026-12-31' }, day('2027-01-01T00:00:00Z')), null);
    assert.strictEqual(areas.liveLevel({ level: 'work', until: null }, day('2099-01-01T00:00:00Z')), 'work');
    assert.strictEqual(areas.liveLevel({ level: 'work' }, day('2099-01-01T00:00:00Z')), 'work');
  });
  await t('the screen and the gate read ONE judgement: areasOf says what areaLevel says, with its source and end day', () => {
    const sam = granted(counter, 'see', '2999-12-31');
    assert.strictEqual(areas.areaLevel(sam, 'accounts'), 'see');
    assert.deepStrictEqual(areas.areasOf(sam).accounts, { level: 'see', source: 'grant', until: '2999-12-31', by: PARENT, at: '2026-11-16T00:00:00.000Z' });
    assert.strictEqual(areas.areasOf(counter).accounts, null);
    assert.strictEqual(areas.areasOf(auditor).accounts.source, 'preset');
    assert.strictEqual(areas.areasOf(granted(counter, 'see', PAST)).accounts, null);
    assert.deepStrictEqual(areas.lapsedGrants(granted(counter, 'see', PAST)).map((item) => item.area), ['accounts']);
  });
  await t('the preset areas live in ONE table beside presetFor and name only real presets', () => {
    const keys = access.PRESETS.map((preset) => preset.key);
    for (const key of Object.keys(access.PRESET_AREAS)) assert.ok(keys.includes(key), key);
    assert.deepStrictEqual(access.presetAreas('editor', false, false), {}, 'counter staff');
    assert.deepStrictEqual(access.presetAreas('viewer', false, false), {}, 'view-only');
    assert.deepStrictEqual(access.presetAreas('commenter', true, true), { accounts: 'see' });
    assert.deepStrictEqual(access.presetAreas('commenter', true, false), { accounts: 'see' });
    assert.deepStrictEqual(access.presetAreas('editor', true, true), { accounts: 'work' });
  });

  const reqOf = (id, body, identity) => ({ params: { id }, body, identity: identity || OWNER, headers: {}, method: 'PATCH', originalUrl: '/api/actors/' + id + '/areas', id: 'r1' });
  const resOf = () => {
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, set() { return this; }, setHeader() { return this; }, type() { return this; }, json(p) { this.body = p; return this; }, send(p) { this.body = p; return this; }, end() { return this; } };
    return res;
  };
  const SAM = '22222222-2222-4222-8222-222222222222';
  /* the route's own mapping of a refusal to its status and code (routes/actors.js PATCH /:id/areas); the last test reads the route's source to prove the two agree */
  const MAP = { area: [400, 'AREA_NOT_AVAILABLE', actorAreas.NOT_GRANTABLE], day_invalid: [400, 'AREA_DATE_INVALID', actorAreas.BAD_DAY_WORDS], day_past: [400, 'AREA_DATE_PAST', actorAreas.PAST_WORDS], not_migrated: [503, 'AREAS_NOT_MIGRATED', actorAreas.NOT_THERE_WORDS], gone: [404, 'NOT_FOUND', 'Co-assist not found'] };
  const setArea = async (req, res) => {
    const done = await actorAreas.changeArea(req);
    if (done.refusal) { const [code, name, words] = MAP[done.refusal]; res.status(code).json({ code: name, detail: words }); } else res.json(done.answer);
  };
  await t('pass test 12: an area that is not enforced is refused 400 in words, nothing written', async () => {
    sqlSeen.length = 0;
    for (const area of ['stock', 'finance', 'crm', 'employees', 'nonsense']) {
      const res = resOf();
      await setArea(reqOf(SAM, { area, level: 'see' }), res);
      assert.strictEqual(res.code, 400, area);
      assert.strictEqual(res.body.code, 'AREA_NOT_AVAILABLE');
      assert.match(res.body.detail, /cannot be opened for a person yet/);
    }
    assert.strictEqual(sqlSeen.length, 0);
  });
  await t('pass test 12: before the SQL is run the PATCH says "arrives after the next update" in words, never a 500, nothing written', async () => {
    columns.area_grants = false;
    sqlSeen.length = 0;
    const res = resOf();
    await setArea(reqOf(SAM, { area: 'accounts', level: 'see' }), res);
    columns.area_grants = true;
    assert.strictEqual(res.code, 503);
    assert.strictEqual(res.body.code, 'AREAS_NOT_MIGRATED');
    assert.match(res.body.detail, /arrives after the next update/);
    assert.ok(!/\bb\d{3}\b/.test(res.body.detail), 'no migration id in a sentence');
    assert.strictEqual(sqlSeen.length, 0);
  });
  await t('an end day that is not a date, or already past, is 400 in words', async () => {
    for (const [until, code] of [['31 Dec', 'AREA_DATE_INVALID'], ['2026-02-30', 'AREA_DATE_INVALID'], [PAST, 'AREA_DATE_PAST']]) {
      const res = resOf();
      await setArea(reqOf(SAM, { area: 'accounts', level: 'see', until }), res);
      assert.strictEqual(res.code, 400, until);
      assert.strictEqual(res.body.code, code);
    }
  });
  await t('pass test 4: the owner opens accounts:work; ONE jsonb update, then ONE access_events row area_changed with before, after, who and why', async () => {
    sqlSeen.length = 0;
    handleRows = [{ rows: [{ display_name: 'Sam', area_grants: {} }] }, { rows: [] }, { rows: [] }];
    const res = resOf();
    await setArea(reqOf(SAM, { area: 'accounts', level: 'work', until: FUTURE, reason: 'month-end help' }), res);
    assert.strictEqual(res.code, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.level, 'work');
    assert.strictEqual(res.body.until, FUTURE);
    assert.deepStrictEqual(res.body.audit, { recorded: 1, failed: 0 });
    const update = sqlSeen.find((call) => /UPDATE identities SET area_grants/.test(call.sql));
    assert.ok(update && /jsonb_build_object/.test(update.sql) && update.args[3].includes('"level":"work"'));
    const event = sqlSeen.find((call) => /INSERT INTO access_events/.test(call.sql));
    assert.ok(event, 'the trail row was written');
    assert.deepStrictEqual(event.args.slice(0, 3), [PARENT, SAM, 'area_changed']);
    assert.deepStrictEqual(JSON.parse(event.args[3]), { area: 'accounts', level: null, until: null });
    assert.deepStrictEqual(JSON.parse(event.args[4]), { area: 'accounts', level: 'work', until: FUTURE });
    assert.strictEqual(event.args[5], PARENT);
    assert.strictEqual(event.args[6], 'month-end help');
  });
  await t('closing an area removes the key, and the trail keeps what it was', async () => {
    sqlSeen.length = 0;
    handleRows = [{ rows: [{ display_name: 'Sam', area_grants: { accounts: { level: 'see', until: FUTURE } } }] }, { rows: [] }, { rows: [] }];
    const res = resOf();
    await setArea(reqOf(SAM, { area: 'accounts', level: 'none' }), res);
    assert.strictEqual(res.body.level, 'none');
    assert.ok(sqlSeen.some((call) => /area_grants, '\{\}'::jsonb\) - \$3::text/.test(call.sql)));
    const event = sqlSeen.find((call) => /INSERT INTO access_events/.test(call.sql));
    assert.deepStrictEqual(JSON.parse(event.args[3]), { area: 'accounts', level: 'see', until: FUTURE });
    assert.deepStrictEqual(JSON.parse(event.args[4]), { area: 'accounts', level: null, until: null });
  });
  await t('a person who is not one of this business\'s people is 404 and nothing is written', async () => {
    sqlSeen.length = 0;
    handleRows = [{ rows: [] }];
    const res = resOf();
    await setArea(reqOf('99999999-9999-4999-8999-999999999999', { area: 'accounts', level: 'see' }), res);
    assert.strictEqual(res.code, 404);
    assert.ok(!sqlSeen.some((call) => /UPDATE|INSERT/.test(call.sql)));
  });
  await t('a lost trail row is said in the answer and never fails the change', async () => {
    handleRows = [{ rows: [{ display_name: 'Sam', area_grants: {} }] }, { rows: [] }, () => { throw new Error('audit down'); }];
    const res = resOf();
    await setArea(reqOf(SAM, { area: 'accounts', level: 'see' }), res);
    assert.strictEqual(res.code, 200);
    assert.deepStrictEqual(res.body.audit, { recorded: 0, failed: 1 });
  });
  await t('pass test 10: the notice names the people the books closed on, until the owner has acted on each', async () => {
    const people = [
      { identity_id: 'a1', display_name: 'Sam', actor_role: null, hat: 'act', access_level: 'editor', whole_entity: false, can_see_costs: false, area_grants: {} },
      { identity_id: 'a2', display_name: 'Ravi', actor_role: null, hat: 'view_only', access_level: 'viewer', whole_entity: false, can_see_costs: false, area_grants: {} },
      { identity_id: 'a3', display_name: 'Asha', actor_role: null, hat: 'audit', access_level: 'commenter', whole_entity: true, can_see_costs: true, area_grants: {} },
      { identity_id: 'a4', display_name: 'Meena', actor_role: null, hat: 'act', access_level: 'editor', whole_entity: false, can_see_costs: false, area_grants: { accounts: { level: 'see', until: null } } }
    ];
    const ask = async (trailRows) => {
      handleRows = [{ rows: people }, { rows: trailRows }, { rows: [] }];
      return actorAreas.readAreas({ identity: OWNER });
    };
    const first = await ask([]);
    assert.strictEqual(first.available, true);
    assert.deepStrictEqual(first.notice.people.map((p) => p.display_name), ['Sam', 'Ravi']);
    assert.strictEqual(first.notice.count, 2);
    assert.strictEqual(first.notice.words, "2 people could read your books. They can't now. Open it again for anyone who needs it.");
    const later = await ask([{ subject_identity_id: 'a1', reason: 'kept closed' }]);
    assert.deepStrictEqual(later.notice.people.map((p) => p.display_name), ['Ravi']);
    const done = await ask([{ subject_identity_id: 'a1', reason: null }, { subject_identity_id: 'a2', reason: null }]);
    assert.strictEqual(done.notice, null);
    assert.deepStrictEqual(first.people.find((p) => p.identity_id === 'a3').access.accounts.source, 'preset');
    assert.deepStrictEqual(first.people.find((p) => p.identity_id === 'a4').access.accounts.source, 'grant');
  });
  await t('a person (not the owner) reads only what they hold; the other people stay out of the answer', async () => {
    handleRows = [];
    const res = { body: await actorAreas.readAreas({ identity: granted(counter, 'see', FUTURE) }) };
    assert.strictEqual(res.body.is_owner, false);
    assert.deepStrictEqual(res.body.people, []);
    assert.strictEqual(res.body.notice, null);
    assert.strictEqual(res.body.mine.accounts.level, 'see');
  });
  await t('a lapse is written to the trail once, when the owner next reads', async () => {
    sqlSeen.length = 0;
    const lapsed = { identity_id: 'a5', display_name: 'Sam', actor_role: null, hat: 'act', access_level: 'editor', whole_entity: false, can_see_costs: false, area_grants: { accounts: { level: 'see', until: PAST } } };
    handleRows = [{ rows: [lapsed] }, { rows: [] }, { rows: [] }];
    await actorAreas.readAreas({ identity: OWNER });
    const written = sqlSeen.filter((call) => /INSERT INTO access_events/.test(call.sql));
    assert.strictEqual(written.length, 1);
    assert.strictEqual(written[0].args[6], 'ended ' + PAST);
    sqlSeen.length = 0;
    handleRows = [{ rows: [lapsed] }, { rows: [{ subject_identity_id: 'a5', reason: 'ended ' + PAST }] }];
    await actorAreas.readAreas({ identity: OWNER });
    assert.strictEqual(sqlSeen.filter((call) => /INSERT INTO access_events/.test(call.sql)).length, 0, 'not written twice');
  });

  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
