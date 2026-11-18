/**
 * tests/api-register-helper-answers.test.cjs — THE REGISTER FOLLOWS A SAME-FILE HELPER THAT ANSWERS WITH problem( (API-11, 18 Nov 2026).
 *
 * OWNS      tools/api-register.cjs helpersCalledBy: a handler that answers through unknownProvider(req, res) or refuseVisit(...) has the helper's problem( call and codes counted for it;
 *           a helper with a raw status write, or a route handler, is not followed; plus the two real routes of routes/signin-provider.js in docs/api-register.json.
 * CALLED BY scripts/guards.cjs (every push). No DB, no network, no server.
 * CARD      28-platform-and-operations/api-standard
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { helpersCalledBy } = require('../tools/api-register.cjs');
let failed = 0;
const t = (name, ok) => { if (!ok) failed++; console.log((ok ? 'ok   ' : 'FAIL ') + name); };

const file = [
  "const refuse = (req, res) => problem(req, res, { status: 404, code: 'GONE_AWAY', detail: 'x' });",
  'function viaRefuse(req, res, code) {',
  '  return refuse(req, res);',
  '}',
  "const raw = (req, res) => res.status(400).json({ error: 'x' });",
  'const quiet = (req, res) => res.json({});',
  "router.get('/x', (req, res) => viaRefuse(req, res, 1));",
  ''
].join('\n');
t('a helper that answers with problem( is followed', helpersCalledBy('return refuse(req, res)', file).includes("code: 'GONE_AWAY'"));
t('a helper two calls deep is followed', helpersCalledBy('return viaRefuse(req, res, 1)', file).includes("code: 'GONE_AWAY'"));
t('a helper with a raw status write is not taken', helpersCalledBy('return raw(req, res)', file) === '');
t('a helper with no problem( is not taken', helpersCalledBy('return quiet(req, res)', file) === '');
t('a name that is not declared in the file is ignored', helpersCalledBy('return elsewhere(req, res)', file) === '');

const reg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'api-register.json'), 'utf8'));
['start', 'callback'].forEach((leaf) => {
  const row = reg.routes.find((x) => x.key === 'GET /api/signin/provider/:key/' + leaf);
  t(leaf + ': error_shape and codes_registered pass, codes seen', !!row && row.columns.error_shape && row.columns.codes_registered && row.errors.codes.includes('PROVIDER_UNKNOWN') && row.errors.codes.includes('PROVIDER_OFF'));
});
console.log(failed ? failed + ' FAILED' : 'all passed');
process.exit(failed ? 1 : 0);
