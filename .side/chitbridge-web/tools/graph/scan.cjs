/**
 * tools/graph/scan.cjs — the hand-written source scanner behind tools/graph/graph.cjs (KG1, 2026-10-12).
 *
 * OWNS      the lexer (code with strings and comments blanked · the strings list) and the per-file scan: functions · calls · refs ·
 *           requires · joined paths · exports · globals · api keys/paths · SQL tables · markup handlers.
 * CALLED BY tools/graph/graph.cjs (build), tools/graph/trace.cjs through it, e2e/knowledge-graph.cjs (the guard on this tool).
 * FLOW      lex(src) ──▶ scanJs(code, strings) | scanHtml(src) ──▶ { functions, calls, requires, joinedPaths, … } ──▶ graph.build()
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/knowledge-graph
 *
 * No parser dependency: acorn/espree are in none of the three repos' lockfiles, and a dependency was ruled out for this
 * round. What this does instead is a one-pass lexer that KNOWS strings, template literals (with `${…}` nesting),
 * comments and regex literals, and hands back two views of a file:
 *   code     the same bytes with every comment and every string BODY blanked to spaces (newlines kept — offsets and
 *            line numbers stay true), so a `{` in an HTML string or a `foo(` in a comment can never fool brace matching
 *   strings  every string body with its offset, so `api('key')`, SQL text, `onclick="foo()"` and `/api/...` paths are
 *            still read — from the strings, where they live
 *
 * ⚠️ Why not widen e2e/screen-reads.cjs: its brace matcher is "crude on purpose" (its own words), reads only
 * app.html + app/*.js, and is a budget ratchet, not a graph. e2e/missing-functions.cjs and dead-surface.cjs know the
 * declaration forms of this codebase; those forms are reproduced here on purpose (same regex shapes) so the three agree.
 *
 * Exports (pure, deterministic, no I/O):
 *   lex(src)                      → { code, strings:[{start,end,text,q}] }
 *   scanJs(src, {baseLine})       → { functions, calls, refs, requires, exports, globals, apiKeys, apiPaths, sql, handlers }
 *   scanHtml(src)                 → { scripts:[{src}], inline:[{code, baseLine, offset}], handlers:[names] }
 *   sqlTables(text)               → { reads:Set, writes:Set }
 */
'use strict';

const KEYWORDS = new Set(
  (
    'if else for while do switch case default break continue return function typeof instanceof new delete void ' +
    'throw try catch finally in of var let const class extends super this null true false undefined async await yield import export ' +
    'with debugger'
  ).split(' ')
); /* get · set · static are contextual: lib/bill-use.js declares `async function set(` */
/* a `/` after one of these words starts a regex, not a division */
const REGEX_AFTER = new Set('return typeof case in of do else void delete throw new instanceof await yield'.split(' '));

