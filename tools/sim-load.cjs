#!/usr/bin/env node
/**
 * tools/sim-load.cjs — PUT THE THREE-YEAR SIMULATED SHOP INTO A REAL DATABASE (round Y1b; Y1 proved it in memory).
 *
 * The shop of tools/sim-plan.cjs — daily cash / UPI / credit bills, supplier purchases, expenses, month GST close + lock, the
 * year close — written into Postgres through THE SAME DOORS THE APP USES, with the api running in this process and the shop
 * clock (lib/shop-clock.js) set to each simulated day:
 *   · the shop: POST /api/entities/register + /verify (DEV_OTP) · Country setup: PUT /api/governance/country-setup (CS1) · the counter:
 *     POST /api/counters · the shelf: POST /api/products
 *   · parties: POST /api/relationships/suppliers · /customers (the minted local identities every shop gets)
 *   · the ledger: POST /api/books/enable · /opening · month: /gst/close · /periods/:fy/:p/lock · /year/:fy/close
 *   · every bill: POST /api/chits/send in the counter's own shape (tools/tally-connector/till.js chitOf — bill_no, till, billed_at,
 *     payment.parts, the invoice from lib/tax-lines.invoiceFor = CBTax.determine, the ONE calculation) → lib/books-hooks.afterChit
 *   · every day: the counter's day-summary chit (lib/rollup.chitOf) → the hook posts the walk-in day (books-hooks.postDay)
 *   · expenses: POST /api/books/events (the owner's ＋ Entry door) · purchases: lib/books.postEntry — the one writer the hook
 *     itself calls (a local supplier has no rail copy to accept, exactly as Y1 posted them)
 * Never a raw INSERT into a tenant table. The only SQL this file runs itself: the pre-checks, the "already loaded" marker, the
 * proof at the end (reads), and --fresh (the shop's rows removed, as the database owner, on a local database only).
 *
 * ⚠️⚠️ LOCAL ONLY — THIS MUST NEVER TOUCH PRODUCTION. `--db` is refused unless its host is localhost, 127.0.0.1, ::1 or a bare
 * docker service name (no dot in it: `db`, `postgres`). A Supabase / Railway / any dotted host is refused before anything
 * connects — tests/sim-load.test.cjs holds that rule. The api's own .env cannot redirect it: DATABASE_URL is set from --db
 * BEFORE server.js loads, and dotenv never overrides a variable already set. The local connection is proved with a direct
 * connect first, so db/index.js's pooler fallback is never reached.
 * HX2 — ONE remote exception, a cloud TEST SPIN (deploy/<platform>/test.sh): a dotted host is accepted only when CB_SPIN_ID is set
 * AND the URL's database is exactly `cbspin_<that id>` (production's is `postgres`) AND the host is not Supabase's. A spin's database
 * is made empty by its spin.sh and deleted by its teardown.sh; nothing else is ever named cbspin_….
 *
 * Idempotent per (shop, seed): the opening entry carries source_ref `opening:sim/seed-<n>/years-<y>`; a second run finds it and
 * says "already loaded" (the counts, the login) and writes nothing. `--fresh` removes that shop (and its minted parties) first.
 *
 *   node tools/sim-load.cjs --db postgres://postgres:pw@127.0.0.1:5432/cb_sim --shop simstores [--years 3] [--seed 7] [--country IN]
 *                           [--fresh] [--schema]
 *   --schema   the repo's schema first, through tools/migrate.cjs (HX1): an EMPTY database gets the chain (000_baseline + part2 +
 *              bNNN in number order; needs psql on PATH), a database with a schema_migrations ledger gets only what it lacks.
 *   --schema-only   the same schema step and nothing else — no shop, no api. (deploy/compose.yml's `migrate` job now calls
 *              tools/migrate.cjs directly.) A database with tables and an empty ledger is left as it is (exit 0).
 *   --years    financial years from 2026-04-01 (3) · --seed the plan's seed (7) · --country IN (proved) | AU | AE (CX0: accepted, unproved —
 *              the shop's currency · year · tax heads · rate menu are READ from its pack (lib/regulation.packFor); the loader types only
 *              what no pack says: SHOPS below. ⚠️ Until the api adopts the books engines ≥ v1.41 (accounts-packs is v1.20: PACKS.IN only),
 *              an AU/AE shop's chart is India's fallback and the proof is expected RED on purchases — web docs/design/standards/COUNTRY-COVERAGE.md)
 *   Env it sets for the in-process api when unset: NODE_ENV=development, DEV_OTP=123456, a local JWT_SECRET, SHOP_CLOCK_ALLOW=1,
 *   RATE_LIMIT_MAX (the 15-minute window would refuse a year of bills), LOG_LEVEL=warn.
 *   A sealed NODE_ENV (production · uat · staging · live) is refused.
 * Prints what it made (bills, purchases, parties, months closed) and the login to open it with; exits 1 when a proof line is red.
 */
'use strict';
const path = require('path'), fs = require('fs'), net = require('net'), http = require('http');
const { spawnSync } = require('child_process');
const API = path.join(__dirname, '..');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes('--' + k);

/* ── the one rule: a local database or nothing ─────────────────────────────────────────────────────────────────── */
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];
/** localOnly(url, env) → { ok, host, docker?, spin? } or { ok: false, why } — a host with a dot in it is never local (HX2: but a test spin's) */
function localOnly(url, env) {
  let u;
  try { u = new URL(String(url || '')); } catch (_) { return { ok: false, why: 'not a URL' }; }
  if (!/^postgres(ql)?:$/.test(u.protocol)) return { ok: false, why: 'not a postgres:// URL' };
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return { ok: false, why: 'no host in the URL' };
  if (LOCAL_HOSTS.includes(host)) return { ok: true, host };
  if (/^[a-z][a-z0-9_-]*$/.test(host)) return { ok: true, host, docker: true };
  const spin = String((env || process.env).CB_SPIN_ID || '');
  if (/^[a-z][a-z0-9]{5,15}$/.test(spin) && decodeURIComponent(u.pathname.slice(1)) === 'cbspin_' + spin && !/supabase\.(co|com)$/.test(host)) return { ok: true, host, spin: true };
  return { ok: false, why: '"' + host + '" is not localhost, 127.0.0.1 or a docker service name — this loader never touches a remote database' };
}
/** a migration file the schema step skips — the chain and its ledger live in tools/migrate.cjs (HX1) */
const { CHAIN_SKIP } = require('./migrate.cjs');

