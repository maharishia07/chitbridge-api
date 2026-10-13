#!/usr/bin/env node
/**
 * records-keeping.test.cjs — CO3 (2026-10-13): THE RECORD-KEEPING CLAIMS, PROVED FROM THE CODE. Offline: reads files, stubs the db.
 * Owner: "well documented in Standards and demonstrable" — each Standards row for these laws names this file as its evidence.
 *
 *   A · Companies (Accounts) Rules r.3(1) proviso / CGST r.56(8): the books' edit trail CANNOT BE DISABLED.
 *       Five tables refuse UPDATE/DELETE by trigger AND by grant; no runtime code can stand a trigger aside; no setting turns the log off;
 *       the masters' writers log every change. (The live twin of A is b303's PROOFS P3/P4 — run on the database.)
 *   B · Retention floors (IN 8 FY / 72 months GST · AU 5–7 y · AE 5–7 y): ONE floor, lib/policy.js RECORDS_FLOOR_YEARS, at least as long
 *       as every registered pack asks; the mint applies it under every copy; the sweep never lists a copy younger than it.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '   ' + extra : '')); }
}

/* offline: lib/policy.js and lib/retention.js require ../db (and pg) — a stub stands in; the sweep's SQL is read from it in B5 */
const seen = [];
const dbPath = path.join(ROOT, 'db', 'index.js');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async (sql, params) => { seen.push({ sql, params }); return { rows: /count\(\*\)/.test(sql) ? [{ n: 10 }] : [] }; },
  withEntity: async () => { throw new Error('not here'); } } };

/* ── A · the edit trail ─────────────────────────────────────────────────────────────────────────────────────────────── */
const BOOKS = ['journal_entry', 'journal_line', 'party_item', 'books_payment', 'books_change_log'];
const b273 = read('migrations/b273_books_journal.sql');
const b295 = read('migrations/b295_books_payment_advice_update.sql');
for (const t of BOOKS) {
  const fn = t === 'books_payment' ? 'books_payment_guard' : 'books_insert_only';
  const src = t === 'books_payment' ? b295 : b273;
  check('A1 ' + t + ': BEFORE UPDATE OR DELETE trigger → ' + fn,
    new RegExp('CREATE TRIGGER \\w+ BEFORE UPDATE OR DELETE ON ' + t + ' FOR EACH ROW EXECUTE FUNCTION ' + fn + '\\(\\)').test(src));
}
check('A2 cb_app has UPDATE and DELETE revoked on all five', /REVOKE UPDATE, DELETE ON journal_entry, journal_line, party_item, books_payment, books_change_log FROM cb_app/.test(b273));
check('A2 books_payment: the only UPDATE grant is the two advice columns (no money column)',
  /GRANT UPDATE \(advice_chit_id, advice_shared_at\) ON books_payment TO cb_app/.test(b295) && !/GRANT UPDATE ON books_payment/.test(b295));
