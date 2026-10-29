/**
 * tests/ctp-manifest.test.cjs — WHO THE MANIFEST SAYS WE ARE (RAIL-140 a).
 *
 * GET /.well-known/ctp.json is how a peer learns which public key belongs to which installation. Our identity is
 * configuration (INSTALLATION_KEY); the installation row only decorates it. The read used to fall back to ANY active
 * row, so with no row for our key the manifest published another installation's key beside our public key.
 *
 * The real router; db stubbed so the installation read answers like Postgres would for the SQL it is given.
 */
'use strict';
const path = require('path');
const G = require('./support/route-golden.cjs');
const API = G.API;
process.env.INSTALLATION_KEY = 'here-1';

/* the active installation rows, and the one Postgres would return for the statement it was sent */
function rows(sql, params, ctx) {
  if (/FROM installation WHERE active/.test(sql)) {
    const all = (ctx.rows || []).slice();
    if (/ORDER BY \(installation_key = \$1\) DESC/.test(sql)) {
      all.sort((a, b) => (b.installation_key === params[0]) - (a.installation_key === params[0]));
      return all.slice(0, 1);
    }
    if (/installation_key = \$1/.test(sql)) return all.filter((x) => x.installation_key === params[0]).slice(0, 1);
    return all.slice(0, 1);
  }
  if (/ops\.population/.test(sql)) return [{ code: 'live' }];
  return [];
}
const h = G.harness({ rows });
const ctpkeys = require(path.join(API, 'lib', 'ctpkeys'));
ctpkeys.status = () => ({ can_sign: true, public_key: 'PK-HERE', why: '' });
const app = h.app('/', require(path.join(API, 'routes', 'ctp')));

const OURS = { installation_key: 'here-1', label: 'Here', region: 'in', domain: 'here.example.com', ctp_endpoint: 'https://here.example.com/api/ctp' };
const OTHER = { installation_key: 'aaa-other', label: 'Other', region: 'au', domain: 'other.example.com', ctp_endpoint: 'https://other.example.com/api/ctp' };

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.error('  FAIL ' + name + (extra ? '   ' + extra : '')); }
};
const ask = async (ctx) => (await h.run(app, { method: 'GET', url: '/.well-known/ctp.json', ctx })).body || {};

(async () => {
  console.log('\n── the manifest names THIS installation ──');
  let b = await ask({ rows: [OTHER, OURS] });
  t('our row is there → our key, decorated by our row', b.installation_key === 'here-1' && b.label === 'Here' && b.endpoint === OURS.ctp_endpoint && b.public_key === 'PK-HERE', JSON.stringify(b));
  b = await ask({ rows: [OTHER] });
  t('no row for our key → our configured key, never another installation\'s', b.installation_key === 'here-1', JSON.stringify(b));
  t('no row for our key → nothing of the other row is published', b.label === null && b.region === null && b.endpoint === null, JSON.stringify(b));
  b = await ask({ rows: [] });
  t('no rows at all → our configured key', b.installation_key === 'here-1' && b.public_key === 'PK-HERE');

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
