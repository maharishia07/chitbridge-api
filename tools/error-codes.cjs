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
 *   node tools/error-codes.cjs --unknown   the codes no route reaches, grouped by reason (raised_by stays [])
 *   node tools/error-codes.cjs --seed      add a PENDING row for every code literal not yet in the table, then rewrite the json
 * raised_by (json only, generated): the routes that raise the code, read by routesOf(); [] = unknown. The ERR-14 "error capture" metric reads it (toolset/coverage/error-capture.cjs).
 * API-STANDARD S14: header `| code | status | title | shopkeeper | hint | owner_area | since |`, no pipe inside a cell.
 */
const fs = require('fs');
const path = require('path');
const { buildGraph } = require('./error-trace.cjs');

const ROOT = path.resolve(__dirname, '..');
const MD_FILE = path.join(ROOT, 'docs', 'ERROR-CODES.md');
const JSON_FILE = path.join(ROOT, 'docs', 'error-codes.json');
const COLUMNS = ['code', 'status', 'title', 'shopkeeper', 'hint', 'owner_area', 'since'];
const START_MARK = '<!-- codes:start -->';
const END_MARK = '<!-- codes:end -->';
const CODE_LITERAL = /code:\s*'([A-Z][A-Z0-9_]+)'/g;
/** a code handed to a refusal helper as a quoted word: refuse(req, res, 400, 'CODE', ...) · books.refuse(msg, 'CODE', 400) · _refuse... (the books ledger raises its codes so, not as code: 'X') */
const REFUSE_CALL = /\b_?refuse_?\(/;
const QUOTED_CODE = /'([A-Z][A-Z0-9]*_[A-Z0-9_]+)'/g;
/** a ['sentence', 'CODE'] pair kept in a table a refusal reads (lib/bank-rec-log.js MARKS_BAD) */
const PAIR_CODE = /\[\s*'[^'\]]* [^'\]]*'[^\]]*?,\s*'([A-Z][A-Z0-9]*_[A-Z0-9_]+)'\s*\]/g;
const SCAN_PLACES = ['routes', 'lib', 'middleware', 'server.js'];
const PENDING = 'PENDING';
const NO_HINT = '-';
/** a status is a number, a number/number pair, or varies (a walk note in this cell once broke a row) */
const STATUS_SHAPE = /^(\d{3}(\/\d{3})?|varies)$/;

