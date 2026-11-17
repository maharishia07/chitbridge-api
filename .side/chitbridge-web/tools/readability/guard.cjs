/* tools/readability/guard.cjs — the §6 rules over what a change touched: before → after, pass or fail (READ-GUARD, 2026-10-15).
 *
 * OWNS      the judgement: which functions a diff touched, each rule's findings (hard limits · new cryptic name · new empty catch ·
 *           module header · CARD line · trace row · §7 minimums · ratchet score), the before → after numbers, the checklist markdown.
 *           A comment-only / data-cbsid-only diff (noise.cjs) downgrades trace-row + test-minimums from fail to warn (module debt).
 * CALLED BY tools/readability.cjs (--changed), e2e/readability-guard.cjs (the rule fixtures), the api's tests/readability-guard.test.cjs.
 * FLOW      changed.touched ──▶ for each own-code file: measure(head) + measure(base) ──▶ touchedFunctions ──▶ rules ──▶ findings
 *           ──▶ numbers (Pass 1 · 2 · 3) ──▶ markdown checklist · exit code   (moves.find first: an exact move is carried, not judged as new)
 * CARD      qa/readability-guard
 *
 * The one judgement the brief asked for (DISCIPLINES §6, 15 Oct): only CHANGED code is judged, so the backlog blocks nobody —
 * a legacy function over a hard limit fails only when it is new, crossed the limit, or got worse in this change.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const measure = require('./measure.cjs');
const ratchet = require('./ratchet.cjs');
const changed = require('./changed.cjs');
const moves = require('./moves.cjs');
const touch = require('./touch.cjs');
const headers = require('./headers.cjs');
const noise = require('./noise.cjs');

const LIMITS = ratchet.LIMITS;
/** §7 minimums warn for the first week (brief: "warn first week, then fail") */
const MINIMUMS_FAIL_FROM = '2026-10-22';

// ── touched functions and their base twins
/** lines of distance that one line of size difference is worth when pairing twins */
const SIZE_WEIGHT = 4;
const functionKey = (fn) => (fn.name || '') + '(' + fn.params.join(',') + ')';

const groupBy = (list, keyOf) => {
  const groups = new Map();
  for (const item of list) {
    const key = keyOf(item);
    if (key) (groups.get(key) || groups.set(key, []).get(key)).push(item);
  }
  return groups;
};

/** head function → the same function in the base file: by name + params, the NEAREST line among twins (a route file holds many
 *  `async (req, res) =>` handlers — the first untaken one paired a 120-line handler with a 30-line one, INT7b), else by name alone.
 *  A route handler pairs first with the same 'METHOD path' in the base (lines shift when a file grows, the route does not);
 *  a function with no route, or a route the base lacks, pairs exactly as before. */
function matchBase(headFns, baseFns) {
  const byRoute = groupBy(baseFns, (fn) => fn.route && fn.route + ' ' + functionKey(fn)),
    byKey = groupBy(baseFns, functionKey),
    byName = groupBy(baseFns, (fn) => fn.name);
  const pairs = new Map(),
    taken = new Set();
  /** lowest cost: lines apart + SIZE_WEIGHT per line of size difference (after a big shift a 32-line anonymous callback must not pair
   *  with a 7-line twin that merely sits nearer: the same function has about the same size) */
  const costOf = (fn, twin) => Math.abs(twin.line - fn.line) + SIZE_WEIGHT * Math.abs(twin.len - fn.len);
  const nearest = (fn, twins) =>
    twins.filter((candidate) => !taken.has(candidate)).sort((left, right) => costOf(fn, left) - costOf(fn, right))[0];
  const take = (fn, twins) => {
    const twin = nearest(fn, twins || []);
    if (twin) {
      pairs.set(fn, twin);
      taken.add(twin);
    }
  };
  for (const fn of headFns) if (fn.route) take(fn, byRoute.get(fn.route + ' ' + functionKey(fn)));
  for (const fn of headFns) if (!pairs.has(fn)) take(fn, byKey.get(functionKey(fn)));
  for (const fn of headFns) if (!pairs.has(fn) && fn.name) take(fn, byName.get(fn.name));
  return pairs;
}

