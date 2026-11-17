/* tools/readability/measure.cjs — ONE read of a JavaScript file into readability facts (READ-GUARD, 2026-10-15).
 *
 * OWNS      the acorn parse and the one AST walk every readability mode shares: functions (lines · nesting · complexity ·
 *           what-line above), declared names (cryptic or not), empty catches, repeated literals, comment blocks, module header.
 * CALLED BY tools/readability.cjs (the baseline R1–R6 report and the --changed guard), tools/readability/guard.cjs,
 *           tools/readability/ratchet.cjs, e2e/readability-guard.cjs.
 * FLOW      collect(repo, root) → files ──▶ fileFacts(file) ──▶ chunks (a JS file, or each inline <script> of a page)
 *           ──▶ parse(acorn) ──▶ walkChunk ──▶ { functions, names, emptyCatches, literals, comments, header }
 * CARD      qa/readability-guard
 *
 * SCOPE (MAINT-1 rule): own code only. Excluded: files headed "ADOPTED from chitbridge-engines" (vendored engine copies),
 * web public/till.html (vendored from the api master) and every other byte copy that chitbridge-api/scripts/vendor-till.cjs writes
 * (headed "GENERATED — DO NOT EDIT": till-sw.js, promo.html, app/their-bill.js), pure translation packs (public/app/strings-<lang>.js: top-level wrappers holding only the four pack statements,
 * no other function, only string → string properties — data, held by pack-parity; a pack with a helper function is judged), qr.js, any vendor/ folder, *.min.*, node_modules, tests, e2e, fixtures.
 * Static only: a name is "used" when an Identifier of that spelling appears in the same file (scope-blind; said in the report).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { parseFields } = require('./header-grammar.cjs');

const acorn = loadAcorn();

/** acorn from an installed package when there is one, else the vendored copy (tools/vendor/acorn.cjs — no npm dependency) */
function loadAcorn() {
  const places = ['acorn', path.join(__dirname, '..', 'vendor', 'acorn.cjs')];
  const tried = [];
  for (const place of places) {
    try {
      return require(place);
    } catch (error) {
      tried.push(place + ': ' + String(error.message).split('\n')[0]);
    }
  }
  throw new Error('acorn not found — ' + tried.join(' · '));
}

// ── where own code lives, per repo (folders or single files, relative to the root)
const SCOPE = {
  web: ['public', 'scripts', 'tools'],
  api: ['lib', 'routes', 'middleware', 'src', 'scripts', 'tools', 'server.js', 'public'],
  engines: ['src', 'tools', 'index.js']
};
const VENDOR_DIR = /^(node_modules|vendor|\.git|fixture|fixtures|out|dist)$/; /* no own code at all; filesize.cjs skips only these, tests counted */
const SKIP_DIR = new RegExp(VENDOR_DIR.source.slice(0, -2) + '|tests?|e2e|docs|migrations|seed|data)$');
const SKIP_FILE = /(\.min\.|^qr\.js$|\.test\.(c?js|mjs)$)/;
const CODE_FILE = /\.(js|cjs|mjs|html)$/;
/* a file whose master lives elsewhere: an engine adopted from chitbridge-engines, or a copy vendor-till.cjs writes (judged at its master) */
const ADOPTED_HEAD = /ADOPTED from chitbridge-engines|GENERATED — DO NOT EDIT\. Written by chitbridge-api\/scripts\/vendor-till\.cjs/;
const VENDORED_TILL = 'public/till.html', HEAD_BYTES = 700;

/** every code file under one scope entry (a folder walked, or a single file) */
function walkDir(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    out.unreadable.push(dir + ': ' + error.code);
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIR.test(entry.name)) walkDir(full, out);
    } else if (CODE_FILE.test(entry.name) && !SKIP_FILE.test(entry.name)) out.files.push(full);
  }
}

/* a translation pack: public/app/strings-<lang>.js (DATA, key → text; its quality is held by the pack-parity check, not by readability) */
const DATA_PACK_NAME = /^public\/app\/strings-[a-z]{2,3}\.js$/;

/** the function of a top-level `(function () {…})();` statement, else null */
function topLevelWrapper(statement) {
  const call = statement.type === 'ExpressionStatement' && statement.expression;
  return call && call.type === 'CallExpression' && call.callee.type === 'FunctionExpression' && call.arguments.length === 0 ? call.callee : null;
}

/** the parse of a pack, or an empty program when it does not parse (a file that does not parse is judged as code, never exempted) */
function parsePack(text) {
  try {
    return parse(text, []);
  } catch (error) {
    return { type: 'Program', body: [], parseError: error.message };
  }
}

