/**
 * tests/register-sums.test.cjs — THE ENDPOINT COUNT CANNOT DRIFT (coverage plan W4, Athi 30 Oct).
 *
 * OWNS      one check on docs/api-register.json: register total = Σ route files = Σ API groups, each exception a named row.
 * CALLED BY scripts/guards.cjs (every push). No DB, no network, no server.
 * CARD      28-platform-and-operations/api-standard
 *
 *   A  the register's own header count equals its rows
 *   B  Σ rows per route file = Σ rows per API group (owner_area) = the total, and a file and a group map one to one
 *   C  every file the register names exists on disk; a file outside routes/ is a NAMED exception (server.js direct routes, src/routes/network.js)
 *   D  every routes/*.js on disk that declares an endpoint is in the register (a new file fails until the register is regenerated)
 *   E  a path outside /api is a NAMED row (server.js /health and OPTIONS *; the ctp double mount is ONE row per handler with aliases, M7)
 * A new endpoint, file or prefix that breaks a sum fails here until `node tools/api-register.cjs` regenerates the register. Nothing is fixed by hand.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'api-register.json'), 'utf8'));
const rows = reg.routes;

const FILE_EXCEPTIONS = { 'server.js': 'direct routes in server.js', 'src/routes/network.js': 'the network router lives under src/' };
const PATH_EXCEPTIONS = {
  'GET /health': 'server.js', 'OPTIONS *': 'server.js',
};
/* M7: routes/ctp.js is mounted at / and at /api/ctp on purpose (server.js); the register holds ONE row per handler, the bare path is its alias */
const CTP_ALIASES = { 'GET /api/ctp/.well-known/ctp.json': ['/.well-known/ctp.json'], 'POST /api/ctp/deliver': ['/deliver'], 'POST /api/ctp/query': ['/query'] };

let pass = 0, fail = 0;
const ok = (name, cond, more) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name + (more ? ' · ' + more : '')); } };
const tally = (key) => rows.reduce((m, r) => ((m[key(r)] = (m[key(r)] || 0) + 1), m), {});
const sum = (m) => Object.values(m).reduce((a, b) => a + b, 0);

/* a part of a split router (routes/chits-trace.js of routes/chits.js) shares its parent's group: count the parent file */
const parentOf = require(path.join(ROOT, 'tools', 'server-mounts.cjs')).partParents(path.join(ROOT, 'routes'));
const unitOf = (file) => (file.startsWith('routes/') && parentOf[file.slice(7)] ? 'routes/' + parentOf[file.slice(7)] : file);
const byFile = tally((r) => unitOf(r.file)), byGroup = tally((r) => r.owner_area);
ok('A register header count = rows', reg.counts.routes === rows.length, reg.counts.routes + ' vs ' + rows.length);
ok('B Σ route files = total', sum(byFile) === rows.length, sum(byFile) + ' vs ' + rows.length);
ok('B Σ API groups = total', sum(byGroup) === rows.length, sum(byGroup) + ' vs ' + rows.length);
ok('B route files = API groups, one to one', Object.keys(byFile).length === Object.keys(byGroup).length, Object.keys(byFile).length + ' files vs ' + Object.keys(byGroup).length + ' groups');
const groupsOfFile = {};
for (const r of rows) (groupsOfFile[r.file] = groupsOfFile[r.file] || new Set()).add(r.owner_area);
const many = Object.entries(groupsOfFile).filter(([, s]) => s.size > 1).map(([f]) => f);
ok('B no route file spans two API groups', many.length === 0, many.join(', '));

for (const f of Object.keys(byFile)) {
  ok('C ' + f + ' exists on disk', fs.existsSync(path.join(ROOT, f)));
  ok('C ' + f + ' is under routes/ or a named exception', /^routes\/[^/]+\.js$/.test(f) || !!FILE_EXCEPTIONS[f]);
}
const declares = (f) => /\b(?:router|app)\.(?:get|post|put|patch|delete|all)\(/.test(fs.readFileSync(path.join(ROOT, 'routes', f), 'utf8'));
for (const f of fs.readdirSync(path.join(ROOT, 'routes')).filter((n) => n.endsWith('.js') && declares(n))) {
  ok('D routes/' + f + ' declares endpoints and is in the register', rows.some((row) => row.file === 'routes/' + f));
}
for (const r of rows.filter((x) => !x.path.startsWith('/api/'))) {
  ok('E ' + r.key + ' is a named row', PATH_EXCEPTIONS[r.key] === r.file, r.file);
}
for (const [k, a] of Object.entries(CTP_ALIASES)) ok('E ' + k + ' carries the bare-path alias ' + a.join(','), rows.some((r) => r.key === k && JSON.stringify(r.aliases) === JSON.stringify(a)));
ok('E no ctp bare-path row is counted as its own endpoint', !rows.some((r) => r.file === 'routes/ctp.js' && !r.path.startsWith('/api/')));
for (const [k, f] of Object.entries(PATH_EXCEPTIONS)) ok('E named row ' + k + ' still in the register', rows.some((r) => r.key === k && r.file === f));

console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
process.exit(fail ? 1 : 0);
