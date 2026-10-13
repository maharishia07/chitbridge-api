'use strict';
/**
 * tests/integrations-country.test.cjs — CX6 (K1): a connector is offered only where its kit works, read from the shop's country pack.
 *  · IN: every connector may (India's answer unchanged) · AU / AE: Tally, GoFrugal, Zoho greyed WITH a sentence; Till and CSV may
 *  · anonymous / no country: everything may (never a guess) · the download refuses what the catalogue greys (409, same sentence)
 *  · one read for the country, none when anonymous. No DB, no network.
 */
const path = require('path');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (name, cond, extra) => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '   ' + extra : '')); } };
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';

let country = 'IN';
const seen = [];
const dbPath = require.resolve(path.join(API, 'db'));
const realDb = require(dbPath);
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: Object.assign({}, realDb, {
  query: async (sql, params) => { seen.push(String(sql)); return { rows: /SELECT country FROM identities/.test(sql) ? [{ country }] : [] }; } }) };
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
const fakeAuth = Object.assign((req, res, next) => { req.identity = { identity_id: 'e1', identity_type: 'entity' }; next(); },
  { entityOf: (req) => req.identity.identity_id, requireScope: () => (req, res, next) => next() });
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };

const express = require('express');
const app = express();
app.use('/api/integrations', require(path.join(API, 'routes', 'integrations')));
const srv = app.listen(0, '127.0.0.1', async () => {
  const base = 'http://127.0.0.1:' + srv.address().port + '/api/integrations';
  const cat = async (signed) => { seen.length = 0; const r = await fetch(base + '/catalogue', { headers: signed ? { authorization: 'Bearer x' } : {} }); return (await r.json()).connectors; };
  const by = (list) => Object.fromEntries(list.map((c) => [c.id, c.may]));
  try {
    country = 'IN'; let m = by(await cat(true));
    t('IN: every connector may', Object.values(m).every((x) => x.ok === true && x.why === null));
    t('one read for the country when signed in', seen.length === 1);
    for (const c of ['AU', 'AE']) {
      country = c; m = by(await cat(true));
      t(c + ': Tally, GoFrugal, Zoho greyed with a sentence', ['tally', 'gofrugal', 'zoho'].every((id) => m[id].ok === false && /not offered for a/.test(m[id].why)), JSON.stringify(m));
      t(c + ': the sentence names the country, not a code', /Australia|United Arab Emirates/.test(m.tally.why));
      t(c + ': Till and CSV may', m.till.ok && m.csv.ok);
      const d = await fetch(base + '/download/tally', { headers: { authorization: 'Bearer x' } });
      const j = await d.json();
      t(c + ': the download refuses the same (409, same sentence)', d.status === 409 && j.code === 'NOT_FOR_COUNTRY' && j.error === m.tally.why);
    }
    country = null; m = by(await cat(true));
    t('no country set: everything may (never a guess)', Object.values(m).every((x) => x.ok));
    m = by(await cat(false));
    t('anonymous: everything may, no read', Object.values(m).every((x) => x.ok) && seen.length === 0);
    const one = (await cat(false))[0];
    t('the internal `fits` key never leaves the server', !('fits' in one));
  } catch (e) { fail++; console.log('  FAIL route ran  ' + (e && e.stack)); }
  srv.close(); console.log(`\n  ${pass} checks · ${fail} failed\n`); process.exitCode = fail ? 1 : 0; setTimeout(() => process.exit(fail ? 1 : 0), 50).unref();
});
