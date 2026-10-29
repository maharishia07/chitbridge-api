'use strict';
/**
 * tests/lib/gorilla.cjs — THE ONE SEEDED GENERATOR every gorilla pack shares (docs/api/COLUMN-13-ADDS-UP.md §4a; Athi 24 Oct: "yes add it").
 *
 * owns: a seeded random source (mulberry32) · pick / int / chance / money helpers · `hammer()`, which builds N varied records for ONE
 *       route, sends each, and grades every record against the pack's checks — then reports ONE case per check through the truth
 *       harness's `kase`, so a pack reads like every other T2 file (a `gap:` check is recorded, not red).
 * called by: tests/send-gorilla-truth.realstack.cjs (POST /api/chits/send) — and each later pack, in §4a's order.
 * FLOW  seed → record i has its own seed (base + i) → make(rand, i) → send(record) → each check(record, seen) → kase per check
 * CARD 01-rail-core-the-chit/README
 *
 * ⚠️ DETERMINISTIC BY DEFAULT. A pack passes its FIXED seed; CI runs exactly that, so a red is a red and not a dice roll. A fresh seed
 * is on demand only: GORILLA_SEED=<n> (or "random"). GORILLA_N=<n> sets how many records (CI default 200; the nightly 2,000).
 * GORILLA_ONLY=<i> replays ONE record of the given seed — every failure prints the exact line to paste to do that.
 * GORILLA_BUDGET_MS=<ms> (or the pack's budgetMs) fails a GORILLA-TIME case when the run takes longer, so a slow pack is a red, not a slow CI.
 * GORILLA_JSON=<file> writes every failing index per check (the nightly run keeps them as fixed cases).
 *
 * ⚠️ A RECORD IS PURE OF ITS SEED; THE WORLD IS NOT. make() must not read the clock or the run tag (a pack derives them from the record's
 * index), but records share the pack's shop, so stock and numbering carry from one to the next. A check must hold whatever came before;
 * a pack that needs a clean world per record gives hammer a before(record, i) that sets it up and hands send what it made.
 *
 * Plain JS, no dependency: the point is a failure anyone can replay from one line, not a framework.
 */

/** mulberry32: a small, fast, well-spread 32-bit generator — the same seed gives the same stream on every machine */
function seeded(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** the helpers a pack's make() draws from, all reading the one stream */
function helpers(next) {
  const int = (low, high) => low + Math.floor(next() * (high - low + 1));
  return {
    next,
    int,
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (odds) => next() < odds,
    /* money in paise, as a number of rupees with at most two decimals — the shape a counter sends */
    money: (low, high) => int(Math.round(low * 100), Math.round(high * 100)) / 100
  };
}

/** the run's settings, from the environment, with the pack's fixed seed as the default */
function settings(fixedSeed, env) {
  const vars = env || process.env;
  const whole = (name) => {
    const text = vars[name];
    if (text === undefined || text === '') return null;
    if (!/^\d+$/.test(String(text).trim())) throw new Error(name + ' must be a whole number (or GORILLA_SEED=random)');
    return Number(text);
  };
  const seed = vars.GORILLA_SEED === 'random' ? Math.floor(Math.random() * 2 ** 31) : (whole('GORILLA_SEED') ?? fixedSeed) >>> 0;
  const count = whole('GORILLA_N') || 200;
  return { seed, count, only: whole('GORILLA_ONLY'), budgetMs: whole('GORILLA_BUDGET_MS') };
}

/** record i of a seed: its own stream, so one record replays without the ones before it */
function recordOf(make, seed, index) {
  return make(helpers(seeded((seed + Math.imul(index + 1, 0x9e3779b1)) >>> 0)), index);
}

/** the one line that replays a failure */
const replayLine = (file, seed, index) => 'GORILLA_SEED=' + seed + ' GORILLA_ONLY=' + index + ' node ' + file;

/**
 * hammer({ label, file, fixedSeed, make, send, checks, kase, before?, budgetMs?, env? })
 *   make(h, i)            → a record (h: next/int/pick/chance/money) — from the seed only
 *   before(record, i)     → optional: the state a record needs first (a bill to pay, a balance to read); its answer is handed to send
 *   send(record, i, made) → what was seen: { status, body, ...anything the checks read }; a throw is itself a finding, named by its message
 *   checks[]              → { id, title, gap?, check(record, seen) → null when it holds, else a short sentence }
 * Every check becomes ONE kase: it passes when no record broke it, else it names how many broke it and the first three, each with its
 * replay line.
 * @returns { seed, count, failures: { [check id]: [{ index, said }] }, ms }
 */
async function hammer(pack) {
  const run = settings(pack.fixedSeed, pack.env);
  const indexes = run.only !== null ? [run.only] : Array.from({ length: run.count }, (unused, index) => index);
  const failures = Object.fromEntries(pack.checks.map((rule) => [rule.id, []]));
  const started = Date.now();
  for (const index of indexes) {
    const record = recordOf(pack.make, run.seed, index);
    let seen;
    try {
      const made = pack.before ? await pack.before(record, index) : undefined;
      seen = await pack.send(record, index, made);
    } catch (e) {
      seen = { thrown: e && e.message ? e.message : String(e) };
    }
    for (const rule of pack.checks) {
      let said;
      try {
        said = rule.check(record, seen);
      } catch (e) {
        said = 'the check itself threw: ' + (e && e.message);
      }
      if (said) failures[rule.id].push({ index, said });
    }
  }
  const ms = Date.now() - started;
  console.log('  gorilla ' + pack.label + ' · seed ' + run.seed + ' · ' + indexes.length + ' records · ' + ms + ' ms');
  for (const rule of pack.checks) {
    const broke = failures[rule.id];
    await pack.kase(rule.id, rule.title, async () => {
      if (!broke.length) return indexes.length + ' records';
      const firsts = broke.slice(0, 3).map((item) => '#' + item.index + ': ' + item.said + ' · replay: ' + replayLine(pack.file, run.seed, item.index));
      throw new Error(broke.length + ' of ' + indexes.length + ' records broke it · ' + firsts.join(' | '));
    }, rule.gap);
  }
  const budget = run.budgetMs || pack.budgetMs;
  if (budget) {
    await pack.kase('GORILLA-TIME', pack.label + ' runs inside its budget (' + budget + ' ms)', async () => {
      if (ms > budget) throw new Error(indexes.length + ' records took ' + ms + ' ms — lower GORILLA_N in CI and keep the full run for the nightly');
      return ms + ' ms';
    });
  }
  const report = { label: pack.label, seed: run.seed, count: indexes.length, failures, ms };
  const out = (pack.env || process.env).GORILLA_JSON;
  if (out) require('fs').writeFileSync(out, JSON.stringify(report, null, 2));
  return report;
}

module.exports = { seeded, helpers, settings, recordOf, replayLine, hammer };
