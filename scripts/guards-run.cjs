/**
 * scripts/guards-run.cjs — THE RUNNER OF scripts/guards.cjs: spawn each listed test, read the number it proved, print one line per file and the total, write the JUnit report.
 * OWNS      countChecks (the last "<n> checks" a test printed), the per-file run (spawn · skip when the engines repo is absent · ok / FAIL line), the JUnit rows (named by the board's key) and the closing line + exit code.
 * CALLED BY scripts/guards.cjs (which keeps the declared list GUARDS and NEEDS_ENGINES; every test is still listed there and run in that order).
 * FLOW      runGuards({ files, all, TESTS, NEEDS_ENGINES, SKIP_ENGINES, JUNIT, KEY }) ──▶ spawn each tests/<file> ──▶ countChecks ──▶ ok / FAIL ──▶ --junit ──▶ exit 1 on any FAIL
 * OWNER     cb-qa
 * CARD      qa/offline-guards
 */
'use strict';
const fs = require('fs'),
  path = require('path'),
  { spawnSync } = require('child_process');

/** the number a guard proved: its last "<n> checks" or "<n> passed" (QA-79), else node:test's "pass <n>" line (spec reporter ℹ, TAP reporter #); 0 = it proved nothing */
function countChecks(out) {
  const countMatches = out.match(/(\d+)\s+(?:checks|passed)/g) || out.match(/(?:ℹ|#) pass (\d+)/g); /* node:test: "ℹ pass n" on a terminal, "# pass n" (TAP) in CI */
  if (countMatches) return Number(String(countMatches[countMatches.length - 1]).match(/\d+/)[0]);
  /* U1 (8 Nov): two more honest shapes the enrolled files print, tried ONLY when the shapes above found nothing (so no old guard's count moves):
     "<n> ok, <m> failed" and a file that prints one "ok …" / "✓ …" line per check and ends "all ok" with no number (a count of those lines; none = 0 = proved nothing) */
  const okFailed = out.match(/(\d+) ok, \d+ failed/g);
  if (okFailed) return Number(okFailed[okFailed.length - 1].match(/\d+/)[0]);
  return (out.match(/^\s*(?:ok|✓)\s/gm) || []).length;
}

const shortName = (text) => text.replace(/\.test\.(js|cjs)$/, '');

/** a guard that needs the private engines repo, with that repo absent: said as a skip (a CI warning), never a pass */
function skipRow(text, KEY) {
  console.log('  skip  ' + shortName(text).padEnd(22) + '   — needs chitbridge-engines (private; set ENGINES_READ_TOKEN)');
  console.log('::warning::' + text + ' skipped — chitbridge-engines is not checked out (add the ENGINES_READ_TOKEN secret)');
  return { name: KEY(text), status: 'skipped', message: 'needs chitbridge-engines (private), not checked out' };
}

/** spawn one guard: its output, its exit status and its time */
function spawnGuard(TESTS, text) {
  const startedAt = Date.now();
  const spawned = spawnSync(process.execPath, [path.join(TESTS, text)], { encoding: 'utf8', timeout: 120000, env: Object.assign({}, process.env, { OUTPUT_ALLOWLIST: 'enforce' }) /* S34: the gate runs the output allow-list for real; production defaults to report */ });
  return { out: (spawned.stdout || '') + (spawned.stderr || ''), status: spawned.status, seconds: (Date.now() - startedAt) / 1000 };
}

/** the first five lines of a broken guard's output that say why (FAIL · Error · expected), trimmed */
function failureLines(out) {
  return out
    .split('\n')
    .filter((item) => /FAIL|Error|expected/i.test(item))
    .slice(0, 5)
    .map((item) => item.trim());
}

/** ⚠️ never an empty reason: a red row on the board with no words is a question nobody can answer */
function reasonOf(list, checkCount, status) {
  if (list.length) return list.join('\n');
  return checkCount === 0 ? 'counted no checks' : 'exit ' + status;
}

/** run one guard and print its line; { checkCount, broken, row } where row is the JUnit entry */
function runGuard(TESTS, text, KEY) {
  const { out, status, seconds } = spawnGuard(TESTS, text);
  /* every guard ends with "<n> checks"; take the LAST one, because a stray warning can print after it */
  const checkCount = countChecks(out);
  /* ⚠️ A GUARD THAT COUNTED NOTHING PROVED NOTHING (2026-09-17: three guards ended without "<n> checks" and read "ok · 0") */
  const broken = status !== 0 || /\bFAIL\b/.test(out) || checkCount === 0;
  console.log('  ' + (broken ? 'FAIL' : ' ok ') + '  ' + shortName(text).padEnd(22) + String(checkCount).padStart(4) + ' checks');
  const list = broken ? failureLines(out) : [];
  if (broken) console.log(list.map((item) => '          ' + item).join('\n'));
  const row = {
    name: KEY(text),
    status: broken ? 'fail' : 'pass',
    time: seconds,
    message: broken ? reasonOf(list, checkCount, status) : '',
    output: broken ? out.split('\n').slice(-40).join('\n') : ''
  };
  return { checkCount, broken, row };
}

/** the JUnit file (named by the board's key) when --junit was given */
function writeJunit(JUNIT, report) {
  if (!JUNIT) return;
  fs.mkdirSync(path.dirname(JUNIT), { recursive: true });
  fs.writeFileSync(JUNIT, require('../lib/junitresults').write('guards', report));
  console.log('  JUnit → ' + path.relative(process.cwd(), JUNIT) + ' (' + report.length + ' files)');
}

/** run the listed tests, print what the gate prints, write the JUnit file when asked; exits the process with 1 on any red file */
function runGuards({ files, all, TESTS, NEEDS_ENGINES, SKIP_ENGINES, JUNIT, KEY }) {
  const report = [];
  let total = 0,
    failed = [],
    started = Date.now();
  console.log(all ? '— every test file (some need a server) —' : '— the guards —');
  for (const text of files) {
    if (SKIP_ENGINES && NEEDS_ENGINES.indexOf(text) >= 0) {
      report.push(skipRow(text, KEY));
      continue;
    }
    const result = runGuard(TESTS, text, KEY);
    total += result.checkCount;
    if (result.broken) failed.push(text);
    report.push(result.row);
  }
  writeJunit(JUNIT, report);
  console.log('  ' + '─'.repeat(40));
  console.log(
    '  ' +
      total +
      ' checks · ' +
      files.length +
      ' files · ' +
      Math.round((Date.now() - started) / 100) / 10 +
      's · ' +
      (failed.length ? failed.length + ' FAILED: ' + failed.join(', ') : 'all passed')
  );
  process.exit(failed.length ? 1 : 0);
}
module.exports = { runGuards, countChecks };
