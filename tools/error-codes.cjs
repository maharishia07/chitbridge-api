#!/usr/bin/env node
'use strict';
/*
 * OWNS      docs/ERROR-CODES.md (the error-code register, hand-edited table) and docs/error-codes.json (generated from it); the scan of every `code: 'X'` in the code.
 * CALLED BY tools/api-register.cjs (check) · tools/api-ratchet.cjs (a new code must be registered) · lib/problem.js reads the json.
 * FLOW      scan code literals ──▶ --seed adds the missing codes as PENDING rows ──▶ parse the table ──▶ write the json ──▶ --check fails on a drift, a duplicate or an empty cell
 * CARD      28-platform-and-operations/api-standard
 *
 *   node tools/error-codes.cjs --check     the table parses, no duplicate, no empty cell, the json equals it, every code in the code is a row
 *   node tools/error-codes.cjs --write     rewrite docs/error-codes.json from the table
 *   node tools/error-codes.cjs --seed      add a PENDING row for every code literal not yet in the table, then rewrite the json
 * API-STANDARD S14: header `| code | status | title | shopkeeper | hint | owner_area | since |`, no pipe inside a cell.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MD_FILE = path.join(ROOT, 'docs', 'ERROR-CODES.md');
const JSON_FILE = path.join(ROOT, 'docs', 'error-codes.json');
const COLUMNS = ['code', 'status', 'title', 'shopkeeper', 'hint', 'owner_area', 'since'];
const START_MARK = '<!-- codes:start -->';
const END_MARK = '<!-- codes:end -->';
const CODE_LITERAL = /code:\s*'([A-Z][A-Z0-9_]+)'/g;
const SCAN_PLACES = ['routes', 'lib', 'middleware', 'server.js'];
const PENDING = 'PENDING';
const NO_HINT = '-';

/** every .js file under the scanned places */
function sourceFiles(root) {
  const found = [];
  const visit = (target) => {
    if (!fs.existsSync(target)) return;
    if (fs.statSync(target).isFile()) return target.endsWith('.js') && found.push(target);
    fs.readdirSync(target).forEach((name) => visit(path.join(target, name)));
  };
  SCAN_PLACES.forEach((place) => visit(path.join(root, place)));
  return found.sort();
}

/** the HTTP statuses written near a code literal (its own line and the two before it) */
function statusesNear(lines, index) {
  const window = lines.slice(Math.max(0, index - 2), index + 1).join(' ');
  return [...window.matchAll(/status\(\s*(\d{3})\s*\)|status:\s*(\d{3})/g)].map((match) => match[1] || match[2]);
}

/** scanCodes(root) → { CODE: { files:[basename], statuses:[…] } } from every `code: 'UPPER_SNAKE'` literal */
function scanCodes(root) {
  const codes = {};
  sourceFiles(root || ROOT).forEach((file) => {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      for (const match of line.matchAll(CODE_LITERAL)) {
        const entry = (codes[match[1]] = codes[match[1]] || { files: [], statuses: [] });
        const area = path.basename(file, '.js');
        if (!entry.files.includes(area)) entry.files.push(area);
        statusesNear(lines, index).forEach((status) => entry.statuses.includes(status) || entry.statuses.push(status));
      }
    });
  });
  return codes;
}

/** parseTable(markdown) → { rows, problems } — rows are objects keyed by COLUMNS; problems are sentences */
function parseTable(markdown) {
  const problems = [];
  const start = markdown.indexOf(START_MARK);
  const end = markdown.indexOf(END_MARK);
  if (start < 0 || end < start) return { rows: [], problems: ['the table markers ' + START_MARK + ' / ' + END_MARK + ' are missing'] };
  const lines = markdown.slice(start + START_MARK.length, end).split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines[0] !== '| ' + COLUMNS.join(' | ') + ' |') problems.push('the header must be | ' + COLUMNS.join(' | ') + ' |');
  const rows = lines.slice(2).map((line) => {
    const cells = line.replace(/^\|\s*/, '').replace(/\s*\|$/, '').split(' | ').map((cell) => cell.trim());
    return Object.fromEntries(COLUMNS.map((name, position) => [name, cells[position] === undefined ? '' : cells[position]]));
  });
  const seen = new Set();
  rows.forEach((row) => {
    if (seen.has(row.code)) problems.push('duplicate code ' + row.code);
    seen.add(row.code);
    COLUMNS.filter((name) => row[name] === '' || row[name] === undefined).forEach((name) => problems.push(row.code + ' has an empty ' + name));
  });
  return { rows, problems };
}