const overlaps = (fn, ranges) => ranges.some(([start, end]) => fn.line <= end && fn.endLine >= start);
const linesOf = (ranges) => {
  const set = new Set();
  for (const [start, end] of ranges) for (let i = start; i <= end; i++) set.add(i);
  return set;
};

// ── the rules
const overHard = (fn) => fn.len > LIMITS.linesHard || fn.complexity > LIMITS.complexityHard || fn.depth > LIMITS.depthHard;
const measures = (fn) => `${fn.len}L c${fn.complexity} depth${fn.depth}`;
const isWorse = (before, after) => after.len > before.len || after.complexity > before.complexity || after.depth > before.depth;

/** a touched function over a hard limit: new / crossed / grew → fail; legacy and not worse → warn */
function ruleHardLimits(file, fn, base) {
  if (!overHard(fn)) return null;
  const where = `${file}:${fn.line} ${fn.name || '(anon)'} ${measures(fn)} — limits ${LIMITS.linesHard}L c${LIMITS.complexityHard} depth${LIMITS.depthHard}`;
  if (!base) return { level: 'fail', rule: 'hard-limit', text: 'NEW function over a hard limit: ' + where };
  if (!overHard(base)) return { level: 'fail', rule: 'hard-limit', text: 'crossed a hard limit (was ' + measures(base) + '): ' + where };
  if (isWorse(base, fn))
    return {
      level: 'fail',
      rule: 'hard-limit',
      text: 'legacy function over a hard limit got WORSE (was ' + measures(base) + '): ' + where + ' — split a step out (§6 Pass 1)'
    };
  return { level: 'warn', rule: 'hard-limit', text: 'legacy function still over a hard limit, not worse: ' + where + ' — shrink it when you can' };
}

const countBy = (declarations) =>
  declarations.reduce((counts, declaration) => {
    counts[declaration.name] = (counts[declaration.name] || 0) + 1;
    return counts;
  }, {});

/** a cryptic name whose declaration count ROSE in this file (so a rename ct → counter passes, a moved `r` passes, `const q =` fails) */
function ruleNewCryptic(file, head, base, addedLines) {
  const after = countBy(head.cryptic),
    before = countBy(base ? base.cryptic : []);
  const findings = [];
  for (const name of Object.keys(after)) {
    if (after[name] <= (before[name] || 0)) continue;
    const sites = head.cryptic.filter((declaration) => declaration.name === name);
    const added = sites.filter((declaration) => addedLines.has(declaration.line));
    const where = (added.length ? added : sites)
      .map((declaration) => file + ':' + declaration.line)
      .slice(0, 4)
      .join(' ');
    findings.push({
      level: 'fail',
      rule: 'cryptic-name',
      text: `new cryptic name \`${name}\` (${before[name] || 0} → ${after[name]} declarations): ${where} — say what it holds (§6 Pass 2: ≥ 4 characters, or short only in a scope of 10 lines or fewer)`
    });
  }
  return findings;
}

/** an empty catch that was not there before */
function ruleNewEmptyCatch(file, head, base, addedLines) {
  const before = base ? base.emptyCatches.length : 0,
    after = head.emptyCatches.length;
  if (after <= before) return null;
  const added = head.emptyCatches.filter((site) => addedLines.has(site.line));
  const where = (added.length ? added : head.emptyCatches)
    .map((site) => file + ':' + site.line + ' ' + site.form)
    .slice(0, 4)
    .join(' ');
  return {
    level: 'fail',
    rule: 'empty-catch',
    text: `new empty catch (${before} → ${after}): ${where} — log it (cbQuiet / lib/logger) and say what the person sees instead`
  };
}

/** the module header must carry OWNS, CALLED BY and a FLOW / INIT line; names what is missing */
function ruleHeader(file, head) {
  const header = head.header,
    missing = [];
  if (!header.owns) missing.push('owns');
  if (!header.callers) missing.push('called by');
  if (!header.flow) missing.push('FLOW / INIT line');
  if (!missing.length) return null;
  return {
    level: 'fail',
    rule: 'module-header',
    text: `${file}: module header lacks ${missing.join(' · ')}` + (header.has ? '' : ' (no header comment at all)') + ' — §6 Pass 3'
  };
}

