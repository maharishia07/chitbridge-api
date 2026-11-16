#!/usr/bin/env node
// @type: unit
/**
 * tests/l16-staff-areas2.test.cjs — W15-66 slice 2 (the money answers OUTSIDE /api/books are a person's only when the owner opened the area): the offline half, no database.
 *   the table   every row of lib/books-areas.DOORS has its route and that route carries areaDoor(<that area>) after its own auth; no route carries a gate with no row · every CARD_AREA card is a real Home card
 *               · the grantable set equals the enforced set (accounts · reports · finance)
 *   the gate    owner passes · counter staff and View-only are closed in words · a person granted the area passes · a lapsed grant is closed · a till device and an API key keep their own scope gates
 *   the card    a closed Home card is a card (lines [], state not_started, closed, why), never a 403 · an open card is not touched
 *   party money dues, unbilled and the late-dues count leave for a person without accounts or finance; the party list stays; the owner is untouched
 * OWNS      the offline checks of areaDoor · cardClosed · closedCard · mayCrmMoney (middleware/books-area-gate.js), lib/books-areas DOORS/CARD_AREA, lib/dues-view.shutMoney.   CALLED BY scripts/guards.cjs.   CARD  18-identity-sign-in-and-access/access-levels
 */
'use strict';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'l16_areas2_test_secret_at_least_32_chars_padding';
const path = require('path');
const assert = require('assert');
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
const gate = require(path.join(API, 'middleware', 'books-area-gate.js'));
const A = require(path.join(API, 'lib', 'books-areas.js'));
const areas = require(path.join(API, 'lib', 'areas.js'));
const duesView = require(path.join(API, 'lib', 'dues-view.js'));
const home = require(path.join(API, 'lib', 'home-facts.js'));
const routers = {
  '/api/till': require(path.join(API, 'routes', 'till.js')),
  '/api/chits': require(path.join(API, 'routes', 'chits.js')),
  '/api/folders': require(path.join(API, 'routes', 'folders.js'))
};

const PARENT = '11111111-1111-4111-8111-111111111111';
const OWNER = { identity_id: PARENT, identity_type: 'entity', parent_entity_id: null };
const person = (extra) => Object.assign({ identity_id: '22222222-2222-4222-8222-222222222222', identity_type: 'actor', parent_entity_id: PARENT, hat: 'act', access_level: 'editor', whole_entity: false, can_see_costs: false }, extra);
const counter = person({});
const viewOnly = person({ access_level: 'viewer' });
const auditor = person({ access_level: 'commenter', whole_entity: true, can_see_costs: true });
const grant = (who, area, until) => Object.assign({}, who, { area_grants: { [area]: { level: 'see', until: until === undefined ? null : until, by: PARENT, at: '2026-11-16T00:00:00.000Z' } } });

/** every 'METHOD /path' to its handler stack, through the sub-routers a router mounts with router.use(subRouter) (folders mounts its parts) */
function stacksOf(router, prefix, into) {
  for (const layer of router.stack || []) {
    if (layer.route) for (const method of Object.keys(layer.route.methods)) into[method.toUpperCase() + ' ' + prefix + layer.route.path] = layer.route.stack.map((inner) => inner.handle);
    else if (layer.handle && layer.handle.stack) stacksOf(layer.handle, prefix, into);
  }
  return into;
}
const all = {};
for (const [mount, router] of Object.entries(routers)) stacksOf(router, mount, all);

/** run one gate against a request; { nexted, status, body } */
function run(middleware, req) {
  let status = null;
  let body = null;
  let nexted = false;
  const res = { req, status(code) { status = code; return res; }, set() { return res; }, setHeader() { return res; }, type() { return res; }, json(p) { body = p; return res; }, send(p) { body = p; return res; }, end() { return res; } };
  middleware(req, res, () => { nexted = true; });
  return { nexted, status, body };
}
const asReq = (identity, extra) => Object.assign({ method: 'GET', path: '/x', headers: {}, identity }, extra || {});