/* ── 1 · the lexer ───────────────────────────────────────────────────────────────────────────────────────────────── */
function lex(src) {
  const n = src.length;
  const out = new Array(n);
  const strings = [];
  let index = 0;
  /* template nesting: each entry is the brace depth at which the `${` opened */
  const list = [];
  let depth = 0;
  const isIdent = (c) => /[A-Za-z0-9_$]/.test(c);
  const lastSig = (upto) => {
    let k = upto - 1;
    while (k >= 0 && /\s/.test(out[k] || src[k])) k--;
    return k;
  };
  const prevWord = (k) => {
    let e = k + 1,
      s = k;
    while (s >= 0 && isIdent(src[s])) s--;
    return src.slice(s + 1, e);
  };
  const blankTo = (from, to) => {
    for (let k = from; k < to; k++) out[k] = src[k] === '\n' ? '\n' : ' ';
  };
  const keep = (k) => {
    out[k] = src[k];
  };

  while (index < n) {
    const c = src[index],
      d = src[index + 1];
    if (c === '/' && d === '/') {
      const e = src.indexOf('\n', index);
      const end = e < 0 ? n : e;
      blankTo(index, end);
      index = end;
      continue;
    }
    if (c === '/' && d === '*') {
      let e = src.indexOf('*/', index + 2);
      e = e < 0 ? n : e + 2;
      blankTo(index, e);
      index = e;
      continue;
    }
    if (c === "'" || c === '"') {
      keep(index);
      let k = index + 1;
      while (k < n && src[k] !== c && src[k] !== '\n') {
        if (src[k] === '\\') k++;
        k++;
      }
      strings.push({ start: index + 1, end: k, text: src.slice(index + 1, k), q: c });
      blankTo(index + 1, k);
      if (k < n) keep(k);
      index = k + 1;
      continue;
    }
    if (c === '`') {
      keep(index);
      let k = index + 1,
        segStart = k;
      while (k < n) {
        if (src[k] === '\\') {
          k += 2;
          continue;
        }
        if (src[k] === '`') break;
        if (src[k] === '$' && src[k + 1] === '{') {
          break;
        }
        k++;
      }
      strings.push({ start: segStart, end: Math.min(k, n), text: src.slice(segStart, Math.min(k, n)), q: '`' });
      blankTo(segStart, Math.min(k, n));
      if (k < n && src[k] === '`') {
        keep(k);
        index = k + 1;
        continue;
      }
      if (k < n) {
        keep(k);
        keep(k + 1);
        list.push(depth);
        depth++;
        index = k + 2;
        continue;
      }
      index = k;
      continue;
    }
    if (c === '{') {
      keep(index);
      depth++;
      index++;
      continue;
    }
    if (c === '}') {
      if (list.length && depth - 1 === list[list.length - 1]) {
        /* end of a `${…}` — back into the template's literal text */
        keep(index);
        depth--;
        list.pop();
        let k = index + 1,
          segStart = k;
        while (k < n) {
          if (src[k] === '\\') {
            k += 2;
            continue;
          }
          if (src[k] === '`') break;
          if (src[k] === '$' && src[k + 1] === '{') break;
          k++;
        }
        strings.push({ start: segStart, end: Math.min(k, n), text: src.slice(segStart, Math.min(k, n)), q: '`' });
        blankTo(segStart, Math.min(k, n));
        if (k < n && src[k] === '`') {
          keep(k);
          index = k + 1;
          continue;
        }
        if (k < n) {
          keep(k);
          keep(k + 1);
          list.push(depth);
          depth++;
          index = k + 2;
          continue;
        }
        index = k;
        continue;
      }
      keep(index);
      depth--;
      index++;
      continue;
    }
    if (c === '/') {
      const p = lastSig(index);
      const pc = p >= 0 ? src[p] : '';
      let regex = p < 0 || !(isIdent(pc) || pc === ')' || pc === ']' || pc === '}' || pc === "'" || pc === '"' || pc === '`');
      if (!regex && isIdent(pc) && REGEX_AFTER.has(prevWord(p))) regex = true;
      if (regex) {
        let k = index + 1,
          cls = false;
        while (k < n && src[k] !== '\n') {
          if (src[k] === '\\') {
            k += 2;
            continue;
          }
          if (cls) {
            if (src[k] === ']') cls = false;
            k++;
            continue;
          }
          if (src[k] === '[') {
            cls = true;
            k++;
            continue;
          }
          if (src[k] === '/') break;
          k++;
        }
        if (k < n && src[k] === '/') {
          keep(index);
          blankTo(index + 1, k);
          keep(k);
          k++;
          while (k < n && /[a-z]/.test(src[k])) {
            keep(k);
            k++;
          }
          index = k;
          continue;
        }
        /* not a regex after all (an unterminated one) — treat as division */
      }
      keep(index);
      index++;
      continue;
    }
    keep(index);
    index++;
  }
  return { code: out.join(''), strings };
}

/* ── 2 · helpers over the blanked code ───────────────────────────────────────────────────────────────────────────── */
function lineAt(text, pos) {
  let count = 1;
  for (let index = 0; index < pos && index < text.length; index++) if (text.charCodeAt(index) === 10) count++;
  return count;
}

/** a line index that turns an offset into a line number in O(log n) */
function lineIndex(text) {
  const starts = [0];
  for (let index = 0; index < text.length; index++) if (text.charCodeAt(index) === 10) starts.push(index + 1);
  return (pos) => {
    let count = 0,
      hi = starts.length - 1;
    while (count < hi) {
      const mid = (count + hi + 1) >> 1;
      if (starts[mid] <= pos) count = mid;
      else hi = mid - 1;
    }
    return count + 1;
  };
}

