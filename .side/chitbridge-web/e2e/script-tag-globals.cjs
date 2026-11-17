'use strict';
/**
 * script-tag-globals.cjs - A NAME A SCRIPT USES MUST BE DEFINED BY A SCRIPT THE PAGE LOADS.
 * OWNS      the cross-file check the size split (shrink, 17 Nov) broke: a function moved into a part file that a page never tagged
 * CALLED BY npm run check:tagged · .github/workflows/ci.yml · tests/script-tag-globals.test.cjs (the fixture)
 * FLOW      public/*.html + index.html -> script tags + inline scripts + files named in a loaded script (lazy loaders) -> acorn scope
 *           walk per file -> free identifiers -> must be a top-level name or window.X of some script on THAT page, or a browser global
 * CARD      qa/script-tag-globals
 *
 * WHY: finance.html and tasks.html did not tag cap-books-party.js after partyRowOf moved into it, so Receive/Pay threw.
 * node --check, every other guard and the Playwright specs were green: an undefined name is valid JavaScript until it runs.
 * Only TAGGED and inline scripts are checked (a file a loader merely names may never run on that page); a name a loader-named file defines still counts.
 * app.html: every /app/cap-*.js is loadable, so one name defined in ANY of them counts (the lazy ORDER is not checked here).
 *
 * Run: node e2e/script-tag-globals.cjs [--root <dir>] [--write]   exit 1 on a finding not in e2e/script-tag-globals.baseline.json
 *      --write rewrites the baseline (only to record names that are really defined at run time some other way; say why in the PR)
 */
const fs = require('fs');
const path = require('path');
const acorn = require(path.join(__dirname, '..', 'tools', 'vendor', 'acorn.cjs'));

