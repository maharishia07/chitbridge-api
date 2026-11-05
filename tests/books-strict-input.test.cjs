#!/usr/bin/env node
/**
 * books-strict-input.test.cjs — S33 strict input, books: a key the route or its library READS is declared in the route's closed body.
 *
 * OWNS      the proof that closing a books write body (lib/books-contract.js, additionalProperties false) refuses nothing the code itself reads.
 *           Found on 1 Nov 2026 (api #682 review): six reads were missed by hand: move-in/preflight sent side/as_at/source_country/source_company
 *           (the Move-in screen's first step would have answered 422), readFile's sheet/header_row, dispose's party_id, the instalment's bank,
 *           fx-rates' from/to/rate_date aliases. This test reads the code, so the next missed read is red here, not on a shop's screen.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: it reads text only.
 * FLOW      lib/books-contract.js ROUTES (closed rows) → the handler in routes/books.js (router.<m>('<p>' or route('<m>', '<p>')
 *           → the body variable (b / body / req.body) → the keys read: v.k · { k } = v · 'k' in v · amountOf(v,'k') (k and k_minor) · dateOf(v[,'k']) · refOf(v) (client_ref)
 *           → every function the body is handed to, in routes/books.js or lib/*.js, two levels deep, at the argument's own position → read ⊆ declared
 * CARD      16-finance/books-routes
 * What it cannot see (each stays a review question): a key read through a computed name (v[name]); a body copied to another name and read there; nested keys.
 *
 *   node tests/books-strict-input.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = path.join(__dirname, '..');
/* the books mount: routes/books.js and the route files it mounts under /api/books (ACC-206 B: routes/books-money.js holds POST /money-check/resolve) */
const ROUTE_FILE = ['books.js', 'books-money.js'].map((name) => fs.readFileSync(path.join(HERE, 'routes', name), 'utf8')).join('\n');
const ROUTE_LINES = ROUTE_FILE.split('\n');
const C = require(path.join(HERE, 'lib', 'books-contract.js'));

let pass = 0;
let fail = 0;
const ok = (name, cond, why) => {
  if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); }
};

/** a key that is a method or property of a value, never a body field */
const NOT_A_FIELD = new Set(['length', 'map', 'filter', 'slice', 'trim', 'toString', 'then', 'catch', 'forEach', 'some', 'every', 'join', 'split', 'includes', 'hasOwnProperty']);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const libCache = {};
const libText = (file) => (libCache[file] = libCache[file] || fs.readFileSync(path.join(HERE, 'lib', file), 'utf8'));

/** a function's text and parameter names, by name, in a source text: function name(...) {…} or const name = (...) => … */
function functionIn(text, name) {
  const decl = new RegExp('^(?:async\\s+)?function\\s+' + esc(name) + '\\s*\\(([^)]*)\\)', 'm').exec(text);
  const arrow = decl ? null : new RegExp('^(?:const|let)\\s+' + esc(name) + '\\s*=\\s*(?:async\\s*)?\\(([^)]*)\\)\\s*=>', 'm').exec(text);
  const found = decl || arrow;
  if (!found) return null;
  const rest = text.slice(found.index);
  const end = decl ? rest.search(/\n\}\s*\n/) : rest.search(/;\n(?=\S)/);
  return { params: found[1].split(',').map((p) => p.trim().split(/[\s=]/)[0]), text: rest.slice(0, end < 0 ? 6000 : end + 2) };
}

/** the lib file a name is bound to in a text: const X = require('../lib/x') or const X = () => require('../lib/x') */
function requiresIn(text) {
  const bound = {};
  for (const m of text.matchAll(/(?:const|let|var)?\s*(\w+)\s*=\s*(?:\(\)\s*=>\s*)?require\('\.\.?\/(?:lib\/)?([\w-]+)(?:\.js)?'\)/g)) bound[m[1]] = m[2] + '.js';
  return bound;
}

