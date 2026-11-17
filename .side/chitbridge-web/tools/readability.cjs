#!/usr/bin/env node
/* tools/readability.cjs — how human-readable is our own code, and did THIS change make it better? (READ-1 baseline + READ-GUARD guard)
 *
 * OWNS      the command line only: which mode, which repo, which root; the baseline report, the §6 guard and the ratchet write
 *           are tools/readability/{baseline,guard,ratchet}.cjs over ONE measure (tools/readability/measure.cjs, acorn).
 * CALLED BY by hand, .github/workflows/ci.yml (web check job), the api's tests/readability-guard.test.cjs (from the twin checkout),
 *           e2e/readability-guard.cjs (the rule fixtures).
 * FLOW      args ──▶ --changed ? guard.run → report + checklist markdown + exit 1 on a failure
 *                        : --write ? ratchet.tighten (lower only) → readability.ratchet.json
 *                        : baseline.metrics per repo → print / --json / --detail
 * CARD      qa/readability-guard
 *
 *   node tools/readability.cjs                                   the READ-1 baseline over web · api · engines (--roots web=.,api=..,engines=..)
 *   node tools/readability.cjs --json out.json | --detail api R3 | --top 20
 *   node tools/readability.cjs --changed [--base origin/main] [--repo web|api|engines] [--root DIR] [--ratchet] [--md] [--write] [--today YYYY-MM-DD]
 *                                                                 judge only what the change touched (git diff vs merge-base); --md prints the
 *                                                                 §6 checklist with numbers; --write tightens the touched files' ratchet rows;
 *                                                                 --strict = the touch rule FAILS a touched file not at 0 now (MNT-30; warn mode until the date in tools/readability/touch.cjs)
 *   node tools/readability.cjs --headers [--roots web=.,api=..,engines=..]   READ-ONLY census of the PM/HEADER-TEMPLATE.md fields per repo and kind (never fails)
 *   node tools/readability.cjs --write [--repo api|engines --root ../chitbridge-<repo>]   write/tighten the whole ratchet (lower only)
 * MOVES    a function whose body (tokens: whitespace and comments ignored) EXACTLY equals one the same diff deletes is a MOVE: it keeps the old
 *           score (tools/readability/moves.cjs), is listed as "moved: N functions (exact body match)", and any other change is new code.
 * acorn: the installed package when there is one, else the vendored tools/vendor/acorn.cjs — no npm dependency, runs offline anywhere.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const measure = require('./readability/measure.cjs');
const baseline = require('./readability/baseline.cjs');
const guard = require('./readability/guard.cjs');
const ratchet = require('./readability/ratchet.cjs');
const moves = require('./readability/moves.cjs');
const headers = require('./readability/headers.cjs');

const WEB_ROOT = path.resolve(__dirname, '..');
const DEFAULT_ROOTS = 'web=.,api=../chitbridge-api,engines=../chitbridge-engines';
const DEFAULT_BASE = 'origin/main';
const TRACE_TOOL = path.join(__dirname, 'graph', 'trace.cjs');
const TRACE_TIMEOUT_MS = 120000;
const EXIT_FAIL = 1,
  EXIT_USAGE = 2;

const args = process.argv.slice(2);
/** `--name value` or a bare `--name` (true); `fallback` when absent */
function flag(name, fallback) {
  const at = args.indexOf('--' + name);
  if (at < 0) return fallback;
  const next = args[at + 1];
  return next && !next.startsWith('--') ? next : true;
}

function parseRoots(spec) {
  const roots = {};
  String(spec)
    .split(',')
    .forEach((pair) => {
      const [repo, dir] = pair.split('=');
      if (repo && dir) roots[repo] = path.resolve(dir);
    });
  return roots;
}

/** the repo root for --repo: --root wins; web = this checkout; api/engines = the sibling beside it */
function rootFor(repo) {
  const given = flag('root');
  if (given && given !== true) return path.resolve(given);
  return repo === 'web' ? WEB_ROOT : path.resolve(WEB_ROOT, '..', 'chitbridge-' + repo);
}

// ── trace.json: the committed/emitted file at the root, else built fresh from KG1 when the graph tool is here
function loadTrace(repo, root) {
  const file = path.join(root, 'trace.json');
  if (fs.existsSync(file)) return { trace: JSON.parse(fs.readFileSync(file, 'utf8')), from: file };
  if (!fs.existsSync(TRACE_TOOL)) return { trace: null, from: 'no trace.json and no tools/graph/trace.cjs' };
  const built = spawnSync(process.execPath, [TRACE_TOOL, '--repo', repo, '--root', root, '--stdout'], {
    encoding: 'utf8',
    maxBuffer: 64 << 20,
    timeout: TRACE_TIMEOUT_MS
  });
  if (built.status !== 0) return { trace: null, from: 'trace build failed: ' + (built.stderr || '').trim().split('\n').slice(-2).join(' ') };
  try {
    return { trace: JSON.parse(built.stdout), from: 'built fresh from KG1' };
  } catch (error) {
    return { trace: null, from: 'trace build gave no JSON: ' + error.message };
  }
}

