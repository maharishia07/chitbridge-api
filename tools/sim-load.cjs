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
 *   --months N MIS showcase: instead of the random three-year plan, N months (1..the file's length: 26 in the default tools/seed/mis-history.json, 84 = 7 years with --history tools/seed/mis-history-84.json) of BACK-DATED DEMO HISTORY,
 *              the shop shaped by --profile <name> (tools/seed/mis-profiles.json: size, trade mix, a struggling one, one with a bank difference; default grocer) with PURCHASES from its suppliers
 *              (bills, then payments through POST /api/books/payments, some left owing) and a credit customer's receipts; --shop is 8–20 letters or digits;
 *              the country's own close (AU: each BAS quarter through POST /gst/close, then the year close; IN: GST month + lock); --api-db <url> (or SIM_API_DB) runs the in-process api as cb_app so RLS applies,
 *              posted straight into the BOOKS (the one writer, lib/books.postEntry; never the till, no chit): a walk-in day entry for every day, one tax-inclusive credit sale and one
 *              reversed sale a month, rent; months locked up to two months before the last. Every entry's source_ref starts 'demo:', the shop's name ends ' - demo'
 *              (--name, default 'Simulated Stores'), every line is the pack's currency (AUD for --country AU). ADD ONLY: --fresh is refused with --months. The proof compares each month's SOLD
 *              (books-store.soldByDay, the Day book) with the plan's integer-cent sums and with tools/seed/mis-history-expected.json (hand-written, 3 months).
 *              --dry (or DRY=1): print the plan and the expected months and stop (no database touched).
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
const API_DB = arg('api-db', process.env.SIM_API_DB || DB); /* the in-process api's database URL: say cb_app here so every books read and write runs under RLS as in production (the checks' own pool stays DB) */
const MONTHS = Number(arg('months', 0)),
  DRY_RUN = hasFlag('dry') || process.env.DRY === '1',
  HISTORY_FILE = arg('history', path.join(__dirname, 'seed', 'mis-history.json')),
  PROFILE_NAME = String(arg('profile', 'grocer')),
  NAME = String(arg('name', 'Simulated Stores')) + (MONTHS && !/ - demo$/.test(String(arg('name', 'Simulated Stores'))) ? ' - demo' : '');
const SEED_E = arg('seed-e', ''), FIRM = arg('firm', ''); /* Seed E (tools/seed/seed-e.cjs): this client's number in the firm, and the firm's handle */
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
const die = (message, code) => {
  console.error('\n  REFUSED: ' + message + '\n');
  process.exit(code || 3);
};
const localCheck = localOnly(DB);
if (!DB && !DRY_RUN) die('say which local database: --db postgres://postgres:pw@127.0.0.1:5432/cb_sim');
if (!DRY_RUN && !localCheck.ok) die(localCheck.why);
if (!DRY_RUN && API_DB !== DB && !localOnly(API_DB).ok) die('--api-db: ' + localOnly(API_DB).why);
if (MONTHS && FRESH) die('--months adds shops and entries; it never removes any (--fresh is refused)');
if (!SCHEMA_ONLY && !(DRY_RUN && !SHOP) && !/^[a-z][a-z0-9]{2,19}$/.test(SHOP)) die("--shop is the shop's user id: 3–20 letters or digits, starting with a letter (e.g. simstores)");
if (MONTHS && !(DRY_RUN && !SHOP) && SHOP.length < 8) die("--shop is 8–20 letters or digits with --months (the api refuses a shorter user id; no hyphens), e.g. harbourdemoau");
if (!MONTHS && !(YEARS >= 1 && YEARS <= 10) || !Number.isInteger(SEED)) die('--years 1..10 and --seed a whole number');
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
if (!SHOPS[COUNTRY]) die('--country IN, AU or AE (the registered packs: lib/regulation)');
if (require(path.join(API, 'lib', 'dev-otp')).isSealed())
  die('NODE_ENV is sealed (' + process.env.NODE_ENV + ') — the loader runs only with NODE_ENV=development (or test)');

const PLAN_LIB = require(path.join(__dirname, 'sim-plan.cjs'));
require(path.join(API, 'lib', 'tax-packs')); /* loads lib/regulation with the three packs registered */
const PACK = require(path.join(API, 'lib', 'regulation')).packFor(
  COUNTRY
); /* currency · fiscalYear · taxHeads · tax.scheme · tax.standard_rate · chart.paymentModes */
if (!PACK) die('no regulation pack is registered for ' + COUNTRY);
/* ⭐ WX-R2R: the shop's CALENDAR is the pack's (IN an April year · AU a July year · AE a January year) — the plan starts on the pack's
   first month; one reader for the bill series, the month close and the proof (lib/accounts-packs fiscalYearOf · periodOf · fyRange below). */
const HIST = MONTHS ? JSON.parse(require('fs').readFileSync(HISTORY_FILE, 'utf8')) : null;
if (HIST && HIST.country !== COUNTRY) die('the history file is for ' + HIST.country + ', --country is ' + COUNTRY);
const START = MONTHS ? HIST.start : String(START_ARG || '2026-' + String(PACK.fiscalYear.startMonth).padStart(2, '0') + '-01');
if (!/^\d{4}-\d{2}-01$/.test(START) || (!MONTHS && Number(START.slice(5, 7)) !== PACK.fiscalYear.startMonth))
  die(
    "--start is a financial year's first day for " +
      COUNTRY +
      ' (month ' +
      PACK.fiscalYear.startMonth +
      '): e.g. 2023-' +
      String(PACK.fiscalYear.startMonth).padStart(2, '0') +
      '-01'
  );
const PROFILE = MONTHS ? ((JSON.parse(require('fs').readFileSync(path.join(__dirname, 'seed', 'mis-profiles.json'), 'utf8')).profiles || {})[PROFILE_NAME] || die('--profile ' + PROFILE_NAME + ' is not in tools/seed/mis-profiles.json')) : null;
const PLAN = MONTHS ? PLAN_LIB.historyDays(HIST, MONTHS, PROFILE) : PLAN_LIB.planDays({ start: START, years: YEARS, seed: SEED });
const HEXPECT = MONTHS ? PLAN_LIB.historyExpect(PLAN, HIST.gst_rate) : null;
if (MONTHS && DRY_RUN) {
  /* the dry plan: what would be posted per shop, nothing connected */
  const total = Object.keys(HEXPECT).reduce((acc, k) => ({ entries: acc.entries + HEXPECT[k].entries, sold: acc.sold + HEXPECT[k].sold }), { entries: 0, sold: 0 });
  console.log('DRY plan · profile ' + PROFILE_NAME + ' · ' + COUNTRY + ' ' + HIST.currency + ' · ' + MONTHS + ' months ' + PLAN.start + ' to ' + PLAN.last + ' · ' + PLAN.days.length + ' days · ' + total.entries + ' entries per shop · SOLD ' + (total.sold / 100).toFixed(2));
  for (const k of Object.keys(HEXPECT)) console.log('  ' + k + '  SOLD ' + (HEXPECT[k].sold / 100).toFixed(2) + '  net ' + (HEXPECT[k].net / 100).toFixed(2) + '  GST ' + (HEXPECT[k].gst / 100).toFixed(2) + '  rent ' + (HEXPECT[k].rent / 100).toFixed(2) + '  buys ' + (HEXPECT[k].buys / 100).toFixed(2) + '  entries ' + HEXPECT[k].entries);
  console.log('  left owing at the end: suppliers ' + PLAN.owing.ap.map((c) => (c / 100).toFixed(2)).join(' / ') + ' · customer ' + (PLAN.owing.ar / 100).toFixed(2));
  process.exit(0);
}
const WANT = MONTHS ? null : PLAN_LIB.countOf(PLAN);
const MARK = MONTHS
  ? 'sim/mis-history/months-' + MONTHS + '/from-' + START
  : 'sim/seed-' +
  SEED +
  '/years-' +
  YEARS +
  (START_ARG ? '/from-' + START : ''); /* the default keeps its old mark — a shop loaded before --start is still "already loaded" */
const MAIL_DOMAIN = process.env.SEED_MAIL_DOMAIN || 'test.example'; /* a SIT box: test.chitbridge (the tester code opens it) */
const EMAIL = SHOP + '@' + MAIL_DOMAIN; /* a fixture domain (lib/entitykind) — the shop is a TEST business, never a live one */
const LOGIN_RAW = process.env.TESTER_CODE || process.env.DEV_OTP || '123456';
/* a tester code may carry a {yymmdd}/{yyyymmdd} slot the api fills with the SHOP CLOCK's day (lib/dev-otp testerCodesNow): the loader's clock is back-dated, so fill it the same way */
const codeNow = () => {
  const clock = require(path.join(API, 'lib', 'shop-clock')), shopDay = clock.bizDay(clock.nowMs(), process.env.TESTER_CODE_TZ || 'Asia/Kolkata');
  return LOGIN_RAW.replace(/{(yymmdd|yyyymmdd)}/, (_, form) => (form === 'yymmdd' ? shopDay.slice(2) : shopDay).replace(/-/g, ''));
};
const LOGIN_CODE = LOGIN_RAW;
const TILL = 'C1';
const dayAdd = PLAN_LIB.dayAdd;
const SHOPROW = SHOPS[COUNTRY];
const CURRENCY = PACK.currency;
const AT = (dayText, hours, minutes) => dayText + 'T' + String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0') + ':00' + SHOPROW.offset; /* the shop's own wall clock */
/* the year and the month number THE API USES for this shop: lib/accounts-packs (the adopted engine) with the pack's start month — not a second rule here.
   ⚠️ accounts-packs v1.20 labels a January year '2026' and every other '2026-27'; the books routes read the same function, so the two always agree. */
const AP = require(path.join(API, 'lib', 'accounts-packs'));
const FYPACK = { fy_start_month: PACK.fiscalYear.startMonth };
const fyOf = (d) => AP.fiscalYearOf(d, FYPACK);
const fyShort = (dayText) => {
  const fiscalYear = fyOf(dayText);
  return fiscalYear.length > 4 ? fiscalYear.slice(2) : fiscalYear;
}; /* 26-27 — the counter's own year label; '2026' for a January year */
const monthNo = (d) => AP.periodOf(d, FYPACK);
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
/* the shop's IANA zone for Country setup: the pack's own zone list decides (no list = the shop's city zone; a list = that city's zone when the pack names it, else the pack's first) */
const zoneOf = () => {
  const zones = Array.isArray(PACK.timeZones) ? PACK.timeZones : [];
  return !zones.length || zones.indexOf(SHOPS[COUNTRY].zone) >= 0 ? SHOPS[COUNTRY].zone : zones[0];
};
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
const RETURNS_PACK = !!(PACK.returns && PACK.returns.id); /* AU BAS · AE VAT201: the pack closes a return period; IN closes a month */
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

/** stamp recorded_at on ids (an array of entity ids, or null = every Seed E demo client): one transaction, owner only. pool = a pg Pool. Returns the rows stamped. */
async function stampRecorded(pool, ids) {
  const SE = require('./seed/seed-e.cjs');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL session_replication_role = 'replica'"); /* the insert-only trigger stands aside, as sim-load --fresh does */
    const r = ids ? await client.query(SE.STAMP_SQL.replace('%IDS%', '$1::uuid[]'), [ids]) : await client.query(SE.STAMP_SQL.replace('%IDS%', SE.SEED_IDS_SQL));
    await client.query('COMMIT');
    return r.rowCount;
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
}

const hasTable = (name) => require('./sim-load-wipe.cjs').hasTable(sql, name);

/* ── --schema: the repo's schema through tools/migrate.cjs (HX1: the same chain, now with the schema_migrations ledger) ─────── */
async function applySchema() {
  let result;
  try {
    result = await require('./migrate.cjs').apply(DB, { say: note });
  } catch (e) {
    die(e.message);
  }
  if (!result.fresh) return;
  for (const t of ['identities', 'chit_header', 'journal_entry', 'books_setting', 'customer_list', 'catalogue_items'])
    if (!(await hasTable(t))) die('table ' + t + ' is missing after --schema');
}

/** --schema-only: the schema step alone (the compose stack's migrate job), then exit */
async function schemaOnly() {
  console.log(
    '\n── sim-load --schema-only · ' + localCheck.host + (localCheck.docker ? ' (docker service)' : localCheck.spin ? ' (test spin ' + process.env.CB_SPIN_ID + ')' : '') + ' ──'
  );
  try {
    await sql('SELECT 1');
  } catch (e) {
    die('cannot connect to ' + DB.replace(/:[^:@/]+@/, ':***@') + ' — ' + e.message);
  }
  await applySchema();
  await pool.end();
  process.exit(0);
}

/* ── --fresh: the shop and everything it owns, removed (local database, as its owner) — tools/sim-load-wipe.cjs ── */
const wipeShop = (ids) => require('./sim-load-wipe.cjs').wipeShop(pool, ids, note);

/* ── the api, in this process, on a free port — tools/sim-load-api.cjs ── */
const { startApi, callApi, must, trackHooks, drain, base: baseUrl } = require('./sim-load-api.cjs').create({ API, API_DB, LOGIN_CODE, stopWith: die });

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
      base: baseUrl(),
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
    die('cannot connect to ' + DB.replace(/:[^:@/]+@/, ':***@') + ' — ' + e.message);
  }
  if (SCHEMA) await applySchema();
  if (!(await hasTable('identities'))) die('this database has no schema — the local stack migrates its own; an empty TEST database takes --schema');
  if (!(await hasTable('journal_entry'))) die('the ledger tables (migrations b272–b274) are not in this database');
  /* the delivery function must honour the shop clock (b300) — else three years of bills would all be dated today */
  const fn = await sql(`SELECT pg_get_functiondef(to_regprocedure('chit_deliver(uuid,boolean,jsonb)')) AS d`).catch(() => ({ rows: [{ d: null }] }));
  if (!fn.rows[0] || !fn.rows[0].d) die('chit_deliver (migrations/migration_b50 · b142) is not in this database');
  if (fn.rows[0].d.indexOf("c->>'created_at'") < 0)
    die('chit_deliver does not honour the shop clock yet — run migrations/b300_chit_deliver_clock.sql on this local database (as postgres), then load');

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
      if (loaded === MARK && hasFlag('repair-e')) {
        /* Seed E repair: a period close the first run lost (the returns table was not ready under load) is made again, with the clock at the day after each period end; nothing else is touched */
        await startApi();
        const CLOCK = require(path.join(API, 'lib', 'shop-clock'));
        CLOCK.set(AT('2026-07-01', 9, 0));
        const signed = must(await callApi('/api/entities/verify', { method: 'POST', body: { email: EMAIL, otp: codeNow() } }), 'repair sign-in').b;
        let table = [];
        for (let tries = 0; tries < 6 && !table.length; tries++) {
          table = (await callApi('/api/books/returns?frequency=quarterly', { token: signed.token })).b.periods || [];
          if (!table.length) await new Promise((ok) => setTimeout(ok, 3000));
        }
        for (const due of table.filter((item) => String(item.end).slice(0, 10) <= '2026-06-30' && String(item.end).slice(0, 10) >= '2025-09-30')) {
          CLOCK.set(AT(dayAdd(String(due.end).slice(0, 10), 1), 8, 0));
          const closed = await callApi('/api/books/gst/close', { method: 'POST', token: signed.token, body: { period: due.period, frequency: 'quarterly' } });
          note('repair close ' + due.period + ' → HTTP ' + closed.status);
        }
        CLOCK.set(AT('2026-07-02', 9, 0));
        const year = await callApi('/api/books/year/2025-26/close', { method: 'POST', token: signed.token, body: {} });
        note('repair year close 2025-26 → HTTP ' + year.status + ' ' + JSON.stringify(year.b).slice(0, 160));
        if (SEED_E && FIRM) {
          CLOCK.set(AT('2026-07-03', 9, 0));
          await require('./seed/seed-e.cjs').firmPhase({ callApi, sql, token: signed.token, shopId, code: codeNow, firm: FIRM, firmName: arg('firm-name', 'Seed E Practice - demo'), say: note, topup: true }, Number(SEED_E));
        }
        process.exit(0);
      }
      if (loaded === MARK) {
        note('already loaded: ' + SHOP + ' holds ' + loaded + ' (' + nestedBills.rows[0].n + ' bills). Nothing written.');
        await proof(shopId, true);
        printLogin();
        process.exit(0);
      }
      if (loaded) die(SHOP + ' already holds ' + loaded + ' — a different seed/years. Rebuild with --fresh.');
      if (nestedBills.rows[0].n) die(SHOP + ' already has ' + nestedBills.rows[0].n + ' bills (an earlier run that did not finish?). Rebuild with --fresh.');
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
  must(await callApi('/api/entities/register', { method: 'POST', body: { email: EMAIL, display_name: NAME, user_id: SHOP } }), 'shop register');
  const verified = must(await callApi('/api/entities/verify', { method: 'POST', body: { email: EMAIL, otp: codeNow() } }), 'shop verify (is DEV_OTP armed?)');
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
      timezone: zoneOf(),
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
    BANK = codeOfRole('bank'),
    CAPITAL = codeOfRole('capital') || '3000';
  if (!CASH) die('the chart has no cash ledger (role cash) — enable answered ' + JSON.stringify(entity).slice(0, 200));
  const OPEN = (HIST && HIST.opening_minor) || {},
    OPEN_CASH = OPEN.cash || 50000000,
    OPEN_BANK = OPEN.bank || 20000000; /* default 500,000.00 + 200,000.00 (the MIS history shops); Seed E states its own */
  const opened = must(
    await callApi('/api/books/opening', {
      method: 'POST',
      token,
      body: {
        date: PLAN.start,
        client_ref: MARK,
        rows: MONTHS && BANK /* the history shop also holds a bank balance: its credit customer pays into it; its history file may state a smaller, believable opening (opening_minor) */
          ? [
              { code: CASH, dr_minor: OPEN_CASH },
              { code: BANK, dr_minor: OPEN_BANK },
              { code: CAPITAL, cr_minor: OPEN_CASH + OPEN_BANK }
            ]
          : [
              { code: CASH, dr_minor: 50000000 },
              { code: CAPITAL, cr_minor: 50000000 }
            ]
      }
    }),
    'opening balances'
  ).b;
  note('ledger on (' + entity.fiscal_year + ') · opening ' + (opened.entry_no || '') + (MONTHS && BANK ? ' cash ' + majorText(OPEN_CASH) + ' + bank ' + majorText(OPEN_BANK) + ' against capital' : ' cash 5,00,000 against capital') + ' · suspense ' + majorText(opened.suspense_minor || 0));

  /* 3 · parties, the counter, the shelf */
  const supplierNames = MONTHS ? PROFILE.suppliers || PLAN_LIB.DEFAULT_PROFILE.suppliers : [SUPPLIER]; /* the history shop buys from its profile's suppliers */
  let supplier;
  for (const name of supplierNames) {
    supplier = await callApi('/api/relationships/suppliers', { method: 'POST', token, body: { name } });
    if (supplier.status !== 409) must(supplier, 'supplier ' + name);
  }
  const customer = await callApi('/api/relationships/customers', { method: 'POST', token, body: { name: CUSTOMER, phone: SHOPROW.phone } });
  if (customer.status !== 409) must(customer, 'customer');
  const parties = (await sql(`SELECT identity_id, display_name FROM identities WHERE parent_entity_id = $1`, [shopId])).rows;
  const SUPPS = supplierNames.map((name) => (parties.find((item) => item.display_name === name) || {}).identity_id),
    SUPP = SUPPS[0],
    CUST = (parties.find((item) => item.display_name === CUSTOMER) || {}).identity_id;
  if (SUPPS.some((id) => !id) || !CUST) die('the parties were not minted: ' + JSON.stringify({ sup: supplier.b, cus: customer.b }).slice(0, 300));
  let counters = must(await callApi('/api/counters', { token }), 'counters').b.counters || [];
  if (!MONTHS && !counters.some((item) => item.id === TILL))
    counters = counters.concat([must(await callApi('/api/counters', { method: 'POST', token, body: { name: 'Counter 1' } }), 'add counter').b.counter]);
  const have = must(await callApi('/api/products?limit=500', { token }), 'list products').b;
  const rows = have.items || have.products || have.rows || [];
  const byName = new Map(rows.map((x) => [String((x.item_data || x).name || '').toLowerCase(), x.item_id || x.id]));
  const ITEMS = [];
  for (const [rate, name, unit, price, category, hsn] of MONTHS ? [] : SHELF) {
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
  note('supplier ' + supplierNames.join(', ') + ' · customer ' + CUSTOMER + ' · counter ' + TILL + ' · ' + ITEMS.length + ' products');

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
  /* a pack with a RETURN (AU BAS, AE VAT201) closes a tax PERIOD, not a month: the period table the shop's own GET /returns names, closed with { period } through the same
     POST /gst/close — and that close locks the months it covers (books-period.lockCovered). A month inside an open quarter waits for its quarter; the year close follows the last month. */
  /* GET /returns is the slowest read of a cold shop (a first read of 7 s to 19 s on a busy box; the api's statement timeout answers 500 and no table). A refused or empty table is read again, never taken
     for "no period is due" — that silent skip lost whole quarter closes and the year close after them (the 'lost quarter close'). Six tries, three seconds apart; then the last answer, and the RED line follows. */
  const returnsTable = async (frequency) => {
    let table;
    for (let tries = 0; tries < 6; tries++) {
      table = await callApi('/api/books/returns' + (frequency ? '?frequency=' + frequency : ''), { token });
      if (table.status === 200 && table.b && (table.b.periods || []).length) return table;
      await new Promise((ok) => setTimeout(ok, 3000));
    }
    console.log('   RED  GET /returns never gave the period table — HTTP ' + table.status);
    return table;
  };
  const closeReturnPeriod = async (periodDate, periodYear, periodMonth) => {
    CLOCK.set(AT(dayAdd(periodDate, 1), 8, 0)); /* the period has ended on the shop's clock */
    const frequency = COUNTRY === 'AU' ? 'quarterly' : undefined;
    const table = await returnsTable(frequency);
    const due = ((table.b && table.b.periods) || []).find((item) => String(item.end).slice(0, 10) === periodDate);
    if (!due) return; /* mid-period month: its period's close locks it */
    const closed = await callApi('/api/books/gst/close', { method: 'POST', token, body: Object.assign({ period: due.period }, frequency ? { frequency } : {}) });
    if (closed.status !== 200) console.log('   RED  ' + PACK.returns.id + ' close of ' + due.period + ' refused — HTTP ' + closed.status + ' ' + JSON.stringify(closed.b).slice(0, 260));
    else months += (closed.b.locked || []).length;
  };
  /* the books' rule (POST /year/:fy/close, 422 PERIOD_RETURN_OPEN): every BAS period of the year must be closed and every month locked, including a quarter that ENDS BEFORE the history begins (a
     history that starts mid-year, 84 months from 2019-11: FY 2019-20's Q1 Jul–Sep 2019 has no entry but is still 'open'). The loader follows the rule: it closes those empty leading periods, oldest first,
     before the year close — it never loosens the books. */
  const closeLeadingPeriods = async (periodYear) => {
    if (!RETURNS_PACK || COUNTRY !== 'AU') return;
    const table = await returnsTable('quarterly');
    const leading = ((table.b && table.b.periods) || []).filter((item) => item.closed === false && String(item.end).slice(0, 10) < PLAN.start && fyOf(String(item.end).slice(0, 10)) === periodYear);
    for (const due of leading) {
      CLOCK.set(AT(dayAdd(String(due.end).slice(0, 10), 1), 8, 0));
      const closed = await callApi('/api/books/gst/close', { method: 'POST', token, body: { period: due.period, frequency: 'quarterly' } });
      if (closed.status !== 200) console.log('   RED  ' + PACK.returns.id + ' close of the pre-history period ' + due.period + ' refused — HTTP ' + closed.status + ' ' + JSON.stringify(closed.b).slice(0, 260));
      else months += (closed.b.locked || []).length;
    }
  };
  const closeMonth = async (periodDate) => {
    await drain();
    const periodYear = fyOf(periodDate),
      periodMonth = monthNo(periodDate);
    if (RETURNS_PACK) await closeReturnPeriod(periodDate, periodYear, periodMonth);
    else {
      const closed = await callApi('/api/books/gst/close', { method: 'POST', token, body: { fy: periodYear, period: periodMonth } });
      if (closed.status !== 200) console.log('   RED  GST close of ' + periodYear + ' month ' + periodMonth + ' refused — ' + JSON.stringify(closed.b).slice(0, 200));
      const locked = await callApi('/api/books/periods/' + periodYear + '/' + periodMonth + '/lock', { method: 'POST', token, body: { reason: 'month done' } });
      if (locked.status !== 200) console.log('   RED  lock of ' + periodYear + ' month ' + periodMonth + ' refused — ' + JSON.stringify(locked.b).slice(0, 200));
      else months++;
    }
    if (periodMonth === 12) {
      await closeLeadingPeriods(periodYear);
      CLOCK.set(AT(dayAdd(periodDate, 1), 8, 0));
      const yearClosed = await callApi('/api/books/year/' + periodYear + '/close', { method: 'POST', token, body: {} });
      if (yearClosed.status !== 200) console.log('   RED  year close ' + periodYear + ' refused — ' + JSON.stringify(yearClosed.b).slice(0, 300));
      else note(periodYear + ' closed · ' + bills + ' bills so far · ' + Math.round((Date.now() - started) / 1000) + 's');
    }
  };
  /* the profile's BANK DIFFERENCE: a signed statement (POST /books/bank/statements) for the last locked month whose bank figure is off the books by bank_diff_minor — the
     reconciliation page then shows a difference to explain. Nothing is posted; a re-run finds the opening mark and never gets here. */
  const bankDifference = async (forKey, forDiff) => {
    const keys = [...new Set(PLAN.days.map((item) => item.day.slice(0, 7)))],
      key = forKey || keys[Math.max(0, keys.length - 3)],
      from = key + '-01',
      to = dayAdd(dayAdd(from, 31).slice(0, 7) + '-01', -1);
    const read = async (clause, day) =>
      Number(
        (
          await sql(
            `SELECT COALESCE(SUM(l.dr_minor - l.cr_minor), 0)::bigint AS n FROM journal_line l JOIN journal_entry e ON e.entry_id = l.entry_id JOIN ledger_account a ON a.account_id = l.account_id
              WHERE e.entity_id = $1 AND a.role = 'bank' AND e.posting_date ${clause} $2::date`,
            [shopId, day]
          )
        ).rows[0].n
      );
    const opening = await read('<', from),
      books = await read('<=', to),
      diff = forDiff === undefined ? PROFILE.bank_diff_minor : forDiff;
    const reply = await callApi('/api/books/bank/statements', {
      method: 'POST',
      token,
      body: { account: 'bank', period_from: from, period_to: to, opening_minor: opening, closing_bank_minor: books + diff, closing_books_minor: books, difference_minor: diff, currency: CURRENCY, file_hash: require('crypto').createHash('sha256').update('demo bank statement ' + SHOP + ' ' + key).digest('hex') }
    });
    if (reply.status === 201) note('bank statement ' + key + ' signed with a difference of ' + majorText(diff) + ' (bank ' + majorText(books + diff) + ' · books ' + majorText(books) + ')');
    else console.log('   RED  bank statement ' + key + ' refused — HTTP ' + reply.status + ' ' + JSON.stringify(reply.b).slice(0, 240));
  };
  if (MONTHS) {
    const seedE = SEED_E ? require('./seed/seed-e.cjs') : null, seedPlan = seedE ? seedE.plan(Number(SEED_E)) : null;
    /* Seed E: a client whose months stay open skips every period close from April 2026 on (the last quarter of the last FY and after) */
    const closeMonthE = seedPlan && !seedPlan.locks ? async (periodDate) => (periodDate >= '2026-04-01' ? undefined : closeMonth(periodDate)) : closeMonth;
    const made = await require('./sim-history.cjs').load({ API, path, PLAN, HIST, PACK, CURRENCY, TILL, taxRow, AT, dayAdd, callApi, books, closeMonth: closeMonthE, drain, CLOCK, CUST, SUPPS, shopId, token, months: MONTHS });
    bills = made.entries;
    note('history posted: ' + made.entries + ' entries · ' + made.refused + ' refused');
    if (PROFILE.bank_diff_minor) await bankDifference(PLAN.days[PLAN.days.length - 1].day);
    if (seedPlan) {
      if (seedPlan.bank === 'ok') await bankDifference('2026-06', 0);
      else if (seedPlan.bank === 'diff') await bankDifference('2026-06', -3500);
      if (FIRM) {
        CLOCK.set(AT(PLAN.days[PLAN.days.length - 1].day, 17, 0));
        await seedE.firmPhase({ callApi, sql, token, shopId, code: codeNow, firm: FIRM, firmName: arg('firm-name', 'Seed E Practice - demo'), say: note }, Number(SEED_E));
      }
      note('recorded_at stamped on ' + (await stampRecorded(pool, [shopId])) + ' entries (posting day, business hours; a few true exceptions)');
    }
    expenses = made.rent;
  } else for (let dayIx = 0; dayIx < PLAN.days.length; dayIx++) {
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
  if (!MONTHS) await closeMonth(PLAN.last); /* the history leaves its last two months open (loadHistory) */
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

/* ── the proof: SQL over what was written (reads only) — tools/sim-load-proof.cjs ── */
const proof = (shopId, quiet) =>
  require('./sim-load-proof.cjs').proof(
    {
      sql, WANT, PLAN, TILL, majorText, ZERO, AP, FYPACK, API, SHOPROW, YEARS, MONTHS,
      historyCtx: () => ({ API, path, PLAN, PROFILE, PROFILE_NAME, CUSTOMER, HEXPECT, CURRENCY, months: MONTHS, pool, sql, here: __dirname })
    },
    shopId,
    quiet
  );
const printLogin = () => require('./sim-load-proof.cjs').printLogin({ SHOP, EMAIL, LOGIN_CODE });