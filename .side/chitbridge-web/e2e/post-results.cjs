/**
 * post-results.cjs — push a Playwright run onto the test board.
 *
 *   npx playwright test
 *   node post-results.cjs <token> [--kind t1] [--layer web] [--label "nightly"]
 *
 * ⭐⭐ THE POINT OF THIS FILE IS THAT IT IS SHORT. It reads `test-results/junit.xml`, which Playwright writes
 * because of one line in playwright.config.js, and posts it verbatim. There is no format of ours in between —
 * JUnit XML is the de-facto interchange, and the server parses it. If we ever move to Kiwi TCMS or TestRail, the
 * same file goes there instead and nothing has to be re-implemented.
 *
 * ⭐ WHY THE AUTOMATED RESULTS BELONG ON THE SAME BOARD AS THE MANUAL ONES. A case is often provable at two
 * levels — the offer arithmetic by a unit test AND by a person at the counter — and those are different evidence.
 * Kept apart on two boards, a green suite hides a red counter. Kept together, the case shows both.
 *
 * ⚠️⚠️ THE CASE KEY IS THE SPEC FILE (N01, 2026-10-07). The board lists every spec by its path —
 * `chitbridge-web/e2e/tests/one-board.spec.js` — and this used to post the bracket tag in each title
 * (`BOARD-01`), a key no board case carries. Every run was written and none of it showed. Now
 * `key_from: 'file'` keys each test by the file JUnit already names (classname), and the server folds a
 * file's tests into ONE result for the case: any fail fails it, the note says which. `--keys bracket` keeps
 * the old door for a report whose titles name an authored case.
 *
 * ⚠️ NOTHING IS POSTED FROM AN ABORTED RUN. Playwright writes junit.xml even when the run was interrupted
 * (Ctrl-C, the global timeout) and the tests it never reached are simply absent — so the file reads as a
 * short green run. test-results/.last-run.json says how the run ended; anything but passed/failed is refused.
 *
 * Token: the first argument, or CB_BOARD_TOKEN, so a scripted T1 run can post without a copy-paste.
 * ⭐ For CI, mint a key with the `testing` scope (Settings → Integrations → Your keys) — it may post results and read
 * cases, nothing else — and keep it in the CB_BOARD_TOKEN secret. A person's session token works too, and expires.
 *
 * ⭐⭐ ONE POSTER, NOT THREE (2026-10-07). The API's CI posts its guards with THIS file (chitbridge-api ci.yml, which
 * checks this repo out beside it) rather than a copy of it:
 *   --keys name      the testcase name IS the board's key (`chitbridge-api/tests/x.test.cjs`) — no prefix
 *   --file <path>    absolute, or relative to this folder as before
 *   --warn           CI mode: anything that stops the post is a GitHub ::warning:: naming why (the HTTP status),
 *                    and the exit is 0 — a board that is down must never turn a green build red
 *
 * ⭐ THE PROJECT (b292, 2026-10-07) — the sprint or project the run belongs to, so the board can be read per sprint:
 *   --project "2026-10 build · Stage 1"   or env CB_BOARD_PROJECT. Empty = no project. The API's CI passes the repo
 *   VARIABLE vars.CB_BOARD_PROJECT. Before b292 is run the server records the run WITHOUT it and says so — printed.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const API = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };
const WARN = args.indexOf('--warn') >= 0;
/* ⚠ a flag's VALUE is not a token — `--kind t1` with the token in the environment must not post as "t1".
   --warn takes no value, so whatever follows it is not one. */
const token = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && args[i - 1] !== '--warn'))[0]
  || process.env.CB_BOARD_TOKEN;
const KEYS = flag('keys', 'file');
/* ⚠ the flag wins even when it is empty — CI passes --project "" when the variable is unset, and that means none */
const PROJECT = String(flag('project', process.env.CB_BOARD_PROJECT || '') || '').trim() || undefined;

