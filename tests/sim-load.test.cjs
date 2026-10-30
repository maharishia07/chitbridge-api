/**
 * sim-load.test.cjs — ⭐⭐⭐ THE SIMULATOR'S LOADER NEVER TOUCHES PRODUCTION (round Y1b). Offline; no database.
 *
 * Fails when:
 *   1. tools/sim-load.cjs accepts a --db whose host is not localhost / 127.0.0.1 / ::1 / a bare docker service name —
 *      a Supabase host, a Railway host, a pooler, a public IP, anything with a dot — or a non-postgres URL;
 *   2. its header stops saying so, or it grows a raw INSERT into a tenant table (every write goes through the app's doors);
 *   3. the plan is not shared: tools/simulate-years.cjs stops reading tools/sim-plan.cjs, or the plan stops being deterministic;
 *   4. the chit writer stops carrying the shop clock's moment (routes/chits.js `now` → lib/mint.js header → chit_deliver, b300),
 *      or b300 stops honouring it;
 *   5. the loader's schema step would run a dry-run, a verify or a data script.
 * Run: node tests/sim-load.test.cjs
 */
'use strict';
const CF = require('../tools/chits-files.cjs'); /* the ONE list of chits files (tools/chits-files.cjs) */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

console.log('\n══ sim-load: local only, one plan, one clock ══\n');

/* 1 · the rule, called */
const L = require(path.join(ROOT, 'tools', 'sim-load.cjs'));
ok('exports localOnly and CHAIN_SKIP when required (not run)', typeof L.localOnly === 'function' && L.CHAIN_SKIP instanceof RegExp);
const yes = ['postgres://postgres:pw@127.0.0.1:5432/cb_sim', 'postgresql://postgres:pw@localhost/cb', 'postgres://u:p@[::1]:5432/x', 'postgres://u:p@db:5432/cb', 'postgres://u:p@postgres/cb', 'postgres://u:p@cb-db_1/cb'];
const no = ['postgres://postgres:pw@db.example-host.supabase.co:5432/postgres', 'postgres://postgres.ref:pw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres',
  'postgres://u:p@containers-us-west-1.railway.app:5432/railway', 'postgres://u:p@10.0.0.5:5432/cb', 'postgres://u:p@192.168.1.10/cb', 'postgres://u:p@localhost.evil.com/cb',
  'mysql://root@localhost/cb', 'http://localhost:5432', '', 'not a url', 'postgres://u:p@/cb'];
for (const u of yes) ok('accepts ' + u, L.localOnly(u).ok === true, JSON.stringify(L.localOnly(u)));
for (const u of no) ok('refuses ' + (u || '(empty)'), L.localOnly(u, {}).ok === false, JSON.stringify(L.localOnly(u, {})));
/* HX2 · a test spin's database, and nothing else: the id must be set AND name the database; Supabase never */
const S = { CB_SPIN_ID: 's1a2b3c' }, rds = 'postgres://postgres:pw@cbspin-s1a2b3c.abc.ap-south-1.rds.amazonaws.com:5432/cbspin_s1a2b3c?sslmode=no-verify';
ok('a spin: the spin\'s own database on a cloud host is accepted', L.localOnly(rds, S).ok === true && L.localOnly(rds, S).spin === true);
ok('a spin: without CB_SPIN_ID the same URL is refused', L.localOnly(rds, {}).ok === false);
ok('a spin: another database name (postgres, railway, another spin) is refused', ['postgres', 'railway', 'cbspin_s9z9z9z', 'cbspin_s1a2b3c_x'].every((d) => L.localOnly(rds.replace(/\/cbspin_s1a2b3c\?/, '/' + d + '?'), S).ok === false));
ok('a spin: a Supabase host is refused even with the spin\'s name', L.localOnly('postgres://postgres:pw@db.ref.supabase.co:5432/cbspin_s1a2b3c', S).ok === false && L.localOnly('postgres://p:pw@aws-0-ap-south-1.pooler.supabase.com:6543/cbspin_s1a2b3c', S).ok === false);
ok('a spin: a malformed id (too short, capitals, symbols) opens nothing', ['s1', 'S1A2B3C', 's1a2b3c;', ''].every((id) => L.localOnly(rds.replace(/s1a2b3c/g, id), { CB_SPIN_ID: id }).ok === false));

