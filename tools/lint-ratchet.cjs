#!/usr/bin/env node
/* tools/lint-ratchet.cjs — ESLint + Prettier as DEV-ONLY, WARN-ONLY tools, with a ratchet of today's counts (MNT-1, 2026-10-18).
 *
 * OWNS      running ESLint (eslint.config.cjs) and the Prettier check (.prettierrc.json) over the repo's own code and recording the counts
 *           in lint.ratchet.json (per file: eslint warnings; prettier pass/fail). The ratchet only goes down (same rule as readability.ratchet.json).
 * CALLED BY by hand (`npm run lint` once adopted); NOT in CI yet and never fails a build. Same file in web · api · engines.
 * FLOW      collect own-code files (same scope as tools/readability/measure.cjs) ──▶ eslint per file (inline <script> of .html lintText'd as chunks)
 *           ──▶ prettier --check per file ──▶ compare with lint.ratchet.json ──▶ print · --write lowers rows · --check exits 1 only when asked
 * CARD      qa/lint-ratchet
 *
 *   node tools/lint-ratchet.cjs                 the counts, and any file above its ratchet row (warning only; exit 0)
 *   node tools/lint-ratchet.cjs --write         create/lower the ratchet (never raises)
 *   node tools/lint-ratchet.cjs --check         exit 1 when a file is above its row (for the day CI turns it on — NOT now)
 *   node tools/lint-ratchet.cjs --top 15        the worst files
 * The tools are not repo dependencies yet (no package.json / lock change tonight): they are resolved from $CB_LINT_TOOL, else
 * C:/dev/toolset/lint-tool/node_modules (eslint 9 · prettier 3), else the repo's own node_modules. Prettier never writes a file here.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const ROOT = path.resolve(__dirname, '..');
const RATCHET = path.join(ROOT, 'lint.ratchet.json');
const TOOL_DIRS = [process.env.CB_LINT_TOOL, 'C:/dev/toolset/lint-tool', ROOT].filter(Boolean);
const SCOPES = {
  web: ['public', 'scripts', 'tools'],
  api: ['lib', 'routes', 'middleware', 'src', 'scripts', 'tools', 'server.js', 'public'],
  engines: ['src', 'tools', 'index.js']
};
const SKIP_DIR = /^(node_modules|vendor|\.git|tests?|e2e|fixture|fixtures|out|dist|docs|migrations|seed|data|tally-connector)$/;
const SKIP_FILE = /(\.min\.|^qr\.js$|\.test\.(c?js|mjs)$)/;
const CODE_FILE = /\.(js|cjs|mjs|html)$/;
const VENDORED_HEAD = /ADOPTED from chitbridge-engines/;
const NEVER_FILES = new Set(['public/till.html', 'public/promo.html']);

function load(name) {
  for (const dir of TOOL_DIRS) {
    try {
      return createRequire(path.join(dir, 'x.js'))(name);
    } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error;
    }
  }
  console.error('lint-ratchet: cannot find ' + name + ' (set CB_LINT_TOOL to a folder whose node_modules holds eslint and prettier)');
  process.exit(2);
}

/** which repo this checkout is: api (has server.js) · engines · web */
function repoName() {
  const packageName = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).name || '';
  if (fs.existsSync(path.join(ROOT, 'server.js'))) return 'api';
  return /engine/.test(packageName) ? 'engines' : 'web';
}

/** say what could not be read instead of swallowing it (the unreadable list is printed in the summary) */
const unreadable = [];

/** push every code file under dir onto found, skipping vendored and test folders */
function walk(dir, found) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    unreadable.push(dir + ': ' + error.code);
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIR.test(entry.name)) walk(full, found);
    } else if (CODE_FILE.test(entry.name) && !SKIP_FILE.test(entry.name)) found.push(full);
  }
}

/** own-code files: repo-relative paths, vendored/adopted copies left out */
function collect(repo) {
  const found = [];
  for (const entry of SCOPES[repo]) {
    const full = path.join(ROOT, entry);
    if (!fs.existsSync(full)) continue;
    if (fs.statSync(full).isDirectory()) walk(full, found);
    else found.push(full);
  }
  return found
    .map((absPath) => path.relative(ROOT, absPath).replace(/\\/g, '/'))
    .filter((relPath) => !NEVER_FILES.has(relPath) && !VENDORED_HEAD.test(fs.readFileSync(path.join(ROOT, relPath), 'utf8').slice(0, 700)))
    .sort();
}

/** the inline classic scripts of a page */
function inlineScripts(text) {
  const out = [],
    tag = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = tag.exec(text))) {
    if (/\bsrc\s*=/.test(match[1])) continue;
    const type = /type\s*=\s*["']?([^"'\s>]+)/i.exec(match[1]);
    if (type && !/javascript|module/i.test(type[1])) continue;
    out.push(match[2]);
  }
  return out;
}

/** eslint one file (a page = its inline scripts): the warning count, unparsable chunks and the count per rule */
async function lintFile(eslint, relPath) {
  const text = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  const isPage = /\.html$/.test(relPath);
  const chunks = isPage ? inlineScripts(text).map((code, at) => ({ code, name: relPath + '.inline' + at + '.js' })) : [{ code: text, name: relPath }];
  const rules = {};
  let warnings = 0,
    parseErrors = 0;
  for (const chunk of chunks) {
    const [result] = await eslint.lintText(chunk.code, { filePath: path.join(ROOT, chunk.name) });
    for (const message of result.messages) {
      if (message.fatal) {
        parseErrors++;
        continue;
      }
      warnings++;
      rules[message.ruleId || 'other'] = (rules[message.ruleId || 'other'] || 0) + 1;
    }
  }
  return { warnings, parseErrors, rules };
}