function ruleCard(file, head) {
  if (head.header.card) return null;
  return {
    level: 'fail',
    rule: 'card-line',
    text: `${file}: no \`// CARD <area>/<card-id>\` line in the module header — §6 Pass 3 (the TRACE matrix is generated from it)`
  };
}

/** the module's row in trace.json must name at least one test — a unit test or a walk (§6 Pass 3: "a test reaches the function (unit or walk)") */
function ruleTraceRow(file, trace) {
  if (!trace || !trace.modules)
    return { level: 'warn', rule: 'trace-row', text: `${file}: no trace.json to check a test row against (run node tools/graph/trace.cjs)` };
  const row = trace.modules[file];
  const reached = row ? (row.tests || []).length + (row.walks || []).length : 0;
  if (reached) return null;
  return {
    level: 'fail',
    rule: 'trace-row',
    text: `${file}: no test reaches this module in trace.json (KG1 tested-by) — add a unit test or a walk, then node tools/graph/trace.cjs`
  };
}

/** the header TEMPLATE (PM/HEADER-TEMPLATE.md) for a NEW file only: a warning until headers.TEMPLATE_STRICT_FROM, then a failure; old files and the ratchet score are never touched by it */
function ruleTemplate(entry, repo, today) {
  if (entry.status !== 'added' || entry.renamed) return null; /* a renamed old file is still old (HEADER-TEMPLATE: old files are never judged) */
  const kind = headers.kindOf(repo, entry.file);
  const lacks = headers.missing(kind, entry.head.header.template);
  if (!lacks.length) return null;
  const level = today >= headers.TEMPLATE_STRICT_FROM ? 'fail' : 'warn';
  return {
    level,
    rule: 'header-template',
    text:
      `${entry.file} (new ${kind}): header template lacks ${lacks.join(' · ')} — PM/HEADER-TEMPLATE.md` +
      (level === 'warn' ? ` — a warning until ${headers.TEMPLATE_STRICT_FROM}` : '')
  };
}

/** the module's §7 layer minimums, from its trace row: a warning until MINIMUMS_FAIL_FROM, then a failure */
function ruleMinimums(file, trace, today) {
  const row = trace && trace.modules ? trace.modules[file] : null;
  const missing = (row && row.minimums && row.minimums.missing) || [];
  if (!missing.length) return null;
  const level = today >= MINIMUMS_FAIL_FROM ? 'fail' : 'warn';
  return {
    level,
    rule: 'test-minimums',
    text:
      `${file} (${row.layer}): §7 minimums not evidenced by its tests: ${missing.join(' · ')}` +
      (level === 'warn' ? ` — a warning until ${MINIMUMS_FAIL_FROM}` : '')
  };
}

/** a test-layer finding on a file whose diff is comment-only or data-cbsid-only stays visible as module debt (warn), it does not fail the change */
function asModuleDebt(finding, noiseOnly) {
  if (!finding || finding.level !== 'fail' || !noiseOnly) return finding;
  return { ...finding, level: 'warn', text: finding.text + ' — MODULE DEBT: this diff changes only comments / data-cbsid, so it is a warning, not a failure' };
}

/** the reference a file is held to: its ratchet row, or the base's own score when that is higher (a row written before other rounds landed) */
const higherOf = (row, floor) => (floor && (!row || floor.score > row.score) ? floor : row);
/** the file's score may not rise above its ratchet row (a file with no row is new: it must score 0) — nor above the BASE the change
 *  started from: a row written before other rounds landed cannot blame this change for their score (INT7b: assign-chit row 5, base 13) */
