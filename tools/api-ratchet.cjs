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
 *   node tools/api-ratchet.cjs --write --rebaseline   (only in the PR that switches the stage)                rewrite docs/api-ratchet.json from the head register (refuses to raise the count; --seed overrides for the first run)
 * RAW ERROR TEXT (Athi 23 Oct): rawErrorTextWrites() counts response writes (res.json / .send / .end) whose body holds an exception's own text (e.message, err.stack, String(e), `${e}`) outside safeErr()/problem(); logs are not response writes. The count may only go down (docs/api-ratchet.json raw_error_writes); a new one prints file:line.
 * Stage "1b" (ajv landed): a touched route of a brought-over file (HELD_FILES: routes/keys.js, routes/integrations.js, routes/books.js, routes/tax.js, routes/invoice.js, routes/ctp.js, routes/facts.js, routes/pricing.js, routes/repeat-supply.js, routes/work.js, routes/counters.js, src/routes/network.js, routes/network-design.js, routes/connections.js) must keep the seven core columns true and lose no hardening column it passed at the base (stage 2: the six hardening columns of S33-S38 are measured for every route and ratcheted by count); every other touched route is counted, not blocked. Stage "all" holds every route.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const RATCHET_FILE = path.join(ROOT, 'docs', 'api-ratchet.json');
/* the route files brought to the standard so far: a PR touching one of their routes must keep it at the seven core columns and lose no hardening column (S16 a); the list grows with each slice */
const HELD_FILES = ['routes/keys.js', 'routes/integrations.js', 'routes/books.js', 'routes/tax.js', 'routes/invoice.js', 'routes/ctp.js', 'routes/facts.js', 'routes/pricing.js', 'routes/repeat-supply.js', 'routes/work.js', 'routes/counters.js', 'src/routes/network.js', 'routes/network-design.js', 'routes/connections.js', 'routes/marketing.js', 'routes/offers.js', 'routes/combo-templates.js'];
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

