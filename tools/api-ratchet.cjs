#!/usr/bin/env node
'use strict';
/*
 * OWNS      the API ratchet (API-STANDARD S16): a route a PR adds or changes must meet the standard, and the count of routes not meeting it only goes down. Also docs/api-ratchet.json.
 * CALLED BY CI job api-standard (node tools/api-ratchet.cjs --base origin/main [--hotfix]) · by hand: --write after a route reaches a better status.
 * FLOW      base unpacked beside (git archive) ──▶ this tool's register generator over base and over head (--json) ──▶ diff by "METHOD path" ──▶ touched = new, or its hash differs
 *           ──▶ held routes must pass ──▶ counts compared with docs/api-ratchet.json on base ──▶ new codes registered ──▶ debt not expired ──▶ exit 1 on any failure
 * CARD      28-platform-and-operations/api-standard
 *
 *   node tools/api-ratchet.cjs --base origin/main     check (CI)
 *   node tools/api-ratchet.cjs --base origin/main --hotfix   a PR labelled hotfix: a touched route that does not meet may stay if the PR records a dated debt entry (14 days)
 *   node tools/api-ratchet.cjs --write                rewrite docs/api-ratchet.json from the head register (refuses to raise the count; --seed overrides for the first run)
 * Stage "1b" (ajv landed): a touched route of a brought-over file (HELD_FILES: routes/keys.js, routes/integrations.js) must have all seven machine columns true; every other touched route is counted, not blocked. Stage "all" holds every route.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const RATCHET_FILE = path.join(ROOT, 'docs', 'api-ratchet.json');
/* the route files brought to the standard so far: a PR touching one of their routes must keep it at all seven machine columns (S16 a); the list grows with each slice */
const HELD_FILES = ['routes/keys.js', 'routes/integrations.js'];
const DEBT_DAYS = 14;
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const valueOf = (name) => (argv.indexOf(name) >= 0 ? argv[argv.indexOf(name) + 1] : null);
const today = () => new Date().toISOString().slice(0, 10);
const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback);

/** run the register generator over a checkout (this tool's own copy, so a base without the generator can still be measured) and read its json */
function registerOf(checkout) {
  const out = path.join(os.tmpdir(), 'api-register-' + process.pid + '-' + path.basename(checkout) + '.json');
  const generated = spawnSync(process.execPath, [path.join(__dirname, 'api-register.cjs'), '--root', checkout, '--json', out], { encoding: 'utf8' });
  if (generated.status !== 0 || !fs.existsSync(out)) throw new Error('the register generator failed over ' + checkout + ': ' + String(generated.stderr || generated.stdout).slice(0, 600));
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}

/**
 * the base ref unpacked beside (git archive: no index, no lock, so a stuck checkout cannot hang CI), node_modules linked so its code can load.
 * Smaller than a second worktree, which hung twice on the owner's PC; the result is the same tree.
 */
function checkoutBase(ref) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-base-'));
  const tarFile = dir + '.tar';
  const packed = spawnSync('git', ['archive', '--format=tar', '-o', tarFile, ref], { cwd: ROOT, encoding: 'utf8' });
  if (packed.status !== 0) throw new Error('git archive ' + ref + ' failed: ' + packed.stderr);
  const unpacked = spawnSync('tar', ['-xf', path.join('..', path.basename(tarFile))], { cwd: dir, encoding: 'utf8' }) /* relative: GNU tar reads "C:" as a host name */;
  fs.rmSync(tarFile, { force: true });
  if (unpacked.status !== 0) throw new Error('unpacking ' + ref + ' failed: ' + unpacked.stderr);
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'junction');
  return { dir, remove: () => removeBase(dir) };
}

