#!/usr/bin/env node
// @type: contract
/**
 * connect-10d-input-shape.test.cjs — C11 input-shape sweep, batch 10d (connect and integrations, 12 Nov 2026).
 *
 * OWNS      the proof that a shape a caller types is refused at the door, in words, with nothing written, where it used to be stored, cut or answered 500:
 *           ORD-80 (a chit line is given to someone on the shop's team, one reader shared with the follow-up door), MKT-26 (an offer's text is text), AI-34 (a shopper's name fits
 *           its column), CTR-201 (a quick-key group's typed fields, on the create door as on the change door).
 *           CON-110 and CON-123 (streams owner, books write-back) are proved in tests/api-problem-integrations.test.cjs, where the route runs for real.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the schema check of each route (middleware/validate.js) and the libraries over a stand-in handle.
 * FLOW      a route's operation → schemaValidate → a body → accepted or refused with the field named · lib/assign.assign over a handle that records every statement
 * CARD      02-tasks-orders-and-workflow/assign-and-deliver-lines
 *
 *   node tests/connect-10d-input-shape.test.cjs
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
require(path.join(ROOT, 'tools', 'load-app.cjs')).loadApp(ROOT);
const register = require(path.join(ROOT, 'tools', 'api-register.cjs'));
const { schemaValidate } = require(path.join(ROOT, 'middleware', 'validate'));

let pass = 0;
let fail = 0;
const ok = (name, cond, why) => {
  if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); }
};

const OPERATIONS = register.operationsOfApp();
const UUID = '11111111-1111-4111-8111-111111111111';

/** the status the schema check answers for a body (200 = it lets it on; a refusal is 4xx: the route's own options pick 400 or 422, which its scenes in the api-problem tests prove) */
function statusOf(route, body) {
  const operation = OPERATIONS[route];
  let out = 200;
  const res = { statusCode: 200, locals: {}, set() { return this; }, setHeader() {}, getHeader() {}, type() { return this; }, end() { return this; }, status(code) { this.statusCode = code; return this; }, json() { out = this.statusCode; return this; }, send() { out = this.statusCode; return this; } };
  const req = { body, query: {}, params: { bridge_id: 'shop-s', key: 'group:Promo', id: UUID }, headers: {}, id: 'test', method: route.split(' ')[0], originalUrl: route.split(' ')[1], get() { return ''; } };
  schemaValidate(operation)(req, res, () => { out = 200; });
  return out;
}

const refused = (route, body) => statusOf(route, body) >= 400 && statusOf(route, body) < 500;

function checkBooksRef() {
  console.log('\n-- CON-123: a long voucher ref is kept (cut and logged by the handler), a ref that is not text is refused --');
  const route = 'POST /api/integrations/books';
  const chit = { chit_id: UUID };
  ok('a 300-character ref is accepted at the door (the kit swallows a refusal, so the record must not be lost)', statusOf(route, Object.assign({ ref: 'v'.repeat(300) }, chit)) === 200);
  ok('an object ref is refused', refused(route, Object.assign({ ref: { a: 1 } }, chit)));
  const source = require('fs').readFileSync(path.join(ROOT, 'routes', 'integrations.js'), 'utf8');
  ok('the handler cuts the ref to REF_MAX and logs that it did', source.includes('ref.slice(0, REF_MAX)') && /kept the first/.test(source));
}

function checkOfferText() {
  console.log('\n-- MKT-26: the text of a group offer is text --');
  const route = 'POST /api/crm/segments/:key/send';
  ok('the route is in the register', !!OPERATIONS[route]);
  for (const text of [5, true, { a: 1 }, ['x']]) ok('text ' + JSON.stringify(text) + ' is refused', refused(route, { text, dry: true }));
  for (const body of [{ text: 'Diwali offer', dry: true }, { text: 'Two lines\nsecond', dry: false }, { text: null, dry: true }, { dry: true }]) ok('still taken: ' + JSON.stringify(body), statusOf(route, body) === 200);
  ok('a text past the sender\'s own length is refused', refused(route, { text: 'x'.repeat(1001) }));
}

function checkShopperName() {
  console.log('\n-- AI-34: a shopper name fits its column (varchar 255) --');
  for (const route of ['POST /api/catalogue/:bridge_id/support/start', 'POST /api/catalogue/:bridge_id/order/start']) {
    ok(route + ': the route is in the register', !!OPERATIONS[route]);
    ok(route + ': 5000 characters is refused', refused(route, { phone: '9876543210', name: '<b>' + 'x'.repeat(5000) + '</b>' }));
    ok(route + ': 256 characters is refused', refused(route, { phone: '9876543210', name: 'x'.repeat(256) }));
    ok(route + ': a name that is not text is refused', refused(route, { phone: '9876543210', name: { a: 1 } }));
    ok(route + ': 255 characters, no name and a null name are still taken', [{ name: 'x'.repeat(255) }, {}, { name: null }].every((extra) => statusOf(route, Object.assign({ phone: '9876543210' }, extra)) === 200));
  }
}