const RAW_SCAN_DIRS = ['routes', 'lib'];
/* a write the caller sees: .json( .send( .end( .jsonp( on anything but a logger, console, fs or JSON */
const RESPONSE_WRITE = /([\w$.\])]*)\.(?:json|jsonp|send|end)\s*\(/g;
const NOT_A_RESPONSE = /(?:^|\.)(?:log|logger|console|fs|JSON|stream|process)$|\.(?:stdout|stderr)$/;
/* the safe answers, removed from a body before it is read */
const SAFE_CALL = /\b(?:safeErr|problem|known|publicMessage)\s*\(/g;
/* an exception's own text: <name>.message / .stack, String(<name>), `${<name>}`, '...' + <name>, JSON.stringify(<name>) */
const ERR_NAME = '(?:e|err|error|ex|exc|\\w+Err|\\w+Error|failure|cause)';
const EXCEPTION_TEXT = new RegExp(
  '\\b' + ERR_NAME + '\\s*\\??\\.\\s*(?:message|stack)\\b' +
  '|\\bString\\(\\s*' + ERR_NAME + '\\s*\\)' +
  '|\\$\\{\\s*' + ERR_NAME + '\\s*\\}' +
  '|\\+\\s*' + ERR_NAME + '\\s*[,)}]' +
  '|\\bJSON\\.stringify\\(\\s*' + ERR_NAME + '\\s*[,)]',
  'g'
);

/** index just past the quoted string that starts at `start` */
function stringEnd(text, start) {
  let at = start + 1;
  while (at < text.length && text[at] !== text[start]) at += text[at] === '\\' ? 2 : 1;
  return at;
}

/** index just past the bracket that closes the one at `open`; strings are skipped so a bracket inside one does not count */
function closeOf(text, open) {
  let depth = 0;
  for (let at = open; at < text.length; at++) {
    const char = text[at];
    if (char === '"' || char === "'" || char === '`') at = stringEnd(text, at);
    else if (char === '(') depth++;
    else if (char === ')' && --depth === 0) return at + 1;
  }
  return text.length;
}

/** blank out safeErr(...) / problem(...) calls (same length, newlines kept) so what they hold is not read as raw */
function blankSafeCalls(body) {
  let out = body;
  const safe = new RegExp(SAFE_CALL.source, 'g');
  for (let found = safe.exec(out); found; found = safe.exec(out)) {
    const end = closeOf(out, found.index + found[0].length - 1);
    out = out.slice(0, found.index) + out.slice(found.index, end).replace(/[^\n]/g, ' ') + out.slice(end);
  }
  return out;
}

/** the source with comment-only lines emptied (line numbers stay) */
const withoutCommentLines = (lines) => lines.map((line) => (/^\s*(?:\/\/|\*|\/\*)/.test(line) ? '' : line)).join('\n');

/** the lines of a source text where a response write carries an exception's text: [{line, text}] */
function rawErrorTextWrites(source) {
  const found = new Map();
  const lines = source.split('\n');
  const text = withoutCommentLines(lines);
  const write = new RegExp(RESPONSE_WRITE.source, 'g');
  for (let call = write.exec(text); call; call = write.exec(text)) {
    if (NOT_A_RESPONSE.test(call[1])) continue;
    const open = call.index + call[0].length - 1;
    const body = blankSafeCalls(text.slice(open, closeOf(text, open)));
    const exceptionText = new RegExp(EXCEPTION_TEXT.source, 'g');
    for (let hit = exceptionText.exec(body); hit; hit = exceptionText.exec(body)) {
      const line = text.slice(0, open + hit.index).split('\n').length;
      found.set(line, { line, text: lines[line - 1].trim() });
    }
  }
  return [...found.values()].sort((first, second) => first.line - second.line);
}

/** every raw-error write under routes/ and lib/ of a checkout: [{file, line, text}] */
function rawErrorWritesOf(root) {
  const all = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      if (!/\.(?:js|cjs|mjs)$/.test(entry.name)) return;
      const file = path.relative(root, full).split(path.sep).join('/');
      rawErrorTextWrites(fs.readFileSync(full, 'utf8')).forEach((match) => all.push({ file, line: match.line, text: match.text }));
    });
  };
  RAW_SCAN_DIRS.forEach((dir) => walk(path.join(root, dir)));
  return all;
}

/** the raw-error count may only go down; a write whose text the base did not have is printed with file:line */
function checkRawErrors(baseWrites, headWrites, baseRatchet, headRatchet) {
  const allowed = baseRatchet.raw_error_writes === undefined ? baseWrites.length : baseRatchet.raw_error_writes;
  const problems = [];
  if (headWrites.length > allowed) {
    const seen = new Map();
    const keyOf = (write) => write.file + '|' + write.text;
    baseWrites.forEach((write) => seen.set(keyOf(write), (seen.get(keyOf(write)) || 0) + 1));
    headWrites.forEach((write) => {
      if (seen.get(keyOf(write)) > 0) return seen.set(keyOf(write), seen.get(keyOf(write)) - 1);
      problems.push('raw error text sent to the caller at ' + write.file + ':' + write.line + ' (' + write.text.slice(0, 90) + '): answer with safeErr(err) or problem(), never the exception text');
    });
    problems.unshift('raw error text in responses rose to ' + headWrites.length + ' (allowed ' + allowed + ')');
  }
  if (headRatchet.raw_error_writes === undefined || headRatchet.raw_error_writes < headWrites.length) problems.push('docs/api-ratchet.json raw_error_writes is ' + headRatchet.raw_error_writes + ' but the code has ' + headWrites.length + ': run node tools/api-ratchet.cjs --write');
  console.log('raw error text in responses: ' + headWrites.length + ' (base ratchet ' + allowed + ')');
  return problems;
}