/** a property that is not a plain string → string pair (a number, a call, a computed key…) */
function isImpureProperty(node) {
  const value = node.value;
  return node.computed || value.type !== 'Literal' || typeof value.value !== 'string';
}

/** the children of an AST node, flattened */
function childNodes(node) {
  const out = [];
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (Array.isArray(child)) out.push(...child.filter((item) => item && typeof item.type === 'string'));
    else if (child && typeof child.type === 'string') out.push(child);
  }
  return out;
}

/** count, over the whole tree: functions that are not a top-level wrapper, object literals, and non-string properties */
function tallyPack(node, wrappers, seen) {
  if (FUNCTION_TYPES.has(node.type) && !wrappers.has(node)) seen.functions++;
  if (node.type === 'ObjectExpression') seen.objects++;
  if (node.type === 'Property' && isImpureProperty(node)) seen.impure++;
  for (const child of childNodes(node)) tallyPack(child, wrappers, seen);
  return seen;
}

/** an AST without positions, as text: two statements with the same shape give the same string */
function shapeOf(node) {
  return JSON.stringify(node, (key, value) => (key === 'start' || key === 'end' || key === 'loc' || key === 'raw' ? undefined : value));
}

/** the shapes of the four statements every real pack uses besides its pack object: the CBSTR guard, the language bag, the copy loop, the repaint */
function packStatementShapes(lang, bagName) {
  const snippets = [
    "if (typeof CBSTR === 'undefined') return;",
    'var ' + bagName + ' = CBSTR.' + lang + ' || (CBSTR.' + lang + ' = {});',
    'for (var k in pack) if (Object.prototype.hasOwnProperty.call(pack, k)) ' + bagName + '[k] = pack[k];',
    "try { if (typeof renderApp === 'function') renderApp(); } catch (_) {}"
  ];
  return new Set(snippets.map((code) => shapeOf(parse(code, []).body[0])));
}

/** the pack object itself: `var pack = { … };` (its properties are checked by tallyPack) */
function isPackVariable(statement) {
  const declared = statement.type === 'VariableDeclaration' && statement.declarations;
  return Boolean(declared) && declared.length === 1 && declared[0].id.name === 'pack' && declared[0].init && declared[0].init.type === 'ObjectExpression';
}

/** the name a wrapper gives its language bag (`var fr = CBSTR.fr || …`, or `var m = …`): its first `var` that is not the pack */
function bagNameOf(wrapper) {
  const declaration = wrapper.body.body.find((statement) => statement.type === 'VariableDeclaration' && !isPackVariable(statement));
  return declaration ? declaration.declarations[0].id.name : '_bag';
}

/** does every statement of every wrapper have one of the pack shapes? Anything else (a call, eval, fetch, an if on location…) is code */
function onlyPackStatements(wrapperNodes, lang) {
  return wrapperNodes.every((wrapper) => {
    const shapes = packStatementShapes(lang, bagNameOf(wrapper));
    return wrapper.body.body.every((statement) => isPackVariable(statement) || shapes.has(shapeOf(statement)));
  });
}

/** is this text a PURE data pack: top-level wrappers holding only the four pack statements, each holding only the pack statements, no other function,
 *  and every object-literal property a string → string pair?
 *  Anything else (a helper function, any other statement, a non-string value, no object literal) is code and is judged. */
function isDataPack(relPath, text) {
  if (text == null || !DATA_PACK_NAME.test(relPath)) return false;
  const tree = parsePack(text);
  const wrapperNodes = tree.body.map(topLevelWrapper);
  if (wrapperNodes.some((wrapper) => !wrapper)) return false; // a top-level statement that is not a wrapper
  const lang = /strings-([a-z]+)\.js$/.exec(relPath)[1];
  const seen = tallyPack(tree, new Set(wrapperNodes), { functions: 0, objects: 0, impure: 0 });
  return seen.objects > 0 && seen.impure === 0 && seen.functions === 0 && onlyPackStatements(wrapperNodes, lang);
}

/** text that is not own code: an adopted / generated copy (judged at its master) or a pure translation pack (data) */
function isNotOwnText(relPath, text) {
  if (text != null && ADOPTED_HEAD.test(text.slice(0, HEAD_BYTES))) return true;
  return isDataPack(relPath, text);
}

/** is this repo-relative path own code (in scope, not vendored)? — the one rule collect() and the guard share */
function inScope(repo, relPath, text) {
  const top = relPath.split('/')[0];
  if (!(SCOPE[repo] || []).some((entry) => entry === relPath || top === entry)) return false;
  if (!CODE_FILE.test(relPath) || SKIP_FILE.test(path.basename(relPath))) return false;
  if (
    relPath
      .split('/')
      .slice(0, -1)
      .some((part) => SKIP_DIR.test(part))
  )
    return false;
  if (repo === 'web' && relPath === VENDORED_TILL) return false;
  return !isNotOwnText(relPath, text);
}

