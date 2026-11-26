/**
 * tests/pathreds-1130.test.cjs — RW3-16 (auditor path A9): GET /periods names the return of the CLIENT's own pack, so a page that loads no pack registry
 * (network.html, the firm's client books) can name the tab "BAS" with no country table of its own.
 *
 * OWNS      the one new field `return_name` of GET /periods (additive, optional: wordsFor(pack).returnShort, null when the country has no pack word)
 * CALLED BY node tests/pathreds-1130.test.cjs (offline, the books harness; needs the sibling ../chitbridge-engines/src or BOOKS_ENGINES_SRC)
 * FLOW      books harness → enable an AU shop → GET /periods → the answer carries return_name BAS
 * RISK      plain
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

const AU = 'aaaaaaaa-2222-4111-8111-111111111111';
const authStub = Object.assign((req, res, next) => { req.identity = { identity_id: AU, identity_type: 'entity', display_name: 'Bondi Grocer' }; next(); }, {
  entityOf: (req) => req.identity.identity_id,
  requireScope: () => (req, res, next) => next(),
});
const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { j = { raw }; } done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});

(async () => {
  console.log('\n══ GET /periods names the client\'s return (RW3-16) ══\n');
  const X = H.load({ auth: authStub });
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  X.T.identities.push({ identity_id: AU, gstn: '51824753556', display_name: 'Bondi Grocer', country: 'AU', policy_flags: { gst_registration: 'regular' } });
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port;
  const q = (m, p, b) => call(port, m, '/api/books' + p, b);
  await X.store.saveSetting(X.db, AU, { enabled: false, country: 'AU' });
  ok('AU: the ledger is on', (await q('POST', '/enable', {})).body.ok === true);
  const per = await q('GET', '/periods');
  ok('GET /periods → 200', per.status === 200, JSON.stringify(per.body).slice(0, 200));
  ok('the answer names the return of the client pack: BAS', per.body.return_name === 'BAS', 'got ' + JSON.stringify(per.body.return_name));
  srv.close();
  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
