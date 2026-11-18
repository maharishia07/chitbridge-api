/**
 * tests/readab-units.test.cjs — the unit evidence (DISCIPLINES §7: one test per rule, a refusal path, fail closed) for seven small modules that came in with the 1118v2 batch.
 * No database, no network: a stand-in connection that records what it is asked, and the module under test as it is.
 *
 * HAND-COMPUTED (each expectation is the rule's own sentence, not a read-back of the code):
 *   auto-assign          off = nobody is assigned · an unknown mode = nobody is assigned · a delegate chain that loops = nobody is assigned · a copy already held is left alone · a database that is down refuses and writes nothing.
 *   books-readers        a key never reads the books' money (not even an owner's) · the owner, a live grant and the shop's auditor do · a staff seat is refused (403 OWNER_ONLY) · a check that fails is refused, never let through.
 *   crm-followup-heir    the colleague chosen wins · else the shop's default assignee, unless that is the leaver or may not hold work · no settings row = the Unassigned bucket.
 *   own-limiters         four limiters, each its own name and max (40, 10, 30, 300), keyed by caller; the chit status limiter counts a PUT only.
 *   policy-signin        a sign-in text flag takes a string only (a list or an object is refused), control characters out, cut to its max.
 *   public-base          the configured base wins · a forged Host that is not loopback names nothing (relative links) · a loopback Host names itself.
 *   src/services/chit    an edge with an open chit is blocked; with none it is not; a connection that fails refuses (the error goes up, no silent "nothing open").
 * MIN unit-per-rule
 * MIN refusal-path
 * MIN fail-closed
 * Run: node tests/readab-units.test.cjs
 * CARD 01-rail-core-the-chit/assign
 */
'use strict';
const path = require('path');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const API = path.join(__dirname, '..');

/* a database that is down: every entry point of db/index.js refuses (the stand-in for "the database is unavailable") */
const dbPath = require.resolve(path.join(API, 'db'));
const downError = Object.assign(new Error('the database is unavailable'), { code: 'ECONNREFUSED' });
const dbDown = new Proxy({}, { get: (_, name) => (name === '__esModule' ? false : async () => { throw downError; }) });
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: dbDown };

let pass = 0;
let fail = 0;
const check = (name, ok, extra) => {
  if (ok) pass++;
  else {
    fail++;
    console.log('  FAIL ' + name + (extra ? '\n       ' + extra : ''));
  }
};
const FIRM = '11111111-1111-4111-8111-111111111111';
const LEAVER = '22222222-2222-4222-8222-222222222222';
const COLLEAGUE = '33333333-3333-4333-8333-333333333333';
const DEFAULT_PERSON = '44444444-4444-4444-8444-444444444444';
const CHIT = '55555555-5555-4555-8555-555555555555';
const norm = (sql) => String(sql).replace(/\s+/g, ' ').trim();