/** the own-code files of one repo: [{ abs, rel }] plus what was skipped and why */
function collect(repo, root) {
  const found = { files: [], unreadable: [] };
  for (const entry of SCOPE[repo] || []) {
    const full = path.join(root, entry);
    if (!fs.existsSync(full)) continue;
    if (fs.statSync(full).isDirectory()) walkDir(full, found);
    else found.files.push(full);
  }
  const files = [],
    skipped = { adopted: 0, vendoredTill: 0 };
  for (const absPath of found.files) {
    const relPath = path.relative(root, absPath).replace(/\\/g, '/');
    if (repo === 'web' && relPath === VENDORED_TILL) {
      skipped.vendoredTill++;
      continue;
    }
    if (ADOPTED_HEAD.test(fs.readFileSync(absPath, 'utf8').slice(0, HEAD_BYTES))) {
      skipped.adopted++;
      continue;
    }
    files.push({ abs: absPath, rel: relPath });
  }
  return { files, skipped, unreadable: found.unreadable };
}

// ── parse: a JS file is one chunk; an HTML page is one chunk per inline <script> (offset so line numbers are the page's)
function chunks(relPath, text) {
  if (!/\.html$/.test(relPath)) return [{ code: text, lineOffset: 0 }];
  const out = [],
    scriptTag = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptTag.exec(text))) {
    if (/\bsrc\s*=/.test(match[1])) continue;
    const type = /type\s*=\s*["']?([^"'\s>]+)/i.exec(match[1]);
    if (type && !/javascript|module/i.test(type[1])) continue;
    const bodyStart = match.index + match[0].indexOf('>') + 1;
    out.push({ code: match[2], lineOffset: text.slice(0, bodyStart).split('\n').length - 1 });
  }
  return out;
}
/** the acorn parse of one chunk of code, its comments collected through onComment */
function parse(code, comments) {
  const options = { ecmaVersion: 'latest', locations: true, allowReturnOutsideFunction: true, allowHashBang: true, onComment: comments };
  try {
    return acorn.parse(code, Object.assign({ sourceType: 'script' }, options));
  } catch (scriptError) {
    comments.length = 0;
    try {
      return acorn.parse(code, Object.assign({ sourceType: 'module' }, options));
    } catch (moduleError) {
      throw new Error(scriptError.message + ' (as module: ' + moduleError.message + ')');
    }
  }
}

// ── the walk
const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const NESTING_TYPES = new Set([
  'IfStatement',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
  'SwitchStatement',
  'TryStatement'
]);
const BRANCH_TYPES = new Set([
  'IfStatement',
  'ConditionalExpression',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
  'CatchClause'
]);
const STATEMENT_LIKE = /Statement$|Declaration$/;
const PROPERTY_TYPES = new Set(['Property', 'MethodDefinition', 'PropertyDefinition']);
const WRAPPER_MIN_LINES = 150; // an IIFE module wrapper this long is a module, not a function (READ-1 rule)
const WRAPPER_MAX_DEPTH = 6;
const TRIVIAL_NUMBERS = new Set([100, 1000]); // and every |n| <= 10 (indexes, small limits)
const TRIVIAL_NUMBER_MAX = 10;
const TRIVIAL_STRINGS =
  /^(function|object|string|number|boolean|undefined|click|change|input|none|block|flex|GET|POST|PUT|DELETE|utf8|utf-8|use strict|default|submit|keydown|keyup|error|true|false|null|px|auto|hidden|text|value|class|style|id|div|span|button|checkbox|Content-Type|application\/json|Authorization|Bearer )$/;
const MIN_LITERAL_STRING = 4;

/** the identifiers a binding pattern declares (plain, object, array, default, rest) */
function patternNames(pattern, out) {
  if (!pattern) return out;
  if (pattern.type === 'Identifier') out.push(pattern);
  else if (pattern.type === 'ObjectPattern') pattern.properties.forEach((prop) => patternNames(prop.type === 'RestElement' ? prop.argument : prop.value, out));
  else if (pattern.type === 'ArrayPattern') pattern.elements.forEach((element) => patternNames(element, out));
  else if (pattern.type === 'AssignmentPattern') patternNames(pattern.left, out);
  else if (pattern.type === 'RestElement') patternNames(pattern.argument, out);
  return out;
}