/** renderTable(rows) → the markdown block between the markers, rows sorted by code */
function renderTable(rows) {
  const sorted = rows.slice().sort((left, right) => (left.code < right.code ? -1 : 1));
  const lines = ['| ' + COLUMNS.join(' | ') + ' |', '|' + COLUMNS.map(() => '---').join('|') + '|'];
  sorted.forEach((row) => lines.push('| ' + COLUMNS.map((name) => row[name]).join(' | ') + ' |'));
  return lines.join('\n');
}

/** a code as a title: STOCK_SHORT becomes "Stock short" */
const humanise = (code) => {
  const words = code.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** the seed row for a scanned code: status and owner area from the code, the rest PENDING for the owning area to write */
function seedRow(code, found, today) {
  return { code, status: found.statuses.slice().sort().join('/') || 'varies', title: humanise(code), shopkeeper: PENDING, hint: NO_HINT, owner_area: found.files.sort()[0], since: today };
}

const readRows = () => (fs.existsSync(MD_FILE) ? parseTable(fs.readFileSync(MD_FILE, 'utf8')) : { rows: [], problems: ['docs/ERROR-CODES.md is missing'] });

/** the json that the table implies (stable text so the check is byte equality) */
const jsonOf = (rows) => JSON.stringify({ generated_from: 'docs/ERROR-CODES.md', columns: COLUMNS, codes: rows.slice().sort((left, right) => (left.code < right.code ? -1 : 1)) }, null, 1) + '\n';

/** codes in the code that the table does not know */
function unregistered(rows, root) {
  const known = new Set(rows.map((row) => row.code));
  return Object.keys(scanCodes(root)).filter((code) => !known.has(code)).sort();
}

/** how many rows still wait for their shopkeeper sentence (the ratchet counts this down) */
const pendingCount = (rows) => rows.filter((row) => row.shopkeeper === PENDING).length;

/** --check: the table parses, has no duplicate or empty cell, and every code literal in the code is in it */
function check() {
  const { rows, problems } = readRows();
  const missing = unregistered(rows);
  if (missing.length) problems.push('code literals not in docs/ERROR-CODES.md: ' + missing.join(', '));
  const jsonOnDisk = fs.existsSync(JSON_FILE) ? fs.readFileSync(JSON_FILE, 'utf8') : '';
  if (jsonOnDisk !== jsonOf(rows)) problems.push('docs/error-codes.json is not what the table says: run node tools/error-codes.cjs --write');
  return { rows, problems };
}

/** --seed: add every unregistered code as a PENDING row, then write the json */
function seedAndWrite(today) {
  const existing = readRows().rows;
  const scanned = scanCodes();
  const added = Object.keys(scanned).filter((code) => !existing.some((row) => row.code === code)).map((code) => seedRow(code, scanned[code], today));
  const rows = existing.concat(added);
  const head = fs.existsSync(MD_FILE) ? fs.readFileSync(MD_FILE, 'utf8').split(START_MARK)[0] : '# Error codes\n\n';
  const tail = fs.existsSync(MD_FILE) ? fs.readFileSync(MD_FILE, 'utf8').split(END_MARK)[1] || '\n' : '\n';
  fs.writeFileSync(MD_FILE, head + START_MARK + '\n' + renderTable(rows) + '\n' + END_MARK + tail);
  fs.writeFileSync(JSON_FILE, jsonOf(rows));
  return added.length;
}

/** command line: --check, --seed, or write the json from the table */
function main(argv) {
  if (argv.includes('--seed')) return console.log('seeded ' + seedAndWrite(new Date().toISOString().slice(0, 10)) + ' new rows');
  if (argv.includes('--write')) {
    const { rows } = readRows();
    fs.writeFileSync(JSON_FILE, jsonOf(rows));
    return console.log('wrote docs/error-codes.json (' + rows.length + ' codes)');
  }
  const { rows, problems } = check();
  problems.forEach((sentence) => console.log('FAIL ' + sentence));
  console.log(rows.length + ' codes, ' + pendingCount(rows) + ' waiting for their shopkeeper sentence' + (problems.length ? '' : ' - register ok'));
  process.exitCode = problems.length ? 1 : 0;
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { scanCodes, parseTable, renderTable, readRows, jsonOf, unregistered, pendingCount, check, COLUMNS, PENDING };
