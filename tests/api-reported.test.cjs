/**
 * tests/api-reported.test.cjs — CAP-17 slice 1: the three REPORTED register columns (bfla_role_check · parameterised_query · rate_limited).
 * Proves: the SQL scan tells a placeholder from a built string · a limiter other than the global one is found, the global one is not · a role-gated route's gate
 * refuses a lower role (scene, tests/lib/bfla-world.cjs) and the committed evidence file says what the scene showed · the reported columns never enter a route's
 * status ("meets" is the machine columns plus a sign-off, as before) · every role gate in the app has a scene.
 * Run: node tests/api-reported.test.cjs [--write]   (--write refreshes bfla_role_check in docs/contracts/api-hardening-evidence-areas.json; then node tools/api-register.cjs)
 */
'use strict';
const path = require('path');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const API = path.join(__dirname, '..');
const reported = require('../tools/api-reported.cjs');
const world = require('./lib/bfla-world.cjs');
const loader = require('../tools/load-app.cjs');
const EVIDENCE_FILE = path.join(API, 'docs', 'contracts', 'api-hardening-evidence-areas.json');

const say = console.log.bind(console);
let pass = 0;
let fail = 0;
const check = (name, ok, extra) => {
  if (ok) pass++;
  else {
    fail++;
    say('  FAIL ' + name + (extra ? '\n       ' + extra : ''));
  }
};

/* ── parameterised_query: the scan ── */
const scan = (text) => reported.sqlCallsIn(text);
check('a placeholder query is not built', scan("await query('SELECT * FROM t WHERE a = $1', [a]);").built === 0);
check('a template with no ${..} is not built', scan('await query(`SELECT 1 FROM t WHERE a = $1`, [a]);').built === 0);
check('an UPPER_CASE constant in the template is allowed', scan('await query(`SELECT ${OTP_HASH_COL} FROM t WHERE a = $1`, [a]);').built === 0);
check('a $${n} placeholder number is allowed', scan('await query(`UPDATE t SET a = $${n}`, [a]);').built === 0);
check('a value in the template is built SQL', scan('await query(`SELECT * FROM t WHERE a = ${a}`);').built === 1);
check('a fragment joined into the template is built SQL', scan('await run(`UPDATE t SET ${sets.join(", ")} WHERE id = $1`, [id]);').built === 1);
check("a quoted string joined with + is built SQL", scan("await db.query('SELECT * FROM t WHERE a = ' + a);").built === 1);
check('a nested template inside ${..} does not end the scan early', scan('await query(`SELECT ${pick(`x`)} FROM t`);').built === 1);
check('req.query (a property, no call) is no SQL call', scan('const x = req.query.name;').calls === 0);
check('a call whose first argument is a variable is counted as a call, not as built', (() => { const r = scan('await query(sqlText, [a]);'); return r.calls === 1 && r.built === 0; })());
const file = 'function helper(id) { return query(`SELECT * FROM t WHERE a = ${id}`); }\nconst handler = async (req, res) => { await helper(req.params.id); };';
check('a same-file helper the handler calls is in its call tree', reported.parameterisedColumn('async (req, res) => { await helper(req.params.id); }', file).holds === false);
check('a handler that runs no SQL does not apply', reported.parameterisedColumn('(req, res) => res.json({})', '').applies === false);

/* ── rate_limited and bfla: the real stack ── */
loader.stubDatabase(API);
const app = loader.loadApp(API);
const leaves = loader.leavesOf(app, true);
const find = (method, route) => leaves.find((leaf) => leaf.method === method && leaf.path === route);
const signin = find('POST', '/api/signin/ask');
check('POST /api/signin/ask has the auth limiter mounted over it', !!signin && reported.rateLimitedColumn(signin) === true);
const plain = leaves.find((leaf) => !reported.rateLimitedColumn(leaf));
check('some route has only the global limiter and reads as not limited', !!plain);
const stranger = { chain: [{ fn: Object.assign(() => {}, { resetKey() {} }), mount: '', prefix: '', layer: { regexp: { fast_slash: true } } }], fns: [() => {}], path: '/api/x' };
check('a limiter mounted at the root is the global floor, not a per-endpoint limit', reported.rateLimitedColumn(stranger) === false);

(async () => {
  const gated = leaves.filter((leaf) => reported.roleGatesOf(leaf).length);
  check('the app has role-gated routes', gated.length > 0);
  const held = new Map();
  const faults = [];
  const gatesOf = (leaf) => [...leaf.chain.map((item) => (typeof item === 'function' ? item : item.fn)), ...leaf.fns.slice(0, -1)].filter((fn) => fn && fn.roleGate);
  for (const leaf of gated) {
    let all = true;
    for (const gate of gatesOf(leaf)) {
      if (!held.has(gate)) held.set(gate, await world.gateCase(gate));
      if (held.get(gate)) {
        all = false;
        faults.push(leaf.method + ' ' + leaf.path + ': ' + held.get(gate));
      }
    }
    leaf.holds = all;
  }
  check('every role gate refuses a lower role and lets the role it needs through', faults.length === 0, faults.slice(0, 3).join(' | '));
  const proved = Object.fromEntries(gated.filter((leaf) => leaf.holds).map((leaf) => [leaf.method + ' ' + leaf.path, true]));
  if (process.argv.includes('--write')) world.writeEvidence(EVIDENCE_FILE, proved);
  const onDisk = world.evidenceOf(EVIDENCE_FILE);
  check('the committed evidence says what the scene showed (run with --write after a change)', JSON.stringify(Object.keys(onDisk).sort()) === JSON.stringify(Object.keys(proved).sort()), Object.keys(proved).length + ' proved now, ' + Object.keys(onDisk).length + ' on disk');

  /* the reported columns never move a status */
  const { MACHINE_COLUMNS } = { MACHINE_COLUMNS: require('../docs/api-register.json').machine_columns };
  check('the reported names are not machine columns', reported.REPORTED_COLUMNS.every((name) => !MACHINE_COLUMNS.includes(name)));
  const register = require('../docs/api-register.json');
  check('every register row carries the three reported columns', register.routes.every((row) => reported.REPORTED_COLUMNS.every((name) => typeof row.reported[name] === 'boolean' && typeof row.reported_applies[name] === 'boolean')));
  check('no reported column sits in a row\'s machine columns', register.routes.every((row) => reported.REPORTED_COLUMNS.every((name) => !(name in row.columns))));
  say('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
