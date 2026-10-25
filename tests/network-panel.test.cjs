/**
 * tests/network-panel.test.cjs — THE NETWORK CONTROL PANEL, SLICE 1 (read-only, 25 Oct 2026). GET /api/network/installations with the database stubbed.
 *   counts · master-only gate · a member's root is told who controls it · a non-root is refused · status from the CERTIFICATE · ZERO outbound calls · actions are data with may:false ·
 *   listed null is "not recorded" · the master's pull records version + last_seen and survives a /health failure (keeps the old version, records why)
 */
'use strict';
const path = require('path');
const http = require('http');
const ROOT_ID = '11111111-1111-4111-8111-111111111111';
process.env.PLATFORM_ROOT_ENTITY = ROOT_ID;
process.env.INSTALLATION_KEY = 'sit-root';
process.env.CB_CTP_ALLOW_PRIVATE = '1';
const G = require('./support/route-golden.cjs');
const API = G.API;

const sqls = [];
let answers = () => [];
const h = G.harness({ rows: (s, p) => { sqls.push({ s, p }); return answers(s, p); } });
const keys = require(path.join(API, 'lib', 'ctpkeys'));
const net = require(path.join(API, 'lib', 'netmember'));
const directory = require(path.join(API, 'lib', 'ctpdirectory'));
const ctpquery = require(path.join(API, 'lib', 'ctpquery'));
const sync = require(path.join(API, 'lib', 'netsync'));
const panel = require(path.join(API, 'lib', 'netpanel'));

let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (extra ? '\n          ' + extra : '')); } };

const NOW = Date.now();
const day = (n) => new Date(NOW + n * 86400000).toISOString();
const row = (patch) => Object.assign({ installation_key: 'x', domain: 'x.example.com', country: null, network_role: 'member', root_handle: null, active: true, hosted_locally: false,
  version: null, last_seen: null, seen_error: null, listed: null, entities: 0, certificate: null, certificate_status: null, certificate_not_after: null,
  pulled_to: null, entities_claimed: null, pulled_at: null, pull_error: null }, patch);
const ROWS = [
  row({ installation_key: 'sit-root', domain: 'root.example.com', network_role: 'master', hosted_locally: true }),
  row({ installation_key: 'sit-in', domain: 'in.example.com', country: 'IN', certificate_status: 'active', certificate_not_after: day(25), entities: 3, entities_claimed: 4, pulled_at: day(0), version: '1.9.0+abc1234', last_seen: day(0), listed: true }),
  row({ installation_key: 'sit-au', domain: 'au.example.com', country: 'AU', certificate_status: 'suspended', certificate_not_after: day(25), active: true, pull_error: 'no answer', listed: false }),
  row({ installation_key: 'sit-ae', domain: 'ae.example.com', country: 'AE', certificate_status: 'active', certificate_not_after: day(-1) })
];

const isRoleRead = (s) => /network_role' AS network_role/.test(s);
const isList = (s) => /FROM installation i WHERE NOT i.hosted_locally/.test(s);

function asRole(role) {
  net._reset();
  keys._reset();
  delete process.env.CB_MASTER_DOMAIN; delete process.env.CB_MASTER_INSTALLATION; delete process.env.CB_MASTER_KEY;
  if (role === 'master') process.env.CB_NETWORK_ROOT_KEY = keys.generate('network').CB_NETWORK_ROOT_KEY; else delete process.env.CB_NETWORK_ROOT_KEY;
  if (role === 'member') { process.env.CB_MASTER_DOMAIN = 'root.example.com'; process.env.CB_MASTER_INSTALLATION = 'sit-root'; process.env.CB_MASTER_KEY = 'PEM'; }
  keys._reset();
  answers = (s) => (isRoleRead(s) ? [{ network_role: role }] : isList(s) ? ROWS : []);
}

/* every fetch that is not the test's own call to the local server is an outbound call */
const realFetch = global.fetch;
const outbound = [];
global.fetch = (url, opts) => { if (!String(url).startsWith('http://127.0.0.1')) outbound.push(String(url)); return realFetch(url, opts); };