(async () => {
  await t('every DOORS row is a real route and carries areaDoor of its own area, right after the sign-in', () => {
    for (const [key, area] of Object.entries(A.DOORS)) {
      const stack = all[key];
      assert.ok(stack, 'no route ' + key);
      const at = stack.findIndex((handle) => handle.areaDoor);
      assert.ok(at > 0, key + ' carries no areaDoor');
      assert.strictEqual(stack[at].areaDoor, area, key);
      assert.strictEqual(stack[at - 1].name, 'auth', key + ': the gate follows the route own auth');
    }
  });
  await t('no route carries a gate that has no DOORS row (a gate outside the table is a second table)', () => {
    const gated = Object.keys(all).filter((key) => all[key].some((handle) => handle.areaDoor));
    assert.deepStrictEqual(gated.sort(), Object.keys(A.DOORS).sort());
  });
  await t('every CARD_AREA card is a real Home card, and the grantable set equals the enforced set', () => {
    for (const card of Object.keys(A.CARD_AREA)) assert.ok(Object.prototype.hasOwnProperty.call(home.BUILD, card), card);
    assert.deepStrictEqual([...areas.GRANTABLE].sort(), [...gate.ENFORCED].sort());
    assert.deepStrictEqual([...areas.GRANTABLE].sort(), ['accounts', 'finance', 'reports']);
  });
  await t('areaDoor: the owner passes; counter staff and View-only are closed in words, per area', () => {
    for (const area of ['accounts', 'reports', 'finance']) {
      assert.ok(run(gate.areaDoor(area), asReq(OWNER)).nexted, 'owner ' + area);
      for (const who of [counter, viewOnly]) {
        const out = run(gate.areaDoor(area), asReq(who));
        assert.ok(!out.nexted && out.status === 403 && out.body.code === 'BOOKS_AREA_CLOSED', area);
        assert.strictEqual(out.body.detail, gate.AREA_WORDS[area]);
        assert.match(out.body.detail, /Ask the owner/);
      }
    }
  });
  await t('areaDoor: a person granted the area passes it and only it; a lapsed grant is closed; the presets keep their reads', () => {
    assert.ok(run(gate.areaDoor('reports'), asReq(grant(counter, 'reports'))).nexted);
    assert.ok(!run(gate.areaDoor('finance'), asReq(grant(counter, 'reports'))).nexted);
    assert.ok(!run(gate.areaDoor('reports'), asReq(grant(counter, 'reports', '2000-01-01'))).nexted);
    assert.ok(run(gate.areaDoor('reports'), asReq(grant(viewOnly, 'reports', '2999-12-31'))).nexted);
    for (const area of ['accounts', 'reports', 'finance']) assert.ok(run(gate.areaDoor(area), asReq(auditor)).nexted, 'auditor ' + area);
  });
  await t('areaDoor: an API key (a till device signs in as one) keeps its own scope gates (never asked here); every request carries req.till, so that is no pass', () => {
    assert.ok(!run(gate.areaDoor('accounts'), asReq(counter, { till: { id: 'T1' } })).nexted);
    assert.ok(run(gate.areaDoor('accounts'), asReq(counter, { api_key: { jti: 'k' } })).nexted);
    assert.ok(run(gate.areaDoor('reports'), asReq(counter, { api_key: { id: 'k' } })).nexted);
  });
  await t('a closed Home card is a card, never a 403: lines [], state in the card vocabulary, closed, and why', () => {
    const closed = gate.closedCard('finance');
    assert.deepStrictEqual(closed.lines, []);
    assert.ok(['needs_you', 'in_use', 'not_started'].includes(closed.state));
    assert.strictEqual(closed.closed, true);
    assert.strictEqual(closed.why, gate.AREA_WORDS.finance);
    assert.ok(gate.cardClosed(asReq(counter), 'finance'));
    assert.ok(!gate.cardClosed(asReq(OWNER), 'finance'));
    assert.ok(!gate.cardClosed(asReq(counter), null), 'a card in no row stays open');
    assert.ok(!gate.cardClosed(asReq(grant(counter, 'finance')), 'finance'));
  });
  await t('party money: dues, unbilled and the late-dues count leave for a person without accounts or finance; the list stays', () => {
    const make = () => ({ parties: [{ party_id: 'p1', display_name: 'Asha', phone: '1', dues: { balance_minor: 500, overdue: true }, unbilled: { n: 1, minor: 9 }, terms: { credit_days: 7 } }], count: 1, alerts: { dues_overdue: 1 } });
    const shut = duesView.shutMoney(make());
    assert.deepStrictEqual(shut.parties[0], { party_id: 'p1', display_name: 'Asha', phone: '1', terms: { credit_days: 7 } });
    assert.deepStrictEqual(shut.alerts, {});
    assert.strictEqual(shut.count, 1);
    const record = duesView.shutMoney({ party_id: 'p1', dues: { balance_minor: 1 }, unbilled: { minor: 2 }, display_name: 'Asha' });
    assert.deepStrictEqual(record, { party_id: 'p1', display_name: 'Asha' });
    assert.ok(gate.mayCrmMoney(asReq(OWNER)));
    assert.ok(!gate.mayCrmMoney(asReq(counter)) && !gate.mayCrmMoney(asReq(viewOnly)));
    assert.ok(gate.mayCrmMoney(asReq(grant(counter, 'accounts'))) && gate.mayCrmMoney(asReq(grant(counter, 'finance'))));
    assert.ok(!gate.mayCrmMoney(asReq(grant(counter, 'reports'))), 'reports alone does not open party dues');
    assert.ok(gate.mayCrmMoney(asReq(auditor)));
  });
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