if (require.main !== module) { module.exports = { localOnly, CHAIN_SKIP }; return; }

/* ── arguments ─────────────────────────────────────────────────────────────────────────────────────────────────── */
const DB = arg('db', process.env.SIM_DB || ''), SHOP = String(arg('shop', '')).trim().toLowerCase();
const YEARS = Number(arg('years', 3)), SEED = Number(arg('seed', 7)), COUNTRY = String(arg('country', 'IN')).toUpperCase();
const FRESH = has('fresh'), SCHEMA_ONLY = has('schema-only'), SCHEMA = has('schema') || SCHEMA_ONLY;
const die = (m, code) => { console.error('\n  REFUSED: ' + m + '\n'); process.exit(code || 3); };
const loc = localOnly(DB);
if (!DB) die('say which local database: --db postgres://postgres:pw@127.0.0.1:5432/cb_sim');
if (!loc.ok) die(loc.why);
if (!SCHEMA_ONLY && !/^[a-z][a-z0-9]{2,19}$/.test(SHOP)) die('--shop is the shop\'s user id: 3–20 letters or digits, starting with a letter (e.g. simstores)');
if (!(YEARS >= 1 && YEARS <= 10) || !Number.isInteger(SEED)) die('--years 1..10 and --seed a whole number');
/* ── the three simulated shops, one per registered pack (CX0): ONLY what the pack does not say — a sample tax number that passes the pack's
   own check, the street, the city's clock offset and IANA zone, the phone. Currency · fiscal year · heads · rate menu come from the pack. */
const SHOPS = {
  IN: { taxNo: '33AABCS1234A1Z8', address: '12 Bazaar Street, Madurai', offset: '+05:30', zone: 'Asia/Kolkata', phone: '9876543210' },   /* Tamil Nadu (33) — the state the place-of-supply rule reads from the GSTIN; check digit 8 (profile-map.gstinChecksum) */
  AU: { taxNo: '51824753556', address: '12 Market Street, Parramatta NSW 2150', offset: '+10:00', zone: 'Australia/Sydney', phone: '0412345678' },   /* the ATO's published example ABN — passes reg-au abn.check */
  AE: { taxNo: '100000000000003', address: 'Shop 12, Al Fahidi Street, Bur Dubai', offset: '+04:00', zone: 'Asia/Dubai', phone: '0501234567' },   /* 15 digits — reg-ae trn.check is a format check only (AE0 §14) */
};
if (!SHOPS[COUNTRY]) die('--country IN, AU or AE (the registered packs: lib/regulation)');
if (require(path.join(API, 'lib', 'dev-otp')).isSealed()) die('NODE_ENV is sealed (' + process.env.NODE_ENV + ') — the loader runs only with NODE_ENV=development (or test)');

const PLAN_LIB = require(path.join(__dirname, 'sim-plan.cjs'));
require(path.join(API, 'lib', 'tax-packs'));           /* loads lib/regulation with the three packs registered */
const PACK = require(path.join(API, 'lib', 'regulation')).packFor(COUNTRY);   /* currency · fiscalYear · taxHeads · tax.scheme · tax.standard_rate · chart.paymentModes */
if (!PACK) die('no regulation pack is registered for ' + COUNTRY);
/* ⭐ WX-R2R: the shop's CALENDAR is the pack's (IN an April year · AU a July year · AE a January year) — the plan starts on the pack's
   first month; one reader for the bill series, the month close and the proof (lib/accounts-packs fiscalYearOf · periodOf · fyRange below). */
const PLAN = PLAN_LIB.planDays({ start: '2026-' + String(PACK.fiscalYear.startMonth).padStart(2, '0') + '-01', years: YEARS, seed: SEED });
const WANT = PLAN_LIB.countOf(PLAN);
const MARK = 'sim/seed-' + SEED + '/years-' + YEARS;
const EMAIL = SHOP + '@test.example';                 /* a fixture domain (lib/entitykind) — the shop is a TEST business, never a live one */
const OTP = process.env.DEV_OTP || '123456';
const TILL = 'C1';
const dayAdd = PLAN_LIB.dayAdd;
const SHOPROW = SHOPS[COUNTRY];
const CUR = PACK.currency;
const AT = (d, hh, mm) => d + 'T' + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':00' + SHOPROW.offset;   /* the shop's own wall clock */
/* the year and the month number THE API USES for this shop: lib/accounts-packs (the adopted engine) with the pack's start month — not a second rule here.
   ⚠️ accounts-packs v1.20 labels a January year '2026' and every other '2026-27'; the books routes read the same function, so the two always agree. */
