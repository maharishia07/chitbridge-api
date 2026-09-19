'use strict';
/**
 * till-shippable.test.cjs — WHAT THE INSTALLABLE TILL CARRIES, MEASURED AGAINST THE PAGE ITSELF.
 *
 * Athi, 2026-09-19: *"the back office is not usable by any common man… the till is the best thing we came up
 * with which people can understand. if we can keep the till as an installable application which can use the
 * local database as its own data, the people may start using it… any module which are completely independent
 * of db and if that can be used here, we can bring it."*
 *
 * ⭐⭐ THE RULE IS NOT NEW. engine-boundary.test.js, from Athi's question of 2026-08-04, defines TIER A · PURE
 * as *"zero dependencies. Liftable as FILES into any Node project, today"* — and **liftable as files, today**
 * is exactly **can go in the installable till**. That file protects ten curated modules; this one protects the
 * fourteen the counter actually loads.
 *
 * ⚠️⚠️ AND IT GUARDS THE FAILURE THAT FILE WAS WRITTEN FOR: *"nothing stopped the next commit from adding
 * require('../db') to order-input.js and quietly ending its portability, with no test failing and nobody
 * noticing for months."* The day that happens here the counter stops being installable, and nothing else would
 * say so — the page keeps working, because its copy was vendored from a snapshot taken before the change.
 *
 * ⚠️⚠️⚠️ WHAT THIS FILE DOES **NOT** DO IS RE-CHECK require(). scripts/vendor-till.cjs already throws
 * *"still requires … — a browser has no require()"* for any dependency missing from its dep map, and
 * till-vendor.test.js runs it. A second, weaker copy of that check here reported convert.js as broken when it
 * is correctly wrapped. One rule, one place. [[feedback-adopt-dont-reinvent]] [[feedback-no-duplicate-functions]]
 *
 * Run: node tests/till-shippable.test.cjs   · no DB, no network.
 */
const assert = require('assert'), fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const API = path.join(__dirname, '..');
const M = require(path.join(API, 'tests', 'engine-manifest.js'));
const PAGE = path.join(API, 'tools', 'tally-connector', 'till.html');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

console.log('— what the installable till carries —');

/** where a source lives: bare = chitbridge-api/lib · web: = chitbridge-web/public · vendor: = node_modules */
function resolve(src) {
  if (src.startsWith('vendor:')) return { kind: 'vendor', name: src.slice(7) };
  if (src.startsWith('web:')) return { kind: 'web', file: path.join(API, '..', 'chitbridge-web', 'public', src.slice(4)) };
  return { kind: 'lib', file: path.join(API, 'lib', src) };
}

/**
 * ⭐⭐⭐ THE ONE THAT MAKES THE LIST HONEST. The manifest is a DECLARATION and declarations rot — this one was
 * wrong about four of seventeen entries within an hour of being written. So it is compared against the page:
 * the engines till.html asks for are the truth, and the declaration must equal them exactly.
 */
it('⭐⭐ the declared list is exactly what the counter loads — no more, no less', () => {
  const html = fs.readFileSync(PAGE, 'utf8');
  const loads = [...new Set((html.match(/engine\/[a-z0-9-]+\.js/g) || []).map((s) => s.replace('engine/', '')))].sort();
  const declared = Object.keys(M.TILL_SHIPPABLE).sort();
  assert.deepStrictEqual(declared, loads,
    'the manifest and the counter disagree about which engines ship\n      page: ' + loads.join(' ')
    + '\n      said: ' + declared.join(' '));
});

it('⭐ and every one of them is really on disk where the manifest says', () => {
  for (const [engine, src] of Object.entries(M.TILL_SHIPPABLE)) {
    const r = resolve(src);
    if (r.kind === 'vendor') {
      assert.ok(fs.existsSync(path.join(API, 'node_modules', r.name)),
        engine + ' ← ' + src + ' is not installed — the counter cannot be packaged without it');
      continue;
    }
    assert.ok(fs.existsSync(r.file), engine + ' ← ' + src + ' is declared shippable and is not on disk');
  }
});

/**
 * ⚠️⚠️⚠️ THE ONE THAT MATTERS. scripts/dbfree.cjs walks the TRANSITIVE require chain; this asserts every
 * shipped lib module comes back free. It is computed, never declared — a list of "modules we believe are
 * portable" is the second source of truth this codebase refuses everywhere else.
 */
it('⚠️⚠️ not one of them reaches a database, the network or the disk', () => {
  const bound = [];
  for (const [engine, src] of Object.entries(M.TILL_SHIPPABLE)) {
    const r = resolve(src);
    if (r.kind !== 'lib') continue;      /* the web masters and the vendor file never see node's require at all */
    const out = spawnSync(process.execPath, [path.join(API, 'scripts', 'dbfree.cjs'), '--why', src],
      { encoding: 'utf8' }).stdout || '';
    if (out.indexOf('DB-free') < 0) bound.push(engine + ' ← ' + out.trim().split('\n').slice(-1)[0].trim());
  }
  assert.deepStrictEqual(bound, [],
    'these ship in the counter and are NOT portable any more — the till has stopped being installable');
});

/**
 * ⭐ THE CANDIDATES ARE A SHORTLIST, NOT A PLAN — but a shortlist of things that have since acquired a
 * database is worse than none, because somebody will reach for one believing it is portable.
 */
it('⭐ the candidates are still candidates — every one measured DB-free', () => {
  const gone = [];
  for (const entry of M.TILL_CANDIDATES) {
    if (!fs.existsSync(path.join(API, 'lib', entry))) { gone.push(entry + ' (not on disk)'); continue; }
    const out = spawnSync(process.execPath, [path.join(API, 'scripts', 'dbfree.cjs'), '--why', entry],
      { encoding: 'utf8' }).stdout || '';
    if (out.indexOf('DB-free') < 0) gone.push(entry + ' (now bound)');
  }
  assert.deepStrictEqual(gone, [],
    'the shortlist for the installable till has rotted — these are no longer portable');
});

/**
 * ⚠️⚠️ AND THE MEASUREMENT CAN BE WRONG IN BOTH DIRECTIONS. A check that can only pass is not a check; this is
 * cheap to prove because dbfree.cjs answers about any file, including ones that are certainly bound.
 */
it('⭐ and the measurement can tell bound from free', () => {
  const why = (f) => (spawnSync(process.execPath, [path.join(API, 'scripts', 'dbfree.cjs'), '--why', f],
    { encoding: 'utf8' }).stdout || '');
  assert.ok(why('money.js').indexOf('DB-free') >= 0, 'money.js is Tier A and must read as free');
  assert.ok(why('tax-shelf.js').indexOf('DB-free') < 0, 'tax-shelf.js reads the database and must read as bound');
  assert.ok(why('mint-product.js').indexOf('DB-free') < 0, 'mint-product.js writes the catalogue and must read as bound');
});

console.log(pass + ' checks');
