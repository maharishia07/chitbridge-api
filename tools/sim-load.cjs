#!/usr/bin/env node
/**
 * tools/sim-load.cjs — PUT THE THREE-YEAR SIMULATED SHOP INTO A REAL DATABASE (round Y1b; Y1 proved it in memory).
 * OWNS      loading tools/sim-plan.cjs's simulated shop into a LOCAL Postgres through the api's own doors (and refusing any non-local host).
 * CALLED BY by hand (node tools/sim-load.cjs --db …), deploy test spins (deploy/<platform>/test.sh), tests/sim-load.test.cjs
 * FLOW      refuse a remote --db ──▶ schema step ──▶ register the shop ──▶ per planned day: bills · purchases · expenses · day summary ──▶ proof (reads)
 * CARD      qa/sim-load
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
 *   --scale    10k | 50k | 100k (PERF1): after the plan, grow the shop to that many journal lines (+ 500 customers · ≤ 5,000 open items · 10,000
 *              products) in the open year after it, then time every hot read 20× — p50 / p95 · rows · X-DB-Trips (tools/sim-scale.cjs).
 *              --scale-reads: time only (the shop already grown) · --scale-only <word>: only the reads whose name has it. Use with --start 2023-04-01 so the plan's years end before the grown one.
 *   --start    the first financial year's first day (default 2026-<the pack's first month>-01). WX-O2C: `--start 2023-04-01` ends the three
 *              years on 2026-03-31, so TODAY sits in an open year after them — a walk's own bills are then the newest, in an unlocked month.
 *   Env it sets for the in-process api when unset: NODE_ENV=development, DEV_OTP=123456, a local JWT_SECRET, SHOP_CLOCK_ALLOW=1,
 *   RATE_LIMIT_MAX (the 15-minute window would refuse a year of bills), LOG_LEVEL=warn.
 *   A sealed NODE_ENV (production · uat · staging · live) is refused.
 * Prints what it made (bills, purchases, parties, months closed) and the login to open it with; exits 1 when a proof line is red.
 */
'use strict';
const path = require('path'),
  netModule = require('net');
const API = path.join(__dirname, '..');

const arg = (flagName, fallback) => {
  const flagIndex = process.argv.indexOf('--' + flagName);
  return flagIndex > 0 && process.argv[flagIndex + 1] !== undefined ? process.argv[flagIndex + 1] : fallback;
};
const hasFlag = (flagName) => process.argv.includes('--' + flagName);

/* ── the one rule: a local database or nothing ─────────────────────────────────────────────────────────────────── */
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];
/** localOnly(url, env) → { ok, host, docker?, spin? } or { ok: false, why } — a host with a dot in it is never local (HX2: but a test spin's) */
function localOnly(url, env) {
  let parsed;
  try {
    parsed = new URL(String(url || ''));
  } catch (_) {
    return { ok: false, why: 'not a URL' };
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) return { ok: false, why: 'not a postgres:// URL' };
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return { ok: false, why: 'no host in the URL' };
  if (LOCAL_HOSTS.includes(host)) return { ok: true, host };
  if (/^[a-z][a-z0-9_-]*$/.test(host)) return { ok: true, host, docker: true };
  const spin = String((env || process.env).CB_SPIN_ID || '');
  if (/^[a-z][a-z0-9]{5,15}$/.test(spin) && decodeURIComponent(parsed.pathname.slice(1)) === 'cbspin_' + spin && !/supabase\.(co|com)$/.test(host))
    return { ok: true, host, spin: true };
  return { ok: false, why: '"' + host + '" is not localhost, 127.0.0.1 or a docker service name — this loader never touches a remote database' };
}
/** a migration file the schema step skips — the chain and its ledger live in tools/migrate.cjs (HX1) */
const { CHAIN_SKIP } = require('./migrate.cjs');

if (require.main !== module) {
  module.exports = { localOnly, CHAIN_SKIP };
  return;
}

/* ── arguments ─────────────────────────────────────────────────────────────────────────────────────────────────── */
const DB = arg('db', process.env.SIM_DB || ''),
  SHOP = String(arg('shop', '')).trim().toLowerCase();
const YEARS = Number(arg('years', 3)),
  SEED = Number(arg('seed', 7)),
  COUNTRY = String(arg('country', 'IN')).toUpperCase();
const FRESH = hasFlag('fresh'),
  SCHEMA_ONLY = hasFlag('schema-only'),
  SCHEMA = hasFlag('schema') || SCHEMA_ONLY;
const START_ARG = arg('start', '');
const SCALE = arg('scale', ''),
  SCALE_READS = hasFlag('scale-reads'); /* PERF1: tools/sim-scale.cjs — grow the shop to 10k · 50k · 100k journal lines, then time the reads */
if (SCALE && !require('./sim-scale.cjs').TARGETS[SCALE]) {
  console.error('\n  REFUSED: --scale is 10k, 50k or 100k\n');
  process.exit(3);
}
if (SCALE)
  process.env.CB_TRIPS =
    process.env.CB_TRIPS ||
    '1'; /* lib/trips: X-DB-Trips on every answer — the scale table's trips column (local only) */ /* WX-O2C — checked against the pack's first month once the pack is read */
const stop = (message, code) => {
  console.error('\n  REFUSED: ' + message + '\n');
  process.exit(code || 3);
};
const localCheck = localOnly(DB);
if (!DB) stop('say which local database: --db postgres://postgres:pw@127.0.0.1:5432/cb_sim');
if (!localCheck.ok) stop(localCheck.why);
if (!SCHEMA_ONLY && !/^[a-z][a-z0-9]{2,19}$/.test(SHOP)) stop("--shop is the shop's user id: 3–20 letters or digits, starting with a letter (e.g. simstores)");
if (!(YEARS >= 1 && YEARS <= 10) || !Number.isInteger(SEED)) stop('--years 1..10 and --seed a whole number');
/* ── the three simulated shops, one per registered pack (CX0): ONLY what the pack does not say — a sample tax number that passes the pack's
   own check, the street, the city's clock offset and IANA zone, the phone. Currency · fiscal year · heads · rate menu come from the pack. */
