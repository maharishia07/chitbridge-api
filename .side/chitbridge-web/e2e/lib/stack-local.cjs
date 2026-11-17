#!/usr/bin/env node
/**
 * e2e/lib/stack-local.cjs — THE REAL STACK ON THIS MACHINE, for a `--real` walk (round WX, 2026-10-13).
 *
 * The dev PC has C:/dev/toolset/local-stack.sh (Postgres in docker · the api on 3100 · the web on 8124). A cloud runner has no
 * toolset, so this is the same three doors as one node file: it starts the api (../chitbridge-api/server.js) against a LOCAL
 * Postgres and serves this checkout's public/ — both detached, pids in e2e/.stack/ — and exits. `stop` ends both.
 *
 *   node e2e/lib/stack-local.cjs up   [--db postgres://postgres:pw@127.0.0.1:5432/cb_local] [--api 3000] [--web 5173]
 *   node e2e/lib/stack-local.cjs stop
 *   node e2e/lib/stack-local.cjs serve --web 5173        (the web server only, in the foreground — what `up` spawns)
 *
 * The api defaults to 3000 because app.html's API_BASE picks http://localhost:3000 on localhost without any override, and the
 * web to 5173 because server.js's CORS allowlist already carries it. DEV_OTP 123456 (the loader's), a local JWT secret,
 * RLS_GUARD off — the same env tools/sim-load.cjs gives the in-process api. Never a sealed NODE_ENV, never a remote database
 * (the loader's localOnly rule is reused for --db).
 *
 * ⚠️ FX-QA1 (QA-W1, 14 Oct): THE SITE SERVED HERE TALKS ONLY TO THE LOCAL API. public/config.js names the production api (Vercel serves it as it is),
 * and a page that reads window.CB_API directly (tasks.html's CFG, the counter's cb_till_api) called production from localhost — 401s, nothing
 * written, by luck. So /config.js is REWRITTEN here (localConfig): the production address becomes this stack's api, and cb_api_base / cb_till_api
 * are pinned to it before any page script reads them. The production host is read FROM public/config.js (productionHost), never typed twice.
 * The harness (lib/walk.cjs, opts.base) refuses any request to that host during a local walk; e2e/stack-local.test.cjs proves both.
 */
'use strict';
const path = require('path'), fs = require('fs'), http = require('http');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const API = path.join(ROOT, '..', 'chitbridge-api');
const STATE = path.join(__dirname, '..', '.stack');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; };
const cmd = process.argv[2] || 'up';
const DB = arg('db', process.env.SIM_DB || 'postgres://postgres:pw@127.0.0.1:5432/cb_local');
const APIP = Number(arg('api', 3000)), WEBP = Number(arg('web', 5173));

/* the static server walk.cjs runs for the fixture walks, on a FIXED port: / is the repo-root index.html, everything else public/ */
const CONFIG = path.join(ROOT, 'public', 'config.js');
/** the api address public/config.js ships (the production api) — read from the file, so this harness never names the host itself */
function productionApi() { const m = /window\.CB_API\s*=\s*window\.CB_API\s*\|\|\s*['"]([^'"]+)['"]/.exec(fs.readFileSync(CONFIG, 'utf8')); return m ? m[1] : null; }
function productionHost() { const a = productionApi(); try { return a ? new URL(a).host : null; } catch (_) { return null; } }
/** /config.js for a local stack: the production address rewritten to `apiBase`, and the two overrides pages read before CB_API pinned to it */
function localConfig(apiBase) {
  const prod = productionApi(), src = fs.readFileSync(CONFIG, 'utf8');
  const body = prod ? src.split(prod).join(apiBase) : src + '\nwindow.CB_API = ' + JSON.stringify(apiBase) + ';\n';
  return body.replace(/window\.CB_API\s*=\s*window\.CB_API\s*\|\|/, 'window.CB_API =')   /* a stale value set before this file cannot win either */
    + '\n/* stack-local (FX-QA1): this site is the LOCAL stack — every api base points at ' + apiBase + ' */\n'
    + 'try { localStorage.setItem(\'cb_api_base\', ' + JSON.stringify(apiBase) + '); localStorage.setItem(\'cb_till_api\', ' + JSON.stringify(apiBase) + '); } catch (_) {}\n';
}

