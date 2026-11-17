#!/usr/bin/env node
/**
 * tests/repoint-firm-clients-to-agency.test.cjs — the two rules of scripts/repoint-firm-clients-to-agency.cjs that keep it safe: it never runs against a host that could be production, and it moves only governance edges, and that the script refuses before it connects.
 * OWNS      the unit-per-rule and refusal-path proof of hostRefusal and edgesToMove, and the script's exits (3 for a production host, 2 for no firm name).
 * CALLED BY scripts/guards.cjs · by hand: node tests/repoint-firm-clients-to-agency.test.cjs
 * FLOW      require the script (not run) ──▶ host rule table ──▶ edge rule ──▶ child process refused with a production host and with no firm name ──▶ "<n> checks"
 * CARD      04-network/connections-and-invitations
 * No database, no network.
 */
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
const R = require(path.join(__dirname, '..', 'scripts', 'repoint-firm-clients-to-agency.cjs'));
const SCRIPT = path.join(__dirname, '..', 'scripts', 'repoint-firm-clients-to-agency.cjs');

let passed = 0,
  failed = 0;
const ok = (label, condition) => {
  if (condition) passed++;
  else {
    failed++;
    console.log('   FAIL ' + label);
  }
};

/* the host rule: localhost, db and sit-* only; everything else is refused (fail closed) */
for (const url of ['postgres://u:p@localhost:5432/cb', 'postgresql://u:p@127.0.0.1/cb', 'postgres://u:p@db:5432/cb', 'postgres://u:p@sit-au/cb', 'postgres://u:p@sit-au.internal.example/cb'])
  ok('accepts ' + url, R.hostRefusal(url) === null);
for (const url of [
  '',
  'not a url',
  'postgres://u:p@db.abcdef.supabase.co:5432/postgres',
  'postgres://u:p@aws-0-ap-south-1.pooler.supabase.com:6543/postgres',
  'postgres://u:p@containers.railway.app:5432/railway',
  'postgres://u:p@localhost.evil.com/cb',
  'postgres://u:p@sit.evil.com/cb',
  'postgres://u:p@10.0.0.5/cb',
  'postgres://localhost/cb'
])
  ok('refuses ' + (url || '(empty)'), /REFUSED/.test(R.hostRefusal(url) || ''));
ok('an undefined URL is refused, not accepted', /REFUSED/.test(R.hostRefusal(undefined)));

/* the edge rule: governance edges move; agency edges are already where they belong */
const rows = [
  { edge: 'e1', type: 'governance', state: 'active' },
  { edge: 'e2', type: 'agency', state: 'active' },
  { edge: 'e3', type: 'governance', state: 'suspended' }
];
ok('only the governance edges are to move', R.edgesToMove(rows).map((row) => row.edge).join() === 'e1,e3');
ok('an agency edge is left alone', !R.edgesToMove(rows).some((row) => row.type === 'agency'));
ok('no rows, nothing to move', R.edgesToMove([]).length === 0);
ok('the statement reads only live governance and agency edges of the named firm', /e\.type IN \('governance','agency'\)/.test(R.ROWS) && /e\.state IN \('active','suspended'\)/.test(R.ROWS) && /ILIKE \$1/.test(R.ROWS));

/* the script as run: a production host is refused before anything connects (exit 3); no firm name is a usage error (exit 2) */
const run = (env, args) => spawnSync(process.execPath, [SCRIPT].concat(args), { encoding: 'utf8', env: Object.assign({}, process.env, env), timeout: 20000 });
const prod = run({ DATABASE_URL: 'postgres://u:p@db.abcdef.supabase.co:5432/postgres' }, ['Some Firm', '--apply']);
ok('a production host exits 3 with the refusal in words', prod.status === 3 && /never production/.test(prod.stderr));
const noUrl = run({ DATABASE_URL: '' }, ['Some Firm']);
ok('no DATABASE_URL exits 3', noUrl.status === 3);
const noFirm = run({ DATABASE_URL: 'postgres://u:p@localhost:5432/cb' }, []);
ok('a local host but no firm name exits 2 with the usage line', noFirm.status === 2 && /usage/.test(noFirm.stderr));

console.log('\n  ' + (passed + failed) + ' checks' + (failed ? ', ' + failed + ' failed' : ', all ok'));
process.exit(failed ? 1 : 0);