/** touched = a route the base does not have, or whose hash differs */
function touchedRoutes(baseRegister, headRegister) {
  const before = new Map(baseRegister.routes.map((row) => [row.key, row.hash]));
  return headRegister.routes.filter((row) => !before.has(row.key) || before.get(row.key) !== row.hash);
}

const meets = (row) => row.status === 'meets standard';

/** routes held to the standard: the brought-over files, and any route signed off in the base register, until stage 'all' (every route, once the sweep is done) */
const isHeld = (row, stage, baseRow) => stage === 'all' || HELD_FILES.includes(row.file) || !!(baseRow && baseRow.human && baseRow.human.signed_off_by_date);
const { HARDENING_COLUMNS } = require('./api-register.cjs');
/** the columns a held route must have: all thirteen for a route new to the base; else the seven core ones plus every hardening column it already passed at the base (a hardening column is never lost; the rest are ratcheted by count in checkColumns) */
const heldColumns = (row, baseRow) => Object.keys(row.columns).filter((name) => !baseRow || !HARDENING_COLUMNS.includes(name) || baseRow.columns[name] === true);
/** a held route passes on those columns; the cb-api sign-off is the reviewer's, dated in the register, and is not the builder's to give (consult-map rule 1) */
const passesHold = (row, baseRow) => heldColumns(row, baseRow).every((name) => row.columns[name] === true);

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

/** a route signed off in the base that is gone from the head while a new route appears in the same file with the same method: a rename would escape the hold, so it is named */
function renamedSigned(base, head) {
  const headKeys = new Set(head.routes.map((row) => row.key));
  const baseKeys = new Set(base.routes.map((row) => row.key));
  const added = head.routes.filter((row) => !baseKeys.has(row.key));
  return base.routes.filter((row) => row.human && row.human.signed_off_by_date && !headKeys.has(row.key))
    .filter((gone) => added.some((row) => row.file === gone.file && row.method === gone.method))
    .map((gone) => gone.key + ' was signed off and is gone while ' + added.filter((row) => row.file === gone.file && row.method === gone.method).map((row) => row.key).join(', ') + ' is new in ' + gone.file + ': a renamed route keeps its hold, so sign the new key (cb-api, non-builder) before this lands');
}

/** the touched routes held to the standard at this stage; returns the sentences that fail the PR */
function checkRoutes(base, head, ratchet, hotfix) {
  const stage = ratchet.stage || '1a';
  const debt = ratchet.debt || [];
  const touched = touchedRoutes(base, head);
  const baseRows = new Map(base.routes.map((row) => [row.key, row]));
  const held = touched.filter((row) => isHeld(row, stage, baseRows.get(row.key)));
  const failing = held.filter((row) => !passesHold(row, baseRows.get(row.key)));
  const owed = failing.filter((row) => !debt.some((entry) => entry.route === row.key && entry.expires >= today()));
  const problems = hotfix ? [] : owed.map((row) => row.key + ' was added or changed and does not meet the standard (' + heldColumns(row, baseRows.get(row.key)).filter((name) => row.columns[name] !== true).join(', ') + ')');
  const counted = touched.filter((row) => !isHeld(row, stage, baseRows.get(row.key)) && !meets(row));
  console.log(touched.length + ' routes touched against the base: ' + held.length + ' held, ' + counted.length + ' counted only (stage ' + stage + ')');
  return problems.concat(renamedSigned(base, head), debtProblems(debt, hotfix, failing));
}

/* the stages in order; a stage only moves forward */
const STAGES = ['1a', '1b', '2', 'all'];

/** the STAGE constant in a checkout's own tools/api-register.cjs (the base register is built by the HEAD's tool, so its .stage is the head's) */
function stageOfCode(checkout) {
  const file = path.join(checkout, 'tools', 'api-register.cjs');
  const found = fs.existsSync(file) && /const STAGE = '([^']+)'/.exec(fs.readFileSync(file, 'utf8'));
  return found ? found[1] : null;
}