const SHOPS = {
  IN: {
    taxNo: '33AABCS1234A1Z8',
    address: '12 Bazaar Street, Madurai',
    offset: '+05:30',
    zone: 'Asia/Kolkata',
    phone: '9876543210'
  } /* Tamil Nadu (33) — the state the place-of-supply rule reads from the GSTIN; check digit 8 (profile-map.gstinChecksum) */,
  AU: {
    taxNo: '51824753556',
    address: '12 Market Street, Parramatta NSW 2150',
    offset: '+10:00',
    zone: 'Australia/Sydney',
    phone: '0412345678'
  } /* the ATO's published example ABN — passes reg-au abn.check */,
  AE: {
    taxNo: '100000000000003',
    address: 'Shop 12, Al Fahidi Street, Bur Dubai',
    offset: '+04:00',
    zone: 'Asia/Dubai',
    phone: '0501234567'
  } /* 15 digits — reg-ae trn.check is a format check only (AE0 §14) */
};
if (!SHOPS[COUNTRY]) stop('--country IN, AU or AE (the registered packs: lib/regulation)');
if (require(path.join(API, 'lib', 'dev-otp')).isSealed())
  stop('NODE_ENV is sealed (' + process.env.NODE_ENV + ') — the loader runs only with NODE_ENV=development (or test)');

const PLAN_LIB = require(path.join(__dirname, 'sim-plan.cjs'));
require(path.join(API, 'lib', 'tax-packs')); /* loads lib/regulation with the three packs registered */
const PACK = require(path.join(API, 'lib', 'regulation')).packFor(
  COUNTRY
); /* currency · fiscalYear · taxHeads · tax.scheme · tax.standard_rate · chart.paymentModes */
if (!PACK) stop('no regulation pack is registered for ' + COUNTRY);
/* ⭐ WX-R2R: the shop's CALENDAR is the pack's (IN an April year · AU a July year · AE a January year) — the plan starts on the pack's
   first month; one reader for the bill series, the month close and the proof (lib/accounts-packs fiscalYearOf · periodOf · fyRange below). */
const START = String(START_ARG || '2026-' + String(PACK.fiscalYear.startMonth).padStart(2, '0') + '-01');
if (!/^\d{4}-\d{2}-01$/.test(START) || Number(START.slice(5, 7)) !== PACK.fiscalYear.startMonth)
  stop(
    "--start is a financial year's first day for " +
      COUNTRY +
      ' (month ' +
      PACK.fiscalYear.startMonth +
      '): e.g. 2023-' +
      String(PACK.fiscalYear.startMonth).padStart(2, '0') +
      '-01'
  );
const PLAN = PLAN_LIB.planDays({ start: START, years: YEARS, seed: SEED });
const WANT = PLAN_LIB.countOf(PLAN);
const MARK =
  'sim/seed-' +
  SEED +
  '/years-' +
  YEARS +
  (START_ARG ? '/from-' + START : ''); /* the default keeps its old mark — a shop loaded before --start is still "already loaded" */
const EMAIL = SHOP + '@test.example'; /* a fixture domain (lib/entitykind) — the shop is a TEST business, never a live one */
const LOGIN_CODE = process.env.DEV_OTP || '123456';
const TILL = 'C1';
const dayAdd = PLAN_LIB.dayAdd;
const SHOPROW = SHOPS[COUNTRY];
const CURRENCY = PACK.currency;
const AT = (dayText, hours, minutes) => dayText + 'T' + String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0') + ':00' + SHOPROW.offset; /* the shop's own wall clock */
/* the year and the month number THE API USES for this shop: lib/accounts-packs (the adopted engine) with the pack's start month — not a second rule here.
   ⚠️ accounts-packs v1.20 labels a January year '2026' and every other '2026-27'; the books routes read the same function, so the two always agree. */
const accountsPacks = require(path.join(API, 'lib', 'accounts-packs'));
const FYPACK = { fy_start_month: PACK.fiscalYear.startMonth };
const fyOf = (dayText) => accountsPacks.fiscalYearOf(dayText, FYPACK);
const fyShort = (dayText) => {
  const fiscalYear = fyOf(dayText);
  return fiscalYear.length > 4 ? fiscalYear.slice(2) : fiscalYear;
}; /* 26-27 — the counter's own year label; '2026' for a January year */
const monthNo = (dayText) => accountsPacks.periodOf(dayText, FYPACK);
/* the plan's three GST slabs (5 · 12 · 18) land on the pack's rate menu: a one-rate scheme (AU 10 % · AE 5 %) bills everything at its standard rate */
const rateOf = (fallbackRate) => (PACK.tax && PACK.tax.standard_rate != null ? PACK.tax.standard_rate : fallbackRate);
/* a purchase's tax row in the pack's OWN heads: India splits an in-state purchase CGST + SGST; a one-head scheme (gst · vat) carries the whole tax on that head */
const taxRow = (rate, taxable) => {
  const taxAmount = (taxable * rate) / 100,
    heads = PACK.taxHeads || [],
    row = { rate, taxable };
  if (heads.indexOf('cgst') >= 0 && heads.indexOf('sgst') >= 0) {
    row.cgst = taxAmount / 2;
    row.sgst = taxAmount / 2;
    row.igst = 0;
  } else if (heads.length) row[heads[0]] = taxAmount;
  return row;
};
/* the plan pays cash · upi · credit; a pack without upi among its payment modes (AU · AE) takes the same sale by card */
const howOf = (payMode) => (payMode === 'upi' && !(PACK.chart && PACK.chart.paymentModes && PACK.chart.paymentModes.upi) ? 'card' : payMode);
const majorText = (minor) => (Number(minor) / 100).toFixed(2);
const ZERO = '00000000-0000-0000-0000-000000000000'; /* books-store.ZERO — the party_key of a ledger's own (non-party) summary row */
const note = (text) => console.log('  · ' + text);

