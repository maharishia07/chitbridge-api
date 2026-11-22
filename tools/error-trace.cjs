'use strict';
/*
 * OWNS      the static call graph that follows a route into the helpers it calls and gives it the error codes those helpers raise (ERR-14 part 1, "trigger known").
 * CALLED BY tools/error-codes.cjs routesOf() · tests/error-trace.test.cjs
 * FLOW      every function in routes/ lib/ middleware/ server.js (name, line range, code literals inside, names it calls)
 *           ──▶ a call resolves ONLY to a function of the same file or of a module the file require()s (alias.fn(), { fn } = require(), fn: alias)
 *           ──▶ the codes of a route = the codes of its body plus those of every function reachable by those calls.
 *           A call that does not resolve is dropped: a code reached only through it stays [] (unknown, never guessed).
 * CARD      28-platform-and-operations/api-standard
 */
const fs = require('fs');
const path = require('path');

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'typeof', 'await', 'new', 'require', 'super', 'else', 'do', 'void', 'delete', 'in', 'of']);
const FN_DEFS = [
  /^(\s*)(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/,
  /^(\s*)(?:(?:const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/,
  /^(\s*)(?:exports\.|module\.exports\.)([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>)/,
  /^(\s*)(?:async\s+)?([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>)/,
  /^(\s*)(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{\s*(?:\/[*/].*)?$/,
  /^()(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/ /* a table at column 0 (a contract of refusals): reached by naming it */,
];

/** the strings and comments of a line blanked, so a word inside a sentence is not a call */
const bare = (line) => line.replace(/\/\*.*?\*\//g, ' ').replace(/\/\/.*$/, ' ').replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");

/** the functions of one file: { name, from, to } (1-based lines; `to` is the line before the next line at the same or a shallower indent) */
function functionsOf(lines) {
  const found = [];
  lines.forEach((line, index) => {
    if (/^\s*(?:if|for|while|switch|catch|else)\b/.test(line)) return;
    for (const shape of FN_DEFS) {
      const hit = shape.exec(line);
      if (!hit || KEYWORDS.has(hit[2])) continue;
      const indent = hit[1].length;
      let to = index + 1;
      if (!/;\s*(?:\/[*/].*)?$/.test(line.trim())) {
        for (let at = index + 1; at < lines.length; at++) {
          const text = lines[at];
          if (!text.trim()) continue;
          const depth = text.length - text.trimStart().length;
          if (depth > indent) { to = at + 1; continue; }
          if (/^\s*[)}\]]/.test(text)) to = at + 1;
          break;
        }
      }
      found.push({ name: hit[2], from: index + 1, to, table: shape === FN_DEFS[FN_DEFS.length - 1] });
      break;
    }
  });
  return found;
}

/** a relative require() spec as the file it names */
function resolveSpec(file, spec) {
  const base = path.resolve(path.dirname(file), spec);
  for (const candidate of [base, base + '.js', path.join(base, 'index.js')]) if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  return null;
}

/** the modules a file requires: { alias → absolute path } and { name → { file, member } } for the destructured ones */
function requiresOf(text, file, root) {
  const aliases = {};
  const members = {};
  const resolve = (spec) => (spec.startsWith('.') ? resolveSpec(file, spec) : null);
  for (const hit of text.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*'([^']+)'\s*\)(\.[A-Za-z_$][\w$]*)?/g)) {
    const target = resolve(hit[2]);
    if (!target) continue;
    if (hit[3]) members[hit[1]] = { file: target, member: hit[3].slice(1) };
    else aliases[hit[1]] = target;
  }
  for (const hit of text.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*;/g)) {
    if (aliases[hit[2]] && !members[hit[1]]) members[hit[1]] = { file: aliases[hit[2]], member: hit[3] }; /* const words = contract.words */
  }
  for (const hit of text.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*([A-Za-z_$][\w$]*)\s*;/g)) {
    if (!aliases[hit[2]]) continue; /* const { words, failed } = contract */
    hit[1].split(',').map((part) => part.trim()).filter(Boolean).forEach((part) => {
      const [member, local] = part.split(':').map((word) => word.trim());
      if (!members[local || member]) members[local || member] = { file: aliases[hit[2]], member };
    });
  }
  for (const hit of text.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*'([^']+)'\s*\)/g)) {
    const target = resolve(hit[2]);
    if (!target) continue;
    hit[1].split(',').map((part) => part.trim()).filter(Boolean).forEach((part) => {
      const [member, local] = part.split(':').map((word) => word.trim());
      members[local || member] = { file: target, member };
    });
  }
  return { aliases, members };
}

