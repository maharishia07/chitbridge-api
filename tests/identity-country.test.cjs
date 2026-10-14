'use strict';
/**
 * tests/identity-country.test.cjs · GOV-AU1 — A COUNTRY NOBODY STATED IS NULL, NEVER INDIA.
 *
 * Athi, 14 Oct: "yes drop the DEFAULT 'IN' too". b376 drops `identities.country DEFAULT 'IN'` (000_baseline). F7 on the local walk:
 * a shop registered from Sydney was stored as India because an INSERT named no country. This guard replaces remembering, as
 * entity-kind.test.cjs did for entity_kind: every INSERT INTO identities NAMES country (the shop's for a party or actor it adds, the
 * registration's guess, or NULL when nobody knows), and the readers that used to say `|| 'IN'` never answer India for NULL.
 * Offline (stubbed handles). With GOV_AU1_DB=<postgres url> it also proves the column on a real database built from every migration.
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');

let pass = 0, fail = 0;
const it = async (what, fn) => {
  try { await fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { fail++; console.log('  FAIL ' + what + '\n      ' + e.message); }
};
/** comments blanked before scanning — guards in this repo have fired on their own prose */
const blank = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:\\])\/\/[^\n]*/g, (m) => m[0] + m.slice(1).replace(/[^\n]/g, ' '));
const files = [];
for (const dir of ['routes', 'lib']) for (const f of fs.readdirSync(path.join(API, dir))) if (/\.(js|cjs)$/.test(f)) files.push(path.join(dir, f));
const srcOf = (rel) => blank(fs.readFileSync(path.join(API, rel), 'utf8').replace(/\r\n/g, '\n'));