/* ── the shelf: a Tamil Nadu kirana's items by GST slab, the rows tools/seed/generate.cjs composes (name · unit · price · category · slab · hsn) ── */
const SHELF = [
  [5, 'Aachi Sambar powder 100 g', 'packet', 45, 'Spices', '0910'],
  [5, 'Aavin Toned milk 500 ml', 'packet', 27, 'Dairy', '0401'],
  [5, 'Idhayam Gingelly oil 500 ml', 'bottle', 180, 'Oils', '1515'],
  [5, 'Ponni raw rice 1 kg', 'kg', 62, 'Staples', '1006'],
  [5, 'Toor dal 500 g', 'packet', 85, 'Staples', '0713'],
  [5, 'Sugar 1 kg', 'kg', 44, 'Staples', '1701'],
  [5, 'Tea powder 250 g', 'packet', 120, 'Beverages', '0902'],
  [5, 'Wheat atta 1 kg', 'kg', 48, 'Staples', '1101'],
  [12, 'Aavin Butter 100 g', 'packet', 58, 'Dairy', '0405'],
  [12, 'Amul Cheese 200 g', 'packet', 130, 'Dairy', '0406'],
  [12, "Haldiram's Mixture 200 g", 'packet', 55, 'Snacks', '2106'],
  [12, 'Ghee 200 ml', 'bottle', 140, 'Dairy', '0405'],
  [12, 'Fruit juice 1 L', 'bottle', 110, 'Beverages', '2009'],
  [12, 'Mango pickle 300 g', 'jar', 75, 'Condiments', '2001'],
  [18, 'Colgate toothpaste 100 g', 'piece', 60, 'Personal care', '3306'],
  [18, 'Lifebuoy soap 100 g', 'piece', 32, 'Personal care', '3401'],
  [18, 'Surf Excel 500 g', 'packet', 72, 'Household', '3402'],
  [18, 'Marie biscuits 200 g', 'packet', 30, 'Snacks', '1905'],
  [18, 'Shampoo 180 ml', 'bottle', 125, 'Personal care', '3305'],
  [18, 'Instant noodles 70 g', 'packet', 14, 'Snacks', '1902'],
  [18, 'Chocolate bar 50 g', 'piece', 40, 'Snacks', '1806'],
  [18, 'Coconut hair oil 100 ml', 'bottle', 65, 'Personal care', '3305']
];
const SUPPLIER = 'Kumar Traders',
  CUSTOMER = 'Ravi Stores',
  CREDIT_DAYS = 10;

/* ── a direct pool for the checks (reads) and --fresh ───────────────────────────────────────────────────────────── */
const { Pool } = require(path.join(API, 'node_modules', 'pg'));
const pool = new Pool({ connectionString: DB, max: 2, connectionTimeoutMillis: 5000 });
/* M210's rule, here too: a naive timestamp is a UTC wall clock — the session zone is pinned as db/index.js pins the api's, so the
   proof's `created_at::timestamptz` names the same instant before b299 (naive) and after it (timestamptz) */
pool.on('connect', (client) => {
  client.query("SET TimeZone = 'UTC'").catch((e) => console.warn('session zone not set:', e.message));
});
const sql = (statement, params) => pool.query(statement, params);

async function hasTable(name) {
  return (await sql(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`, [name])).rows.length > 0;
}

/* ── --schema: the repo's schema through tools/migrate.cjs (HX1: the same chain, now with the schema_migrations ledger) ─────── */
async function applySchema() {
  let result;
  try {
    result = await require('./migrate.cjs').apply(DB, { say: note });
  } catch (e) {
    stop(e.message);
  }
  if (!result.fresh) return;
  for (const t of ['identities', 'chit_header', 'journal_entry', 'books_setting', 'customer_list', 'catalogue_items'])
    if (!(await hasTable(t))) stop('table ' + t + ' is missing after --schema');
}

/** --schema-only: the schema step alone (the compose stack's migrate job), then exit */
async function schemaOnly() {
  console.log(
    '\n── sim-load --schema-only · ' + localCheck.host + (localCheck.docker ? ' (docker service)' : localCheck.spin ? ' (test spin ' + process.env.CB_SPIN_ID + ')' : '') + ' ──'
  );
  try {
    await sql('SELECT 1');
  } catch (e) {
    stop('cannot connect to ' + DB.replace(/:[^:@/]+@/, ':***@') + ' — ' + e.message);
  }
  await applySchema();
  await pool.end();
  process.exit(0);
}

/* ── --fresh: the shop and everything it owns, removed (local database, as its owner) ───────────────────────────── */
async function wipeShop(ids) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      await client.query(`SET LOCAL session_replication_role = 'replica'`);
    } catch (e) {
      /* the books' insert-only triggers (b273) stand aside for the owner's wipe */
      throw new Error('--fresh needs the database owner (superuser) on this local database: ' + e.message);
    }
    const cols = (
      await client.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'
                                   AND column_name IN ('entity_id', 'owner_entity_id', 'identity_id', 'parent_entity_id', 'customer_identity_id', 'supplier_entity_id', 'sender_entity_id')`)
    ).rows;
    const byTable = new Map();
    cols.forEach((item) => {
      if (item.table_name === 'identities') return;
      const list = byTable.get(item.table_name) || [];
      list.push(item.column_name);
      byTable.set(item.table_name, list);
    });
    const cleared = [];
    for (const [t, list] of byTable) {
      const where = list.map((item) => item + ' = ANY($1::uuid[])').join(' OR ');
      const nestedR = await client.query(`DELETE FROM ${t} WHERE ${where}`, [ids]);
      if (nestedR.rowCount) cleared.push(t + ' ' + nestedR.rowCount);
    }
    const deleted = await client.query(`DELETE FROM identities WHERE identity_id = ANY($1::uuid[])`, [ids]);
    cleared.push('identities ' + deleted.rowCount);
    await client.query('COMMIT');
    note('fresh: removed ' + cleared.join(' · '));
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/* ── the api, in this process, on a free port ──────────────────────────────────────────────────────────────────── */
const freePort = () =>
  new Promise((ok) => {
    const server = netModule.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => ok(port));
    });
  });