/* 2 · the file says it, and writes through the doors */
const src = read('tools/sim-load.cjs');
ok('the header says LOCAL ONLY and names the hosts', /LOCAL ONLY/.test(src) && /localhost, 127\.0\.0\.1, ::1 or a bare\n? ?\*? ?docker service name/.test(src.replace(/\n \* /g, ' ')));
ok('the url is checked BEFORE anything connects (localOnly runs before the pool opens)', src.indexOf('localOnly(DB)') < src.indexOf('new Pool('));
const WRITE_RE = /\b(INSERT\s+INTO|UPDATE)\s+(chit_header|chit_detail|chit_status|journal_entry|journal_line|account_balance|party_item|identities|customer_list|supplier_list|catalogue_items|books_setting|fiscal_period)\b/i;
ok('no raw INSERT/UPDATE into a tenant table — bills, parties, products, the ledger all go through the app', !WRITE_RE.test(src), (WRITE_RE.exec(src) || [''])[0]);
ok('DATABASE_URL is set from --db before server.js loads (dotenv cannot redirect it)', src.indexOf('process.env.DATABASE_URL = DB') < src.indexOf("require(path.join(API, 'server.js'))"));
/* WX-O2C: --start moves the three years (default unchanged) and keeps the default's "already loaded" mark */
ok('--start feeds the plan (default the pack\'s first month of 2026) and is refused unless it is the first day of the pack\'s year', /const START_ARG = arg\('start', ''\)/.test(src) && /planDays\(\{ start: START,/.test(src) && /Number\(START\.slice\(5, 7\)\) !== PACK\.fiscalYear\.startMonth/.test(src));
ok('the default load keeps its old idempotency mark (a shop loaded before --start is still "already loaded")', /START_ARG \? '\/from-' \+ START : ''/.test(src));
{ const bk = read('lib/books.js'), st = read('lib/books-store.js');
  ok('the ledger\'s first moment is read off the SAME clock as its year (books.enable at: CLOCK when simulated; saveSetting COALESCE($9, now()))',
    /at: CLOCK\.isSimulated && CLOCK\.isSimulated\(\) \? CLOCK\.now\(\)\.toISOString\(\) : null/.test(bk) && /COALESCE\(\$9::timestamptz, now\(\)\)/.test(st)); }
ok('a sealed NODE_ENV is refused', /isSealed\(\)\)\s*die\(/.test(src));
/* HX1: the schema step is tools/migrate.cjs — a database with tables runs only what its ledger lacks, and one with an EMPTY ledger is left alone */
ok('the schema step is tools/migrate.cjs (one chain, with the ledger)', /require\('\.\/migrate\.cjs'\)\.apply\(DB/.test(src));
ok('migrate leaves a database with tables and an empty ledger alone', /has tables and ' \+\s*\(hadLedger \? 'its ledger is empty'/.test(fs.readFileSync(path.join(__dirname, '..', 'tools', 'migrate.cjs'), 'utf8')));
ok('--schema-only (HX0, the compose migrate job) is the same schema step and nothing else: no shop, no api', (() => {
  const body = (/async function schemaOnly\(\) \{([\s\S]*?)\n\}/.exec(src) || [])[1] || '';
  return /await applySchema\(\)/.test(body) && !/server\.js|startApi|\/api\//.test(body) && /if \(SCHEMA_ONLY\) return schemaOnly\(\)/.test(src);
})());
ok('the shop walks the Country setup door (CS1) before the books open — never a raw write to identities / entity_governance', /\/api\/governance\/country-setup/.test(src) && src.indexOf('/api/governance/country-setup') < src.indexOf('/api/books/enable'));
ok('CX0: the loader carries an IN, an AU and an AE shop, and reads currency · year · heads from the PACK (never a second table)',
   /const SHOPS = \{[\s\S]*?\bIN:[\s\S]*?\bAU:[\s\S]*?\bAE:/.test(src) && /packFor\(\s*COUNTRY\s*\)/.test(src) && /PACK\.currency/.test(src) && /PACK\.fiscalYear\.startMonth/.test(src)
   && /PACK\.taxHeads/.test(src) && !/COUNTRY === 'AU' \? 'AUD'/.test(src) && !/'\+05:30'\)/.test(src));
ok('…and the year and month number come from lib/accounts-packs (the function the books routes use), not a rule of its own', /AP\.fiscalYearOf\(/.test(src) && /AP\.periodOf\(/.test(src) && !/m >= 4 \? y : y - 1/.test(src));

/* 3 · one plan */
const P = require(path.join(ROOT, 'tools', 'sim-plan.cjs'));
const a = P.planDays({ start: '2026-04-01', years: 1, seed: 7 }), b = P.planDays({ start: '2026-04-01', years: 1, seed: 7 }), c = P.planDays({ start: '2026-04-01', years: 1, seed: 8 });
ok('the plan is deterministic per seed (seed 7 twice = the same days)', JSON.stringify(a) === JSON.stringify(b));
ok('…and another seed is another shop', JSON.stringify(a) !== JSON.stringify(c));
ok('a year is 365 days from 2026-04-01 to 2027-03-31', a.days.length === 365 && a.days[0].day === '2026-04-01' && a.days[364].day === '2027-03-31');
const cnt = P.countOf(a);
ok('countOf names bills · credit bills · purchases · expenses · days', cnt.bills > 700 && cnt.credit_bills > 0 && cnt.purchases > 0 && cnt.expenses >= 12 && cnt.days === 365, JSON.stringify(cnt));
ok('every sale is 2–4 a day at 5 / 12 / 18 %, paid cash · upi · credit', a.days.every((d) => d.sales.length >= 2 && d.sales.length <= 4 && d.sales.every((s) => [5, 12, 18].includes(s.rate) && ['cash', 'upi', 'credit'].includes(s.how) && s.taxable % 100 === 0)));
const sim = read('tools/simulate-years.cjs');
ok('tools/simulate-years.cjs reads the plan (sim-plan.cjs), not its own dice', /require\(path\.join\(__dirname, 'sim-plan\.cjs'\)\)/.test(sim) && !/function rng\(/.test(sim));
ok('…and sim-load.cjs reads the same plan', /require\(path\.join\(__dirname, 'sim-plan\.cjs'\)\)/.test(src));
/* 3b · WX-R2R: the shop's calendar is the pack's — a July start (AU) ends on 30 June, and the loader asks lib/accounts-packs for the year and the month, never its own April */
const au = P.planDays({ start: '2026-07-01', years: 1, seed: 7 });
ok('a July year is 365 days from 2026-07-01 to 2027-06-30', au.days.length === 365 && au.days[0].day === '2026-07-01' && au.last === '2027-06-30' && au.days[364].day === '2027-06-30');
ok('the loader takes the year and the month from lib/accounts-packs (fiscalYearOf · periodOf · fyRange), not an April of its own',
  /AP\.fiscalYearOf\(d, FYPACK\)/.test(src) && /AP\.periodOf\(d, FYPACK\)/.test(src) && /AP\.fyRange\(fy, FYPACK\)/.test(src) && !/m >= 4 \? y : y - 1/.test(src) && !/\+ 8\) % 12\) \+ 1/.test(src));
ok('the plan starts on the pack\'s first month (April IN · July AU · January AE)', /START_ARG \|\| '2026-' \+ String\(PACK\.fiscalYear\.startMonth\)/.test(src));
ok('a one-rate pack\'s basket draws at its standard rate (AU 10 % · AE 5 %), an IN basket from its slab', /item\.rate === rateOf\(rate\)/.test(src));

/* 4 · one clock on the chit */
const chits = CF.read(ROOT), mint = read('lib/mint.js'), b300 = read('migrations/archive/b300_chit_deliver_clock.sql');
ok('routes/chits.js stamps a chit with the shop clock (CLOCK.now()), never new Date() for `now`', /const now = CLOCK\.now\(\)/.test(chits) && !/const now = new Date\(\)/.test(chits));
ok('…hands it to mint.header (created_at · sent_at)', /created_at: now,\s*sent_at: now/.test(chits));
ok('…and the legacy in-transaction inserts use it too (no NOW(),NOW() on chit_header)', !/NOW\(\),NOW\(\)\)`/.test(chits) && /'sent',\s*now\s*\]/.test(chits) && /'received',\s*now\s*\]/.test(chits));
ok('lib/mint.js header carries created_at / sent_at when given, nothing when not', /created_at: isoOf\(x\.created_at\)/.test(mint) && /\.\.\.\(x\.created_at \?/.test(mint));
ok('migrations/b300 honours the copy\'s stamps and falls back to NOW()', /COALESCE\(NULLIF\(c->>'created_at', ''\)::timestamptz, NOW\(\)\)/.test(b300) && /COALESCE\(NULLIF\(c->>'sent_at', ''\)::timestamptz, NOW\(\)\)/.test(b300));
ok('b300 says who runs it and that RLS is unchanged', /NOT RUN/.test(b300) && /RLS: unchanged/.test(b300));
ok('the loader refuses a database whose chit_deliver predates b300, in words', /run migrations\/b300_chit_deliver_clock\.sql/.test(src));
/* M210 (b299): a naive timestamp is a UTC wall clock — the loader's own pool pins the session zone as db/index.js does, and the
   proof cuts the shop's day with books-hooks.zoneOf, never the process offset */
ok('the loader pins its session zone to UTC (M210), as db/index.js pins the api\'s', /SET TimeZone = 'UTC'/.test(src));
ok('the proof reads the SHOP\'s day (books-hooks.zoneOf), not the process offset', /zoneOf\(COUNTRY\)/.test(src) && /created_at::timestamptz AT TIME ZONE \$2/.test(src) && !/getTimezoneOffset/.test(src));
ok('the migration states the zone rule (an instant; UTC wall clock before b299, timestamptz after)', /b299_created_at_timestamptz/.test(b300) && /pins to UTC/.test(b300));
ok('no second b299 beside M210\'s two — the Y1b file is b300', !fs.existsSync(path.join(ROOT, 'migrations', 'b299_chit_deliver_clock.sql')) && fs.existsSync(path.join(ROOT, 'migrations', 'archive', 'b300_chit_deliver_clock.sql')));

/* 5 · the schema step's skip list */
for (const f of ['b171a_customer_purge_DRYRUN.sql', 'b179_currency_envelope_dryrun.sql', 'b180_chit_status_pulse_index_verify.sql', 'purge_test_entities_1_LIST.sql', 'b194c_schema_visibility_backfill_commit.sql', 'READ-2026-10-09-product-field-survey.sql'])
  ok('schema step skips ' + f, L.CHAIN_SKIP.test(f));
for (const f of ['b272_books_ledger.sql', 'b300_chit_deliver_clock.sql', 'b179_currency_envelope_apply.sql']) ok('schema step applies ' + f, !L.CHAIN_SKIP.test(f));

console.log('\n' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + (pass + fail) + ' checks\n');
process.exit(fail ? 1 : 0);
