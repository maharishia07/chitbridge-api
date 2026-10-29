#!/usr/bin/env node
/*
 * OWNS      deriving each route's CLOSED success schema from what it answers today, so the output_allowlist column (API-STANDARD S34) is reached without a behaviour change:
 *           the keys of the recorded answers (a sweep test's --capture file) ∪ the keys the handler's own `res.json({...})` literals name, nested ones too; a node whose keys cannot be known
 *           (a row passed through, a spread) stays OPEN and is LISTED, never forced.
 * CALLED BY a sweep PR (by hand, once per route file) · tests/api-allowlist.test.cjs. Writes docs/contracts/api-output-shapes.json, which lib/contract-kit.js reads (lib/output-allowlist.js shapeOf).
 * FLOW      capture F (route|scenario → answer) + the route file's handler text → foldValues → closeNode → shapes[routeKey] = { status, schema, observed, open } → api-output-shapes.json
 *           → contractOf success schema → outputFilter (lib/output-allowlist.js) → the generated output_allowlist case sees the canary pruned → docs/contracts/api-hardening-evidence.json
 * CARD      28-platform-and-operations/api-standard
 *
 *   node tools/api-allowlist.cjs --capture F [--capture G ...] --file routes/assist.js            show what would be written (no file touched)
 *   node tools/api-allowlist.cjs --capture F --file routes/assist.js --write                       merge those routes' shapes into docs/contracts/api-output-shapes.json
 *   node tools/api-allowlist.cjs --capture F --file routes/assist.js --web                         also list keys the web callers read near each call that the shape lacks (a review list)
 *   node tools/api-allowlist.cjs --check F ...                                                     every recorded success answer in F passes through its route's shape unchanged (exit 1 if not)
 *
 * The rule that keeps it honest: a key is in the schema if it was SEEN in an answer or NAMED in the handler's literal. A node is closed (additionalProperties: false) only when its keys come from
 * a literal or from a recorded object; an identifier handed to res.json (rows, a row, a spread) is open and listed with its path. The runtime filter logs and counts every key it ever drops.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHAPES_FILE = path.join(ROOT, 'docs', 'contracts', 'api-output-shapes.json');
const REGISTER_FILE = path.join(ROOT, 'docs', 'api-register.json');
const DYNAMIC_KEYS = 40; /* an object with more keys than this, or keys that look like ids or dates, is a map keyed by data, not a record */
const KEY_LOOKS_LIKE_DATA = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-|\d{4}-\d\d-\d\d|\d+$)/i;
const ROUTE_START = /^\s*(?:router|app)\.(?:get|post|put|patch|delete|all|use)\s*\(/;

/* ── what the answers show ─────────────────────────────────────────────────────────────────────── */
const typeName = (value) => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value);

/** fold many values into one picture: the types seen, per key every value seen under it, and every array element seen */
function foldValues(values) {
  const stats = { count: values.length, types: new Set(values.map(typeName)), objects: 0, keys: new Map(), items: null };
  const objects = values.filter((value) => typeName(value) === 'object');
  stats.objects = objects.length;
  objects.forEach((value) => Object.keys(value).forEach((key) => {
    if (!stats.keys.has(key)) stats.keys.set(key, { seen: 0, values: [] });
    const entry = stats.keys.get(key);
    entry.seen += 1;
    entry.values.push(value[key]);
  }));
  const elements = values.filter((value) => Array.isArray(value)).flat();
  if (elements.length) stats.items = foldValues(elements);
  return stats;
}

/* ── what the handler's literals name ──────────────────────────────────────────────────────────── */
/** if a string, template or comment starts at `at`, the index of its last character; else `at` itself */
function skipText(text, at) {
  const mark = text[at];
  if (mark === "'" || mark === '"' || mark === '`') return skipString(text, at);
  if (mark === '/' && text[at + 1] === '/') return lineEnd(text, at);
  if (mark === '/' && text[at + 1] === '*') return blockEnd(text, at);
  return at;
}
/** index of the end of the line that holds `at` */
const lineEnd = (text, at) => (text.indexOf('\n', at) < 0 ? text.length : text.indexOf('\n', at));
/** index of the last character of the block comment that starts at `at` */
const blockEnd = (text, at) => (text.indexOf('*/', at) < 0 ? text.length : text.indexOf('*/', at) + 1);