/** a value a catch may "answer" without saying anything: a literal, undefined, [], {}, { rows: [] }, new Set() … (one test per node type) */
const TRIVIAL_BY_TYPE = {
  Literal: () => true,
  Identifier: (node) => node.name === 'undefined',
  UnaryExpression: (node) => isTrivialValue(node.argument),
  TemplateLiteral: (node) => node.expressions.length === 0,
  ArrayExpression: (node) => node.elements.every(isTrivialValue),
  ObjectExpression: (node) => node.properties.every((prop) => prop.type === 'Property' && isTrivialValue(prop.value)),
  NewExpression: (node) => node.arguments.length === 0 && node.callee.type === 'Identifier' && /^(Set|Map)$/.test(node.callee.name)
};
function isTrivialValue(node) {
  if (!node) return true;
  const test = TRIVIAL_BY_TYPE[node.type];
  return test ? test(node) : false;
}

/** does this catch handler body only carry on (nothing · return a trivial value · assign a trivial value)? */
function isSilentBody(body) {
  if (body.type !== 'BlockStatement') return isTrivialValue(body);
  return body.body.every((statement) => {
    if (statement.type === 'ReturnStatement') return isTrivialValue(statement.argument);
    if (statement.type === 'ExpressionStatement' && statement.expression.type === 'AssignmentExpression') return isTrivialValue(statement.expression.right);
    return false;
  });
}

/** the name a function value carries from its variable, assignment target or property key (by the parent's type) */
const NAME_FROM_PARENT = {
  VariableDeclarator: (parent) => (parent.id.type === 'Identifier' ? parent.id.name : null),
  AssignmentExpression: (parent) =>
    parent.left.type === 'Identifier' ? parent.left.name : (parent.left.type === 'MemberExpression' && parent.left.property.name) || null,
  Property: (parent) => parent.key.name || parent.key.value || null,
  MethodDefinition: (parent) => parent.key.name || parent.key.value || null,
  PropertyDefinition: (parent) => parent.key.name || parent.key.value || null
};
function functionName(node, parent) {
  if (node.id) return node.id.name;
  const fromParent = parent && NAME_FROM_PARENT[parent.type];
  return fromParent ? fromParent(parent) : null;
}

/** a handler passed to `router.get('/path', ...)` (or app.post, .put, …) carries its route, 'GET /path': the guard pairs it with
 *  the same route in the base file, so a handler that moved is still compared with itself (INT7b) — a field, never a name */
const ROUTE_VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all']);
function routeOf(node, parent) {
  if (!parent || parent.type !== 'CallExpression' || parent.callee === node || parent.callee.type !== 'MemberExpression') return null;
  const verb = parent.callee.property && parent.callee.property.name;
  const first = parent.arguments[0];
  if (!ROUTE_VERBS.has(verb) || !first || first.type !== 'Literal' || typeof first.value !== 'string') return null;
  return verb.toUpperCase() + ' ' + first.value;
}

/** the statement a function's what-line should sit above (`var f = function` and `a.b = function` look above the statement) */
function enclosingStatement(stack, node) {
  for (let i = stack.length - 2; i >= 0; i--) {
    const ancestor = stack[i];
    if (STATEMENT_LIKE.test(ancestor.type) || PROPERTY_TYPES.has(ancestor.type)) return ancestor;
    if (FUNCTION_TYPES.has(ancestor.type) || ancestor.type === 'CallExpression' || ancestor.type === 'ArrayExpression') return node;
  }
  return node;
}

/** is this a property key / member name (not a use of a variable)? */
function isPropertyKey(node, parent) {
  if (!parent) return false;
  if (parent.type === 'MemberExpression') return parent.property === node && !parent.computed;
  return PROPERTY_TYPES.has(parent.type) && parent.key === node && !parent.computed && !parent.shorthand;
}

/** the function's body as acorn tokens (whitespace and comments gone, nothing else changed): two functions with the same key are the
 *  same code. Lazy and not enumerable, so a record still serialises and only the move rule pays for it. */
function bodyKeyOf(code, node, name) {
  const tokens = [],
    text = code.slice(node.start, node.end);
  for (const token of acorn.tokenizer(text, { ecmaVersion: 'latest', allowHashBang: true })) tokens.push(token.type.label + '\u0001' + text.slice(token.start, token.end));
  return name + '\u0003' + tokens.join('\u0002'); // the binding name (const x = () => …, key: function …) sits outside the node: a rename is a change
}
function defineBodyKey(record, code, node) {
  let key;
  Object.defineProperty(record, 'bodyKey', { enumerable: false, get: () => (key === undefined ? (key = bodyKeyOf(code, node, record.name)) : key) });
}

