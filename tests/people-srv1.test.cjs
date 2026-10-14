'use strict';
/**
 * people-srv1.test.cjs — PEOPLE-SRV1 (14 Oct): the people server answers for CB People.
 *
 *   G4 · SWITCH-OFF AND REMOVE SIGN THE PERSON OUT — PUT /api/actors/:id/status deactivate|remove unlists every session the
 *        person opened on every device (lib/person-session closeBy) and ends every key they opened (routes/keys endKeysBy: a
 *        counter key CLOSED as Release closes it, another key revoked with the screens it paired); nobody else's session or key
 *        is touched; a key now names the person who opened it (mint `by`); refusals carry codes; lib/people says may.remove.
 *   G6 · THE OWNER MARKS SOMEONE AWAY — PUT /api/actors/break { actor_id }: owner only (OWNER_ONLY for a colleague), the shop's
 *        own people only (NOT_FOUND), never a switched-off one (SWITCHED_OFF); the stand-in read is filtered to the shop;
 *        a person's own break still works; lib/people says may.away { to } and `away`.
 *   G5 · GET /api/facts/people — at work · away · switched off, from the same filter GET /api/people reads (lib/people.peopleSql).
 *   G2 (e-mail) is SEC2's: tests/people-writes-sec2.test.cjs.
 * Offline: express on 127.0.0.1, auth + db stubbed, the policy_flags writes applied by tests/support/policy-patch.cjs.
 * Run: node tests/people-srv1.test.cjs
 */
const path = require('path'), http = require('http'), fs = require('fs');
const express = require('express');
const API = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-people-srv1';

