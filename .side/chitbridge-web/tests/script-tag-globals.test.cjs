'use strict';
/**
 * script-tag-globals.test.cjs - the guard's own fixture: it must BITE on a name a page's scripts never define, and stay quiet otherwise.
 * OWNS      proof that e2e/script-tag-globals.cjs catches the 17 Nov shrink faults (a part file left untagged, a renamed local, another function's local)
 * CALLED BY npm run check:tagged · .github/workflows/ci.yml
 * CARD      qa/script-tag-globals
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyse, findings } = require('../e2e/script-tag-globals.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tagglobals-'));
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const page = (scripts) => '<!doctype html><script src="/app/parent.js"></script>' + scripts + '<script>var inlineName = 1;</script>';
const names = (tree) => [...findings(tree).out.keys()].map((key) => key.split('|')[0] + ' ' + key.split('|')[2]).sort();

/* the parent calls partyRowOf, which the split moved into party.js: tagged on a.html, forgotten on b.html (finance.html and tasks.html on 17 Nov) */
write('public/app/parent.js', 'function open() { return partyRowOf(1) + inlineName; }');
write('public/app/party.js', 'function partyRowOf(id) { return id; }');
write('public/a.html', page('<script src="/app/party.js"></script>'));
write('public/b.html', page(''));
assert.deepStrictEqual(names(root), ['public/b.html partyRowOf'], 'an untagged part file must be reported on that page only');

/* a name a loader names as a string counts as defined (the lazy loaders: ensureCap, list-ctl parts) */
write('public/app/lazy.js', 'function later() { return partyRowOf(2); }');
write('public/c.html', '<script src="/app/lazy.js"></script><script src="/app/parent.js"></script><script>function ensureCap() {} ensureCap("party");</script><script>var inlineName = 1;</script>');
write('public/app/cap-party.js', 'function partyRowOf(id) { return id; }');
assert.ok(!names(root).some((line) => line.startsWith('public/c.html')), 'ensureCap("party") loads cap-party.js: ' + names(root));

/* the same bytes, three ways a name is NOT free: a local, a parameter, a typeof guard; and one way it is: another function's local (crmPayButton, 17 Nov) */
const free = (src) => analyse(src).free.map((entry) => entry.name);
assert.deepStrictEqual(free('function f() { var icon = 1; return icon; }'), []);
assert.deepStrictEqual(free('function f(icon) { return icon; }'), []);
assert.deepStrictEqual(free('function f() { return typeof Maybe !== "undefined" ? Maybe.x : 0; }'), []);
assert.deepStrictEqual(free('function a() { var icon = 1; return icon; } function b() { return icon; }'), ['icon']);
assert.deepStrictEqual(free('function f(rows) { var r = rows; return rows.rows + r; } function g() { return missing.length; }'), ['missing']);
assert.deepStrictEqual(free('function f() { for (const x of [1]) { var y = x; } return y + x; }'), ['x'], 'a const is block scoped: read outside its loop it is free');
assert.deepStrictEqual(free('function f() { try { g(); } catch (e) { return e; } } function g() {}'), []);
assert.deepStrictEqual(free('const { a, b: { c } } = { a: 1, b: { c: 2 } }; function f() { return a + c; }'), []);
assert.ok(analyse('window.Shared = {};').top.has('Shared'), 'window.X = is a global the page defines');

fs.rmSync(root, { recursive: true, force: true });
console.log('script-tag-globals.test: ok');