const AP = require(path.join(API, 'lib', 'accounts-packs'));
const FYPACK = { fy_start_month: PACK.fiscalYear.startMonth };
const fyOf = (d) => AP.fiscalYearOf(d, FYPACK);
const fyShort = (d) => { const f = fyOf(d); return f.length > 4 ? f.slice(2) : f; };   /* 26-27 — the counter's own year label; '2026' for a January year */
const monthNo = (d) => AP.periodOf(d, FYPACK);
/* the plan's three GST slabs (5 · 12 · 18) land on the pack's rate menu: a one-rate scheme (AU 10 % · AE 5 %) bills everything at its standard rate */
const rateOf = (r) => (PACK.tax && PACK.tax.standard_rate != null ? PACK.tax.standard_rate : r);
/* a purchase's tax row in the pack's OWN heads: India splits an in-state purchase CGST + SGST; a one-head scheme (gst · vat) carries the whole tax on that head */
const taxRow = (rate, taxable) => { const tax = taxable * rate / 100, heads = PACK.taxHeads || [], row = { rate, taxable };
  if (heads.indexOf('cgst') >= 0 && heads.indexOf('sgst') >= 0) { row.cgst = tax / 2; row.sgst = tax / 2; row.igst = 0; } else if (heads.length) row[heads[0]] = tax; return row; };
/* the plan pays cash · upi · credit; a pack without upi among its payment modes (AU · AE) takes the same sale by card */
const howOf = (how) => (how === 'upi' && !(PACK.chart && PACK.chart.paymentModes && PACK.chart.paymentModes.upi) ? 'card' : how);
const rup = (minor) => (Number(minor) / 100).toFixed(2);
const ZERO = '00000000-0000-0000-0000-000000000000';   /* books-store.ZERO — the party_key of a ledger's own (non-party) summary row */
const say = (s) => console.log('  · ' + s);

/* ── the shelf: a Tamil Nadu kirana's items by GST slab, the rows tools/seed/generate.cjs composes (name · unit · price · category · slab · hsn) ── */
const SHELF = [
  [5, 'Aachi Sambar powder 100 g', 'packet', 45, 'Spices', '0910'], [5, 'Aavin Toned milk 500 ml', 'packet', 27, 'Dairy', '0401'],
  [5, 'Idhayam Gingelly oil 500 ml', 'bottle', 180, 'Oils', '1515'], [5, 'Ponni raw rice 1 kg', 'kg', 62, 'Staples', '1006'],
  [5, 'Toor dal 500 g', 'packet', 85, 'Staples', '0713'], [5, 'Sugar 1 kg', 'kg', 44, 'Staples', '1701'],
  [5, 'Tea powder 250 g', 'packet', 120, 'Beverages', '0902'], [5, 'Wheat atta 1 kg', 'kg', 48, 'Staples', '1101'],
  [12, 'Aavin Butter 100 g', 'packet', 58, 'Dairy', '0405'], [12, 'Amul Cheese 200 g', 'packet', 130, 'Dairy', '0406'],
  [12, "Haldiram's Mixture 200 g", 'packet', 55, 'Snacks', '2106'], [12, 'Ghee 200 ml', 'bottle', 140, 'Dairy', '0405'],
  [12, 'Fruit juice 1 L', 'bottle', 110, 'Beverages', '2009'], [12, 'Mango pickle 300 g', 'jar', 75, 'Condiments', '2001'],
  [18, 'Colgate toothpaste 100 g', 'piece', 60, 'Personal care', '3306'], [18, 'Lifebuoy soap 100 g', 'piece', 32, 'Personal care', '3401'],
  [18, 'Surf Excel 500 g', 'packet', 72, 'Household', '3402'], [18, 'Marie biscuits 200 g', 'packet', 30, 'Snacks', '1905'],
  [18, 'Shampoo 180 ml', 'bottle', 125, 'Personal care', '3305'], [18, 'Instant noodles 70 g', 'packet', 14, 'Snacks', '1902'],
  [18, 'Chocolate bar 50 g', 'piece', 40, 'Snacks', '1806'], [18, 'Coconut hair oil 100 ml', 'bottle', 65, 'Personal care', '3305'],
];
const SUPPLIER = 'Kumar Traders', CUSTOMER = 'Ravi Stores', CREDIT_DAYS = 10;

/* ── a direct pool for the checks (reads) and --fresh ───────────────────────────────────────────────────────────── */
const { Pool } = require(path.join(API, 'node_modules', 'pg'));
const pool = new Pool({ connectionString: DB, max: 2, connectionTimeoutMillis: 5000 });
/* M210's rule, here too: a naive timestamp is a UTC wall clock — the session zone is pinned as db/index.js pins the api's, so the
   proof's `created_at::timestamptz` names the same instant before b299 (naive) and after it (timestamptz) */
pool.on('connect', (c) => { c.query("SET TimeZone = 'UTC'").catch((e) => console.warn('session zone not set:', e.message)); });
const sql = (t, p) => pool.query(t, p);

