'use strict';
/*
 * @stage tested
 * OWNS      column 21 of the API register, paged_read (PERF1 · DISCIPLINES §2: a read answers a handful of records, the rest lazy-loads): what one GET route does about the size of its answer, as pure functions over source text.
 * CALLED BY tools/api-reported.cjs (pagedReadColumn) · tools/paged-reads-scan.cjs · tests/paged-read.test.cjs
 * FLOW      a route's handler text + its file + the libs it requires ──▶ factsOf() ──▶ { kind, mode, default, max, unasked, via } ──▶ causesOf() ──▶ [] (holds) or the named causes
 * CARD      28-platform-and-operations/api-standard
 *
 * Reuses, never copies: lib/page-limit.js (the ONE pager: limitOf / pageArgs / pageOut) · lib/resource-cap.js (isListRead: the one "is this a list read" test) · lib/list-allowance.js (the reads that are one record, a summary or a fixed vocabulary, with their reason).
 * What it adds over resource_cap (column 16, "the limit has a cap"): resource_cap only looks at a list that READS a limit. This column asks the question Athi put on 26 Nov 2026: "how many records does a read fetch, and when
 * nothing is asked, is it lazy?" — so it also names the list that reads NO limit at all, and the pager's own "not asked = every row" (page-limit pageArgs, books pageQ).
 *
 *   kind     'list' (a GET that answers rows) · 'single' (one record, a summary, a vocabulary: lib/list-allowance, or a handler that answers no rows) · 'n/a' (not a GET)
 *   mode     'keyset' (?after=) · 'offset' (?page= / ?offset=) · 'none'
 *   default  rows a page answers when asked, no size named: a number, a constant's NAME when it is not a literal, or null
 *   max      the server's own maximum: a number, a constant's NAME, or null (the client's word is the only limit)
 *   unasked  'bounded' (no ?limit= still answers one default page) · 'everything' (no ?limit= answers every matching row: pageArgs / pageQ "null = nothing asked", or no paging at all) · 'unknown' (only the query schema's maximum is visible: the runtime report settles it) · 'n/a'
 *   causes   no_server_max (a list with no maximum) · whole_when_unasked (a list that answers everything when nothing is asked)
 */
const fs = require('fs');
const path = require('path');
const { isListRead } = require('./resource-cap');
const { reasonFor } = require('./list-allowance');

const CAUSES = ['no_server_max', 'whole_when_unasked'];

/** a handler that answers rows read off a statement (the same test tests/list-paging-guard.test.cjs always held): `.rows` other than `.rows[0]` / `.rows.length`, with a res.json */
const ANSWERS_ROWS = /\.rows(?!\s*\[\s*0\s*\])(?!\s*\.\s*length)/;
/** a call that names the page size: limitOf(x, DEFAULT, MAX) or pageArgs(x, DEFAULT, MAX) — the two arguments after the first, each a number or a name */
const SIZED_CALL = /\b(limitOf|pageArgs)\s*\(((?:[^()]|\([^()]*\))*)\)/g;
/** pageArgs handed an object whose `limit` always has a fallback ({ page, limit: x || DEFAULT } or x != null ? x : DEFAULT): asked is then always true, so nothing-asked is one default page */
const ALWAYS_SIZED = /pageArgs\s*\(\s*\{[^}]*\blimit\s*:[^}]*(?:\|\||\?[^}]*:)/;
const NUMBER_OR_NAME = /^(?:\d+|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)$/;

/** the last two top-level arguments of a call's argument text, as 'default' and 'max' (each a number, a name, or null) */
function sizeArgs(argText, constants) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const char of argText) {
    if (char === '(' || char === '{' || char === '[') depth++;
    else if (char === ')' || char === '}' || char === ']') depth--;
    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else current += char;
  }
  parts.push(current.trim());
  if (parts.length < 3) return null;
  const read = (token) => {
    if (!NUMBER_OR_NAME.test(token)) return null;
    if (/^\d+$/.test(token)) return Number(token);
    const name = token.split('.').pop();
    return Object.prototype.hasOwnProperty.call(constants, name) ? constants[name] : token;
  };
  return { default: read(parts[parts.length - 2]), max: read(parts[parts.length - 1]) };
}

