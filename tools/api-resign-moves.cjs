#!/usr/bin/env node
'use strict';
/* tools/api-resign-moves.cjs — re-signs, by tool, only the routes whose hash moved while the code did not (D1, batch 1130)
 * OWNER     cb-api
 * OWNS      D1 of batch 1130 (Athi 25 Nov 2026): re-sign, by tool, ONLY the routes whose hash moved while the code did not: the handler is the same text
 *           in another place (or tidied in one of the ways tools/move-proof.cjs proves), the validation chain and the OpenAPI operation are byte-equal, and
 *           all 13 machine columns pass on the head register. Everything else is printed as "for a human" with the first difference, and is never touched.
 * CALLED BY cb-api, once, before a fold or a batch re-sign · tools/api-ratchet.cjs prints this tool's command when a changed route is partial (D3).
 * FLOW      base ref unpacked beside (git archive) ──▶ tools/api-register.cjs --json --parts over base and over head ──▶ routes whose hash moved and that
 *           were signed at the base ──▶ chain + operation byte-equal ──▶ 13 columns true ──▶ tools/move-proof.cjs over every handler ──▶ receipt
 *           ──▶ with --write: the route's own line of docs/api-signoffs.json is patched in place (hash + signed_off_by_date); never reserialised, never re-sorted
 * CARD      28-platform-and-operations/api-standard
 *
 *   node tools/api-resign-moves.cjs --base origin/main            dry run: one line per moved route, proven or not, and why
 *   node tools/api-resign-moves.cjs --base origin/main --write    patch the sign-off lines of the proven routes whose sign-off is stale
 *   --date YYYY-MM-DD   the sign date (default today) · --only "METHOD /path"   one route · --receipt F   the whole receipt as JSON
 * The base register is read with the HEAD's generator (the ratchet does the same), so a base without --parts can still be measured.
 * A route signed by hand at the head already (its hash is current) is still judged, so the tool can be run over history to count what it would have signed.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { proveSame } = require('./move-proof.cjs');
const { checkoutBase } = require('./api-ratchet.cjs');
const { MACHINE_COLUMNS } = require('./api-register.cjs');

const ROOT = path.resolve(__dirname, '..');
const SIGNOFFS = path.join(ROOT, 'docs', 'api-signoffs.json');
const ENTRY = /^( {1,2})("(?:[^"\\]|\\.)*"): (\{.*\})(,?)(\r?)$/;
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const valueOf = (name) => (argv.indexOf(name) >= 0 ? argv[argv.indexOf(name) + 1] : null);

/** the register and the hash parts of one checkout, as the generator writes them */
function generate(checkout) {
  const stamp = path.join(os.tmpdir(), 'api-resign-' + process.pid + '-' + path.basename(checkout));
  const generated = spawnSync(process.execPath, [path.join(__dirname, 'api-register.cjs'), '--root', checkout, '--json', stamp + '.json', '--parts', stamp + '.parts.json'], { encoding: 'utf8' });
  try {
    if (generated.status !== 0 || !fs.existsSync(stamp + '.json')) throw new Error('the register generator failed over ' + checkout + ': ' + String(generated.stderr || generated.stdout).slice(0, 600));
    return { register: JSON.parse(fs.readFileSync(stamp + '.json', 'utf8')), parts: JSON.parse(fs.readFileSync(stamp + '.parts.json', 'utf8')) };
  } finally {
    fs.rmSync(stamp + '.json', { force: true });
    fs.rmSync(stamp + '.parts.json', { force: true });
  }
}

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const columnsFailing = (row) => MACHINE_COLUMNS.filter((name) => row.columns[name] !== true);

/** the verdict for one route whose hash moved: { key, outcome, level, why } where outcome is proven | human */
function judge(headRow, baseRow, baseParts, headParts, entry) {
  const verdict = (outcome, why, level) => ({ key: headRow.key, outcome, level: level || null, why, stale: !!entry && entry.hash !== headRow.hash, file: headRow.file });
  if (!(baseRow.human && baseRow.human.signed_off_by_date && baseRow.status === 'meets standard')) return verdict('human', 'not signed at the base: new work, a person signs it');
  if (!baseParts || !headParts) return verdict('human', 'no hash parts for this route (generator without --parts)');
  if (!same(baseParts.chain, headParts.chain)) return verdict('human', 'validation chain differs: a contract change');
  if (baseParts.op !== headParts.op) return verdict('human', 'OpenAPI operation text differs: a contract change');
  const failing = columnsFailing(headRow);
  if (failing.length) return verdict('human', 'columns not true on the head register: ' + failing.join(', '));
  const proved = proveSame({ file: baseParts.file, handlers: baseParts.raw }, { file: headParts.file, handlers: headParts.raw });
  return proved.proven ? verdict('proven', proved.why, proved.level) : verdict('human', proved.why);
}

