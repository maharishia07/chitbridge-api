#!/usr/bin/env node
/* tools/readability/filesize.cjs — THE FILE-SIZE RATCHET for web, api and engines (MNT-58, 2026-11-14).
 *
 * OWNS      the line count of every tracked code file and <repo>/filesize.baseline.json: no file grows past its baseline row, a file with no
 *           row (NEW, or one that never passed 500) is at most 500 lines, a row only falls or disappears (never added, never raised: checked
 *           against the base branch, so a PR cannot hide growth in the baseline; a stamp may raise a row only for a file a merge commit touched, and
 *           prints every raised row). The 1,000-line ceiling is enforced on the customer-facing
 *           files, COMPUTED here (never typed): --ceiling lists those still over it, MNT-59 brings them down.
 * CALLED BY by hand and CI: web e2e/filesize-ratchet.cjs (the fixtures) and ci.yml; the api's tests/filesize-ratchet.test.cjs and the engines
 *           test.yml run THIS file from the web checkout beside them (one scanner, no copy per repo; engines has no tools/readability).
 * FLOW      git ls-files -co ──▶ drop the excluded ──▶ count lines ──▶ compare with the baseline and with the base branch's baseline ──▶ exit 1
 *
 *   node tools/readability/filesize.cjs [--root DIR] [--against REF]   check (exit 1: a file grew, a NEW file over 500, a row added or raised)
 *   node tools/readability/filesize.cjs ... --write         lower rows to today's size, drop rows now at or under 500; refuses to raise or add one
 *   node tools/readability/filesize.cjs ... --rebaseline    reset every row to today's size: ONLY on a stamp (CB_FILESIZE_STAMP=1 set by the batch
 *                                                           tool, never in a change that edits a workflow; or a batch/* branch whose diff
 *                                                           changes the CB_BUILD assignment, or adds the one line "<branch> <YYYY-MM-DD>" to the
 *                                                           committed filesize.stamp: api/engines have no CB_BUILD); refused anywhere else
 *   node tools/readability/filesize.cjs ... --ceiling       the customer-facing files still over 1,000 (exit 1 while any is)
 *
 * SCOPE: every tracked .js .cjs .mjs .html .css file, TESTS INCLUDED (a test file may not grow either). Not counted, each judged where it is made:
 *   vendor/fixtures  measure.cjs VENDOR_DIR (node_modules, vendor, fixtures, build output) and *.min.*
 *   copies           measure.cjs ADOPTED_HEAD in the first 700 bytes (an engines copy: api lib/*, web public/*), and by path web public/engine/*
 *                    and public/till.html: judged at the master (chitbridge-engines src/, api tools/tally-connector/till.html)
 *   generated        web public/app/screens.js, assets.js, strings-*.js, judged at the generator in the docs repo
 * CUSTOMER-FACING (computed): web = the 19 pages of e2e/proof/pages.json and every file they load by <script src> (HTML comments stripped) ·
 *   api = routes/, lib/ and tools/tally-connector, minus routes/testing.js, scripts and tests · engines = all of src/.
 * CARD      qa/readability-guard
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ADOPTED_HEAD, HEAD_BYTES, VENDOR_DIR } = require('./measure.cjs');

const STAMP_FILE = 'filesize.stamp';
const BASELINE_FILE = 'filesize.baseline.json';
const NEW_FILE_MAX = 500;
const CEILING = 1000;
const COUNTED = /\.(c?js|mjs|html|css)$/;
const GENERATED = /^public\/(app\/(screens|assets|strings-[^/]*)\.js|engine\/.*|till\.html)$/;

/** is this tracked path not counted (not code, vendor or fixture, minified, generated)? */
function isExcluded(rel) {
  const folders = rel.split('/').slice(0, -1);
  return !COUNTED.test(rel) || /\.min\.[a-z]+$/.test(rel) || GENERATED.test(rel) || folders.some((part) => VENDOR_DIR.test(part));
}

/** the number of lines in a text: a final line without a newline still counts */
function countLines(text) {
  if (!text) return 0;
  const breaks = text.split('\n').length - 1;
  return text.endsWith('\n') ? breaks : breaks + 1;
}

function gitIn(root, gitArgs) {
  return spawnSync('git', ['-C', root].concat(gitArgs), { encoding: 'utf8', maxBuffer: 64 << 20 });
}

/** the tracked and new (not ignored) files under root, as forward-slash paths */
function listFiles(root) {
  const out = gitIn(root, ['ls-files', '-co', '--exclude-standard']);
  if (out.status !== 0) throw new Error('git ls-files failed in ' + root + ': ' + out.stderr);
  return out.stdout.split(/\r?\n/).filter(Boolean);
}