/** the keys a text reads from the body variable v, following the functions v is handed to (depth levels) */
function keysRead(text, v, where, depth) {
  const keys = new Set();
  const V = esc(v);
  for (const m of text.matchAll(new RegExp('(?<![\\w.$])' + V + '\\??\\.([A-Za-z_]\\w*)', 'g'))) if (!NOT_A_FIELD.has(m[1])) keys.add(m[1]);
  for (const m of text.matchAll(new RegExp('\\{([^{}]*)\\}\\s*=\\s*' + V + '\\b', 'g')))
    for (const part of m[1].split(',')) { const k = part.trim().split(/[\s:=]/)[0]; if (/^\w+$/.test(k)) keys.add(k); }
  for (const m of text.matchAll(new RegExp("'(\\w+)'\\s+in\\s+" + V + '\\b', 'g'))) keys.add(m[1]);
  for (const m of text.matchAll(new RegExp('\\bamountOf\\(\\s*' + V + "\\s*,\\s*'(\\w+)'", 'g'))) { keys.add(m[1]); keys.add(m[1] + '_minor'); }
  for (const m of text.matchAll(new RegExp('\\bdateOf\\(\\s*' + V + "\\s*(?:,\\s*'(\\w+)')?", 'g'))) keys.add(m[1] || 'date');
  if (new RegExp('\\brefOf\\(\\s*' + V + '\\s*\\)').test(text)) keys.add('client_ref');
  /* an alias of the body (const body = b || {}, const x = b) is the body too */
  for (const m of text.matchAll(new RegExp('(?:const|let|var)\\s+(\\w+)\\s*=\\s*' + V + '(?:\\s*\\|\\|\\s*\\{\\s*\\})?\\s*[;,\\n]', 'g')))
    if (m[1] !== v) for (const k of keysRead(text, m[1], where, depth)) keys.add(k);
  if (depth <= 0) return keys;
  /* every call that hands v on: name(…, v, …) or X.name(…, v, …) or X().name(…, v, …) — read the callee at the same argument position */
  const bound = Object.assign(requiresIn(where.text), requiresIn(text));
  for (const m of text.matchAll(/(?:\b(\w+)(?:\(\))?\.)?\b(\w+)\(/g)) {
    const [whole, owner, fn] = m;
    const args = argsAt(text, m.index + whole.length - 1);
    const at = args.findIndex((a) => a === v || a.replace(/\s+/g, '') === v + '||{}');
    if (at < 0) continue;
    let callee = null;
    let next = where;
    if (owner && bound[owner] && fs.existsSync(path.join(HERE, 'lib', bound[owner]))) {
      next = { file: bound[owner], text: libText(bound[owner]) };
      callee = functionIn(next.text, fn);
    } else if (!owner) {
      callee = functionIn(where.text, fn);
    }
    if (!callee || !/^\w+$/.test(callee.params[at] || '')) continue;
    for (const k of keysRead(callee.text, callee.params[at], next, depth - 1)) keys.add(k);
  }
  return keys;
}

/** the top-level arguments of a call whose "(" is at index open, as trimmed source strings */
function argsAt(text, open) {
  const out = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open; i < text.length && i < open + 2000; i++) {
    const ch = text[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) { out.push(text.slice(start, i).trim()); return out; }
    } else if (ch === ',' && depth === 1) { out.push(text.slice(start, i).trim()); start = i + 1; }
  }
  return out;
}

/** the handler of a route in routes/books.js: from its registration line to the next registration */
function handlerOf(method, p) {
  const m = method.toLowerCase();
  const at = ROUTE_LINES.findIndex((l) => l.startsWith('router.' + m + "('" + p + "'") || l.startsWith("route('" + m + "', '" + p + "'"));
  if (at < 0) return null;
  /* a handler ends at its own closing line at column 0 ("});" or "  });" of route(), or the line that closes a one-line route(...)), never at the next route:
     a function written between two routes is not part of either */
  let end = at;
  if (!/\);\s*$/.test(ROUTE_LINES[at]) || /\{\s*$/.test(ROUTE_LINES[at])) {
    end = at + 1;
    while (end < ROUTE_LINES.length && !/^\}\);\s*$/.test(ROUTE_LINES[end]) && !/^(router\.\w+\(|route\()/.test(ROUTE_LINES[end])) end++;
  }
  return ROUTE_LINES.slice(at, end + 1).join('\n');
}