function ruleRatchet(file, head, base, rows, carried) {
  if (!rows)
    return { level: 'warn', rule: 'ratchet', text: `${file}: no ${ratchet.RATCHET_FILE} in this repo yet (write it: --write)`, score: ratchet.score(head) };
  const now = ratchet.score(head),
    row = rows[file] || null,
    floor = base ? ratchet.score(base) : null;
  const held = higherOf(row, floor);
  const reference = moves.plus(held, carried);
  const allowed = reference ? reference.score : 0;
  if (now.score > allowed) {
    const reason = ratchet.risen(reference, now).join(', ');
    return {
      level: 'fail',
      rule: 'ratchet',
      text: `${file}: readability score ${allowed} → ${now.score} is worse than the ratchet (${reason || 'no row: new code must score 0'})`,
      score: now
    };
  }
  const rowScore = row ? moves.plus(row, carried).score : null;
  if (row && now.score < rowScore)
    return { level: 'info', rule: 'ratchet', text: `${file}: score ${rowScore} → ${now.score} — tighten the ratchet (--write)`, score: now };
  return { level: 'ok', rule: 'ratchet', score: now };
}

// ── one file
/** the functions this change touched; a moved one stands for its whole range (what is nested inside travels with it) */
function touchedOf(entry, headFns, view) {
  const inMoved = (fn) => view.into.some(([start, end]) => fn.line >= start && fn.endLine <= end);
  const touched = entry.status === 'added' ? headFns : headFns.filter((fn) => overlaps(fn, entry.ranges));
  return touched.filter((fn) => !inMoved(fn) || view.moved.includes(fn));
}

/** judge one touched file: its touched functions, every rule, the numbers behind the checklist */
function judgeFile(entry, context) {
  const view = context.moved.byFile.get(entry.file) || moves.NO_MOVES;
  const head = moves.without(entry.head, view.into),
    base = moves.without(entry.base, view.out);
  const addedLines = entry.status === 'added' ? new Set(head.functions.map((fn) => fn.line)) : linesOf(entry.ranges);
  const headFns = head.functions.filter((fn) => !fn.wrapper),
    baseFns = base ? base.functions.filter((fn) => !fn.wrapper) : [];
  const touchedFns = touchedOf(entry, headFns, view);
  const pairs = matchBase(touchedFns.filter((fn) => !view.moved.includes(fn)), baseFns);
  view.carriedMoves.forEach((move) => pairs.set(move.fn, move.from.fn));
  const noiseOnly = entry.status === 'modified' && noise.sameCode(entry.file, entry.headText, entry.baseText);
  const scored = ruleRatchet(entry.file, entry.head, entry.base, context.ratchetRows, view.carried);
  const findings = [
    ...touchedFns.map((fn) => ruleHardLimits(entry.file, fn, pairs.get(fn) || null)),
    ...ruleNewCryptic(entry.file, head, base, addedLines),
    ruleNewEmptyCatch(entry.file, head, base, addedLines),
    ruleHeader(entry.file, head),
    ruleCard(entry.file, head),
    ruleTemplate(entry, context.repo, context.today),
    asModuleDebt(ruleTraceRow(entry.file, context.trace), noiseOnly),
    asModuleDebt(ruleMinimums(entry.file, context.trace, context.today), noiseOnly),
    scored.level === 'ok' ? null : scored,
    touch.ruleTouch(entry.file, entry.base ? ratchet.score(entry.base) : null, scored.score, context.touchMode)
  ].filter(Boolean);
  return {
    file: entry.file,
    status: entry.status,
    touched: touchedFns.map((fn) => ({ fn, base: pairs.get(fn) || null })),
    findings,
    score: scored.score,
    touchVerdict: touch.verdictOf(entry.base ? ratchet.score(entry.base) : null, scored.score),
    carried: view.carried,
    moved: view.carriedMoves,
    numbers: numbersOf(touchedFns, pairs, head, base)
  };
}

/** the before → after numbers of one file (Pass 1 · 2 · 3) */
function numbersOf(touchedFns, pairs, head, base) {
  const befores = touchedFns.map((fn) => pairs.get(fn)).filter(Boolean);
  const named = (list) => list.filter((fn) => fn.name && fn.len > LIMITS.whatLineFrom);
  const sum = (list, key) => list.reduce((total, fn) => total + fn[key], 0);
  return {
    linesBefore: sum(befores, 'len'),
    linesAfter: sum(touchedFns, 'len'),
    complexityBefore: sum(befores, 'complexity'),
    complexityAfter: sum(touchedFns, 'complexity'),
    crypticBefore: base ? base.cryptic.length : 0,
    crypticAfter: head.cryptic.length,
    whatLineBefore: named(befores).filter((fn) => fn.hasAbove).length,
    whatLineOfBefore: named(befores).length,
    whatLineAfter: named(touchedFns).filter((fn) => fn.hasAbove).length,
    whatLineOfAfter: named(touchedFns).length,
    emptyCatchBefore: base ? base.emptyCatches.length : 0,
    emptyCatchAfter: head.emptyCatches.length,
    headerBefore: base ? ratchet.headerComplete(base.header) : false,
    headerAfter: ratchet.headerComplete(head.header),
    cardAfter: !!head.header.card
  };
}