function serveWeb(port, apiPort) {
  const PUB = path.join(ROOT, 'public');
  const LOCAL_API = 'http://localhost:' + (apiPort || APIP);
  const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '');
    const f = (!rel || rel === 'index.html') ? path.join(ROOT, 'index.html') : path.join(PUB, rel);
    if ((!f.startsWith(PUB) && f !== path.join(ROOT, 'index.html')) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    if (f === CONFIG) return r.end(localConfig(LOCAL_API));   /* never the production address on a local stack */
    fs.createReadStream(f).pipe(r);
  });
  return new Promise((res) => srv.listen(port, '127.0.0.1', () => { console.log('web on http://localhost:' + srv.address().port + ' · api ' + LOCAL_API); res(srv); }));
}

function waitHealth(url, tries, done) {
  http.get(url, (r) => { if (r.statusCode === 200) return done(true); r.resume(); retry(); }).on('error', retry);
  function retry() { if (tries <= 0) return done(false); setTimeout(() => waitHealth(url, tries - 1, done), 500); }
}

module.exports = { serveWeb, localConfig, productionApi, productionHost };
if (require.main !== module) { /* required by a test or the harness: no command */ }
else if (cmd === 'serve') { serveWeb(WEBP, APIP); }
else if (cmd === 'stop') {
  for (const f of ['api.pid', 'web.pid']) {
    const p = path.join(STATE, f);
    if (!fs.existsSync(p)) continue;
    const pid = Number(fs.readFileSync(p, 'utf8'));
    try { process.kill(pid, 'SIGTERM'); console.log('stopped ' + f + ' ' + pid); } catch (e) { console.log(f + ': ' + e.message); }
    fs.unlinkSync(p);
  }
} else if (cmd === 'up') {
  const localOnly = require(path.join(API, 'tools', 'sim-load.cjs')).localOnly;
  const loc = localOnly(DB);
  if (!loc.ok) { console.error('REFUSED: ' + loc.why); process.exit(3); }
  if (/^(production|uat|staging|live)$/i.test(String(process.env.NODE_ENV || ''))) { console.error('REFUSED: NODE_ENV is sealed'); process.exit(3); }
  fs.mkdirSync(STATE, { recursive: true });
  const env = Object.assign({}, process.env, {
    DATABASE_URL: DB, NODE_ENV: 'development', JWT_SECRET: process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32 ? process.env.JWT_SECRET : 'stack-local-only-secret-' + 'x'.repeat(24),
    DEV_OTP: process.env.DEV_OTP || '123456', SHOP_CLOCK_ALLOW: '1', HOST: '127.0.0.1', RLS_GUARD: process.env.RLS_GUARD || 'off', LOG_LEVEL: process.env.LOG_LEVEL || 'warn',
    RATE_LIMIT_MAX: '10000000', AUTH_RATE_LIMIT_MAX: '10000000', PORT: String(APIP),   /* one caller, many walks: the 15-minute windows would refuse the fifth run */
    ALLOWED_ORIGINS: 'http://localhost:' + WEBP + ',http://127.0.0.1:' + WEBP + ',http://localhost:' + APIP,
  });
  const out = fs.openSync(path.join(STATE, 'api.log'), 'a');
  const api = spawn(process.execPath, ['server.js'], { cwd: API, env, detached: true, stdio: ['ignore', out, out] });
  api.unref(); fs.writeFileSync(path.join(STATE, 'api.pid'), String(api.pid));
  const wout = fs.openSync(path.join(STATE, 'web.log'), 'a');
  const web = spawn(process.execPath, [__filename, 'serve', '--web', String(WEBP), '--api', String(APIP)], { cwd: ROOT, detached: true, stdio: ['ignore', wout, wout] });
  web.unref(); fs.writeFileSync(path.join(STATE, 'web.pid'), String(web.pid));
  waitHealth('http://127.0.0.1:' + APIP + '/health', 60, (ok) => {
    console.log((ok ? 'api up' : 'api NOT up (see e2e/.stack/api.log)') + ' on http://localhost:' + APIP + ' · web on http://localhost:' + WEBP + ' · pids ' + api.pid + ' / ' + web.pid);
    process.exit(ok ? 0 : 1);
  });
} else { console.error('up | stop | serve'); process.exit(2); }