/** the names the handler gives the body: b = req.body || {}, body = req.body, the wrapper's (req, e, s, b, by) */
function bodyNames(handler) {
  const names = new Set(['req.body']);
  for (const m of handler.matchAll(/(\w+)\s*=\s*(?:\(\s*)?req\.body\b/g)) names.add(m[1]);
  if (/^route\(/.test(handler) && /\(req, e, s, b, by\)/.test(handler)) names.add('b');
  return [...names];
}

/** req handed on: a local function given req reads req.body inside it (and may hand req on again: depth levels) */
function readsViaReq(handler, depth = 3) {
  const keys = new Set();
  if (depth <= 0) return keys;
  for (const m of handler.matchAll(/\b(\w+)\(\s*req\b/g)) {
    const fn = functionIn(ROUTE_FILE, m[1]);
    if (!fn || fn.params[0] !== 'req') continue;
    for (const name of bodyNames(fn.text)) for (const k of keysRead(fn.text, name, { file: 'routes/books.js', text: ROUTE_FILE }, 2)) keys.add(k);
    for (const k of readsViaReq(fn.text.slice(fn.text.indexOf('{')), depth - 1)) keys.add(k);
  }
  return keys;
}

/* ── 1 · the reader itself, on a made-up handler: each pattern found, a key it should not see left alone ── */
{
  const where = { file: 'x', text: "function helper(x) { return x.deep + amountOf(x, 'cost'); }\n" };
  const text = "const b = req.body || {}; const { a1, a2: renamed } = b; if ('a3' in b) {} b.a4; dateOf(b); refOf(b); helper(b); other.k5; b.length;\nconst body = b || {};\nbody.a6;";
  const got = keysRead(text, 'b', where, 2);
  const want = ['a1', 'a2', 'a3', 'a4', 'a6', 'date', 'client_ref', 'deep', 'cost', 'cost_minor'];
  ok('the reader finds direct, destructured, in, alias, dateOf, refOf, amountOf (k and k_minor) and a helper\'s reads', want.every((k) => got.has(k)), [...got].join(','));
  ok('…and leaves another value\'s key and a method alone', !got.has('k5') && !got.has('length'), [...got].join(','));
}

/* ── 2 · every closed books write body: what the route and its libraries read is declared ── */
const declaredOf = (op) => {
  const schema = op && op.requestBody && op.requestBody.content['application/json'].schema;
  return schema ? { closed: schema.additionalProperties === false, keys: new Set(Object.keys(schema.properties || {})) } : null;
};
let checked = 0;
for (const [key, op] of Object.entries(C.OPERATIONS)) {
  const decl = declaredOf(op);
  if (!decl || !decl.closed) continue;
  const [method, full] = key.split(' ');
  const p = full.replace('/api/books', '');
  const handler = handlerOf(method, p);
  if (!handler) { ok(key + ': its handler is found in routes/books.js', false); continue; }
  const read = readsViaReq(handler);
  for (const name of bodyNames(handler)) for (const k of keysRead(handler, name, { file: 'routes/books.js', text: ROUTE_FILE }, 2)) read.add(k);
  const missing = [...read].filter((k) => !decl.keys.has(k));
  ok(key + ': every key it reads is declared (' + read.size + ' read)', missing.length === 0, 'read but not declared: ' + missing.join(', '));
  checked++;
}
ok('the closed books bodies were all checked (44 on 1 Nov 2026; fewer means a row lost its closing rule)', checked >= 44, 'checked ' + checked);

console.log('\n  ' + (fail ? '✗ ' + fail + ' failed' : '✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);
