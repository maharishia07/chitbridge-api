/**
 * e2e/rail-truth.cjs — RAIL TRUTH, the web half (K-TRUTH-1 2026-10-19; api half: tests/rail-truth.realstack.cjs in chitbridge-api).
 *
 * RAIL-51 FIRST: does COMPOSE reach the staged-attachment helpers (cbAttachStage / Staged / Unstage / Flush, attach-ui.js)? The answer decides
 * RAIL-47/48/49 (their behaviour is written in attach-ui.js but only matters if compose calls it). RAIL-57: are the chits and picker specs
 * independent of account state, order and default policy? Both are read from the SOURCE (no browser, no stack, no network): a reach check is a
 * fact about the code and must not depend on a walk passing.
 * A case marked `gap:` is the PRINCIPLE failing today — RECORDED (RAIL-BACKLOG "K-TRUTH-1 2026-10-19", toolset/known-failing.json), never fixed here.
 * Run: node e2e/rail-truth.cjs   (exit 1 only on a FAIL that is not a known gap)
 */
const fs = require('fs');
const path = require('path');
const W = path.join(__dirname, '..', 'public');
const read = (p) => fs.readFileSync(p, 'utf8');
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.(js|html)$/.test(f.name)) files.push(p); } })(W);
const other = files.filter((p) => path.basename(p) !== 'attach-ui.js').map((p) => ({ p, s: read(p) }));
const att = read(path.join(W, 'app', 'attach-ui.js'));
const app = read(path.join(W, 'app.html'));
/** code only: the specs explain themselves at length, and a comment that NAMES a pattern must not count as using it */
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const chits = codeOnly(read(path.join(__dirname, 'tests', 'chits.spec.js')));
const picker = codeOnly(read(path.join(__dirname, 'tests', 'picker.spec.js')));

let fail = 0, gaps = 0;
function kase(id, title, cond, seen, gap) {
  if (cond) return console.log('  ok   ' + id + ' ' + title);
  if (gap) { gaps++; return console.log('  FAIL ' + id + ' ' + title + '  [gap: ' + gap + ']\n         ' + seen); }
  fail++; console.error('  FAIL ' + id + ' ' + title + '\n         ' + seen);
}
const callers = (name) => other.filter((f) => new RegExp('\\b' + name + '\\s*\\(').test(f.s)).map((f) => path.relative(W, f.p));
/** the body of one Playwright test, from its title to the next `test(` */
function testBody(src, title) { const a = src.indexOf(title); if (a < 0) return ''; const b = src.indexOf("\n  test(", a + 1); return src.slice(a, b < 0 ? undefined : b); }

console.log('\n── rail truth (web, source-level) ──');
for (const fn of ['cbAttachStage', 'cbAttachStaged', 'cbAttachUnstage', 'cbAttachFlush']) {
  kase('RAIL-51-' + fn, 'compose reaches ' + fn, callers(fn).length > 0, 'callers outside attach-ui.js: ' + JSON.stringify(callers(fn)), 'no caller on main: compose holds files in CC.files (ccAddFiles) and has its own send path — RAIL-47/48/49 are unreached');
}
kase('RAIL-51-defined', 'the four helpers exist in attach-ui.js', ['cbAttachStage', 'cbAttachStaged', 'cbAttachUnstage', 'cbAttachFlush'].every((n) => new RegExp('function ' + n + '\\b').test(att)), 'a helper is missing from attach-ui.js');
kase('RAIL-51-own-path', 'compose has its own attach path today (ccAddFiles holds files; the send carries them)', /function ccAddFiles\(/.test(app) && /files:\s*CC\.files\s*\|\|\s*\[\]/.test(app) /* spaced since the mechanical pass */, 'ccAddFiles / files:CC.files not found in app.html');
kase('RAIL-51-one-rule', 'compose asks the one acceptance rule (cbAttachAccept) for each file', /function ccAddFiles[\s\S]{0,600}cbAttachAccept\(/.test(app), 'ccAddFiles does not call cbAttachAccept');

const c1 = testBody(chits, "[CHIT-01] CREATE");
kase('RAIL-57-chit01', 'CHIT-01 states its own self-copy policy (does not lean on the account default)', /self_copy/.test(c1), 'CHIT-01 composes through the wizard and lets the account DEFAULT decide the filing', 'CHIT-01 depends on the default policy');
kase('RAIL-57-no-row', 'chits.spec asserts the filing through the api, not a rendered list row', !/getByText\(subject\)/.test(chits), 'chits.spec opens a chit by clicking its subject text in a list (a shared account fills page 1)', 'row found by text on a shared account list');
kase('RAIL-57-picker-order', 'picker.spec tests do not depend on running in order', !/describe\.serial\(/.test(picker), 'picker.spec is test.describe.serial — a later test relies on an earlier one', 'picker.spec order dependence');
kase('RAIL-57-shared-account', 'picker.spec does not inherit the shared authed account\'s contents', /mintEntity\([^)]*\{[^}]*fresh|freshEntity|newEntity/.test(picker), 'it inherits whatever entity the authed project holds (mintEntity short-circuits on a saved session)', 'shared account state');

console.log('\n── ' + (fail + gaps) + ' not passing · ' + gaps + ' known gaps · ' + fail + ' real fails ──');
process.exitCode = fail ? 1 : 0;