/** true / false, or null when the file is not judged (a page, or Prettier could not parse it — counted in unreadable) */
async function prettierPasses(prettier, relPath) {
  if (/\.html$/.test(relPath)) return null; // pages carry markup + css + js: not judged by this check
  const file = path.join(ROOT, relPath);
  const options = await prettier.resolveConfig(file);
  try {
    return await prettier.check(fs.readFileSync(file, 'utf8'), { ...options, filepath: file });
  } catch (error) {
    unreadable.push(relPath + ': prettier ' + error.name);
    return null;
  }
}

/** lint.ratchet.json, or {} when the repo has none yet */
function readRatchet() {
  if (!fs.existsSync(RATCHET)) return {};
  return JSON.parse(fs.readFileSync(RATCHET, 'utf8'));
}

/** the next ratchet: today's counts, but a row never rises and prettierOk never turns from true to false */
function tighten(files, rows, ratchet) {
  const next = {};
  for (const relPath of files) {
    const old = ratchet[relPath];
    const now = rows[relPath];
    next[relPath] = {
      warnings: old ? Math.min(old.warnings, now.warnings) : now.warnings,
      prettierOk: old && old.prettierOk === true ? now.prettierOk === true : now.prettierOk
    };
  }
  return next;
}

/** files above their row, and (once a ratchet exists) files that are new and already carry warnings */
function judge(files, rows, ratchet) {
  const hasRatchet = Object.keys(ratchet).length > 0;
  return {
    above: files.filter((relPath) => ratchet[relPath] && rows[relPath].warnings > ratchet[relPath].warnings),
    fresh: hasRatchet ? files.filter((relPath) => !ratchet[relPath] && rows[relPath].warnings > 0) : []
  };
}

/** eslint + prettier over every file: per-file rows, the totals and the per-rule totals */
async function measureAll(files) {
  const { ESLint } = load('eslint');
  const prettier = load('prettier');
  const eslint = new ESLint({ cwd: ROOT, overrideConfigFile: path.join(ROOT, 'eslint.config.cjs') });
  const rows = {},
    ruleTotals = {};
  const totals = { files: files.length, eslintWarnings: 0, parseErrors: 0, prettierFail: 0, prettierChecked: 0 };
  for (const relPath of files) {
    const lint = await lintFile(eslint, relPath);
    const pretty = await prettierPasses(prettier, relPath);
    rows[relPath] = { warnings: lint.warnings, prettierOk: pretty };
    totals.eslintWarnings += lint.warnings;
    totals.parseErrors += lint.parseErrors;
    if (pretty !== null) {
      totals.prettierChecked++;
      if (!pretty) totals.prettierFail++;
    }
    for (const [rule, count] of Object.entries(lint.rules)) ruleTotals[rule] = (ruleTotals[rule] || 0) + count;
  }
  return { rows, totals, ruleTotals };
}

/** the one-screen report: totals, top rules, worst files, files above their row, anything not judged */
function printSummary(repo, files, measured, verdict, topCount) {
  const { rows, totals, ruleTotals } = measured;
  console.log(
    `lint-ratchet · ${repo} · ${totals.files} files · eslint warnings ${totals.eslintWarnings} · unparsable chunks ${totals.parseErrors} · prettier would change ${totals.prettierFail}/${totals.prettierChecked}`
  );
  console.log(
    'top rules: ' +
      Object.entries(ruleTotals)
        .sort((first, second) => second[1] - first[1])
        .slice(0, 8)
        .map((pair) => pair.join(':'))
        .join('  ')
  );
  console.log(
    'worst files: ' +
      files
        .slice()
        .sort((first, second) => rows[second].warnings - rows[first].warnings)
        .slice(0, topCount)
        .map((relPath) => relPath + ' ' + rows[relPath].warnings)
        .join(' · ')
  );
  verdict.above.forEach((relPath) => console.log('WARN above ratchet: ' + relPath + ' ' + rows[relPath].warnings));
  verdict.fresh.forEach((relPath) => console.log('WARN new file with warnings: ' + relPath + ' ' + rows[relPath].warnings));
  unreadable.forEach((line) => console.log('not judged: ' + line));
}

/** read the flags, measure, compare with the ratchet, print, and write or check only when asked */
async function main() {
  const args = process.argv.slice(2);
  const repo = repoName();
  const files = collect(repo);
  const measured = await measureAll(files);
  const ratchet = readRatchet();
  const verdict = judge(files, measured.rows, ratchet);
  printSummary(repo, files, measured, verdict, Number(args[args.indexOf('--top') + 1]) || 5);
  if (args.includes('--write')) {
    const about = {
      _about:
        'lint ratchet (MNT-1): eslint warnings per own-code file, 18 Oct = the baseline. A file may have FEWER warnings than its row, never more. Warn-only: no CI step reads this yet. Lower with `node tools/lint-ratchet.cjs --write`.',
      _totals: measured.totals,
      _rules: measured.ruleTotals
    };
    fs.writeFileSync(RATCHET, JSON.stringify({ ...about, ...tighten(files, measured.rows, ratchet) }, null, 1) + '\n');
    console.log('wrote ' + path.relative(ROOT, RATCHET));
  }
  if (args.includes('--check') && (verdict.above.length || verdict.fresh.length)) process.exit(1);
}

if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exit(2);
  });
module.exports = { tighten, judge, inlineScripts };
