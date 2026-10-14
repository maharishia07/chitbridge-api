/**
 * register-country-guess.test.cjs — FX-AU1 (F7, 2026-10-14): a new shop's COUNTRY is what the owner was shown.
 *
 * A Sydney browser registers; the governance panel showed Australia · AUD · Australia/Sydney. Before FX-AU1 the INSERT named no country,
 * the column default ('IN', 000_baseline) landed, and verify's COALESCE could never correct it — an owner who left before Continue had an
 * Indian shop, labelled "your registration" on the setup step. Proves, through routes/entities.registerNew with a stand-in db:
 *   · the guess is NAMED in the INSERT that creates the entity (country AU · currency AUD · timezone Australia/Sydney)
 *   · its source words are the SERVER's, from the evidence: "your time zone" · "the usual currency in Australia" · "your device clock",
 *     written onto b299's setup_source only while the step is not done
 *   · a language-only guess is labelled as such (never "your time zone"); a registration with NO guess names no country and stores no label
 *     (the DEFAULT stays — owner decision GOV-AU1 — but it is never called the owner's)
 * Run: node tests/register-country-guess.test.cjs
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

let SQL = [];
const dbPath = require.resolve(path.join(API, 'db'));
const h = { query: async (sql, params) => { SQL.push({ sql: String(sql), params, scoped: true }); return { rows: [], rowCount: 1 }; } };
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async (sql, params) => {
    const t = String(sql); SQL.push({ sql: t, params });
    if (/information_schema/.test(t)) return { rows: [{ ok: true, '?column?': 1 }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  },
  withEntity: async (e, fn) => fn(h), withTransaction: async (fn) => fn(h), onEntity: async (e, fn) => fn(h), readBatch: async () => [],
  trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } },
} };
const signin = require(path.join(API, 'routes', 'signin'));
signin.sendCode = async (req, res, who) => res.json({ ok: true, email: who.email });
const { registerNew } = require(path.join(API, 'routes', 'entities'));
const CS = require(path.join(API, 'lib', 'country-setup'));

const run = (body) => new Promise((done) => {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { done({ status: this.statusCode, body: b }); } };
  registerNew({ body, headers: {} }, res);
});
const insertOf = () => SQL.find((q) => /^INSERT INTO identities/.test(q.sql.trim()));
const colsOf = (q) => (/\(([^)]*)\) VALUES/.exec(q.sql) || [])[1].split(',').map((s) => s.trim());
/* a column's value: the VALUES slot in the same position — a $N reads the params, a literal is itself */
const valOf = (q, col) => { const v = (/VALUES \(([^)]*)\)/.exec(q.sql) || [])[1].split(',').map((x) => x.trim())[colsOf(q).indexOf(col)] || '';
  return /^\$\d+$/.test(v) ? q.params[Number(v.slice(1)) - 1] : v; };
const SYDNEY = { country: 'AU', currency_code: 'AUD', timezone: 'Australia/Sydney', locale: 'en-AU', languages: ['en-AU'], device: { type: 'desktop' } };

(async () => {
  console.log('\n══ FX-AU1 · registration stores the guess the owner was shown ══\n');
  SQL = [];
  let r = await run({ user_id: 'sydney-corner', display_name: 'sydney-corner', email: 'owner@sydney.example', context: SYDNEY });
  let ins = insertOf();
  ok('a Sydney browser registers → 200, and the INSERT that creates the entity NAMES country AU · currency AUD · timezone Australia/Sydney',
    r.status === 200 && ins && valOf(ins, 'country') === 'AU' && valOf(ins, 'currency_code') === 'AUD' && valOf(ins, 'timezone') === 'Australia/Sydney', ins && ins.sql);
  const src = SQL.find((q) => q.scoped && /INSERT INTO entity_governance/.test(q.sql));
  const words = src ? JSON.parse(src.params[1]) : {};
  ok('…and where each came from, in the server\'s words: your time zone · the usual currency in Australia · your device clock',
    words.country === 'your time zone' && words.currency === 'the usual currency in Australia' && words.timezone === 'your device clock', JSON.stringify(words));
  ok('…written only while the step is not done (a confirmed answer is never relabelled)', src && /WHERE entity_governance\.country_setup_at IS NULL/.test(src.sql));

  const lang = CS.guessOf({ country: 'AU', currency_code: 'AUD', timezone: 'Europe/London' });
  ok('a country the ZONE does not name came from the language — never labelled "your time zone"', lang.country === 'AU' && lang.source.country === 'the language your browser reports' && lang.source.timezone === 'your device clock', JSON.stringify(lang));
  ok('a zone Intl does not know is not stored (it would blank every date)', CS.guessOf({ country: 'AU', timezone: 'Mars/Olympus' }).timezone === null);

  SQL = [];
  r = await run({ user_id: 'api-fixture-shop', display_name: 'api-fixture-shop', email: 'fixture@example.com' });
  ins = insertOf();
  /* GOV-AU1 (b376): the column has no default now, so the INSERT always NAMES country — NULL when nobody guessed, never 'IN' */
  ok('NO guess (an API fixture): the INSERT names country NULL (never India), no currency or zone, and no source label is stored',
    r.status === 200 && ins && valOf(ins, 'country') === null && colsOf(ins).indexOf('currency_code') < 0 && colsOf(ins).indexOf('timezone') < 0 && !SQL.some((q) => /entity_governance/.test(q.sql)), ins && ins.sql);

  console.log('\n' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
