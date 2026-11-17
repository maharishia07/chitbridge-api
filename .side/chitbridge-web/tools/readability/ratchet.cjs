/* tools/readability/ratchet.cjs — a file's readability SCORE and the ratchet that only ever goes down (READ-GUARD, 2026-10-15).
 *
 * OWNS      score(facts): the one number per file the ratchet holds, and its breakdown; read / write / compare of
 *           <repo>/readability.ratchet.json (per file; `--write` lowers only, never raises).
 * CALLED BY tools/readability.cjs (--write), tools/readability/guard.cjs (the "worse than the ratchet" rule).
 * FLOW      facts ──▶ breakdown (long40 · long80 · complex10 · complex15 · deep3 · deep4 · cryptic · noWhatLine · emptyCatch · noHeader)
 *           ──▶ score = their sum ──▶ compare with the ratchet row ──▶ fail when higher · tighten when lower
 * CARD      qa/readability-guard
 *
 * The same style as e2e/token-guard.baseline.json and the api's tests/fixtures/fn-size.json: a file may score LESS than its row,
 * never more; a file with no row is NEW code and must score 0 (§6: new code meets all of it).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const RATCHET_FILE = 'readability.ratchet.json';
const LIMITS = { lines: 40, linesHard: 80, complexity: 10, complexityHard: 15, depth: 3, depthHard: 4, whatLineFrom: 10 };
const COUNTERS = ['long40', 'long80', 'complex10', 'complex15', 'deep3', 'deep4', 'cryptic', 'noWhatLine', 'emptyCatch', 'noHeader'];

/** does the header carry the three things §6 asks for (owns · called by · flow or init line)? */
function headerComplete(header) {
  return !!(header && header.owns && header.callers && header.flow);
}

/** the breakdown behind one file's score: how many functions/names/catches break each §6 rule */
function breakdown(facts) {
  const functions = facts.functions.filter((fn) => !fn.wrapper);
  const named = functions.filter((fn) => !fn.anon);
  return {
    long40: functions.filter((fn) => fn.len > LIMITS.lines).length,
    long80: functions.filter((fn) => fn.len > LIMITS.linesHard).length,
    complex10: functions.filter((fn) => fn.complexity > LIMITS.complexity).length,
    complex15: functions.filter((fn) => fn.complexity > LIMITS.complexityHard).length,
    deep3: functions.filter((fn) => fn.depth > LIMITS.depth).length,
    deep4: functions.filter((fn) => fn.depth > LIMITS.depthHard).length,
    cryptic: facts.cryptic.length,
    noWhatLine: named.filter((fn) => fn.len > LIMITS.whatLineFrom && !fn.hasAbove).length,
    emptyCatch: facts.emptyCatches.length,
    noHeader: headerComplete(facts.header) ? 0 : 1
  };
}

function score(facts) {
  const parts = breakdown(facts);
  return { score: COUNTERS.reduce((total, key) => total + parts[key], 0), ...parts };
}

function ratchetPath(root) {
  return path.join(root, RATCHET_FILE);
}

/** the ratchet rows, or null when the repo has none yet */
function read(root) {
  const file = ratchetPath(root);
  if (!fs.existsSync(file)) return null;
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete rows._about;
  return rows;
}

/** merge new scores into the ratchet, LOWER ONLY: a file whose score rose keeps its old row and is named in `refused` */
function tighten(existing, scores) {
  const rows = Object.assign({}, existing || {});
  const refused = [],
    lowered = [];
  for (const [file, next] of Object.entries(scores)) {
    const current = rows[file];
    if (current && next.score > current.score) {
      refused.push({ file, from: current.score, to: next.score });
      continue;
    }
    if (current && next.score < current.score) lowered.push({ file, from: current.score, to: next.score });
    rows[file] = next;
  }
  return { rows, refused, lowered };
}

/** one row per line, files sorted — a diff shows exactly which file moved */
function write(root, rows) {
  const about =
    'readability ratchet (DISCIPLINES §6): one row per own-code file, score = ' +
    COUNTERS.join(' + ') +
    '. A file may score LESS than its row, never more. Lower it with `node tools/readability.cjs --write` (web) / `--repo api --write` / `--repo engines --write`; it never raises.';
  const lines = ['  "_about": ' + JSON.stringify(about)];
  for (const file of Object.keys(rows).sort()) lines.push('  ' + JSON.stringify(file) + ': ' + JSON.stringify(rows[file]));
  fs.writeFileSync(ratchetPath(root), '{\n' + lines.join(',\n') + '\n}\n');
}

/** which counters rose between two breakdowns — the words a failure needs */
function risen(before, after) {
  return COUNTERS.filter((key) => after[key] > (before ? before[key] : 0)).map((key) => key + ' ' + (before ? before[key] : 0) + ' → ' + after[key]);
}

module.exports = { RATCHET_FILE, LIMITS, COUNTERS, breakdown, score, read, write, tighten, risen, headerComplete, ratchetPath };
