/**
 * tests/ctp-crossing-pack.test.cjs — the OFFLINE self-test of the crossing pack (tests/crossing/): what can be proven without touching a SIT host.
 * Proves: the topology file parses and every scenario is bound to a real pair · the HARD HOST GUARD (staging. only, and only hosts the topology names; refuses before any request is made)
 *   · the tester-code expansion matches the api's own testerCodeOk, and the Secret never prints · the database guard (read-only, one statement) · the dry-run plan signs in nothing and opens no ssh
 *   · the single / multi / --only selection and prerequisites · the md5 / digest / minor-unit / poll helpers · the pass / fail / KNOWN / exit-code rules · no tester code in any file of the pack.
 * Offline: no network, no ssh, no database. fetch and child_process.spawn are replaced with tripwires that fail the test if anything reaches for them.
 * Run: node tests/ctp-crossing-pack.test.cjs
 * @type: unit
 */
'use strict';
const fs = require('fs');
const path = require('path');
const util = require('util');
const cp = require('child_process');

const API = path.join(__dirname, '..');
const PACK = path.join(API, 'tests', 'crossing');
const req = (p) => require(path.join(PACK, p));

let pass = 0;
let fail = 0;
const out = process.stdout.write.bind(process.stdout);
const t = (name, ok, extra) => {
  if (ok) {
    pass++;
    out('  ok   ' + name + '\n');
  } else {
    fail++;
    out('  FAIL ' + name + (extra ? '\n       ' + extra : '') + '\n');
  }
};
const throws = (fn) => {
  try {
    fn();
    return null;
  } catch (e) {
    return e;
  }
};

/* tripwires: any network call or process spawn during this file is a failure */
let reached = [];
global.fetch = async (url) => {
  reached.push('fetch ' + url);
  throw new Error('offline test reached the network: ' + url);
};
const realSpawn = cp.spawn;
cp.spawn = (...a) => {
  reached.push('spawn ' + a[0]);
  throw new Error('offline test spawned: ' + a[0]);
};