(async () => {
  console.log('\n══ NETWORK CONTROL PANEL · slice 1 ══\n');
  const app = h.app('/api/network/installations', require(path.join(API, 'routes', 'netpanel')));
  const get = (identity) => h.run(app, { method: 'GET', url: '/api/network/installations', identity });
  const rootId = { identity_id: ROOT_ID };

  asRole('master');
  let r = await get(rootId);
  t('the master root is answered 200', r.status === 200, JSON.stringify(r.body));
  const b = r.body || {};
  t('counts: 4 installations, 1 master + 3 members', b.counts && b.counts.total === 4 && b.counts.by_role.master === 1 && b.counts.by_role.member === 3, JSON.stringify(b.counts));
  t('counts by status are words from the certificate', b.counts && b.counts.by_status.master === 1 && b.counts.by_status.active === 1 && b.counts.by_status.paused === 1 && b.counts.by_status.lapsed === 1, JSON.stringify(b.counts));
  t('the master is a row with role master', b.installations && b.installations[0].key === 'sit-root' && b.installations[0].role === 'master');
  const by = (k) => (b.installations || []).find((i) => i.key === k) || {};
  t('status comes from the certificate: suspended = Paused although installation.active is true', by('sit-au').status === 'paused' && by('sit-au').status_label === 'Paused' && ROWS[2].active === true);
  t('an expired certificate is Lapsed; an in-date one is Active', by('sit-ae').status === 'lapsed' && by('sit-in').status === 'active');
  t('members held and claimed sit side by side', by('sit-in').entities_held === 3 && by('sit-in').entities_claimed === 4);
  t('last pull and last seen are the recorded ones', by('sit-in').version === '1.9.0+abc1234' && !!by('sit-in').last_seen && by('sit-au').last_pull.error === 'no answer');
  t('listed null is "not recorded"; true and false are words', by('sit-ae').listed === null && by('sit-ae').listed_label === 'not recorded' && by('sit-in').listed_label === 'listed' && by('sit-au').listed_label === 'unlisted');
  const acts = by('sit-in').actions || {};
  t('suspend, reinstate and revoke are data, may:false, with the command as the reason',
    acts.suspend.may === false && acts.reinstate.may === false && acts.revoke.may === false && acts.suspend.why === 'node tools/network-cert.cjs suspend sit-in' && acts.revoke.why === 'node tools/network-cert.cjs revoke sit-in');
  t('the route made ZERO outbound calls', outbound.length === 0, outbound.join(' '));
  t('and read through the ONE reader (a single installations query)', sqls.filter((x) => isList(x.s)).length === 1);

  asRole('member');
  sqls.length = 0;
  r = await get(rootId);
  t('a member root is refused 403 in words naming the master', r.status === 403 && r.body.code === 'NETWORK_MASTER_ONLY' && /controlled by root\.example\.com/.test(r.body.detail), JSON.stringify(r.body));
  t('and nothing was listed for it', !sqls.some((x) => isList(x.s)));

  asRole('master');
  r = await get({ identity_id: '22222222-2222-4222-8222-222222222222' });
  t('a shop that is not the root is refused 403', r.status === 403 && r.body.code === 'NOT_PLATFORM_ROOT', JSON.stringify(r.body));

  /* contract, bad input, replay, a fault that must not leak */
  asRole('master');
  r = await get(rootId);
  const first = JSON.stringify(r.body);
  r = await get(rootId);
  t('contract: the answer is { counts: { total, by_role, by_status }, installations[] } and asking twice (replay) answers the same and writes nothing', JSON.stringify(r.body) === first && Object.keys(r.body).join() === 'counts,installations' && !sqls.some((x) => /^(INSERT|UPDATE|DELETE)/.test(x.s)));
  r = await h.run(app, { method: 'POST', url: '/api/network/installations', identity: rootId, body: { suspend: 'sit-au' } });
  t('bad input: a malformed POST (nothing acts in this slice) is refused 404 and changes nothing', r.status === 404 && !sqls.some((x) => /^(INSERT|UPDATE|DELETE)/.test(x.s)));
  answers = (s) => { if (isRoleRead(s)) return [{ network_role: 'master' }]; throw new Error('relation "registry_entry" does not exist'); };
  r = await get(rootId);
  t('error never leaks: a database fault answers 500 INTERNAL without the SQL or the message', r.status === 500 && r.body.code === 'INTERNAL' && !/registry_entry|relation/.test(JSON.stringify(r.body)), JSON.stringify(r.body));

  asRole('standalone');
  r = await get(rootId);
  t('a standalone root is refused 403: it controls no one', r.status === 403 && r.body.code === 'NETWORK_MASTER_ONLY' && /not a network master/.test(r.body.detail));

  t('status words: expiring under ten days, no certificate, cut off',
    panel.statusOf(row({ certificate_status: 'active', certificate_not_after: day(5) }), NOW) === 'expiring' && panel.statusOf(row({}), NOW) === 'uncertified' && panel.statusOf(row({ certificate_status: 'revoked' }), NOW) === 'cut_off');

  /* ── the master's pull records what it saw ── */
  const MEMBER = { installation_key: 'sit-in', domain: 'in.example.com', ctp_endpoint: 'https://in.example.com/api/ctp/deliver' };
  ctpquery.ask = async () => ({ ok: true, changes: [], entities: 0, last_seq: 0 });
  const realHealth = directory.healthFor;
  const written = () => sqls.filter((x) => /UPDATE installation SET/.test(x.s) && /last_seen|seen_error/.test(x.s));
  const pullAnswers = (s) => (isRoleRead(s) ? [{ network_role: 'master' }] : /network_role = 'member'/.test(s) ? [MEMBER] : /count\(\*\)/.test(s) ? [{ n: 0 }] : []);
  asRole('master');
  answers = pullAnswers;
  sqls.length = 0;
  directory.healthFor = async () => ({ ok: true, version: '1.9.0', commit: 'abcdef0123456789' });
  let pulled = await sync.pullMaster();
  let w = written();
  t('a good /health records version+commit and last_seen, clears the error', w.length === 1 && /version = \$2, last_seen = now\(\), seen_error = NULL/.test(w[0].s) && w[0].p[1] === '1.9.0+abcdef0' && pulled.members[0].seen === true);
  sqls.length = 0;
  directory.healthFor = async () => ({ ok: false, why: 'could not read https://in.example.com/health: AbortError' });
  pulled = await sync.pullMaster();
  w = written();
  t('a /health failure records only the reason: the old version and last_seen are kept', w.length === 1 && /SET seen_error = \$2/.test(w[0].s) && !/version|last_seen/.test(w[0].s) && /AbortError/.test(w[0].p[1]) && pulled.members[0].seen === false);
  t('and the pull itself still reports its own outcome', pulled.members[0].ok === true);
  sqls.length = 0;
  answers = (s) => { if (/UPDATE installation SET/.test(s)) throw new Error('column "seen_error" does not exist'); return pullAnswers(s); };
  let threw = false;
  try { await sync.pullMaster(); } catch (_) { threw = true; }
  t('a database that has not run b794 does not break the pull', threw === false);
  directory.healthFor = realHealth;

  /* ── the guarded /health read ── */
  const srv = await new Promise((ok) => {
    const s = http.createServer((q, a) => {
      if (q.url === '/health') { a.setHeader('content-type', 'application/json'); a.end(JSON.stringify({ status: 'OK', version: '2.0.1', commit: '0123456789abcdef' })); } else { a.statusCode = 404; a.end(); }
    }).listen(0, '127.0.0.1', () => ok(s));
  });
  let got = await directory.healthFor('127.0.0.1:' + srv.address().port);
  t('healthFor reads version and commit from /health', got.ok === true && got.version === '2.0.1' && got.commit === '0123456789abcdef', JSON.stringify(got));
  got = await directory.healthFor('127.0.0.1:1');
  t('healthFor answers a reason, never throws, when nobody is there', got.ok === false && /could not read/.test(got.why), JSON.stringify(got));
  srv.close();

  /* the operator's CLI shares the reader: it lists the same verbs, and an unknown verb exits 2 with the usage line (unit test of the tool) */
  const cli = require('child_process').spawnSync(process.execPath, [path.join(API, 'tools', 'network-cert.cjs'), 'nonsense'], { encoding: 'utf8', env: Object.assign({}, process.env, { DATABASE_URL: '' }) });
  t('network-cert: an unknown verb exits 2 and lists list among the verbs', cli.status === 2 && /usage: network-cert.cjs .*list/.test(cli.stderr), cli.status + " " + cli.stderr);

  global.fetch = realFetch;
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   CRASH ' + ((e && e.stack) || e)); process.exit(1); });