const BROWSER = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, 'browser-globals.json'), 'utf8')));
const SCRIPT_TAG = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const WINDOW_NAMES = /\b(?:window|globalThis|self|root|win)\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*['"]([\w$]+)['"]\s*\])\s*=[^=]/g;
const FILE_LITERAL = /['"`](\/[\w./-]+\.js)(?:\?[^'"`]*)?['"`]/g;
const FN = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

function patternNames(p, out) {
  if (!p) return out;
  if (p.type === 'Identifier') out.push(p.name);
  else if (p.type === 'ObjectPattern') p.properties.forEach((x) => patternNames(x.type === 'RestElement' ? x.argument : x.value, out));
  else if (p.type === 'ArrayPattern') p.elements.forEach((x) => patternNames(x, out));
  else if (p.type === 'AssignmentPattern') patternNames(p.left, out);
  else if (p.type === 'RestElement') patternNames(p.argument, out);
  return out;
}
const isNode = (v) => v && typeof v.type === 'string';

/** names a statement list binds in its own block (let, const, class, function) */
function lexicals(stmts, into) {
  stmts.forEach((s) => {
    if (s.type === 'VariableDeclaration' && s.kind !== 'var') s.declarations.forEach((d) => patternNames(d.id, []).forEach((n) => into.add(n)));
    else if ((s.type === 'ClassDeclaration' || s.type === 'FunctionDeclaration') && s.id) into.add(s.id.name);
  });
}
/** var names (and sloppy block functions) hoisted to the function scope: never descends into a nested function */
function hoistVars(node, into) {
  if (!isNode(node)) return;
  if (node.type === 'VariableDeclaration' && node.kind === 'var') node.declarations.forEach((d) => patternNames(d.id, []).forEach((n) => into.add(n)));
  if (node.type === 'FunctionDeclaration' && node.id) { into.add(node.id.name); return; }
  if (FN.has(node.type) || node.type === 'ClassDeclaration' || node.type === 'ClassExpression') return;
  for (const k of Object.keys(node)) { const v = node[k]; if (Array.isArray(v)) v.forEach((x) => hoistVars(x, into)); else if (isNode(v)) hoistVars(v, into); }
}

/** one file's source -> { top: names it defines at top level / implicit global, free: [{name,line}] } */
function analyse(src) {
  const ast = acorn.parse(src, { ecmaVersion: 'latest', allowHashBang: true, allowReturnOutsideFunction: true, locations: true });
  const top = new Set(), free = [], implicit = new Set(), optional = new Set();
  const lookup = (name, scope) => { for (let s = scope; s; s = s.up) if (s.names.has(name)) return true; return false; };
  const ref = (node, scope) => { if (!lookup(node.name, scope)) free.push({ name: node.name, line: node.loc.start.line }); };
  const mk = (up, names) => ({ up, names: new Set(names) });
  function pattern(p, scope) { // only the parts of a binding pattern that are READS: defaults and computed keys
    if (!p) return;
    if (p.type === 'ObjectPattern') p.properties.forEach((x) => { if (x.type === 'RestElement') pattern(x.argument, scope); else { if (x.computed) visit(x.key, scope); pattern(x.value, scope); } });
    else if (p.type === 'ArrayPattern') p.elements.forEach((x) => pattern(x, scope));
    else if (p.type === 'AssignmentPattern') { pattern(p.left, scope); visit(p.right, scope); }
    else if (p.type === 'RestElement') pattern(p.argument, scope);
  }
  function assignTarget(t, scope) {
    if (t.type === 'Identifier') { if (!lookup(t.name, scope)) implicit.add(t.name); }
    else if (t.type === 'MemberExpression') visit(t, scope);
    else if (t.type === 'ObjectPattern') t.properties.forEach((x) => { if (x.type === 'RestElement') assignTarget(x.argument, scope); else { if (x.computed) visit(x.key, scope); assignTarget(x.value, scope); } });
    else if (t.type === 'ArrayPattern') t.elements.forEach((x) => x && assignTarget(x, scope));
    else if (t.type === 'AssignmentPattern') { assignTarget(t.left, scope); visit(t.right, scope); }
    else if (t.type === 'RestElement') assignTarget(t.argument, scope);
  }
  function fn(node, scope) {
    const names = ['arguments'];
    node.params.forEach((p) => patternNames(p, names));
    if (node.type === 'FunctionExpression' && node.id) names.push(node.id.name);
    const own = mk(scope, names);
    if (node.body.type === 'BlockStatement') { const v = new Set(); node.body.body.forEach((s) => hoistVars(s, v)); v.forEach((n) => own.names.add(n)); lexicals(node.body.body, own.names); }
    node.params.forEach((p) => pattern(p, own));
    if (node.body.type === 'BlockStatement') node.body.body.forEach((s) => visit(s, own)); else visit(node.body, own);
  }
  function visit(node, scope) {
    if (!isNode(node)) return;
    switch (node.type) {
      case 'Identifier': return ref(node, scope);
      case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression': return fn(node, scope);
      case 'BlockStatement': { const s = mk(scope, []); lexicals(node.body, s.names); return node.body.forEach((x) => visit(x, s)); }
      case 'ForStatement': case 'ForInStatement': case 'ForOfStatement': {
        const s = mk(scope, []); const head = node.type === 'ForStatement' ? node.init : node.left;
        if (head && head.type === 'VariableDeclaration' && head.kind !== 'var') head.declarations.forEach((d) => patternNames(d.id, []).forEach((n) => s.names.add(n)));
        for (const k of ['init', 'test', 'update', 'left', 'right', 'body']) {
          if (k === 'left' && head && head.type !== 'VariableDeclaration') assignTarget(head, s); else visit(node[k], s);
        }
        return;
      }
      case 'SwitchStatement': { visit(node.discriminant, scope); const s = mk(scope, []); node.cases.forEach((c) => lexicals(c.consequent, s.names)); return node.cases.forEach((c) => { visit(c.test, s); c.consequent.forEach((x) => visit(x, s)); }); }
      case 'CatchClause': { const s = mk(scope, patternNames(node.param, [])); pattern(node.param, s); return visit(node.body, s); }
      case 'ClassDeclaration': case 'ClassExpression': { const s = mk(scope, node.id ? [node.id.name] : []); visit(node.superClass, s); return node.body.body.forEach((m) => visit(m, s)); }
      case 'MethodDefinition': case 'PropertyDefinition': if (node.computed) visit(node.key, scope); return visit(node.value, scope);
      case 'StaticBlock': { const s = mk(scope, []); lexicals(node.body, s.names); return node.body.forEach((x) => visit(x, s)); }
      case 'VariableDeclaration': return node.declarations.forEach((d) => { pattern(d.id, scope); visit(d.init, scope); });
      case 'MemberExpression': visit(node.object, scope); return node.computed ? visit(node.property, scope) : undefined;
      case 'Property': if (node.computed) visit(node.key, scope); return visit(node.value, scope);
      case 'AssignmentExpression': if (node.operator === '=') assignTarget(node.left, scope); else visit(node.left, scope); return visit(node.right, scope);
      case 'UnaryExpression': if (node.operator === 'typeof' && node.argument.type === 'Identifier') { optional.add(node.argument.name); return undefined; } return visit(node.argument, scope);
      case 'LabeledStatement': return visit(node.body, scope);
      case 'BreakStatement': case 'ContinueStatement': case 'ImportDeclaration': case 'ExportNamedDeclaration': case 'ExportAllDeclaration': return undefined;
      default: for (const k of Object.keys(node)) { if (k === 'loc') continue; const v = node[k]; if (Array.isArray(v)) v.forEach((x) => visit(x, scope)); else if (isNode(v)) visit(v, scope); }
    }
    return undefined;
  }
  const program = mk(null, []);
  const vars = new Set(); ast.body.forEach((s) => hoistVars(s, vars)); vars.forEach((n) => program.names.add(n));
  lexicals(ast.body, program.names);
  program.names.forEach((n) => top.add(n));
  ast.body.forEach((s) => visit(s, program));
  implicit.forEach((n) => top.add(n));
  for (const m of src.matchAll(WINDOW_NAMES)) top.add(m[1] || m[2]);
  /* a name this file asks about with typeof is an optional dependency it guards itself; module/require/exports are the UMD tail */
  return { top, free: free.filter((f) => !optional.has(f.name) && !/^(module|require|exports)$/.test(f.name)) };
}

/** the source with its comments blanked: a file name in a comment is not a loader */
function uncomment(src) {
  const spans = [];
  try { acorn.parse(src, { ecmaVersion: 'latest', allowHashBang: true, allowReturnOutsideFunction: true, onComment: (block, text, start, end) => spans.push([start, end]) }); } catch (e) { return src; }
  let out = '', at = 0;
  spans.forEach(([a, b]) => { out += src.slice(at, a) + ' '.repeat(b - a); at = b; });
  return out + src.slice(at);
}

/** the scripts a page loads: tags in order, inline bodies, then files a loaded script names as a literal (lazy loaders) */
function pageScripts(root, pageFile) {
  const pub = path.join(root, 'public');
  const page = fs.readFileSync(pageFile, 'utf8');
  const dir = path.dirname(pageFile);
  const resolve = (src) => { const clean = src.split(/[?#]/)[0]; return clean.startsWith('/') ? path.join(pub, clean) : path.join(dir, clean); };
  const files = [], inline = [];
  for (const m of page.matchAll(SCRIPT_TAG)) {
    const attrs = m[1], type = (attrs.match(/\btype\s*=\s*["']?([\w/+-]+)/i) || [])[1];
    if (type && !/^(text\/javascript|application\/javascript|text\/babel)$/i.test(type)) continue;
    const src = (attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (src) { if (!/^https?:/i.test(src)) files.push(resolve(src)); } else if (m[2].trim()) inline.push(m[2]);
  }
  const seen = new Set(files.filter((f) => fs.existsSync(f)));
  const tagged = new Set(seen);
  const queue = [...seen];
  const isApp = path.basename(pageFile) === 'app.html';
  /* app.html loads a capability by name (ensureCap, CAP_OF, CAP_WITH): cap-<name>.js is loadable where app.html quotes '<name>' */
  if (isApp) {
    const tables = [...page.matchAll(/const CAP_(?:OF|WITH) = \{([\s\S]*?)\n?\}/g)].map((m) => m[1]).join(' ');
    const words = new Set([...tables.matchAll(/['"]([\w-]+)['"]/g)].map((m) => m[1]));
    fs.readdirSync(path.join(pub, 'app')).filter((f) => /^cap-.*\.js$/.test(f) && words.has(f.slice(4, -3))).forEach((f) => { const p = path.join(pub, 'app', f); seen.add(p); tagged.add(p); queue.push(p); });
  }
  let current = '(page)';
  const add = (p) => { if (!seen.has(p) && fs.existsSync(p)) { seen.add(p); queue.push(p); if (process.env.TAG_WHY && p.includes(process.env.TAG_WHY)) console.error('  ' + path.basename(p) + ' <- ' + current); } };
  const scan = (raw) => {
    const text = uncomment(raw);
    for (const m of text.matchAll(FILE_LITERAL)) add(resolve(m[1]));
    for (const m of text.matchAll(/ensureCap\(\s*['"]([\w-]+)['"]/g)) add(path.join(pub, 'app', 'cap-' + m[1] + '.js'));
    if (/['"]\/app\/['"]\s*\+/.test(text)) for (const m of text.matchAll(/['"]([a-z][\w-]*)['"]/g)) add(path.join(pub, 'app', m[1] + '.js'));
  };
  inline.forEach(scan);
  while (queue.length) { current = queue.shift(); scan(fs.readFileSync(current, 'utf8')); }
  return { files: [...seen], inline, tagged };
}

/** every finding of one tree: ['page|file|name', ...] with its first line */
function findings(root) {
  const pub = path.join(root, 'public');
  const pages = fs.readdirSync(pub).filter((f) => f.endsWith('.html')).map((f) => path.join(pub, f));
  if (fs.existsSync(path.join(root, 'index.html'))) pages.push(path.join(root, 'index.html'));
  const cache = new Map(), out = new Map(), parseErrors = new Set();
  const read = (f, key, src) => { if (!cache.has(key)) { try { cache.set(key, analyse(src === undefined ? fs.readFileSync(f, 'utf8') : src)); } catch (e) { parseErrors.add(key); cache.set(key, null); } } return cache.get(key); };
  for (const page of pages) {
    const { files, inline, tagged } = pageScripts(root, page);
    const units = files.map((f) => ({ id: path.relative(root, f).replace(/\\/g, '/'), a: read(f, f) })).concat(inline.map((s, i) => ({ inl: true, id: path.relative(root, page).replace(/\\/g, '/') + '#inline' + (i + 1), a: read(null, page + '#' + i, s) })));
    const defined = new Set(BROWSER);
    units.forEach((u) => u.a && u.a.top.forEach((n) => defined.add(n)));
    for (const u of units) if (u.a && (u.inl || tagged.has(path.join(root, u.id)))) for (const f of u.a.free) {
      if (defined.has(f.name)) continue;
      const key = path.relative(root, page).replace(/\\/g, '/') + '|' + u.id + '|' + f.name;
      if (!out.has(key)) out.set(key, f.line);
    }
  }
  return { out, parseErrors: [...parseErrors] };
}

/** name -> the public files that define it at top level (a hint for the fix: tag one of these) */
function definers(root) {
  const index = new Map();
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/^(node_modules|vendor|data|docs|fonts|pics)$/.test(e.name)) walk(full); return; }
    if (!e.name.endsWith('.js')) return;
    try { analyse(fs.readFileSync(full, 'utf8')).top.forEach((n) => { if (!index.has(n)) index.set(n, []); index.get(n).push(path.relative(path.join(root, 'public'), full).split(path.sep).join('/')); }); } catch (e2) { /* unparsable: not an index source */ }
  });
  walk(path.join(root, 'public'));
  return index;
}

module.exports = { analyse, findings, definers };

if (require.main === module) {
  const args = process.argv.slice(2);
  const root = args.includes('--root') ? path.resolve(args[args.indexOf('--root') + 1]) : path.join(__dirname, '..');
  const baselineFile = path.join(__dirname, 'script-tag-globals.baseline.json');
  const { out, parseErrors } = findings(root);
  if (args.includes('--write')) { fs.writeFileSync(baselineFile, JSON.stringify([...out.keys()].sort(), null, 0).replace(/","/g, '",\n"') + '\n'); console.log('baseline written: ' + out.size); process.exit(0); }
  if (args.includes('--all')) { const idx = definers(root); [...out].sort().forEach(([k, l]) => console.log(k + ':' + l + ' <- ' + (idx.get(k.split('|')[2]) || ['?']).join(' '))); console.log(out.size + ' unresolved; parse errors: ' + parseErrors.length); process.exit(0); }
  const allowed = new Set(fs.existsSync(baselineFile) ? JSON.parse(fs.readFileSync(baselineFile, 'utf8')) : []);
  const bad = [...out].filter(([k]) => !allowed.has(k));
  if (bad.length) {
    console.error('script-tag-globals: ' + bad.length + ' name(s) a script uses that no script on that page defines (page|file|name:line)');
    const idx = definers(root);
    bad.forEach(([k, l]) => console.error('  ' + k + ':' + l + ' (defined in: ' + (idx.get(k.split('|')[2]) || ['nowhere']).slice(0, 3).join(', ') + ')'));
    console.error('Fix: add the part file that defines the name to the page script tags (same line as its parent) and to any lazy loader.');
    process.exit(1);
  }
  console.log('script-tag-globals: ok, ' + out.size + ' baselined, 0 new' + (parseErrors.length ? '; ' + parseErrors.length + ' file(s) acorn cannot parse (skipped)' : ''));
}
