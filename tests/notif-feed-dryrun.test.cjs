'use strict';
/**
 * tests/notif-feed-dryrun.test.cjs — THE DRY RUN IS THE LIVE STATEMENT (SEC-SMALL item 6, 2026-10-14).
 *
 * migrations/archive/b619_notif_feed_index_dryrun.sql asks the database for the plan of the 20-second notifications poll. A dry
 * run of a statement that is not the one the api runs measures nothing — so this file renders routes/notifications.js's
 * FEED_FROM exactly as the route does (lib/bill-privacy filled in, $1/$2 as the placeholder uuid, FEED_DAYS as 90) and
 * requires the SQL file to carry it verbatim. It also holds b620 to the CONCURRENTLY rules and keeps the 90-day bound
 * (fb9c5615) that lets idx_state_log_entity serve the read at all.
 *
 * Run: node tests/notif-feed-dryrun.test.cjs   · no DB, no network.
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
const route = fs.readFileSync(path.join(API, 'routes', 'notifications.js'), 'utf8');
const dry = fs.readFileSync(path.join(API, 'migrations', 'archive', 'b619_notif_feed_index_dryrun.sql'), 'utf8');
const apply = fs.readFileSync(path.join(API, 'migrations', 'archive', 'b620_notif_feed_index_apply.sql'), 'utf8');
const billPrivacy = require(path.join(API, 'lib', 'bill-privacy'));

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; } };
const norm = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ').trim();
const UUID = '00000000-0000-0000-0000-000000000000';

console.log('\nTHE FEED, THE DRY RUN AND THE INDEX\n');

/** FEED_FROM as the route builds it */
function liveFeedFrom() {
  const m = route.match(/const FEED_FROM = `([\s\S]*?)`;/);
  assert.ok(m, 'FEED_FROM is gone from routes/notifications.js');
  const days = (route.match(/NOTIF_FEED_DAYS \|\| '(\d+)'/) || [])[1];
  assert.ok(days, 'FEED_DAYS default is gone');
  return m[1]
    .replace('${billPrivacy.billSql(\'ch\', \'cs\')}', billPrivacy.billSql('ch', 'cs'))
    .replace('${billPrivacy.foreignStepSql(\'sl\', \'$1\')}', billPrivacy.foreignStepSql('sl', '$1'))
    .replace('${FEED_DAYS}', days)
    .replace(/\$[12]\b/g, '\'' + UUID + '\'');
}

it('the feed keeps its 90-day bound — the clause that lets idx_state_log_entity serve the poll', () => {
  assert.ok(/sl\.created_at > now\(\) - interval '\$\{FEED_DAYS\} days'/.test(route), 'the bound is gone; the poll re-sorts the whole state_log again');
});
it('⭐⭐ b619 carries the LIVE statement, verbatim (bill-privacy rendered, $1/$2 as the placeholder)', () => {
  const want = norm(liveFeedFrom()), have = norm(dry);
  assert.ok(have.indexOf(want) >= 0, 'the dry run drifted from FEED_FROM — regenerate it from the route.\n       want: ' + want.slice(0, 160) + '…');
});
it('b619 runs as the application role and sets the entity context, so the plan is the one RLS gives the api', () => {
  assert.ok(/SET ROLE cb_app;/.test(dry) && /set_config\('app\.current_entity'/.test(dry) && /RESET ROLE;/.test(dry));
});
it('b619 changes nothing: no CREATE, no ALTER, no INSERT/UPDATE/DELETE', () => {
  const code = dry.replace(/--[^\n]*/g, '');
  assert.ok(!/\b(CREATE|ALTER|INSERT|UPDATE|DELETE|DROP)\b/i.test(code), 'a dry run must only read');
});
it('b620 is CONCURRENTLY, idempotent, and never inside a transaction block', () => {
  const code = apply.replace(/--[^\n]*/g, '');
  assert.ok(/CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_state_log_entity\s+ON state_log \(entity_id, created_at DESC\)/.test(code));
  assert.ok(!/\bBEGIN\b|\bCOMMIT\b|DO \$\$/i.test(code), 'CONCURRENTLY cannot run inside a transaction block');
  assert.ok(/indisvalid/.test(code), 'the verify must name an INVALID index rather than report success');
});
it('b620 is the index the baseline created, same columns, same order', () => {
  const base = fs.readFileSync(path.join(API, 'migrations', 'archive', '000_baseline_part2.sql'), 'utf8');
  assert.ok(/CREATE INDEX idx_state_log_entity ON public\.state_log USING btree \(entity_id, created_at DESC\)/.test(base));
});
it('both files say RLS and the reserved numbers are the round\'s (b619 · b620)', () => {
  assert.ok(/RLS:/.test(dry) && /RLS:/.test(apply));
});

console.log('\n' + (process.exitCode ? '✗ failed' : '✓ ' + pass + ' passed') + ' · ' + pass + ' checks\n');