/** index of the bracket that closes the one at `start`, skipping strings, template text and comments; -1 when it never closes */
function closingOf(text, start) {
  const pairs = { '(': ')', '{': '}', '[': ']' };
  const stack = [];
  for (let at = start; at < text.length; at++) {
    const skipped = skipText(text, at);
    if (skipped !== at) at = skipped;
    else if (pairs[text[at]]) stack.push(pairs[text[at]]);
    else if (text[at] === stack[stack.length - 1]) {
      stack.pop();
      if (!stack.length) return at;
    }
  }
  return -1;
}

/** index of the last character of the string or template that opens at `start` (a template's ${...} is skipped whole) */
function skipString(text, start) {
  const quote = text[start];
  for (let at = start + 1; at >= 0 && at < text.length; at++) {
    if (text[at] === '\\') at += 1;
    else if (quote === '`' && text[at] === '$' && text[at + 1] === '{') at = closingOf(text, at + 1);
    else if (text[at] === quote) return at;
  }
  return text.length;
}

/** the top-level pieces of a bracketed text, split on commas that are not inside a bracket, string or comment */
function splitTop(inner) {
  const parts = [];
  let from = 0;
  for (let at = 0; at < inner.length; at++) {
    const skipped = skipText(inner, at);
    if (skipped !== at) at = skipped;
    else if ('({['.includes(inner[at])) at = closingOf(inner, at) < 0 ? inner.length : closingOf(inner, at);
    else if (inner[at] === ',') {
      parts.push(inner.slice(from, at));
      from = at + 1;
    }
  }
  parts.push(inner.slice(from));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** every key a text names as a literal key at any depth: `name:` (not after ? in a ternary) and shorthand `{ name,` / `, name }` */
function tokensOf(text) {
  const found = new Set();
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1 ');
  for (const match of stripped.matchAll(/(?:^|[{,(]\s*)(?:'([\w$-]+)'|"([\w$-]+)"|([A-Za-z_$][\w$]*))\s*:(?!:)/gm)) found.add(match[1] || match[2] || match[3]);
  for (const match of stripped.matchAll(/[{,]\s*([A-Za-z_$][\w$]*)\s*(?=[,}])/g)) found.add(match[1]);
  return found;
}

/** the shape of a value expression in the handler: { kind: 'object', keys: Map(name → node), spread, computed } for a literal, else { kind: 'opaque', tokens, spread } */
function nodeOf(expression) {
  const text = expression.trim();
  if (text.startsWith('{') && closingOf(text, 0) === text.length - 1) return objectNodeOf(text);
  return { kind: 'opaque', tokens: tokensOf(text), spread: /\.\.\.\s*[\w$(\[{]/.test(text) };
}

/** an entry of a literal without the comments written before its key (a comment is not a computed key) */
const withoutLeadingComments = (entry) => entry.replace(/^(?:\s*(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*))+\s*/, '');

/** a literal `{ a: 1, b, ...c, [d]: 2 }` as an object node */
function objectNodeOf(text) {
  const node = { kind: 'object', keys: new Map(), spread: false, computed: false };
  splitTop(text.slice(1, -1)).map(withoutLeadingComments).forEach((entry) => {
    if (entry.startsWith('...')) node.spread = true;
    else if (entry.startsWith('[')) node.computed = true;
    else {
      const named = /^(?:'([\w$-]+)'|"([\w$-]+)"|([A-Za-z_$][\w$]*))\s*(:|$)/.exec(entry);
      if (!named) node.computed = true;
      else node.keys.set(named[1] || named[2] || named[3], named[4] === ':' ? nodeOf(entry.slice(named[0].length)) : { kind: 'opaque', tokens: new Set(), spread: false, shorthand: true });
    }
  });
  return node;
}

/** merge two source nodes of the same place (two branches of a handler that both answer there) */
function mergeNodes(left, right) {
  if (!left) return right;
  if (!right) return left;
  if (left.kind === 'object' && right.kind === 'object') {
    const keys = new Map(left.keys);
    right.keys.forEach((node, name) => keys.set(name, mergeNodes(keys.get(name), node)));
    return { kind: 'object', keys, spread: left.spread || right.spread, computed: left.computed || right.computed };
  }
  return { kind: 'opaque', tokens: new Set([...tokensOfNode(left), ...tokensOfNode(right)]), spread: spreadOfNode(left) || spreadOfNode(right) };
}
/** every key name written anywhere under a handler node */
const tokensOfNode = (node) => (node.kind === 'opaque' ? node.tokens : new Set([...node.keys.keys()].concat([...node.keys.values()].flatMap((child) => [...tokensOfNode(child)]))));
/** whether a spread or a computed key sits anywhere under a handler node */
const spreadOfNode = (node) => (node.kind === 'opaque' ? node.spread : node.spread || node.computed || [...node.keys.values()].some(spreadOfNode));

/**
 * the success answers a handler text writes: { node, helper } — `node` is the merged shape of every `res.json(<arg>)` / `res.status(2xx).json(<arg>)` outside a refusal;
 * `helper` is true when the text hands the answer to something else (so its keys cannot be read from here)
 */
function handlerAnswers(text) {
  let node = null;
  let calls = 0;
  for (const match of text.matchAll(/\bres\s*(?:\.status\(\s*(\d{3})\s*\))?\s*\.json\s*\(/g)) {
    const status = match[1] ? Number(match[1]) : 200;
    const open = match.index + match[0].length - 1;
    const close = closingOf(text, open);
    if (status >= 300 || close < 0) continue;
    const argument = splitTop(text.slice(open + 1, close))[0];
    if (argument === undefined) continue;
    calls += 1;
    node = mergeNodes(node, nodeOf(argument));
  }
  return { node, calls };
}

/** the text of a route's handler: from its registration line to the next route registration (or the file's end) */
function handlerText(lines, startLine) {
  let end = lines.length;
  for (let at = startLine; at < lines.length; at++) {
    if (ROUTE_START.test(lines[at])) {
      end = at;
      break;
    }
  }
  return lines.slice(startLine - 1, end).join('\n');
}

/* ── closing the schema ────────────────────────────────────────────────────────────────────────── */
/** { type } from the types seen at a leaf: one scalar type (null widens it), else any */
function leafSchema(stats) {
  if (!stats) return {};
  const scalars = [...stats.types].filter((type) => type !== 'null' && type !== 'object' && type !== 'array');
  if (stats.types.size === 1 && stats.types.has('null')) return {};
  if (scalars.length === 1 && stats.types.size - (stats.types.has('null') ? 1 : 0) === 1) return { type: stats.types.has('null') ? [scalars[0], 'null'] : scalars[0] };
  return {};
}

/** is an object's key set a map keyed by data (ids, dates, very many keys), not a record of named fields */
const keyedByData = (names) => names.length > DYNAMIC_KEYS || (names.length > 2 && names.filter((name) => KEY_LOOKS_LIKE_DATA.test(name)).length > names.length / 2);

/** the keys a node may hold: seen in the answers, named in the literal; null when they cannot be known (the node stays open, with the reason) */
function keysOf(stats, source, where, open) {
  const seen = stats ? [...stats.keys.keys()] : [];
  if (source && source.kind === 'object') {
    if (source.spread || source.computed) return open(where, source.spread ? 'a spread (...x) adds keys the text does not name' : 'a computed key'), null;
    return [...new Set(seen.concat([...source.keys.keys()]))];
  }
  if (namesTokens(source)) return [...new Set(seen.concat([...source.tokens]))];
  return open(where, whyOpen(source)), null;
}

/** a passed-through value whose handler text names keys and spreads nothing */
const namesTokens = (source) => !!source && source.kind === 'opaque' && source.tokens.size > 0 && !source.spread;

/** the reason a node whose keys are not written stays open */
function whyOpen(source) {
  if (!source) return 'never seen and not written in the handler';
  if (source.spread) return 'a spread (...x) adds keys the text does not name';
  return 'a value passed through (' + (source.shorthand ? 'a name' : 'an expression') + ': its keys are not written in the handler)';
}

/** an array node: its items closed from the elements seen (and the handler's text there when it is a value passed through) */
function closeArray(stats, source, where, open) {
  const nullable = stats.types.has('null') ? ['array', 'null'] : 'array';
  return { type: nullable, items: closeNode(stats.items, source && source.kind === 'opaque' ? source : null, where + '[]', open) };
}

/** a closed record that is null in another branch of the handler says so: type [object, null] */
const orNull = (stats, closed) => (stats && stats.types.has('null') && closed.type === 'object' ? Object.assign({}, closed, { type: ['object', 'null'] }) : closed);

/** one node of the schema from the answers seen there (stats) and the handler's text there (source) */
function closeNode(stats, source, where, open) {
  const holdsObject = !!stats && stats.objects > 0;
  const holdsArray = !!stats && !!stats.items;
  if (holdsObject && holdsArray) return {};
  if (holdsArray) return closeArray(stats, source, where, open);
  if (holdsObject || (source && source.kind === 'object')) return orNull(stats, closeObject(holdsObject ? stats : null, source, where, open));
  return leafSchema(stats);
}

/** each named key's own node: from the values seen under it and the handler's text under it */
function propertiesOf(names, { stats, source, where, open }) {
  const properties = {};
  names.forEach((name) => {
    const child = stats && stats.keys.get(name);
    const childSource = source && source.kind === 'object' ? source.keys.get(name) : source;
    properties[name] = closeNode(child ? foldValues(child.values) : null, childSource, (where ? where + '.' : '') + name, open);
  });
  return properties;
}

/** the keys present in every answer seen (and written in the literal, when there is one) */
function requiredOf(stats, names, source) {
  if (!stats || !stats.objects) return [];
  const literal = source && source.kind === 'object';
  return names.filter((name) => stats.keys.get(name) && stats.keys.get(name).seen === stats.objects && (!literal || source.keys.has(name)));
}

/** an object node: closed over the keys known, each key's own node below it; open (and listed) when the keys cannot be known */
function closeObject(stats, source, where, open) {
  const names = keysOf(stats, source, where || '(answer)', open);
  if (!names) return { type: 'object' };
  if (keyedByData(names)) return open(where || '(answer)', 'a map keyed by data (' + names.length + ' keys)'), { type: 'object' };
  const properties = propertiesOf(names, { stats, source, where, open });
  const required = requiredOf(stats, names, source);
  return Object.assign({ type: 'object' }, required.length ? { required } : {}, { properties, additionalProperties: false });
}

/** deriveShape({ samples: [body...], source: node|null }) → { schema, open: [{ path, reason }] } */
function deriveShape({ samples, source }) {
  const openPaths = [];
  const open = (where, reason) => openPaths.push({ path: where, reason });
  const schema = closeNode(foldValues(samples), source, '', open);
  return { schema, open: openPaths };
}

/* ── the files ─────────────────────────────────────────────────────────────────────────────────── */
const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (unreadable) {
    return fallback;
  }
};

/** the success answers of one route in captures: { status: [bodies] } (JSON bodies of 2xx only, ONE per scenario even when several captures hold it; the recorded key is 'METHOD /path|scenario') */
function samplesOf(captures, routeKey) {
  const byStatus = {};
  captures.forEach((capture) => Object.keys(capture).forEach((key) => {
    const recorded = capture[key];
    if (recorded.route !== routeKey || recorded.status < 200 || recorded.status > 299 || recorded.body === undefined || recorded.body === null || typeof recorded.body !== 'object') return;
    const scenario = key.split('|').slice(1).join('|'); /* the same scenario in BASE and NEW is ONE answer seen, not two */
    byStatus[recorded.status] = byStatus[recorded.status] || new Map();
    if (!byStatus[recorded.status].has(scenario)) byStatus[recorded.status].set(scenario, recorded.body);
  }));
  return Object.fromEntries(Object.entries(byStatus).map(([status, scenarios]) => [status, [...scenarios.values()]]));
}

/** the first recorded request that reached the success status: { example: { url, body } }, or nothing when no capture kept the request */
function exampleOf(captures, routeKey, status) {
  for (const capture of captures) {
    const keys = Object.keys(capture).sort();
    const found = keys.map((key) => capture[key]).find((recorded) => recorded.route === routeKey && String(recorded.status) === String(status) && recorded.request && recorded.request.url);
    if (found) return { example: Object.assign({ url: found.request.url }, found.request.body === undefined ? {} : { body: found.request.body }) };
  }
  return {};
}

/** the routes of one route file from the register: [{ key, line }] */
const routesOfFile = (file) => (readJson(REGISTER_FILE, { routes: [] }).routes || []).filter((row) => row.file === file).map((row) => ({ key: row.key, line: row.line }));

/** the shape of every route of a file: { shapes: {key: entry}, listed: {key: reason} } */
function deriveFile(file, captures) {
  const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');
  const result = { shapes: {}, listed: {} };
  routesOfFile(file).forEach((route) => {
    const byStatus = samplesOf(captures, route.key);
    const statuses = Object.keys(byStatus);
    if (!statuses.length) return void (result.listed[route.key] = 'not reached: no recorded request reaches a success answer, so there is no shape (observed 0); add a scenario that does, or leave the route partial');
    const answers = handlerAnswers(handlerText(lines, route.line));
    const status = statuses.includes('200') ? '200' : statuses[0] || '200';
    const derived = deriveShape({ samples: byStatus[status] || [], source: answers.node });
    result.shapes[route.key] = Object.assign({ status, schema: derived.schema, observed: (byStatus[status] || []).length, open: derived.open }, exampleOf(captures, route.key, status));
    if (derived.open.length) result.listed[route.key] = 'open at ' + derived.open.map((item) => (item.path || '(answer)') + ' — ' + item.reason).join('; ');
  });
  return result;
}

/** the keys the web callers read near each call of a route that the shape does not list (a review list, never written into a shape) */
function webReadsMissing(file, shapes) {
  const callers = require('./endpoint-usage-callers.cjs');
  const webDir = process.env.CB_WEB_DIR || path.join(ROOT, '..', 'chitbridge-web');
  const rows = Object.keys(shapes).map((key) => ({ key, method: key.split(' ')[0], full: key.split(' ')[1] }));
  const { hits } = callers.scanAll(callers.sources(ROOT, webDir, path.join(ROOT, '..', 'chitbridge-engines')).filter((source) => source.repo === 'web'), rows, []);
  const missing = {};
  hits.forEach((found) => {
    const row = rows[found.route];
    if (!row) return;
    const lines = fs.readFileSync(found.src.abs, 'utf8').split('\n');
    const window = lines.slice(Math.max(0, found.line - 1), found.line + 24).join('\n');
    const known = tokensOfNode({ kind: 'opaque', tokens: new Set(Object.keys((shapes[row.key].schema || {}).properties || {})) });
    for (const match of window.matchAll(/\b(?:r|res|data|d|j|resp|result|body|out|json)\.([a-z_][a-z0-9_]*)\b/g)) if (!known.has(match[1])) (missing[row.key] = missing[row.key] || new Set()).add(match[1] + ' (' + found.src.relPath + ':' + found.line + ')');
  });
  return Object.fromEntries(Object.entries(missing).map(([key, set]) => [key, [...set]]));
}

/** write the shapes into docs/contracts/api-output-shapes.json (other routes' rows stay as they are) */
function writeShapes(result) {
  const file = readJson(SHAPES_FILE, null) || { _about: 'The CLOSED success schema of a route, derived from what it answers today (tools/api-allowlist.cjs): the keys of the recorded answers plus the keys its handler names. lib/contract-kit.js uses it as the route\'s success schema and puts the output allow-list filter (lib/output-allowlist.js) in front of the handler. `listed` = routes or nodes left open, with the reason.', routes: {}, listed: {} };
  Object.assign(file.routes, result.shapes);
  Object.keys(result.shapes).forEach((key) => delete file.listed[key]);
  Object.keys(result.listed).filter((key) => !result.shapes[key]).forEach((key) => delete file.routes[key]); /* a route no recorded answer reaches keeps no shape */
  Object.assign(file.listed, result.listed);
  const sorted = (object) => Object.fromEntries(Object.keys(object).sort().map((key) => [key, object[key]]));
  fs.writeFileSync(SHAPES_FILE, JSON.stringify({ _about: file._about, routes: sorted(file.routes), listed: sorted(file.listed) }, null, 1) + '\n');
}

/** --check: every success answer recorded passes through its route's shape unchanged → the keys that would be lost */
function checkCaptures(captures) {
  const { prune } = require('../lib/output-allowlist');
  const shapes = readJson(SHAPES_FILE, { routes: {} }).routes;
  const lost = [];
  captures.forEach((capture) => Object.keys(capture).forEach((key) => {
    const recorded = capture[key];
    const shape = shapes[recorded.route];
    if (!shape || String(recorded.status) !== String(shape.status) || !recorded.body || typeof recorded.body !== 'object') return;
    prune(shape.schema, recorded.body).dropped.forEach((where) => lost.push(key + ' lost ' + where));
  }));
  return lost;
}

/** the value after each occurrence of a flag: values(['--capture','a','--capture','b'], '--capture') → ['a','b'] */
const flagValues = (argv, flag) => argv.reduce((all, arg, at) => (arg === flag && argv[at + 1] ? all.concat(argv[at + 1]) : all), []);

/** the shapes and listed routes of every --file, from the captures */
function deriveFiles(files, captures) {
  const merged = { shapes: {}, listed: {} };
  files.forEach((file) => {
    const derivedFile = deriveFile(file, captures);
    Object.assign(merged.shapes, derivedFile.shapes);
    Object.assign(merged.listed, derivedFile.listed);
  });
  return merged;
}

/** print the count line, every LISTED route with its reason, and (with --web) the keys callers read that the shapes lack */
function report(merged, files, withWeb) {
  const shaped = Object.keys(merged.shapes);
  const closed = shaped.filter((key) => !merged.shapes[key].open.length);
  const unshaped = Object.keys(merged.listed).filter((key) => !merged.shapes[key]);
  console.log('routes ' + (shaped.length + unshaped.length) + ' · shaped ' + shaped.length + ' · fully closed ' + closed.length + ' · open somewhere ' + (shaped.length - closed.length));
  Object.keys(merged.listed).forEach((key) => console.log('  LISTED ' + key + ': ' + merged.listed[key]));
  if (!withWeb) return;
  const missing = webReadsMissing(files[0], merged.shapes);
  Object.keys(missing).forEach((key) => console.log('  WEB READS (not in the shape, review) ' + key + ': ' + missing[key].join(', ')));
}

/** the command line: --check F | --capture F [--capture G] --file routes/x.js [--write] [--web]; the exit code */
function main(argv) {
  const captures = flagValues(argv, '--capture').concat(flagValues(argv, '--check')).map((file) => readJson(file, null)).filter(Boolean);
  if (argv.includes('--check')) {
    const lost = checkCaptures(captures);
    console.log(lost.length ? lost.join(String.fromCharCode(10)) : 'every recorded success answer passes the output allow-list unchanged');
    return lost.length ? 1 : 0;
  }
  const files = flagValues(argv, '--file');
  if (!captures.length || !files.length) return console.log('usage: --capture F [--capture G] --file routes/x.js [--write] [--web]  |  --check F'), 2;
  const merged = deriveFiles(files, captures);
  report(merged, files, argv.includes('--web'));
  if (argv.includes('--write')) writeShapes(merged);
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { foldValues, nodeOf, handlerAnswers, handlerText, closingOf, splitTop, tokensOf, deriveShape, deriveFile, samplesOf, checkCaptures, writeShapes, mergeNodes, SHAPES_FILE };
