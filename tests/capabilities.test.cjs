'use strict';
/**
 * tests/capabilities.test.cjs — ERR-2/6/9/11a: the ONE capability manifest (lib/capabilities.js).
 *   · a required file missing → the boot check NAMES it (fatal off a local stack, a warning on one) and never prints a path
 *   · a lazy require of a file that is gone → the CI resolve scan fails; one inside try/catch (lib/workflow.js:63) or a comment does not
 *   · an optional table absent is a warning with a count, never fatal; a trigger body without its door is a warning that names it
 *   · an adopted engine that differs from its pin is named
 *   · this repo itself: nothing unresolved, no missing file, every hasTable('x') literal is listed, /health carries counts only
 * Run: node tests/capabilities.test.cjs · offline, no database · MIN refusal-path · fail-closed (a missing part refuses the boot, it is never skipped)
 */
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const caps = require('../lib/capabilities'), dbRole = require('../lib/db-role');
const ROOT = path.join(__dirname, '..');
let pass = 0;
const it = async (what, run) => { try { await run(); pass++; console.log('  ok  ' + what); } catch (e) { process.exitCode = 1; console.log('  FAIL ' + what + '\n      ' + e.message); } };
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cap-'));
const put = (root, rel, body) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), body); };

(async () => {
  await it('a missing required file: the boot check names it, fatal in production, a warning on a local stack, no absolute path in the words', async () => {
    const root = scratch();
    put(root, 'lib/here.js', '');
    const prod = caps.checkFiles(false, root, ['lib/here.js', 'lib/tax.js']);
    assert.strictEqual(prod.level, 'fatal');
    assert.ok(prod.reason.includes('lib/tax.js') && !prod.reason.includes('lib/here.js'), prod.reason);
    assert.ok(!prod.reason.includes(root), 'the sentence must not carry a path of this machine');
    assert.strictEqual(caps.checkFiles(true, root, ['lib/tax.js']).level, 'warn');
    assert.strictEqual(caps.checkFiles(false, root, ['lib/here.js']).level, 'ok');
  });

  await it('bootCheck runs the manifest steps FIRST and a fatal one stops before any database read', async () => {
    const root = scratch(), asked = [], logged = [];
    const log = { critical: (m, x) => logged.push(m + ' | ' + x.reason), info() {}, warn() {} };
    const run = async (sql) => { asked.push(sql); return { rows: [] }; };
    const steps = { before: [async () => caps.checkFiles(false, root, ['lib/tax.js'])], after: [] };
    assert.strictEqual(await dbRole.bootCheck(run, false, log, steps), true);
    assert.deepStrictEqual(asked, [], 'no database read after a fatal file check');
    assert.ok(/lib\/tax\.js/.test(logged[0]), logged[0]);
  });

  await it('CI scan: a lazy require of a missing file fails; a try/catch require and a comment do not', async () => {
    const root = scratch();
    put(root, 'lib/a.js', "function f() { return require('./gone'); }\n");
    assert.deepStrictEqual(caps.unresolvedRequires(root), ['lib/a.js:1 ./gone']);
    const ok = scratch();
    put(ok, 'lib/b.js', "let X; try { X = require('./may-be-absent'); } catch (_) { X = null; }\n// require('./in-a-comment')\n * node -e \"require('./in-a-doc')\"\nconst real = require('./c');\n");
    put(ok, 'lib/c.js', '');
    assert.deepStrictEqual(caps.unresolvedRequires(ok), []);
  });

  await it('an optional table absent is a warning with a count; a trigger body without its door is a warning that names it', async () => {
    const tbl = await caps.checkTables(async () => ({ rows: [{ t: 'year_carry' }, { t: 'cb_attachment' }] }));
    assert.strictEqual(tbl.level, 'warn');
    assert.ok(/absent: 2/.test(tbl.msg) && /year_carry/.test(tbl.reason));
    assert.strictEqual((await caps.checkTables(async () => ({ rows: [] }))).level, 'ok');
    const body = await caps.checkBodies(async () => ({ rows: [{ prosrc: 'BEGIN RAISE EXCEPTION ...' }] }));
    assert.strictEqual(body.level, 'warn');
    assert.ok(/b890/.test(body.reason));
    assert.strictEqual((await caps.checkBodies(async () => ({ rows: [{ prosrc: "current_setting('cb.net_reroot')" }] }))).level, 'ok');
    assert.strictEqual((await caps.checkBodies(async () => ({ rows: [] }))).level, 'ok', 'no such trigger here (a fresh stack) is not a wrong body');
  });

  await it('an adopted engine that differs from its pin is named', async () => {
    const root = scratch();
    put(root, 'engines.lock.json', JSON.stringify({ pins: { money: '1.2.0' } }));
    put(root, 'lib/money.js', '/* ADOPTED from chitbridge-engines v1.1.0 · money · sha256 x — DO NOT EDIT HERE. */');
    const drift = caps.engineDrift(root);
    assert.deepStrictEqual(drift.map((d) => d.name + d.found + d.pinned), ['money1.1.01.2.0']);
    assert.strictEqual(caps.checkEngines(false, root).level, 'fatal');
  });

  await it('this repo: every manifest file is there, nothing unresolved, no engine drift', async () => {
    assert.deepStrictEqual(caps.missingFiles(), []);
    assert.deepStrictEqual(caps.unresolvedRequires(), []);
    assert.deepStrictEqual(caps.engineDrift(), []);
  });

  await it('this repo: every schema.hasTable(\'x\') literal is listed in the manifest (a new optional table needs its row here)', async () => {
    const seen = new Set();
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) return walk(p);
      if (!/\.js$/.test(e.name)) return;
      for (const m of fs.readFileSync(p, 'utf8').matchAll(/hasTable\('([a-z_]+)'/g)) seen.add(m[1]);
    });
    ['lib', 'routes'].forEach((d) => walk(path.join(ROOT, d)));
    const unlisted = [...seen].filter((t) => !caps.MANIFEST.tables.includes(t));
    assert.deepStrictEqual(unlisted, [], 'add to MANIFEST.tables: ' + unlisted.join(', '));
  });

  await it('the public /health carries counts only: integers, no file, door or table names', async () => {
    const c = caps.counts();
    assert.deepStrictEqual(Object.keys(c).sort(), ['engine_drift', 'missing', 'required']);
    assert.ok(Object.values(c).every(Number.isInteger));
    assert.ok(/capabilities: require\('\.\.\/lib\/capabilities'\)\.counts\(\)/.test(fs.readFileSync(path.join(ROOT, 'routes', 'health.js'), 'utf8')));
  });

  console.log(pass + ' checks');
})();