// ── the run
/** a touched own-code file measured at head and at the base */
function entryOf(root, baseSha, touched, text, renamedPaths) {
  const baseText = touched.status === 'added' ? null : changed.baseText(root, baseSha, touched.file);
  return {
    file: touched.file,
    status: baseText == null ? 'added' : touched.status,
    ranges: touched.ranges,
    renamed: renamedPaths.has(touched.file),
    headText: text,
    baseText,
    head: measure.factsFromText(touched.file, text),
    base: baseText == null ? null : measure.factsFromText(touched.file, baseText)
  };
}

/** a deleted own-code file measured at the base: its functions may have moved on to another file */
function removedFile(repo, root, baseSha, file) {
  const goneText = changed.baseText(root, baseSha, file);
  if (goneText == null || !measure.inScope(repo, file, goneText)) return null;
  return { file, base: measure.factsFromText(file, goneText) };
}

/** everything the guard judges for one repo: the touched own-code files measured before and after */
function gather(options) {
  const { repo, root, baseRef } = options;
  const base = changed.mergeBase(root, baseRef);
  if (!base.sha) return { error: base.why };
  const diff = changed.touched(root, base.sha);
  if (!diff.files) return { error: diff.why };
  const entries = [],
    removed = [],
    skipped = [];
  const renamedPaths = changed.renamedTo(root, base.sha);
  for (const touched of diff.files) {
    if (touched.status === 'deleted') {
      const gone = removedFile(repo, root, base.sha, touched.file);
      if (gone) removed.push(gone);
      continue;
    }
    const absPath = path.join(root, touched.file);
    if (!fs.existsSync(absPath)) continue;
    const text = fs.readFileSync(absPath, 'utf8');
    if (!measure.inScope(repo, touched.file, text)) skipped.push(touched.file);
    else entries.push(entryOf(root, base.sha, touched, text, renamedPaths));
  }
  return { baseSha: base.sha, entries, removed, skipped };
}

/** the guard's one entry: gather, judge every file, fold the findings */
function judgeChange(options) {
  const gathered = gather(options);
  if (gathered.error) return { error: gathered.error };
  const context = {
    repo: options.repo,
    trace: options.trace || null,
    today: options.today || new Date().toISOString().slice(0, 10),
    ratchetRows: options.ratchetRows === undefined ? ratchet.read(options.root) : options.ratchetRows,
    touchMode: touch.modeFor(options.today || new Date().toISOString().slice(0, 10), options.touch),
    moved: moves.find(gathered.entries, gathered.removed)
  };
  const files = gathered.entries.map((entry) => judgeFile(entry, context));
  const findings = files.flatMap((file) => file.findings);
  const parseFails = gathered.entries
    .filter((entry) => entry.head.parseFail)
    .map((entry) => ({ level: 'fail', rule: 'parse', text: entry.file + ': does not parse — ' + entry.head.parseFail }));
  findings.push(...parseFails);
  return {
    repo: options.repo,
    baseRef: options.baseRef,
    baseSha: gathered.baseSha,
    files,
    moved: context.moved.moves,
    skipped: gathered.skipped,
    findings,
    failed: findings.some((finding) => finding.level === 'fail'),
    warnings: findings.filter((finding) => finding.level === 'warn').length,
    today: context.today,
    touch: touch.summary(files, context.touchMode),
    hadRatchet: !!context.ratchetRows,
    hadTrace: !!context.trace
  };
}