/** the stage switch: decided by the STAGE constant in the base code and the head code (tools/api-register.cjs), never by the ratchet json the PR writes; forward only */
function stageSwitch(baseStage, head, headRatchet) {
  const problems = [];
  const from = baseStage || head.stage;
  if (headRatchet.stage !== head.stage) problems.push('docs/api-ratchet.json says stage ' + headRatchet.stage + ' but the register code says ' + head.stage + ': the stage is set in tools/api-register.cjs STAGE');
  if (STAGES.indexOf(head.stage) < STAGES.indexOf(from)) problems.push('the stage moved back from ' + from + ' to ' + head.stage + ': a stage only moves forward');
  return { switched: from !== head.stage && STAGES.indexOf(head.stage) > STAGES.indexOf(from), from, problems };
}

/** the count of routes not meeting the standard may only go down, adjusted for routes added or removed (S16 b) */
function checkCounts(baseRatchet, head, headRatchet, baseStage) {
  const actual = head.counts.routes - head.counts.meets;
  /* a stage switch re-measures honestly (API-3: stage 2 asks thirteen columns, not seven): the one PR that changes the register's STAGE may raise the count, nobody else */
  const stage = stageSwitch(baseStage, head, headRatchet);
  const rebaselined = stage.switched;
  const allowed = rebaselined ? head.counts.routes : baseRatchet.not_meeting + Math.max(0, head.counts.routes - baseRatchet.total);
  if (rebaselined) console.log('stage switch ' + stage.from + ' -> ' + head.stage + ': the count is re-measured, not grandfathered');
  const problems = stage.problems.slice();
  if (actual > allowed) problems.push('routes not meeting the standard rose to ' + actual + ' (allowed ' + allowed + ' from the base ratchet of ' + baseRatchet.not_meeting + ' of ' + baseRatchet.total + ')');
  if (headRatchet.not_meeting < actual || headRatchet.total !== head.counts.routes) problems.push('docs/api-ratchet.json says ' + headRatchet.not_meeting + ' of ' + headRatchet.total + ' but the register says ' + actual + ' of ' + head.counts.routes + ': run node tools/api-ratchet.cjs --write');
  console.log('not meeting: ' + actual + ' of ' + head.counts.routes + ' (base ratchet ' + baseRatchet.not_meeting + ' of ' + baseRatchet.total + ')');
  return problems;
}