/** a function's line span: the ONE measure behind len (long40 / long80) and the name-scope test (§6 Google 6.1) */
const spanOf = (walk, node) => walk.endLineOf(node) - walk.lineOf(node) + 1;
/** lines of the nearest function around the node on top of the stack (`own`: the node itself counts); module level = no limit */
function scopeLines(walk, own) {
  for (let at = walk.stack.length - (own ? 1 : 2); at >= 0; at--) if (FUNCTION_TYPES.has(walk.stack[at].type)) return spanOf(walk, walk.stack[at]);
  return MODULE_SCOPE;
}

/** one chunk's walk state: what the visitor collects, with the line maps of the chunk */
function newWalk(chunk, relPath) {
  const lineOf = (node) => node.loc.start.line + chunk.lineOffset;
  const endLineOf = (node) => node.loc.end.line + chunk.lineOffset;
  return {
    chunk,
    relPath,
    lineOf,
    endLineOf,
    functions: [],
    declarations: [],
    identifierUses: Object.create(null),
    literals: [],
    emptyCatches: [],
    stack: [],
    commentEndLines: new Map()
  };
}

/** is this function expression an IIFE / module wrapper: called at once (or .call'ed), near the top, and long — or the module's own top-level IIFE at any length (INT7b: page-frame.js, 82 lines) */
function isWrapperNode(node, parent, stack, lines) {
  if (node.type === 'FunctionDeclaration' || !parent) return false;
  const calledAtOnce = (parent.type === 'CallExpression' && parent.callee === node) || (parent.type === 'MemberExpression' && parent.object === node);
  const insideAFunction = stack.slice(0, -1).some((ancestor) => FUNCTION_TYPES.has(ancestor.type));
  return calledAtOnce && stack.length <= WRAPPER_MAX_DEPTH && (!insideAFunction || lines > WRAPPER_MIN_LINES);
}
/** a comment ends on the line above the function's statement, or above the function's own line (a nested function's what-line, INT7b) */
function commentAbove(walk, statement, node) {
  return walk.commentEndLines.has(statement.loc.start.line - 1) || walk.commentEndLines.has(node.loc.start.line - 1);
}
/** a function node: record it, open a new nesting/complexity context, declare its params */
function enterFunction(walk, node, parent) {
  const statement = enclosingStatement(walk.stack, node);
  const name = functionName(node, parent);
  const lines = spanOf(walk, node);
  const params = node.params.flatMap((param) => patternNames(param, []).map((id) => id.name));
  const record = {
    file: walk.relPath,
    name,
    anon: !name,
    params,
    line: walk.lineOf(node),
    endLine: walk.endLineOf(node),
    len: lines,
    depth: 0,
    complexity: 1,
    hasAbove: commentAbove(walk, statement, node),
    wrapper: isWrapperNode(node, parent, walk.stack, lines),
    stmtLine: walk.lineOf(statement)
  };
  const route = routeOf(node, parent);
  if (route) record.route = route;
  defineBodyKey(record, walk.chunk.code, node);
  walk.functions.push(record);
  node.params.forEach((param) => patternNames(param, []).forEach((id) => walk.declarations.push({ name: id.name, line: walk.lineOf(id), kind: 'param', scope: lines })));
  if (node.id && node.type === 'FunctionDeclaration') walk.declarations.push({ name: node.id.name, line: walk.lineOf(node.id), kind: 'function', scope: scopeLines(walk, false) });
  return record;
}

/** is a declarator the loop variable of a for header (`for (let i …)`, `for (const row of …)`)? */
function isForHeaderVariable(stack, parent) {
  const grandParent = stack[stack.length - 3];
  if (!parent || !grandParent || parent.type !== 'VariableDeclaration') return false;
  if (/^For(In|Of)?Statement$/.test(grandParent.type) && grandParent.init === parent) return true;
  return /^For(In|Of)Statement$/.test(grandParent.type) && grandParent.left === parent;
}

function noteDeclarator(walk, node, parent) {
  const kind = isForHeaderVariable(walk.stack, parent) ? 'forvar' : 'var';
  const code = walk.chunk.code;
  const init = node.init ? code.slice(node.init.start, Math.min(node.init.end, node.init.start + 60)).replace(/\s+/g, ' ') : '';
  patternNames(node.id, []).forEach((id) => walk.declarations.push({ name: id.name, line: walk.lineOf(id), kind, init, scope: scopeLines(walk, false) }));
}

