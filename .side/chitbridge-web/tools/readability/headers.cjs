/* tools/readability/headers.cjs — the HEADER TEMPLATE conformance census (read-only): which files carry the full template, a part, or none.
 *
 * OWNS      the kind of a file by its path (kindOf), the required fields per kind (REQUIRED), the findings a typed header can carry
 *           (a typed KIND that disagrees with the path, a typed derived field, an OWNER that is not a cb-* agent) and the census table.
 *           It judges nothing and writes nothing. The grammar is header-grammar.cjs (the one reader); the template is PM/HEADER-TEMPLATE.md.
 * CALLED BY tools/readability.cjs (--headers); e2e/readability-guard.cjs (the grammar fixtures).
 * FLOW      collect (measure.collect + test files) ──▶ readFields(first 60 lines) ──▶ kindOf(path) ──▶ missing(kind, found) ──▶ tally ──▶ table
 * CARD      qa/readability-guard
 * OWNER     cb-maintainability
 * RISK      plain
 */
'use strict';
const fs = require('fs');
const path = require('path');
const measure = require('./measure.cjs');
const grammar = require('./header-grammar.cjs');

/** the census reads the first 60 lines; the guard (measure.cjs HEADER_MAX_LINE) accepts a leading comment up to line 80, so a header that starts between 60 and 80 is seen by the guard only; the census is a count, the guard the judge */
const HEAD_LINES = 60;
/** the ONE copy of the switch-over date (Athi 12 Nov: warn for a week): from this day a NEW file without the template fails; before it, it warns. Old files are never judged by it */
const TEMPLATE_STRICT_FROM = '2026-11-19';
const TEST_FILE = /\.test\.(?:c?js|mjs)$|\.spec\.js$|^e2e\/[^/]+\.cjs$/;
const TEST_DIRS = { web: ['tests', 'e2e'], api: ['tests'], engines: ['tests'] };
const SKIP_DIR = /^(node_modules|vendor|\.git|fixtures?|out|dist|docs|migrations|seed|data)$/;
const KINDS = ['module', 'route-file', 'page', 'component', 'engine', 'test', 'tool'];
const OWNER_VALUE = /^cb-[a-z0-9-]+$/;
/** typed but DERIVED fields: a header must not carry them (Athi, DECISIONS bde673b8: the header holds static information only) */
const DERIVED_LABELS = ['KIND', 'TEST LEVEL', 'BOUNDARY'];
/** STATIC fields every file of the kind MUST carry (the title line always; a test needs CARD or UNIT). FLOW is REQUIRED for new files (Athi 12 Nov, decided). CALLED BY is not required: it is derived from the graph */
const STATIC = ['OWNER', 'OWNS', 'CARD', 'FLOW'];
const REQUIRED = {
  module: STATIC.concat(['RISK']),
  'route-file': STATIC.concat(['RISK']),
  engine: STATIC.concat(['RISK']),
  page: STATIC.concat(['RISK', 'ID']),
  component: STATIC.concat(['RISK', 'ID']),
  tool: STATIC,
  test: ['OWNER']
};

