/**
 * tests/round-trips.test.cjs — GET /me has a round-trip BUDGET, and it is enforced.
 *
 * Athi, 2026-08-21: *"in the code if we make multiple rounds of read, that has to be addressed — possibly each
 * API needs to be assessed how many can be changed from read to write."*
 *
 * ⚠️⚠️ `/me` IS THE HOTTEST ENDPOINT ON THE PLATFORM — every screen calls it on every boot — AND IT WAS MAKING
 * EIGHT SEQUENTIAL ROUND TRIPS, four of them SELECTs against `identities`. Three of those four read the SAME
 * ROW as each other: the main one, then `storefront_access`, then `locale_prefs`/`ui_prefs`.
 *
 * ⭐ THEY WERE SEPARATE FOR A REASON THAT HAD EXPIRED. The old comment said so: *"this code deploys BEFORE b165
 * runs — folding the column into the main query would 500 every boot in the window between."* True when
 * written, and exactly what `lib/schema.js` was built to solve the same morning a `SELECT access_level` before
 * b173 took co-assist sign-in down. Probe what the database HAS, then name only that.
 *
 * ⭐⭐ A BUDGET, NOT A SNAPSHOT. Asserting the exact count would fail on any harmless change and get raised
 * reflexively until it meant nothing. A CEILING fails only when someone adds a round trip to the hottest
 * endpoint — which is the event worth interrupting a build for.
 */
const API = 'C:/dev/chitbridge-api';

let queries = [];
let COLUMNS = new Set(['timezone', 'supplies', 'storefront_access', 'locale_prefs', 'ui_prefs', 'capabilities']);

require.cache[require.resolve(API + '/db')] = { exports: {
  query: async (sql, args) => {
    queries.push(String(sql).replace(/\s+/g, ' ').trim());
    if (/information_schema\.columns/.test(sql)) {
      return { rows: COLUMNS.has(args[1]) ? [{ '?column?': 1 }] : [] };
    }
    if (/FROM identities WHERE identity_id/.test(sql)) {
      return { rows: [{ identity_id: 'e1', bridge_id: 'B', display_name: 'Test', email: 't@x.com',
        user_id: 'test', identity_type: 'entity', country: 'IN', currency_code: 'INR',
        storefront_access: 'login', locale_prefs: { lang: 'ta' }, ui_prefs: { theme: 'dark' },
        capabilities: ['dispute'] }] };
    }
    return { rows: [] };
  },
  withEntity: async (id, fn) => fn({ query: async (s, a) => { queries.push('TX ' + String(s).replace(/\s+/g, ' ').trim()); return { rows: [] }; } }),
  withTransaction: async (fn) => fn({ query: async () => ({ rows: [] }) }),
} };

const express = require('express');
const app = express();
app.use(express.json());
require.cache[require.resolve(API + '/middleware/auth')] = { exports: Object.assign(
  (req, res, next) => { req.identity = { identity_id: 'e1', identity_type: 'entity' }; next(); },
  { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id }
) };
app.use('/api/entities', require(API + '/routes/entities'));

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.error('  ✗ ' + name + (extra ? '   ' + extra : '')); }
};

const PORT = 45871;
const srv = app.listen(PORT, async () => {
  const get = (p) => new Promise((ok) => {
    require('http').get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
      let d = ''; r.on('data', (c) => { d += c; });
      r.on('end', () => ok({ status: r.statusCode, body: (() => { try { return JSON.parse(d); } catch (_) { return {}; } })() }));
    });
  });

  /* ── warm: the schema probes cache, so the steady-state cost is what matters ─────────────────────────── */
  await get('/api/entities/me');
  queries = [];
  const r = await get('/api/entities/me');

  const dbHits = queries.filter((q) => !/information_schema/.test(q));
  const idRead = dbHits.filter((q) => /SELECT .*FROM identities WHERE identity_id/.test(q));

  console.log('\n── GET /me, probes warm ──');
  t('responds 200', r.status === 200);

  /**
   * ⚠️ THE CEILING IS 8 AND THE MEASURED COST IS 7 (was 9). One spare, deliberately: a genuine new need should not
   * require editing a test in the same commit, or the number stops being a budget and becomes a formality.
   */
  t('at most 8 round trips', dbHits.length <= 8, 'measured ' + dbHits.length);

  /**
   * ⭐⭐ THE ASSERTION THAT ACTUALLY HOLDS THE FIX. One row, read once. It was read FOUR times — and the count
   * above would still pass if someone re-split them while removing a trip elsewhere.
   */
  t('`identities` is read ONCE for the caller\'s own row', idRead.length === 1,
    idRead.length + ' read(s)');

  console.log('\n── and the values still arrive ──');
  const e = r.body.entity || r.body;
  t('storefront_access comes from the row', e.storefront_access === 'login', String(e.storefront_access));
  t('locale_prefs comes from the row', (e.locale_prefs || {}).lang === 'ta', JSON.stringify(e.locale_prefs));
  t('ui_prefs comes from the row', (e.ui_prefs || {}).theme === 'dark', JSON.stringify(e.ui_prefs));

  /**
   * ⚠️ THE DEPLOY-BEFORE-MIGRATION CASE IS THE WHOLE REASON THESE WERE SEPARATE. With the columns absent the
   * route must still answer — with b77's default, and with `{}` meaning "never chosen" rather than "chose the
   * default", which is what CBLocale.hydrate distinguishes.
   */
  console.log('\n── the columns do not exist yet (code deployed before the migration) ──');
  COLUMNS = new Set(['capabilities']);
  require(API + '/lib/schema')._reset();
  await get('/api/entities/me');
  queries = [];
  const r2 = await get('/api/entities/me');
  const e2 = r2.body.entity || r2.body;
  t('still 200 — a missing column does not 500 the hottest endpoint', r2.status === 200);
  t('storefront_access falls back to browse', e2.storefront_access === 'browse', String(e2.storefront_access));
  t('locale_prefs is {} — "never chosen", not "chose the default"',
    JSON.stringify(e2.locale_prefs) === '{}', JSON.stringify(e2.locale_prefs));
  t('the shaped SELECT never names a column that is absent',
    !queries.some((q) => /FROM identities WHERE identity_id/.test(q) && /locale_prefs|storefront_access|ui_prefs/.test(q)));

  console.log('\n  ══ ' + pass + ' passed · ' + fail + ' failed ══\n');
  srv.close(); process.exit(fail ? 1 : 0);
});