/** index of the bracket that closes the one at `open` (code is blanked, so strings cannot fool it); -1 if none */
function matchBracket(code, open) {
  const o = code[open],
    c = o === '{' ? '}' : o === '(' ? ')' : ']';
  let count = 0;
  for (let i = open; i < code.length; i++) {
    const ch = code[i];
    if (ch === o) count++;
    else if (ch === c) {
      count--;
      if (!count) return i;
    }
  }
  return -1;
}

/** the body range of a function whose parameter list opens at `paren`: { bodyStart, bodyEnd } (bodyEnd = index of the closing brace) */
function bodyAfterParams(code, paren) {
  const close = matchBracket(code, paren);
  if (close < 0) return null;
  let k = close + 1;
  while (k < code.length && /\s/.test(code[k])) k++;
  if (code.slice(k, k + 2) === '=>') {
    k += 2;
    while (k < code.length && /\s/.test(code[k])) k++;
  }
  if (code[k] === '{') {
    const e = matchBracket(code, k);
    return e < 0 ? null : { bodyStart: k, bodyEnd: e };
  }
  /* an expression-bodied arrow: to the end of the statement (`;` or a newline at depth 0) */
  let count = 0,
    i = k;
  for (; i < code.length; i++) {
    const ch = code[i];
    if (ch === '(' || ch === '[' || ch === '{') count++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (count === 0) break;
      count--;
    } else if ((ch === ';' || ch === '\n' || ch === ',') && count === 0) break;
  }
  return { bodyStart: k, bodyEnd: i };
}

/* ── 3 · SQL: which tables a text reads and writes ───────────────────────────────────────────────────────────────── */
const SQL_STOP = new Set(
  (
    'unnest jsonb_each jsonb_each_text jsonb_array_elements jsonb_array_elements_text jsonb_to_recordset json_each ' +
    'json_array_elements generate_series lateral select values only set where dual information_schema pg_catalog pg_tables pg_class ' +
    'pg_policies pg_indexes pg_namespace pg_attribute pg_constraint regexp_split_to_table string_to_table now the a an this which ' +
    'each all any some into from join on as and or not null true false if exists when then end case with recursive table temp ' +
    'temporary unlogged view index trigger function returning conflict do nothing update delete insert excluded'
  ).split(' ')
);
const SQL_KEY = /\b(SELECT|INSERT|UPDATE|DELETE|WITH|MERGE|TRUNCATE)\b/;
const ident = (s) =>
  (s || '')
    .replace(/^public\./, '')
    .replace(/^"|"$/g, '')
    .toLowerCase();
const okTable = (t) => /^[a-z_][a-z0-9_]*$/.test(t) && t.length > 1 && !SQL_STOP.has(t);

function sqlTables(text) {
  const reads = new Set(),
    writes = new Set();
  if (!SQL_KEY.test(text)) return { reads, writes };
  const t = text.replace(/\s+/g, ' ');
  for (const m of t.matchAll(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|MERGE\s+INTO)\s+(?:ONLY\s+)?("?[A-Za-z_][\w.]*"?)/gi)) {
    const w = ident(m[1]);
    if (okTable(w) && /^[A-Z]/.test(m[0])) writes.add(w);
  }
  for (const m of t.matchAll(/\b(?:FROM|JOIN)\s+(?:ONLY\s+)?("?[A-Za-z_][\w.]*"?)/g)) {
    const r = ident(m[1]);
    if (!okTable(r)) continue;
    const before = t.slice(Math.max(0, m.index - 8), m.index);
    if (/DELETE\s*$/.test(before)) continue;
    reads.add(r);
  }
  return { reads, writes };
}

/* ── 4 · one JS source ───────────────────────────────────────────────────────────────────────────────────────────── */
const NAME = '[A-Za-z_$][\\w$]*';

