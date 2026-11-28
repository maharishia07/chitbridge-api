'use strict';
/**
 * tests/firm-connect-1138.test.cjs — the api half of the firm-to-shop path (UX-215 / UX-216 / UX-220), no database needed.
 *
 * OWNS      the proof of: the owner gate on the ask, GET /asks and POST /firm-invites (a staff seat and a key are refused) · the direction pin (the firm is the parent: FIRM_DIRECTION) · the caps and the cool-off
 *           (150 pending passes, 200 stops) · the fixed invite e-mail (no free text, never "sent" when not delivered, capped) · the costs change (a rise needs consent on the server, a fall does not, b915 absent says so in words) ·
 *           Who-looked grouped into visits (the 30-minute boundary, a person-less row, 55 raw rows of two firms) · the Home `network` card and the bell's own count (owner seat only, firms only).
 * MUTATION-RED  `node tests/firm-connect-1138.test.cjs --mutants` runs this file again once per guard with that guard removed from the source (FIRM_CONNECT_MUTATE=<name>) and requires each run to FAIL (exit 1);
 *           a mutant that passes means the test cannot see the guard. A crash (exit 2: the mutation anchor moved) also fails the run.
 * CALLED BY scripts/guards.cjs (enrolled) · the real Postgres half is tests/firm-connect-1138.realstack.cjs
 * CARD      04-network/connections-and-invitations
 */
const path = require('path');
const Module = require('module');
const { spawnSync } = require('child_process');
const API = path.join(__dirname, '..');

/* the guards, each as one textual weakening of the source: [file, exact text, replacement] */
const MUTANTS = {
  ask_gate: ['src/routes/network.js', "'/connections',\n  auth,\n  ownerAsks,", "'/connections',\n  auth,"],
  asks_gate: ['src/routes/network.js', "'/asks',\n  auth,\n  ownerDecides,", "'/asks',\n  auth,"],
  invite_gate: ['src/routes/network.js', "'/firm-invites',\n  auth,\n  ownerAsks,", "'/firm-invites',\n  auth,"],
  caps_pending: ['lib/connect-caps.js', 'if (counts.pending_by_asker >= limits.pendingByAsker)', 'if (false)'],
  caps_target: ['lib/connect-caps.js', 'counts.pending_to_target >= limits.pendingToTarget ||', 'false ||'],
  cool_off: ['lib/connect-caps.js', 'if (declined !== null &&', 'if (false &&'],
  direction: ['lib/connect-caps.js', 'if ((await query(BACK_SQL', 'if (false && (await query(BACK_SQL'],
  costs_confirm: ['lib/books-grant.js', 'input.can_see_costs === true && input.consent !== true', 'false'],
  visit_boundary: ['lib/books-visits.js', '> gap) open.push', '> gap * 2) open.push'],
  bell_owner: ['lib/connect-asks.js', 'if (!mayAnswer) return', 'if (false) return'],
  firms_only: ['lib/connect-asks.js', "AND e.type = '${FIRM_TYPE}'", ''],
  invite_address_cap: ['lib/firm-invite.js', 'if (counts.address >= limits.perAddressWeek)', 'if (false)']
};
if (process.argv.includes('--mutants')) {
  let escaped = 0;
  for (const name of Object.keys(MUTANTS)) {
    const run = spawnSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { FIRM_CONNECT_MUTATE: name }), windowsHide: true, encoding: 'utf8' });
    const killed = run.status === 1;
    if (!killed) escaped++;
    console.log((killed ? '  killed   ' : '  ESCAPED  ') + name + (run.status === 2 ? '  (crashed: anchor moved? ' + String(run.stderr).slice(0, 120) + ')' : ''));
  }
  console.log(escaped ? '\n' + escaped + ' mutant(s) escaped' : '\nevery mutant killed');
  process.exit(escaped ? 1 : 0);
}
const wanted = MUTANTS[process.env.FIRM_CONNECT_MUTATE];
if (process.env.FIRM_CONNECT_MUTATE && !wanted) { console.error('unknown mutant'); process.exit(2); }
if (wanted) {
  const compile = Module.prototype._compile;
  Module.prototype._compile = function (content, filename) {
    if (filename.replace(/\\/g, '/').endsWith('/' + wanted[0])) {
      if (!content.includes(wanted[1])) { console.error('mutation anchor missing in ' + wanted[0]); process.exit(2); }
      content = content.replace(wanted[1], () => wanted[2]);
    }
    return compile.call(this, content, filename);
  };
}

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'firm_connect_test_secret_at_least_32_chars_pad';
let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 300) : '')); } };
const rejects = async (promise) => { try { await promise; return null; } catch (e) { return e; } };

