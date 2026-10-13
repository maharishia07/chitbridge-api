'use strict';
/**
 * prefs-merge.test.cjs — CU2: every ui_prefs / locale_prefs write is an RFC 7386 merge-patch, never the whole column.
 *  - saving the theme keeps the text size AND the shop's product_rows (the data loss CU1 found)
 *  - '' / null removes only its own key; a key not sent is untouched; a bad value is a 400 and writes nothing
 *  - locale saves keep keys the person did not send (and signin's langs_seen)
 *  - static: no UPDATE in routes/ or lib/ writes either column as `= $n` (the whole store)
 * Run: node tests/prefs-merge.test.cjs   · no DB, no network (db stubbed: one in-memory identities row).
 */
const path = require('path');
const fs = require('fs');
const API = path.join(__dirname, '..');

/* the one row; the stub applies `(COALESCE(col,'{}') - $3::text[]) || $1::jsonb` the way Postgres does */
let row = {}, writes = [];
const dbPath = require.resolve(path.join(API, 'db'));
const realDb = require(dbPath);
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: Object.assign({}, realDb, {
  query: async (sql, params) => {
    sql = String(sql); writes.push(sql);
    const m = /UPDATE identities SET (\w+) = \(COALESCE\(\1, '\{\}'::jsonb\) - \$3::text\[\]\) \|\| \$1::jsonb WHERE identity_id = \$2 RETURNING \1 AS v/.exec(sql);
    if (!m) throw new Error('unexpected SQL: ' + sql);
    const cur = Object.assign({}, row[m[1]] || {});
    for (const k of params[2]) delete cur[k];
    row[m[1]] = Object.assign(cur, JSON.parse(params[0]));
    return { rows: [{ v: row[m[1]] }], rowCount: 1 };
  },
}) };
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: Object.assign(
  (req, res, next) => { req.identity = { identity_id: 'e1', identity_type: 'entity' }; next(); },
  { entityOf: (req) => req.identity.identity_id, requireScope: () => (q, s, n) => n(), userOf: (r) => r.identity, forgetKey: () => {}, keyAlive: async () => true }) };

let pass = 0, fail = 0;
const t = (name, cond, extra) => { if (cond) { pass++; console.log('  ok   ' + name + (extra ? '   ' + extra : '')); } else { fail++; console.log('  FAIL ' + name + (extra ? '   ' + extra : '')); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const express = require('express');
const app = express();
app.use(express.json());
const entities = require(path.join(API, 'routes', 'entities'));
app.use('/api/entities', entities);
const srv = app.listen(0, '127.0.0.1', async () => {
  try {
    const patch = async (p, body) => { writes = []; const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/entities${p}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, j: await r.json() }; };

    row = { ui_prefs: { theme: 'light', fs: 'l', product_rows: ['pricing', 'product', 'stock'] } };
    let r = await patch('/me/prefs/ui', { theme: 'dark' });
    t('a theme save keeps the shop\'s product_rows', same(row.ui_prefs.product_rows, ['pricing', 'product', 'stock']), JSON.stringify(row.ui_prefs));
    t('a theme save keeps the text size it did not send', row.ui_prefs.fs === 'l');
    t('the theme itself changed', row.ui_prefs.theme === 'dark');
    t('the answer is the MERGED store', r.status === 200 && same(r.j.ui_prefs, row.ui_prefs), JSON.stringify(r.j));

    /* avatar.js always sends its four keys, '' meaning "the default" — the same result as before for its own keys */
    r = await patch('/me/prefs/ui', { theme: 'dark', fs: '', motion: 'reduce', stripes: '' });
    t("'' removes its own key only", !('fs' in row.ui_prefs) && row.ui_prefs.motion === 'reduce' && Array.isArray(row.ui_prefs.product_rows), JSON.stringify(row.ui_prefs));
    r = await patch('/me/prefs/ui', { motion: null });
    t('null removes (RFC 7386)', !('motion' in row.ui_prefs) && row.ui_prefs.theme === 'dark');

    const before = JSON.stringify(row.ui_prefs);
    r = await patch('/me/prefs/ui', { fs: 'huge' });
    t('a bad value is a 400 and writes nothing', r.status === 400 && writes.length === 0 && JSON.stringify(row.ui_prefs) === before, r.status);
    r = await patch('/me/prefs/ui', { product_rows: [] });
    t('a key outside the set cannot be written or erased through /me/prefs', same(row.ui_prefs.product_rows, ['pricing', 'product', 'stock']));

    row.locale_prefs = { lang: 'ta', nu: 'tamldec', langs_seen: ['ta', 'en'] };
    r = await patch('/me/prefs/locale', { hc: 'h12' });
    t('a locale save keeps the keys it did not send', row.locale_prefs.lang === 'ta' && row.locale_prefs.nu === 'tamldec' && row.locale_prefs.hc === 'h12', JSON.stringify(row.locale_prefs));
    t("…and signin's langs_seen", same(row.locale_prefs.langs_seen, ['ta', 'en']));
    r = await patch('/me/locale', { nu: '' });
    t('the legacy /me/locale door merges too', !('nu' in row.locale_prefs) && row.locale_prefs.lang === 'ta');
    t('ui_prefs untouched by a locale save', row.ui_prefs.theme === 'dark');

    /* static: no writer of either column replaces the whole store */
    const files = ['routes', 'lib'].flatMap((d) => fs.readdirSync(path.join(API, d)).filter((f) => f.endsWith('.js')).map((f) => path.join(API, d, f)));
    const bad = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      if (/SET\s+(ui_prefs|locale_prefs|\$\{set\.column\})\s*=\s*\$\d/.test(src)) bad.push(path.relative(API, f));
    }
    t('no UPDATE writes ui_prefs / locale_prefs whole (`= $n`)', bad.length === 0, bad.join(', '));
    const pp = entities.prefPatch(entities.PREF_SETS.ui, { theme: 'dark', fs: '', x: 'y' });
    t('prefPatch splits set / drop and ignores unknown keys', same(pp, { set: { theme: 'dark' }, drop: ['fs'] }), JSON.stringify(pp));
  } catch (e) { fail++; console.log('  FAIL threw: ' + (e && e.stack)); }
  console.log(`\nprefs-merge: ${pass + fail} checks · ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
  srv.close();
});
