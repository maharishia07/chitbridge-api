'use strict';
/**
 * tests/fx-dates-tz.test.cjs — A RATE'S DAY IS THE SAME DAY ON EVERY SERVER (local walk, 14 Oct 2026).
 * The owner saved a USD rate for 14 Oct; the database held 2026-10-14; the api answered 2026-10-13 on a server in India, because fx-rates
 * read the `date` column (node-pg builds it at LOCAL midnight) with its own toISOString(). The one reader is books-engines ymd
 * (tests/books-dates-tz.test.cjs). Runs itself under TZ=Asia/Kolkata, Australia/Sydney and UTC; all must answer 2026-10-14.
 */
const path = require('path');
const { spawnSync } = require('child_process');
if (!process.env.FX_TZ_CHILD) {
  let bad = 0, total = 0;
  for (const tz of ['Asia/Kolkata', 'Australia/Sydney', 'UTC', 'America/Los_Angeles']) {
    const r = spawnSync(process.execPath, [__filename], { encoding: 'utf8', timeout: 60000, env: Object.assign({}, process.env, { TZ: tz, FX_TZ_CHILD: tz }) });
    process.stdout.write(r.stdout || '');
    total += ((r.stdout || '').match(/^\s+(ok|FAIL)\s/mg) || []).length;
    if (r.status !== 0) { bad++; process.stdout.write(r.stderr || ''); }
  }
  /* the guard runner reads the LAST "<n> checks" (scripts/guards.cjs) */
  console.log('\n' + (bad ? '  ✗ FAIL — a zone moved the day' : '  ✓ every zone keeps the day') + ' · ' + total + ' checks');
  process.exit(bad ? 1 : 0);
}
const pgDate = require('pg').types.getTypeParser(1082);   /* what node-pg hands back for a `date` column */
const store = require(path.join(__dirname, '..', 'lib', 'books-store.js'));
const row = { rate_id: 7, rate_date: pgDate('2026-10-14'), from_ccy: 'USD', to_ccy: 'INR', rate: '83.2500000000', source: 'manual', source_ref: 'RBI', entered_by: null, created_at: null };
store.fxRatesReady = async () => true;
store.fxRates = async () => [row];
store.fxRateOn = async () => row;
const FX = require(path.join(__dirname, '..', 'lib', 'fx-rates.js'));
(async () => {
  const tz = process.env.FX_TZ_CHILD; let fail = 0;
  const listed = await FX.list(null, 'e', {});
  const on = await FX.rateOn(null, 'e', 'USD', 'INR', '2026-10-14');
  for (const [name, got] of [['list() date', listed[0] && listed[0].date], ['rateOn() date', on && on.date]]) {
    const ok = got === '2026-10-14'; if (!ok) fail++;
    console.log('   ' + (ok ? 'ok  ' : 'FAIL') + ' TZ=' + tz + ' · ' + name + ' = ' + got);
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