/* the fake sign-in: the identity rides a header, like the real stacks' tests */
const authPath = require.resolve(path.join(API, 'middleware', 'auth.js'));
const fakeAuth = (req, res, next) => { try { req.identity = JSON.parse(String(req.headers['x-test-as'] || '')); if (req.headers['x-test-key']) req.api_key = { jti: 'k' }; } catch (_) { return res.status(401).json({ error: 'no test identity' }); } return next(); };
fakeAuth.entityOf = (req) => req.identity.parent_entity_id || req.identity.identity_id;
fakeAuth.forgetKey = () => {};
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };
/* the reader of the asks, stubbed: the route and the Home card are tested for who may read, the SQL by the realstack */
const asksPath = require.resolve(path.join(API, 'lib', 'connect-asks.js'));
const realAsks = require(asksPath);
const FIRM_ASK = { edge_id: 'e1', kind: 'firm', i_am: 'shop', name: 'Smith & Co', bridge_id: 'CBSMITH', country: 'AU', asked_at: '2026-11-28T01:00:00Z' };
let asksCalls = 0;
const stubbed = Object.assign({}, realAsks, { asksOf: async () => { asksCalls++; return { to_me: [FIRM_ASK], by_me: [] }; } });
/* bellOf calls asksOf by its module-local name, so the bell test uses the real bellOf over a fake pool below; the route and the card read the stub */

const caps = require(path.join(API, 'lib', 'connect-caps.js'));
const visits = require(path.join(API, 'lib', 'books-visits.js'));
const invite = require(path.join(API, 'lib', 'firm-invite.js'));
const grants = require(path.join(API, 'lib', 'books-grant.js'));
const visitsOf = visits.visitsOf;

/** the fake database of refuseFirmAsk: the five numbers, and whether the pair is connected the other way round */
const fakeDb = (counts, back) => async (sql) => (sql.includes('pending_by_asker') ? { rows: [Object.assign({ pending_by_asker: 0, asks_day: 0, pending_to_target: 0, asks_target_day: 0, last_decline: null }, counts)] } : { rows: back ? [{}] : [] });
const fail409 = (status, message, code) => Object.assign(new Error(message), { status, code });
const FIRM = { id: 'firm-node' }, SHOP = { id: 'shop-node' };

