'use strict';
/**
 * chart-prefs.test.cjs — the person's chart choices are flat ui_prefs keys (chart engine step 1, REQ critic points 2 and 3).
 *   · the kinds are ONE list (lib/chart-prefs.js) and PREF_SETS.ui.keys reads it; the same list is pinned here AND in the web's tests/chart-kinds.test.cjs
 *   · a value outside the pattern or the closed lists is a 400 and writes nothing; a good one is stored and read back
 *   · the data-loss case: a device that has NOT hydrated changes its theme; the push carries no chart key, so the favourite SURVIVES (merge-patch)
 *   · only the changed key is sent: a chart_read push leaves the favourite and the theme alone
 *   · owner, adviser and auditor identities may each write it (own row, no client write)
 * Run: node tests/chart-prefs.test.cjs · no DB, no network (db stubbed: one in-memory identities row).
 */
const path = require('path');
const API = path.join(__dirname, '..');
let row = {},
  writes = [],
  WHO = 'owner';
const dbPath = require.resolve(path.join(API, 'db'));
const realDb = require(dbPath);
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: Object.assign({}, realDb, {
    query: async (sql, params) => {
      sql = String(sql);
      writes.push(sql);
      const m = /UPDATE identities SET (\w+) = \(COALESCE\(\1, '\{\}'::jsonb\) - \$3::text\[\]\) \|\| \$1::jsonb WHERE identity_id = \$2 RETURNING \1 AS v/.exec(sql);
      if (!m) throw new Error('unexpected SQL: ' + sql);
      const cur = Object.assign({}, row[m[1]] || {});
      for (const k of params[2]) delete cur[k];
      row[m[1]] = Object.assign(cur, JSON.parse(params[0]));
      return { rows: [{ v: row[m[1]] }], rowCount: 1 };
    }
  })
};
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: Object.assign(
    (req, res, next) => {
      req.identity = { identity_id: 'e1', identity_type: WHO === 'owner' ? 'entity' : 'adviser', role: WHO };
      next();
    },
    { entityOf: (req) => req.identity.identity_id, requireScope: () => (q, s, n) => n(), userOf: (r) => r.identity, forgetKey: () => {}, keyAlive: async () => true }
  )
};

let pass = 0,
  fail = 0;
const t = (name, cond, extra) => {
  if (cond) {
    pass++;
    console.log('  ok   ' + name);
  } else {
    fail++;
    console.log('  FAIL ' + name + (extra ? '   ' + extra : ''));
  }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const CP = require(path.join(API, 'lib', 'chart-prefs'));
const entities = require(path.join(API, 'routes', 'entities'));
const FL = require(path.join(API, 'lib', 'field-ledger'));
t('the kind list is the pinned one', same(CP.CHART_KINDS, ['series', 'rank', 'split', 'bridge']));
t('the type list is the pinned one', same(CP.CHART_TYPES, ['column', 'line', 'bar', 'stack', 'pie', 'donut', 'area', 'waterfall']));
t('PREF_SETS.ui reads the one list', CP.CHART_PREF_KEYS.every((k) => entities.PREF_SETS.ui.keys.includes(k)) && CP.CHART_PREF_KEYS.length === 2 + CP.CHART_KINDS.length);
t('the field ledger sees every chart key', CP.CHART_PREF_KEYS.every((k) => FL.prefKeys(API).ui_prefs.includes(k)));
t('every chart key has its FIELDS.md row', !FL.undocumentedSettings(API).some((k) => /chart_/.test(JSON.stringify(k))), JSON.stringify(FL.undocumentedSettings(API)));
t('every value fits the string-only prefPatch pattern', ['ocean-column', 'avatar-waterfall', 'on'].every((v) => !entities.prefPatch(entities.PREF_SETS.ui, { chart_theme: v }).error));

const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/entities', entities);
const srv = app.listen(0, '127.0.0.1', async () => {
  try {
    const patch = async (body) => {
      writes = [];
      const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/entities/me/prefs/ui`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: r.status, j: await r.json() };
    };

    for (const who of ['owner', 'adviser', 'auditor']) {
      WHO = who;
      row = { ui_prefs: {} };
      const r = await patch({ chart_theme: 'ocean', chart_read: 'on', chart_fav_series: 'ocean-column' });
      t(who + ': chart keys are accepted and stored on the own row', r.status === 200 && row.ui_prefs.chart_theme === 'ocean' && row.ui_prefs.chart_read === 'on' && row.ui_prefs.chart_fav_series === 'ocean-column', r.status + ' ' + JSON.stringify(r.j));
    }
    WHO = 'owner';
    const bads = [{ chart_read: 'maybe' }, { chart_fav_series: 'ocean-spiral' }, { chart_fav_series: 'ocean' }, { chart_theme: 'Ocean Blue' }, { chart_fav_unknownkind: 'ocean-column' }, { chart_fav_rank: 'ocean-' + 'x'.repeat(40) }];
    for (const bad of bads) {
      row = { ui_prefs: { chart_theme: 'ocean' } };
      const r = await patch(bad);
      t('refused and nothing written: ' + JSON.stringify(bad).slice(0, 50), r.status === 400 && !writes.length && same(row.ui_prefs, { chart_theme: 'ocean' }), String(r.status));
    }
    /* THE DATA-LOSS CASE: an un-hydrated device pushes its theme (and the other seven keys at their defaults, '' = drop): no chart key rides it */
    row = { ui_prefs: { theme: 'light', chart_theme: 'ocean', chart_read: 'on', chart_fav_series: 'ocean-column', chart_fav_split: 'ocean-donut' } };
    let r = await patch({ theme: 'dark', fs: '', motion: '', stripes: '', edition: '', font: '', weight: '', kural: '' });
    t(
      'an un-hydrated device changing its theme does not erase the favourite or the other chart keys',
      r.status === 200 && row.ui_prefs.theme === 'dark' && row.ui_prefs.chart_fav_series === 'ocean-column' && row.ui_prefs.chart_fav_split === 'ocean-donut' && row.ui_prefs.chart_theme === 'ocean' && row.ui_prefs.chart_read === 'on',
      JSON.stringify(row.ui_prefs)
    );
    r = await patch({ chart_read: 'off' });
    t('a chart_read push alone leaves the theme and the favourites alone', row.ui_prefs.chart_read === 'off' && row.ui_prefs.theme === 'dark' && row.ui_prefs.chart_fav_series === 'ocean-column');
    r = await patch({ chart_fav_series: '' });
    t('an empty favourite removes only that key', !('chart_fav_series' in row.ui_prefs) && row.ui_prefs.chart_fav_split === 'ocean-donut');
  } catch (e) {
    fail++;
    console.log('  FAIL threw ' + ((e && e.stack) || e));
  }
  srv.close();
  console.log('\n  ' + (fail ? '✗ ' + fail + ' failed' : '✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
});