/** the string segments inside the path.join( / path.resolve( call that opens at `from`, joined with '/' — null when none */
function joinedSegments(code, strings, from) {
  const to = code.indexOf(')', from);
  if (to < 0) return null;
  const segments = strings.filter((segment) => segment.start > from && segment.start < to).map((segment) => segment.text);
  return segments.length ? segments.join('/') : null;
}
/** require(path.join(__dirname, '..', 'lib', 'x')) — the form the api tests use — as a relative spec (INT7b: without it a lib's test gave no tested-by edge) */
function joinedRequireSpec(code, strings, pos) {
  const head = /^\s*path\.(?:join|resolve)\(\s*__dirname\s*,/.exec(code.slice(pos, pos + 40));
  if (!head) return null;
  const joined = joinedSegments(code, strings, pos + head[0].length);
  if (!joined) return null;
  return /^\.\.?\//.test(joined) ? joined : './' + joined;
}
/** the string literal that opens within 3 bytes of `pos` (the argument of require( ), else null */
function literalStringAt(strings, pos) {
  for (const literal of strings) {
    if (literal.start - 1 >= pos && literal.start - 1 <= pos + 3) return literal.text;
    if (literal.start > pos + 3) break;
  }
  return null;
}
/** what a require( ) at `pos` asks for: its string literal, else the joined path.join(__dirname, …) form */
function requireSpecAt(code, strings, pos) {
  return literalStringAt(strings, pos) || joinedRequireSpec(code, strings, pos);
}
/** every path.join(ROOT, 'app', 'x.js') / path.resolve(...) of string segments as ONE joined path, so a test that READS a module by
 *  path.join names it (INT7b: the standards walks read cap-standards.js that way and the register had no tested-by edge) */
function joinedPathsIn(code, strings) {
  const joinedPaths = [],
    reJoin = /\bpath\.(?:join|resolve)\s*\(/g;
  let match;
  while ((match = reJoin.exec(code))) {
    const joined = joinedSegments(code, strings, match.index + match[0].length);
    if (joined) joinedPaths.push({ text: joined, start: match.index, pos: match.index });
  }
  return joinedPaths;
}
/** W2 (30 Oct): is the string the `p:` of a client-registry entry `key: { m: 'POST', p: '/api/x' }`? That NAMES a route; only api('key') calls it (tools/endpoint-usage.cjs says the same). */
function isRegistryEntryPath(item, sourceText) {
  return /\bm:\s*["']\w+["']\s*,\s*p:\s*$/.test(sourceText.slice(Math.max(0, item.start - 60), item.start - 1));
}

/**
 * scanJs(src, opts) — functions, calls, refs, requires, exports and the strings that matter.
 *   functions[]  { name, kind, start, end, line, endLine, paramsAt }   start/end = body braces (inclusive of `{` … `}`)
 *   calls[]      { name, holder, pos, line }   holder = 'x' for x.name(   · null for a bare call
 *   refs[]       { name, pos }                 an identifier that is a known function name used as a value (callback)
 *   requires[]   { spec, alias, names[], pos }
 *   exports[]    names module.exports / exports.x hand out
 *   globals[]    names set on root./window./globalThis./self.
 *   apiKeys[]    { key, pos }                  api('key' …)
 *   apiPaths[]   { path, pos, method }         '/api/…' literals (fetch-style)
 *   handlers[]   { name, pos }                 foo() inside onclick="…" in a string
 *   strings      the lexer's list
 */
function scanJs(src, opts) {
  opts = opts || {};
  const { code, strings } = lex(src);
  const toLine = lineIndex(src);
  const base = (opts.baseLine || 1) - 1;
  const L = (pos) => base + toLine(pos);

  const functions = [];
  const seenAt = new Set();
  const add = (name, kind, paren, declAt) => {
    if (KEYWORDS.has(name)) return;
    const b = bodyAfterParams(code, paren);
    if (!b) return;
    const key = name + '@' + b.bodyStart;
    if (seenAt.has(key)) return;
    seenAt.add(key);
    functions.push({ name, kind, start: b.bodyStart, end: b.bodyEnd, line: L(declAt), endLine: L(b.bodyEnd), paramsAt: paren, declAt });
  };
  let m;
  /* function name( */
  const reFn = new RegExp('(?:^|[^.\\w$])(?:async\\s+)?function\\s*\\*?\\s*(' + NAME + ')\\s*\\(', 'g');
  while ((m = reFn.exec(code))) add(m[1], 'function', m.index + m[0].length - 1, m.index + m[0].indexOf('function'));
  /* const name = function / (…) => / x => */
  const reVar = new RegExp('(?:^|[^.\\w$])(?:const|let|var)\\s+(' + NAME + ')\\s*=\\s*(?:async\\s*)?(?:function\\b[^(]*\\(|(\\()|(' + NAME + ')\\s*=>)', 'g');
  while ((m = reVar.exec(code))) {
    const at = m.index + m[0].length - 1;
    if (m[3]) {
      /* x => …  : synthesise a paren-less body */
      const arrow = code.indexOf('=>', m.index + m[0].length - 2 - m[3].length);
      addArrowNoParen(m[1], 'arrow', arrow, m.index);
    } else add(m[1], 'arrow', at, m.index + 1);
  }
  /* name = function  ·  X.name = function  ·  name: function  ·  name: (…) =>  ·  name(args) { (method) */
  const reAssign = new RegExp('(?:^|[\\s;(,{])(?:(' + NAME + ')\\.)?(' + NAME + ')\\s*=\\s*(?:async\\s*)?(?:function\\b[^(]*\\(|(\\())', 'g');
  while ((m = reAssign.exec(code))) add(m[2], m[1] ? 'member' : 'assign', m.index + m[0].length - 1, m.index + 1);
  const reProp = new RegExp('[{,]\\s*(' + NAME + ')\\s*:\\s*(?:async\\s*)?(?:function\\b[^(]*\\(|(\\()|(' + NAME + ')\\s*=>)', 'g');
  while ((m = reProp.exec(code))) {
    if (m[3]) {
      const arrow = code.indexOf('=>', m.index + m[0].length - 2 - m[3].length);
      addArrowNoParen(m[1], 'prop', arrow, m.index + 1);
    } else add(m[1], 'prop', m.index + m[0].length - 1, m.index + 1);
  }
  const reMethod = new RegExp('(?:^|[{},;\\n])\\s*(?:async\\s+)?(?:static\\s+)?(' + NAME + ')\\s*\\(([^()]*)\\)\\s*\\{', 'g');
  while ((m = reMethod.exec(code))) {
    if (KEYWORDS.has(m[1])) continue;
    const paren = m.index + m[0].indexOf('(', m[0].indexOf(m[1]));
    /* a method shorthand sits inside an object literal or class body: the enclosing bracket must be `{` of an object/class,
       which we approximate by "the preceding significant char is `{` `,` `}` or `;` on a previous line" — the regex did that */
    add(m[1], 'method', paren, m.index + 1);
  }
  function addArrowNoParen(name, kind, arrowAt, declAt) {
    if (arrowAt < 0) return;
    let k = arrowAt + 2;
    while (k < code.length && /\s/.test(code[k])) k++;
    let b;
    if (code[k] === '{') {
      const e = matchBracket(code, k);
      if (e < 0) return;
      b = { bodyStart: k, bodyEnd: e };
    } else {
      let count = 0,
        i = k;
      for (; i < code.length; i++) {
        const ch = code[i];
        if ('([{'.includes(ch)) count++;
        else if (')]}'.includes(ch)) {
          if (!count) break;
          count--;
        } else if ((ch === ';' || ch === '\n' || ch === ',') && !count) break;
      }
      b = { bodyStart: k, bodyEnd: i };
    }
    const key = name + '@' + b.bodyStart;
    if (seenAt.has(key)) return;
    seenAt.add(key);
    functions.push({ name, kind, start: b.bodyStart, end: b.bodyEnd, line: L(declAt), endLine: L(b.bodyEnd), paramsAt: arrowAt, declAt });
  }
  functions.sort((first, second) => first.start - second.start || second.end - first.end);
  const declPos = new Set(functions.map((item) => item.paramsAt));

  /* calls: name( and holder.name( — never a declaration, never a keyword, never `new X(` */
  const calls = [];
  const reCall = new RegExp('(?:(' + NAME + ')\\s*\\.\\s*)?(' + NAME + ')\\s*\\(', 'g');
  while ((m = reCall.exec(code))) {
    const name = m[2];
    const paren = m.index + m[0].length - 1;
    if (KEYWORDS.has(name) || declPos.has(paren)) continue;
    const before = code.slice(Math.max(0, m.index - 12), m.index);
    if (/function\s*\*?\s*$/.test(before) || /\bnew\s+$/.test(before)) continue;
    if (!m[1] && m.index > 0 && code[m.index - 1] === '.') continue; /* a.b.c( — the holder chain is longer than one; skipped */
    calls.push({ name, holder: m[1] || null, pos: m.index, line: L(m.index) });
    reCall.lastIndex = paren + 1;
  }

  /* requires */
  const requires = [];
  const reReq = /\brequire\s*\(/g;
  while ((m = reReq.exec(code))) {
    const spec = requireSpecAt(code, strings, m.index + m[0].length);
    if (!spec) continue;
    /* the statement this require sits in: back to the start of the line */
    const ls = code.lastIndexOf('\n', m.index) + 1;
    const stmt = code.slice(ls, m.index);
    let alias = null,
      names = [];
    let mm;
    if ((mm = new RegExp('(?:const|let|var)\\s+(' + NAME + ')\\s*=').exec(stmt))) alias = mm[1];
    else if ((mm = /(?:const|let|var)\s*\{([^}]*)\}\s*=/.exec(stmt)))
      names = mm[1]
        .split(',')
        .map((x) => x.trim().split(/\s*:\s*/))
        .filter((item) => item[0])
        .map((item) => ({ exported: item[0], local: item[1] || item[0] }));
    else if ((mm = new RegExp('(' + NAME + ')\\s*=\\s*$').exec(stmt))) alias = mm[1];
    requires.push({ spec, alias, names, pos: m.index }); /* const { a } = require('x').sub — rare; ignored */
  }
  const joinedPaths = joinedPathsIn(code, strings);

  /* exports */
  const exportsOut = new Set();
  const reModEx = /\bmodule\.exports\s*=\s*/g;
  while ((m = reModEx.exec(code))) {
    const k = m.index + m[0].length;
    if (code[k] === '{') {
      const e = matchBracket(code, k);
      const body = code.slice(k + 1, e < 0 ? code.length : e);
      body.split(',').forEach((part) => {
        const mm = new RegExp('^\\s*(?:async\\s+)?(' + NAME + ')').exec(part);
        if (mm && !KEYWORDS.has(mm[1])) exportsOut.add(mm[1]);
      });
    } else {
      const mm = new RegExp('^(' + NAME + ')').exec(code.slice(k, k + 80));
      if (mm) exportsOut.add(mm[1]);
    }
  }
  const reExProp = new RegExp('\\b(?:module\\.)?exports\\.(' + NAME + ')\\s*=', 'g');
  while ((m = reExProp.exec(code))) exportsOut.add(m[1]);

  /* globals: root.X = · window.X = · globalThis.X = · self.X = */
  const globals = new Set();
  const reGlob = new RegExp('\\b(?:root|window|globalThis|self)\\.(' + NAME + ')\\s*=[^=]', 'g');
  while ((m = reGlob.exec(code))) globals.add(m[1]);

  /* api('key') · fetch-style '/api/…' paths · onclick handlers · SQL — all from the strings */
  const apiKeys = [],
    apiPaths = [],
    handlers = [];
  const reApi = /\bapi\s*\(\s*$/;
  for (const s of strings) {
    const before = code.slice(Math.max(0, s.start - 12), s.start - 1);
    if (reApi.test(before) && /^[A-Za-z][\w.]*$/.test(s.text)) {
      apiKeys.push({ key: s.text, pos: s.start });
      continue;
    }
    if (/^\/api\/[\w/:.%-]*/.test(s.text)) {
      const path = s.text.split('?')[0];
      /* method: a `method: 'POST'` string within the next 240 chars, else GET */
      let method = 'GET';
      for (const t of strings) {
        if (t.start > s.start && t.start < s.start + 240 && /^(GET|POST|PUT|PATCH|DELETE)$/.test(t.text)) {
          method = t.text;
          break;
        }
        if (t.start >= s.start + 240) break;
      }
      apiPaths.push({ path, pos: s.start, method, entry: isRegistryEntryPath(s, src), open: /\/$/.test(path) || /\+\s*$/.test(code.slice(s.end + 1, s.end + 6)) });
    }
    if (/\bon[a-z]+\s*=/.test(s.text) || (s.q === '`' && /\bon[a-z]+\s*=/.test(s.text))) {
      for (const h of s.text.matchAll(new RegExp('\\bon[a-z]+\\s*=\\s*(?:\\\\?["\'])?\\s*(?:\\w+\\s*;\\s*)*(' + NAME + ')\\s*\\(', 'g')))
        handlers.push({ name: h[1], pos: s.start + h.index });
      /* any further foo( inside the handler text */
      for (const h of s.text.matchAll(new RegExp('\\bon[a-z]+\\s*=\\s*(?:\\\\?["\'])([^"\']{0,400})', 'g'))) {
        for (const c of h[1].matchAll(new RegExp('(?:^|[^.\\w$])(' + NAME + ')\\s*\\(', 'g')))
          if (!KEYWORDS.has(c[1])) handlers.push({ name: c[1], pos: s.start + h.index });
      }
    }
  }

  return { code, strings, joinedPaths, functions, calls, requires, exports: [...exportsOut], globals: [...globals], apiKeys, apiPaths, handlers, toLine: L };
}

/** the identifiers in `code` that name one of `names` and are used as values (not called, not a property) */
function refsTo(code, names) {
  const out = [];
  if (!names.size) return out;
  const re = /[A-Za-z_$][\w$]*/g;
  let m;
  while ((m = re.exec(code))) {
    const w = m[0];
    if (!names.has(w)) continue;
    const a = m.index,
      b = a + w.length;
    if (a > 0 && (code[a - 1] === '.' || /[\w$]/.test(code[a - 1]))) continue;
    let k = b;
    while (k < code.length && (code[k] === ' ' || code[k] === '\t')) k++;
    if (code[k] === '(') continue; /* a call — counted elsewhere */
    if (code[k] === ':' && code[k + 1] !== ':') continue; /* an object key */
    const before = code.slice(Math.max(0, a - 10), a);
    if (/function\s*\*?\s*$/.test(before) || /(?:const|let|var)\s+$/.test(before)) continue;
    out.push({ name: w, pos: a });
  }
  return out;
}

/* ── 5 · an HTML page: its inline scripts, its script tags, its markup handlers ─────────────────────────────────── */
function scanHtml(src) {
  const scripts = [],
    inline = [];
  const toLine = lineIndex(src);
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  let markup = src;
  while ((m = re.exec(src))) {
    const attrs = m[1] || '';
    const s = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (s) {
      scripts.push({ src: s[1] });
      continue;
    }
    const t = /\btype\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (t && !/javascript|module|ecmascript/i.test(t[1])) continue;
    const offset = m.index + m[0].indexOf('>') + 1;
    inline.push({ code: m[2], offset, baseLine: toLine(offset) });
  }
  markup = markup.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (x) => x.replace(/[^\n]/g, ' '));
  const handlers = [];
  for (const h of markup.matchAll(new RegExp('\\bon[a-z]+\\s*=\\s*["\']([^"\']{0,400})["\']', 'gi'))) {
    for (const c of h[1].matchAll(new RegExp('(?:^|[^.\\w$])(' + NAME + ')\\s*\\(', 'g')))
      if (!KEYWORDS.has(c[1])) handlers.push({ name: c[1], line: toLine(h.index) });
  }
  for (const h of markup.matchAll(new RegExp('href\\s*=\\s*["\']javascript:\\s*(' + NAME + ')\\s*\\(', 'gi')))
    handlers.push({ name: h[1], line: toLine(h.index) });
  return { scripts, inline, handlers };
}

module.exports = { lex, scanJs, scanHtml, sqlTables, refsTo, matchBracket, lineAt, lineIndex, KEYWORDS };