async function hasTable(name) { return (await sql(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`, [name])).rows.length > 0; }

/* ── --schema: the repo's schema through tools/migrate.cjs (HX1: the same chain, now with the schema_migrations ledger) ─────── */
async function applySchema() {
  let r;
  try { r = await require('./migrate.cjs').apply(DB, { say }); } catch (e) { die(e.message); }
  if (!r.fresh) return;
  for (const t of ['identities', 'chit_header', 'journal_entry', 'books_setting', 'customer_list', 'catalogue_items']) if (!await hasTable(t)) die('table ' + t + ' is missing after --schema');
}

/** --schema-only: the schema step alone (the compose stack's migrate job), then exit */
async function schemaOnly() {
  console.log('\n── sim-load --schema-only · ' + loc.host + (loc.docker ? ' (docker service)' : loc.spin ? ' (test spin ' + process.env.CB_SPIN_ID + ')' : '') + ' ──');
  try { await sql('SELECT 1'); } catch (e) { die('cannot connect to ' + DB.replace(/:[^:@/]+@/, ':***@') + ' — ' + e.message); }
  await applySchema();
  await pool.end(); process.exit(0);
}

/* ── --fresh: the shop and everything it owns, removed (local database, as its owner) ───────────────────────────── */
async function wipeShop(ids) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    try { await c.query(`SET LOCAL session_replication_role = 'replica'`); }     /* the books' insert-only triggers (b273) stand aside for the owner's wipe */
    catch (e) { throw new Error('--fresh needs the database owner (superuser) on this local database: ' + e.message); }
    const cols = (await c.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'
                                   AND column_name IN ('entity_id', 'owner_entity_id', 'identity_id', 'parent_entity_id', 'customer_identity_id', 'supplier_entity_id', 'sender_entity_id')`)).rows;
    const byTable = new Map();
    cols.forEach((r) => { if (r.table_name === 'identities') return; const a = byTable.get(r.table_name) || []; a.push(r.column_name); byTable.set(r.table_name, a); });
    const cleared = [];
    for (const [t, cs] of byTable) {
      const where = cs.map((k) => k + ' = ANY($1::uuid[])').join(' OR ');
      const r = await c.query(`DELETE FROM ${t} WHERE ${where}`, [ids]);
      if (r.rowCount) cleared.push(t + ' ' + r.rowCount);
    }
    const r = await c.query(`DELETE FROM identities WHERE identity_id = ANY($1::uuid[])`, [ids]);
    cleared.push('identities ' + r.rowCount);
    await c.query('COMMIT');
    say('fresh: removed ' + cleared.join(' · '));
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

/* ── the api, in this process, on a free port ──────────────────────────────────────────────────────────────────── */
const freePort = () => new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
let BASE = '';
async function startApi() {
  process.env.DATABASE_URL = DB;
  process.env.NODE_ENV = process.env.NODE_ENV || 'development';
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) process.env.JWT_SECRET = 'sim-load-local-only-secret-' + 'x'.repeat(24);
  process.env.DEV_OTP = OTP; process.env.SHOP_CLOCK_ALLOW = '1'; process.env.HOST = '127.0.0.1'; process.env.RLS_GUARD = process.env.RLS_GUARD || 'off';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'warn';
  process.env.RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX || '10000000';   /* server.js's 15-minute window (500) would refuse a year of bills — this api serves one caller, on this PC */
  const port = await freePort(); process.env.PORT = String(port); BASE = 'http://127.0.0.1:' + port;
  require(path.join(API, 'server.js'));
  for (let i = 0; i < 100; i++) { try { const r = await fetch(BASE + '/health'); if (r.ok) return; } catch (_) {} await new Promise((ok) => setTimeout(ok, 200)); }
  die('the api did not answer /health on ' + BASE);
}
async function j(p, o) {
  const opt = o || {};
  const r = await fetch(BASE + p, { method: opt.method || 'GET', headers: Object.assign({ 'content-type': 'application/json' }, opt.token ? { authorization: 'Bearer ' + opt.token } : {}), body: opt.body ? JSON.stringify(opt.body) : undefined });
  let b = null; try { b = await r.json(); } catch (_) { /* no body */ }
  return { status: r.status, b: b || {} };
}
const must = (r, what) => { if (r.status >= 300) { console.error('\n  sim-load stopped at ' + what + ': HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 400) + '\n'); process.exit(1); } return r; };

/* ── the ledger hook is fire-and-forget inside the route; here every one is awaited before a day or a month closes ── */
const pending = new Set();
function trackHooks() {
  const H = require(path.join(API, 'lib', 'books-hooks'));
  const orig = H.afterChit;
  H.afterChit = function () { const p = Promise.resolve(orig.apply(this, arguments)); pending.add(p); p.finally(() => pending.delete(p)); return p; };
}
async function drain() { while (pending.size) await Promise.allSettled([...pending]); }

/* ── main ──────────────────────────────────────────────────────────────────────────────────────────────────────── */
(async () => {
  if (SCHEMA_ONLY) return schemaOnly();
  console.log('\n── sim-load · ' + SHOP + ' · ' + YEARS + ' year(s) from ' + PLAN.start + ' · seed ' + SEED + ' · ' + COUNTRY + ' · ' + loc.host + (loc.docker ? ' (docker service)' : loc.spin ? ' (test spin ' + process.env.CB_SPIN_ID + ')' : '') + ' ──');
  try { await sql('SELECT 1'); } catch (e) { die('cannot connect to ' + DB.replace(/:[^:@/]+@/, ':***@') + ' — ' + e.message); }
  if (SCHEMA) await applySchema();
  if (!await hasTable('identities')) die('this database has no schema — the local stack migrates its own; an empty TEST database takes --schema');
  if (!await hasTable('journal_entry')) die('the ledger tables (migrations b272–b274) are not in this database');
  /* the delivery function must honour the shop clock (b300) — else three years of bills would all be dated today */
  const fn = await sql(`SELECT pg_get_functiondef(to_regprocedure('chit_deliver(uuid,boolean,jsonb)')) AS d`).catch(() => ({ rows: [{ d: null }] }));
  if (!fn.rows[0] || !fn.rows[0].d) die('chit_deliver (migrations/migration_b50 · b142) is not in this database');
  if (fn.rows[0].d.indexOf("c->>'created_at'") < 0) die('chit_deliver does not honour the shop clock yet — run migrations/b300_chit_deliver_clock.sql on this local database (as postgres), then load');

  /* the shop so far: exists? loaded for this seed? */
  const who = await sql(`SELECT identity_id, user_id, email FROM identities WHERE LOWER(user_id) = $1 OR LOWER(email) = $2`, [SHOP, EMAIL]);
  let shopId = who.rows[0] ? String(who.rows[0].identity_id) : null;
  if (shopId) {
    const mark = await sql(`SELECT source_ref FROM journal_entry WHERE entity_id = $1 AND source_ref LIKE 'opening:sim/%' ORDER BY created_at LIMIT 1`, [shopId]);
    const bills = await sql(`SELECT count(*)::int AS n FROM chit_header WHERE entity_id = $1 AND sender_entity_id = $1 AND business_json ? 'bill_no'`, [shopId]);
    const loaded = mark.rows[0] ? mark.rows[0].source_ref.replace(/^opening:/, '') : null;
    if (!FRESH) {
      if (loaded === MARK) { say('already loaded: ' + SHOP + ' holds ' + loaded + ' (' + bills.rows[0].n + ' bills). Nothing written.'); await proof(shopId, true); printLogin(); process.exit(0); }
      if (loaded) die(SHOP + ' already holds ' + loaded + ' — a different seed/years. Rebuild with --fresh.');
      if (bills.rows[0].n) die(SHOP + ' already has ' + bills.rows[0].n + ' bills (an earlier run that did not finish?). Rebuild with --fresh.');
      say('shop ' + SHOP + ' exists and is empty — loading into it');
    } else {
      const kids = await sql(`SELECT identity_id FROM identities WHERE parent_entity_id = $1`, [shopId]);
      await wipeShop([shopId].concat(kids.rows.map((r) => String(r.identity_id))));
      shopId = null;
    }
  } else if (FRESH) say('fresh: nothing to remove — ' + SHOP + ' did not exist');

  await startApi();
  trackHooks();
  const CLOCK = require(path.join(API, 'lib', 'shop-clock'));
  const B = require(path.join(API, 'lib', 'books'));
  const TL = require(path.join(API, 'lib', 'tax-lines'));
  const RU = require(path.join(API, 'lib', 'rollup'));
  const started = Date.now();
  CLOCK.set(AT(PLAN.start, 9, 0));

  /* 1 · the shop — register is also sign-in (the code is the dev one) */
  must(await j('/api/entities/register', { method: 'POST', body: { email: EMAIL, display_name: 'Simulated Stores', user_id: SHOP } }), 'shop register');
  const ver = must(await j('/api/entities/verify', { method: 'POST', body: { email: EMAIL, otp: OTP } }), 'shop verify (is DEV_OTP armed?)');
  const token = ver.b.token; shopId = String((ver.b.entity && ver.b.entity.identity_id) || (ver.b.identity && ver.b.identity.identity_id) || '');
  if (!shopId) { const r = await sql(`SELECT identity_id FROM identities WHERE LOWER(email) = $1`, [EMAIL]); shopId = String(r.rows[0].identity_id); }
  const gstn = SHOPROW.taxNo;                           /* the shop's tax registration number (GSTIN · ABN · TRN) — SHOPS above */
  /* 1b · Country setup (CS1, M210's week): the step every owner completes after registration, before the books open — country ·
     money · financial year · tax registration, through PUT /api/governance/country-setup (lib/country-setup.save writes identities.gstn,
     the one home). 503 = b299_country_setup not run on this database: the gate then stays as it was, and the GSTIN goes in by the profile door. */
  const cs = await j('/api/governance/country-setup', { method: 'PUT', token, body: { country: COUNTRY, currency: CUR, fy_start_month: PACK.fiscalYear.startMonth,
    tax: Object.assign({ registered: true, number: gstn }, COUNTRY === 'IN' ? { scheme: 'regular' } : {}), source: { country: 'sim-load', currency: 'the pack', fy_start_month: 'the pack', tax: 'sim-load' } } });
  if (cs.status === 503) say('country setup: ' + (cs.b.message || 'not migrated') + ' — b299_country_setup.sql is not on this database');
  else must(cs, 'country setup');
  must(await j('/api/entities/profile', { method: 'PATCH', token, body: Object.assign({ address: SHOPROW.address }, gstn && cs.status === 503 ? { gstn } : {}) }), 'shop profile');
  const me = must(await j('/api/entities/me', { token }), 'who am I').b;
  const meRow = me.entity || me.identity || me;
  say('shop ' + (meRow.display_name || 'Simulated Stores') + ' · user id ' + SHOP + ' · ' + (meRow.bridge_id || ''));

  /* 2 · the ledger on, the opening balances */
  let en;
  if (COUNTRY === 'IN') en = must(await j('/api/books/enable', { method: 'POST', token, body: {} }), 'ledger on').b;
  else { en = await B.enable(null, shopId, { country: COUNTRY }); require(path.join(API, 'lib', 'books-hooks')).forget(shopId); }   /* the route takes no country (IN); AU · AE go through the same enable() */
  const chart = must(await j('/api/books/accounts', { token }), 'chart').b;
  const accounts = chart.accounts || chart.rows || chart.items || (Array.isArray(chart) ? chart : []);
  const codeOfRole = (role) => (accounts.find((a) => a.role === role) || {}).code;
  const CASH = codeOfRole('cash'), CAPITAL = codeOfRole('capital') || '3000';
  if (!CASH) die('the chart has no cash ledger (role cash) — enable answered ' + JSON.stringify(en).slice(0, 200));
  const op = must(await j('/api/books/opening', { method: 'POST', token, body: { date: PLAN.start, client_ref: MARK, rows: [{ code: CASH, dr_minor: 50000000 }, { code: CAPITAL, cr_minor: 50000000 }] } }), 'opening balances').b;
  say('ledger on (' + en.fiscal_year + ') · opening ' + (op.entry_no || '') + ' cash 5,00,000 against capital · suspense ' + rup(op.suspense_minor || 0));

  /* 3 · parties, the counter, the shelf */
  const sup = await j('/api/relationships/suppliers', { method: 'POST', token, body: { name: SUPPLIER } });
  if (sup.status !== 409) must(sup, 'supplier');
  const cus = await j('/api/relationships/customers', { method: 'POST', token, body: { name: CUSTOMER, phone: SHOPROW.phone } });
  if (cus.status !== 409) must(cus, 'customer');
  const parties = (await sql(`SELECT identity_id, display_name FROM identities WHERE parent_entity_id = $1`, [shopId])).rows;
  const SUPP = (parties.find((p) => p.display_name === SUPPLIER) || {}).identity_id, CUST = (parties.find((p) => p.display_name === CUSTOMER) || {}).identity_id;
  if (!SUPP || !CUST) die('the parties were not minted: ' + JSON.stringify({ sup: sup.b, cus: cus.b }).slice(0, 300));
  let counters = must(await j('/api/counters', { token }), 'counters').b.counters || [];
  if (!counters.some((c) => c.id === TILL)) counters = counters.concat([must(await j('/api/counters', { method: 'POST', token, body: { name: 'Counter 1' } }), 'add counter').b.counter]);
  const have = must(await j('/api/products?limit=500', { token }), 'list products').b;
  const rows = have.items || have.products || have.rows || [];
  const byName = new Map(rows.map((x) => [String((x.item_data || x).name || '').toLowerCase(), x.item_id || x.id]));
  const ITEMS = [];
  for (const [rate, name, unit, price, category, hsn] of SHELF) {
    const r0 = rateOf(rate);
    let id = byName.get(name.toLowerCase());
    if (!id) { const r = must(await j('/api/products', { method: 'POST', token, body: { item_data: { name, unit, price, category, hsn, tax_slab: COUNTRY + '-' + PACK.tax.scheme + '-' + r0, gst_rate: r0 } } }), 'add ' + name); id = (r.b.item || r.b).item_id || r.b.item_id; }
    ITEMS.push({ id, rate: r0, name, unit, price, hsn });
  }
  say('supplier ' + SUPPLIER + ' · customer ' + CUSTOMER + ' · counter ' + TILL + ' · ' + ITEMS.length + ' products');

  /* 4 · the invoice the counter carries: lib/tax-lines.invoiceFor (= CBTax.determine), the one calculation; the server re-checks it on post */
  const seller = TL.partyOf({ gstn: meRow.gstn || gstn, display_name: meRow.display_name, country: meRow.country || COUNTRY, policy_flags: meRow.policy_flags }, { entity_id: shopId });
  /* the shop's own price_includes_tax flag (lib/policy, default yes) — the same reader tax-copy.partiesFor uses when the server re-checks the bill */
  const priceIncludesTax = require(path.join(API, 'lib', 'policy')).flagOf(meRow.policy_flags, 'price_includes_tax') === 'yes';
  const buyerOf = (name) => ({ LglNm: name, Gstin: null, State: null, Country: seller.Country || COUNTRY, RegType: 'unregistered', Ph: null, Em: null, entity_id: null, Pos: seller.State });
  const basketOf = (rate, dayIx, i) => {
    const r = PLAN_LIB.rng(SEED * 1000003 + dayIx * 101 + i);
    /* the plan draws an IN slab (5 / 12 / 18); a one-rate pack (AU 10 % · AE 5 %) maps it to its standard rate, as the shelf was added (WX-R2R) */
    const pool0 = ITEMS.filter((it) => it.rate === rateOf(rate)), n = 1 + Math.floor(r() * 3), lines = [];
    for (let k = 0; k < n; k++) { const it = pool0[Math.floor(r() * pool0.length)], qty = 1 + Math.floor(r() * 3); if (lines.some((l) => l.item_id === it.id)) continue;
      lines.push({ particulars: it.name, quantity: qty, unit: it.unit, price: it.price, total: it.price * qty, item_id: it.id, hsn: it.hsn, gst_rate: it.rate }); }
    return lines;
  };

  /* 5 · the days */
  let bills = 0, purchases = 0, expenses = 0, months = 0, refusedBills = 0, seq = 0, curFy = '';
  const dayRows = [];
  const closeMonth = async (pd) => {
    await drain();
    const pfy = fyOf(pd), pm = monthNo(pd);
    const g = await j('/api/books/gst/close', { method: 'POST', token, body: { fy: pfy, period: pm } });
    if (g.status !== 200) console.log('   RED  GST close of ' + pfy + ' month ' + pm + ' refused — ' + JSON.stringify(g.b).slice(0, 200));
    const lk = await j('/api/books/periods/' + pfy + '/' + pm + '/lock', { method: 'POST', token, body: { reason: 'month done' } });
    if (lk.status !== 200) console.log('   RED  lock of ' + pfy + ' month ' + pm + ' refused — ' + JSON.stringify(lk.b).slice(0, 200)); else months++;
    if (pm === 12) {
      const yc = await j('/api/books/year/' + pfy + '/close', { method: 'POST', token, body: {} });
      if (yc.status !== 200) console.log('   RED  year close ' + pfy + ' refused — ' + JSON.stringify(yc.b).slice(0, 300)); else say(pfy + ' closed · ' + bills + ' bills so far · ' + Math.round((Date.now() - started) / 1000) + 's');
    }
  };
  for (let dayIx = 0; dayIx < PLAN.days.length; dayIx++) {
    const row = PLAN.days[dayIx], d = row.day;
    CLOCK.set(AT(d, 9, 0));
    if (d.slice(8) === '01' && d !== PLAN.start) await closeMonth(dayAdd(d, -1));
    if (fyOf(d) !== curFy) { curFy = fyOf(d); seq = 0; }
    const todays = [];
    for (let i = 0; i < row.sales.length; i++) {
      const s = row.sales[i], at = AT(d, 10 + Math.floor(i * 9 / row.sales.length), (dayIx * 7 + i * 13) % 60);
      CLOCK.set(at);
      const lines = basketOf(s.rate, dayIx, i);
      const inv = TL.invoiceFor({ lines, seller, buyer: buyerOf(s.how === 'credit' ? CUSTOMER : 'Walk-in'), currency: CUR, at, priceIncludesTax }).invoice;
      const total = Number(inv.ValDtls && inv.ValDtls.TotInvVal) || 0;
      const no = TILL + '/' + fyShort(d) + '/' + String(++seq).padStart(4, '0');
      const credit = s.how === 'credit', how = howOf(s.how);
      const body = {
        recipients: [{ self: true, name: 'self' }], purpose: 'order', subject: 'Counter sale ' + no, manual_subject: 'Counter sale ' + no, client_ref: no,
        business_json: {
          customer: credit ? { name: CUSTOMER, party_id: CUST } : { name: 'Walk-in' },
          till: { id: TILL, name: 'Counter 1', host: 'sim-load', by: null },
          bill_no: no, billed_at: at, catalogue_version: null,
          payment: { mode: how, paid: credit ? 0 : total, change: 0, parts: [{ how, amount: total }] },
          slip: credit ? 'credit' : 'cash',
          terms: credit ? { due_date: dayAdd(d, CREDIT_DAYS), credit_days: CREDIT_DAYS } : null, credit_override: null,
          invoice: inv,
        },
        line_items: lines,
      };
      const r = await j('/api/chits/send', { method: 'POST', token, body });
      if (r.status >= 300) { refusedBills++; if (refusedBills <= 5) console.log('   RED  bill ' + no + ' refused: HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 300)); continue; }
      bills++;
      todays.push({ no, total, kind: credit ? 'credit' : 'cash', payments: [{ how, amount: total }], at });
    }
    /* the counter's day summary — the record the shop's folder shows; its hook posts the walk-in day */
    if (todays.length) {
      await drain();
      CLOCK.set(AT(d, 21, 0));
      const sum = RU.summary('day', d, RU.totals(todays), { till: { id: TILL, name: 'Counter 1' }, bills_from: todays[0].no, bills_to: todays[todays.length - 1].no, at: CLOCK.now().toISOString() });
      const r = await j('/api/chits/send', { method: 'POST', token, body: RU.chitOf(sum) });
      if (r.status >= 300) console.log('   RED  day summary ' + d + ' refused: ' + JSON.stringify(r.b).slice(0, 200));
      dayRows.push({ day: d, bills: todays.length });
    }
    if (row.purchase) {
      CLOCK.set(AT(d, 16, 0));
      const taxable = row.purchase.taxable, prate = rateOf(18), ptotal = taxable + taxable * prate / 100;
      const r = await B.postEntry(null, shopId, { type: 'purchase_bill', party: SUPP, date: d, currency: CUR, source_ref: 'sim:' + d + ':p', ref: 'KT/' + d.replace(/-/g, '') + '/' + (purchases + 1),
        by_rate: [taxRow(prate, taxable)], paid: row.purchase.paid_bank ? { bank: ptotal } : {}, round_off: 0, due_date: dayAdd(d, 30) }).catch((e) => ({ ok: false, why: String(e && e.message) }));
      if (r && r.ok) purchases++; else console.log('   RED  purchase on ' + d + ' refused — ' + JSON.stringify(r).slice(0, 200));
    }
    const spend = async (cls, amount, from, ref) => {
      const r = await j('/api/books/events', { method: 'POST', token, body: { event: 'expense', class: cls, amount, paid_from: from, date: d, client_ref: ref } });
      if (r.status === 200) expenses++; else console.log('   RED  expense ' + ref + ' refused — ' + JSON.stringify(r.b).slice(0, 200));
    };
    if (row.expense) { CLOCK.set(AT(d, 17, 0)); await spend(row.expense.class, row.expense.amount, 'cash', 'sim:' + d + ':e'); }
    if (row.rent) { CLOCK.set(AT(d, 17, 30)); await spend('rent', 20000, 'bank', 'sim:' + d + ':rent'); }
  }
  CLOCK.set(AT(dayAdd(PLAN.last, 1), 9, 0));
  await closeMonth(PLAN.last);
  await drain();
  CLOCK.reset();
  say('made ' + bills + ' bills (' + refusedBills + ' refused) · ' + purchases + ' purchases · ' + expenses + ' expenses · ' + months + ' months closed · ' + Math.round((Date.now() - started) / 1000) + 's');

  const red = await proof(shopId, false);
  printLogin();
  await pool.end();
  process.exit(red ? 1 : 0);
})().catch((e) => { console.error('\n  sim-load failed: ' + (e && e.stack || e) + '\n'); process.exit(2); });

/* ── the proof: SQL over what was written (reads only) ──────────────────────────────────────────────────────────── */
async function proof(shopId, quiet) {
  const out = []; const line = (ok, name, detail) => { out.push(ok); console.log('   ' + (ok ? 'ok   ' : 'RED  ') + name + (detail ? ' — ' + detail : '')); };
  console.log('\n  proof (' + (quiet ? 'as loaded' : 'this run') + '):');
  const bills = await sql(`SELECT count(*)::int AS n FROM chit_header WHERE entity_id = $1 AND sender_entity_id = $1 AND role <> 'Draft' AND business_json ? 'bill_no' AND business_json -> 'till' ->> 'id' = $2`, [shopId, TILL]);
  line(bills.rows[0].n === WANT.bills, 'bills in chit_header = the plan\'s (' + bills.rows[0].n + ' of ' + WANT.bills + ', ' + WANT.days + ' days)');
  const sums = await sql(`SELECT count(*)::int AS n FROM chit_header WHERE entity_id = $1 AND purpose = 'general' AND business_json -> 'summary' ->> 'period' = 'day'`, [shopId]);
  const daysWithBills = PLAN.days.filter((d) => d.sales.length).length;
  line(sums.rows[0].n === daysWithBills, 'day summaries = days with bills (' + sums.rows[0].n + ' of ' + daysWithBills + ')');
  const pur = await sql(`SELECT count(*)::int AS n FROM journal_entry WHERE entity_id = $1 AND event_type = 'purchase_bill'`, [shopId]);
  line(pur.rows[0].n === WANT.purchases, 'purchases posted = the plan\'s (' + pur.rows[0].n + ' of ' + WANT.purchases + ')');
  /* trial balance: every month's lines balance */
  const tb = await sql(`SELECT e.fiscal_year, e.period, SUM(l.dr_minor)::bigint AS dr, SUM(l.cr_minor)::bigint AS cr FROM journal_entry e JOIN journal_line l ON l.entry_id = e.entry_id
                         WHERE e.entity_id = $1 GROUP BY 1, 2 ORDER BY 1, 2`, [shopId]);
  const unb = tb.rows.filter((r) => String(r.dr) !== String(r.cr));
  line(tb.rows.length > 0 && unb.length === 0, 'trial balance balances every month (' + tb.rows.length + ' months, Dr = Cr)', unb.slice(0, 3).map((r) => r.fiscal_year + '/' + r.period + ' Dr ' + rup(r.dr) + ' Cr ' + rup(r.cr)).join(' · '));
  /* the STORED month summaries (account_balance, written by the posting) balance too — a second source, not the lines again */
  const sb = await sql(`SELECT fiscal_year, period, SUM(dr_minor)::bigint AS dr, SUM(cr_minor)::bigint AS cr FROM account_balance WHERE entity_id = $1 AND party_key = $2 GROUP BY 1, 2 ORDER BY 1, 2`, [shopId, ZERO]);
  const sunb = sb.rows.filter((r) => String(r.dr) !== String(r.cr));
  line(sb.rows.length === tb.rows.length && sunb.length === 0, 'stored month summaries (account_balance) balance, one per month (' + sb.rows.length + ')', sunb.slice(0, 3).map((r) => r.fiscal_year + '/' + r.period).join(' · '));
  /* cash, each FY: opening (the STORED summaries of the years before) + net flow (this year's LINES) = closing (the stored summaries up to this year) */
  const fys = [...new Set(tb.rows.map((r) => r.fiscal_year))].sort();
  for (const fy of fys) {
    const range = AP.fyRange(fy, FYPACK), from = range.start, to = range.end;   /* the pack's year, not April's */
    const c = await sql(`SELECT (SELECT COALESCE(SUM(b.dr_minor - b.cr_minor), 0) FROM account_balance b JOIN ledger_account a ON a.account_id = b.account_id
                                  WHERE b.entity_id = $1 AND a.role = 'cash' AND b.party_key = $4 AND b.fiscal_year < $5)::bigint AS opening,
                                (SELECT COALESCE(SUM(l.dr_minor - l.cr_minor), 0) FROM journal_line l JOIN journal_entry e ON e.entry_id = l.entry_id JOIN ledger_account a ON a.account_id = l.account_id
                                  WHERE e.entity_id = $1 AND a.role = 'cash' AND e.posting_date >= $2 AND e.posting_date <= $3)::bigint AS flow,
                                (SELECT COALESCE(SUM(b.dr_minor - b.cr_minor), 0) FROM account_balance b JOIN ledger_account a ON a.account_id = b.account_id
                                  WHERE b.entity_id = $1 AND a.role = 'cash' AND b.party_key = $4 AND b.fiscal_year <= $5)::bigint AS closing`, [shopId, from, to, ZERO, fy]);
    const r = c.rows[0], ok = BigInt(r.opening) + BigInt(r.flow) === BigInt(r.closing) && (fys.indexOf(fy) === 0 || BigInt(r.opening) > 0n);
    line(ok, fy + ' · cash opening ' + rup(r.opening) + ' (stored) + net flow ' + rup(r.flow) + ' (lines) = closing ' + rup(r.closing) + ' (stored)');
  }
  /* created_at names an INSTANT (M210): timestamptz after b299, and before it a naive UTC wall clock — read as UTC because this
     pool's session zone is pinned to UTC exactly as db/index.js pins the api's (the `::timestamptz` cast is then the same instant
     either way). The day it belongs to is the SHOP's (books-hooks.zoneOf of the shop's IANA zone — SHOPS above; zoneOf(COUNTRY) falls back to
     India for AU, whose zones neither COUNTRY_ZONE nor the pack carries yet), the one rule the day close uses. */
  const zone = require(path.join(API, 'lib', 'books-hooks')).zoneOf(SHOPROW.zone);
  const dated = await sql(`SELECT count(*)::int AS n FROM chit_header WHERE entity_id = $1 AND business_json ? 'bill_no'
                             AND ((business_json ->> 'billed_at')::timestamptz AT TIME ZONE $2)::date <> (created_at::timestamptz AT TIME ZONE $2)::date`, [shopId, zone]);
  line(dated.rows[0].n === 0, 'every bill\'s created_at is its own simulated day in ' + zone + ', not today (' + dated.rows[0].n + ' off)');
  const locked = await sql(`SELECT count(*)::int AS n FROM fiscal_period WHERE entity_id = $1 AND status IN ('soft_locked', 'hard_locked') AND period > 0`, [shopId]);
  line(locked.rows[0].n >= YEARS * 12, 'months locked (' + locked.rows[0].n + ' of ' + YEARS * 12 + ')');
  const waiting = await sql(`SELECT count(*)::int AS n FROM books_outbox WHERE entity_id = $1 AND done_at IS NULL`, [shopId]).catch(() => ({ rows: [{ n: 'n/a' }] }));
  line(waiting.rows[0].n === 0 || waiting.rows[0].n === 'n/a', 'nothing waiting in books_outbox (' + waiting.rows[0].n + ')');
  const red = out.filter((x) => !x).length;
  console.log('  ' + (red ? '✗ ' + red + ' RED' : '✓ all green') + ' · ' + out.length + ' lines');
  return red;
}
function printLogin() {
  console.log('\n  open it: http://localhost:8124 → sign in as ' + SHOP + ' (or ' + EMAIL + ') · code ' + OTP + ' (DEV_OTP on the local stack)\n');
}
