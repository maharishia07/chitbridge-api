'use strict';
/* tools/graph/entries.cjs: the ways a module is used that a call edge cannot see (R6 "used by nothing" was 66 api + 7 web, all with a real reference).
 * CARD      qa/readability-guard
 * Run: node tests/trace-entries.test.cjs */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { entryKindsOf, namedByOf, importedByOf, nodeRunPaths } = require('../tools/graph/entries.cjs');
let checked = 0;
const ok = (condition, label) => {
  assert(condition, label);
  checked++;
  console.log('  ok  ' + label);
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-entries-'));
const put = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
put('package.json', '{"scripts":{"check":"node scripts/a.js && node ./tools/b.cjs --x"}}');
put('.github/workflows/ci.yml', 'jobs:\n  t:\n    steps:\n      - run: node scripts/c.js\n      - run: node scripts/a.js');
put('scripts/a.js', 'module.exports = 1;');
put('tools/b.cjs', 'module.exports = 1;');
put('scripts/c.js', 'module.exports = 1;');
put('scripts/prove-x.js', 'console.log(1);'); /* exports nothing: run by a person */
put('scripts/lib-like.js', 'module.exports = { f() {} };'); /* exports and no run line: a library, not an entry */
put('scripts/usage.js', '/* node scripts/usage.js */\nmodule.exports = 1;');
put('scripts/uses-es.mjs', "import { f } from './core.mjs';\nexport default f;");
put('scripts/core.mjs', 'export const f = 1;');
put('tools/loader.js', "module.exports = (n) => require('./adapters/' + n);");
put('tools/adapters/one.js', 'module.exports = 1;');
put('tools/adapters/deep/two.js', 'module.exports = 2;');
put('public/p.html', '<script src="/app/units.js"></script>');
put('public/app/units.js', 'window.U = 1;');
put('public/app/boot.js', "navigator.serviceWorker.register('/sw.js');");
put('public/sw.js', 'self.x = 1;');
put('public/app/alone.js', 'window.A = 1;');

const files = ['scripts/a.js', 'tools/b.cjs', 'scripts/c.js', 'scripts/prove-x.js', 'scripts/lib-like.js', 'scripts/usage.js', 'scripts/uses-es.mjs', 'scripts/core.mjs', 'tools/loader.js', 'tools/adapters/one.js', 'tools/adapters/deep/two.js', 'public/p.html', 'public/app/units.js', 'public/app/boot.js', 'public/sw.js', 'public/app/alone.js'];
const kinds = entryKindsOf(root, files);
ok(kinds['scripts/a.js'] === 'cli' && kinds['tools/b.cjs'] === 'cli', 'a package.json script run line (with ./ and flags) marks cli');
ok(kinds['scripts/c.js'] === 'ci', 'a workflow run line marks ci');
ok(kinds['scripts/a.js'] === 'cli', 'cli wins over ci when both name it');
ok(kinds['scripts/prove-x.js'] === 'cli' && kinds['scripts/usage.js'] === 'cli', 'a script that exports nothing, or says "node <itself>", is a cli');
ok(!kinds['scripts/lib-like.js'] && !kinds['public/app/alone.js'], 'a library under scripts/ and a page script are not entries');
ok([...nodeRunPaths('node --max-old-space-size=4 "e2e/x.cjs"')].join() === 'e2e/x.cjs', 'node flags and quotes are read past');

const imported = importedByOf(root, files);
ok(JSON.stringify(imported['scripts/core.mjs']) === '["scripts/uses-es.mjs"]', 'an ES import resolves to the file');
ok(imported['tools/adapters/one.js'][0] === 'tools/loader.js' && !imported['tools/adapters/deep/two.js'], "require('./dir/' + name) reaches the files of that folder only");

const named = namedByOf(root, files);
ok(named['public/app/units.js'][0] === 'public/p.html', 'a script tag names the script');
ok(named['public/sw.js'][0] === 'public/app/boot.js', 'a quoted /sw.js names the service worker');
ok(!named['public/app/alone.js'], 'a file nobody names stays unnamed');

console.log('\n  ' + checked + ' checks, all green');
