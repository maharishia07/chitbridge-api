/**
 * tests/register-route-helper.test.cjs — THE REGISTER SEES ROUTES REGISTERED THROUGH THE SHARED route(method, path, fn) HELPER (API-11, 7 Nov 2026).
 *
 * OWNS      one check on docs/api-register.json: every `route('post', '/x', ...)` line in routes/books.js has a row with that real line number
 *           (it had line 0, so tools/api-allowlist.cjs and every line-reading column skipped it), plus the reader unit itself.
 * CALLED BY scripts/guards.cjs (every push). No DB, no network, no server. The books file is only READ.
 * CARD      28-platform-and-operations/api-standard
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'api-register.json'), 'utf8'));
const lines = fs.readFileSync(path.join(ROOT, 'routes', 'books.js'), 'utf8').split('\n');
let failed = 0;
let count = 0;
const pass = () => count;
const t = (name, ok) => { count++; if (!ok) failed++; console.log((ok ? 'ok   ' : 'FAIL ') + name); };

const helperRoutes = [];
lines.forEach((text, at) => { const m = /^route\(\s*'(\w+)',\s*'([^']+)'/.exec(text); if (m) helperRoutes.push({ method: m[1].toUpperCase(), path: m[2], line: at + 1 }); });
t('the books file registers routes through route( (the test would be empty otherwise)', helperRoutes.length >= 11);
helperRoutes.forEach((r) => {
  const row = reg.routes.find((x) => x.file === 'routes/books.js' && x.method === r.method && x.path.endsWith(r.path) && x.line === r.line);
  t('register row for ' + r.method + ' ' + r.path + ' at routes/books.js:' + r.line, !!row);
});
t('no books row is left at line 0', reg.routes.filter((x) => x.file === 'routes/books.js' && x.line === 0).length === 0);

const { lineOf } = require('../tools/api-register.cjs');
const text = "router.get('/a', h);\nroute('post', '/assets', f);\nroute('post', '/assets/:id/dispose', f);\n";
t('lineOf reads a route( registration by method and exact path', lineOf(text, { method: 'POST', routePath: '/assets' }) === 2 && lineOf(text, { method: 'POST', routePath: '/assets/:id/dispose' }) === 3 && lineOf(text, { method: 'GET', routePath: '/assets' }) === 0);

/* a handler's text stops at the next route( registration, it does not run on into the neighbour's answers */
const { handlerText } = require('../tools/api-allowlist.cjs');
const pair = ["route('post', '/a', async (req, res) => {", '  res.json({ mine: 1 });', '});', "route('post', '/b', async (req, res) => {", '  res.json({ theirs: 2 });', '});'];
const first = handlerText(pair, 1);
t('handlerText stops before the next route( registration', first.includes('mine') && !first.includes('theirs') && !first.includes("'/b'"));
t('handlerText of the last route( runs to the end of the file', handlerText(pair, 4).includes('theirs'));
console.log(pass() + ' checks');
process.exit(failed ? 1 : 0);
