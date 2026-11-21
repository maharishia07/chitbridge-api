/**
 * tests/engine-calls-exist.test.cjs - THE API NEVER CALLS AN ENGINE FUNCTION ITS VENDORED COPY LACKS (EGM-T1 blocker B3, 21 Nov 2026: the landing trap).
 *
 * WHY       engines-pinned proves each adopted copy equals its tagged release; it cannot say the api CALLS something the pinned release does not have yet. tax-lines called gstReturns.zeroWordOf
 *           while lib/gst-returns.js (the adopted copy) had none: every India GSTR-3B month with a 0% line threw "not a function" in production, and CI was green because the new tests preloaded the
 *           engines CHECKOUT. This test loads the VENDORED copies only (CB_ENGINES_DIR is ignored, no tests/support/engines-checkout.cjs) and fails, naming file:line, for every call
 *           `<alias>.<name>(`, `require('./<engine>').<name>(` and every destructured name where <engine> is an adopted engine (engines.lock.json pins) and the vendored export lacks it.
 * OWNS      the guard; no state. CALLED BY scripts/guards.cjs - CI. Needs no engines checkout, no database.
 * Run: node tests/engine-calls-exist.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
delete process.env.CB_ENGINES_DIR;

const pins = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'engines.lock.json'), 'utf8')).pins || {});
const exportsOf = {};
for (const name of pins) {
  const file = path.join(ROOT, 'lib', name + '.js');
  if (!fs.existsSync(file)) continue;
  try { exportsOf[name] = require(file); } catch (e) { /* an engine that cannot load alone is not judged here (its own test says why) */ }
}
const engineNames = Object.keys(exportsOf);

function sourcesIn(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourcesIn(full, out);
    else if (/\.(js|cjs)$/.test(entry.name) && !/\.browser\.js$/.test(entry.name)) out.push(full);
  }
  return out;
}
const files = ['lib', 'routes', 'middleware'].reduce((all, dir) => sourcesIn(path.join(ROOT, dir), all), []);

let pass = 0, fail = 0;
const miss = [];
const IDENT = '[A-Za-z_$][\\w$]*';
/* from lib/ a sibling is ./name; from routes/ or middleware/ it is ../lib/name (routes/signin.js is not lib/signin.js) */
const requireOf = (name, inLib) => "require\\(\\s*['\"]" + (inLib ? '\\./' : '\\.\\./lib/') + name + "['\"]\\s*\\)";
for (const file of files) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  for (const name of engineNames) {
    if (rel === 'lib/' + name + '.js' || text.indexOf(name) < 0) continue;
    const api = exportsOf[name];
    const note = (index, what) => miss.push(rel + ':' + (index + 1) + '  ' + what + ' - lib/' + name + '.js (the adopted copy) has none');
    /* inline: require('./name').fn( */
    lines.forEach((line, index) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      const inline = new RegExp(requireOf(name, rel.startsWith('lib/')) + '\\.(' + IDENT + ')\\s*\\(', 'g');
      let hit;
      while ((hit = inline.exec(line))) if (typeof api[hit[1]] !== 'function') note(index, name + '.' + hit[1] + '()');
    });
    /* aliased: const x = require('./name'); then x.fn( - judged only where the alias is bound once in the file */
    const bound = [...text.matchAll(new RegExp('(?:const|let|var)\\s+(' + IDENT + ')\\s*=\\s*' + requireOf(name, rel.startsWith('lib/')) + '\\s*(?:;|$)', 'gm'))].map((m) => m[1]); /* the statement ends there: require(..).taxId(x) is not the engine */
    for (const alias of new Set(bound)) {
      if (bound.filter((other) => other === alias).length !== 1) continue;
      /* a name another scope also declares (a parameter, a destructured or arrow argument, a second const) is not this engine: skip it rather than guess */
      const escaped = alias.replace(/\$/g, '\\$');
      const declarations = (text.match(new RegExp('(?:const|let|var)\\s+' + escaped + '\\b', 'g')) || []).length;
      if (declarations !== 1 || new RegExp('(?:\\(|,)\\s*' + escaped + '\\s*(?:,|\\)|=[^=>])|\\b' + escaped + '\\s*=>').test(text)) continue;
      lines.forEach((line, index) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; /* a comment line */
        const call = new RegExp('(?<![\\w$.])' + alias.replace(/\$/g, '\\$') + '\\.(' + IDENT + ')\\s*\\(', 'g');
        let hit;
        while ((hit = call.exec(line))) if (typeof api[hit[1]] !== 'function') note(index, alias + '.' + hit[1] + '() on ' + name);
      });
    }
    /* destructured: const { a, b: c } = require('./name') */
    for (const m of text.matchAll(new RegExp('(?:const|let|var)\\s*\\{([^}]*)\\}\\s*=\\s*' + requireOf(name, rel.startsWith('lib/')), 'g'))) {
      for (const part of m[1].split(',')) {
        const prop = part.split(':')[0].replace(/=.*/, '').trim();
        if (new RegExp('^' + IDENT + '$').test(prop) && !(prop in api)) note(text.slice(0, m.index).split('\n').length - 1, '{ ' + prop + ' } from ' + name);
      }
    }
  }
}
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); process.exitCode = 1; } };
ok('the vendored engines load alone and there are adopted engines to judge (' + engineNames.length + ')', engineNames.length >= 5);
ok('every adopted-engine call in lib/, routes/ and middleware/ names a function the vendored copy exports', miss.length === 0, miss.slice(0, 25).join('\n          '));
ok('the trap itself: where tax-lines reads gstReturns.zeroWordOf, the adopted gst-returns has it', !/gstReturns\.zeroWordOf/.test(fs.readFileSync(path.join(ROOT, 'lib', 'tax-lines.js'), 'utf8')) || typeof (exportsOf['gst-returns'] || {}).zeroWordOf === 'function');
console.log('\n   ' + pass + ' checks' + (fail ? ' - ' + fail + ' FAILED' : ''));