/** NAME = number declarations in a text (const A = 5, B = 7; or A: 5 in an object) */
function constantsIn(text) {
  const found = {};
  for (const match of String(text).matchAll(/(?:^|[\s,{(])([A-Z][A-Z0-9_]*)\s*[=:]\s*(\d+)\b/g)) if (!(match[1] in found)) found[match[1]] = Number(match[2]);
  return found;
}

/** the lib files a routes file requires ('../lib/x'), as { name -> text }, read once */
const LIB_TEXT = new Map();
function libTextOf(root, name) {
  const file = path.join(root, 'lib', name + '.js');
  if (!LIB_TEXT.has(file)) LIB_TEXT.set(file, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
  return LIB_TEXT.get(file);
}
const requiredLibs = (fileText) => [...String(fileText).matchAll(/require\(\s*['"]\.\.\/lib\/([\w-]+)['"]\s*\)/g)].map((match) => match[1]);

/** the body of every function in `text` that itself reads the page (calls limitOf / pageArgs), by name — a "page reader" the handler may call */
function pageReadersIn(text) {
  const readers = {};
  const head = /(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/g;
  for (const match of String(text).matchAll(head)) if (/\b(?:limitOf|pageArgs)\s*\(/.test(match[2])) readers[match[1]] = match[0];
  return readers;
}

/** the handler's text, with the body of every page reader it calls (in its own file or in a lib the file requires) appended */
function treeWithReaders(treeText, fileText, root) {
  /* lib/page-limit.js is the pager itself: its own limitOf(v, dflt, max) is not a route's size */
  const texts = [fileText].concat(requiredLibs(fileText).filter((name) => name !== 'page-limit').map((name) => libTextOf(root, name)));
  const parts = [treeText];
  const seen = new Set();
  for (const text of texts) {
    const readers = pageReadersIn(text);
    for (const [name, body] of Object.entries(readers)) {
      if (!seen.has(name) && new RegExp('\\b' + name + '\\s*\\(').test(treeText)) {
        seen.add(name);
        parts.push(body);
      }
    }
  }
  return { text: parts.join('\n'), constants: Object.assign({}, ...texts.slice().reverse().map(constantsIn)) };
}

/** the declared bounds of the query's limit (middleware/validate urlSchemaOf): { default, max } or null */
function declaredSize(urlSchema) {
  const properties = (urlSchema && urlSchema.properties) || {};
  const fragment = properties.limit || properties.per_page;
  if (!fragment) return null;
  return { default: typeof fragment.default === 'number' ? fragment.default : null, max: typeof fragment.maximum === 'number' ? fragment.maximum : null };
}

/**
 * the paged-read facts of one route.
 *   { method, file, path, text, treeText, fileText, urlSchema, root }  text = the handler's own source; treeText = the handler plus the same-file functions it calls (tools/api-reported callTreeSource)
 */
function factsOf({ method, file, path: routePath, text, treeText, fileText, urlSchema, root }) {
  if (method !== 'GET') return { kind: 'n/a', mode: 'none', default: null, max: null, unasked: 'n/a', via: null };
  const handler = String(text || '');
  const tree = String(treeText || handler);
  const { text: all, constants } = treeWithReaders(tree, fileText || '', root || path.join(__dirname, '..'));
  const declared = declaredSize(urlSchema);
  const reason = reasonFor(file, routePath);
  const pages = isListRead({ method, urlSchema, text: all });
  const answersRows = ANSWERS_ROWS.test(handler) && /res\.json\(/.test(handler);
  const keyset = /\bquery\.after\b|\bpageQ\s*\(|'after'|\bafter\s*:/.test(all) || !!(urlSchema && urlSchema.properties && urlSchema.properties.after);
  const offset = /\bquery\.(?:page|offset)\b|\b(?:pageArgs|pageOf|offsetOf)\s*\(/.test(all) || !!(urlSchema && urlSchema.properties && (urlSchema.properties.page || urlSchema.properties.offset));
  const mode = keyset ? 'keyset' : offset ? 'offset' : 'none';
  /* a read that is one record, a summary or a vocabulary says so (the allowance) and is a list only if it pages anyway */
  if (!pages && !answersRows) return { kind: 'single', mode, default: null, max: null, unasked: 'n/a', via: 'no rows answered' };
  if (reason && !pages) return { kind: 'single', mode, default: null, max: null, unasked: 'n/a', via: 'allowed: ' + reason };
  /* the size: the last call that names it in the handler, its page reader, or the declared query schema */
  let size = null;
  let via = null;
  for (const match of all.matchAll(SIZED_CALL)) {
    const args = sizeArgs(match[2], constants);
    if (args && args.max !== null && !(size && size.max !== null)) { /* the first call that names a maximum: the handler's own comes before the readers appended after it */
      size = args;
      via = match[1];
    }
  }
  if (!size && declared && (declared.max !== null || declared.default !== null)) {
    size = declared;
    via = 'schema';
  }
  const sized = !!size && size.max !== null;
  /* nothing asked: limitOf always answers [1, max] (bounded); pageArgs answers every row unless it is handed a limit with a fallback; pageQ answers null = every row; the schema's default bounds it */
  let unasked = 'everything';
  if (via === 'limitOf') unasked = 'bounded';
  if (via === 'schema') unasked = size.default !== null ? 'bounded' : 'unknown'; /* the schema bounds a limit that is asked for; with no default the handler's own answer to "nothing asked" is in a lib the scan cannot follow: the runtime report (tools/paged-reads-report.cjs) settles it */
  if (via === 'pageArgs') unasked = ALWAYS_SIZED.test(all) ? 'bounded' : 'everything';
  if (/limit\s*==\s*null[^\n]*return null/.test(all)) unasked = 'everything'; /* a page reader that answers null when nothing is asked (books pageQ) */
  return { kind: 'list', mode, default: size ? size.default : null, max: sized ? size.max : null, unasked, via: via || (pages ? 'reads limit/page, names no maximum' : 'rows answered, no paging') };
}

/** the causes the column fails on (empty = holds) — a single read holds */
function causesOf(facts) {
  if (!facts || facts.kind !== 'list') return [];
  const causes = [];
  if (facts.max === null) causes.push('no_server_max');
  if (facts.unasked === 'everything') causes.push('whole_when_unasked');
  return causes;
}

module.exports = { CAUSES, factsOf, causesOf, sizeArgs, constantsIn };