let BASE = '';
async function startApi() {
  process.env.DATABASE_URL = DB;
  process.env.NODE_ENV = process.env.NODE_ENV || 'development';
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) process.env.JWT_SECRET = 'sim-load-local-only-secret-' + 'x'.repeat(24);
  process.env.DEV_OTP = LOGIN_CODE;
  process.env.SHOP_CLOCK_ALLOW = '1';
  process.env.HOST = '127.0.0.1';
  process.env.RLS_GUARD = process.env.RLS_GUARD || 'off';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'warn';
  process.env.RATE_LIMIT_MAX =
    process.env.RATE_LIMIT_MAX || '10000000'; /* server.js's 15-minute window (500) would refuse a year of bills — this api serves one caller, on this PC */
  const port = await freePort();
  process.env.PORT = String(port);
  BASE = 'http://127.0.0.1:' + port;
  require(path.join(API, 'server.js'));
  for (let index = 0; index < 100; index++) {
    try {
      const reply = await fetch(BASE + '/health');
      if (reply.ok) return;
    } catch (notUpYet) {
      require('../lib/logger').fellBack('sim-load: the server is not answering yet — asking again', notUpYet, 'debug');
    }
    await new Promise((ok) => setTimeout(ok, 200));
  }
  stop('the api did not answer /health on ' + BASE);
}
async function callApi(urlPath, options) {
  const opt = options || {};
  const reply = await fetch(BASE + urlPath, {
    method: opt.method || 'GET',
    headers: Object.assign({ 'content-type': 'application/json' }, opt.token ? { authorization: 'Bearer ' + opt.token } : {}),
    body: opt.body ? JSON.stringify(opt.body) : undefined
  });
  let body = null;
  try {
    body = await reply.json();
  } catch (_) {
    /* no body */
  }
  return { status: reply.status, b: body || {} };
}
const must = (reply, what) => {
  if (reply.status >= 300) {
    console.error('\n  sim-load stopped at ' + what + ': HTTP ' + reply.status + ' ' + JSON.stringify(reply.b).slice(0, 400) + '\n');
    process.exit(1);
  }
  return reply;
};

/* ── the ledger hook is fire-and-forget inside the route; here every one is awaited before a day or a month closes ── */
const pending = new Set();
function trackHooks() {
  const booksHooks = require(path.join(API, 'lib', 'books-hooks'));
  const orig = booksHooks.afterChit;
  booksHooks.afterChit = function () {
    const promise = Promise.resolve(orig.apply(this, arguments));
    pending.add(promise);
    promise.finally(() => pending.delete(promise));
    return promise;
  };
}
async function drain() {
  while (pending.size) await Promise.allSettled([...pending]);
}

/* ── PERF1 · --scale: the shop grown past the plan, then the reads timed (tools/sim-scale.cjs; docs/SIM-LOAD.md "Scale") ── */
async function scaleThen(shopId) {
  await callApi('/api/entities/register', {
    method: 'POST',
    body: { email: EMAIL, display_name: 'Simulated Stores', user_id: SHOP }
  }); /* register is also sign-in (the dev code) */
  const verified = must(await callApi('/api/entities/verify', { method: 'POST', body: { email: EMAIL, otp: LOGIN_CODE } }), 'sign in for --scale');
  const token = verified.b.token;
  if (!token) must({ status: 500, b: verified.b }, 'sign in for --scale (no token)');
  const start = dayAdd(PLAN.last, 1),
    end = dayAdd(start, 195); /* the open year after the plan: 1 Apr → 13 Oct with --start 2023-04-01 */
  try {
    await require('./sim-scale.cjs').run({
      base: BASE,
      sql,
      B: require(path.join(API, 'lib', 'books')),
      CLOCK: require(path.join(API, 'lib', 'shop-clock')),
      shopId,
      token,
      cur: CURRENCY,
      scale: SCALE,
      readsOnly: SCALE_READS,
      only: arg('scale-only', ''),
      say: note,
      start,
      end
    });
  } catch (e) {
    console.error('\n  sim-load --scale stopped: ' + ((e && e.stack) || e) + '\n');
    return 1;
  }
  await pool.end();
  return 0;
}

