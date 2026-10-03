/**
 * web-api-contract.test.cjs — THE API'S ANSWERS, HELD TO THE FILE THE WEB IS BUILT AGAINST (docs/contracts/web-api.json).
 *
 * Why it exists (2026-10-03): the CRM list failed live because the API sends `roles` as an OBJECT { customer, supplier } while the web page — written
 * against its own e2e stand-in — read a list. Nothing joined the two. This test calls every route chitbridge-web reads through the REAL routers
 * (offline: a stubbed database, the books engines from ../chitbridge-engines, exactly as the books-* and crm-* tests do) and holds each answer to
 * the contract's example: the same keys, the same nesting, the same types. A route that changes shape fails HERE, before a screen does.
 * chitbridge-web keeps a copy (e2e/fixtures/web-api.contract.json) and checks every stand-in it serves against it (e2e/contract.cjs).
 *
 *   node tests/web-api-contract.test.cjs            check                       (offline, ~3 s)
 *   node tests/web-api-contract.test.cjs --write    rewrite the examples from the live answers — a DELIBERATE act: the diff is the shape change
 *
 * THE API'S COPY IS THE MASTER. After --write, copy the file to chitbridge-web/e2e/fixtures/web-api.contract.json (the web's e2e/contract.cjs
 * fails when the two differ and both repos are side by side).
 * Needs the books engines (BOOKS_ENGINES_SRC or ../chitbridge-engines/src), like the books-* tests; the CRM half needs nothing.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const S = require('./support/contract-shape.cjs');

const FILE = path.join(__dirname, '..', 'docs', 'contracts', 'web-api.json');

/* ── child mode: capture one half into a file (the two halves stub the database differently, so each gets its own process) ── */
if (process.argv[2] === '--capture') {
  const which = process.argv[3], out = process.argv[4];
  const run = which === 'crm' ? require('./support/contract-crm.cjs').captureCrm : require('./support/contract-books.cjs').captureBooks;
  run().then((g) => { fs.writeFileSync(out, JSON.stringify(g)); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
  return;
}

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

function capture(which) {
  const tmp = path.join(os.tmpdir(), 'web-api-contract-' + which + '-' + process.pid + '.json');
  const r = spawnSync(process.execPath, [__filename, '--capture', which, tmp], { encoding: 'utf8', env: Object.assign({}, process.env, { NODE_ENV: 'test' }) });
  if (r.status !== 0 || !fs.existsSync(tmp)) throw new Error('capture ' + which + ' failed: ' + (r.stderr || r.stdout || '').slice(0, 800));
  const g = JSON.parse(fs.readFileSync(tmp, 'utf8')); fs.unlinkSync(tmp); return g;
}

(function main() {
  const WRITE = process.argv.indexOf('--write') >= 0;
  console.log('\n══ docs/contracts/web-api.json — the answers the web reads ══\n');
  let C = null;
  try { C = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { if (!WRITE) { ok('the contract file is there and is JSON', false, e.message); return done(); } }
  C = C || { routes: {} };

  const crm = capture('crm'), books = capture('books');
  const booksOff = !!(books && books.skipped);
  if (booksOff) console.log('   SKIP the books half: ' + books.skipped);
  const got = Object.assign({}, crm, booksOff ? {} : books);

  if (WRITE) {
    const old = C.routes || {};
    const routes = {};
    Object.keys(got).sort().forEach((k) => {
      const g = got[k], ex = S.exampleOf(g.bodies);
      routes[k] = Object.assign({ status: g.status }, old[k] && old[k].note ? { note: old[k].note } : {}, { example: ex.example, optional: ex.optional.concat((old[k] && old[k].also_optional) || []).filter((v, i, a) => a.indexOf(v) === i).sort() });
      if (old[k] && old[k].also_optional) routes[k].also_optional = old[k].also_optional;
      if (old[k] && old[k].free) routes[k].free = old[k].free;
    });
    if (booksOff) Object.keys(old).forEach((k) => { if (/^[A-Z]+ \/api\/books/.test(k)) routes[k] = old[k]; });   /* never lose the books half because the engines are away */
    const next = Object.assign({}, C, { routes });
    next._about = next._about || 'THE API\'S COPY IS THE MASTER (chitbridge-api docs/contracts/web-api.json). chitbridge-web keeps e2e/fixtures/web-api.contract.json - the same file. tests/web-api-contract.test.cjs holds the API\'s real answers to it; chitbridge-web e2e/contract.cjs holds every stand-in to it. Change the shape of an answer here (node tests/web-api-contract.test.cjs --write), then copy the file across.';
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(next, null, 1) + '\n');
    console.log('   wrote ' + Object.keys(routes).length + ' routes to ' + path.relative(process.cwd(), FILE));
    return done();
  }

  /* ── the matcher agrees with its own self-test (the web runs the same cases against its own copy of the matcher) ── */
  (C._selftest || []).forEach((c, i) => {
    const p = S.problems(c.example, c.actual, c.optional || [], '', c.free || []);
    ok('selftest ' + (i + 1) + ': ' + c.name, (p.length === 0) === c.conforms, JSON.stringify(p));
  });
  ok('the self-test has cases (the web checks its matcher with them)', (C._selftest || []).length >= 8);

  const keys = Object.keys(C.routes || {});
  ok('the contract lists ' + keys.length + ' routes', keys.length > 30);
  /* every route the contract names answers, with the shape it names */
  keys.forEach((k) => {
    const want = C.routes[k], g = got[k];
    if (booksOff && /^[A-Z]+ \/api\/books/.test(k)) return;
    if (!g) { ok(k + ' answers in the scenario', false, 'the scenario no longer calls it - the contract and the test have drifted'); return; }
    const opt = new Set((want.optional || []).concat(want.also_optional || []));
    const p = [];
    g.bodies.forEach((b) => S.problems(want.example, b, opt, '', want.free || []).forEach((m) => { if (p.indexOf(m) < 0) p.push(m); }));
    ok(k + ' → ' + g.status + (g.status === want.status ? '' : ' (contract says ' + want.status + ')') + ' - same keys, nesting and types' + (g.bodies.length > 1 ? ' (' + g.bodies.length + ' answers)' : ''), g.status === want.status && p.length === 0, p.slice(0, 6).join(' | '));
  });
  /* …and every route the scenario calls is in the contract (a route can't join the web's reads unrecorded) */
  Object.keys(got).forEach((k) => { if (!C.routes[k]) ok(k + ' is in the contract', false, 'the scenario calls it, the contract does not list it - run with --write'); });

  /* the three shapes that broke before, spelled out so a careless --write cannot quietly bless them */
  const list = C.routes['GET /api/crm/parties'];
  ok('GET /crm/parties: roles is an OBJECT { customer, supplier }, dues one nested object, walk-ins their own list',
    list && list.example.parties[0].roles && !Array.isArray(list.example.parties[0].roles) && 'customer' in list.example.parties[0].roles && list.example.parties[0].dues && Array.isArray(list.example.walk_ins));
  ok('GET /crm/parties/:id carries merged_from as { party_id, party_no } and points as { programme, points, worth }',
    C.routes['GET /api/crm/parties/:id'] && C.routes['GET /api/crm/parties/:id'].example.merged_from && 'party_no' in C.routes['GET /api/crm/parties/:id'].example.merged_from
    && C.routes['GET /api/crm/parties/:id'].example.points && 'worth' in C.routes['GET /api/crm/parties/:id'].example.points);
  ok('GET /books/todo is a LIST of { kind, count, words, action }', Array.isArray((C.routes['GET /api/books/todo'] || { example: null }).example));
  done();

  function done() {
    console.log('\n  ' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + pass + ' passed · ' + (pass + fail) + ' checks\n');
    process.exit(fail ? 1 : 0);
  }
})();