/** every moved route judged: [{ key, outcome, ... }] */
function judgeAll(base, head, signoffs, only) {
  const baseRows = new Map(base.register.routes.map((row) => [row.key, row]));
  const moved = head.register.routes.filter((row) => baseRows.has(row.key) && baseRows.get(row.key).hash !== row.hash && (!only || row.key === only));
  return moved.map((row) => judge(row, baseRows.get(row.key), base.parts[row.key], head.parts[row.key], signoffs.routes[row.key]));
}

/** the stamp written into a re-signed route (the date first: tools/api-register.cjs reads the stage from it) */
const stampOf = (date, ref, verdict) => 'cb-api ' + date + ' moved, body identical (tool): tools/api-resign-moves.cjs against ' + ref + ' proved ' + verdict.level + ' (' + verdict.why + '); validation chain and OpenAPI operation byte-equal; 13 machine columns true on the head register, stage2. Read by the tool, not by eye: a route it did not prove was left for a person.';

/** patch the route's own line of the hand file: its hash and its stamp, nothing else, same key order, same layout */
function patchSignoffs(verdicts, headRows, date, ref, file) {
  const hashes = new Map(headRows.map((row) => [row.key, row.hash]));
  const todo = new Map(verdicts.filter((verdict) => verdict.outcome === 'proven' && verdict.stale).map((verdict) => [verdict.key, verdict]));
  let patched = 0;
  const lines = fs.readFileSync(file || SIGNOFFS, 'utf8').split('\n').map((line) => {
    const found = ENTRY.exec(line);
    const key = found && JSON.parse(found[2]);
    if (!found || !todo.has(key)) return line;
    const entry = JSON.parse(found[3]);
    entry.hash = hashes.get(key);
    entry.signed_off_by_date = stampOf(date, ref, todo.get(key));
    patched++;
    return found[1] + found[2] + ': ' + JSON.stringify(entry) + found[4] + found[5];
  });
  fs.writeFileSync(file || SIGNOFFS, lines.join('\n'));
  return patched;
}

/** print the receipt: the counts, one line per route, the not proven ones with the first difference */
function print(verdicts, ref) {
  const proven = verdicts.filter((verdict) => verdict.outcome === 'proven');
  const levels = {};
  proven.forEach((verdict) => { levels[verdict.level] = (levels[verdict.level] || 0) + 1; });
  verdicts.forEach((verdict) => console.log((verdict.outcome === 'proven' ? 'PROVEN ' : 'HUMAN  ') + verdict.key + (verdict.outcome === 'proven' ? '  [' + verdict.level + (verdict.stale ? '' : ', sign-off already current') + ']' : '  ' + verdict.why.slice(0, 220))));
  console.log('moved routes against ' + ref + ': ' + verdicts.length + ' · proven (body identical): ' + proven.length + ' ' + JSON.stringify(levels) + ' · for a human: ' + (verdicts.length - proven.length));
}

/** the command line: judge every moved route, print the receipt, and with --write patch the proven ones */
function main() {
  const ref = valueOf('--base');
  if (!ref) throw new Error('--base <ref> is required (origin/main, or the sha the sign-offs were last current at)');
  const base = checkoutBase(ref);
  try {
    const head = generate(ROOT);
    const verdicts = judgeAll(generate(base.dir), head, JSON.parse(fs.readFileSync(SIGNOFFS, 'utf8')), valueOf('--only'));
    print(verdicts, ref);
    if (valueOf('--receipt')) fs.writeFileSync(valueOf('--receipt'), JSON.stringify({ base: ref, verdicts }, null, 1));
    if (flag('--write')) {
      const patched = patchSignoffs(verdicts, head.register.routes, valueOf('--date') || new Date().toISOString().slice(0, 10), ref);
      console.log('re-signed ' + patched + ' line(s) of docs/api-signoffs.json: now run node tools/api-register.cjs, then --check, then node tools/hand-file-fix.cjs --check signoffs');
    }
  } finally {
    base.remove();
  }
}

if (require.main === module) {
  try {
    main();
  } catch (failure) {
    console.log('FAIL ' + failure.message);
    process.exitCode = 1;
  }
  process.exit(process.exitCode || 0);
}
module.exports = { generate, judge, judgeAll, patchSignoffs, stampOf };
