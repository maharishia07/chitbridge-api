#!/usr/bin/env node
/**
 * FLOW  args → readRegister() + readAllowList() → scanRoots() → judge() → print · exit 1 when a cited standard is on neither list
 * CARD 29-qa-test-tooling-ux-locale-and-design-system/standards-register
 * standards-scan.cjs — ONE REGISTER, EVERY STANDARD (CMP-24, 2026-10-28, owner cb-compliance).
 *
 * owns: the rule "a standard named in code or docs is a row of public/app/cap-standards.js, or a named exclusion in
 *       public/data/standards-mentioned.json" · called by: .github/workflows/ci.yml (T1 guard), e2e/standards-one-list.cjs (step 5), a person.
 *
 *   node tools/standards-scan.cjs [--root DIR ...] [--print] [--register FILE] [--list FILE]
 *
 * Roots default to this repo's public/app and docs plus the sibling checkouts beside it (chitbridge-engines/src,
 * chitbridge-api/lib and routes, the docs repo). A root that is not there is SKIPPED AND SAID (CI has no siblings);
 * docs/history and docs/archive are never scanned (retired documents may name anything).
 * A register row answers for its n · id · w · note and its `aka` names; "29119-2 and 29119-4" answers for both numbers.
 */
'use strict';
const fs = require('fs'), path = require('path'), sandbox = require('vm');

const ROOT = path.join(__dirname, '..');
const SIBLINGS_DIR = path.join(ROOT, '..');
const DEFAULT_ROOTS = [
  path.join(ROOT, 'public', 'app'), path.join(ROOT, 'docs'),
  path.join(SIBLINGS_DIR, 'chitbridge-engines', 'src'), path.join(SIBLINGS_DIR, 'chitbridge-api', 'lib'), path.join(SIBLINGS_DIR, 'chitbridge-api', 'routes'),
  path.join(SIBLINGS_DIR, 'docs'), path.join(SIBLINGS_DIR, 'chitbridge-docs', 'docs')
];
const SKIP_DIR = /^(node_modules|\.git|out|dist|e2e-results|test-results|shots|walks|history|archive)$/;
const SCAN_FILE = /\.(js|cjs|mjs|md|json|sql|html)$/;
const MAX_FILE_BYTES = 2e6;
/* the names a standard goes by: ISO families, RFCs, WCAG versions, UN/ECE recommendations, the GS1 standards (a fixed list, so
   "GS1 US" or "GS1 already" is not one), Peppol, UBL, EN 16931, SAF-T, XBRL, schema.org types */
const CITE_RE = /\b(ISO(?:\/IEC)?(?:\/IEEE)? ?\d{3,5}(?:-\d+)?(?![\w-])|RFC ?\d{3,5}\b|WCAG ?2\.\d|UN\/?ECE Rec(?:ommendation)? ?\d+|GS1 (?:GTIN|GLN|SSCC|GDSN|GPC|EPCIS|GDM|Digital Link|Global Data Model|Application Identifiers?|AIs?|Attribute Definitions)\b|PEPPOL|UBL ?2\.\d|EN ?16931|SAF-T|XBRL|schema\.org\/[A-Z][A-Za-z]+)/g;
const LIST_CONTINUES_RE = /(?:,| and | · |\/)\s*(\d{3,5}(?:-\d+)?)(?![\d-])/g;

/* one key per name: case-blind, letters and digits only, "ISO/IEC 27701" and "ISO 27701" the same, "Recommendation 20" and "Rec 20" the same */
const keyOf = (text) => String(text).toUpperCase().replace(/ISO\/IEC(?:\/IEEE)?/g, 'ISO').replace(/RECOMMENDATION/g, 'REC').replace(/[^A-Z0-9]/g, '');

/** the command line: --root (repeatable), --print, --register, --list; no roots given means the defaults */
function parseArgs(argv) {
  const out = { roots: [], print: false, register: path.join(ROOT, 'public', 'app', 'cap-standards.js'), list: path.join(ROOT, 'public', 'data', 'standards-mentioned.json') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') out.roots.push(path.resolve(argv[++i]));
    else if (argv[i] === '--print') out.print = true;
    else if (argv[i] === '--register') out.register = path.resolve(argv[++i]);
    else if (argv[i] === '--list') out.list = path.resolve(argv[++i]);
  }
  if (!out.roots.length) out.roots = DEFAULT_ROOTS;
  return out;
}

/** the register's rows, read from the source the page reads (no copy) */
function readRegister(file) {
  const context = { tx: (text) => text, esc: (text) => String(text) };
  sandbox.createContext(context);
  sandbox.runInContext(fs.readFileSync(file, 'utf8') + ';this.rows = STANDARDS', context);
  return context.rows;
}