/** stop: an error and exit 1 for a person; a ::warning:: and exit 0 under --warn */
function stop(lines) {
  if (WARN) { console.log('::warning::not posted to the test board — ' + lines.filter(Boolean)[0]); process.exit(0); }
  console.error('\n  ' + lines.filter(Boolean).join('\n  ') + '\n');
  process.exit(1);
}

if (!token) {
  stop(['no token (CB_BOARD_TOKEN is empty)',
    'node post-results.cjs <token> [--kind t1] [--layer web] [--label "nightly"] [--keys file|bracket|name] [--file x.xml] [--project "sprint"] [--warn]',
    'Token: the argument, or CB_BOARD_TOKEN — a key with the testing scope, or JSON.parse(localStorage.cb_sess).token']);
}

const file = path.resolve(__dirname, flag('file', 'test-results/junit.xml'));
if (!fs.existsSync(file)) stop(['no report at ' + file, 'Run the suite first:  npx playwright test']);

/* ⚠️ how the run ENDED. Only the default report has its own .last-run.json beside it; a --file is taken as given. */
const lastRun = path.join(path.dirname(file), '.last-run.json');
if (!flag('file') && fs.existsSync(lastRun)) {
  let st = '';
  try { st = JSON.parse(fs.readFileSync(lastRun, 'utf8')).status || ''; } catch (_) { st = ''; }
  if (st !== 'passed' && st !== 'failed') {
    stop(['the last run ended "' + (st || 'unknown') + '", not passed or failed',
      'A run that stopped early has no verdict for the tests it never reached. Run it again.']);
  }
}

(async () => {
  const xml = fs.readFileSync(file, 'utf8');
  const r = await fetch(API + '/api/testing/results/junit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    /* ⚠ a hung API must not hold a CI job for six hours */
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify({
      xml,
      /* ⭐ the spec FILE is the board's case — see the note at the top; a guard's NAME is its own key */
      key_from: KEYS === 'bracket' ? undefined : (KEYS === 'name' ? 'name' : 'file'),
      key_prefix: KEYS === 'file' ? 'chitbridge-web/e2e/tests' : undefined,
      run_kind: flag('kind', 't1'),
      layer: flag('layer', 'web'),
      run_label: flag('label', 'playwright ' + new Date().toISOString().slice(0, 16).replace('T', ' ')),
      build: flag('build', null),
      project: PROJECT,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) stop(['HTTP ' + r.status + ' ' + (j.message || j.error || '')]);

  console.log('\n  recorded  ' + j.recorded + ' case(s)'
    + (j.folded ? '   (' + (j.recorded + (j.skipped || 0) + j.folded) + ' tests, one result per spec file)' : '')
    + (j.skipped ? '   (' + j.skipped + ' already on this run)' : '')
    + (j.project ? '   project: ' + j.project : ''));
  /* ⚠ asked for a project and the server could not write it (b292 not run yet) — said, in CI as a warning */
  if (j.project_not_written) console.log((WARN ? '::warning::' : '\n  ') + j.project_not_written);
  if ((j.not_on_board || []).length) {
    /* ⚠ recorded, but no case on the board shows it — an untracked spec, or a board not rebuilt since */
    console.log('\n  ' + j.not_on_board.length + ' spec(s) are not cases on the board, so the page cannot show them:');
    j.not_on_board.slice(0, 12).forEach((k) => console.log('    · ' + k));
    console.log('  Commit the spec, run  node C:\\dev\\board.cjs , push, and press Load cases.');
  }
  if ((j.unmatched || []).length) {
    /* ⚠ SAID OUT LOUD, EVERY TIME. These are tests that ran and whose result is nowhere. */
    console.log('\n  ' + j.unmatched.length + ' test(s) could not be placed, so their result is NOT on the board:');
    j.unmatched.slice(0, 12).forEach((n) => console.log('    · ' + n));
    if (j.unmatched.length > 12) console.log('    … and ' + (j.unmatched.length - 12) + ' more');
  }
  console.log('\n  https://chitbridge-web.vercel.app/testing.html\n');
})().catch((e) => stop([(e && e.name === 'TimeoutError' ? 'no answer in 60 s' : 'the post failed') + ' — ' + (e && e.message)]));
