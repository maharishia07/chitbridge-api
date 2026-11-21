/**
 * tests/role-matrix.test.cjs — register column 14 (role_matrix, OWASP API5:2023), the STATIC half: every route of the books, books-actions, books-grants and flags contracts DECLARES its seats,
 * the declaration is well formed (lib/role-matrix.js), it agrees with the gates the contract names and with the grant allow-lists of middleware/books-grant.js (a drift fence: a route added to
 * GRANT_READS without a new declaration, or the reverse, fails here), and the evidence file claims role_matrix only for a route that declares. The LIVE half (each seat asked through the real stack
 * on a real Postgres) is tools/role-matrix-live.cjs, run on a SIT box; it alone writes the evidence.
 * Run: node tests/role-matrix.test.cjs
 */
'use strict';
const path = require('path');
const fs = require('fs');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const matrix = require('../lib/role-matrix');
const grant = require('../middleware/books-grant');
const AREAS = { books: '/api/books', 'books-actions': '/api/books-actions', 'books-grants': '/api/books-grants', flags: '/api/flags' };
const EVIDENCE_FILE = path.join(__dirname, '..', 'docs', 'contracts', 'api-hardening-evidence-areas.json');

let pass = 0;
let fail = 0;
const check = (name, ok, extra) => {
  if (ok) pass++;
  else {
    fail++;
    console.log('  FAIL ' + name + (extra ? '\n       ' + extra : ''));
  }
};

/* the comparison the live run makes, unit-tested: what is a seat refusal, what is a business answer, what is the Problem shape */
const PROBLEM = { status: 403, code: 'OWNER_ONLY', title: 'x', detail: 'x' };
check('an allowed seat answered 200 is as declared', matrix.verdictOf({ status: 200, body: {} }, true, 'owner') === null);
check('an allowed seat answered 422 or 404 got past the gate', matrix.verdictOf({ status: 422, body: PROBLEM }, true, 'staff') === null && matrix.verdictOf({ status: 404, body: null }, true, 'owner') === null);
check('an allowed seat refused 403 is a SEAT difference', /^SEAT/.test(matrix.verdictOf({ status: 403, body: PROBLEM }, true, 'staff')));
check('an allowed seat that meets a 500 is a difference, a 503 is not', /^SEAT/.test(matrix.verdictOf({ status: 500, body: null }, true, 'owner')) && matrix.verdictOf({ status: 503, body: PROBLEM }, true, 'owner') === null);
check('a refused seat answered 403 in the Problem shape is as declared', matrix.verdictOf({ status: 403, body: PROBLEM }, false, 'staff') === null);
check('no sign-in must be answered 401, not 403', /^SEAT/.test(matrix.verdictOf({ status: 403, body: PROBLEM }, false, 'anon')) && matrix.verdictOf({ status: 401, body: Object.assign({}, PROBLEM, { status: 401 }) }, false, 'anon') === null);
check('a refused seat answered 404 or 200 is a SEAT difference (the handler was reached or the refusal hid)', /^SEAT/.test(matrix.verdictOf({ status: 404, body: PROBLEM }, false, 'staff')) && /^SEAT/.test(matrix.verdictOf({ status: 200, body: {} }, false, 'auditor')));
check('a refused 403 without status and code is a SHAPE difference', /^SHAPE/.test(matrix.verdictOf({ status: 403, body: { error: 'Not permitted' } }, false, 'staff')));
check('a declared seats object missing a seat is refused', matrix.problemsOf({ owner: 'allow' }).length > 0 && matrix.problemsOf(matrix.SEATS.OWNER_ONLY).length === 0);
check('allowedFor: staff edit means the editor level only', matrix.allowedFor(matrix.SEATS.EDITOR_NO_GRANT, 'staff', 'editor') && !matrix.allowedFor(matrix.SEATS.EDITOR_NO_GRANT, 'staff', 'viewer'));
check('the live runner exists beside its comparison', fs.existsSync(path.join(__dirname, '..', 'tools', 'role-matrix-live.cjs')));

