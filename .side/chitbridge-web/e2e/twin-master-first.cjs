#!/usr/bin/env node
'use strict';
/**
 * e2e/twin-master-first.cjs — A VENDORED COPY MAY ONLY CHANGE AFTER ITS API MASTER HAS (PLT-92, 2026-11-09).
 *
 * OWNS      the pre-landing check for twin breaks: a web PR that changes a copy vendored from the api (public/till.html, promo.html,
 *           app/their-bill.js ...) fails unless the api master on api main already holds the same bytes. Web #510 changed
 *           public/promo.html alone and every api PR went red (till-vendor, pages-parse) until the api master followed.
 * CALLED BY .github/workflows/ci.yml job `twin-master-first` (pull requests only); `--self-test` is run by the same job.
 * FLOW      api scripts/vendor-till.cjs COPIES() (loaded, never copied) ──▶ [master in api, copy in web] pairs
 *           ──▶ keep the pairs whose copy this PR changed ──▶ copy bytes (CRLF-blind) == master bytes? else exit 1 naming the master.
 * CARD      qa/readability-guard
 *
 *   node e2e/twin-master-first.cjs --api DIR --base SHA|REF [--web DIR]     DIR = a checkout of chitbridge-api main
 *   node e2e/twin-master-first.cjs --api DIR --files-file list.txt          changed files, one repo-relative path a line
 *   node e2e/twin-master-first.cjs --self-test
 *
 * The copy → master list is the api's own (vendor-till.cjs, the file the api's guards use), so there is no second list to drift. That
 * file runs its work at load, so this loads only the part above its `--check` branch. Pairs whose master is web (app/signin-ui.js flows
 * web → kit) are skipped: web is their master. Generated files (till-sw.js, manifest, engine/versions.json) have no master bytes.
 */
const fs = require('fs'), path = require('path'), os = require('os'), Module = require('module');
const { spawnSync } = require('child_process');

const CUT = "if (process.argv.includes('--check'))";
const norm = (text) => text.replace(/\r\n/g, '\n');
const rel = (from, file) => path.relative(from, file).split(path.sep).join('/');

/** the api's [master, copy] pairs, read from its vendor-till.cjs with the web checkout named as the copy side */
function pairsOf(apiDir, webDir) {
  const file = path.join(apiDir, 'scripts', 'vendor-till.cjs');
  const source = fs.readFileSync(file, 'utf8');
  const cut = source.indexOf(CUT);
  if (cut < 0) throw new Error('scripts/vendor-till.cjs no longer has the "' + CUT + '" line this check loads up to; update e2e/twin-master-first.cjs');
  const mod = new Module(file, null);
  mod.filename = file;
  mod.paths = Module._nodeModulePaths(path.dirname(file));
  const before = process.env.CB_WEB_DIR;
  process.env.CB_WEB_DIR = webDir;
  try { mod._compile(source.slice(0, cut) + '\nmodule.exports = { COPIES };', file); } finally {
    if (before === undefined) delete process.env.CB_WEB_DIR; else process.env.CB_WEB_DIR = before;
  }
  const webPublic = path.resolve(webDir, 'public');
  return mod.exports.COPIES()
    .filter(([from, to, body]) => from && body === 'copy' && path.resolve(from).startsWith(path.resolve(apiDir) + path.sep) && path.resolve(to).startsWith(webPublic + path.sep))
    .map(([from, to]) => ({ master: rel(apiDir, from), copy: rel(webDir, to), masterFile: from, copyFile: to }));
}

/** the failures: one line per changed copy whose bytes differ from the api master on api main */
function check(apiDir, webDir, changed) {
  const touched = new Set(changed.map((f) => f.replace(/\\/g, '/')));
  const out = [];
  for (const p of pairsOf(apiDir, webDir)) {
    if (!touched.has(p.copy)) continue;
    const master = fs.existsSync(p.masterFile) ? norm(fs.readFileSync(p.masterFile, 'utf8')) : null;
    const copy = fs.existsSync(p.copyFile) ? norm(fs.readFileSync(p.copyFile, 'utf8')) : null;
    if (master === null) out.push(p.copy + ' is vendored from api ' + p.master + ', which api main does not have: change the api master ' + p.master + ' first (or in a twin PR), then this copy');
    else if (master !== copy) out.push(p.copy + ' differs from its api master on api main: change the api master ' + p.master + ' first (or in a twin PR), then this copy');
  }
  return out;
}