/** the file facts of a repo root, read once per file: its text, lines, functions and requires */
function fileInfoOf(root, sourceFiles) {
  const fileInfo = {};
  const info = (file) => {
    if (fileInfo[file]) return fileInfo[file];
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n');
    const rel = path.relative(root, file).split(path.sep).join('/');
    fileInfo[file] = { file, rel, lines, fns: functionsOf(lines), requires: requiresOf(text, file, root) };
    return fileInfo[file];
  };
  sourceFiles.forEach(info);
  return { fileInfo, info };
}

/** what a name stands for inside a file: its spans, its column-0 tables (naming one is using it), and the route-keyed contract lines */
function namedSpans(fileInfo) {
  const spansNamed = (file, name) => (fileInfo[file] ? fileInfo[file].fns.filter((fn) => fn.name === name).map((fn) => ({ file, from: fn.from, to: fn.to })) : []);
  const tablesNamed = (file, name) => (fileInfo[file] ? fileInfo[file].fns.filter((fn) => fn.name === name && fn.table).map((fn) => ({ file, from: fn.from, to: fn.to })) : []);
  /** the lines of a file that open a table entry keyed by a route key ('POST /ask': { … refusals: NAME … }): what a route says about itself in its contract */
  const keyedIn = (file, key) => {
    const there = fileInfo[file];
    if (!there) return [];
    const open = "'" + key + "':";
    return there.lines.map((text, index) => (text.trimStart().startsWith(open) ? { file, from: index + 1, to: index + 1 } : null)).filter(Boolean);
  };
  return { spansNamed, tablesNamed, keyedIn };
}