/* ── main ──────────────────────────────────────────────────────────────────────────────────────────────────────── */
(async () => {
  if (SCHEMA_ONLY) return schemaOnly();
  console.log(
    '\n── sim-load · ' +
      SHOP +
      ' · ' +
      YEARS +
      ' year(s) from ' +
      PLAN.start +
      ' · seed ' +
      SEED +
      ' · ' +
      COUNTRY +
      ' · ' +
      localCheck.host +
      (localCheck.docker ? ' (docker service)' : localCheck.spin ? ' (test spin ' + process.env.CB_SPIN_ID + ')' : '') +
      ' ──'
  );
  try {
    await sql('SELECT 1');
  } catch (e) {
    stop('cannot connect to ' + DB.replace(/:[^:@/]+@/, ':***@') + ' — ' + e.message);
  }
  if (SCHEMA) await applySchema();
  if (!(await hasTable('identities'))) stop('this database has no schema — the local stack migrates its own; an empty TEST database takes --schema');
  if (!(await hasTable('journal_entry'))) stop('the ledger tables (migrations b272–b274) are not in this database');
  /* the delivery function must honour the shop clock (b300) — else three years of bills would all be dated today */
  const fn = await sql(`SELECT pg_get_functiondef(to_regprocedure('chit_deliver(uuid,boolean,jsonb)')) AS d`).catch(() => ({ rows: [{ d: null }] }));
  if (!fn.rows[0] || !fn.rows[0].d) stop('chit_deliver (migrations/migration_b50 · b142) is not in this database');
  if (fn.rows[0].d.indexOf("c->>'created_at'") < 0)
    stop('chit_deliver does not honour the shop clock yet — run migrations/b300_chit_deliver_clock.sql on this local database (as postgres), then load');

  /* the shop so far: exists? loaded for this seed? */
  const found = await sql(`SELECT identity_id, user_id, email FROM identities WHERE LOWER(user_id) = $1 OR LOWER(email) = $2`, [SHOP, EMAIL]);
  let shopId = found.rows[0] ? String(found.rows[0].identity_id) : null;
  if (shopId) {
    const mark = await sql(`SELECT source_ref FROM journal_entry WHERE entity_id = $1 AND source_ref LIKE 'opening:sim/%' ORDER BY created_at LIMIT 1`, [
      shopId
    ]);
    const nestedBills = await sql(`SELECT count(*)::int AS n FROM chit_header WHERE entity_id = $1 AND sender_entity_id = $1 AND business_json ? 'bill_no'`, [
      shopId
    ]);
    const loaded = mark.rows[0] ? mark.rows[0].source_ref.replace(/^opening:/, '') : null;
    if (!FRESH) {
      if (loaded === MARK && SCALE) {
        note('already loaded: ' + SHOP + ' holds ' + loaded + ' — on to --scale ' + SCALE);
        await startApi();
        process.exit(await scaleThen(shopId));
      }
      if (loaded === MARK) {
        note('already loaded: ' + SHOP + ' holds ' + loaded + ' (' + nestedBills.rows[0].n + ' bills). Nothing written.');
        await proof(shopId, true);
        printLogin();
        process.exit(0);
      }
      if (loaded) stop(SHOP + ' already holds ' + loaded + ' — a different seed/years. Rebuild with --fresh.');
      if (nestedBills.rows[0].n) stop(SHOP + ' already has ' + nestedBills.rows[0].n + ' bills (an earlier run that did not finish?). Rebuild with --fresh.');
      note('shop ' + SHOP + ' exists and is empty — loading into it');
    } else {
      const kids = await sql(`SELECT identity_id FROM identities WHERE parent_entity_id = $1`, [shopId]);
      await wipeShop([shopId].concat(kids.rows.map((item) => String(item.identity_id))));
      shopId = null;
    }
  } else if (FRESH) note('fresh: nothing to remove — ' + SHOP + ' did not exist');

  await startApi();
  trackHooks();
  const CLOCK = require(path.join(API, 'lib', 'shop-clock'));
  const books = require(path.join(API, 'lib', 'books'));
  const taxLines = require(path.join(API, 'lib', 'tax-lines'));
  const rollup = require(path.join(API, 'lib', 'rollup'));
  const started = Date.now();
  CLOCK.set(AT(PLAN.start, 9, 0));

  /* 1 · the shop — register is also sign-in (the code is the dev one) */
  must(await callApi('/api/entities/register', { method: 'POST', body: { email: EMAIL, display_name: 'Simulated Stores', user_id: SHOP } }), 'shop register');
  const verified = must(await callApi('/api/entities/verify', { method: 'POST', body: { email: EMAIL, otp: LOGIN_CODE } }), 'shop verify (is DEV_OTP armed?)');
  const token = verified.b.token;
  shopId = String((verified.b.entity && verified.b.entity.identity_id) || (verified.b.identity && verified.b.identity.identity_id) || '');
  if (!shopId) {
    const identityRows = await sql(`SELECT identity_id FROM identities WHERE LOWER(email) = $1`, [EMAIL]);
    shopId = String(identityRows.rows[0].identity_id);
  }
  const gstn = SHOPROW.taxNo; /* the shop's tax registration number (GSTIN · ABN · TRN) — SHOPS above */
  /* 1b · Country setup (CS1, M210's week): the step every owner completes after registration, before the books open — country ·
     money · financial year · tax registration, through PUT /api/governance/country-setup (lib/country-setup.save writes identities.gstn,
     the one home). 503 = b299_country_setup not run on this database: the gate then stays as it was, and the GSTIN goes in by the profile door. */
  const setup = await callApi('/api/governance/country-setup', {
    method: 'PUT',
    token,
    body: {
      country: COUNTRY,
      currency: CURRENCY,
      fy_start_month: PACK.fiscalYear.startMonth,
      tax: Object.assign({ registered: true, number: gstn }, COUNTRY === 'IN' ? { scheme: 'regular' } : {}),
      source: { country: 'sim-load', currency: 'the pack', fy_start_month: 'the pack', tax: 'sim-load' }
    }
  });
  if (setup.status === 503) note('country setup: ' + (setup.b.message || 'not migrated') + ' — b299_country_setup.sql is not on this database');
  else must(setup, 'country setup');
  must(
    await callApi('/api/entities/profile', { method: 'PATCH', token, body: Object.assign({ address: SHOPROW.address }, gstn && setup.status === 503 ? { gstn } : {}) }),
    'shop profile'
  );
  const mine = must(await callApi('/api/entities/me', { token }), 'who am I').b;
  const meRow = mine.entity || mine.identity || mine;
  note('shop ' + (meRow.display_name || 'Simulated Stores') + ' · user id ' + SHOP + ' · ' + (meRow.bridge_id || ''));

  /* 2 · the ledger on, the opening balances */
  let entity;
  if (COUNTRY === 'IN') entity = must(await callApi('/api/books/enable', { method: 'POST', token, body: {} }), 'ledger on').b;
  else {
    entity = await books.enable(null, shopId, { country: COUNTRY });
    require(path.join(API, 'lib', 'books-hooks')).forget(shopId);
  } /* the route takes no country (IN); AU · AE go through the same enable() */
  const chart = must(await callApi('/api/books/accounts', { token }), 'chart').b;
  const accounts = chart.accounts || chart.rows || chart.items || (Array.isArray(chart) ? chart : []);
  const codeOfRole = (role) => (accounts.find((item) => item.role === role) || {}).code;
  const CASH = codeOfRole('cash'),
    CAPITAL = codeOfRole('capital') || '3000';
  if (!CASH) stop('the chart has no cash ledger (role cash) — enable answered ' + JSON.stringify(entity).slice(0, 200));
  const opened = must(
    await callApi('/api/books/opening', {
      method: 'POST',
      token,
      body: {
        date: PLAN.start,
        client_ref: MARK,
        rows: [
          { code: CASH, dr_minor: 50000000 },
          { code: CAPITAL, cr_minor: 50000000 }
        ]
      }
    }),
    'opening balances'
  ).b;
  note('ledger on (' + entity.fiscal_year + ') · opening ' + (opened.entry_no || '') + ' cash 5,00,000 against capital · suspense ' + majorText(opened.suspense_minor || 0));

  /* 3 · parties, the counter, the shelf */
  const supplier = await callApi('/api/relationships/suppliers', { method: 'POST', token, body: { name: SUPPLIER } });
  if (supplier.status !== 409) must(supplier, 'supplier');
  const customer = await callApi('/api/relationships/customers', { method: 'POST', token, body: { name: CUSTOMER, phone: SHOPROW.phone } });
  if (customer.status !== 409) must(customer, 'customer');
  const parties = (await sql(`SELECT identity_id, display_name FROM identities WHERE parent_entity_id = $1`, [shopId])).rows;
  const SUPP = (parties.find((item) => item.display_name === SUPPLIER) || {}).identity_id,
    CUST = (parties.find((item) => item.display_name === CUSTOMER) || {}).identity_id;
  if (!SUPP || !CUST) stop('the parties were not minted: ' + JSON.stringify({ sup: supplier.b, cus: customer.b }).slice(0, 300));
  let counters = must(await callApi('/api/counters', { token }), 'counters').b.counters || [];
  if (!counters.some((item) => item.id === TILL))
    counters = counters.concat([must(await callApi('/api/counters', { method: 'POST', token, body: { name: 'Counter 1' } }), 'add counter').b.counter]);
  const have = must(await callApi('/api/products?limit=500', { token }), 'list products').b;
  const rows = have.items || have.products || have.rows || [];
  const byName = new Map(rows.map((x) => [String((x.item_data || x).name || '').toLowerCase(), x.item_id || x.id]));
  const ITEMS = [];
  for (const [rate, name, unit, price, category, hsn] of SHELF) {
    const baseRate = rateOf(rate);
    let id = byName.get(name.toLowerCase());
    if (!id) {
      const reply = must(
        await callApi('/api/products', {
          method: 'POST',
          token,
          body: { item_data: { name, unit, price, category, hsn, tax_slab: COUNTRY + '-' + PACK.tax.scheme + '-' + baseRate, gst_rate: baseRate } }
        }),
        'add ' + name
      );
      id = (reply.b.item || reply.b).item_id || reply.b.item_id;
    }
    ITEMS.push({ id, rate: baseRate, name, unit, price, hsn });
  }
  note('supplier ' + SUPPLIER + ' · customer ' + CUSTOMER + ' · counter ' + TILL + ' · ' + ITEMS.length + ' products');

  /* 4 · the invoice the counter carries: lib/tax-lines.invoiceFor (= CBTax.determine), the one calculation; the server re-checks it on post */
  const seller = taxLines.partyOf(
    { gstn: meRow.gstn || gstn, display_name: meRow.display_name, country: meRow.country || COUNTRY, policy_flags: meRow.policy_flags },
    { entity_id: shopId }
  );
  /* the shop's own price_includes_tax flag (lib/policy, default yes) — the same reader tax-copy.partiesFor uses when the server re-checks the bill */
  const priceIncludesTax = require(path.join(API, 'lib', 'policy')).flagOf(meRow.policy_flags, 'price_includes_tax') === 'yes';
  const buyerOf = (name) => ({
    LglNm: name,
    Gstin: null,
    State: null,
    Country: seller.Country || COUNTRY,
    RegType: 'unregistered',
    Ph: null,
    Em: null,
    entity_id: null,
    Pos: seller.State
  });
  const basketOf = (rate, dayIx, basketIndex) => {
    const random = PLAN_LIB.rng(SEED * 1000003 + dayIx * 101 + basketIndex);
    /* the plan draws an IN slab (5 / 12 / 18); a one-rate pack (AU 10 % · AE 5 %) maps it to its standard rate, as the shelf was added (WX-R2R) */
    const pool0 = ITEMS.filter((item) => item.rate === rateOf(rate)),
      lineCount = 1 + Math.floor(random() * 3),
      lines = [];
    for (let index = 0; index < lineCount; index++) {
      const picked = pool0[Math.floor(random() * pool0.length)],
        quantity = 1 + Math.floor(random() * 3);
      if (lines.some((item) => item.item_id === picked.id)) continue;
      lines.push({
        particulars: picked.name,
        quantity: quantity,
        unit: picked.unit,
        price: picked.price,
        total: picked.price * quantity,
        item_id: picked.id,
        hsn: picked.hsn,
        gst_rate: picked.rate
      });
    }
    return lines;
  };

  /* 5 · the days */
  let bills = 0,
    purchases = 0,
    expenses = 0,
    months = 0,
    refusedBills = 0,
    count = 0,
    curFy = '';
  const dayRows = [];
  const closeMonth = async (periodDate) => {
    await drain();
    const periodYear = fyOf(periodDate),
      periodMonth = monthNo(periodDate);
    const closed = await callApi('/api/books/gst/close', { method: 'POST', token, body: { fy: periodYear, period: periodMonth } });
    if (closed.status !== 200) console.log('   RED  GST close of ' + periodYear + ' month ' + periodMonth + ' refused — ' + JSON.stringify(closed.b).slice(0, 200));
    const locked = await callApi('/api/books/periods/' + periodYear + '/' + periodMonth + '/lock', { method: 'POST', token, body: { reason: 'month done' } });
    if (locked.status !== 200) console.log('   RED  lock of ' + periodYear + ' month ' + periodMonth + ' refused — ' + JSON.stringify(locked.b).slice(0, 200));
    else months++;
    if (periodMonth === 12) {
      const yearClosed = await callApi('/api/books/year/' + periodYear + '/close', { method: 'POST', token, body: {} });
      if (yearClosed.status !== 200) console.log('   RED  year close ' + periodYear + ' refused — ' + JSON.stringify(yearClosed.b).slice(0, 300));
      else note(periodYear + ' closed · ' + bills + ' bills so far · ' + Math.round((Date.now() - started) / 1000) + 's');
    }
  };
  for (let dayIx = 0; dayIx < PLAN.days.length; dayIx++) {
    const row = PLAN.days[dayIx],
      text = row.day;
    CLOCK.set(AT(text, 9, 0));
    if (text.slice(8) === '01' && text !== PLAN.start) await closeMonth(dayAdd(text, -1));
    if (fyOf(text) !== curFy) {
      curFy = fyOf(text);
      count = 0;
    }
    const todays = [];
    for (let index = 0; index < row.sales.length; index++) {
      const sale = row.sales[index],
        at = AT(text, 10 + Math.floor((index * 9) / row.sales.length), (dayIx * 7 + index * 13) % 60);
      CLOCK.set(at);
      const lines = basketOf(sale.rate, dayIx, index);
      const invoice = taxLines.invoiceFor({ lines, seller, buyer: buyerOf(sale.how === 'credit' ? CUSTOMER : 'Walk-in'), currency: CURRENCY, at, priceIncludesTax }).invoice;
      const total = Number(invoice.ValDtls && invoice.ValDtls.TotInvVal) || 0;
      const no = TILL + '/' + fyShort(text) + '/' + String(++count).padStart(4, '0');
      const credit = sale.how === 'credit',
        payMode = howOf(sale.how);
      const body = {
        recipients: [{ self: true, name: 'self' }],
        purpose: 'order',
        subject: 'Counter sale ' + no,
        manual_subject: 'Counter sale ' + no,
        client_ref: no,
        business_json: {
          customer: credit ? { name: CUSTOMER, party_id: CUST } : { name: 'Walk-in' },
          till: { id: TILL, name: 'Counter 1', host: 'sim-load', by: null },
          bill_no: no,
          billed_at: at,
          catalogue_version: null,
          payment: { mode: payMode, paid: credit ? 0 : total, change: 0, parts: [{ how: payMode, amount: total }] },
          slip: credit ? 'credit' : 'cash',
          terms: credit ? { due_date: dayAdd(text, CREDIT_DAYS), credit_days: CREDIT_DAYS } : null,
          credit_override: null,
          invoice: invoice
        },
        line_items: lines
      };
      const reply = await callApi('/api/chits/send', { method: 'POST', token, body });
      if (reply.status >= 300) {
        refusedBills++;
        if (refusedBills <= 5) console.log('   RED  bill ' + no + ' refused: HTTP ' + reply.status + ' ' + JSON.stringify(reply.b).slice(0, 300));
        continue;
      }
      bills++;
      todays.push({ no, total, kind: credit ? 'credit' : 'cash', payments: [{ how: payMode, amount: total }], at });
    }
    /* the counter's day summary — the record the shop's folder shows; its hook posts the walk-in day */
    if (todays.length) {
      await drain();
      CLOCK.set(AT(text, 21, 0));
      const sum = rollup.summary('day', text, rollup.totals(todays), {
        till: { id: TILL, name: 'Counter 1' },
        bills_from: todays[0].no,
        bills_to: todays[todays.length - 1].no,
        at: CLOCK.now().toISOString()
      });
      const reply = await callApi('/api/chits/send', { method: 'POST', token, body: rollup.chitOf(sum) });
      if (reply.status >= 300) console.log('   RED  day summary ' + text + ' refused: ' + JSON.stringify(reply.b).slice(0, 200));
      dayRows.push({ day: text, bills: todays.length });
    }
    if (row.purchase) {
      CLOCK.set(AT(text, 16, 0));
      const taxable = row.purchase.taxable,
        prate = rateOf(18),
        ptotal = taxable + (taxable * prate) / 100;
      const posted = await books.postEntry(null, shopId, {
        type: 'purchase_bill',
        party: SUPP,
        date: text,
        currency: CURRENCY,
        source_ref: 'sim:' + text + ':p',
        ref: 'KT/' + text.replace(/-/g, '') + '/' + (purchases + 1),
        by_rate: [taxRow(prate, taxable)],
        paid: row.purchase.paid_bank ? { bank: ptotal } : {},
        round_off: 0,
        due_date: dayAdd(text, 30)
      }).catch((e) => ({ ok: false, why: String(e && e.message) }));
      if (posted && posted.ok) purchases++;
      else console.log('   RED  purchase on ' + text + ' refused — ' + JSON.stringify(posted).slice(0, 200));
    }
    const spend = async (kind, amount, from, ref) => {
      const reply = await callApi('/api/books/events', {
        method: 'POST',
        token,
        body: { event: 'expense', class: kind, amount, paid_from: from, date: text, client_ref: ref }
      });
      if (reply.status === 200) expenses++;
      else console.log('   RED  expense ' + ref + ' refused — ' + JSON.stringify(reply.b).slice(0, 200));
    };
    if (row.expense) {
      CLOCK.set(AT(text, 17, 0));
      await spend(row.expense.class, row.expense.amount, 'cash', 'sim:' + text + ':e');
    }
    if (row.rent) {
      CLOCK.set(AT(text, 17, 30));
      await spend('rent', 20000, 'bank', 'sim:' + text + ':rent');
    }
  }
  CLOCK.set(AT(dayAdd(PLAN.last, 1), 9, 0));
  await closeMonth(PLAN.last);
  await drain();
  CLOCK.reset();
  note(
    'made ' +
      bills +
      ' bills (' +
      refusedBills +
      ' refused) · ' +
      purchases +
      ' purchases · ' +
      expenses +
      ' expenses · ' +
      months +
      ' months closed · ' +
      Math.round((Date.now() - started) / 1000) +
      's'
  );

  const failures = await proof(shopId, false);
  printLogin();
  if (SCALE && !failures) process.exit(await scaleThen(shopId));
  await pool.end();
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('\n  sim-load failed: ' + ((e && e.stack) || e) + '\n');
  process.exit(2);
});