async function capsTests() {
  const limits = caps.limitsNow();
  ok('caps: the numbers are 200 pending, 300 a day, 20 waiting and 10 a day at one business, 1 hour cool-off', limits.pendingByAsker === 200 && limits.asksPerAskerDay === 300 && limits.pendingToTarget === 20 && limits.asksPerTargetDay === 10 && limits.declineCoolOffHours === 1);
  const none = { pending_by_asker: 0, asks_day: 0, pending_to_target: 0, asks_target_day: 0, last_decline: null };
  ok('caps: an empty record is let through', caps.askVerdict(none, limits) === null);
  ok('caps: 150 waiting (the auditor\'s 150 shops) passes', caps.askVerdict(Object.assign({}, none, { pending_by_asker: 150, asks_day: 150 }), limits) === null);
  const stopped = caps.askVerdict(Object.assign({}, none, { pending_by_asker: 200 }), limits);
  ok('caps: 200 waiting stops the 201st with 429 ASK_LIMIT in words', stopped && stopped.status === 429 && stopped.code === 'ASK_LIMIT' && /waiting/.test(stopped.message), JSON.stringify(stopped));
  ok('caps: 300 asks in a day stop the next', (caps.askVerdict(Object.assign({}, none, { asks_day: 300 }), limits) || {}).code === 'ASK_LIMIT');
  ok('caps: one business with 20 waiting asks refuses a 21st from anyone', (caps.askVerdict(Object.assign({}, none, { pending_to_target: 20 }), limits) || {}).code === 'ASK_LIMIT');
  ok('caps: one business with 10 asks in a day refuses an 11th', (caps.askVerdict(Object.assign({}, none, { asks_target_day: 10 }), limits) || {}).code === 'ASK_LIMIT');
  const now = new Date('2026-11-28T12:00:00Z');
  const cooling = caps.askVerdict(Object.assign({}, none, { last_decline: '2026-11-28T11:30:00Z' }), limits, now);
  ok('caps: 30 minutes after a Refuse the same ask is told to wait (429 ASK_COOLING_OFF)', cooling && cooling.code === 'ASK_COOLING_OFF' && cooling.status === 429, JSON.stringify(cooling));
  ok('caps: 2 hours after a Refuse the same ask is allowed again (a refused request may be asked again)', caps.askVerdict(Object.assign({}, none, { last_decline: '2026-11-28T10:00:00Z' }), limits, now) === null);
  ok('caps: refuseFirmAsk lets a clean ask through', (await rejects(caps.refuseFirmAsk(fakeDb({}, false), { actor: FIRM, parent: FIRM, child: SHOP }, fail409))) === null);
  const wrong = await rejects(caps.refuseFirmAsk(fakeDb({}, true), { actor: SHOP, parent: SHOP, child: FIRM }, fail409));
  ok('direction: a pair already connected the other way round is refused 409 FIRM_DIRECTION (a stranger cannot make the shop the "parent")', wrong && wrong.code === 'FIRM_DIRECTION' && wrong.status === 409, wrong && wrong.code);
  const limited = await rejects(caps.refuseFirmAsk(fakeDb({ pending_by_asker: 200 }, false), { actor: FIRM, parent: FIRM, child: SHOP }, fail409));
  ok('caps: refuseFirmAsk throws 429 ASK_LIMIT at 200 waiting', limited && limited.code === 'ASK_LIMIT' && limited.status === 429);
  const cool = await rejects(caps.refuseFirmAsk(fakeDb({ last_decline: new Date(Date.now() - 600000).toISOString() }, false), { actor: FIRM, parent: FIRM, child: SHOP }, fail409));
  ok('caps: refuseFirmAsk throws ASK_COOLING_OFF 10 minutes after a refusal', cool && cool.code === 'ASK_COOLING_OFF');
  const target = await rejects(caps.refuseFirmAsk(fakeDb({ pending_to_target: 20 }, false), { actor: FIRM, parent: FIRM, child: SHOP }, fail409));
  ok('caps: a shop with 20 waiting requests refuses another firm\'s ask (no wall of strangers)', target && target.code === 'ASK_LIMIT');
}

