'use strict';
/**
 * engine-versions.test.cjs — ⭐⭐ A COUNTER SAYS WHICH ENGINE RELEASES IT BILLS WITH (2026-09-28, the loader step)
 *
 * SPEC-one-engine.md: *"a PC knows — and reports — exactly which rules it bills with."* Before this, the shop-PC
 * program reported only whether each engine FILE existed, and a browser counter reported nothing. Now:
 *   · till.js reads the "ADOPTED from chitbridge-engines vX.Y.Z" line off the file it SERVES (/api/state.engines),
 *     and sends eng=name:ver,… with its own snapshot call;
 *   · a browser counter reads engine/versions.json, which vendor-till writes from the web engines' own lines,
 *     and sends the same with its claim;
 *   · the server keeps them on that counter's key (keys.claimTill → policy_flags.api_keys[].till.engines);
 *   · the "what is this counter" panel shows them.
 * These read the source, and say so: the live halves are proved by e2e/till-shop-switch-pc.cjs (the real program).
 *
 * Run: node tests/engine-versions.test.cjs   · no DB, no network.
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
const WEB = path.join(API, '..', 'chitbridge-web', 'public');
const PROG = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.js'), 'utf8').replace(/\r\n/g, '\n');
const PAGE = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8').replace(/\r\n/g, '\n');
const KEYS = fs.readFileSync(path.join(API, 'routes', 'keys.js'), 'utf8').replace(/\r\n/g, '\n');
const TILL = fs.readFileSync(path.join(API, 'routes', 'till.js'), 'utf8').replace(/\r\n/g, '\n');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };
/* a top-level function's text: to its closing `}` — or `});` for a router.x = async (…) => withTransaction(…) */
const body = (src, sig) => {
  const a = src.indexOf(sig); assert.ok(a >= 0, sig + ' is gone');
  const ends = ['\n}\n', '\n});\n'].map((e) => src.indexOf(e, a)).filter((i) => i > a);
  assert.ok(ends.length, sig + ' has no end this test can find');
  return src.slice(a, Math.min.apply(null, ends) + 4);
};

console.log('\nENGINE VERSIONS — reported, carried, kept\n');

it('the program reads each version off the file it SERVES — the shop copy, else the kit\'s — not off a list', () => {
  const b = body(PROG, 'function engineVersion(n)');
  assert.ok(/fs\.existsSync\(F\.engine\(n\)\) \? F\.engine\(n\) : \(fs\.existsSync\(kit\) \? kit : null\)/.test(b), 'it reads some other file than the one served');
  assert.ok(/ADOPTED from chitbridge-engines v\(\\d\+\\\.\\d\+\\\.\\d\+\)/.test(b), 'it no longer reads the release line');
});

it('/api/state.engines is { name: version | false } — still truthy wherever a file exists', () => {
  assert.ok(/engines: engineVersions\(\),/.test(PROG), '/api/state reports something other than the versions');
  assert.ok(!/engines: Object\.fromEntries\(ENGINE_NAMES\.map\(\(n\) => \[n, fs\.existsSync/.test(PROG), 'the old yes/no report is back');
});

it('the program sends the versions with its own snapshot call', () => {
  const r = PROG.slice(PROG.indexOf('async function refresh()'));
  assert.ok(/const eng = engineQuery\(\);/.test(r) && /'\/api\/till\/snapshot' \+ since \+ \(eng/.test(r), 'the snapshot call does not carry eng=');
});

it('a browser counter sends them with its claim, from engine/versions.json', () => {
  const q = body(PAGE, 'async function tillClaimQuery()');
  assert.ok(/engineQueryOf\(await engineVersionsLoad\(\)\)/.test(q), 'the claim does not carry the versions');
  assert.ok(/fetch\('\/engine\/versions\.json'\)/.test(body(PAGE, 'async function engineVersionsLoad()')), 'the browser does not read versions.json');
});

it('vendor-till writes versions.json from the engines\' own lines, and the service worker keeps it offline', () => {
  const v = fs.readFileSync(path.join(API, 'scripts', 'vendor-till.cjs'), 'utf8');
  assert.ok(/path\.join\(WEB, 'engine', 'versions\.json'\), VERSIONS\(\)/.test(v), 'vendor-till no longer writes versions.json');
  assert.ok(/'\/engine\/versions\.json'/.test(v), 'the service worker does not keep versions.json');
  const j = JSON.parse(fs.readFileSync(path.join(WEB, 'engine', 'versions.json'), 'utf8'));
  const money = fs.readFileSync(path.join(WEB, 'engine', 'money.js'), 'utf8').slice(0, 320).match(/v(\d+\.\d+\.\d+)/)[1];
  assert.strictEqual(j.engines.money, money, 'versions.json disagrees with money.js\'s own release line — re-run vendor-till');
});

it('the server keeps them on THAT counter\'s key, shape-checked, in the till record it already writes', () => {
  assert.ok(/engines: req\.query\.eng/.test(TILL), 'the snapshot route does not pass eng= to claimTill');
  const c = body(KEYS, 'router.claimTill = async');
  assert.ok(/const engines = cleanEngines\(ask && ask\.engines\);/.test(c), 'claimTill does not read the versions');
  assert.strictEqual((c.match(/if \(engines\) me\.till\.engines = engines;/g) || []).length, 2, 'one of the two till writes drops the versions');
  const ce = body(KEYS, 'function cleanEngines(raw)');
  assert.ok(/slice\(0, 60\)/.test(ce) && /\{1,32\}/.test(ce) && /\{1,20\}/.test(ce), 'the versions are no longer capped and shape-checked');
});

it('the "what is this counter" panel shows them', () => {
  assert.ok(/engines: \(onAgent\(\) \? \(STATE && STATE\.engines\) : ENGINE_V\) \|\| 'not read yet',/.test(body(PAGE, 'function whoAmI()')), 'whoAmI() does not show the versions');
});

console.log('\n' + pass + ' checks passed\n');
