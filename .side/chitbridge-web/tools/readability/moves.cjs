/* tools/readability/moves.cjs — a function moved between files keeps its score: moving code is not writing new code (Athi, 31 Oct 2026, R-moved (a)).
 *
 * OWNS      find(entries, removed): which functions in the ADDED side of a diff are an EXACT move of a function in its DELETED side, and
 *           the per-file view of it (ranges moved in / out, the score carried, old twin of each moved function).
 * CALLED BY tools/readability/guard.cjs (gather → judgeFile), e2e/readability-guard.cjs (the move fixtures).
 * FLOW      entries + removed files ──▶ deleted pool (a base function the head no longer has) ──▶ added candidates (a head function the base
 *           lacks) ──▶ pair by identical body key (measure.bodyKey: tokens, no whitespace or comments) ──▶ per-file ranges + carried score
 * CARD      qa/readability-guard
 *
 * The rule is narrow on purpose: ONE token different and the function is new code, judged as always. A move inherits the old function's
 * marks (cryptic names, long / complex, no what-line), so it adds no debt and shows no improvement; the target file is allowed the carried
 * score on top of its row, the source file's score falls by the same amount, so the repo total does not move.
 */
'use strict';
const ratchet = require('./ratchet.cjs');

const ownFunctions = (facts) => facts.functions.filter((fn) => !fn.wrapper && fn.bodyKey);
const keyCounts = (functions) => {
  const counts = new Map();
  for (const fn of functions) counts.set(fn.bodyKey, (counts.get(fn.bodyKey) || 0) + 1);
  return counts;
};

/** the functions of `from` that `against` no longer (or not yet) has, matched by body key one for one */
function missingFrom(from, against) {
  const left = keyCounts(against);
  return from.filter((fn) => {
    const count = left.get(fn.bodyKey) || 0;
    if (count > 0) left.set(fn.bodyKey, count - 1);
    return count === 0;
  });
}

const inRange = (fn, outer) => fn !== outer && fn.line >= outer.line && fn.endLine <= outer.endLine;

/** base functions the head no longer holds: every function of a deleted file, and what a changed file lost */
function deletedPool(entries, removed) {
  const pool = new Map();
  const addAll = (file, facts, functions) =>
    functions.forEach((fn) => (pool.get(fn.bodyKey) || pool.set(fn.bodyKey, []).get(fn.bodyKey)).push({ file, facts, fn, used: false }));
  for (const gone of removed) addAll(gone.file, gone.base, ownFunctions(gone.base));
  for (const entry of entries) if (entry.base) addAll(entry.file, entry.base, missingFrom(ownFunctions(entry.base), ownFunctions(entry.head)));
  return pool;
}

/** the head functions the base did not have, outermost first (a nested twin of a moved function is part of the move) */
function candidates(entry) {
  const fresh = entry.base ? missingFrom(ownFunctions(entry.head), ownFunctions(entry.base)) : ownFunctions(entry.head);
  return fresh.slice().sort((left, right) => left.line - right.line || right.len - left.len);
}

/** the facts of just the old range a move carried: its functions, cryptic names and empty catches, header counted complete */
function carriedFacts(moves) {
  const facts = { functions: [], cryptic: [], emptyCatches: [], header: { owns: true, callers: true, flow: true } };
  for (const move of moves) {
    const old = move.from,
      within = (item) => item.line >= old.fn.line && item.line <= old.fn.endLine;
    facts.functions.push(...old.facts.functions.filter((fn) => !fn.wrapper && (fn === old.fn || inRange(fn, old.fn))));
    facts.cryptic.push(...old.facts.cryptic.filter(within));
    facts.emptyCatches.push(...old.facts.emptyCatches.filter(within));
  }
  return facts;
}

/** pair the added candidates with the deleted pool: { moves, byFile } — byFile: file → { moved (head fns), ranges in, out ranges, carried } */
function find(entries, removed) {
  const pool = deletedPool(entries, removed);
  const moves = [];
  for (const entry of entries) {
    const taken = [];
    for (const fn of candidates(entry)) {
      if (taken.some((outer) => inRange(fn, outer))) continue;
      const twin = (pool.get(fn.bodyKey) || []).find((item) => !item.used && !(item.file === entry.file && item.fn.line === fn.line));
      if (!twin) continue;
      twin.used = true;
      taken.push(fn);
      moves.push({ file: entry.file, fn, from: twin });
    }
  }
  const byFile = new Map();
  const slot = (file) => byFile.get(file) || byFile.set(file, { moved: [], into: [], out: [], carriedMoves: [] }).get(file);
  for (const move of moves) {
    const into = slot(move.file);
    into.moved.push(move.fn);
    into.into.push([move.fn.line, move.fn.endLine]);
    into.carriedMoves.push(move);
    slot(move.from.file).out.push([move.from.fn.line, move.from.fn.endLine]);
  }
  for (const view of byFile.values()) view.carried = ratchet.score(carriedFacts(view.carriedMoves));
  return { moves, byFile };
}

const within = (ranges) => (item) => ranges.some(([start, end]) => item.line >= start && item.line <= end);
/** facts without the declarations / catches that sit inside the given ranges (they travel with the move, they are neither new nor gone) */
function without(facts, ranges) {
  if (!facts || !ranges.length) return facts;
  const inside = within(ranges);
  return Object.assign({}, facts, {
    cryptic: facts.cryptic.filter((item) => !inside(item)),
    emptyCatches: facts.emptyCatches.filter((item) => !inside(item))
  });
}

/** counter-by-counter sum of two score breakdowns (the ratchet row plus what a move carried in; nothing carried = the row as it is) */
function plus(left, right) {
  if (!right) return left;
  const sum = { score: (left ? left.score : 0) + right.score };
  for (const key of ratchet.COUNTERS) sum[key] = (left ? left[key] : 0) + right[key];
  return sum;
}

/** a file with no move in or out */
const NO_MOVES = { moved: [], into: [], out: [], carried: null, carriedMoves: [] };

module.exports = { find, without, plus, NO_MOVES };
