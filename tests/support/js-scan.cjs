'use strict';
/**
 * js-scan.cjs — THE ONE "read JavaScript without a parser" helper the guards share.
 *
 * Lifted 2026-10-14 (round T2-SPLIT) out of tests/tdz-guard.test.js, where `blank` and `bodies` were born, because the
 * function-size ratchet (tests/fn-size.test.cjs) needed exactly the same two primitives. Two copies of a tokenizer
 * drift the first time one of them learns about regex literals and the other does not — tdz-guard already paid for
 * that once (2026-09-27). One helper, two callers. [[feedback-no-duplicate-functions]]
 *
 * ⚠️ Still not a JavaScript parser and it does not pretend to be (no dependency is allowed in the offline gate):
 *   · blank(src)      comments, strings and regex bodies become spaces — every offset and line number survives
 *   · bodies(src)     every function body as [open, close] character offsets (function · arrow)
 *   · functions(raw)  every function as { name, line, endLine, lines, complexity } — the MAINT-1 metrics
 */

/** a '/' starts a regex when what came before cannot end an operand — the standard tokenizer rule */
function regexCanStart(out) {
  const t = out.replace(/\s+$/, '');
  if (!t) return true;
  if (/(^|[^\w$])(return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/.test(t)) return true;
  return /[(,=:[!&|?{};+\-*%<>~^]$/.test(t);
}

function blank(src) {
  let out = '';
  let i = 0;
  const N = src.length;
  while (i < N) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const seg = src.slice(i, end < 0 ? N : end + 2);
      out += seg.replace(/[^\n]/g, ' ');
      i += seg.length;
    } else if (c === '/' && d === '/') {
      let end = src.indexOf('\n', i);
      if (end < 0) end = N;
      out += ' '.repeat(end - i);
      i = end;
    } else if (c === '/' && regexCanStart(out)) {
      /* ⭐ A REGEX LITERAL (2026-09-27). The blanker had no idea these existed, so a quote inside one — /['"]/ —
         opened a "string" that ran on for hundreds of lines, and from there comments read as code and code as
         strings: it flagged the word "told" INSIDE a message string in routes/testing.js as a use-before-declare.
         Skipped to its closing slash, honouring escapes and [...] classes (a / inside a class does not close it). */
      let j = i + 1, inClass = false;
      while (j < N && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') inClass = true; else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) break;
        j++;
      }
      if (j < N && src[j] === '/') {
        const seg = src.slice(i, j + 1);
        out += '/' + seg.slice(1, -1).replace(/[^\n]/g, ' ') + '/';
        i = j + 1;
      } else { out += c; i++; }                       /* no closing slash on this line — it was division after all */
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < N && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      const seg = src.slice(i, Math.min(j + 1, N));
      out += c + seg.slice(1).replace(/[^\n]/g, ' ');
      i += seg.length;
    } else { out += c; i++; }
  }
  return out;
}

const HEAD = /(?:function\s*[A-Za-z_$\w]*\s*\([^)]*\)|\([^()]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)\s*\{/g;

/** the matching close of the brace at `open` in blanked source */
function closeOf(src, open) {
  let depth = 0;
  let i = open;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return i;
}

/** ⭐ every function body as a [start, end] character range — the unit a TDZ question is actually asked in */
function bodies(src) {
  const out = [];
  const re = new RegExp(HEAD.source, 'g');
  let m;
  while ((m = re.exec(src))) {
    const open = src.indexOf('{', m.index + m[0].length - 1);
    if (open < 0) continue;
    out.push([open, closeOf(src, open), m.index]);
  }
  return out;
}

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

/** a readable name for a function: its declared name, the name it is assigned to, or the route it handles */
function nameOf(raw, headAt) {
  const own = /^function\s*([A-Za-z_$][\w$]*)/.exec(raw.slice(headAt, headAt + 80));
  if (own) return own[1];
  const lineStart = raw.lastIndexOf('\n', headAt - 1) + 1;
  const before = raw.slice(lineStart, headAt);
  const assigned = /([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s*)?$/.exec(before);
  if (assigned) return assigned[1];
  /* a route handler: the nearest router.<verb>('<path>' above it, within the same statement's reach */
  const back = raw.slice(Math.max(0, headAt - 6000), headAt);
  const routes = [...back.matchAll(/router\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]+)\2/g)];
  if (routes.length) { const r = routes[routes.length - 1]; return r[1].toUpperCase() + ' ' + r[3]; }
  return '(anonymous)';
}

/** decision points in blanked code: if · for · while · case · catch · && · || · ?? · ternary ? */
function decisions(code) {
  const words = (code.match(/(^|[^\w$.])(if|for|while|case|catch)(?![\w$])/g) || []).length;
  const ops = (code.match(/&&|\|\||\?\?/g) || []).length;
  const ternary = (code.replace(/\?\?|\?\./g, '  ').match(/\?/g) || []).length;
  return words + ops + ternary;
}

/**
 * ⭐ MAINT-1's two numbers per function: LENGTH (first line of the head to the closing brace, inclusive) and
 * CYCLOMATIC COMPLEXITY (1 + decision points in its own body — a nested function's decisions are its own, not its
 * parent's, the convention every complexity tool uses).
 */
function functions(raw) {
  const src = blank(raw);
  const bs = bodies(src);
  return bs.map((b) => {
    const [open, close, headAt] = b;
    let code = src.slice(open, close + 1);
    /* cut the bodies of nested functions out of this one's count (replace with spaces so offsets hold) */
    bs.forEach((n) => {
      if (n !== b && n[0] > open && n[1] < close) {
        const a = n[0] - open, z = n[1] - open;
        code = code.slice(0, a) + ' '.repeat(z - a + 1) + code.slice(z + 1);
      }
    });
    const line = lineOf(src, headAt), endLine = lineOf(src, close);
    return { name: nameOf(raw, headAt), line, endLine, lines: endLine - line + 1, complexity: 1 + decisions(code) };
  });
}

module.exports = { blank, bodies, functions, regexCanStart, lineOf };