// ── the words
const NUMBER_KEYS = [
  'linesBefore',
  'linesAfter',
  'complexityBefore',
  'complexityAfter',
  'crypticBefore',
  'crypticAfter',
  'whatLineBefore',
  'whatLineOfBefore',
  'whatLineAfter',
  'whatLineOfAfter',
  'emptyCatchBefore',
  'emptyCatchAfter',
  'headerBefore',
  'headerAfter',
  'cardAfter'
];
const arrow = (before, after) => `${before} → ${after}`;
const plural = (count, word) => count + ' ' + word + (count === 1 ? '' : 's');

/** the numbers of every judged file added up (a boolean counts as 0 / 1) */
function totals(files) {
  const total = {};
  for (const key of NUMBER_KEYS) total[key] = files.reduce((sum, file) => sum + Number(file.numbers[key]), 0);
  total.files = files.length;
  total.touched = files.reduce((sum, file) => sum + file.touched.length, 0);
  total.tested = files.filter((file) => !file.findings.some((finding) => finding.rule === 'trace-row')).length;
  total.failures = files.reduce((sum, file) => sum + file.findings.filter((finding) => finding.level === 'fail').length, 0);
  return total;
}

/** the §6 checklist with the numbers filled — paste it into the PR body */
function markdown(result) {
  const sum = totals(result.files);
  const lines = [
    `## §6 checklist · \`readability --changed --ratchet\` (${result.repo} · base ${result.baseRef} @ ${changed.shortSha(result.baseSha)} · ${plural(sum.files, 'file')} · ${plural(sum.touched, 'function')} touched)`,
    '- [ ] Pass 0 · seams: `<word>` → reused/widened `<name>` (or "nothing exists")',
    `- [x] Pass 1 · shrink: lines ${arrow(sum.linesBefore, sum.linesAfter)} · complexity ${arrow(sum.complexityBefore, sum.complexityAfter)} · DB trips n/a`,
    `- [x] Pass 2 · humanify: cryptic names ${arrow(sum.crypticBefore, sum.crypticAfter)} · functions with a what-line ${sum.whatLineBefore}/${sum.whatLineOfBefore} → ${sum.whatLineAfter}/${sum.whatLineOfAfter} · empty catches ${arrow(sum.emptyCatchBefore, sum.emptyCatchAfter)}`,
    `- [x] Pass 3 · structure: module header ${sum.headerBefore}/${sum.files} → ${sum.headerAfter}/${sum.files} · CARD line ${sum.cardAfter}/${sum.files} · TRACE row: tests ${sum.tested}/${sum.files}${result.hadTrace ? '' : ' (no trace.json)'} · spec \`<doc>\` · design \`<doc>\``,
    ...(result.moved.length ? [`- moved: ${plural(result.moved.length, 'function')} (exact body match) carried with their old score, not new code`] : []),
    touch.line(result.touch),
    `- [${result.failed ? ' ' : 'x'}] Guard green: \`readability --changed --ratchet\` — ${plural(sum.failures, 'failure')} · ${plural(result.warnings, 'warning')}`
  ];
  return lines.join('\n');
}

/** the findings as lines a person can act on, worst first */
function report(result) {
  const order = { fail: 0, warn: 1, info: 2 };
  const lines = [];
  for (const file of result.files)
    lines.push(`  ${file.file}  ${file.status} · ${file.touched.length} function(s) touched · score ${file.score ? file.score.score : '?'}`);
  if (result.moved.length) {
    lines.push(`  moved: ${plural(result.moved.length, 'function')} (exact body match) — carried with their old score, not judged as new code`);
    for (const move of result.moved)
      lines.push(`    ${move.fn.name || '(anon)'} ${measures(move.fn)}  ${move.from.file}:${move.from.fn.line} → ${move.file}:${move.fn.line}`);
  }
  if (result.skipped.length) lines.push('  not judged (tests, docs, vendored, out of scope): ' + result.skipped.join(' · '));
  for (const finding of result.findings.slice().sort((left, right) => order[left.level] - order[right.level]))
    lines.push(`  ${finding.level === 'fail' ? '✗' : finding.level === 'warn' ? '⚠' : '·'} [${finding.rule}] ${finding.text}`);
  return lines.join('\n');
}

module.exports = { judgeChange, markdown, report, matchBase, MINIMUMS_FAIL_FROM };