// ── --changed
/** judge the change: the guard's result for --repo against --base, with the trace and (when asked) the ratchet */
function judgeChange(repo, root) {
  const trace = flag('trace') === 'none' ? { trace: null, from: '--trace none' } : loadTrace(repo, root);
  const today = flag('today');
  const result = guard.judgeChange({
    repo,
    root,
    baseRef: String(flag('base', DEFAULT_BASE)),
    trace: trace.trace,
    today: typeof today === 'string' ? today : undefined,
    ratchetRows: flag('ratchet') ? undefined : null,
    touch: flag('strict') ? 'fail' : flag('touch')
  });
  if (result.error) {
    console.error('  readability --changed: ' + result.error);
    process.exit(EXIT_USAGE);
  }
  result.traceFrom = trace.from;
  return result;
}

/** print the judgement (report · --md checklist · --json file), tighten with --write, exit 1 on a failure */
function runChanged() {
  const repo = String(flag('repo', 'web')),
    root = rootFor(repo);
  const result = judgeChange(repo, root);
  const ratchetNote = flag('ratchet') ? '' : ' · ratchet not applied (add --ratchet)';
  console.log(
    `\nreadability --changed · ${repo} · base ${result.baseRef} @ ${result.baseSha.slice(0, 7)} · ${result.files.length} own-code file(s) · trace: ${result.traceFrom}${ratchetNote}`
  );
  console.log(guard.report(result));
  if (flag('md')) console.log('\n' + guard.markdown(result) + '\n');
  if (flag('write')) tightenTouched(root, result);
  writeJson(flag('json'), {
    repo,
    base: result.baseSha,
    failed: result.failed,
    moved: result.moved.length,
    findings: result.findings,
    files: result.files.map((file) => ({ file: file.file, status: file.status, numbers: file.numbers, score: file.score })),
    markdown: guard.markdown(result)
  });
  const warnings = result.warnings ? ' (' + result.warnings + ' warning(s))' : '';
  console.log(result.failed ? '\n  ✗ readability guard: FAIL' : '\n  ✓ readability guard: ok' + warnings);
  process.exit(result.failed ? EXIT_FAIL : 0);
}

function writeJson(target, value) {
  if (target && target !== true) fs.writeFileSync(target, JSON.stringify(value, null, 1));
}

/** --changed --write: tighten only the touched files' rows (a lowered score makes the ratchet lower; a raised one is refused) */
function tightenTouched(root, result) {
  const scores = {},
    held = ratchet.read(root) || {};
  for (const file of result.files) {
    if (file.score) scores[file.file] = file.score;
    // a move carries its debt in: the target's row may rise by exactly what moved (the source's row falls by the same)
    if (file.carried && held[file.file]) held[file.file] = moves.plus(held[file.file], file.carried);
  }
  const merged = ratchet.tighten(held, scores);
  ratchet.write(root, merged.rows);
  console.log(`  ratchet: ${merged.lowered.length} row(s) lowered · ${merged.refused.length} refused (score rose) → ${ratchet.RATCHET_FILE}`);
  merged.refused.forEach((row) => console.log('    refused ' + row.file + ' ' + row.from + ' → ' + row.to));
}

// ── --write (whole ratchet)
function writeRatchet() {
  const repo = String(flag('repo', 'web')),
    root = rootFor(repo);
  const scores = {};
  for (const file of measure.collect(repo, root).files) scores[file.rel] = ratchet.score(measure.fileFacts(file));
  const merged = ratchet.tighten(ratchet.read(root), scores);
  ratchet.write(root, merged.rows);
  console.log(
    `${ratchet.RATCHET_FILE} (${repo}): ${Object.keys(merged.rows).length} files · ${merged.lowered.length} lowered · ${merged.refused.length} refused (lower only)`
  );
  merged.refused.slice(0, 20).forEach((row) => console.log('  refused ' + row.file + ' ' + row.from + ' → ' + row.to));
}

// ── the baseline
function runBaseline() {
  const roots = parseRoots(flag('roots', DEFAULT_ROOTS)),
    top = Number(flag('top', 30)) || 30;
  const out = {};
  for (const repo of Object.keys(roots)) {
    if (!fs.existsSync(roots[repo])) {
      console.error('skip ' + repo + ' (no dir ' + roots[repo] + ')');
      continue;
    }
    out[repo] = baseline.metrics(repo, roots[repo], top);
  }
  writeJson(flag('json'), JSON.parse(JSON.stringify(out, (key, value) => (key === '_headers' || key === '_fns' ? undefined : value))));
  const detail = flag('detail');
  if (detail && detail !== true) {
    const metric = args[args.indexOf('--detail') + 2] || 'R3';
    baseline
      .detailRows(out[detail], metric)
      .forEach((row) => console.log(row.file + (row.line ? ':' + row.line : '') + ' ' + (row.name || '') + ' ' + (row.len || '')));
    return;
  }
  for (const repoMetrics of Object.values(out)) baseline.print(repoMetrics, top);
}

/** --headers: the read-only header-template census (tools/readability/headers.cjs); never fails */
function runHeaders() {
  const roots = parseRoots(flag('roots', DEFAULT_ROOTS));
  for (const repo of Object.keys(roots)) if (!fs.existsSync(roots[repo])) delete roots[repo];
  console.log(headers.table(headers.census(roots)));
}

if (flag('headers')) runHeaders();
else if (flag('changed')) runChanged();
else if (flag('write')) writeRatchet();
else runBaseline();