const BANK_WRITES = /^POST \/(bank\/marks|bank\/statements|events|payments)$/;
let total = 0;
Object.entries(AREAS).forEach(([area, mount]) => {
  const contract = require('../lib/' + area + '-contract');
  Object.entries(contract.ROUTES).forEach(([key, row]) => {
    total++;
    const [method, route] = key.split(' ');
    const seats = row.seats;
    const bad = matrix.problemsOf(seats);
    check(area + ' ' + key + ' declares well formed seats', bad.length === 0, bad.join('; '));
    if (bad.length) return;
    const gates = row.gates || [];
    check(area + ' ' + key + ': anon is refused unless the route is public', seats.anon === (row.public || row.open ? 'allow' : 'deny'));
    check(area + ' ' + key + ': the operation carries x-seats', contract.operationFor(key)['x-seats'] === seats);
    if (area === 'books') {
      if (gates.includes('moneyReader')) check('books ' + key + ': a money-reader gate asks the manager hat of staff (AK-F-02)', seats.staff === 'manager');
      if (gates.includes('ownerOrAccountant')) check('books ' + key + ': an owner-or-accountant gate asks the manager hat of staff (AK-F-02)', seats.staff === 'manager');
      if (gates.includes('owner') && !gates.includes('comparer')) check('books ' + key + ': an owner gate refuses staff', seats.staff === 'deny');
      if (gates.includes('editor') && !gates.includes('owner')) check('books ' + key + ': an editor gate asks the editor level of staff', seats.staff === 'edit');
      /* the auditor reads exactly what GRANT_READS lists (GET only), the adviser what it, the adviser's extra reads, the bank reads and the doors list */
      const auditorReads = method === 'GET' && grant.GRANT_READS.has(route);
      check('books ' + key + ': auditor answer matches GRANT_READS', seats.auditor === (auditorReads ? 'read' : 'deny'));
      const adviserDoor = grant.ADVISER_DOORS.has(method + ' ' + mount + route) || BANK_WRITES.test(key);
      const adviserReads = method === 'GET' && (grant.GRANT_READS.has(route) || grant.FILE_READS.has(route) || grant.ADVISER_EXTRA_READS.has(route) || /^\/bank\/(log|rail)$/.test(route));
      check('books ' + key + ': adviser answer matches the adviser lists', seats.adviser === (adviserDoor ? 'door' : adviserReads ? 'read' : 'deny'));
    }
  });
});
check('the four areas declare 125 routes (120 + GET /books/depreciation/schedule + POST /books/year/:fy/reopen + POST /books/periods/:fy/:p/reopen, 9cfea0121; + GET and POST /books/backfill, walks P-F-02 and S2-F-07)', total === 125, total + ' routes');
check('a read-only seat is never declared for a write', Object.entries(AREAS).every(([area]) => Object.entries(require('../lib/' + area + '-contract').ROUTES).every(([key, row]) => key.startsWith('GET ') || row.seats.auditor !== 'read')));

const evidence = JSON.parse(fs.readFileSync(EVIDENCE_FILE, 'utf8')).routes || {};
const declared = new Set(Object.entries(AREAS).flatMap(([area, mount]) => Object.keys(require('../lib/' + area + '-contract').ROUTES).map((key) => key.split(' ')[0] + ' ' + mount + (key.split(' ')[1] === '/' ? '' : key.split(' ')[1]))));
/* API-1118-REPORTED: the live run also asks the three chits-holds routes and the one crm row that declares seats (tools/role-matrix-live.cjs --only chits-holds | --only crm --routes) */
Object.keys(require('../lib/chits-holds-contract').ROUTES).forEach((key) => declared.add(key.split(' ')[0] + ' /api/chits' + key.split(' ')[1]));
Object.entries(require('../lib/crm-contract').ROUTES).filter(([, row]) => row.seats).forEach(([key]) => declared.add(key.split(' ')[0] + ' /api/crm' + key.split(' ')[1]));
Object.entries(evidence).filter(([, columns]) => columns.role_matrix).forEach(([route]) => check('evidence role_matrix only on a route that declares seats: ' + route, declared.has(route)));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