/** per hardening column, the routes failing it may only go down (a new route may add its own); the first run with no base figure just records */
function checkColumns(baseRatchet, head, headRatchet) {
  const problems = [];
  const added = Math.max(0, head.counts.routes - baseRatchet.total);
  Object.keys(head.counts.columns || {}).forEach((name) => {
    const actual = head.counts.columns[name].failing;
    const before = baseRatchet.columns_failing && baseRatchet.columns_failing[name];
    if (before !== undefined && actual > before + added) problems.push('routes failing ' + name + ' rose to ' + actual + ' (allowed ' + (before + added) + ')');
    if (!headRatchet.columns_failing || headRatchet.columns_failing[name] < actual) problems.push('docs/api-ratchet.json columns_failing.' + name + ' is below the register: run node tools/api-ratchet.cjs --write');
  });
  console.log('failing per column: ' + Object.keys(head.counts.columns || {}).map((name) => name + ' ' + head.counts.columns[name].failing + '/' + head.counts.columns[name].applies).join(' · '));
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

/** API-12: the count of routes with no `@does` line may only go down. ADVISORY for now (HARD_FAIL_DOES false): it prints, it never fails CI; flip the constant once the areas are filled */
const HARD_FAIL_DOES = false;
function checkDoes(baseRatchet, head, headRatchet) {
  const now = head.counts.no_does;
  if (now === undefined) return [];
  const allowed = baseRatchet.routes_without_does === undefined ? now : baseRatchet.routes_without_does + Math.max(0, head.counts.routes - baseRatchet.total);
  const problems = [];
  if (now > allowed) problems.push('routes with no @does rose to ' + now + ' (allowed ' + allowed + '): write the `// @does input -> process -> output` line above the route');
  if (headRatchet.routes_without_does === undefined || headRatchet.routes_without_does < now) problems.push('docs/api-ratchet.json routes_without_does is ' + headRatchet.routes_without_does + ' but the register has ' + now + ': run node tools/api-ratchet.cjs --write');
  console.log('routes with no @does: ' + now + ' (base ratchet ' + allowed + ')' + (problems.length && !HARD_FAIL_DOES ? ' - advisory, not failing yet' : ''));
  return HARD_FAIL_DOES ? problems : [];
}

/** --write never records a worse figure than the committed one: raw error text, routes failing a hardening column, routes not meeting (only --rebaseline, in the stage-switch PR, may raise the last two) */
function refuseRises(previous, now) {
  if (!previous) return;
  if (previous.raw_error_writes !== undefined && now.rawNow > previous.raw_error_writes) throw new Error('refusing to raise the raw error text count (' + now.rawNow + ' against ' + previous.raw_error_writes + ')');
  if (flag('--rebaseline')) return;
  const before = previous.columns_failing || {};
  /* a new route may add its own, as checkColumns allows in CI (one rule on both sides; before 31 Oct --write refused what CI accepted) */
  const added = Math.max(0, now.routes - previous.total);
  Object.keys(now.columnsFailing).filter((name) => before[name] !== undefined && now.columnsFailing[name] > before[name] + added).forEach((name) => { throw new Error('refusing to raise the routes failing ' + name); });
  if (!flag('--seed') && now.notMeeting > previous.not_meeting + added) throw new Error('refusing to raise the count of routes not meeting the standard');
}

/** --write: rewrite docs/api-ratchet.json from the head register (never raises the count) */
function writeRatchet(head) {
  const codes = require('./error-codes.cjs');
  const { rows } = codes.readRows();
  const previous = readJson(RATCHET_FILE, null);
  const notMeeting = head.counts.routes - head.counts.meets;
  const columnsFailing = Object.fromEntries(Object.keys(head.counts.columns || {}).map((name) => [name, head.counts.columns[name].failing]));
  const rawNow = rawErrorWritesOf(ROOT).length;
  refuseRises(previous, { notMeeting, rawNow, columnsFailing, routes: head.counts.routes });
  if (previous && previous.routes_without_does !== undefined && head.counts.no_does > previous.routes_without_does + Math.max(0, head.counts.routes - previous.total)) throw new Error('refusing to raise the count of routes with no @does');
  const next = { version: 1, stage: head.stage || (previous ? previous.stage : '1a'), updated: today(), total: head.counts.routes, not_meeting: notMeeting, codes_total: rows.length, codes_pending: codes.pendingCount(rows), raw_error_writes: rawNow, routes_without_does: head.counts.no_does, columns_failing: columnsFailing, debt: previous ? previous.debt : [] };
  fs.writeFileSync(RATCHET_FILE, JSON.stringify(next, null, 1) + '\n');
  console.log('wrote docs/api-ratchet.json: ' + next.not_meeting + ' of ' + next.total + ' not meeting; ' + next.codes_pending + ' of ' + next.codes_total + ' codes waiting for a sentence; ' + next.raw_error_writes + ' response writes carry raw error text');
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
    problems = checkRoutes(baseRegister, head, headRatchet, flag('--hotfix')).concat(checkCounts(baseRatchet, head, headRatchet, stageOfCode(base.dir)), checkColumns(baseRatchet, head, headRatchet), checkCodes(baseRatchet, headRatchet), checkRawErrors(rawErrorWritesOf(base.dir), rawErrorWritesOf(ROOT), baseRatchet, headRatchet), checkDoes(baseRatchet, head, headRatchet));
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
module.exports = { checkDoes, stageOfCode, stageSwitch, renamedSigned, checkCounts, rawErrorTextWrites, rawErrorWritesOf, checkRawErrors, touchedRoutes, checkRoutes, debtProblems, isHeld, passesHold };
