/**
 * hosting-neutral.test.cjs — HX1: NOTHING IN THE SHIPPED CODE IS BOUND TO ONE PLATFORM BY ACCIDENT (docs/HOSTING-COUPLING.md).
 *   1 the database: the attempts come from config only — DATABASE_URL, then DB_POOLER_URL — and the password goes NOWHERE else. Proved
 *     at the socket: every TCP connect the db module makes is recorded in a child process.
 *   2 TLS comes from the URL's sslmode / PGSSLMODE / the env — never from the host name.
 *   3 the object store signs with AWS SigV4: AWS's two published example signatures, byte for byte; the transport is picked by config.
 *   4 the migration ledger: the chain includes b304 (the ledger itself) and --record-through takes the baseline with it.
 *   5 no *.railway.app / *.vercel.app literal in the api's runtime, the counter kit or the workflows, beyond the named exceptions.
 *   6 SEC0: no Supabase PROJECT REF in any tracked file — the rule is READ from .gitleaks.toml (id cb-supabase-project-ref), so gitleaks in
 *     CI and this offline guard run the one regex; proved on the four shapes it was found in (built at run time, never written here).
 * Offline: no database, no network (the sockets in 1 go to closed loopback ports).
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const API = path.join(__dirname, '..');

let pass = 0, fail = 0;
function it(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  XX  ' + name + ' — ' + e.message); }
}

/* ── 1 · where the password goes ── */
const { connectPlan, sslFor } = require('../db/connect-config');
it('one attempt when only DATABASE_URL is set — no pooler is invented', () => {
  const p = connectPlan({ DATABASE_URL: 'postgres://app:S3CRET@db.internal:5432/cb?sslmode=disable' });
  assert.strictEqual(p.length, 1);
  assert.strictEqual(p[0].label, 'DATABASE_URL');
});
it('DB_POOLER_URL is the second attempt and carries ONLY its own credentials', () => {
  const p = connectPlan({ DATABASE_URL: 'postgres://app:S3CRET@db.internal/cb', DB_POOLER_URL: 'postgres://pool:OTHER@pooler.internal:6543/cb' });
  assert.deepStrictEqual(p.map((a) => a.label), ['DATABASE_URL', 'DB_POOLER_URL']);
  assert.ok(!JSON.stringify(p[1]).includes('S3CRET'), 'the pooler attempt carries DATABASE_URL\'s password');
  assert.ok(!p.some((a) => /supabase/i.test(JSON.stringify(a))));
});
it('a missing or malformed DATABASE_URL is refused (a pooler alone is not a configuration)', () => {
  assert.throws(() => connectPlan({}), /Invalid DATABASE_URL/);
  assert.throws(() => connectPlan({ DATABASE_URL: 'not a url' }), /Invalid DATABASE_URL/);
  assert.throws(() => connectPlan({ DB_POOLER_URL: 'postgres://a:b@c/d' }), /Invalid DATABASE_URL/);
});
it('db/index.js names no pooler host, no project ref and no region list', () => {
  const src = fs.readFileSync(path.join(API, 'db', 'index.js'), 'utf8');
  assert.ok(!/pooler\.supabase|supabase\.com|POOLER_REGIONS|sslForHost/.test(src));   // the project ref itself: §6, repo-wide
});
/* the real thing: a child loads db/index.js with every socket connect recorded, and a query fails against closed ports */
function socketsOf(env) {
  const child = `
    const net = require('net'), seen = [];
    const orig = net.Socket.prototype.connect;
    net.Socket.prototype.connect = function (...a) { const o = typeof a[0] === 'object' ? a[0] : { port: a[0], host: a[1] }; seen.push((o.host || 'localhost') + ':' + o.port); return orig.apply(this, a); };
    const db = require(${JSON.stringify(path.join(API, 'db', 'index.js'))});
    db.query('SELECT 1').then(() => 0, () => 0).then(() => { console.log(JSON.stringify(seen)); process.exit(0); });`;
  const r = spawnSync(process.execPath, ['-e', child], { env: Object.assign({ PATH: process.env.PATH, DB_BOOT_WAIT_MS: '4000', NODE_ENV: 'production' }, env), encoding: 'utf8', timeout: 30000 });
  const line = (r.stdout || '').trim().split('\n').pop();
  try { return [...new Set(JSON.parse(line))]; } catch (_) { throw new Error('child gave no answer: ' + (r.stderr || '').slice(-300)); }
}
it('⭐ a failed connect goes to the configured host ONLY — the password is sent nowhere else (sockets recorded)', () => {
  const seen = socketsOf({ DATABASE_URL: 'postgres://app:S3CRET@127.0.0.1:9/cb' });
  assert.deepStrictEqual(seen, ['127.0.0.1:9']);
});
it('⭐ with DB_POOLER_URL set, exactly the two configured hosts are tried, in order', () => {
  const seen = socketsOf({ DATABASE_URL: 'postgres://app:S3CRET@127.0.0.1:9/cb', DB_POOLER_URL: 'postgres://pool:OTHER@127.0.0.1:7/cb' });
  assert.deepStrictEqual(seen, ['127.0.0.1:9', '127.0.0.1:7']);
});