(async () => {
  console.log('\n══ GOV-AU1 · identities.country — stated, or NULL; never India by default ══\n');

  await it('every INSERT INTO identities in routes/ and lib/ names `country` in its column list', () => {
    const missing = [];
    for (const rel of files) {
      const src = srcOf(rel); let m; const re = /INSERT\s+INTO\s+identities\b/gi;
      while ((m = re.exec(src))) {
        const end = src.indexOf('`', m.index), stmt = src.slice(m.index, end < 0 ? m.index + 900 : end);
        const close = stmt.indexOf(')'), cols = close < 0 ? stmt : stmt.slice(0, close);
        if (!/\bcountry\b/.test(cols)) missing.push('  ' + rel + ':' + src.slice(0, m.index).split('\n').length);
      }
    }
    assert.deepStrictEqual(missing, [], 'these inserts name no country — before b376 India landed, after it NULL with nobody deciding:\n' + missing.join('\n'));
  });

  await it('no reader in routes/ or lib/ falls back to India for a country (`country … || \'IN\'`); a day ZONE is not a country (books-hooks.zoneOf, queued)', () => {
    const hits = [];
    for (const rel of files) srcOf(rel).split('\n').forEach((l, i) => {
      if (/country[^\n;]{0,60}(\|\||\?\?)\s*'IN'/i.test(l) && !/zone/i.test(l)) hits.push('  ' + rel + ':' + (i + 1) + '  ' + l.trim().slice(0, 120));
    });
    assert.deepStrictEqual(hits, [], hits.join('\n'));
  });

  await it('a party a shop adds (local-identity mint · mintMany) and an actor or connector it creates take THE SHOP\'s country, in the same statement', () => {
    const li = srcOf('lib/local-identity.js');
    assert.ok(/'supplier', \(SELECT country FROM identities WHERE identity_id = \$4\)\)/.test(li), 'mint: the shop ($4) country');
    assert.ok(/'supplier', \(SELECT country FROM identities WHERE identity_id = \$1\) FROM unnest/.test(li), 'mintMany: the shop ($1) country');
    for (const rel of ['routes/actors.js', 'routes/connectors.js', 'routes/integrations.js'])
      assert.ok(/\(SELECT country FROM identities WHERE identity_id = \$5\)/.test(srcOf(rel)), rel + ': the parent shop ($5) country');
  });

  /* registration: the guess named, or NULL — the column is ALWAYS named (no default decides) */
  const SQL = [];
  const dbPath = require.resolve(path.join(API, 'db')), realDb = require(dbPath);
  const fakeQ = async (sql, params) => { SQL.push({ sql: String(sql), params: params || [] }); return { rows: [], rowCount: 1 }; };
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: Object.assign({}, realDb, {
    query: fakeQ, withEntity: async (_e, fn) => fn({ query: fakeQ }), withTransaction: async (fn) => fn({ query: fakeQ }),
    trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } } }) };
  const signin = require(path.join(API, 'routes', 'signin'));
  signin.sendCode = async (req, res, who) => res.json({ ok: true, email: who.email });
  const { registerNew } = require(path.join(API, 'routes', 'entities'));
  const run = (body) => new Promise((done) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { done({ status: this.statusCode, body: b }); } };
    registerNew({ body, headers: {} }, res);
  });
  const countryOf = (q) => { const cols = (/\(([^)]*)\) VALUES/.exec(q.sql) || [])[1].split(',').map((s) => s.trim());
    const v = (/VALUES \(([^)]*)\)/.exec(q.sql) || [])[1].split(',').map((x) => x.trim())[cols.indexOf('country')];
    return cols.indexOf('country') < 0 ? 'NOT NAMED' : (/^\$\d+$/.test(v) ? q.params[Number(v.slice(1)) - 1] : v); };
  await it('a registration with NO guess names country NULL — never left to a default', async () => {
    SQL.length = 0;
    const r = await run({ user_id: 'no-guess-shop', display_name: 'no-guess-shop', email: 'noguess@example.com' });
    const ins = SQL.find((q) => /^INSERT INTO identities/.test(q.sql.trim()));
    assert.strictEqual(r.status, 200); assert.ok(ins, 'no insert'); assert.strictEqual(countryOf(ins), null);
  });
  await it('an IN registration is unchanged: country IN', async () => {
    SQL.length = 0;
    await run({ user_id: 'chennai-shop', display_name: 'chennai-shop', email: 'in@example.com', context: { country: 'IN', currency_code: 'INR', timezone: 'Asia/Kolkata' } });
    assert.strictEqual(countryOf(SQL.find((q) => /^INSERT INTO identities/.test(q.sql.trim()))), 'IN');
  });

  /* readers given NULL */
  const rules = require(path.join(API, 'lib', 'licence-rules'));
  await it('licence rules: NULL or a country with none → no rules (India\'s are never lent); IN unchanged', () => {
    assert.deepStrictEqual(rules.rulesFor(null).schemes, []); assert.deepStrictEqual(rules.rulesFor('AU').schemes, []);
    assert.deepStrictEqual(rules.coreSchemes(null, 'food'), []);
    assert.strictEqual(rules.rulesFor('IN'), rules.RULES.IN);
  });
  const header = require(path.join(API, 'lib', 'entity-header'));
  await it('the shop header for a NULL-country shop lists no India core licence as "not added"; an IN shop still does', () => {
    const me = { display_name: 'X', vertical: 'food', policy_flags: {} };
    const none = header.build({ me: Object.assign({ country: null }, me), profile: {}, compliance: [], docs: [], vault: [], now: new Date() });
    const ind = header.build({ me: Object.assign({ country: 'IN' }, me), profile: {}, compliance: [], docs: [], vault: [], now: new Date() });
    const core = (o) => JSON.stringify(o).match(/"core":true/g) || [];
    assert.strictEqual(core(none).length, 0, JSON.stringify(none).slice(0, 300));
    assert.ok(core(ind).length > 0, 'an IN food shop still lists its core licences');
  });
  const privacy = require(path.join(API, 'lib', 'privacy'));
  await it('a privacy request for a NULL-country shop with no country given is ASKED in words (never India\'s clock); AU stays AU', async () => {
    const h = (country) => ({ query: async (sql) => /to_regclass/.test(sql) ? { rows: [{ ok: true }] } : /SELECT country FROM identities/.test(sql) ? { rows: [{ country }] }
      : { rows: [{ request_id: 'r1', country: 'AU' }] } });
    let e = null; try { await privacy.logRequest(h(null), 'shop', { kind: 'access', who: 'Ann' }, 'me'); } catch (x) { e = x; }
    assert.ok(e && /country/i.test(e.message) && !/\bIN\b/.test(String(e.message).replace('like AU', '')), e ? e.message : 'not refused');
    let e2 = null; try { await privacy.logRequest(h('AU'), 'shop', { kind: 'access', who: 'Ann' }, 'me'); } catch (x) { e2 = x; }
    assert.ok(!e2 || !/country/i.test(e2.message), e2 && e2.message);
  });
  await it('books: enable with no country anywhere refuses NO_COUNTRY (books_setting.country is NOT NULL); no `|| \'IN\'` remains', () => {
    const b = srcOf('lib/books.js'); assert.ok(/if \(!country\) throw refuse\([\s\S]{0,160}'NO_COUNTRY'\)/.test(b));
    assert.ok(!/s\.country \|\| 'IN'/.test(srcOf('lib/books-store.js')));
  });

  /* the database itself (optional: a fresh local DB built from every migration) */
  if (process.env.GOV_AU1_DB) {
    const { Client } = require(path.join(API, 'node_modules', 'pg'));
    const c = new Client({ connectionString: process.env.GOV_AU1_DB }); await c.connect();
    try {
      await c.query('BEGIN');
      await it('DB: identities.country has no default after b376', async () => {
        const r = await c.query(`SELECT column_default FROM information_schema.columns WHERE table_name = 'identities' AND column_name = 'country'`);
        assert.strictEqual(r.rows[0].column_default, null);
      });
      const mk = async (name, country) => (await c.query(`INSERT INTO identities (bridge_id, display_name, email, identity_type, status, entity_kind${country !== undefined ? ', country' : ''})
        VALUES ($1, $2, $3, 'entity', 'active', 'test'${country !== undefined ? ', $4' : ''}) RETURNING identity_id, country`,
        ['GOVAU1' + name, name, name + '@gov-au1.test'].concat(country !== undefined ? [country] : []))).rows[0];
      await it('DB: an insert that names nothing stores NULL', async () => { assert.strictEqual((await mk('nothing')).country, null); });
      const au = await mk('sydney', 'AU'), ind = await mk('chennai', 'IN');
      const party = async (shop) => (await c.query(`INSERT INTO identities (bridge_id, display_name, user_id, identity_type, parent_entity_id, status, created_by, entity_kind, country)
        VALUES ($1, $2, $3, 'entity', $4, 'active', $4, 'supplier', (SELECT country FROM identities WHERE identity_id = $4)) RETURNING country`,
        ['GOVAU1p' + shop.identity_id.slice(0, 8), 'Supplier', 'govau1-' + shop.identity_id.slice(0, 8), shop.identity_id])).rows[0].country;
      await it('DB: a party added by an AU shop gets AU (local-identity.mint\'s statement)', async () => { assert.strictEqual(await party(au), 'AU'); });
      await it('DB: an IN shop is unchanged — its party gets IN', async () => { assert.strictEqual(await party(ind), 'IN'); });
    } finally { await c.query('ROLLBACK').catch(() => {}); await c.end(); }
  } else console.log('  (GOV_AU1_DB not set — the database checks are skipped)');

  console.log('\n' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
