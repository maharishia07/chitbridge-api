/*
 * OWNS      who calls an endpoint: the caller sources of all three repos, the path literals in them, and the match to a route.
 * CALLED BY tools/endpoint-usage.cjs (--buckets · --md) · tools/endpoint-usage-report.cjs
 * FLOW      sources(API, WEB, ENG) -> scanSource(file) -> matchPaths(route list) -> hits [{ route, cls, kind, file, line, strength }]
 * CARD      janitor/endpoint-usage
 *
 * 2026-10-23 (Athi: "get the usage summary and void api or endpoint which are not necessary"). The first version of this tool read
 * only app.html, shop.html and public/app/*.js, so 213 routes read as "not in the registry at all". This module widens WHO is read,
 * never what is done with it: read-only, nothing is written or removed.
 *
 * Caller class (the bucket a caller votes for):
 *   A  a shop-facing screen or the till        B  our own tooling (tests, walks, CI, scripts, labs, engines, the api calling itself)
 *   C  from outside (the storefront, the connector kit, a public page)
 *
 * ⚠️ A COMMENT IS NOT A CALL. Comments are blanked before any literal is read, or every "FLOW  load -> POST /api/chits/send" header
 * would make its route look used. A literal is a call only when it can be matched to a route's shape (a static segment must equal a
 * static segment; a dynamic segment meets only a :param), so '/api/chits/' + id never claims GET /api/chits/inbox.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SKIP_DIR = /^(node_modules|\.git|vendor|engine|out|png|assets|pics|illustrations|data|docs|design-handoff|design-style2?|migrations|screenshots)$/;
const CODE_EXT = /\.(html|js|cjs|mjs|yml|yaml|sh)$/;
const STOREFRONT_PAGES = /^(shop|embed|store|network-shop)\.html$/;
const LAB_PAGES = /^(.*-lab(-next)?|.*-design|design-mock|screen-gallery|standards|testing|lifecycle-test|iot-howitworks)\.html$/;
const LAB_SCRIPTS = /^(cap-testing|cap-standards|lab-kit|country-compare|country-ready)\.js$/;
const METHOD_WORD = '(GET|POST|PUT|PATCH|DELETE)';
const LITERAL = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
/* a client registry entry NAMES a route, it does not call it (the key's api('key') does) */
const REGISTRY_ENTRY = /\bm:\s*["']\w+["']\s*,\s*p:/;
const SELF_CALL_LINE = /fetch\(|selfBase|sendAs|request\(|https?\.|axios|\.call\(|\.get\(|\.post\(/;

/** Blank comments with spaces (newlines kept, so line numbers stay true). */
function stripComments(text, isHtml) {
  const blank = (match) => match.replace(/[^\n]/g, ' ');
  let out = text.replace(/\/\*[\s\S]*?\*\//g, blank);
  if (isHtml) out = out.replace(/<!--[\s\S]*?-->/g, blank);
  return out.replace(/(^|[^:'"\w\\/])\/\/[^\n]*/g, (match, lead) => lead + blank(match.slice(lead.length)));
}

/** Every file under dir that can hold a call, as repo-relative paths with forward slashes. */
function walkFiles(root, dir, out) {
  let entries = [];
  try {
    entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
  } catch (_) {
    return out; /* a repo that is not checked out beside this one: its callers are simply not counted, and the report says so */
  }
  for (const entry of entries) {
    const relPath = dir ? dir + '/' + entry.name : entry.name;
    if (entry.isDirectory() && !SKIP_DIR.test(entry.name)) walkFiles(root, relPath, out);
    else if (entry.isFile() && CODE_EXT.test(entry.name)) out.push(relPath);
  }
  return out;
}

/** The class and kind a web file votes with. */
function webClass(relPath) {
  const base = relPath.split('/').pop();
  if (/^e2e\//.test(relPath)) return { cls: 'B', kind: /^e2e\/walk-/.test(relPath) ? 'walk' : 'e2e' };
  if (/^(tests|scripts|tools|\.github)\//.test(relPath)) return { cls: 'B', kind: 'web-tooling' };
  if (STOREFRONT_PAGES.test(base)) return { cls: 'C', kind: 'storefront' };
  if (LAB_PAGES.test(base) || LAB_SCRIPTS.test(base)) return { cls: 'B', kind: 'lab' };
  return { cls: 'A', kind: base.endsWith('.html') ? 'page' : 'screen-script' };
}

/** The class and kind an api file votes with. */
function apiClass(relPath) {
  if (/^tools\/tally-connector\//.test(relPath)) return { cls: 'C', kind: 'connector' };
  if (/^tests\//.test(relPath)) return { cls: 'B', kind: /realstack/.test(relPath) ? 'real-stack' : 'unit' };
  if (/^\.github\//.test(relPath)) return { cls: 'B', kind: 'ci' };
  if (/^(scripts|tools)\//.test(relPath)) return { cls: 'B', kind: 'script' };
  if (/-contract\.js$|^routes\/openapi\.js$/.test(relPath)) return null; /* a contract names routes as data, it calls none */
  return { cls: 'B', kind: 'self-call', lineFilter: SELF_CALL_LINE };
}

/** Every caller source of the three repos with the vote it casts. */
function sources(API, WEB_ROOT, ENGINES_ROOT) {
  const out = [];
  const addSources = (repo, root, rels, classify) => {
    for (const relPath of rels) {
      const vote = classify(relPath);
      if (vote) out.push(Object.assign({ repo, relPath, abs: path.join(root, relPath), label: repo + ':' + relPath }, vote));
    }
  };
  const webRels = ['index.html']
    .filter((item) => fs.existsSync(path.join(WEB_ROOT, item)))
    .concat(
      walkFiles(WEB_ROOT, 'public', []),
      walkFiles(WEB_ROOT, 'e2e', []),
      walkFiles(WEB_ROOT, 'tests', []),
      walkFiles(WEB_ROOT, 'scripts', []),
      walkFiles(WEB_ROOT, 'tools', []),
      walkFiles(WEB_ROOT, '.github', [])
    );
  addSources(
    'web',
    WEB_ROOT,
    webRels.filter((item) => !/^tools\/graph\//.test(item)),
    webClass
  );
  const apiRels = ['server.js'].concat(
    ['lib', 'routes', 'src', 'middleware', 'tests', 'scripts', 'tools', '.github'].flatMap((dir) => walkFiles(API, dir, []))
  );
  addSources(
    'api',
    API,
    apiRels.filter((item) => !/^(tools\/(endpoint-usage|api-register|api-ratchet|round-trips|server-mounts|error-codes)|tests\/endpoint-usage)/.test(item)),
    apiClass
  );
  addSources('engines', ENGINES_ROOT, walkFiles(ENGINES_ROOT, 'src', []), () => ({ cls: 'B', kind: 'engine', lineFilter: SELF_CALL_LINE }));
  return out;
}

/** A piece followed by `+ expr` is open (a dynamic tail); followed by `+ expr +` more it is only a prefix. */
function markOpenEnds(line, pieces) {
  for (const piece of pieces) {
    const rest = /^\s*\+\s*[\w$.]+(?:\([^()]*\))?(\s*\+)?/.exec(line.slice(piece.end));
    piece.open = !!rest;
    piece.more = !!(rest && rest[1]);
  }
}

/** Literals on one line, with `'/a/' + x + '/b'` joined into one piece and a trailing `+ expr` marked open. */
function piecesOf(line) {
  const out = [];
  let prev = null;
  LITERAL.lastIndex = 0;
  for (let match = LITERAL.exec(line); match; match = LITERAL.exec(line)) {
    const text = match[2].replace(/\$\{[^}]*\}/g, ':p');
    const between = prev ? line.slice(prev.end, match.index) : '';
    const bare = /^\s*\+\s*$/.test(between);
    if (prev && (bare || /^\s*\+\s*[^'"`;]{1,60}\+\s*$/.test(between))) {
      prev.text += (bare ? '' : ':p') + text;
      prev.end = match.index + match[0].length;
    } else {
      prev = { text, start: match.index, end: match.index + match[0].length };
      out.push(prev);
    }
  }
  markOpenEnds(line, out);
  return out;
}

/** A path literal as a candidate: segments, which are dynamic, and whether it is only a prefix. */
function candidateOf(piece) {
  const at = piece.text.indexOf('/api/');
  if (at < 0 && !/^\/(\.well-known|health)/.test(piece.text)) return null;
  const text = pathOf(piece, at);
  const segs = text.split('/').filter(Boolean);
  if (segs.length < 2 && at >= 0) return null;
  return { segs, dyn: segs.map(isDynamic), prefix: piece.more || (piece.open && !text.endsWith(':p')) };
}

/** The path part of a literal: from /api/, query cut, and a trailing slash before `+ id` turned into a dynamic segment. */
function pathOf(piece, at) {
  const text = piece.text.slice(Math.max(at, 0)).split(/[?#]/)[0];
  return piece.open && !piece.more && text.endsWith('/') ? text + ':p' : text;
}

/** A segment is dynamic when it is a :param or carries an expression that was joined in. */
function isDynamic(segment) {
  return segment.charAt(0) === ':' || segment.indexOf(':p') >= 0;
}

/** The HTTP method the call names near the literal, or null when it cannot be told. */
function methodNear(lines, index, before) {
  return methodBefore(before) || methodAfter(lines, index);
}

/** A method named just before the literal: call('POST', '/x') · .post('/x') · post('/x'). */
function methodBefore(before) {
  const found =
    new RegExp(METHOD_WORD + '[\'"]?\\s*,\\s*$', 'i').exec(before) ||
    new RegExp('\\.' + METHOD_WORD.toLowerCase() + '\\(\\s*$').exec(before) ||
    new RegExp('\\b' + METHOD_WORD.toLowerCase() + '[A-Za-z]*\\(\\s*$', 'i').exec(before);
  return found ? found[1].toUpperCase() : null;
}

/** A `method: 'POST'` option on this line or the next three (stopping at the next path literal). */
function methodAfter(lines, index) {
  for (let step = 0; step < 4 && lines[index + step] !== undefined; step++) {
    if (step && /\/api\//.test(lines[index + step])) return null;
    const found = new RegExp('method\\s*:\\s*[\'"]' + METHOD_WORD, 'i').exec(lines[index + step]);
    if (found) return found[1].toUpperCase();
  }
  return null;
}

/** Does the candidate name the route (static meets static or :param; dynamic meets only :param)? */
function shapeMatches(cand, route) {
  const count = cand.segs.length;
  if (cand.prefix ? route.segs.length < count : route.segs.length !== count) return false;
  const limit = cand.prefix ? count - 1 : count;
  for (let i = 0; i < limit; i++) {
    const param = route.segs[i].charAt(0) === ':' || route.segs[i] === '*';
    if (cand.dyn[i] ? !param : !param && cand.segs[i] !== route.segs[i]) return false;
  }
  return true;
}

/** Index routes by their first two segments, so a candidate meets only its own mount. */
function indexRoutes(routes) {
  const index = new Map();
  routes.forEach((route, id) => {
    route.segs = route.full.split('/').filter(Boolean);
    const key = route.segs.slice(0, 2).join('/');
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(id);
  });
  return index;
}

/** All hits of one source against the route list. */
function scanSource(source, text, routes, index) {
  const lines = stripComments(text, /\.html$/.test(source.relPath)).split('\n');
  const hits = [];
  lines.forEach((line, at) => {
    if (line.indexOf('/') >= 0 && !REGISTRY_ENTRY.test(line) && !(source.lineFilter && !source.lineFilter.test(line)))
      hits.push(...hitsOfLine(lines, at, routes, index));
  });
  return hits;
}

/** The hits of one line: each path literal on it against the routes of its own mount. */
function hitsOfLine(lines, at, routes, index) {
  const line = lines[at];
  const hits = [];
  for (const piece of piecesOf(line)) {
    const cand = candidateOf(piece);
    if (!cand || cand.dyn[0] || cand.dyn[1]) continue;
    const method = methodNear(lines, at, line.slice(Math.max(0, piece.start - 90), piece.start));
    hits.push(...routeHits(cand, method, at + 1, routes, index));
  }
  return hits;
}

/** The routes under the candidate's own mount that it names, with how sure the match is. */
function routeHits(cand, method, line, routes, index) {
  const found = [];
  for (const id of index.get(cand.segs.slice(0, 2).join('/')) || []) {
    if (!shapeMatches(cand, routes[id]) || (method && routes[id].method !== method)) continue;
    found.push({ route: id, line, strength: cand.prefix ? 'prefix' : method ? 'exact' : 'path-only' });
  }
  return found;
}

/** api('key') / testEvery('key') calls and bare 'key' mentions of the client registry, over one source. */
function scanKeys(source, text, keyRegex) {
  const hits = [];
  if (!keyRegex) return hits;
  const lines = stripComments(text, /\.html$/.test(source.relPath)).split('\n');
  const call = new RegExp('(?:api|testEvery)\\(\\s*[\'"](' + keyRegex + ')[\'"]', 'g');
  const mention = new RegExp('[\'"](' + keyRegex + ')[\'"]', 'g');
  lines.forEach((line, at) => {
    if (/\w+:\s*\{\s*m:\s*["']/.test(line)) return;
    const calls = [...line.matchAll(call)];
    for (const match of calls) hits.push({ key: match[1], line: at + 1, strength: 'key-call' });
    if (calls.length) return;
    for (const match of line.matchAll(mention)) hits.push({ key: match[1], line: at + 1, strength: 'key-mention' });
  });
  return hits;
}

/** Scan every source: path hits and key hits, as flat rows [{ src, route|key, line, strength }]. */
function scanAll(srcs, routes, registryKeys) {
  const index = indexRoutes(routes);
  const keyRegex = registryKeys.length ? registryKeys.join('|') : '';
  const out = [];
  const texts = {};
  for (const source of srcs) {
    let text = '';
    try {
      text = fs.readFileSync(source.abs, 'utf8');
    } catch (_) {
      continue; /* unreadable file: not counted */
    }
    if (source.kind === 'walk') texts[source.label] = text;
    for (const found of scanSource(source, text, routes, index)) out.push(Object.assign({ src: source }, found));
    for (const found of scanKeys(source, text, keyRegex)) out.push(Object.assign({ src: source }, found));
  }
  return { hits: out, walkTexts: texts };
}

module.exports = { sources, scanAll, stripComments, piecesOf, candidateOf, shapeMatches };