(async () => {
  out('\nCTP crossing pack · offline self-test\n');
  const topology = req('lib/topology.cjs');
  const topo = topology.load();
  const registry = req('scenarios/index.cjs');

  /* ── 1 · the topology ─────────────────────────────────────────────────────────────────────── */
  t('topology.json parses and validates', !!topo && Object.keys(topo.installations).length === 4);
  t('every installation host starts with staging.', topo.hosts.every((h) => h.startsWith('staging.')));
  t('the four SIT installations and six shops are described', ['root', 'sit-in', 'sit-au', 'sit-grund'].every((k) => topo.installations[k]) && Object.keys(topo.shops).length === 6);
  t('every scenario has a binding, every binding has a scenario', registry.all.every((s) => topo.bindings[s.id]) && Object.keys(topo.bindings).every((id) => registry.byId(id)));
  t('scenario ids are unique and use the walk\'s ids (R0-R30, G1-G4)', new Set(registry.all.map((s) => s.id)).size === registry.all.length && registry.all.every((s) => /^(R\d+|G[1-4])$/.test(s.id)));
  const walkIds = [];
  for (let n = 1; n <= 30; n++) walkIds.push('R' + n);
  ['G1', 'G2', 'G3', 'G4'].forEach((g) => walkIds.push(g));
  t('R1-R30 and G1-G4 are all present', walkIds.every((id) => registry.byId(id)), walkIds.filter((id) => !registry.byId(id)).join(','));
  t('every requires names an earlier scenario', registry.all.every((s, i) => (s.requires || []).every((r) => registry.all.findIndex((x) => x.id === r) < i)));
  const bad = JSON.parse(JSON.stringify(topo));
  delete bad.hosts;
  delete bad.base;
  bad.installations['sit-in'].host = 'api.example.com';
  t('validate() refuses a non-staging host', /staging\./.test(String((throws(() => topology.validate(bad)) || {}).message)));
  const bad2 = JSON.parse(JSON.stringify(topo));
  delete bad2.hosts;
  delete bad2.base;
  bad2.bindings.R1 = 'no_such_pair';
  t('validate() refuses a binding to a missing pair', /no_such_pair/.test(String((throws(() => topology.validate(bad2)) || {}).message)));

  /* ── 2 · the hard host guard ──────────────────────────────────────────────────────────────── */
  const known = topo.hosts;
  t('guard accepts a topology staging host', topology.assertSignInHost('https://' + known[1], known) === known[1]);
  const refusals = [
    ['a production-looking host', 'https://chitbridge-api-production.up.railway.app'],
    ['localhost', 'http://localhost:3000'],
    ['a staging. host the topology does not name', 'https://staging.evil.example'],
    ['plain http on a test host', 'http://' + known[1]],
    ['a user name that hides the real host', 'https://' + known[1] + '@evil.example'],
    ['a look-alike prefix', 'https://staging-' + known[1].slice(8)],
    ['an empty host', '']
  ];
  for (const [label, url] of refusals) t('guard refuses ' + label, !!throws(() => topology.assertSignInHost(url, known)), url);

  /* the sign-in refuses BEFORE any request: hand it a topology object that was never validated */
  const client = req('lib/client.cjs');
  const evilTopo = { installations: { x: { host: 'api.example.com' } }, hosts: ['api.example.com'], base: (k) => 'https://' + evilTopo.installations[k].host };
  const { Secret } = req('lib/secret.cjs');
  let refused = null;
  reached = [];
  try {
    await client.signIn(evilTopo, { key: 'a', user_id: 'u', installation: 'x' }, new Secret('abcdefgh-123456'));
  } catch (e) {
    refused = e;
  }
  t('signIn refuses a non-staging host and makes NO request', !!refused && /refusing to sign in/.test(refused.message) && reached.length === 0, refused && refused.message);

  /* ── 3 · the tester code: expansion mirrors the api; the Secret never prints ────────────────── */
  const secretLib = req('lib/secret.cjs');
  const at = Date.UTC(2026, 9, 25, 20, 0, 0); // 25 Oct 20:00 UTC = 26 Oct 01:30 IST = 26 Oct 07:00 Sydney
  t('{yymmdd} in Asia/Kolkata (the api default) is the Indian day', secretLib.expand('pack{yymmdd}x', 'Asia/Kolkata', at) === 'pack261026x');
  t('{yymmdd} in UTC is the previous day (so the default must not be UTC)', secretLib.expand('pack{yymmdd}x', 'UTC', at) === 'pack261025x');
  t('{yyyymmdd} in Australia/Sydney', secretLib.expand('p{yyyymmdd}', 'Australia/Sydney', at) === 'p20261026');
  t('a static code is returned as it is; two slots are refused', secretLib.expand('Static-Code-1', 'UTC', at) === 'Static-Code-1' && !!throws(() => secretLib.expand('{yymmdd}{yyyymmdd}', 'UTC', at)));
  t('the default zone is Asia/Kolkata, as the api\'s lib/dev-otp.js has it', secretLib.DEFAULT_ZONE === 'Asia/Kolkata');
  let apiAgrees = false;
  try {
    process.env.NODE_ENV = 'test';
    process.env.TESTER_CODE = 'pack-{yymmdd}-x';
    process.env.TESTER_NAMES = '*';
    delete process.env.TESTER_CODE_TZ;
    delete require.cache[require.resolve('../lib/dev-otp')];
    const dev = require('../lib/dev-otp');
    apiAgrees = dev.testerCodeOk(secretLib.expand(process.env.TESTER_CODE, secretLib.DEFAULT_ZONE), 'qa-sydneyspice') === true;
    process.env.TESTER_CODE_TZ = 'Australia/Sydney';
    apiAgrees = apiAgrees && dev.testerCodeOk(secretLib.expand(process.env.TESTER_CODE, 'Australia/Sydney'), 'qa-sydneyspice') === true;
  } catch (e) {
    out('       (api dev-otp not loadable here: ' + e.message + ')\n');
  } finally {
    delete process.env.TESTER_CODE;
    delete process.env.TESTER_NAMES;
    delete process.env.TESTER_CODE_TZ;
  }
  t('the api\'s own testerCodeOk accepts what this expands to (default zone and TESTER_CODE_TZ)', apiAgrees);
  const hidden = new Secret('S3cret-Code-777');
  t('a Secret prints, inspects and JSONs without the code', String(hidden) === '[tester code]' && util.inspect(hidden).indexOf('S3cret') < 0 && JSON.stringify({ s: hidden }).indexOf('S3cret') < 0 && JSON.stringify(Object.assign({}, hidden)).indexOf('S3cret') < 0);
  t('redact() wipes the code from an error text', hidden.redact('refused for u with S3cret-Code-777 twice S3cret-Code-777') === 'refused for u with [tester code] twice [tester code]');

  /* ── 4 · the database guard ──────────────────────────────────────────────────────────────── */
  const db = req('lib/db.cjs');
  t('SELECT and WITH pass', !throws(() => db.assertReadOnly('SELECT 1')) && !throws(() => db.assertReadOnly('with x as (select 1) select * from x;')));
  for (const sql of ['UPDATE chit_header SET subject = 1', 'DELETE FROM chit_header', 'INSERT INTO x VALUES (1)', 'DROP TABLE x', 'SELECT 1; DROP TABLE x', 'TRUNCATE x', 'select 1 where true; select 2', "COPY x TO '/tmp/y'"]) {
    t('db guard refuses: ' + sql.slice(0, 40), !!throws(() => db.assertReadOnly(sql)));
  }
  t('a write word inside a quoted literal is only text', !throws(() => db.assertReadOnly("SELECT * FROM chit_header WHERE subject = 'please update me'")));
  t('column names like updated_at / created_at are not write words', !throws(() => db.assertReadOnly('SELECT updated_at, created_at FROM entity_profile')));
  t('uuid() quotes a uuid and refuses anything else', db.uuid('5D111111-1111-4111-8111-111111111111') === "'5d111111-1111-4111-8111-111111111111'" && !!throws(() => db.uuid("x'; drop table y; --")));
  t('lit() doubles quotes', db.lit("O'Brien") === "'O''Brien'");
  t('wrap() asks for one JSON array', /^SELECT coalesce\(json_agg\(t\)/.test(db.wrap('SELECT 1 AS a')));

  /* ── 5 · ssh arguments ───────────────────────────────────────────────────────────────────── */
  const ssh = req('lib/ssh.cjs');
  const args = ssh.argsFor(topo, 'sit-au', 'echo hi');
  t('ssh uses the key, BatchMode and user@ip of the installation', args.includes('BatchMode=yes') && args.includes('ubuntu@129.225.90.80') && args.some((a) => /sit_oracle$/.test(a)) && args[args.length - 1] === 'echo hi');
  t('container names follow <project>-<service>-1', ssh.container(topo, 'sit-grund', 'db') === 'cbgrund-db-1' && ssh.container(topo, 'sit-in', 'api') === 'cbnet-api-1');
  const oddTopo = { installations: { z: { project: 'x; rm -rf /' } } };
  t('an odd project name is refused before it reaches a shell', !!throws(() => ssh.container(oddTopo, 'z', 'api')));

  /* ── 6 · the plan and the dry run ────────────────────────────────────────────────────────── */
  const planLib = req('lib/plan.cjs');
  const multi = planLib.buildPlan(topo, registry.all, { mode: 'multi', flags: {} });
  t('multi: everything runs except the opt-in outage (R8)', multi.filter((r) => r.state === 'skip').map((r) => r.id).join() === 'R8');
  t('--allow-outage lets R8 in', planLib.buildPlan(topo, registry.all, { mode: 'multi', flags: { allowOutage: true } }).every((r) => r.state !== 'skip'));
  const single = planLib.buildPlan(topo, registry.all, { mode: 'single', installation: 'sit-grund', flags: {} });
  t('single sit-grund runs exactly G1, G2, G3', single.filter((r) => r.state === 'run').map((r) => r.id).join() === 'G1,G2,G3');
  t('single: a two-installation scenario is skipped with the reason', /needs sit-in \+ sit-au/.test(single.find((r) => r.id === 'R16').reason || ''));
  const only = planLib.buildPlan(topo, registry.all, { mode: 'multi', only: ['R21'], flags: {} });
  t('--only R21 pulls its prerequisites (R0 is not one of them; R16 R17 R18 R20 are)', only.filter((r) => r.state === 'prereq').map((r) => r.id).join() === 'R16,R17,R18,R20' && only.find((r) => r.id === 'R21').state === 'run');
  t('--only R10,R11: R11 needs R10', planLib.buildPlan(topo, registry.all, { mode: 'multi', only: ['R11'], flags: {} }).find((r) => r.id === 'R10').state === 'prereq');
  t('an unknown id is an error in words', /unknown scenario R99/.test(String((throws(() => planLib.buildPlan(topo, registry.all, { mode: 'multi', only: ['R99'] })) || {}).message)));
  t('touched() lists installations once', planLib.touched(single).join() === 'sit-grund');

  const runner = req('run.cjs');
  reached = [];
  const lines = [];
  const realLog = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  let code;
  try {
    code = await runner.main(['--multi', '--dry-run']);
  } finally {
    console.log = realLog;
  }
  const text = lines.join('\n');
  t('--dry-run exits 0, prints the plan, reaches for nothing', code === 0 && /PLAN/.test(text) && /R16/.test(text) && /G4/.test(text) && reached.length === 0, reached.join(' | '));
  t('the dry-run text holds no tester-code-shaped value', !/TESTER_CODE\s*[=:]/.test(text));
  const argErr = (a) => String((throws(() => runner.parseArgs(a)) || {}).message);
  t('no mode -> usage', /--single <installation> or --multi/.test(argErr([])));
  t('--single without an installation -> usage', /needs an installation key/.test(argErr(['--single'])));
  t('an unknown flag -> usage', /unknown argument --wat/.test(argErr(['--multi', '--wat'])));
  t('--only is upper-cased and split', JSON.stringify(runner.parseArgs(['--multi', '--only', 'r16, g3']).only) === JSON.stringify(['R16', 'G3']));

  /* ── 7 · compare helpers ─────────────────────────────────────────────────────────────────── */
  const cmp = req('lib/compare.cjs');
  t('md5 and sha256 of "abc"', cmp.md5('abc') === '900150983cd24fb0d6963f7d28e17f72' && cmp.sha256('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  t('md5 of equal bytes is equal, of one changed byte is not', cmp.md5(Buffer.from('a')) === cmp.md5('a') && cmp.md5('a') !== cmp.md5('b'));
  t('sameDigest: equal -> true; one differs, one missing, or a lone value -> false', cmp.sameDigest('x1', 'x1', 'x1') && !cmp.sameDigest('x1', 'x2') && !cmp.sameDigest('x1', null) && !cmp.sameDigest('x1') && cmp.sameDigest(['a', 'a']));
  t('minor(): amounts as integers, no float drift', cmp.minor('11.50') === 1150 && cmp.minor(0.1 + 0.2) === 30 && cmp.minor(138) === 13800 && cmp.minor('') === null && cmp.minor('abc') === null && cmp.minor(8500, 0) === 8500);
  let n = 0;
  const quick = await cmp.waitFor(async () => ++n >= 3 && 'yes', { timeoutMs: 1000, everyMs: 5 });
  t('waitFor stops at the first yes', quick.ok && quick.value === 'yes' && n === 3);
  const slow = await cmp.waitFor(async () => false, { timeoutMs: 40, everyMs: 10 });
  t('waitFor gives up inside its budget', !slow.ok && slow.waitedMs < 200);

  /* ── 8 · the report rules ────────────────────────────────────────────────────────────────── */
  const ctxLib = req('lib/ctx.cjs');
  const report = req('lib/report.cjs');
  const planRow = { id: 'R9', title: 'x', pair: 'p', installations: ['a'], state: 'run' };
  const mk = (fn) => {
    const rec = ctxLib.recorder('R9');
    fn(rec);
    return rec;
  };
  t('all checks ok -> PASS', report.statusOf(mk((r) => r.check(true, 'a'))) === 'PASS');
  t('one failed check -> the scenario is red', report.statusOf(mk((r) => { r.check(true, 'a'); r.check(false, 'b', 'why'); })) === 'FAIL');
  t('no checks at all -> red (it proved nothing)', report.statusOf(mk(() => {})) === 'FAIL');
  t('an error -> red', report.statusOf(mk((r) => r.check(true, 'a')), new Error('boom')) === 'FAIL');
  t('checks ok + an open finding -> KNOWN, not red', report.statusOf(mk((r) => { r.check(true, 'a'); r.known('W19', false, 'x'); })) === 'KNOWN');
  const rows = [report.rowOf(planRow, mk((r) => r.check(true, 'a')), null, 5), report.skipRow(planRow, 'because'), report.rowOf(planRow, mk((r) => { r.check(true, 'a'); r.known('W19', false, 'x'); }), null, 1)];
  t('exit code is 0 with PASS, SKIP and KNOWN only', report.exitCode(rows) === 0);
  const withFail = rows.concat(report.rowOf(planRow, mk((r) => r.check(false, 'the money is wrong', 'got 1')), null, 1));
  t('exit code is 1 with a red scenario; the table names the failing check and the detail', report.exitCode(withFail) === 1 && /the money is wrong/.test(report.table(withFail)) && /got 1/.test(report.table(withFail)));
  t('summary counts', JSON.stringify(report.summary(withFail)) === JSON.stringify({ pass: 1, fail: 1, known: 1, skip: 1, total: 4 }));
  t('JSON rows are serialisable', !!JSON.stringify(withFail));
  const runId = ctxLib.newRunId(Date.UTC(2026, 9, 25, 13, 30, 5));
  t('a run id sorts by time and is unique', /^x261025133005[0-9a-f]{3}$/.test(runId) && runId !== ctxLib.newRunId(Date.UTC(2026, 9, 25, 13, 30, 5)));

  /* ── 8b · the case rows for the test library ─────────────────────────────────────────────────── */
  const caseRows = runner.caseRows(topo);
  t('--cases: one row per walk id (R1-R30, G1-G4 = 34), none for the R0 setup', caseRows.length === 34 && !caseRows.some((r) => r.id === 'CTPX-R0'));
  t('every case row names a scenario file that contains its id', caseRows.every((r) => fs.readFileSync(path.join(API, r.auto.file), 'utf8').includes(r.auto.test)));
  t('case rows carry the library\'s fields and levels (R = two installations, T2 = one)', caseRows.every((r) => r.id && r.screen && r.pass && r.owner && r.state === 'automated' && ['R', 'T2'].includes(r.level)) && caseRows.find((r) => r.id === 'CTPX-G3').level === 'T2' && caseRows.find((r) => r.id === 'CTPX-R16').level === 'R');
  t('the committed tests/crossing/case-rows.json is what --cases prints now', JSON.stringify(require(path.join(PACK, 'case-rows.json'))) === JSON.stringify(caseRows));

  /* ── 9 · nothing secret on disk, nothing alarming in the pack ──────────────────────────────── */
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
      else files.push(path.join(dir, e.name));
    }
  })(PACK);
  files.push(__filename);
  const corpus = files.map((f) => ({ f, s: fs.readFileSync(f, 'utf8') }));
  t('no file of the pack assigns a value to TESTER_CODE (this test\'s own api-parity fixture aside)', corpus.every(({ f, s }) => f === __filename || !/TESTER_CODE\s*[=:]\s*['"][^'"{ ]/.test(s)));
  t('no file names a host that is not a staging. test host', corpus.every(({ s }) => !/https?:\/\/(?!staging\.)[a-z0-9.-]+\.(app|io|com|net|org)\b/i.test(s.replace(/https:\/\/(chitbridge-api-production\.up\.railway\.app|api\.example\.com|evil\.example|claude\.com)/g, '').replace(/https?:\/\/(www\.)?[a-z.]*example\.(com|org)/g, ''))));
  t('no empty catch in the pack', corpus.every(({ f, s }) => f === __filename || !/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(s)));

  cp.spawn = realSpawn;
  out('\n' + pass + ' passed, ' + fail + ' failed\n');
  out(pass + ' checks\n');
  process.exitCode = fail ? 1 : 0;
})().catch((err) => {
  out('FATAL ' + (err && err.stack) + '\n');
  process.exit(1);
});