/** every .js file under the scanned places */
function sourceFiles(root) {
  const found = [];
  const visit = (target) => {
    if (!fs.existsSync(target)) return;
    /* an ADOPTED engine copy (engines.lock.json) holds the engines' own data words — a tax-line `code: 'GST'` is not an API error code */
    if (fs.statSync(target).isFile()) return target.endsWith('.js') && !fs.readFileSync(target, 'utf8').startsWith('/* ADOPTED') && found.push(target);
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
      const literals = [...line.matchAll(CODE_LITERAL)];
      if (REFUSE_CALL.test(line)) literals.push(...line.slice(line.search(REFUSE_CALL)).matchAll(QUOTED_CODE));
      literals.push(...line.matchAll(PAIR_CODE));
      for (const match of literals) {
        const entry = (codes[match[1]] = codes[match[1]] || { files: [], statuses: [], at: [] });
        entry.at.push([path.relative(root || ROOT, file).split(path.sep).join('/'), index + 1]);
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
    if (row.status && !STATUS_SHAPE.test(row.status)) problems.push(row.code + ' has a status that is not a number, a number/number pair or varies: ' + row.status);
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

/**
 * the scan plus every REGISTERED code written as a quoted word in a line of code (refusal('X', 409, ...) · bad(msg, 409, 'X') · a table of words): a reading for the call graph only,
 * so the register check (scanCodes) is not widened. A line that only compares a code (=== 'X', case 'X') or is a comment does not raise it and is skipped.
 */
function withQuotedCodes(base, scanned) {
  const mdFile = path.join(base, 'docs', 'ERROR-CODES.md');
  const known = new Set(fs.existsSync(mdFile) ? parseTable(fs.readFileSync(mdFile, 'utf8')).rows.map((row) => row.code) : []);
  const out = {};
  Object.keys(scanned).forEach((code) => (out[code] = { at: scanned[code].at.slice() }));
  sourceFiles(base).forEach((file) => {
    const relPath = path.relative(base, file).split(path.sep).join('/');
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      for (const hit of line.matchAll(/(['"])([A-Z][A-Z0-9]*_[A-Z0-9_]+)\1/g)) {
        if (!known.has(hit[2])) continue;
        if (/(?:[=!]==?|\bcase|\.includes\(|\.has\(|indexOf\()\s*$/.test(line.slice(0, hit.index))) continue;
        const entry = (out[hit[2]] = out[hit[2]] || { at: [] });
        if (!entry.at.some(([name, number]) => name === relPath && number === index + 1)) entry.at.push([relPath, index + 1]);
      }
    });
  });
  return out;
}

/**
 * routesOf(root) → { CODE: ['METHOD /path', …] } read from the code, never typed (ERR-14 part 1, "trigger known").
 * Two readings, joined: (a) the route whose own body holds the code literal (docs/api-register.json gives each route its file and first line; the literal counts
 * only while no column-0 line has closed the route, so a code in a helper between two routes is NOT given to the route above it) and
 * (b) the codes the register already follows into helpers two levels deep (errors.codes) and (c) the call graph of tools/error-trace.cjs: every function the route reaches in its file or a require()d module.
 * A code raised only where no route's calls reach (a call that does not resolve) stays [] (unknown, never guessed).
 */
function routesOf(root) {
  const base = root || ROOT;
  const file = path.join(base, 'docs', 'api-register.json');
  const routes = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).routes : [];
  const byFile = {};
  routes.forEach((route) => (byFile[route.file] = byFile[route.file] || []).push(route));
  Object.values(byFile).forEach((list) => list.sort((left, right) => left.line - right.line));
  const found = {};
  const addRoute = (code, key) => ((found[code] = found[code] || new Set()).add(key));
  routes.forEach((route) => ((route.errors && route.errors.codes) || []).forEach((code) => addRoute(code, route.key)));
  const linesOf = {};
  const scanned = scanCodes(base);
  Object.keys(scanned).forEach((code) => scanned[code].at.forEach(([rel, line]) => {
    const list = byFile[rel];
    if (!list) return;
    const route = list.filter((candidate) => candidate.line <= line).pop();
    if (!route) return;
    const lines = (linesOf[rel] = linesOf[rel] || fs.readFileSync(path.join(base, rel), 'utf8').split('\n'));
    for (let at = route.line; at < line; at++) if (/^\S/.test(lines[at] || '')) return;
    addRoute(code, route.key);
  }));
  /* (c) the call graph: the codes of every function the route's body reaches through the same file or a require()d module (tools/error-trace.cjs) */
  const graph = buildGraph(base, withQuotedCodes(base, scanned), sourceFiles(base));
  routes.forEach((route) => {
    const file = path.join(base, route.file);
    if (!fs.existsSync(file)) return;
    const lines = (linesOf[route.file] = linesOf[route.file] || fs.readFileSync(file, 'utf8').split('\n'));
    let end = route.line;
    while (end < lines.length && !/^\S/.test(lines[end] || '')) end++;
    graph.reach(file, route.line, end + 1).forEach((code) => addRoute(code, route.key));
  });
  return Object.fromEntries(Object.keys(found).map((code) => [code, [...found[code]].sort()]));
}

/** unknownsOf(root) → { reason: [CODE…] } the registered codes no route reaches, grouped by why (--unknown prints it) */
function unknownsOf(root) {
  const base = root || ROOT;
  const mdFile = path.join(base, 'docs', 'ERROR-CODES.md');
  const rows = fs.existsSync(mdFile) ? parseTable(fs.readFileSync(mdFile, 'utf8')).rows : [];
  const routes = routesOf(base);
  const seen = withQuotedCodes(base, scanCodes(base));
  const groups = {};
  rows.filter((row) => !(routes[row.code] || []).length).forEach((row) => {
    const places = ((seen[row.code] && seen[row.code].at) || []).map(([rel]) => rel.split('/')[0]);
    const reason = !places.length ? 'written nowhere as a quoted word (built from a variable or prefix, or retired)'
      : places.includes('middleware') || places.includes('server.js') ? 'raised in middleware or server.js, mounted for many routes (no one route owns it)'
        : 'written in ' + [...new Set(places)].sort().join('+') + ' but no route calls or names the function or table that holds it';
    (groups[reason] = groups[reason] || []).push(row.code);
  });
  return groups;
}

/** the json that the table implies (stable text so the check is byte equality); raised_by is GENERATED from the code, never in the table */
const jsonOf = (rows, root) => {
  const routes = routesOf(root);
  const codes = rows.slice().sort((left, right) => (left.code < right.code ? -1 : 1)).map((row) => Object.assign({}, row, { raised_by: routes[row.code] || [] }));
  return JSON.stringify({ generated_from: 'docs/ERROR-CODES.md', columns: COLUMNS, generated_columns: ['raised_by'], codes }, null, 1) + '\n';
};

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
  if (argv.includes('--unknown')) {
    const groups = unknownsOf();
    return Object.keys(groups).forEach((reason) => console.log(groups[reason].length + '  ' + reason + '\n    ' + groups[reason].join(' ')));
  }
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
module.exports = { routesOf, unknownsOf, scanCodes, parseTable, renderTable, readRows, jsonOf, unregistered, pendingCount, check, COLUMNS, PENDING };