/** every name a row answers for: its own text, its aka names, and each number of an "A and B" list */
function rowKeys(row) {
  const text = [row.n, row.id, row.w || '', row.note || ''].concat(row.aka || []).join(' ');
  const keys = [keyOf(text)];
  for (const cite of text.matchAll(CITE_RE)) {
    keys.push(keyOf(cite[1]));
    const family = cite[1].replace(/\s?\d{3,5}(?:-\d+)?$/, '');
    const tail = text.slice(cite.index + cite[0].length, cite.index + cite[0].length + 60);
    for (const more of tail.matchAll(LIST_CONTINUES_RE)) keys.push(keyOf(family + ' ' + more[1]));
  }
  return keys;
}

/** the named exclusions; a row without its why or its citation is refused, so the list cannot become a silent waiver */
function readAllowList(file) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = parsed.rows || [];
  const incomplete = rows.filter((row) => !row.name || !row.kind || !row.why || !row.cited);
  if (incomplete.length) throw new Error('standards-mentioned.json: every row needs name, kind, why, cited — missing on ' + incomplete.map((row) => row.name || '?').join(', '));
  return rows;
}

/** walk one root; records every cite with the file that names it */
function scanDir(dir, found) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.test(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { scanDir(file, found); continue; }
    if (!SCAN_FILE.test(entry.name) || fs.statSync(file).size > MAX_FILE_BYTES) continue;
    for (const match of fs.readFileSync(file, 'utf8').matchAll(CITE_RE)) {
      const name = match[1].replace(/\s+/g, ' ').trim();
      (found[name] = found[name] || new Set()).add(file.split(path.sep).join('/'));
    }
  }
}

/** every cite under every root that exists; the roots that are not there are returned, never swallowed */
function scanRoots(roots, allowListFile) {
  const found = {}, skipped = [];
  for (const root of roots) {
    if (fs.existsSync(root)) scanDir(root, found); else skipped.push(root);
  }
  delete found[path.basename(allowListFile)];
  return { found, skipped };
}

/** a cite is answered when a register row's keys include it, or an allow-list name equals it */
function judge(found, registerKeys, allowKeys) {
  const missing = [], viaRegister = [], viaAllowList = [];
  for (const name of Object.keys(found).sort()) {
    const key = keyOf(name);
    if (registerKeys.some((keys) => keys.some((rowKey) => rowKey.includes(key)))) viaRegister.push(name);
    else if (allowKeys.has(key)) viaAllowList.push(name);
    else missing.push(name);
  }
  return { missing, viaRegister, viaAllowList };
}

function shortPath(file) { return file.replace(/^.*?\/(chitbridge-[a-z]+|docs|wt-[a-z0-9-]+)\//, '$1/'); }

/** read both lists, scan, print the verdict; 1 when a cite is on neither list or an exclusion is also a row */
function main() {
  const args = parseArgs(process.argv.slice(2));
  const rows = readRegister(args.register);
  const registerKeys = rows.map(rowKeys);
  const allowRows = readAllowList(args.list);
  const allowKeys = new Set(allowRows.map((row) => keyOf(row.name)));
  const onBoth = allowRows.filter((row) => registerKeys.some((keys) => keys.some((rowKey) => rowKey.includes(keyOf(row.name)))));
  const { found, skipped } = scanRoots(args.roots, args.list);
  const verdict = judge(found, registerKeys, allowKeys);
  const cited = Object.keys(found).length;
  console.log('standards-scan: ' + cited + ' standards cited · ' + verdict.viaRegister.length + ' register rows · ' + verdict.viaAllowList.length + ' named as mentioned only · ' + verdict.missing.length + ' on neither');
  if (skipped.length) console.log('  skipped ' + skipped.length + ' root(s) not present here: ' + skipped.map((root) => path.relative(SIBLINGS_DIR, root)).join(', '));
  if (args.print) for (const name of Object.keys(found).sort()) console.log('  ' + name + ' · ' + [...found[name]].slice(0, 3).map(shortPath).join(' | '));
  for (const row of onBoth) console.log('  XX  ' + row.name + ' is on the allow-list AND answered by a register row: remove it from standards-mentioned.json');
  for (const name of verdict.missing) console.log('  XX  ' + name + ' · ' + [...found[name]].slice(0, 3).map(shortPath).join(' | '));
  if (verdict.missing.length || onBoth.length) {
    console.log('A standard we follow is a row of public/app/cap-standards.js (honest status, proof path); one we only name goes in public/data/standards-mentioned.json with why.');
  }
  return verdict.missing.length || onBoth.length ? 1 : 0;
}

if (require.main === module) process.exit(main());
module.exports = { CITE_RE, keyOf, rowKeys, readRegister, readAllowList, scanRoots, judge, DEFAULT_ROOTS };