/** the call patterns of one line, each a small collector that pushes the spans it finds: (named, here, span, text, out) */
const LINE_COLLECTORS = [
  (named, here, span, text, out) => {
    for (const hit of text.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g)) {
      const target = here.requires.aliases[hit[1]];
      if (target) out.push(...named.spansNamed(target, hit[2]));
      const member = here.requires.members[hit[1]];
      if (member && named.tablesNamed(member.file, member.member).length) out.push(...named.spansNamed(member.file, hit[2])); /* words.said(): a method of an object a module exports */
      if (named.tablesNamed(span.file, hit[1]).length) out.push(...named.spansNamed(span.file, hit[2])); /* a method of an object written in this file */
    }
  },
  (named, here, span, text, out) => {
    for (const hit of text.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g)) {
      if (KEYWORDS.has(hit[1])) continue;
      out.push(...named.spansNamed(span.file, hit[1]));
      const member = here.requires.members[hit[1]];
      if (member) out.push(...named.spansNamed(member.file, member.member));
    }
  },
  (named, here, span, text, out) => {
    for (const hit of text.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*[,)]/g)) {
      const target = here.requires.aliases[hit[1]];
      if (target) out.push(...named.spansNamed(target, hit[2])); /* a helper handed over by name: router.get('/x', alias.handler) */
    }
  },
  (named, here, span, text, out, raw) => {
    for (const hit of raw.matchAll(/require\(\s*'(\.[^']+)'\s*\)\s*\.\s*([A-Za-z_$][\w$]*)/g)) {
      const target = resolveSpec(here.file, hit[1]);
      if (target) out.push(...named.spansNamed(target, hit[2])); /* require('../lib/x').fn( written in place */
    }
  },
  (named, here, span, text, out) => {
    for (const hit of text.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)(?!\s*[(\w$])/g)) {
      out.push(...named.tablesNamed(span.file, hit[1])); /* a contract table named in the body */
      const member = here.requires.members[hit[1]];
      if (member) out.push(...named.tablesNamed(member.file, member.member));
    }
  },
  (named, here, span, text, out) => {
    for (const hit of text.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)(?!\s*[(\w$])/g)) {
      const target = here.requires.aliases[hit[1]];
      if (target) out.push(...named.tablesNamed(target, hit[2]));
    }
  },
  (named, here, span, text, out) => {
    for (const hit of text.matchAll(/(?:^|[(,[:])\s*([A-Za-z_$][\w$]*)\s*(?=[,)\]}]|$)/g)) {
      out.push(...named.spansNamed(span.file, hit[1])); /* a handler or helper handed over by name: router.post('/x', auth, handler) · padded(junk(verify, typed)) */
      const member = here.requires.members[hit[1]];
      if (member) out.push(...named.spansNamed(member.file, member.member));
    }
  },
  (named, here, span, text, out, raw) => {
    for (const hit of raw.matchAll(/'((?:GET|POST|PUT|PATCH|DELETE) \/[^']*)'/g)) {
      Object.values(here.requires.aliases).forEach((target) => out.push(...named.keyedIn(target, hit[1]))); /* contract.checked('POST /ask'): the contract line of that route */
      Object.values(here.requires.members).forEach((member) => out.push(...named.keyedIn(member.file, hit[1])));
    }
  },
  (named, here, span, text, out) => {
    for (const hit of text.matchAll(/\bnew\s+([A-Za-z_$][\w$]*)/g)) out.push(...named.spansNamed(span.file, hit[1]));
  }
];

/** the spans a span calls: every line of it read by each collector */
function callsOfSpan(fileInfo, named, span) {
  const here = fileInfo[span.file];
  const out = [];
  for (let at = span.from - 1; at < span.to && at < here.lines.length; at++) {
    const raw = here.lines[at];
    const text = bare(raw);
    LINE_COLLECTORS.forEach((collect) => collect(named, here, span, text, out, raw));
  }
  return out;
}

/** the call graph of a repo root: graph.codesIn(file, from, to) and graph.reach(file, from, to) → the codes raised by that span and everything it calls */
function buildGraph(root, scanned, sourceFiles) {
  const { fileInfo, info } = fileInfoOf(root, sourceFiles);
  const codesAt = {};
  Object.keys(scanned).forEach((code) => scanned[code].at.forEach(([rel, line]) => ((codesAt[rel] = codesAt[rel] || []).push([line, code]))));
  const named = namedSpans(fileInfo);
  const callsOf = (span) => callsOfSpan(fileInfo, named, span);

  /** the codes written between two lines of a file */
  const codesIn = (file, from, to) => {
    const rel = fileInfo[file] ? fileInfo[file].rel : path.relative(root, file).split(path.sep).join('/');
    return (codesAt[rel] || []).filter(([line]) => line >= from && line <= to).map(([, code]) => code);
  };

  /** every code a span can raise: its own and those of every span it reaches */
  const reach = (file, from, to) => {
    const seen = new Set();
    const codes = new Set();
    const walk = (span) => {
      const id = span.file + ':' + span.from + ':' + span.to;
      if (seen.has(id)) return;
      seen.add(id);
      codesIn(span.file, span.from, span.to).forEach((code) => codes.add(code));
      callsOf(span).forEach(walk);
    };
    if (fileInfo[file]) walk({ file, from, to });
    return codes;
  };
  return { reach, info };
}

module.exports = { buildGraph, functionsOf, requiresOf };
