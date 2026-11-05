/**
 * tests/m3-invoice-one-builder.test.cjs — M3 (API-RATIONALISATION-ASSESSMENT): the invoice answer of a copy is built in ONE place.
 *
 * OWNS      (1) a connector key reaches GET /api/invoice/:id (200, with `sells`) and not GET /api/tax/invoice/:id (403), through the REAL scope map and the REAL requireScope;
 *           (2) the answer is assembled in lib/tax-copy (invoiceFrom) only: neither route spells a field of it, both call C.invoiceOf, and the contract names `sells` once.
 * CALLED BY scripts/guards.cjs · CI. No database, no network.
 * FLOW      real auth.allowsKey + requireScope → the two real routes over a planted copy → status and body; the route files read as text
 * CARD      01-rail-core-the-chit/chits-routes
 *
 * Run: node tests/m3-invoice-one-builder.test.cjs · MIN unit-per-rule · refusal-path
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const API = path.join(__dirname, '..');
const realAuth = require('../middleware/auth'); // BEFORE the stub: the real scope map and the real requireScope
const S = require('./support/work-stub.cjs');
const { E1, U } = S;
const stubMod = (rel, exports) => { const p = require.resolve(path.join(API, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };

let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(100) + (ok ? '' : JSON.stringify(got).slice(0, 300) + '   want ' + JSON.stringify(want).slice(0, 200)));
};

/* the auth in front of the routes: a CONNECTOR key, gated the way middleware/auth.js:76 gates it (the real map), then the route's own real requireScope */
const KEY = { scopes: ['connector'] };
stubMod('middleware/auth.js', Object.assign((req, res, next) => {
  req.identity = { identity_id: E1, identity_type: 'entity', entity_id: E1 };
  req.api_key = KEY;
  if (!realAuth.allowsKey(KEY.scopes, req.method, req.originalUrl.split('?')[0])) return res.status(403).json({ error: 'Forbidden' });
  next();
}, { entityOf: (req) => req.identity.entity_id, requireScope: realAuth.requireScope, userOf: (r) => r.identity }));
const entry = { chit_id: U(1), direction: 'sent', sells: true, status: 'accepted', provisional: false, frozen: true, rated: 1, unrated: 0, seller: { LglNm: 'Shop' }, buyer: { LglNm: 'Ravi' }, invoice: { Version: '1.1', ValDtls: { AssVal: 100 }, ItemList: [] } };
stubMod('lib/tax-copy.js', Object.assign({}, require('../lib/tax-copy'), { copyOf: async (id) => (id === U(1) ? { chit_id: id } : null), entryFor: async () => entry, invoiceOf: async () => require('../lib/tax-copy').invoiceFrom(entry) }));

const express = require('express');
const app = express();
app.use('/api/invoice', require('../routes/invoice'));
app.use('/api/tax', require('../routes/tax'));
const srv = http.createServer(app);
const call = (url) => new Promise((resolve, reject) => http.get({ port: srv.address().port, path: url }, (res) => {
  let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }));
}).on('error', reject));

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  console.log('\n══ M3 · one invoice answer, two doors ══\n');
  const inv = await call('/api/invoice/' + U(1)), tax = await call('/api/tax/invoice/' + U(1));
  t('a connector key reads GET /api/invoice/:id: 200 with `sells`', [inv.status, inv.body.sells], [200, true]);
  t('a connector key is refused GET /api/tax/invoice/:id: 403 (the tax scope covers rate and compute only)', tax.status, 403);

  /* the answer is built once */
  const read = (rel) => fs.readFileSync(path.join(API, rel), 'utf8');
  const FIELDS = ['provisional', 'frozen', 'seller', 'buyer', 'invoice', 'sells', 'chit_id'];
  const spellsOf = (rel) => FIELDS.map((f) => (read(rel).match(new RegExp(String.raw`\b${f}: e(ntry)?\.${f}\b`, 'g')) || []).length);
  t('lib/tax-copy spells each field of the answer once', spellsOf('lib/tax-copy.js'), FIELDS.map(() => 1));
  for (const rel of ['routes/invoice.js', 'routes/tax.js']) {
    t(rel + ' spells none of the answer fields and calls C.invoiceOf', [spellsOf(rel), /C\.invoiceOf\(hdr, me\)/.test(read(rel)), /C\.entryFor\(/.test(read(rel))], [FIELDS.map(() => 0), true, false]);
  }
  const contract = read('lib/tax-contract.js');
  t('the contract names `sells` in INVOICE_BLOCK and has no .concat([\'sells\']) beside it', [/INVOICE_BLOCK = \[[^\]]*'sells'/.test(contract), /concat\(\['sells'\]\)/.test(contract)], [true, false]);

  srv.close();
  console.log('\n  ' + (fail ? '✗' : '✓') + ' ' + pass + ' passed · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((failure) => { console.error(failure); process.exit(1); });