(async () => {
  /* ── auto-assign: fail closed ─────────────────────────────────────────────── */
  const autoAssign = require('../lib/auto-assign');
  /** a connection that answers by what is asked and keeps every statement; `world` says what the shop looks like */
  const connection = (world) => {
    const seen = [];
    return {
      seen,
      writes: () => seen.filter((sql) => /^(INSERT|UPDATE|DELETE)/i.test(sql)),
      async query(sql) {
        const text = norm(sql);
        seen.push(text);
        if (/FROM entity_actor_settings/.test(text)) return { rows: world.settings ? [world.settings] : [] };
        if (/FROM chit_status WHERE chit_id/.test(text)) return { rows: world.copy ? [world.copy] : [] };
        if (/break_status, hat, to_jsonb\(identities\)/.test(text)) return { rows: world.actors ? [world.actors.shift()].filter(Boolean) : [] };
        return { rows: [] };
      }
    };
  };
  const unassigned = { assigned_to_actor_id: null, current_status: 'pending' };

  const dbPathReal = dbPath;
  /** run autoAssign against a stand-in connection by pointing the db stand-in's withEntity at it */
  const runWith = async (world) => {
    const conn = connection(world);
    require.cache[dbPathReal].exports = { withEntity: async (_entity, work) => work(conn) };
    delete require.cache[require.resolve('../lib/auto-assign')];
    const fresh = require('../lib/auto-assign');
    const result = await fresh.autoAssign(FIRM, CHIT, 'task');
    return { result, conn };
  };

  let run = await runWith({ settings: { auto_assign_mode: 'off' }, copy: unassigned });
  check('auto-assign: mode off = nobody is assigned, nothing written', run.result === null && run.conn.writes().length === 0);

  run = await runWith({ settings: null, copy: unassigned });
  check('auto-assign: no settings row reads as off (fail closed), nothing written', run.result === null && run.conn.writes().length === 0);

  run = await runWith({ settings: { auto_assign_mode: 'sideways', default_assignee_actor_id: DEFAULT_PERSON }, copy: unassigned });
  check('auto-assign: an unknown mode picks nobody (fail closed), nothing written', run.result === null && run.conn.writes().length === 0);

  run = await runWith({ settings: { auto_assign_mode: 'default_assignee', default_assignee_actor_id: DEFAULT_PERSON }, copy: { assigned_to_actor_id: COLLEAGUE, current_status: 'pending' } });
  check('auto-assign: a copy already held is left alone, nothing written', run.result === null && run.conn.writes().length === 0);

  run = await runWith({
    settings: { auto_assign_mode: 'default_assignee', default_assignee_actor_id: DEFAULT_PERSON },
    copy: unassigned,
    actors: [
      { identity_id: DEFAULT_PERSON, break_status: 'leave', hat: 'act', access_level: null, delegate_actor_id: COLLEAGUE },
      { identity_id: COLLEAGUE, break_status: 'leave', hat: 'act', access_level: null, delegate_actor_id: DEFAULT_PERSON }
    ]
  });
  check('auto-assign: a delegate chain that loops gives up and assigns nobody (the chit stays in the pool)', run.result === null && run.conn.writes().length === 0);

  run = await runWith({ settings: { auto_assign_mode: 'default_assignee', default_assignee_actor_id: DEFAULT_PERSON }, copy: unassigned, actors: [] });
  check('auto-assign: a default assignee who is not on this shop is refused, nobody is assigned', run.result === null && run.conn.writes().length === 0);

  require.cache[dbPathReal].exports = dbDown;
  delete require.cache[require.resolve('../lib/auto-assign')];
  let refused = null;
  try {
    await require('../lib/auto-assign').autoAssign(FIRM, CHIT, 'task');
  } catch (failure) {
    refused = failure;
  }
  check('auto-assign: a database that is down refuses (the caller carries on without it); nothing is assigned', !!refused && refused.code === 'ECONNREFUSED');

  /* ── books-readers ────────────────────────────────────────────────────────── */
  const { readers, READ_MONEY_WORDS } = require('../lib/books-readers');
  const refusals = [];
  const gates = (who) =>
    readers({
      isOwner: (req) => !!req.owner,
      roleGate: (_role, handler) => handler,
      problem: (_req, _res, spec) => refusals.push(spec),
      refusalOf: (err) => ({ status: 503, code: 'CHECK_FAILED', detail: err.message }),
      ctx: () => ({}),
      auditorMay: async (req) => {
        if (who.fail) throw new Error('the check could not run');
        return !!req.auditor;
      }
    });
  const gate = gates({});
  check('books-readers: the owner reads the money', (await gate.mayReadMoney({ owner: true })) === true);
  check('books-readers: a live grant reads the money', (await gate.mayReadMoney({ acting_for_grant: 'g1' })) === true);
  check("books-readers: the shop's auditor reads the money", (await gate.mayReadMoney({ auditor: true })) === true);
  check('books-readers: a plain staff seat does not', (await gate.mayReadMoney({})) === false);
  check("books-readers: a key never reads the money, not even the owner's", (await gate.mayReadMoney({ api_key: 'k', owner: true })) === false);

  let nextCalled = 0;
  await gate.moneyReader({ owner: true }, {}, () => nextCalled++);
  check('books-readers: the money gate lets the owner through', nextCalled === 1 && refusals.length === 0);
  await gate.moneyReader({}, {}, () => nextCalled++);
  check('books-readers: the money gate refuses a staff seat 403 OWNER_ONLY in words', nextCalled === 1 && refusals.length === 1 && refusals[0].status === 403 && refusals[0].code === 'OWNER_ONLY' && refusals[0].detail === READ_MONEY_WORDS);
  const broken = gates({ fail: true });
  await broken.moneyReader({}, {}, () => nextCalled++);
  check('books-readers: when the check itself fails the gate refuses, it never lets the request through (fail closed)', nextCalled === 1 && refusals.length === 2 && refusals[1].code === 'CHECK_FAILED');

  const periodsReq = { owner: false };
  await gate.periodsReader(periodsReq, {}, () => nextCalled++);
  check('books-readers: the months list opens to every signed-in seat and says whether this one reads the money', nextCalled === 2 && periodsReq.reads_money === false);
  await gate.periodsReader({ api_key: 'k' }, {}, () => nextCalled++);
  check('books-readers: the months list refuses a key', nextCalled === 2 && refusals.length === 3 && refusals[2].code === 'OWNER_ONLY');
  const months = [{ period: '2026-04', sales_minor: 500 }];
  check('books-readers: a seat that may not read the money gets the months without sales_minor', JSON.stringify(gate.stripFigures({ reads_money: false }, months)) === JSON.stringify([{ period: '2026-04' }]));
  check('books-readers: a seat that may read the money keeps the figures', gate.stripFigures({ reads_money: true }, months)[0].sales_minor === 500);

  /* ── crm-followup-heir ────────────────────────────────────────────────────── */
  const { heirOf } = require('../lib/crm-followup-heir');
  /** a handle for the heir's two reads: the settings row, and the team + assignable reads of lib/assign-chit */
  const handleFor = ({ defaultAssignee, onTeam, mayHold }) => ({
    async query(sql) {
      const text = norm(sql);
      if (/FROM entity_actor_settings/.test(text)) return { rows: defaultAssignee === undefined ? [] : [{ default_assignee_actor_id: defaultAssignee }] };
      if (/ANY\(\$1::uuid\[\]\)/.test(text)) return { rows: onTeam ? [{ identity_id: defaultAssignee }] : [] };
      return { rows: mayHold ? [{ identity_id: defaultAssignee }] : [] };
    }
  });
  check('crm-followup-heir: the colleague chosen for the tasks inherits the follow-ups', (await heirOf(handleFor({}), FIRM, LEAVER, { identity_id: COLLEAGUE })) === COLLEAGUE);
  check("crm-followup-heir: else the shop's default assignee, when on the team and may hold work", (await heirOf(handleFor({ defaultAssignee: DEFAULT_PERSON, onTeam: true, mayHold: true }), FIRM, LEAVER, null)) === DEFAULT_PERSON);
  check('crm-followup-heir: the default assignee is the leaver: nobody (Unassigned), never back to the leaver', (await heirOf(handleFor({ defaultAssignee: LEAVER, onTeam: true, mayHold: true }), FIRM, LEAVER, null)) === null);
  check('crm-followup-heir: a default assignee who may not hold work (a viewer) is refused: Unassigned', (await heirOf(handleFor({ defaultAssignee: DEFAULT_PERSON, onTeam: true, mayHold: false }), FIRM, LEAVER, null)) === null);
  check('crm-followup-heir: a default assignee who is not on the team is refused: Unassigned (fail closed)', (await heirOf(handleFor({ defaultAssignee: DEFAULT_PERSON, onTeam: false, mayHold: true }), FIRM, LEAVER, null)) === null);
  check('crm-followup-heir: no settings row = Unassigned', (await heirOf(handleFor({}), FIRM, LEAVER, null)) === null);

  /* ── own-limiters ─────────────────────────────────────────────────────────── */
  const { mount } = require('../lib/own-limiters');
  const mounted = [];
  const app = { use: (route, limiter) => mounted.push({ route, limiter }) };
  mount(app, { rateLimit: (options) => options, intFromEnv: (_name, fallback) => fallback });
  const byName = Object.fromEntries(mounted.map((item) => [item.limiter.name, item]));
  check('own-limiters: four limiters, each with its own name', mounted.length === 4 && ['api-governance-ai-draft', 'api-connector-reissue-code', 'api-connector-erp-test', 'api-chit-status'].every((name) => byName[name]));
  check('own-limiters: the maxima are 40, 10, 30 and 300 (each tighter than the global 500)', byName['api-governance-ai-draft'].limiter.max === 40 && byName['api-connector-reissue-code'].limiter.max === 10 && byName['api-connector-erp-test'].limiter.max === 30 && byName['api-chit-status'].limiter.max === 300);
  check('own-limiters: every limiter is keyed by the caller (a login cannot spend another login\'s allowance)', mounted.every((item) => typeof item.limiter.keyGenerator === 'function'));
  check('own-limiters: a refusal says too many requests, in words', mounted.every((item) => item.limiter.message.error === 'Too many requests' && /try again/.test(item.limiter.message.message)));
  const statusLimiter = byName['api-chit-status'].limiter;
  check('own-limiters: the chit status limiter counts a PUT only (a read is skipped)', statusLimiter.skip({ method: 'GET' }) === true && statusLimiter.skip({ method: 'PUT' }) === false);

  /* ── policy-signin ────────────────────────────────────────────────────────── */
  const policySignin = require('../lib/policy-signin');
  const textFlag = policySignin.FLAGS.signin_required_org;
  check('policy-signin: the org flag is a text flag the owner alone may change', textFlag.type === 'text' && textFlag.may === 'owner');
  check('policy-signin: a string is taken trimmed', policySignin.coerceText(textFlag, '  contoso.com  ') === 'contoso.com');
  check('policy-signin: control characters are taken out', policySignin.coerceText(textFlag, 'con\u0000to\u001fso') === 'contoso');
  check('policy-signin: it is cut to its max', policySignin.coerceText({ max: 5 }, 'abcdefgh') === 'abcde');
  check('policy-signin: a list, an object, a number and null are refused (undefined), never stored as text', [['a'], { a: 1 }, 7, null, undefined].every((value) => policySignin.coerceText(textFlag, value) === undefined));
  check('policy-signin: an empty string is a real value (the default)', policySignin.coerceText(textFlag, '') === '');
  check('policy-signin: every flag has its card row', Object.keys(policySignin.FLAGS).every((key) => policySignin.CARD[key] && policySignin.CARD[key].label));

  /* ── public-base ──────────────────────────────────────────────────────────── */
  const publicBase = require('../lib/public-base');
  const request = (host) => ({ get: (name) => (name.toLowerCase() === 'host' ? host : undefined) });
  const savedApi = process.env.PUBLIC_API_BASE;
  const savedWeb = process.env.PUBLIC_WEB_BASE;
  delete process.env.PUBLIC_API_BASE;
  process.env.PUBLIC_WEB_BASE = 'https://app.example.com//';
  check('public-base: a forged Host that is not loopback names nothing (relative links): refused', publicBase.apiBase(request('evil.example.com')) === '');
  check('public-base: no request at all names nothing', publicBase.apiBase(undefined) === '');
  check('public-base: a loopback Host names itself over http', publicBase.apiBase(request('localhost:3000')) === 'http://localhost:3000');
  process.env.PUBLIC_API_BASE = 'https://api.example.com/';
  check('public-base: the configured base wins over any Host, trailing slash off', publicBase.apiBase(request('evil.example.com')) === 'https://api.example.com');
  check('public-base: the web base is trimmed', publicBase.webBase() === 'https://app.example.com');
  delete process.env.PUBLIC_WEB_BASE;
  check('public-base: no web base = empty, so callers use a relative path (fail closed)', publicBase.webBase() === '');
  if (savedApi === undefined) delete process.env.PUBLIC_API_BASE;
  else process.env.PUBLIC_API_BASE = savedApi;
  if (savedWeb !== undefined) process.env.PUBLIC_WEB_BASE = savedWeb;

  /* ── src/services/chit ────────────────────────────────────────────────────── */
  const { edgeHasOpenChit } = require('../src/services/chit');
  check('chit service: an edge with a live chit is blocked from disconnecting', (await edgeHasOpenChit('edge-1', { query: async () => ({ rows: [{ '?column?': 1 }] }) })) === true);
  check('chit service: an edge with none is not', (await edgeHasOpenChit('edge-2', { query: async () => ({ rows: [] }) })) === false);
  let chitRefused = null;
  try {
    await edgeHasOpenChit('edge-3', { query: async () => { throw downError; } });
  } catch (failure) {
    chitRefused = failure;
  }
  check('chit service: a connection that fails refuses (the error goes up; never a silent "nothing open")', chitRefused === downError);

  /* ── tools/resource-cap-live.cjs: it refuses to run without its inputs or against a database that is not a throwaway one ── */
  const { spawnSync } = require('child_process');
  const tool = path.join(API, 'tools', 'resource-cap-live.cjs');
  const asked = (args, env) => spawnSync(process.execPath, [tool, ...args], { env: Object.assign({}, process.env, { DATABASE_URL: '', JWT_SECRET: '' }, env), encoding: 'utf8', timeout: 20000 });
  const bare = asked([], {});
  check('resource-cap-live: with no --base, database or secret it refuses (exit 3) and says what it needs', bare.status === 3 && /needs --base/.test(bare.stderr));
  const production = asked(['--base', 'http://127.0.0.1:1'], { DATABASE_URL: 'postgres://cb_app:x@db.prod.example.com:5432/app', JWT_SECRET: 'x' });
  check('resource-cap-live: a database that is not localhost, the compose db or a SIT host is REFUSED (exit 3), never touched', production.status === 3 && /REFUSED/.test(production.stderr));
  const wrongUser = asked(['--base', 'http://127.0.0.1:1'], { DATABASE_URL: 'postgres://postgres:x@localhost:5432/app', JWT_SECRET: 'x' });
  check('resource-cap-live: a database user that is not cb_app is REFUSED (exit 3)', wrongUser.status === 3 && /REFUSED/.test(wrongUser.stderr));

  console.log('readab-units: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((failure) => {
  console.log('readab-units crashed:', failure && failure.stack);
  process.exit(1);
});
