'use strict';
/**
 * tests/gorilla-lib.test.cjs — the gorilla generator itself (tests/lib/gorilla.cjs): the same seed is the same run, one record replays
 * alone, a fixed seed is the default, every failure carries its replay line, and a send that throws is a finding, not a crash.
 * Offline: no api, no database. CARD 01-rail-core-the-chit/README
 */
const assert = require('assert');
const path = require('path');
const G = require(path.join(__dirname, 'lib', 'gorilla.cjs'));

let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log('   ok   ' + name); }
  catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + e.message); } };

const make = (h, index) => ({ index, lines: h.int(1, 6), mode: h.pick(['cash', 'upi', 'part']), price: h.money(0, 500), odd: h.chance(0.1) });

(async () => {
  console.log('\n══ tests/lib/gorilla.cjs ══\n');

  ok('the same seed gives the same stream, a different seed another', () => {
    const left = G.seeded(42), right = G.seeded(42), other = G.seeded(43);
    const take = (next) => Array.from({ length: 50 }, next);
    const first = take(left);
    assert.deepStrictEqual(take(right), first);
    assert.notDeepStrictEqual(take(other), first);
    assert.ok(first.every((value) => value >= 0 && value < 1));
  });

  ok('the stream is spread, not stuck (1,000 draws over 10 buckets, none under 60)', () => {
    const next = G.seeded(20261029);
    const buckets = new Array(10).fill(0);
    for (let draw = 0; draw < 1000; draw++) buckets[Math.floor(next() * 10)]++;
    assert.ok(buckets.every((count) => count >= 60), JSON.stringify(buckets));
  });

  ok('record i replays on its own: the same record whether or not the ones before it were made', () => {
    const inRun = Array.from({ length: 30 }, (unused, index) => G.recordOf(make, 7, index));
    assert.deepStrictEqual(G.recordOf(make, 7, 17), inRun[17]);
    assert.notDeepStrictEqual(G.recordOf(make, 7, 17), G.recordOf(make, 8, 17));
    assert.ok(new Set(inRun.map((record) => JSON.stringify(Object.assign({}, record, { index: 0 })))).size > 20, 'thirty records are not thirty copies of one');
  });

  ok('money is rupees with at most two decimals, inside the range', () => {
    const h = G.helpers(G.seeded(3));
    for (let draw = 0; draw < 500; draw++) {
      const amount = h.money(0, 500);
      assert.ok(amount >= 0 && amount <= 500 && Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-6, String(amount));
    }
  });

  ok('the fixed seed is the default; a seed, "random", N and ONLY come from the environment', () => {
    assert.deepStrictEqual(G.settings(99, {}), { seed: 99, count: 200, only: null, budgetMs: null });
    assert.deepStrictEqual(G.settings(99, { GORILLA_SEED: '5', GORILLA_N: '20', GORILLA_ONLY: '3', GORILLA_BUDGET_MS: '900' }), { seed: 5, count: 20, only: 3, budgetMs: 900 });
    const random = G.settings(99, { GORILLA_SEED: 'random' });
    assert.ok(Number.isInteger(random.seed) && random.seed >= 0);
  });

  ok('a seed, N or ONLY that is not a whole number is refused in words, never read as 0 or NaN', () => {
    for (const bad of [{ GORILLA_SEED: 'abc' }, { GORILLA_N: 'lots' }, { GORILLA_ONLY: '1.5' }, { GORILLA_ONLY: '-2' }]) {
      assert.throws(() => G.settings(99, bad), /must be a whole number/, JSON.stringify(bad));
    }
  });

  /* hammer, with a kase that records instead of printing */
  const cases = [];
  const kase = async (id, title, fn, gap) => {
    try { await fn(); cases.push({ id, pass: true, gap }); } catch (e) { cases.push({ id, pass: false, said: e.message, gap }); }
  };
  const report = await G.hammer({
    label: 'test', file: 'tests/x.cjs', fixedSeed: 11, env: { GORILLA_N: '40' }, make, kase,
    send: async (record) => { if (record.index === 13) throw new Error('boom'); return { status: record.odd ? 500 : 200 }; },
    checks: [
      { id: 'X-1', title: 'never a 500', check: (record, seen) => (seen.thrown ? 'threw ' + seen.thrown : seen.status >= 500 ? 'HTTP 500' : null) },
      { id: 'X-2', title: 'always holds', check: () => null },
      { id: 'X-3', title: 'a gap', gap: 'R0', check: () => 'never holds' },
      { id: 'X-4', title: 'a check that throws', check: () => { throw new Error('bad check'); } }
    ]
  });

  ok('hammer makes ONE case per check, over every record', () => {
    assert.deepStrictEqual(cases.map((item) => item.id), ['X-1', 'X-2', 'X-3', 'X-4']);
    assert.strictEqual(report.count, 40);
    assert.strictEqual(cases[1].pass, true);
  });

  ok('a broken check names how many broke it, the first, and the line that replays it', () => {
    assert.strictEqual(cases[0].pass, false);
    assert.ok(/of 40 records broke it · #\d+: /.test(cases[0].said), cases[0].said);
    assert.ok(/replay: GORILLA_SEED=11 GORILLA_ONLY=\d+ node tests\/x\.cjs/.test(cases[0].said), cases[0].said);
    assert.ok(cases[0].said.split(' | ').length <= 3, 'at most the first three');
  });

  ok('a send that throws is a finding on that record, not a crashed run', () => {
    assert.ok(report.failures['X-1'].some((item) => item.index === 13 && /threw boom/.test(item.said)));
  });

  ok('a gap check keeps its gap marker; a check that throws is reported, not swallowed', () => {
    assert.strictEqual(cases[2].gap, 'R0');
    assert.strictEqual(cases[2].pass, false);
    assert.ok(/the check itself threw: bad check/.test(cases[3].said), cases[3].said);
  });

  const timed = [];
  const os = require('os');
  const jsonFile = path.join(os.tmpdir(), 'gorilla-lib-' + process.pid + '.json');
  const handed = [];
  await G.hammer({ label: 'slow', file: 'x', fixedSeed: 1, env: { GORILLA_N: '3', GORILLA_BUDGET_MS: '1', GORILLA_JSON: jsonFile }, make,
    kase: async (id, title, fn) => { try { await fn(); timed.push({ id, pass: true }); } catch (e) { timed.push({ id, pass: false, said: e.message }); } },
    before: async (record, index) => ({ prepared: index }),
    send: async (record, index, made) => { handed.push(made); await new Promise((done) => setTimeout(done, 5)); return {}; },
    checks: [{ id: 'S-1', title: 'odd index', check: (record) => (record.index % 2 ? 'odd' : null) }] });
  ok('a run over its budget is a GORILLA-TIME red that says what to do', () => {
    const time = timed.find((item) => item.id === 'GORILLA-TIME');
    assert.ok(time && !time.pass && /lower GORILLA_N in CI/.test(time.said), JSON.stringify(timed));
  });
  ok('GORILLA_JSON keeps every failing index per check, for the nightly', () => {
    const kept = JSON.parse(require('fs').readFileSync(jsonFile, 'utf8'));
    require('fs').unlinkSync(jsonFile);
    assert.deepStrictEqual(kept.failures['S-1'].map((item) => item.index), [1]);
    assert.strictEqual(kept.seed, 1);
  });
  ok('before(record, i) runs first and its answer is handed to send', () => {
    assert.deepStrictEqual(handed, [{ prepared: 0 }, { prepared: 1 }, { prepared: 2 }]);
  });

  const seenIndexes = [];
  await G.hammer({ label: 'one', file: 'x', fixedSeed: 11, env: { GORILLA_ONLY: '13' }, make, kase: async () => {},
    send: async (record, index) => { seenIndexes.push(index); return {}; }, checks: [] });
  ok('GORILLA_ONLY replays exactly the one record', () => {
    assert.deepStrictEqual(seenIndexes, [13]);
  });

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})();
