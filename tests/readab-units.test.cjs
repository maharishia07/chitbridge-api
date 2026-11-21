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

  /* ── the four part files of the 1126 size split (no behaviour moved): lib/work-unbilled.js · lib/profile-payee.js · lib/country-setup-merge.js · lib/books-hooks-use.js ── */
  const unbilled = require(path.join(API, 'lib', 'work-unbilled'));
  const invoice = (value, currency) => ({ r: { currency, value } });
  const paise = (value) => (value == null ? null : Math.round(Number(value) * 100)); /* the 2-decimal minor unit work-rows hands in (INR paise, AED fils at 100 as the hand computation says) */
  check('lib/work-unbilled.js: 1000 and 500 rupees are 150000 paise in ONE currency bucket (hand-computed)', unbilled.sumUnbilled([invoice(1000, 'INR'), { r: { currency: 'INR', alt_value: 500 } }], paise).minor === 150000);
  check('lib/work-unbilled.js: two currencies are never added (minor null, a bucket each: 100000 INR paise, 500 AED fils)', (() => { const two = unbilled.sumUnbilled([invoice(1000, 'INR'), invoice(5, 'AED')], paise); return two.minor === null && two.by_currency.length === 2; })());
  check('lib/work-unbilled.js: no unbilled order is a real 0, not a missing figure', unbilled.sumUnbilled([], paise).minor === 0);
  check('lib/work-unbilled.js: a blind reader gets the sum only when EVERY order is a sale, else minor null and cost_hidden', (() => {
    const left = [{ r: { chit_id: 'a', currency: 'INR', value: 100 } }, { r: { chit_id: 'b', currency: 'INR', value: 100 } }];
    const mixed = unbilled.blindSum(left, new Map([['a', 'sell'], ['b', 'buy']]), paise);
    return unbilled.blindSum(left, new Map([['a', 'sell'], ['b', 'sell']]), paise).minor === 20000 && mixed.minor === null && mixed.cost_hidden === true;
  })());
  let unbilledRefused = null;
  try {
    await unbilled.unbilledItems({ entity: 'e', actor: 'a' }, [{ tab: 'orders_in', r: { chit_id: 'c' } }]);
  } catch (failure) {
    unbilledRefused = failure;
  }
  check('lib/work-unbilled.js: a read that fails refuses (the error goes up; never a silent "nothing unbilled")', unbilledRefused === downError);

  const payee = require(path.join(API, 'lib', 'profile-payee'));
  check('lib/profile-payee.js: the mirrored UPI id is read, a malformed one is refused as no payee, a missing row is no payee', payee.upiOf({ profile_provenance: { upi_id: { value: 'shop@okbank' } } }) === 'shop@okbank' && payee.upiOf({ profile_provenance: { upi_id: { value: 'nope' } } }) === null && payee.upiOf(null) === null);
  check('lib/profile-payee.js: payeesOf names the one scheme kept today (upi) and nothing else', JSON.stringify(payee.payeesOf(null)) === '{"upi":null}');
  const unreadable = {};
  Object.defineProperty(unreadable, 'profile_provenance', { get() { throw new Error('unreadable'); } });
  check('lib/profile-payee.js: a policy_flags that cannot be read fails closed to no payee (never a guessed address)', payee.upiOf(unreadable) === null);

  const { boundTo } = require(path.join(API, 'lib', 'country-setup-merge'));
  const refuseWith = (code, message, status) => Object.assign(new Error(message), { code, status });
  const merge = boundTo({ refuse_: refuseWith, registeredOf: (answer) => (answer === true ? true : answer === false ? false : null), registrationOf: (given) => (given.number ? 'regular' : 'unknown') });
  const held = { country: { code: 'IN' }, tax: { registered: true, number: '27AAAAA0000A1Z5', scheme: 'regular' } };
  check('lib/country-setup-merge.js: no tax key in the body writes nothing (written false)', merge.mergeTax_(held, {}, 'IN').written === false);
  check('lib/country-setup-merge.js: a stray tax key is refused by name (COUNTRY_SETUP_BAD 400)', (() => { try { merge.mergeTax_(held, { tax: { colour: 'red' } }, 'IN'); } catch (failure) { return failure.code === 'COUNTRY_SETUP_BAD' && failure.status === 400 && /colour/.test(failure.message); } return false; })());
  check('lib/country-setup-merge.js: a tax answer that is not an object is refused (COUNTRY_SETUP_BAD)', (() => { try { merge.mergeTax_(held, { tax: [] }, 'IN'); } catch (failure) { return failure.code === 'COUNTRY_SETUP_BAD'; } return false; })());
  const off = merge.mergeTax_(held, { tax: { registered: false } }, 'IN');
  check('lib/country-setup-merge.js: an explicit "not registered" over a registration clears number and scheme and is marked deregistered', off.deregistered === true && off.tax.number === null && off.tax.scheme === null);
  check('lib/country-setup-merge.js: taking a registered shop off its tax is REFUSED (409 TAX_DEREGISTER_UNCONFIRMED) unless confirm_deregister is true', (() => {
    try { merge.needsConfirm_(off, {}, 'IN'); } catch (failure) { merge.needsConfirm_(off, { confirm_deregister: true }, 'IN'); return failure.code === 'TAX_DEREGISTER_UNCONFIRMED' && failure.status === 409; }
    return false;
  })());
  check('lib/country-setup-merge.js: null is "not said" and keeps the held answer', merge.mergeTax_(held, { tax: { registered: null, number: null } }, 'IN').tax.number === held.tax.number);

  const { useEvents } = require(path.join(API, 'lib', 'books-hooks-use'));
  const tools = { byRateOf: (bill) => ({ rows: bill.ItemList.map((line) => ({ taxable: line.amount, cgst: 0, sgst: 0, igst: 0, cess: 0 })) }), roundMoney: (value) => Math.round(value * 100) / 100, sumOf: (list, field) => list.reduce((total, item) => total + (item[field] || 0), 0) };
  const lines = (...amounts) => amounts.map((amount) => ({ amount }));
  const built = useEvents(tools, { chit_id: 'C1' }, { date: '2026-11-21' }, 'SUP', { resale: lines(100), asset: lines(300), use: lines(40, 10), _cb: null }, { cash: 450, upi: 0 }, 2, '2026-12-21', { use_class: 'repairs' }, { class: 'plant', put_to_use: '2026-11-21', register: true });
  check('lib/books-hooks-use.js: resale, asset, use and a payment are four events, each with its own source_ref (a retry posts only what has not)', JSON.stringify(built.events.map((event) => event.source_ref)) === '["chit:C1","chit:C1:asset","chit:C1:use","chit:C1:paid:cash"]');
  check('lib/books-hooks-use.js: the round-off rides the purchase only (the asset 0, the expense none), hand-computed 2 / 0 / 50', built.events[0].round_off === 2 && built.events[1].round_off === 0 && built.events[2].amount === 50 && built.events[2].class === 'repairs');
  check('lib/books-hooks-use.js: a mode paid 0 posts nothing (no upi event)', built.events.every((event) => event.mode !== 'upi'));
  const whole = useEvents(tools, { chit_id: 'C2' }, {}, 'SUP', { resale: [], asset: [], use: lines(40), _cb: null }, {}, 3, null, null, null);
  check('lib/books-hooks-use.js: a bill that is all own-use is one expense on the bill own source, the round-off inside it (43)', whole.events.length === 1 && whole.events[0].source_ref === 'chit:C2' && whole.events[0].amount === 43 && whole.events[0].class === 'sundry_expense');
  let noSplit = null;
  try {
    useEvents(tools, { chit_id: 'C3' }, {}, 'SUP', undefined, {}, 0, null, null, null);
  } catch (failure) {
    noSplit = failure;
  }
  check('lib/books-hooks-use.js: a bill with no split is refused with an error (nothing is posted from a guess)', noSplit instanceof Error);

  /* ── middleware/auth-preview.js (the owner's preview token read, split out of middleware/auth.js): every doubt is a stranger ── */
  const { previewIdentity } = require(path.join(API, 'middleware', 'auth-preview'));
  const previewShop = { identity_id: '11111111-1111-4111-8111-111111111111', bridge_id: 'BR-ONE' };
  const previewReq = (over) => Object.assign({ method: 'GET', query: { preview: '1' }, headers: {} }, over);
  const previewToken = require(path.join(API, 'lib', 'preview-token')).mint(previewShop.identity_id).token;
  check('middleware/auth-preview.js: a read without ?preview=1 is a stranger (null), the token is never looked at', (await previewIdentity(previewReq({ query: {}, headers: { authorization: 'Bearer ' + previewToken } }), previewShop)) === null);
  check('middleware/auth-preview.js: a write (POST) is a stranger even with ?preview=1 and a good token', (await previewIdentity(previewReq({ method: 'POST', headers: { authorization: 'Bearer ' + previewToken } }), previewShop)) === null);
  check('middleware/auth-preview.js: no bearer header is a stranger (null)', (await previewIdentity(previewReq(), previewShop)) === null);
  check('middleware/auth-preview.js: a token that is not a preview token (bad signature) is a stranger, not an error', (await previewIdentity(previewReq({ headers: { authorization: 'Bearer not.a.token' } }), previewShop)) === null);
  check('middleware/auth-preview.js: a good preview token fails closed when the business status cannot be read (database down: null, never an identity)', (await previewIdentity(previewReq({ headers: { authorization: 'Bearer ' + previewToken } }), previewShop)) === null);

  console.log('readab-units: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((failure) => {
  console.log('readab-units crashed:', failure && failure.stack);
  process.exit(1);
});