/* ── 2 · TLS from config ── */
it('the URL\'s sslmode decides (pg parses it) — no ssl option is added over it', () => {
  assert.strictEqual(sslFor('postgres://a:b@db.example.com/x?sslmode=disable', { NODE_ENV: 'production' }), undefined);
  assert.strictEqual(sslFor('postgres://a:b@localhost/x?sslmode=no-verify', {}), undefined);
});
it('no sslmode: PGSSLMODE, else a sealed env keeps TLS-unverified for EVERY host, else no TLS — the host is never read', () => {
  assert.strictEqual(sslFor('postgres://a:b@db.example.com/x', { PGSSLMODE: 'disable', NODE_ENV: 'production' }), false);
  assert.deepStrictEqual(sslFor('postgres://a:b@localhost/x', { NODE_ENV: 'production' }), { rejectUnauthorized: false });
  assert.deepStrictEqual(sslFor('postgres://a:b@db.example.com/x', { NODE_ENV: 'production' }), { rejectUnauthorized: false });
  assert.strictEqual(sslFor('postgres://a:b@db.example.com/x', { NODE_ENV: 'development' }), false);
  assert.strictEqual(sslFor('postgres://a:b@db.example.com/x', { NODE_ENV: 'production', PGSSL: 'disable' }), false);
  assert.deepStrictEqual(sslFor('postgres://a:b@h/x', { PGSSLMODE: 'verify-full' }), {});
  assert.throws(() => sslFor('postgres://a:b@h/x', { PGSSLMODE: 'sometimes' }), /PGSSLMODE/);
});