function checkQuickKeyGroupCreate() {
  console.log('\n-- CTR-201: the create door types a group as the change door does --');
  const route = 'POST /api/quick-keys/groups';
  ok('the route is in the register', !!OPERATIONS[route]);
  const bad = [{ sort_order: 'abc' }, { sort_order: 99999999999 }, { sort_order: 1.5 }, { window_from: 'garbage' }, { window_to: '25:99' }, { window_from: 730 }];
  for (const junk of bad) ok('a new group with ' + JSON.stringify(junk) + ' is refused', refused(route, Object.assign({ name: 'Morning' }, junk)));
  ok('valid times, an order and cleared times are still taken', [{ sort_order: 3, window_from: '07:30', window_to: '11:00:00' }, { window_from: null, window_to: null }, {}].every((extra) => statusOf(route, Object.assign({ name: 'Morning' }, extra)) === 200));
}

/** a handle that records every statement; `team` is who the identities read finds on the shop's team */
function handleOf(team) {
  const statements = [];
  return {
    statements,
    db: {
      query: async (text, params) => {
        statements.push(String(text));
        if (/FROM identities WHERE identity_id = ANY/.test(text)) return { rows: params[0].filter((id) => team.includes(id)).map((identity_id) => ({ identity_id })) };
        return { rows: [{ line_id: params && params[2], seq: 1 }] };
      }
    }
  };
}

async function checkTeamReader() {
  console.log('\n-- ORD-80: one reader of "is this person on the team" --');
  const { isTeamMember, teamAmong, NOT_ON_TEAM } = require(path.join(ROOT, 'lib', 'team-member'));
  const stranger = '22222222-2222-4222-8222-222222222222';
  const { db, statements } = handleOf([UUID]);
  ok('a team member is on the team', (await isTeamMember(db, 'shop', UUID)) === true);
  ok('a stranger and an id nobody holds are refused alike', (await isTeamMember(db, 'shop', stranger)) === false);
  const before = statements.length;
  ok('a word typed as an id names nobody, and the database is never asked', (await isTeamMember(db, 'shop', 'abc')) === false && statements.length === before);
  ok('the session\'s own id (typed: false) is read as it is', (await isTeamMember(db, 'shop', UUID, { typed: false })) === true);
  const many = handleOf([UUID, stranger]);
  const among = await teamAmong(many.db, 'shop', [UUID, stranger, 'abc', UUID]);
  ok('a batch of ids is ONE read, and only the uuids are asked', many.statements.length === 1 && among.size === 2);
  ok('the one sentence', NOT_ON_TEAM === 'That person is not on your team.');
}

async function checkLineAssignee() {
  console.log('\n-- ORD-80: a chit line goes to someone on the shop\'s team --');
  const handle = handleOf([UUID]);
  require(path.join(ROOT, 'db')).withEntity = async (id, run) => run(handle.db);
  delete require.cache[require.resolve(path.join(ROOT, 'lib', 'assign'))]; /* the app loaded it with the real handle: load it again over the stand-in */
  const { assign } = require(path.join(ROOT, 'lib', 'assign'));
  const line = '33333333-3333-4333-8333-333333333333';
  const stranger = '22222222-2222-4222-8222-222222222222';
  const writes = () => handle.statements.filter((text) => /INSERT INTO chit_line_assignment/.test(text)).length;
  let refusal = null;
  try { await assign('shop', 'chit', [{ line_id: line, assignee_actor_id: stranger, assignee_name: 'Whoever I typed' }]); } catch (error) { refusal = error; }
  ok('a stranger is refused BAD_ASSIGNEE, as data the chit door answers', !!refusal && refusal.status === 400 && refusal.refused === true && refusal.body.code === 'BAD_ASSIGNEE');
  ok('and nothing was written', writes() === 0);
  refusal = null;
  try { await assign('shop', 'chit', [{ line_id: line, assignee_actor_id: UUID }, { line_id: line, assignee_actor_id: stranger }]); } catch (error) { refusal = error; }
  ok('one stranger among the edits refuses the whole batch, nothing written', !!refusal && writes() === 0);
  const placed = await assign('shop', 'chit', [{ line_id: line, assignee_actor_id: UUID }]);
  ok('a team member is taken and the line is written', placed.assignments.length === 1 && writes() === 1);
  const before = handle.statements.length;
  await assign('shop', 'chit', [{ line_id: line, assignee_actor_id: null }]);
  ok('null (take the line off a person) needs no team read', !handle.statements.slice(before).some((text) => /FROM identities/.test(text)));
}

(async () => {
  checkBooksRef();
  checkOfferText();
  checkShopperName();
  checkQuickKeyGroupCreate();
  await checkTeamReader();
  await checkLineAssignee();
  console.log('\n  ' + (fail ? '✗ ' + fail + ' failed' : '✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})();