function selfTest() {
  let fail = 0;
  const ok = (c, m) => { if (!c) fail++; console.log((c ? '  ok  ' : '  XX  ') + m); };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'twin-master-'));
  const put = (f, text) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  const api = path.join(tmp, 'api'), web = path.join(tmp, 'web');
  put(path.join(api, 'scripts', 'vendor-till.cjs'), [
    "const path = require('path'); const API = path.join(__dirname, '..');",
    "const WEB = path.resolve(process.env.CB_WEB_DIR, 'public');",
    'const COPIES = () => [',
    "  [path.join(API, 'tools', 'tally-connector', 'promo.html'), path.join(WEB, 'promo.html'), 'copy'],",
    "  [path.join(WEB, 'app', 'signin-ui.js'), path.join(API, 'tools', 'tally-connector', 'signin-ui.js'), 'copy'],",
    "  [null, path.join(WEB, 'till-sw.js'), 'generated']];",
    CUT + ' { process.exit(1); }'
  ].join('\n'));
  put(path.join(api, 'tools', 'tally-connector', 'promo.html'), '<p>master</p>\r\n');
  put(path.join(web, 'public', 'promo.html'), '<p>master</p>\n');
  put(path.join(web, 'public', 'app', 'signin-ui.js'), 'web master\n');
  put(path.join(web, 'public', 'till-sw.js'), 'sw\n');
  ok(check(api, web, ['public/promo.html']).length === 0, 'a changed copy equal to the api master (CRLF-blind) passes');
  put(path.join(web, 'public', 'promo.html'), '<p>changed in web only</p>\n');
  const bad = check(api, web, ['public/promo.html']);
  ok(bad.length === 1 && bad[0].includes('public/promo.html') && bad[0].includes('change the api master tools/tally-connector/promo.html first (or in a twin PR), then this copy'),
    'a changed promo.html the api master lacks fails, naming the file and the master: ' + (bad[0] || 'no failure'));
  ok(check(api, web, ['README.md']).length === 0, 'a copy this change did not touch is not judged, though it differs');
  ok(check(api, web, ['public/app/signin-ui.js', 'public/till-sw.js']).length === 0, 'web-mastered and generated files are not checked');
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fail ? 'twin-master-first self-test FAILED' : 'twin-master-first self-test passed');
  process.exit(fail ? 1 : 0);
}

function main(argv) {
  const arg = (name) => { const i = argv.indexOf(name); return i < 0 ? null : argv[i + 1]; };
  if (argv.includes('--self-test')) return selfTest();
  const web = path.resolve(arg('--web') || path.join(__dirname, '..'));
  const api = arg('--api');
  if (!api || !fs.existsSync(path.join(api, 'scripts', 'vendor-till.cjs'))) {
    console.log('  XX  --api must name a checkout of chitbridge-api main (scripts/vendor-till.cjs not found); a check that skips quietly is how twin breaks came back');
    process.exit(1);
  }
  let changed;
  if (arg('--files-file')) changed = fs.readFileSync(arg('--files-file'), 'utf8').split(/\r?\n/).filter(Boolean);
  else {
    const git = spawnSync('git', ['diff', '--name-only', arg('--base') + '...HEAD'], { cwd: web, encoding: 'utf8' });
    if (git.status !== 0) { console.log('  XX  git diff against the base failed: ' + git.stderr); process.exit(1); }
    changed = git.stdout.split(/\r?\n/).filter(Boolean);
  }
  const failures = check(path.resolve(api), web, changed);
  failures.forEach((f) => console.log('  XX  ' + f));
  console.log(failures.length ? failures.length + ' vendored copy changed ahead of its api master' : 'no vendored copy changed ahead of its api master (' + changed.length + ' changed files read)');
  process.exit(failures.length ? 1 : 0);
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { check, pairsOf };