/* ── 3 · SigV4 ── */
const store = require('../lib/storage-object');
const EX = { id: 'AKIAIOSFODNN7EXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', service: 's3' };
const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
it('⭐ SigV4 GET Object — AWS\'s published example signature, byte for byte', () => {
  const a = store.sigv4(Object.assign({ method: 'GET', path: '/test.txt', payloadHash: EMPTY,
    headers: { host: 'examplebucket.s3.amazonaws.com', range: 'bytes=0-9', 'x-amz-content-sha256': EMPTY, 'x-amz-date': '20130524T000000Z' } }, EX));
  assert.strictEqual(a, 'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
});
it('⭐ SigV4 PUT Object (a $ in the key, a body) — AWS\'s published example signature', () => {
  const ph = require('crypto').createHash('sha256').update('Welcome to Amazon S3.').digest('hex');
  const a = store.sigv4(Object.assign({ method: 'PUT', path: '/test%24file.text', payloadHash: ph,
    headers: { Date: 'Fri, 24 May 2013 00:00:00 GMT', host: 'examplebucket.s3.amazonaws.com', 'x-amz-date': '20130524T000000Z', 'x-amz-storage-class': 'REDUCED_REDUNDANCY', 'x-amz-content-sha256': ph } }, EX));
  assert.ok(a.endsWith('Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd'), a);
});
function transportWith(env) {
  const r = spawnSync(process.execPath, ['-e', `console.log(require(${JSON.stringify(path.join(API, 'lib', 'storage-object.js'))}).transport())`],
    { env: Object.assign({ PATH: process.env.PATH }, env), encoding: 'utf8' });
  return r.stdout.trim();
}
it('the transport is config: an access key pair → SigV4 · S3_KEY alone → Supabase REST (unchanged) · nothing → the database', () => {
  assert.strictEqual(transportWith({ S3_ENDPOINT: 'http://minio:9000', S3_ACCESS_KEY_ID: 'a', S3_SECRET_ACCESS_KEY: 'b' }), 'sigv4');
  assert.strictEqual(transportWith({ S3_ENDPOINT: 'https://ref.supabase.co', S3_KEY: 'k' }), 'supabase');
  assert.strictEqual(transportWith({}), 'null');
});

/* ── 4 · the ledger ── */
const mig = require('../tools/migrate.cjs');
it('the chain carries the ledger (b304) and --record-through takes the baseline with it', () => {
  assert.ok(mig.chainFiles().includes(mig.LEDGER_FILE));
  const t = mig.through('b304');
  assert.ok(t.includes('000_baseline.sql') && t.includes('000_baseline_part2.sql') && t.includes(mig.LEDGER_FILE));
  assert.ok(!t.some((f) => /^b(30[5-9]|3[1-9]\d)_/.test(f)), 'a file after b304 was taken');
  assert.throws(() => mig.through('latest'), /migration number/);
});
it('the chain keeps every schema file a rebuild needs: letter suffixes and a name holding "_list" (BCP-MIG, 17 Oct)', () => {
  const chain = mig.chainFiles();
  for (const f of ['b105a_floor_trigger_definer.sql', 'b171d_customer_who_and_when.sql', 'b263b_clear_the_duplicate_bills.sql', 'b270_supplier_list_rls.sql'])
    assert.ok(chain.includes(f), f + ' is not in the chain');
  assert.ok(chain.indexOf('b105_retention_prep.sql') < chain.indexOf('b105a_floor_trigger_definer.sql'), 'b105a runs before b105');
  assert.ok(!chain.some((f) => /dryrun|verify|purge/i.test(f)), 'a dry run, verify or purge file is in the chain');
});

/* ── 5 · no platform host in shipped code ── */
it('⭐ no *.railway.app / *.vercel.app literal in the runtime, the kit or the workflows (beyond the named exceptions)', () => {
  const ALLOWED = {
    'server.js': 1,                            // 🟡 the CORS default (ALLOWED_ORIGINS overrides it) — docs/HOSTING.md
    'tools/tally-connector/till.html': 1,      // cbHome's fallback for a kit whose till.js predates HX1 (no /config.js) — named debt
    '.github/workflows/uptime.yml': 3,         // ⚠️ the fix is docs/patches/HX1-workflows-api-url.patch: this token may not push workflows
    '.github/workflows/governance.yml': 1,     //    — the owner applies it and sets the repository variable API_URL; then these go to 0
  };
  const HOST = /[a-z0-9-]+\.(?:up\.)?railway\.app|[a-z0-9-]+\.vercel\.app/gi;
  const walk = (d) => !fs.existsSync(d) ? [] : fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory()
    ? (e.name === 'node_modules' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);
  const files = ['server.js'].map((f) => path.join(API, f))
    .concat(...['lib', 'routes', 'middleware', 'db', 'src', 'tools/tally-connector', '.github/workflows', 'deploy'].map((d) => walk(path.join(API, d))))
    .filter((f) => /\.(js|cjs|mjs|json|html|cmd|ps1|vbs|sh|yml|yaml)$/.test(f));
  const bad = [];
  for (const f of files) {
    const rel = path.relative(API, f).split(path.sep).join('/');
    const n = (fs.readFileSync(f, 'utf8').match(HOST) || []).length;
    if (n > (ALLOWED[rel] || 0)) bad.push(rel + ' ×' + n);
  }
  assert.deepStrictEqual(bad, [], 'name the api through config (PUBLIC_API_BASE / PUBLIC_WEB_BASE / connector.json / vars.API_URL): ' + bad.join('; '));
});

/* ── 6 · SEC0: the Supabase project ref is env, never a literal ── */
/** the ONE pattern: gitleaks' own rule in .gitleaks.toml, so CI and this guard cannot drift */
function projectRefRule() {
  const toml = fs.readFileSync(path.join(API, '.gitleaks.toml'), 'utf8');
  const m = /\[\[rules\]\]\s*\nid = "cb-supabase-project-ref"[\s\S]*?\nregex = '''([^\n]+)'''/.exec(toml);
  assert.ok(m, '.gitleaks.toml has no rule cb-supabase-project-ref');
  return new RegExp(m[1], 'g');
}
it('⭐ .gitleaks.toml carries rule cb-supabase-project-ref and it catches every shape the ref was found in (SEC0)', () => {
  const R = projectRefRule();
  const REF = 'bcdfg'.repeat(4);                      // 20 lowercase letters, built here — never a literal ref in this file
  const hits = (s) => (s.match(R) || []).length;
  assert.ok(hits('DATABASE_URL=postgres://postgres:pw@db.' + REF + '.supabase.co:5432/postgres') >= 1, 'a *.supabase.co host');
  assert.ok(hits('editor: https://supabase.com/dashboard/project/' + REF + '/sql') >= 1, 'the dashboard URL');
  assert.ok(hits('--   user  cb_app.' + REF + '   (pooler format)') >= 1, 'the pooler user <role>.<ref>');
  assert.ok(hits('- DB: Supabase `' + REF + '` · API: Railway') >= 1, 'after the word Supabase');
  assert.ok(hits('`:93` ref `' + REF + '`, `:96`') >= 1, 'after the word ref');
  assert.ok(hits('(project ' + REF + '). ONE result set') >= 1, 'after the word project');
  /* the placeholders the docs and fixtures use must stay clean */
  ['postgres://postgres:pw@db.example-host.supabase.co:5432/postgres', 'https://<ref>.supabase.co/storage/v1/s3', 'user `postgres.<project-ref>`',
   'S3_ENDPOINT: https://ref.supabase.co', 'https://supabase.com/dashboard/project/<project-ref>/sql',
   'the word ' + 'international' + 'ization' + ' alone']   // a 20-letter word with no context word — joined here so THIS line never trips the rule
    .forEach((s) => assert.strictEqual(hits(s), 0, 'a placeholder trips the rule: ' + s));
});
it('⭐ no tracked file carries a Supabase project ref (SEC0 — it is the host in DATABASE_URL / S3_ENDPOINT, env only)', () => {
  const R = projectRefRule();
  const files = spawnSync('git', ['-C', API, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 << 20 }).stdout.split('\0').filter(Boolean);
  assert.ok(files.length > 100, 'git ls-files gave ' + files.length + ' files');
  const bad = [];
  for (const f of files) {
    let s; try { s = fs.readFileSync(path.join(API, f), 'utf8'); } catch (_) { continue; }   // a path git tracks but the checkout lacks
    if (s.indexOf('\0') >= 0) continue;                                                      // binary
    const m = s.match(R);
    if (m) bad.push(f + ' (' + m[0].slice(0, 40) + ')');
  }
  assert.deepStrictEqual(bad, [], 'write <ref> / <project-ref>, or db.example-host.supabase.co in a fixture: ' + bad.join('; '));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);