/** strings R6 does not count: markup, double spaces, trivial words, dates, paths */
const STRING_NOISE = [/[<>{}]/, /\s{2,}/, TRIVIAL_STRINGS, /^\d{4}-\d{2}-\d{2}/, /^\.{0,2}\//];
const isCountedNumber = (value, parent) => Math.abs(value) > TRIVIAL_NUMBER_MAX && !TRIVIAL_NUMBERS.has(value) && !(parent && parent.type === 'SwitchCase');
const isCountedString = (value) => value.length >= MIN_LITERAL_STRING && !STRING_NOISE.some((noise) => noise.test(value));

/** a literal that is a path or a key, not a value: require('x'), import/export, a property key */
function isNotAValue(node, parent) {
  if (!parent) return false;
  if (parent.type === 'CallExpression') return !!parent.callee && parent.callee.name === 'require';
  return /^(Import|Export)/.test(parent.type) || isPropertyKey(node, parent);
}

/** a literal worth counting for R6 (not a require path, a key, an import, a case label, a date, a trivial value) */
function noteLiteral(walk, node, parent) {
  if (isNotAValue(node, parent)) return;
  const value = node.value;
  if (typeof value === 'number' && isCountedNumber(value, parent)) walk.literals.push({ kind: 'num', value: String(value), line: walk.lineOf(node) });
  else if (typeof value === 'string' && isCountedString(value)) walk.literals.push({ kind: 'str', value, line: walk.lineOf(node) });
}

/** `catch (e) {}` and `.catch(fn)` whose handler only carries on — silence is the bug (§6 Pass 2) */
function noteSilentCatch(walk, node) {
  if (node.type === 'CatchClause') {
    patternNames(node.param, []).forEach((id) => walk.declarations.push({ name: id.name, line: walk.lineOf(id), kind: 'catch' }));
    if (isSilentBody(node.body)) walk.emptyCatches.push({ line: walk.lineOf(node), form: 'catch {}' });
    return;
  }
  const isCatchCall =
    node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && !node.callee.computed && node.callee.property.name === 'catch';
  const handler = isCatchCall && node.arguments[0];
  if (handler && FUNCTION_TYPES.has(handler.type) && isSilentBody(handler.body)) walk.emptyCatches.push({ line: walk.lineOf(node), form: '.catch(fn)' });
}

/** the branch points that add to the enclosing function's cyclomatic complexity */
function noteComplexity(node, context) {
  if (!context) return;
  if (BRANCH_TYPES.has(node.type)) context.complexity++;
  else if (node.type === 'SwitchCase' && node.test) context.complexity++;
  else if (node.type === 'LogicalExpression') context.complexity++;
}

/** nesting: an `else if` is not a deeper level */
function noteNesting(node, parent, context, depth) {
  if (!context || !NESTING_TYPES.has(node.type)) return depth;
  const isElseIf = node.type === 'IfStatement' && parent && parent.type === 'IfStatement' && parent.alternate === node;
  if (isElseIf) return depth;
  if (depth + 1 > context.depth) context.depth = depth + 1;
  return depth + 1;
}

/** what one node adds to the facts (names used, declarations, literals, silent catches) */
const NOTE_BY_TYPE = {
  VariableDeclarator: (walk, node, parent) => noteDeclarator(walk, node, parent),
  ClassDeclaration: (walk, node) => {
    if (node.id) walk.declarations.push({ name: node.id.name, line: walk.lineOf(node.id), kind: 'class', scope: scopeLines(walk, false) });
  },
  Literal: (walk, node, parent) => noteLiteral(walk, node, parent),
  CatchClause: (walk, node) => noteSilentCatch(walk, node),
  CallExpression: (walk, node) => noteSilentCatch(walk, node),
  Identifier: (walk, node, parent) => {
    if (!isPropertyKey(node, parent)) walk.identifierUses[node.name] = (walk.identifierUses[node.name] || 0) + 1;
  }
};
const NOT_CHILDREN = new Set(['type', 'loc', 'start', 'end']);
const isNode = (value) => !!value && typeof value.type === 'string';

/** the recursive visit: one node, with the enclosing function context and nesting depth */
function visit(walk, node, context, depth) {
  if (!isNode(node)) return;
  const parent = walk.stack[walk.stack.length - 1];
  walk.stack.push(node);
  const isFunction = FUNCTION_TYPES.has(node.type);
  const nextContext = isFunction ? enterFunction(walk, node, parent) : context;
  if (!isFunction) noteComplexity(node, context);
  const nextDepth = isFunction ? 0 : noteNesting(node, parent, context, depth);
  const note = NOTE_BY_TYPE[node.type];
  if (note) note(walk, node, parent);
  for (const key of Object.keys(node)) {
    if (NOT_CHILDREN.has(key)) continue;
    const child = node[key];
    if (Array.isArray(child)) child.forEach((item) => visit(walk, item, nextContext, nextDepth));
    else visit(walk, child, nextContext, nextDepth);
  }
  walk.stack.pop();
}

// ── comments (R5) and the module header (R4)
const STORY_MARK = /[⭐⚠]/;
const CODEISH_LINE = /[;{}]\s*$|^\s*(var|let|const|if|for|return)\b/;
const HEADER_MAX_LINE = 80;
const HEADER_MAX_COMMENTS = 12;
const HTML_HEAD_BYTES = 6000;
const OWNS_WORDS = /\b(owns?|ownership|what it does|purpose|responsib|one place for)\b/i;
const CALLERS_WORDS = /(called (by|from)|callers?\b|used (by|from)|consumed by|who calls|required by|loaded by|imported by)/i;
const FLOW_WORDS = /(\bflow\b|initiali[sz]|init order|load order|startup|sequence|mermaid|──>|-->|──▶|─▶|→)/i;
const CARD_LINE = /\bCARD\s+([\w.-]+\/[\w.-]+)/;

/** comment blocks: adjacent `//` lines join; a trailing `code; // note` never joins a block */
function commentBlocks(comments, lines, lineOffset) {
  const blocks = [];
  let current = null;
  for (const comment of comments) {
    const startLine = comment.loc.start.line,
      endLine = comment.loc.end.line;
    const prose = comment.value
      .split('\n')
      .map((text) => text.replace(/^\s*\*?\s?/, '').trim())
      .filter(Boolean);
    const ownLine = lines[startLine - 1].slice(0, comment.loc.start.column).trim() === '';
    if (!ownLine) {
      current = null;
      blocks.push({ type: comment.type, start: startLine + lineOffset, end: endLine, lines: prose });
      continue;
    }
    if (comment.type === 'Line' && current && current.type === 'Line' && current.end === startLine - 1) {
      current.end = endLine;
      current.lines.push(...prose);
      continue;
    }
    current = { type: comment.type, start: startLine + lineOffset, end: endLine, lines: prose };
    blocks.push(current);
  }
  return blocks;
}

/** fold comment blocks into the R5 counters */
function countComments(blocks, relPath, counters) {
  for (const block of blocks) {
    const count = block.lines.length,
      isStory = STORY_MARK.test(block.lines.join(' '));
    const codeish = count > 0 && block.lines.filter((text) => CODEISH_LINE.test(text)).length >= Math.max(1, Math.ceil(count * 0.6));
    counters.lines += count;
    counters.blocks++;
    if (isStory) counters.story += count;
    if (codeish) counters.code += count;
    else if (count > 3 || isStory) {
      counters.narrative += count;
      counters.narBlocks++;
      counters.longest.push({ file: relPath, line: block.start, n: count, story: isStory });
    } else counters.short += count;
  }
}

/** a `'use strict';` directive is not the file's first code: the api's modules open `// @stage` · 'use strict' · the header block (INT7b) */
const isDirective = (node) => node && node.type === 'ExpressionStatement' && typeof node.directive === 'string';
/** the comment that opens the file (first chunk); for HTML also the page's first <!-- --> */
function readHeader(syntaxTree, comments, relPath, text) {
  const body = syntaxTree.body.filter((node) => !isDirective(node));
  const firstCode = body.length ? body[0].loc.start.line : Infinity;
  const leading = comments.filter((comment) => comment.loc.start.line <= Math.min(firstCode, HEADER_MAX_LINE)).slice(0, HEADER_MAX_COMMENTS);
  let header = leading.map((comment) => comment.value).join('\n');
  if (/\.html$/.test(relPath)) {
    const htmlComment = /<!--([\s\S]*?)-->/.exec(text.slice(0, HTML_HEAD_BYTES));
    if (htmlComment) header = htmlComment[1] + '\n' + header;
  }
  const card = CARD_LINE.exec(header);
  return {
    file: relPath,
    has: header.trim().length > 0,
    lines: header.split('\n').length,
    owns: OWNS_WORDS.test(header),
    callers: CALLERS_WORDS.test(header),
    flow: FLOW_WORDS.test(header),
    card: card ? card[1] : null,
    template: parseFields(header, relPath),
    loc: body.length ? body[body.length - 1].loc.end.line : 0
  };
}

// ── names (R1)
const ALLOWED_SHORT = new Set(['_', '$', 'e', 'err', 'x', 'y', 'i', 'j', 'k']);
/** Google JS style 6.1: a short name is fine where it is in scope for this many lines or fewer (DECISIONS 2026-11-12) */
const SHORT_NAME_SCOPE_LINES = 10;
const MODULE_SCOPE = Number.MAX_SAFE_INTEGER;
const MAX_CRYPTIC_LENGTH = 3;
/** conventional abbreviations READ-1 kept out of the cryptic count (req res db id key url … — flagging them is noise, not readability);
 *  READ-GUARD adds the two node module names every tool declares (`fs`, `os`) */
const CONVENTIONAL = new Set([
  'id',
  'req',
  'res',
  'key',
  'out',
  'ok',
  'el',
  'fn',
  'cb',
  'db',
  'url',
  'app',
  'ctx',
  'msg',
  'str',
  'num',
  'obj',
  'arr',
  'len',
  'idx',
  'min',
  'max',
  'sum',
  'tmp',
  'ids',
  'map',
  'set',
  'row',
  'opt',
  'ref',
  'pos',
  'div',
  'tag',
  'dir',
  'buf',
  'env',
  'arg',
  'now',
  'all',
  'any',
  'sql',
  'log',
  'rec',
  'ts',
  'uid',
  'pid',
  'ms',
  'tr',
  'td',
  'th',
  'ul',
  'li',
  'btn',
  'bar',
  'box',
  'cfg',
  'doc',
  'win',
  'api',
  'pg',
  'no',
  'yes',
  'on',
  'is',
  'to',
  'by',
  'of',
  'at',
  'in',
  'or',
  'and',
  'not',
  'new',
  'old',
  'top',
  'end',
  'col',
  'fs',
  'os'
]);

/** a declared name that says nothing: 1–3 characters, in a function over 10 lines (or at module level), not a counter i/j/k / catch param / geometry / conventional word */
function isCryptic(declaration) {
  if (declaration.kind === 'catch' || declaration.kind === 'forvar') return false;
  const name = declaration.name;
  if (name.length > MAX_CRYPTIC_LENGTH || name.length < 1 || ALLOWED_SHORT.has(name)) return false;
  if (declaration.scope <= SHORT_NAME_SCOPE_LINES) return false;
  return !CONVENTIONAL.has(name) && !CONVENTIONAL.has(name.toLowerCase());
}

// ── per file
/** add one chunk's walk to the file's facts */
function foldWalk(facts, walk) {
  facts.functions.push(...walk.functions);
  facts.declarations.push(...walk.declarations);
  facts.literals.push(...walk.literals);
  facts.emptyCatches.push(...walk.emptyCatches);
  for (const name of Object.keys(walk.identifierUses)) facts.identifierUses[name] = (facts.identifierUses[name] || 0) + walk.identifierUses[name];
}

/** the facts of one file given its text (so a base revision from `git show` measures the same way) */
function factsFromText(relPath, text) {
  const facts = {
    file: relPath,
    functions: [],
    declarations: [],
    identifierUses: Object.create(null),
    literals: [],
    emptyCatches: [],
    comments: { lines: 0, blocks: 0, short: 0, narrative: 0, narBlocks: 0, code: 0, story: 0, longest: [] },
    header: null,
    parseFail: null
  };
  let isFirstChunk = true;
  for (const chunk of chunks(relPath, text)) {
    const comments = [];
    let syntaxTree;
    try {
      syntaxTree = parse(chunk.code, comments);
    } catch (error) {
      facts.parseFail = String(error.message).slice(0, 120);
      continue;
    }
    const walk = newWalk(chunk, relPath);
    comments.forEach((comment) => walk.commentEndLines.set(comment.loc.end.line, comment));
    visit(walk, syntaxTree, null, 0);
    foldWalk(facts, walk);
    countComments(commentBlocks(comments, chunk.code.split('\n'), chunk.lineOffset), relPath, facts.comments);
    if (isFirstChunk) {
      facts.header = readHeader(syntaxTree, comments, relPath, text);
      isFirstChunk = false;
    }
  }
  /* MNT-51: a page with no inline script (or none that parsed) has no chunk to read, but its <!-- --> header sits in the page text itself */
  if (!facts.header && /\.html$/.test(relPath)) facts.header = readHeader({ body: [] }, [], relPath, text);
  if (!facts.header) facts.header = { file: relPath, has: false, lines: 0, owns: false, callers: false, flow: false, card: null, loc: 0 };
  facts.cryptic = facts.declarations.filter(isCryptic);
  return facts;
}

function fileFacts(file) {
  return factsFromText(file.rel, fs.readFileSync(file.abs, 'utf8'));
}

module.exports = { ADOPTED_HEAD, HEAD_BYTES, VENDOR_DIR, SKIP_DIR, isDataPack, SCOPE, CONVENTIONAL, ALLOWED_SHORT, collect, inScope, chunks, parse, factsFromText, fileFacts, isCryptic };