/** the kind of a file, from its repo and path alone (never typed, never guessed beyond this table) */
function kindOf(repo, relPath) {
  if (TEST_FILE.test(relPath) && /^(tests|e2e)\//.test(relPath)) return 'test';
  if (/\.html$/.test(relPath)) return 'page';
  if (/^(scripts|tools)\//.test(relPath)) return 'tool';
  return kindInRepo(repo, relPath);
}

/** the kind of a source file once tests, pages and tools are ruled out */
function kindInRepo(repo, relPath) {
  if (repo === 'engines') return 'engine';
  if (repo === 'api' && /^routes\//.test(relPath)) return 'route-file';
  if (/^public\//.test(relPath)) return 'component';
  return 'module';
}

/** what the first 60 lines say: { title: bool, fields: { LABEL: value } } (the one reader: header-grammar.cjs) */
function readFields(text, relPath) {
  return grammar.parseFields(text.split(grammar.LINE_BREAK).slice(0, HEAD_LINES).join('\n'), relPath);
}

/** the REQUIRED fields (and the title) a file lacks, in template order */
function missing(kind, found) {
  const lacks = REQUIRED[kind].filter((label) => !(label in found.fields));
  if (kind === 'test' && !('CARD' in found.fields) && !('UNIT' in found.fields)) lacks.push('CARD|UNIT');
  if (!found.title) lacks.unshift('title');
  return lacks;
}

/** findings a typed header can carry: { kindWrong, derivedTyped, ownerBad } as 0/1 */
function findings(kind, found) {
  const typedKind = found.fields.KIND;
  return {
    kindWrong: typedKind && typedKind.split(/\s+/)[0] !== kind ? 1 : 0,
    derivedTyped: DERIVED_LABELS.some((label) => label in found.fields) ? 1 : 0,
    ownerBad: 'OWNER' in found.fields && !OWNER_VALUE.test(found.fields.OWNER) ? 1 : 0
  };
}

/** the three states: full (nothing missing) · none (no title and no field line at all) · partial */
function stateOf(kind, found) {
  const lacks = missing(kind, found);
  if (!lacks.length) return { state: 'full', lacks };
  const anything = found.title || Object.keys(found.fields).length > 0;
  return { state: anything ? 'partial' : 'none', lacks };
}

/** test files of one repo under its test folders (fixtures, vendored and data folders skipped) */
function collectTests(repo, root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
      const full = path.join(dir, entry.name);
      const relPath = path.relative(root, full).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        if (!SKIP_DIR.test(entry.name)) walk(full);
      } else if (TEST_FILE.test(relPath)) out.push({ abs: full, rel: relPath });
    }
  };
  (TEST_DIRS[repo] || []).forEach((folder) => walk(path.join(root, folder)));
  return out;
}

const COUNTERS = ['files', 'full', 'partial', 'none', 'legacy3', 'risk', 'testLevel', 'kindWrong', 'derivedTyped', 'ownerBad'];
/** one blank row of the tally */
const blank = () => Object.assign({ lacks: {} }, ...COUNTERS.map((name) => ({ [name]: 0 })));

/** add one file to a row; legacy3 = the three things today's guard asks (OWNS, CALLED BY, FLOW) */
function tally(row, kind, found, judged) {
  row.files++;
  row[judged.state]++;
  if ('OWNS' in found.fields && 'CALLED BY' in found.fields && 'FLOW' in found.fields) row.legacy3++;
  if ('RISK' in found.fields) row.risk++;
  if ('TEST LEVEL' in found.fields) row.testLevel++;
  const flags = findings(kind, found);
  Object.keys(flags).forEach((name) => (row[name] += flags[name]));
  judged.lacks.forEach((label) => (row.lacks[label] = (row.lacks[label] || 0) + 1));
}

/** { repo: { kind: row } } for the given roots { web, api, engines } */
function census(roots) {
  const out = {};
  for (const repo of Object.keys(roots)) {
    const files = measure.collect(repo, roots[repo]).files.concat(collectTests(repo, roots[repo]));
    out[repo] = {};
    for (const file of files) {
      const kind = kindOf(repo, file.rel);
      const found = readFields(fs.readFileSync(file.abs, 'utf8'), file.rel);
      const row = out[repo][kind] || (out[repo][kind] = blank());
      tally(row, kind, found, stateOf(kind, found));
    }
  }
  return out;
}

/** the census as a markdown table (one row per repo and kind, then a total per repo) */
function table(result) {
  const head =
    '| repo | kind | in scope | full | partial | none | OWNS+CALLED BY+FLOW (today) | RISK | TEST LEVEL typed | KIND typed wrong | KIND/LEVEL/BOUNDARY typed | OWNER not cb-* | most-missing fields |\n' +
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|';
  const rows = [];
  for (const repo of Object.keys(result)) {
    const total = blank();
    for (const kind of KINDS.filter((name) => result[repo][name])) {
      const row = result[repo][kind];
      rows.push(line(repo, kind, row));
      COUNTERS.forEach((name) => (total[name] += row[name]));
    }
    rows.push(line('**' + repo + '**', '**all**', total));
  }
  return head + '\n' + rows.join('\n');
}

/** one table row; the three most-missing fields with their counts */
function line(repo, kind, row) {
  const top = Object.entries(row.lacks)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map((pair) => pair[0] + ' ' + pair[1])
    .join(' · ');
  const cells = COUNTERS.map((name) => row[name]).join(' | ');
  return `| ${repo} | ${kind} | ${cells} | ${top} |`;
}

module.exports = { TEMPLATE_STRICT_FROM, REQUIRED, kindOf, readFields, missing, findings, stateOf, census, table };