/* ── the proof: SQL over what was written (reads only) ──────────────────────────────────────────────────────────── */
async function proof(shopId, quiet) {
  const out = [];
  const line = (ok, name, detail) => {
    out.push(ok);
    console.log('   ' + (ok ? 'ok   ' : 'RED  ') + name + (detail ? ' — ' + detail : ''));
  };
  console.log('\n  proof (' + (quiet ? 'as loaded' : 'this run') + '):');
  const bills = await sql(
    `SELECT count(*)::int AS n FROM chit_header WHERE entity_id = $1 AND sender_entity_id = $1 AND role <> 'Draft' AND business_json ? 'bill_no' AND business_json -> 'till' ->> 'id' = $2`,
    [shopId, TILL]
  );
  line(bills.rows[0].n === WANT.bills, "bills in chit_header = the plan's (" + bills.rows[0].n + ' of ' + WANT.bills + ', ' + WANT.days + ' days)');
  const sums = await sql(
    `SELECT count(*)::int AS n FROM chit_header WHERE entity_id = $1 AND purpose = 'general' AND business_json -> 'summary' ->> 'period' = 'day'`,
    [shopId]
  );
  const daysWithBills = PLAN.days.filter((item) => item.sales.length).length;
  line(sums.rows[0].n === daysWithBills, 'day summaries = days with bills (' + sums.rows[0].n + ' of ' + daysWithBills + ')');
  const purchases = await sql(`SELECT count(*)::int AS n FROM journal_entry WHERE entity_id = $1 AND event_type = 'purchase_bill'`, [shopId]);
  line(purchases.rows[0].n === WANT.purchases, "purchases posted = the plan's (" + purchases.rows[0].n + ' of ' + WANT.purchases + ')');
  /* trial balance: every month's lines balance */
  const trialBalance = await sql(
    `SELECT e.fiscal_year, e.period, SUM(l.dr_minor)::bigint AS dr, SUM(l.cr_minor)::bigint AS cr FROM journal_entry e JOIN journal_line l ON l.entry_id = e.entry_id
                         WHERE e.entity_id = $1 GROUP BY 1, 2 ORDER BY 1, 2`,
    [shopId]
  );
  const unbalanced = trialBalance.rows.filter((item) => String(item.dr) !== String(item.cr));
  line(
    trialBalance.rows.length > 0 && unbalanced.length === 0,
    'trial balance balances every month (' + trialBalance.rows.length + ' months, Dr = Cr)',
    unbalanced
      .slice(0, 3)
      .map((item) => item.fiscal_year + '/' + item.period + ' Dr ' + majorText(item.dr) + ' Cr ' + majorText(item.cr))
      .join(' · ')
  );
  /* the STORED month summaries (account_balance, written by the posting) balance too — a second source, not the lines again */
  const storedBalance = await sql(
    `SELECT fiscal_year, period, SUM(dr_minor)::bigint AS dr, SUM(cr_minor)::bigint AS cr FROM account_balance WHERE entity_id = $1 AND party_key = $2 GROUP BY 1, 2 ORDER BY 1, 2`,
    [shopId, ZERO]
  );
  const sunb = storedBalance.rows.filter((item) => String(item.dr) !== String(item.cr));
  line(
    storedBalance.rows.length === trialBalance.rows.length && sunb.length === 0,
    'stored month summaries (account_balance) balance, one per month (' + storedBalance.rows.length + ')',
    sunb
      .slice(0, 3)
      .map((item) => item.fiscal_year + '/' + item.period)
      .join(' · ')
  );
  /* cash, each FY: opening (the STORED summaries of the years before) + net flow (this year's LINES) = closing (the stored summaries up to this year) */
  const list = [...new Set(trialBalance.rows.map((item) => item.fiscal_year))].sort();
  for (const fy of list) {
    const range = accountsPacks.fyRange(fy, FYPACK),
      from = range.start,
      to = range.end; /* the pack's year, not April's */
    const cashRows = await sql(
      `SELECT (SELECT COALESCE(SUM(b.dr_minor - b.cr_minor), 0) FROM account_balance b JOIN ledger_account a ON a.account_id = b.account_id
                                  WHERE b.entity_id = $1 AND a.role = 'cash' AND b.party_key = $4 AND b.fiscal_year < $5)::bigint AS opening,
                                (SELECT COALESCE(SUM(l.dr_minor - l.cr_minor), 0) FROM journal_line l JOIN journal_entry e ON e.entry_id = l.entry_id JOIN ledger_account a ON a.account_id = l.account_id
                                  WHERE e.entity_id = $1 AND a.role = 'cash' AND e.posting_date >= $2 AND e.posting_date <= $3)::bigint AS flow,
                                (SELECT COALESCE(SUM(b.dr_minor - b.cr_minor), 0) FROM account_balance b JOIN ledger_account a ON a.account_id = b.account_id
                                  WHERE b.entity_id = $1 AND a.role = 'cash' AND b.party_key = $4 AND b.fiscal_year <= $5)::bigint AS closing`,
      [shopId, from, to, ZERO, fy]
    );
    const cash = cashRows.rows[0],
      ok = BigInt(cash.opening) + BigInt(cash.flow) === BigInt(cash.closing) && (list.indexOf(fy) === 0 || BigInt(cash.opening) > 0n);
    line(ok, fy + ' · cash opening ' + majorText(cash.opening) + ' (stored) + net flow ' + majorText(cash.flow) + ' (lines) = closing ' + majorText(cash.closing) + ' (stored)');
  }
  /* created_at names an INSTANT (M210): timestamptz after b299, and before it a naive UTC wall clock — read as UTC because this
     pool's session zone is pinned to UTC exactly as db/index.js pins the api's (the `::timestamptz` cast is then the same instant
     either way). The day it belongs to is the SHOP's (books-hooks.zoneOf of the shop's IANA zone — SHOPS above; zoneOf(COUNTRY) falls back to
     India for AU, whose zones neither COUNTRY_ZONE nor the pack carries yet), the one rule the day close uses. */
  const zone = require(path.join(API, 'lib', 'books-hooks')).zoneOf(SHOPROW.zone);
  const dated = await sql(
    `SELECT count(*)::int AS n FROM chit_header WHERE entity_id = $1 AND business_json ? 'bill_no'
                             AND ((business_json ->> 'billed_at')::timestamptz AT TIME ZONE $2)::date <> (created_at::timestamptz AT TIME ZONE $2)::date`,
    [shopId, zone]
  );
  line(dated.rows[0].n === 0, "every bill's created_at is its own simulated day in " + zone + ', not today (' + dated.rows[0].n + ' off)');
  const locked = await sql(`SELECT count(*)::int AS n FROM fiscal_period WHERE entity_id = $1 AND status IN ('soft_locked', 'hard_locked') AND period > 0`, [
    shopId
  ]);
  line(locked.rows[0].n >= YEARS * 12, 'months locked (' + locked.rows[0].n + ' of ' + YEARS * 12 + ')');
  const waiting = await sql(`SELECT count(*)::int AS n FROM books_outbox WHERE entity_id = $1 AND done_at IS NULL`, [shopId]).catch(() => ({
    rows: [{ n: 'n/a' }]
  }));
  line(waiting.rows[0].n === 0 || waiting.rows[0].n === 'n/a', 'nothing waiting in books_outbox (' + waiting.rows[0].n + ')');
  const failures = out.filter((x) => !x).length;
  console.log('  ' + (failures ? '✗ ' + failures + ' RED' : '✓ all green') + ' · ' + out.length + ' lines');
  return failures;
}
function printLogin() {
  console.log('\n  open it: http://localhost:8124 → sign in as ' + SHOP + ' (or ' + EMAIL + ') · code ' + LOGIN_CODE + ' (DEV_OTP on the local stack)\n');
}