const say = console.log.bind(console);
['log', 'warn', 'error', 'info'].forEach((k) => { console[k] = () => {}; });
let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; say('  ok  ' + name); } else { fail++; say('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };

const SHOP = '11111111-1111-4111-8111-111111111111', BALA = '22222222-2222-4222-8222-222222222222';
const RAVI = '33333333-3333-4333-8333-333333333333', OTHER = '55555555-5555-4555-8555-555555555555';
const clone = (x) => JSON.parse(JSON.stringify(x));

/* ── the store ── */
const PP = require('./support/policy-patch.cjs');
let PEOPLE, FLAGS, SQL;
function reset() {
  SQL = [];
  PEOPLE = {
    [BALA]: { identity_id: BALA, display_name: 'Bala', actor_key: 'bala', break_status: 'active', current_task_count: 0, delegate_actor_id: null, parent_entity_id: SHOP },
    [RAVI]: { identity_id: RAVI, display_name: 'Ravi', actor_key: 'ravi', break_status: 'active', current_task_count: 0, delegate_actor_id: null, parent_entity_id: SHOP },
    [OTHER]: { identity_id: OTHER, display_name: 'Elsewhere', actor_key: 'x', break_status: 'active', current_task_count: 0, delegate_actor_id: null, parent_entity_id: '99999999-9999-4999-8999-999999999999' },
  };
  FLAGS = {
    devices: {
      'phone-counter-1': { kind: 'till', till: { prefix: 'P1' }, sessions: [{ jti: 's-bala-1', by: BALA, surface: 'till' }, { jti: 's-owner', by: SHOP, surface: 'till' }] },
      'browser-bala-22': { kind: 'web', sessions: [{ jti: 's-bala-2', by: BALA, surface: 'web' }] },
      'phone-ravi-0001': { kind: 'web', sessions: [{ jti: 's-ravi', by: RAVI, surface: 'web' }] },
    },
    api_keys: [
      { jti: 'k-till-bala', name: 'counter C1', scopes: ['till'], till: { id: 'C1' }, by: BALA },
      { jti: 'k-kit-bala', name: 'kit', scopes: ['connector'], by: BALA },
      { jti: 'k-screen', name: 'shop screen', scopes: ['screen'], parent: 'k-kit-bala' },
      { jti: 'k-till-old', name: 'counter C2', scopes: ['till'], till: { id: 'C2', closed_at: '2026-10-01T00:00:00Z' }, by: BALA },
      { jti: 'k-owner', name: 'owner kit', scopes: ['offers'] },
      { jti: 'k-ravi', name: 'counter C3', scopes: ['till'], till: { id: 'C3' }, by: RAVI },
    ],
  };
}
reset();
async function q(sql, params) {
  const s = String(sql).replace(/\s+/g, ' ').trim(); const p = params || [];
  SQL.push({ sql: s, params: p });
  if (PP.isPatch(s)) return PP.apply(s, p, FLAGS);
  if (/^SELECT policy_flags FROM identities/i.test(s)) return { rows: [{ policy_flags: clone(FLAGS) }], rowCount: 1 };
  /* the status route's actor read and break's subject read: the shop's own people only */
  if (/^SELECT identity_id, display_name, [\w, ]*break_status[\w, ]* FROM identities WHERE identity_id = \$1 AND parent_entity_id = \$2/i.test(s)) {
    const r = PEOPLE[p[0]]; return r && r.parent_entity_id === p[1] ? { rows: [clone(r)], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (/^UPDATE identities SET break_status = '(\w+)'/i.test(s)) {
    const st = /break_status = '(\w+)'/.exec(s)[1]; const id = p[p.length - 1]; if (PEOPLE[id]) PEOPLE[id].break_status = st;
    return { rows: [], rowCount: 1 };
  }
  if (/^SELECT display_name FROM identities WHERE delegate_actor_id/i.test(s)) return { rows: [], rowCount: 0 };
  if (/^SELECT delegate_actor_id FROM identities/i.test(s)) return { rows: [{ delegate_actor_id: null }], rowCount: 1 };
  if (/^SELECT COUNT\(\*\) as count FROM chit_status/i.test(s)) return { rows: [{ count: String(TASKS) }], rowCount: 1 };
  if (/^SELECT identity_id, display_name FROM identities WHERE identity_id = \$1 AND parent_entity_id = \$2 AND identity_id <> \$3/i.test(s)) {
    const r = PEOPLE[p[0]]; return r && r.parent_entity_id === p[1] && p[0] !== p[2] ? { rows: [clone(r)], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (/^SELECT user_id FROM identities/i.test(s)) return { rows: [{ user_id: 'shop' }], rowCount: 1 };
  return { rows: [], rowCount: 0 };
}
let TASKS = 0;
const stub = (rel, exports) => { const p = require.resolve(path.join(API, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
let BATCH = [];
stub('db', { query: q, pool: { query: q, connect: async () => ({ query: q, release() {} }) }, withEntity: async (id, fn) => fn({ query: q }),
  withTransaction: async (fn) => fn({ query: q }), onEntity: async (id, db, fn) => fn({ query: q }),
  readBatch: async (e, a, stmts) => { stmts.forEach((x) => SQL.push({ sql: x.text, params: x.params })); return [{ rows: BATCH }]; },
  trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } } });
stub('lib/schema', { hasColumn: async () => true, has: async () => true, hasTable: async () => true, columns: async () => [], table: async () => ({}) });

let WHO = null; const FORGOT = [];
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Mayur Bhavan', parent_entity_id: null };
const COLLEAGUE = { identity_id: RAVI, identity_type: 'actor', display_name: 'Ravi', parent_entity_id: SHOP, hat: 'act', access_level: 'editor' };
const auth = (req, res, next) => { req.identity = Object.assign({}, WHO); next(); };
auth.entityOf = (req) => req.identity.parent_entity_id || req.identity.identity_id;
auth.forgetKey = (jti) => { FORGOT.push(String(jti)); };
auth.SCOPE_NAMES = ['offers', 'services', 'connector', 'till', 'screen'];
auth.requireScope = () => (req, res, next) => next();
stub('middleware/auth', auth);

const app = express(); app.use(express.json());
app.use('/api/actors', require(path.join(API, 'routes', 'actors')));
app.use('/api/facts', require(path.join(API, 'routes', 'facts')));
let base;
const call = (method, url, body) => new Promise((resolve, reject) => { const data = body ? JSON.stringify(body) : null;
  const h = { 'content-type': 'application/json' }; if (data) h['content-length'] = Buffer.byteLength(data);
  const r = http.request(base + url, { method, headers: h }, (res) => { let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(s); } catch (_) {} resolve({ status: res.statusCode, body: j || {} }); }); });
  r.on('error', reject); if (data) r.write(data); r.end(); });
const sessionsOf = (by) => Object.values(FLAGS.devices).reduce((n, d) => n + d.sessions.filter((s) => s.by === by).length, 0);
const keyOf = (jti) => FLAGS.api_keys.find((k) => k.jti === jti);

(async () => {
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port + '/api';
  const keys = require(path.join(API, 'routes', 'keys'));
  const people = require(path.join(API, 'lib', 'people'));
  const PS = require(path.join(API, 'lib', 'person-session'));
  try {
    say('G4 · switch-off signs the person out of phones and keys (one transaction)');
    WHO = OWNER;
    const off = await call('PUT', '/actors/' + BALA + '/status', { action: 'deactivate' });
    t('owner switches Bala off → 200 with signed_out { sessions 2, keys_closed 1, keys_revoked 1 }', off.status === 200
      && JSON.stringify(off.body.signed_out) === JSON.stringify({ sessions: 2, keys_closed: 1, keys_revoked: 1 }), JSON.stringify(off.body));
    t('…every session Bala opened is unlisted, on both devices', sessionsOf(BALA) === 0);
    t('…the owner\'s session on the shared counter phone stays, and Ravi\'s too', sessionsOf(SHOP) === 1 && sessionsOf(RAVI) === 1);
    t('…the devices stay (a shared phone keeps its counter number)', !!FLAGS.devices['phone-counter-1'] && FLAGS.devices['phone-counter-1'].till.prefix === 'P1' && !FLAGS.devices['phone-counter-1'].revoked_at);
    t('…a revoked jti verdict is SESSION_EXPIRED', PS.verdictOf(FLAGS.devices, 'browser-bala-22', 's-bala-2').code === 'SESSION_EXPIRED');
    const till = keyOf('k-till-bala');
    t('…Bala\'s counter key is CLOSED as Release closes it (kept as history, released)', !!(till && till.till.closed_at && till.till.released === true && till.till.id === 'C1'));
    t('…Bala\'s kit key is revoked with the screen it paired', !keyOf('k-kit-bala') && !keyOf('k-screen'));
    t('…an already-closed counter key keeps its own closing date', keyOf('k-till-old').till.closed_at === '2026-10-01T00:00:00Z' && !keyOf('k-till-old').till.released);
    t('…the owner\'s key and Ravi\'s counter key are untouched', !!keyOf('k-owner') && !keyOf('k-ravi').till.closed_at);
    t('…every ended key is forgotten by auth\'s cache after the write', ['k-till-bala', 'k-kit-bala', 'k-screen'].every((j) => FORGOT.includes(j)));
    t('…and the sign-out ran on the same transaction as the status write (no second BEGIN: one withEntity)',
      SQL.findIndex((x) => /SET break_status = 'deactivated'/.test(x.sql)) < SQL.findIndex((x) => PP.isPatch(x.sql)));

    reset(); FORGOT.length = 0;
    const rm = await call('PUT', '/actors/' + BALA + '/status', { action: 'remove', confirm: 'REMOVE' });
    t('remove → 200, signed out the same way', rm.status === 200 && rm.body.signed_out && rm.body.signed_out.sessions === 2 && sessionsOf(BALA) === 0, JSON.stringify(rm.body));
    reset();
    const again = await call('PUT', '/actors/' + BALA + '/status', { action: 'deactivate' });
    const twice = await call('PUT', '/actors/' + BALA + '/status', { action: 'deactivate' });
    t('switching off twice ends nothing the second time (idempotent: 0 · 0 · 0)', again.status === 200 && twice.status === 200
      && JSON.stringify(twice.body.signed_out) === JSON.stringify({ sessions: 0, keys_closed: 0, keys_revoked: 0 }), JSON.stringify(twice.body));

    say('G4 · refusals carry a code (the screen never reads the words)');
    reset();
    const noConfirm = await call('PUT', '/actors/' + BALA + '/status', { action: 'remove' });
    t('remove without confirm → 400 CONFIRM_REMOVE', noConfirm.status === 400 && noConfirm.body.code === 'CONFIRM_REMOVE', JSON.stringify(noConfirm.body));
    PEOPLE[BALA].current_task_count = 3;
    const jobs = await call('PUT', '/actors/' + BALA + '/status', { action: 'deactivate' });
    t('switch off with open jobs and no routing → 400 TASKS_TO_ROUTE (nothing signed out)', jobs.status === 400 && jobs.body.code === 'TASKS_TO_ROUTE' && sessionsOf(BALA) === 2, JSON.stringify(jobs.body));
    WHO = COLLEAGUE;
    const col = await call('PUT', '/actors/' + BALA + '/status', { action: 'deactivate' });
    t('a colleague cannot switch anyone off → 403 OWNER_ONLY, nothing signed out', col.status === 403 && col.body.code === 'OWNER_ONLY' && sessionsOf(BALA) === 2);

    say('G4 · a key names the person who opened it (mint `by`)');
    reset();
    const k1 = await keys.mint(SHOP, COLLEAGUE, { name: 'counter C9', scopes: ['till'] });
    const k2 = await keys.mint(SHOP, OWNER, { name: 'owner kit', scopes: ['offers'] });
    t('a key a co-assist opens carries by = that person', k1.by === RAVI && keyOf(k1.jti).by === RAVI);
    t('an owner\'s key carries no by (the owner is never switched off)', k2.by === undefined && keyOf(k2.jti).by === undefined);
    t('a pairing with no person (null identity) carries no by', (await keys.mint(SHOP, null, { scopes: ['screen'] })).by === undefined);

    say('G6 · the owner marks someone away (PUT /actors/break { actor_id })');
    reset(); WHO = OWNER;
    const away = await call('PUT', '/actors/break', { break_type: 'short_break', actor_id: BALA });
    t('owner marks Bala on a short break → 200 { actor_id, state:away }', away.status === 200 && away.body.actor_id === BALA && away.body.state === 'away' && PEOPLE[BALA].break_status === 'short_break', JSON.stringify(away.body));
    const back = await call('PUT', '/actors/break', { break_type: 'end_break', actor_id: BALA });
    t('…and back → 200 state:on, Bala active', back.status === 200 && back.body.state === 'on' && PEOPLE[BALA].break_status === 'active');
    TASKS = 2;
    const leave = await call('PUT', '/actors/break', { break_type: 'leave', actor_id: BALA });
    t('leave with open jobs and no routing → 400 TASKS_TO_ROUTE, said about Bala', leave.status === 400 && leave.body.code === 'TASKS_TO_ROUTE' && /^Bala has 2/.test(leave.body.message), JSON.stringify(leave.body));
    const elsewhere = await call('PUT', '/actors/break', { break_type: 'leave', actor_id: BALA, task_action: 'actor', target_actor_id: OTHER });
    t('the stand-in must be one of THIS shop\'s people → 400 (another shop\'s person is not found)', elsewhere.status === 400 && PEOPLE[BALA].break_status === 'active');
    const toSelf = await call('PUT', '/actors/break', { break_type: 'leave', actor_id: BALA, task_action: 'actor', target_actor_id: BALA });
    t('…and not the person going on leave', toSelf.status === 400);
    const toRavi = await call('PUT', '/actors/break', { break_type: 'leave', actor_id: BALA, task_action: 'actor', target_actor_id: RAVI });
    t('…Ravi (same shop, on) takes them → 200 leave', toRavi.status === 200 && PEOPLE[BALA].break_status === 'leave', JSON.stringify(toRavi.body));
    TASKS = 0;
    const foreign = await call('PUT', '/actors/break', { break_type: 'short_break', actor_id: OTHER });
    t('another shop\'s person → 404 NOT_FOUND, untouched', foreign.status === 404 && foreign.body.code === 'NOT_FOUND' && PEOPLE[OTHER].break_status === 'active');
    PEOPLE[RAVI].break_status = 'deactivated';
    const offOne = await call('PUT', '/actors/break', { break_type: 'short_break', actor_id: RAVI });
    t('a switched-off person cannot be marked away → 400 SWITCHED_OFF', offOne.status === 400 && offOne.body.code === 'SWITCHED_OFF' && PEOPLE[RAVI].break_status === 'deactivated');
    const nobody = await call('PUT', '/actors/break', { break_type: 'short_break' });
    t('the owner naming nobody → 400 NAME_THE_PERSON', nobody.status === 400 && nobody.body.code === 'NAME_THE_PERSON');
    reset(); WHO = COLLEAGUE;
    const other = await call('PUT', '/actors/break', { break_type: 'short_break', actor_id: BALA });
    t('a colleague naming someone else → 403 OWNER_ONLY, untouched', other.status === 403 && other.body.code === 'OWNER_ONLY' && PEOPLE[BALA].break_status === 'active');
    const own = await call('PUT', '/actors/break', { break_type: 'short_break' });
    t('a person\'s own break still works (no actor_id)', own.status === 200 && PEOPLE[RAVI].break_status === 'short_break', JSON.stringify(own.body));
    const ownNamed = await call('PUT', '/actors/break', { break_type: 'end_break', actor_id: RAVI });
    t('…and naming themselves is their own break, not the owner\'s', ownNamed.status === 200 && PEOPLE[RAVI].break_status === 'active');

    say('G4 · G6 · lib/people says may.remove · may.away { to } · away');
    const rows = [
      { identity_id: BALA, display_name: 'Bala', break_status: 'leave', hat: 'act', access_level: 'editor' },
      { identity_id: RAVI, display_name: 'Ravi', break_status: 'active', hat: 'act', access_level: 'editor' },
      { identity_id: OTHER, display_name: 'Off', break_status: 'deactivated', hat: 'act', access_level: 'editor' }];
    const v = people.view(rows, { owner: true });
    const by = (id) => v.people.find((p) => p.id === id);
    t('owner: Ravi (on) may go away, Bala (on leave) may come back', by(RAVI).may.away.ok && by(RAVI).may.away.to === 'away' && by(BALA).may.away.to === 'on');
    t('…which kind of away is said (leave), none for an on person', by(BALA).away === 'leave' && by(RAVI).away === null);
    t('…a switched-off person cannot be marked away, with its sentence', !by(OTHER).may.away.ok && by(OTHER).may.away.why === 'Switched off.');
    t('…the owner may remove anyone, switched off too', by(RAVI).may.remove.ok && by(OTHER).may.remove.ok);
    t('…counts say away (inside on)', v.counts.away === 1 && v.counts.on === 2 && v.counts.off === 1);
    const vc = people.view(rows, { owner: false });
    const c = vc.people.find((p) => p.id === RAVI);
    t('colleague: remove and away greyed WITH the owner-only sentence; away keeps its `to`', !c.may.remove.ok && c.may.remove.why === people.OWNER_ONLY
      && !c.may.away.ok && c.may.away.to === 'away');

    say('G5 · GET /api/facts/people — the Home card');
    WHO = OWNER;
    BATCH = [{ break_status: 'active', n: 3 }, { break_status: 'short_break', n: 1 }, { break_status: 'leave', n: 1 }, { break_status: 'deactivated', n: 2 }];
    SQL.length = 0;
    const card = await call('GET', '/facts/people');
    t('3 at work · 2 away, and 2 switched off', card.status === 200 && card.body.lines[0].text === '3 people at work · 2 away' && card.body.lines[0].value === 3
      && card.body.lines[1].text === '2 switched off', JSON.stringify(card.body));
    t('…figures { total 7, at_work 3, away 2, off 2 }', JSON.stringify(card.body.figures) === JSON.stringify({ total: 7, at_work: 3, away: 2, off: 2 }));
    t('…ONE statement, grouped in SQL, through the same people filter as GET /api/people', SQL.length === 1 && /GROUP BY i\.break_status/.test(SQL[0].sql)
      && SQL[0].sql.includes(people.peopleSql('i')));
    BATCH = [{ break_status: 'active', n: 1 }];
    const one = await call('GET', '/facts/people');
    t('1 person at work, no switched-off line', one.body.lines.length === 1 && one.body.lines[0].text === '1 person at work');
    BATCH = [];
    const none = await call('GET', '/facts/people');
    t('no people → said in words, value 0', none.body.lines[0].text === 'No people added yet' && none.body.lines[0].value === 0);
    WHO = COLLEAGUE;
    t('a colleague may read the card (they read the list too)', (await call('GET', '/facts/people')).status === 200);
    const src = fs.readFileSync(path.join(API, 'routes', 'people.js'), 'utf8');
    t('GET /api/people reads the same filter (peopleSql), no private copy', /people\.peopleSql\('i'\)/.test(src) && !/COALESCE\(i\.actor_type/.test(src));
  } catch (e) { fail++; say('  FAIL threw: ' + (e && e.stack)); }
  server.close();
  say('\n' + (pass + fail) + ' checks · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
