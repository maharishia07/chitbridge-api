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
const no = ['postgres://postgres:pw@db.bzacyrdrnzdbficjplcn.supabase.co:5432/postgres', 'postgres://postgres.ref:pw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres',
  'postgres://u:p@containers-us-west-1.railway.app:5432/railway', 'postgres://u:p@10.0.0.5:5432/cb', 'postgres://u:p@192.168.1.10/cb', 'postgres://u:p@localhost.evil.com/cb',
  'mysql://root@localhost/cb', 'http://localhost:5432', '', 'not a url', 'postgres://u:p@/cb'];
for (const u of yes) ok('accepts ' + u, L.localOnly(u).ok === true, JSON.stringify(L.localOnly(u)));
for (const u of no) ok('refuses ' + (u || '(empty)'), L.localOnly(u).ok === false, JSON.stringify(L.localOnly(u)));

/* 2 · the file says it, and writes through the doors */
const src = read('tools/sim-load.cjs');
ok('the header says LOCAL ONLY and names the hosts', /LOCAL ONLY/.test(src) && /localhost, 127\.0\.0\.1, ::1 or a bare\n? ?\*? ?docker service name/.test(src.replace(/\n \* /g, ' ')));
ok('the url is checked BEFORE anything connects (localOnly runs before the pool opens)', src.indexOf('localOnly(DB)') < src.indexOf('new Pool('));
const WRITE_RE = /\b(INSERT\s+INTO|UPDATE)\s+(chit_header|chit_detail|chit_status|journal_entry|journal_line|account_balance|party_item|identities|customer_list|supplier_list|catalogue_items|books_setting|fiscal_period)\b/i;
ok('no raw INSERT/UPDATE into a tenant table — bills, parties, products, the ledger all go through the app', !WRITE_RE.test(src), (WRITE_RE.exec(src) || [''])[0]);
ok('DATABASE_URL is set from --db before server.js loads (dotenv cannot redirect it)', src.indexOf('process.env.DATABASE_URL = DB') < src.indexOf("require(path.join(API, 'server.js'))"));
/* WX-O2C: --start moves the three years (default unchanged) and keeps the default's "already loaded" mark */
ok('--start feeds the plan (default 2026-04-01) and is refused unless it is a 1 April', /const START = String\(arg\('start', '2026-04-01'\)\)/.test(src) && /planDays\(\{ start: START,/.test(src) && /\^\\d\{4\}-04-01\$/.test(src));
ok('the default load keeps its old idempotency mark (a shop loaded before --start is still "already loaded")', /START === '2026-04-01' \? '' : '\/from-' \+ START/.test(src));
{ const bk = read('lib/books.js'), st = read('lib/books-store.js');
  ok('the ledger\'s first moment is read off the SAME clock as its year (books.enable at: CLOCK when simulated; saveSetting COALESCE($9, now()))',
    /at: CLOCK\.isSimulated && CLOCK\.isSimulated\(\) \? CLOCK\.now\(\)\.toISOString\(\) : null/.test(bk) && /COALESCE\(\$9::timestamptz, now\(\)\)/.test(st)); }
ok('a sealed NODE_ENV is refused', /isSealed\(\)\) die\(/.test(src));
ok('the schema step refuses a database that already has tables', /already has tables/.test(src));
ok('the shop walks the Country setup door (CS1) before the books open — never a raw write to identities / entity_governance', /\/api\/governance\/country-setup/.test(src) && src.indexOf('/api/governance/country-setup') < src.indexOf('/api/books/enable'));

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

/* 4 · one clock on the chit */
const chits = read('routes/chits.js'), mint = read('lib/mint.js'), b300 = read('migrations/b300_chit_deliver_clock.sql');
ok('routes/chits.js stamps a chit with the shop clock (CLOCK.now()), never new Date() for `now`', /const now = CLOCK\.now\(\)/.test(chits) && !/const now = new Date\(\)/.test(chits));
ok('…hands it to mint.header (created_at · sent_at)', /created_at: now, sent_at: now/.test(chits));
ok('…and the legacy in-transaction inserts use it too (no NOW(),NOW() on chit_header)', !/NOW\(\),NOW\(\)\)`/.test(chits) && /'sent', now\]/.test(chits) && /'received', now\]/.test(chits));
ok('lib/mint.js header carries created_at / sent_at when given, nothing when not', /created_at: isoOf\(x\.created_at\)/.test(mint) && /\.\.\.\(x\.created_at \?/.test(mint));
ok('migrations/b300 honours the copy\'s stamps and falls back to NOW()', /COALESCE\(NULLIF\(c->>'created_at', ''\)::timestamptz, NOW\(\)\)/.test(b300) && /COALESCE\(NULLIF\(c->>'sent_at', ''\)::timestamptz, NOW\(\)\)/.test(b300));
ok('b300 says who runs it and that RLS is unchanged', /NOT RUN/.test(b300) && /RLS: unchanged/.test(b300));
ok('the loader refuses a database whose chit_deliver predates b300, in words', /run migrations\/b300_chit_deliver_clock\.sql/.test(src));
/* M210 (b299): a naive timestamp is a UTC wall clock — the loader's own pool pins the session zone as db/index.js does, and the
   proof cuts the shop's day with books-hooks.zoneOf, never the process offset */
ok('the loader pins its session zone to UTC (M210), as db/index.js pins the api\'s', /SET TimeZone = 'UTC'/.test(src));
ok('the proof reads the SHOP\'s day (books-hooks.zoneOf), not the process offset', /zoneOf\(COUNTRY\)/.test(src) && /created_at::timestamptz AT TIME ZONE \$2/.test(src) && !/getTimezoneOffset/.test(src));
ok('the migration states the zone rule (an instant; UTC wall clock before b299, timestamptz after)', /b299_created_at_timestamptz/.test(b300) && /pins to UTC/.test(b300));
ok('no second b299 beside M210\'s two — the Y1b file is b300', !fs.existsSync(path.join(ROOT, 'migrations', 'b299_chit_deliver_clock.sql')) && fs.existsSync(path.join(ROOT, 'migrations', 'b300_chit_deliver_clock.sql')));

/* 5 · the schema step's skip list */
for (const f of ['b171a_customer_purge_DRYRUN.sql', 'b179_currency_envelope_dryrun.sql', 'b180_chit_status_pulse_index_verify.sql', 'purge_test_entities_1_LIST.sql', 'b194c_schema_visibility_backfill_commit.sql', 'READ-2026-10-09-product-field-survey.sql'])
  ok('schema step skips ' + f, L.CHAIN_SKIP.test(f));
for (const f of ['b272_books_ledger.sql', 'b300_chit_deliver_clock.sql', 'b179_currency_envelope_apply.sql']) ok('schema step applies ' + f, !L.CHAIN_SKIP.test(f));

console.log('\n' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + (pass + fail) + ' checks\n');
process.exit(fail ? 1 : 0);