const guard = (b295.match(/FUNCTION books_payment_guard\(\)[\s\S]*?\$t\$;/) || [''])[0];
check('A2 books_payment_guard lets through only an UPDATE of the advice columns, and raises on everything else (DELETE too)',
  /IF TG_OP = 'UPDATE'\s+AND \(to_jsonb\(NEW\) - 'advice_chit_id' - 'advice_shared_at'\) = \(to_jsonb\(OLD\)/.test(guard) && /END IF;\s+RAISE EXCEPTION/.test(guard));

/* no later migration drops a books trigger without putting one back, nor disables one */
const migs = fs.readdirSync(path.join(ROOT, 'migrations')).filter((f) => /^b(\d+)/.test(f) && +/^b(\d+)/.exec(f)[1] > 273);
const dropped = [];
for (const f of migs) {
  const s = read('migrations/' + f);
  for (const t of BOOKS) {
    if (new RegExp('DISABLE TRIGGER[^;]*|ALTER TABLE ' + t + '\\s+DISABLE', 'i').test(s) && s.includes(t)) dropped.push(f + ' disables on ' + t);
    const drops = new RegExp('DROP TRIGGER IF EXISTS \\w+ ON ' + t, 'i').test(s), recreates = new RegExp('CREATE TRIGGER \\w+ BEFORE UPDATE OR DELETE ON ' + t, 'i').test(s);
    if (drops && !recreates) dropped.push(f + ' drops on ' + t);
  }
}
check('A3 no later migration disables or drops a books trigger', dropped.length === 0, dropped.join(' · '));

/* no runtime code can stand the triggers aside (only an owner/superuser could; cb_app owns none — b303 P4) */
const RUNTIME = ['lib', 'routes', 'db', 'middleware', 'scripts', 'tools', 'server.js'];
/* the ONE known use, allowed with its reason: a dev loader that refuses any dotted (remote) host and any sealed NODE_ENV */
const ALLOWED = { 'tools/sim-load.cjs': 'LOCAL ONLY: refuses a non-localhost --db and a sealed NODE_ENV; wipes a simulated shop' };
const hits = [];
for (const r of RUNTIME) (function walk(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return;
  if (fs.statSync(abs).isDirectory()) { for (const f of fs.readdirSync(abs)) if (f !== 'node_modules') walk(path.join(rel, f)); return; }
  if (!/\.(c?js|mjs)$/.test(rel)) return;
  const s = fs.readFileSync(abs, 'utf8');
  if (/DISABLE\s+TRIGGER|session_replication_role|DROP\s+TRIGGER|ALTER\s+TABLE\s+(journal_entry|journal_line|party_item|books_payment|books_change_log)\s+DISABLE/i.test(s)) hits.push(rel.split(path.sep).join('/'));
})(r);
const bad = hits.filter((h) => !ALLOWED[h]);
check('A4 no runtime code disables, drops or alters a books trigger', bad.length === 0, bad.join(' · '));
check('A4 the allowed exception is still local-only', /LOCAL ONLY — THIS MUST NEVER TOUCH PRODUCTION/.test(read('tools/sim-load.cjs')));

/* no setting can switch the log off: no policy flag, no books_setting column names it */
const policy = require(path.join(ROOT, 'lib/policy.js'));
const TRAIL = /audit|change_?log|edit_?log|trail/i;
check('A5 no policy flag can switch the edit log off', !Object.keys(policy.FLAGS).some((k) => TRAIL.test(k)) &&
  !Object.values(policy.FLAGS).some((f) => Array.isArray(f.keys) && f.keys.some((k) => TRAIL.test(k))));
const settingCols = (read('migrations/b272_books_ledger.sql').match(/CREATE TABLE IF NOT EXISTS books_setting \(([\s\S]*?)\n\);/) || ['', ''])[1];
check('A5 books_setting has no column that switches the edit log off', settingCols.length > 0 && !TRAIL.test(settingCols), settingCols.slice(0, 80));

/* the masters' writers log every change (who · when · field · old → new) through the one writer, books-store logChange */
const WRITERS = { 'lib/books.js': ['ledger_account', 'fiscal_period', 'books_setting'], 'routes/books.js': ['books_setting'],
  'lib/finance-terms.js': [], 'lib/party-fields.js': [] };
for (const [f, tables] of Object.entries(WRITERS)) {
  const s = read(f);
  check('A6 ' + f + ' writes the change log', /logChange\(|INSERT INTO books_change_log/.test(s));
  for (const t of tables) check('A6 ' + f + ' logs ' + t, new RegExp("table_name: '" + t + "'").test(s));
}
check('A6 the change log has ONE writer', /async function logChange\(db, e, c\)[\s\S]*INSERT INTO books_change_log/.test(read('lib/books-store.js')));

/* ── B · the retention floor ───────────────────────────────────────────────────────────────────────────────────────── */
check('B1 RECORDS_FLOOR_YEARS is 9 (IN s.128(5): 8 financial years after the year, counted from the mint)', policy.RECORDS_FLOOR_YEARS === 9);
check('B1 RECORDS_FLOOR_DAYS is never a day short of 9 calendar years', policy.RECORDS_FLOOR_DAYS >= Math.ceil(9 * 365.25));
check('B1 the shop-settable floor cannot hold it (it sits UNDER the flag, not in it)', !('records_floor_days' in policy.FLAGS));

const reg = require(path.join(ROOT, 'lib/regulation.js'));
const packs = reg.list();
const over = packs.filter((p) => typeof p.retentionYears === 'number' && p.retentionYears > policy.RECORDS_FLOOR_YEARS);
check('B2 the floor is at least every registered pack\'s retentionYears (' + packs.map((p) => p.id + ':' + (p.retentionYears == null ? '—' : p.retentionYears)).join(' ') + ')', over.length === 0, over.map((p) => p.id).join(' '));

const chits = read('routes/chits.js');
check('B3 the mint puts the records floor under every copy (retainDaysFor)', /return Math\.max\(policy\.RECORDS_FLOOR_DAYS, floor, _reqDays \|\| 0\)/.test(chits));
const retainDays = (shopFloor, requested) => Math.max(policy.RECORDS_FLOOR_DAYS, shopFloor, requested || 0);
check('B3 a shop floor of 0 and a sender asking 1 day still keep 9 years', retainDays(0, 1) === policy.RECORDS_FLOOR_DAYS);
check('B3 a longer ask is honoured', retainDays(90, 5000) === 5000);

const b303 = read('migrations/b303_records_floor.sql');
check('B4 b303 sets the schema default to the same 9 years', /SET DEFAULT \(now\(\) \+ interval '9 years'\)/.test(b303));
check('B4 b303 only lengthens (every UPDATE is guarded by "< created_at + 9 years")', (b303.match(/UPDATE chit_status/g) || []).length === 2 &&
  (b303.match(/< created_at \+ interval '9 years'/g) || []).length >= 4 && !/DELETE FROM/i.test(b303));

/* the sweep: stub the db and read the SQL it would run */
(async () => {
  const retention = require(path.join(ROOT, 'lib/retention.js'));
  const out = await retention.planRetirement();
  const due = seen.find((q) => /retire_at <= now\(\)/.test(q.sql));
  check('B5 the sweep stays a dry run', out.mode === 'dry-run');
  check('B5 the sweep never lists a copy younger than the floor', !!due && /created_at <= now\(\) - make_interval\(years => \$1::int\)/.test(due.sql) &&
    Array.isArray(due.params) && due.params[0] === policy.RECORDS_FLOOR_YEARS);
  console.log('\nrecords-keeping: ' + fail + ' failed · ' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  ✗ ' + e.message); process.exit(1); });