/** unlink the node_modules link FIRST (a recursive delete must never follow it into the real folder), then delete the unpacked copy */
function removeBase(dir) {
  const link = path.join(dir, 'node_modules');
  try {
    fs.unlinkSync(link);
  } catch (failure) {
    fs.rmdirSync(link); /* a Windows junction answers rmdir, not unlink; either removes the link only */
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

/** touched = a route the base does not have, or whose hash differs */
function touchedRoutes(baseRegister, headRegister) {
  const before = new Map(baseRegister.routes.map((row) => [row.key, row.hash]));
  return headRegister.routes.filter((row) => !before.has(row.key) || before.get(row.key) !== row.hash);
}

const liveColumnsPass = (row) => Object.keys(row.columns).every((name) => row.columns[name] === true);
const meets = (row) => row.status === 'meets standard';

/** routes held to the standard: the brought-over files until stage 'all' (every route, once the sweep is done) */
const isHeld = (row, stage) => stage === 'all' || HELD_FILES.includes(row.file);
/** a held route passes on its seven machine columns; the cb-api sign-off is the reviewer's, dated in the register, and is not the builder's to give (consult-map rule 1) */
const passesHold = (row) => liveColumnsPass(row);

/** debt entries: a route listed here is allowed to stay below the standard until `expires` */
function debtProblems(debt, hotfix, failing) {
  const problems = [];
  debt.forEach((entry) => {
    if (entry.expires < today()) problems.push('ratchet debt for ' + entry.route + ' expired on ' + entry.expires + ' (' + entry.pr + '): make the route meet the standard or remove the entry');
    const days = (Date.parse(entry.expires) - Date.parse(entry.opened)) / 86400000;
    if (days > DEBT_DAYS) problems.push('ratchet debt for ' + entry.route + ' runs ' + days + ' days; the limit is ' + DEBT_DAYS);
  });
  if (!hotfix) return problems;
  return problems.concat(failing.filter((row) => !debt.some((entry) => entry.route === row.key)).map((row) => 'hotfix: ' + row.key + ' does not meet the standard and has no debt entry in docs/api-ratchet.json'));
}

/** the touched routes held to the standard at this stage; returns the sentences that fail the PR */
function checkRoutes(base, head, ratchet, hotfix) {
  const stage = ratchet.stage || '1a';
  const debt = ratchet.debt || [];
  const touched = touchedRoutes(base, head);
  const held = touched.filter((row) => isHeld(row, stage));
  const failing = held.filter((row) => !passesHold(row));
  const owed = failing.filter((row) => !debt.some((entry) => entry.route === row.key && entry.expires >= today()));
  const problems = hotfix ? [] : owed.map((row) => row.key + ' was added or changed and does not meet the standard (' + Object.keys(row.columns).filter((name) => row.columns[name] !== true).join(', ') + ')');
  const counted = touched.filter((row) => !isHeld(row, stage) && !meets(row));
  console.log(touched.length + ' routes touched against the base: ' + held.length + ' held, ' + counted.length + ' counted only (stage ' + stage + ')');
  return problems.concat(debtProblems(debt, hotfix, failing));
}

/** the count of routes not meeting the standard may only go down, adjusted for routes added or removed (S16 b) */
function checkCounts(baseRatchet, head, headRatchet) {
  const actual = head.counts.routes - head.counts.meets;
  const allowed = baseRatchet.not_meeting + Math.max(0, head.counts.routes - baseRatchet.total);
  const problems = [];
  if (actual > allowed) problems.push('routes not meeting the standard rose to ' + actual + ' (allowed ' + allowed + ' from the base ratchet of ' + baseRatchet.not_meeting + ' of ' + baseRatchet.total + ')');
  if (headRatchet.not_meeting < actual || headRatchet.total !== head.counts.routes) problems.push('docs/api-ratchet.json says ' + headRatchet.not_meeting + ' of ' + headRatchet.total + ' but the register says ' + actual + ' of ' + head.counts.routes + ': run node tools/api-ratchet.cjs --write');
  console.log('not meeting: ' + actual + ' of ' + head.counts.routes + ' (base ratchet ' + baseRatchet.not_meeting + ' of ' + baseRatchet.total + ')');
  return problems;
}

/** a code in the code must be a row of docs/ERROR-CODES.md; rows waiting for their sentence may not grow beyond the new codes */
function checkCodes(baseRatchet, headRatchet) {
  const codes = require('./error-codes.cjs');
  const { rows } = codes.readRows();
  const problems = codes.unregistered(rows).map((code) => 'code ' + code + ' is used in the code but not in docs/ERROR-CODES.md');
  const pending = codes.pendingCount(rows);
  const baseCodes = Number(baseRatchet.codes_total === undefined ? rows.length : baseRatchet.codes_total);
  const allowed = (baseRatchet.codes_pending === undefined ? pending : baseRatchet.codes_pending) + Math.max(0, rows.length - baseCodes);
  if (pending > allowed) problems.push('error codes waiting for their shopkeeper sentence rose to ' + pending + ' (allowed ' + allowed + ')');
  if (headRatchet.codes_pending < pending) problems.push('docs/api-ratchet.json codes_pending is below the table: run node tools/api-ratchet.cjs --write');
  console.log('error codes: ' + rows.length + ', waiting for a sentence: ' + pending);
  return problems;
}

/** --write: rewrite docs/api-ratchet.json from the head register (never raises the count) */
function writeRatchet(head) {
  const codes = require('./error-codes.cjs');
  const { rows } = codes.readRows();
  const previous = readJson(RATCHET_FILE, null);
  const notMeeting = head.counts.routes - head.counts.meets;
  if (previous && !flag('--seed') && notMeeting > previous.not_meeting + Math.max(0, head.counts.routes - previous.total)) throw new Error('refusing to raise the count of routes not meeting the standard');
  const next = { version: 1, stage: previous ? previous.stage : '1a', updated: today(), total: head.counts.routes, not_meeting: notMeeting, codes_total: rows.length, codes_pending: codes.pendingCount(rows), debt: previous ? previous.debt : [] };
  fs.writeFileSync(RATCHET_FILE, JSON.stringify(next, null, 1) + '\n');
  console.log('wrote docs/api-ratchet.json: ' + next.not_meeting + ' of ' + next.total + ' not meeting; ' + next.codes_pending + ' of ' + next.codes_total + ' codes waiting for a sentence');
}

/** run the ratchet: unpack the base, register both trees, compare routes, counts and codes, print and set the exit code */
function main() {
  const head = registerOf(ROOT);
  if (flag('--write')) return writeRatchet(head);
  const ref = valueOf('--base');
  if (!ref) throw new Error('--base <ref> is required (CI passes origin/main)');
  const base = checkoutBase(ref);
  let problems;
  try {
    const baseRegister = registerOf(base.dir);
    const headRatchet = readJson(RATCHET_FILE, null);
    const baseRatchet = readJson(path.join(base.dir, 'docs', 'api-ratchet.json'), headRatchet);
    problems = checkRoutes(baseRegister, head, headRatchet, flag('--hotfix')).concat(checkCounts(baseRatchet, head, headRatchet), checkCodes(baseRatchet, headRatchet));
  } finally {
    base.remove();
  }
  problems.forEach((sentence) => console.log('FAIL ' + sentence));
  console.log(problems.length ? problems.length + ' problem(s)' : 'api ratchet ok');
  process.exitCode = problems.length ? 1 : 0;
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
module.exports = { touchedRoutes, checkRoutes, debtProblems, isHeld, passesHold };