async function inviteTests() {
  invite.reset();
  const sent = [];
  const deps = (delivered) => ({ query: async () => ({ rows: [{ name: 'Rao <b>Stores</b>', user_id: 'rao-stores', bridge_id: 'CBRAO1' }] }), sendEmail: async (to, subject, html) => { sent.push({ to, subject, html }); return { delivered }; } });
  const first = await invite.sendFirmInvite({ entityId: 'owner1', email: 'partner@example.com', deps: deps(true) });
  ok('invite: delivered says sent: true', first.sent === true && first.delivered === true);
  ok('invite: the e-mail names the shop, its sign-in name and what to do, from a fixed template', /rao-stores/.test(sent[0].html) && /Rao/.test(sent[0].html) && /ask .* to connect/i.test(sent[0].html) && /Nothing is shared/.test(sent[0].html));
  ok('invite: the shop name is escaped (no markup of the sender in the mail)', !/<b>Stores<\/b>/.test(sent[0].html) && /&lt;b&gt;/.test(sent[0].html));
  const again = await rejects(invite.sendFirmInvite({ entityId: 'owner2', email: 'Partner@Example.com', deps: deps(true) }));
  ok('invite: the same address a second time (any business, any case) is 429 INVITE_LIMIT', again && again.code === 'INVITE_LIMIT' && again.status === 429, again && again.code);
  const unsent = await invite.sendFirmInvite({ entityId: 'owner3', email: 'other@example.com', deps: deps(false) });
  ok('invite: not delivered says sent: false and says NOT sent (never a false "sent")', unsent.sent === false && unsent.delivered === false && /NOT sent/.test(unsent.message), JSON.stringify(unsent));
  const thrown = await invite.sendFirmInvite({ entityId: 'owner4', email: 'third@example.com', deps: Object.assign(deps(true), { sendEmail: async () => { throw new Error('mail down'); } }) });
  ok('invite: a mail fault reads as not sent, never a 500 and never "sent"', thrown.sent === false);
  let last = null;
  for (let n = 0; n < 20; n++) last = await rejects(invite.sendFirmInvite({ entityId: 'busy', email: 'b' + n + '@example.com', deps: deps(true) }));
  const twentyFirst = await rejects(invite.sendFirmInvite({ entityId: 'busy', email: 'b99@example.com', deps: deps(true) }));
  ok('invite: 20 a day pass, the 21st from one business is 429', last === null && twentyFirst && twentyFirst.code === 'INVITE_LIMIT');
  const source = require('fs').readFileSync(path.join(API, 'lib', 'firm-invite.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  ok('invite: nothing connects and nothing is written (no INSERT, no edge in the module)', !/INSERT|cb_edge/i.test(source));
}

async function costsTests() {
  const before = { grant_id: 'g1', can_see_costs: false };
  const tx = (state) => ({ query: async (sql, params) => { if (state.refuse) throw Object.assign(new Error('permission denied'), { code: '42501' }); state.ran.push(params); return { rows: [{ can_see_costs: params[1] }] }; } });
  const state = { ran: [] };
  const noConsent = await rejects(grants.changeCosts(tx(state), before, {}, { can_see_costs: true }));
  ok('costs: a RISE without consent is refused 422 BOOKS_GRANT_CONSENT_NEEDED by the server', noConsent && noConsent.code === 'BOOKS_GRANT_CONSENT_NEEDED' && noConsent.status === 422 && !state.ran.length, noConsent && noConsent.code);
  const wrongConsent = await rejects(grants.changeCosts(tx(state), before, {}, { can_see_costs: true, consent: 'yes' }));
  ok('costs: consent must be exactly true (a string is not a yes)', wrongConsent && wrongConsent.code === 'BOOKS_GRANT_CONSENT_NEEDED');
  const after = {};
  await grants.changeCosts(tx(state), before, after, { can_see_costs: true, consent: true });
  ok('costs: a rise with consent writes can_see_costs = true', after.can_see_costs === true && state.ran.length === 1);
  const down = {};
  await grants.changeCosts(tx(state), { grant_id: 'g1', can_see_costs: true }, down, { can_see_costs: false });
  ok('costs: a fall needs no consent and writes false', down.can_see_costs === false && state.ran.length === 2);
  await grants.changeCosts(tx(state), before, {}, { expires_at: 'x' });
  await grants.changeCosts(tx(state), { grant_id: 'g1', can_see_costs: true }, {}, { can_see_costs: true });
  ok('costs: a change that names no costs, or the same value, writes nothing', state.ran.length === 2);
  const off = await rejects(grants.changeCosts(tx({ ran: [], refuse: true }), before, {}, { can_see_costs: true, consent: true }));
  ok('costs: before b915 runs (42501) the owner is told in words, 503 BOOKS_GRANT_NOT_SWITCHED_ON', off && off.code === grants.NOT_ON && off.status === 503 && /not switched on/.test(off.words), off && off.code);
}

function visitTests() {
  const at = (minutes) => new Date(Date.UTC(2026, 10, 28, 0, 0) + minutes * 60000).toISOString();
  const look = (minutes, who, route, extra) => Object.assign({ at: at(minutes), grant_id: 'g1', grantee_entity: 'firm1', actor_identity_id: who, actor_name: who && 'Pat', actor_entity_name: 'Smith & Co', preset: 'auditor', route_pattern: route || 'GET /trial-balance', outcome: 'allowed' }, extra);
  ok('visits: no looks, no visits', visitsOf([]).length === 0);
  const edge = [look(0, 'p1'), look(30, 'p1')];
  ok('visits: two looks exactly 30 minutes apart are ONE visit', visitsOf(edge).length === 1 && visitsOf(edge)[0].pages === 2);
  const split = [look(0, 'p1'), look(31, 'p1')];
  ok('visits: 31 minutes apart are TWO visits (the 30-minute boundary)', visitsOf(split).length === 2);
  const chain = [look(0, 'p1'), look(25, 'p1'), look(50, 'p1'), look(75, 'p1')];
  ok('visits: a run where every gap is 25 minutes is one visit however long it lasts', visitsOf(chain).length === 1 && visitsOf(chain)[0].pages === 4);
  const two = visitsOf([look(0, 'p1'), look(1, 'p2')]);
  ok('visits: two people of one firm at the same time are two visits', two.length === 2);
  const nobody = visitsOf([look(0, null, 'GET /a', { actor_name: null }), look(2, null, 'GET /b', { actor_name: null })]);
  ok('visits: person-less looks group under the firm alone (actor_name null), one visit', nobody.length === 1 && nobody[0].actor_name === null && nobody[0].actor_entity_name === 'Smith & Co' && nobody[0].pages === 2);
  const other = visitsOf([look(0, 'p1'), look(1, 'p1', 'GET /x', { grant_id: 'g2' })]);
  ok('visits: a different grant is a different visit', other.length === 2);
  const detail = visitsOf([look(0, 'p1', 'GET /a'), look(1, 'p1', 'GET /a'), look(2, 'p1', 'GET /b', { outcome: 'read_only' })])[0];
  ok('visits: the pages are listed once each with a count, refused looks counted', detail.pages === 3 && detail.refused === 1 && detail.pages_list.length === 2 && detail.pages_list[0].route_pattern === 'GET /a' && detail.pages_list[0].count === 2, JSON.stringify(detail.pages_list));
  /* 55 raw looks: firm 1 (person p1) and firm 2 (person q1), each in bursts a few minutes apart, bursts two hours apart */
  const raw = [];
  for (let n = 0; n < 55; n++) {
    const firmOne = n % 2 === 1;
    raw.push(look(Math.floor(n / 11) * 120 + (n % 11), firmOne ? 'p1' : 'q1', 'GET /page' + (n % 7), { grantee_entity: firmOne ? 'firm1' : 'firm2', grant_id: firmOne ? 'g1' : 'g2', actor_entity_name: firmOne ? 'Smith & Co' : 'Jones Audit' }));
  }
  const grouped = visitsOf(raw);
  ok('visits: 55 raw looks of two firms become ' + grouped.length + ' visits (10 expected: 5 bursts x 2 firms), each naming its firm', grouped.length === 10 && grouped.every((v) => v.actor_entity_name) && grouped.reduce((sum, v) => sum + v.pages, 0) === 55, grouped.length);
  ok('visits: newest visit first', grouped.every((v, i) => i === 0 || new Date(grouped[i - 1].to) >= new Date(v.to)));
}

async function routeTests() {
  require.cache[asksPath].exports = stubbed; /* the route reads the stub (it requires lib/connect-asks when called) */
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.id = 'req-test'; next(); });
  app.use('/api/network', require(path.join(API, 'src', 'routes', 'network.js')));
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const owner = { identity_id: 'owner-1', identity_type: 'entity', parent_entity_id: null };
  const staff = { identity_id: 'staff-1', identity_type: 'actor', parent_entity_id: 'owner-1' };
  const call = async (method, url, who, body, key) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'x-test-as': JSON.stringify(who), ...(key ? { 'x-test-key': '1' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  try {
    const mine = await call('GET', '/api/network/asks', owner);
    ok('GET /asks: the owner reads { to_me, by_me } with the firm named and the direction (i_am shop)', mine.status === 200 && Array.isArray(mine.body.to_me) && mine.body.to_me[0].name === 'Smith & Co' && mine.body.to_me[0].i_am === 'shop' && Array.isArray(mine.body.by_me), JSON.stringify(mine));
    const before = asksCalls;
    const theirs = await call('GET', '/api/network/asks', staff);
    ok('GET /asks: a staff seat is refused 403 OWNER_ONLY and the reader is never called', theirs.status === 403 && theirs.body.code === 'OWNER_ONLY' && asksCalls === before, JSON.stringify(theirs));
    const keyed = await call('GET', '/api/network/asks', owner, null, true);
    ok('GET /asks: a key is refused 403', keyed.status === 403, keyed.status);
    const ask = await call('POST', '/api/network/connections', staff, { childHandle: 'some-shop', type: 'agency' });
    ok('POST /connections: a firm\'s staff seat cannot ask a shop to connect: 403 OWNER_ONLY, before anything is read', ask.status === 403 && ask.body.code === 'OWNER_ONLY', JSON.stringify(ask));
    const askKey = await call('POST', '/api/network/connections', owner, { childHandle: 'some-shop', type: 'agency' }, true);
    ok('POST /connections: a key cannot ask either (403)', askKey.status === 403, askKey.status);
    const inv = await call('POST', '/api/network/firm-invites', staff, { email: 'a@example.com' });
    ok('POST /firm-invites: a staff seat is refused 403 OWNER_ONLY', inv.status === 403 && inv.body.code === 'OWNER_ONLY', JSON.stringify(inv));
    const bad = await call('POST', '/api/network/firm-invites', owner, { email: 'not an address' });
    ok('POST /firm-invites: an address that is not one is 400 before any mail', bad.status === 400, JSON.stringify(bad));
    const extra = await call('POST', '/api/network/firm-invites', owner, { email: 'a@example.com', message: 'free text' });
    ok('POST /firm-invites: free text is refused (a fixed template: any other key is 400)', extra.status === 400, JSON.stringify(extra));
  } finally { server.close(); }
}

async function surfaceTests() {
  const ownerReq = { identity: { identity_id: 'o', parent_entity_id: null } };
  const staffReq = { identity: { identity_id: 's', parent_entity_id: 'o' } };
  const home = require(path.join(API, 'lib', 'home-facts.js'));
  ok('home: the Network card exists in the card list', typeof home.BUILD.network === 'function');
  const card = await home.BUILD.network({ entity: 'o', req: ownerReq });
  ok('home: the owner with one request reads "1 request to connect", tone dn, state needs_you', card.lines[0].text === '1 request to connect' && card.lines[0].tone === 'dn' && card.state === 'needs_you' && card.figures.requests === 1, JSON.stringify(card));
  const staffCard = await home.BUILD.network({ entity: 'o', req: staffReq });
  ok('home: a staff seat sees 0 requests (not started, no door)', staffCard.figures.requests === 0 && staffCard.state === 'not_started', JSON.stringify(staffCard));
  /* the bell: the real bellOf over the real asksOf with a fake pool (the SQL's rows: one waiting request to me) */
  const dbPath = require.resolve(path.join(API, 'src', 'db'));
  const realDb = require(dbPath);
  const originalQuery = realDb.pool.query;
  realDb.pool.query = async () => ({ rows: [{ edge_id: 'e9', type: 'agency', asked_at: '2026-11-28T01:00:00Z', i_am_parent: false, by_me: false, name: 'Smith & Co', bridge_id: 'CBSMITH', country: 'AU' }] });
  try {
    const bellOwner = await realAsks.bellOf('o', true);
    ok('bell: the owner\'s own count is the waiting requests and a feed row per request, pinned', bellOwner.count === 1 && bellOwner.rows[0].action === 'connect_ask' && bellOwner.rows[0].edge_id === 'e9' && bellOwner.rows[0].action_by_display_name === 'Smith & Co' && bellOwner.rows[0].i_am === 'shop');
    const bellStaff = await realAsks.bellOf('o', false);
    ok('bell: a staff seat gets 0 and no rows', bellStaff.count === 0 && bellStaff.rows.length === 0);
    realDb.pool.query = async (sql) => { ok('asks: the one statement reads firm (agency) edges only; a brand\'s invitation is not in Home, the bell or the list', /e\.type = 'agency'/.test(sql)); return { rows: [] }; };
    await realAsks.asksOf('o');
    const roles = (row) => realAsks.asksOf('o').then(() => row);
    void roles;
  } finally { realDb.pool.query = originalQuery; }
  ok('asks: the reader is exported for the route, the card and the bell', typeof realAsks.asksOf === 'function' && typeof realAsks.pendingCount === 'function' && typeof realAsks.bellOf === 'function');
}

(async () => {
  console.log('\n── firm-connect-1138 · api, no database' + (wanted ? ' · MUTANT ' + process.env.FIRM_CONNECT_MUTATE : '') + ' ──');
  try {
    await capsTests(); await inviteTests(); await costsTests(); visitTests(); await routeTests(); await surfaceTests();
  } catch (e) { ok('the run reached its end', false, e && e.stack); }
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