/** today's size of every counted file, by path (copies and generated files left out) */
function measure(root) {
  const sizes = {};
  for (const rel of listFiles(root)) {
    if (isExcluded(rel) || !fs.existsSync(path.join(root, rel))) continue;
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    if (!ADOPTED_HEAD.test(text.slice(0, HEAD_BYTES))) sizes[rel] = countLines(text);
  }
  return sizes;
}

/** which repo is this root: web has public/app.html, engines has engines.json, api has routes/ */
function repoOf(root) {
  if (fs.existsSync(path.join(root, 'public', 'app.html'))) return 'web';
  if (fs.existsSync(path.join(root, 'engines.json'))) return 'engines';
  return 'api';
}

/** the public paths a page loads by <script src> (comments stripped first: a commented-out tag is not loaded) */
function scriptsOf(html) {
  const live = html.replace(/<!--[\s\S]*?-->/g, '');
  const found = [];
  live.replace(/<script\b[^>]*\bsrc\s*=\s*["']([^"'?#]+)/gi, (whole, src) => found.push(src));
  return found.filter((src) => !/^(https?:)?\/\//.test(src)).map((src) => 'public/' + src.replace(/^\//, ''));
}

/** web: the 19 customer pages and the scripts they load */
function webCustomer(root) {
  const pages = JSON.parse(fs.readFileSync(path.join(root, 'e2e', 'proof', 'pages.json'), 'utf8')).pages;
  const listed = new Set();
  for (const page of pages) {
    const rel = 'public/' + page[1].split('?')[0].replace(/^\//, '');
    listed.add(rel);
    if (fs.existsSync(path.join(root, rel))) scriptsOf(fs.readFileSync(path.join(root, rel), 'utf8')).forEach((src) => listed.add(src));
  }
  return [...listed].filter((rel) => fs.existsSync(path.join(root, rel)));
}

/** the customer-facing files of a repo, computed from its own structure */
function customerFiles(root) {
  const repo = repoOf(root);
  const tracked = listFiles(root).filter((rel) => COUNTED.test(rel));
  if (repo === 'web') return webCustomer(root);
  if (repo === 'engines') return tracked.filter((rel) => rel.startsWith('src/'));
  return tracked.filter((rel) => /^(routes|lib|tools\/tally-connector)\//.test(rel) && rel !== 'routes/testing.js');
}

/** the customer-facing files over the ceiling, with how many are copies judged at their master */
function ceilingReport(root, sizes) {
  const listed = customerFiles(root);
  const over = listed.filter((rel) => countLines(fs.readFileSync(path.join(root, rel), 'utf8')) > CEILING);
  const judged = over.filter((rel) => sizes[rel] !== undefined).map((rel) => ({ rel, lines: sizes[rel] }));
  return { listed: listed.length, over: over.length, judged };
}

/** the rows of a baseline text (an unreadable baseline throws: a broken file must be seen, not read as empty) */
function readRows(text) {
  return JSON.parse(text).files || {};
}

function readBaseline(root) {
  const file = path.join(root, BASELINE_FILE);
  return fs.existsSync(file) ? readRows(fs.readFileSync(file, 'utf8')) : {};
}

/** one entry per line, sorted: a merge by union and a diff that shows each file's row */
function writeBaseline(root, files) {
  const rows = Object.keys(files).sort().map((key) => '    ' + JSON.stringify(key) + ': ' + files[key]);
  const about = 'MNT-58 file-size ratchet: a file may be smaller than its row, never larger; a file with no row is at most 500 lines; a row may only fall or disappear. '
    + 'Rows fall with --write; they are reset only at a batch stamp (--rebaseline). Tool: web tools/readability/filesize.cjs';
  fs.writeFileSync(path.join(root, BASELINE_FILE), '{\n  "_about": ' + JSON.stringify(about) + ',\n  "files": {\n' + rows.join(',\n') + '\n  }\n}\n');
}

/** the red findings: files that grew past their row, and files with no row over 500 */
function judge(sizes, rows) {
  const grown = [];
  const tooBig = [];
  for (const [rel, lines] of Object.entries(sizes)) {
    const held = rows[rel];
    if (held === undefined && lines > NEW_FILE_MAX) tooBig.push({ rel, lines });
    if (held !== undefined && lines > held) grown.push({ rel, lines, held });
  }
  return { grown, tooBig };
}

/** rows added or raised in the head baseline compared with the base baseline */
function rowsRaised(headRows, baseRows) {
  return Object.keys(headRows).filter((rel) => baseRows[rel] === undefined || headRows[rel] > baseRows[rel]).map((rel) => ({ rel, was: baseRows[rel], now: headRows[rel] }));
}

/** the base branch's baseline: { rows } (null rows when the base has none yet: the introduction), or { unresolved } when the ref is not there */
function baseBaseline(root, ref) {
  if (gitIn(root, ['rev-parse', '--verify', '--quiet', ref + '^{commit}']).status !== 0) return { unresolved: true };
  const shown = gitIn(root, ['show', ref + ':' + BASELINE_FILE]);
  return { rows: shown.status === 0 ? readRows(shown.stdout) : null };
}

/** the current branch: the PR head in CI, else the checked-out branch */
function headBranch(root) {
  return process.env.GITHUB_HEAD_REF || gitIn(root, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
}

/** the web batch stamp is the CB_BUILD assignment itself changing on a batch/* branch (a comment line or a quoted date elsewhere does not count) */
function buildStamp(root, ref) {
  if (!/^batch\//.test(headBranch(root))) return false;
  const diff = gitIn(root, ['diff', '-U1', ref + '...HEAD', '--', 'public/app.html']).stdout;
  return /^[ +]const CB_BUILD =\r?\n(?:-.*\r?\n)?\+\s*'\d{4}-\d\d-\d\d[a-z]*';/m.test(diff);
}

/**
 * the api/engines batch stamp (they have no CB_BUILD): a committed <repo>/filesize.stamp whose ONE added line is "<this batch branch> <YYYY-MM-DD>".
 * It sits in the PR diff for the reviewer, names the branch (a stamp carried from an old batch, or copied to a feature branch, does not match),
 * and must be CHANGED against the base, so every batch writes its own line. Never read from the environment, never from another branch.
 */
function fileStamp(root, ref) {
  const branch = headBranch(root);
  if (!/^batch\//.test(branch)) return false;
  const diff = gitIn(root, ['diff', '-U0', ref + '...HEAD', '--', STAMP_FILE]).stdout;
  const added = diff.split(/\r?\n/).filter((line) => line.startsWith('+') && !line.startsWith('+++ ')).map((line) => line.slice(1).trim());
  return added.length === 1 && added[0].startsWith(branch + ' ') && /^\d{4}-\d\d-\d\d$/.test(added[0].slice(branch.length + 1));
}

/** the batch stamp: web's CB_BUILD change, or the committed filesize.stamp line */
function batchStamp(root, ref) {
  return buildStamp(root, ref) || fileStamp(root, ref);
}

/** a stamp: the batch tool's env (never in a PR that changes a workflow file), or the batch stamp; returns its name or null */
function stampReason(root, ref) {
  if (process.env.CB_FILESIZE_STAMP) {
    const workflows = gitIn(root, ['diff', '--name-only', ref + '...HEAD', '--', '.github/workflows']).stdout.trim();
    if (!workflows) return 'env';
    console.log('  REFUSED CB_FILESIZE_STAMP: this change edits a workflow file (' + workflows.split(/\r?\n/)[0] + ')');
    return null;
  }
  return batchStamp(root, ref) ? 'batch' : null;
}

/** the files a MERGE commit between the base and HEAD changed (a stamp may raise a row only for a file a merged PR touched) */
function mergeTouched(root, ref) {
  const shown = gitIn(root, ['log', '--merges', '-m', '--first-parent', '--name-only', '--format=', ref + '..HEAD']).stdout;
  return new Set(shown.split(/\r?\n/).filter(Boolean));
}

function argValue(args, flag) {
  const at = args.indexOf(flag);
  return at === -1 ? null : args[at + 1];
}

function baseRef(args) {
  return argValue(args, '--against') || process.env.FILESIZE_BASE || 'origin/' + (process.env.GITHUB_BASE_REF || 'main');
}

/** the baseline for today: every file over 500 at the lower of its row and its size; no row is added unless first creation or forced */
function nextRows(sizes, rows, force) {
  const files = {};
  const refused = [];
  const first = !Object.keys(rows).length;
  for (const [rel, lines] of Object.entries(sizes)) {
    if (lines <= NEW_FILE_MAX) continue;
    if (force || first) files[rel] = lines;
    else if (rows[rel] === undefined || lines > rows[rel]) refused.push(rel);
    else files[rel] = lines;
  }
  return { files, refused };
}

/** --write and --rebaseline: lower the rows (a stamp resets them), refuse to raise or add one */
function runWrite(root, args, sizes) {
  const force = args.includes('--rebaseline');
  if (force && !stampReason(root, baseRef(args))) {
    console.log('REFUSED: --rebaseline runs only at a batch stamp (CB_FILESIZE_STAMP=1 from the batch tool, or a batch/* branch that changes CB_BUILD)');
    return 1;
  }
  const next = nextRows(sizes, readBaseline(root), force);
  if (next.refused.length) {
    console.log('REFUSED: --write never raises or adds a row (these grew or are new over 500): ' + next.refused.join(', '));
    return 1;
  }
  writeBaseline(root, next.files);
  console.log('filesize baseline written: ' + Object.keys(next.files).length + ' files over ' + NEW_FILE_MAX + ' lines');
  return 0;
}

function runCeiling(root, sizes) {
  const report = ceilingReport(root, sizes);
  report.judged.forEach((row) => console.log('  over ' + CEILING + ': ' + row.rel + ' (' + row.lines + ')'));
  console.log('customer-facing files computed: ' + report.listed + ' · over ' + CEILING + ': ' + report.over + ' (' + report.judged.length + ' judged here, ' + (report.over - report.judged.length) + ' copies or generated, judged at their master)');
  return report.judged.length ? 1 : 0;
}

/** the baseline may not hide growth: against the base branch no row is added or raised; a stamp may, for files a merged PR touched, and says every row */
function hiddenGrowth(root, args, rows) {
  const ref = baseRef(args);
  const base = baseBaseline(root, ref);
  if (base.unresolved) {
    console.log((process.env.CI ? '  FAIL' : '  skip') + ' base ref ' + ref + ' not found: the baseline cannot be compared (CI: fetch-depth 0)');
    return process.env.CI ? [{ rel: BASELINE_FILE, was: 'no base', now: 'unresolved' }] : [];
  }
  const raised = base.rows ? rowsRaised(rows, base.rows) : [];
  const reason = raised.length ? stampReason(root, ref) : null;
  if (!reason) return raised;
  return stampedRows(root, ref, raised, reason);
}

/** on a stamp: print every raised row (and the job summary), and return those whose file no merge commit touched */
function stampedRows(root, ref, raised, reason) {
  const touched = mergeTouched(root, ref);
  const lines = raised.map((row) => '  STAMP (' + reason + ') row ' + row.rel + ' ' + row.was + ' -> ' + row.now + (touched.has(row.rel) ? '' : '  NOT touched by a merge commit'));
  lines.forEach((line) => console.log(line));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### file-size stamp: rows raised\n' + lines.join('\n') + '\n');
  return raised.filter((row) => !touched.has(row.rel));
}

/** the check: files that grew, new files over 500, rows added or raised against the base branch; prints the one summary line */
function runCheck(root, args, sizes) {
  const rows = readBaseline(root);
  const verdict = judge(sizes, rows);
  const raised = hiddenGrowth(root, args, rows);
  verdict.grown.forEach((row) => console.log('  FAIL grew: ' + row.rel + ' ' + row.held + ' -> ' + row.lines + ' (a file may not grow past its baseline)'));
  verdict.tooBig.forEach((row) => console.log('  FAIL new file over ' + NEW_FILE_MAX + ': ' + row.rel + ' (' + row.lines + ' lines; split it, or make room by shrinking)'));
  raised.forEach((row) => console.log('  FAIL baseline row added or raised: ' + row.rel + ' ' + row.was + ' -> ' + row.now + ' (a row may only fall or disappear; a stamp resets them)'));
  const redCount = verdict.grown.length + verdict.tooBig.length + raised.length;
  const report = ceilingReport(root, sizes);
  console.log('filesize ratchet: ' + (redCount ? redCount + ' red' : 'green') + ' · ' + Object.keys(rows).length + ' files held over ' + NEW_FILE_MAX + ' · customer-facing over ' + CEILING + ': ' + report.over + ' of ' + report.listed);
  return redCount ? 1 : 0;
}

function main(args) {
  const root = path.resolve(argValue(args, '--root') || path.join(__dirname, '..', '..'));
  const sizes = measure(root);
  if (args.includes('--write') || args.includes('--rebaseline')) return runWrite(root, args, sizes);
  return args.includes('--ceiling') ? runCeiling(root, sizes) : runCheck(root, args, sizes);
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { measure, judge, countLines, isExcluded, customerFiles, scriptsOf, NEW_FILE_MAX, CEILING };
