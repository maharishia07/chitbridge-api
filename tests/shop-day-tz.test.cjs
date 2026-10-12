/**
 * shop-day-tz.test.cjs — A SALE AT MIDNIGHT LANDS IN THE SHOP'S DAY ON EVERY SERVER CLOCK, BEFORE AND AFTER b301 (M210).
 *
 * chit_header.created_at is `timestamp WITHOUT time zone` until b301 converts it. The database stamps now() in ITS zone, node-pg
 * read the value back in the SERVER's zone, and the shop's day was cut from that — right only while both clocks were UTC. A
 * 00:05 IST sale on a server in India closed in the previous day; a 23:55 IST sale on a DB in India closed in the next.
 *
 * ⚠️ PURE, NO DATABASE. The value is put through pg's OWN column parsers — 1114 (naive, as db/index.js now registers it) and
 * 1184 (timestamptz, what the column becomes) — so the ledger reads exactly what a database hands it, both before and after.
 * ⚠️ THE TEST RUNS ITSELF TWICE — TZ=UTC and TZ=Asia/Kolkata — and both must give the same answers.
 * ⚠️ Australia/Sydney across its DST change (first Sunday of October — 2026-10-04 is a 23-hour day) is the AU1 follow-up's case.
 *
 * Run: node tests/shop-day-tz.test.cjs
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const API = path.join(__dirname, '..');

if (!process.env.SHOP_DAY_TZ_CHILD) {
  /* ── the parent: the same checks under two server zones; the answers must be identical ── */
  let total = 0, bad = 0; const answers = {};
  for (const tz of ['UTC', 'Asia/Kolkata']) {
    const r = spawnSync(process.execPath, [__filename], { encoding: 'utf8', timeout: 60000, env: Object.assign({}, process.env, { TZ: tz, SHOP_DAY_TZ_CHILD: tz }) });
    const out = (r.stdout || '') + (r.stderr || '');
    console.log('\n══ TZ=' + tz + ' ══');
    console.log(out.split('\n').filter((l) => /^\s+(ok|FAIL)|threw|offset/.test(l)).join('\n'));
    const m = /(\d+) passed, (\d+) failed/.exec(out);
    if (!m || r.status !== 0) bad++;
    if (m) { total += Number(m[1]) + Number(m[2]); if (Number(m[2])) bad++; }
    const a = /ANSWERS (.*)/.exec(out); answers[tz] = a ? a[1] : null;
  }
  const same = answers.UTC && answers.UTC === answers['Asia/Kolkata'];
  if (!same) { bad++; console.log('\n  FAIL the two server zones gave different days:\n    UTC          ' + answers.UTC + '\n    Asia/Kolkata ' + answers['Asia/Kolkata']); }
  console.log('\n' + (bad ? '  ✗ FAIL — a server clock changed a shop day' : '  ✓ both server zones agree, before and after b301') + ' · ' + total + ' checks\n');
  process.exit(bad ? 1 : 0);
}

/* ── the child: one server zone ── */
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

console.log('   offset ' + new Date(2026, 9, 12).getTimezoneOffset() + ' min (TZ=' + process.env.TZ + ')');
const pg = require('pg');
require(path.join(API, 'db'));                                   /* registers the naive-timestamp parser and the UTC input dates */
const H = require(path.join(API, 'lib', 'books-hooks'));
const naive = pg.types.getTypeParser(1114, 'text');             /* what a `timestamp without time zone` column hands the ledger */
const withTz = pg.types.getTypeParser(1184, 'text');            /* what the column hands it after b301 */
const iso = (d) => (d instanceof Date ? d.toISOString() : String(d));
const answers = [];

/* ── the driver: the premise ── */
eq('a naive timestamp reads as UTC whatever the server clock (pg parser 1114)', iso(naive('2026-10-11 18:35:00')), '2026-10-11T18:35:00.000Z');
eq('…with fractional seconds too', iso(naive('2026-10-11 18:35:00.123456')), '2026-10-11T18:35:00.123Z');
eq('…and the timestamptz parser is untouched (an offset is honoured)', [iso(withTz('2026-10-11 18:35:00+00')), iso(withTz('2026-10-12 00:05:00+05:30'))], ['2026-10-11T18:35:00.000Z', '2026-10-11T18:35:00.000Z']);
ok('infinity still parses as infinity', naive('infinity') === Infinity && naive('-infinity') === -Infinity);
const prep = require(path.join(API, 'node_modules', 'pg', 'lib', 'utils')).prepareValue(new Date('2026-10-11T18:35:00Z'));
eq('a Date parameter is SENT as a UTC wall clock, never the server\'s local clock', prep, '2026-10-11T18:35:00.000+00:00');
const dbSrc = fs.readFileSync(path.join(API, 'db', 'index.js'), 'utf8');
ok('the session zone is pinned to UTC — on connect and SET LOCAL inside BEGIN (the same trips)', /SET TimeZone = 'UTC'/.test(dbSrc) && /BEGIN; SET LOCAL/.test(dbSrc) && /setTypeParser\(1114/.test(dbSrc) && /parseInputDatesAsUTC = true/.test(dbSrc));

/* ── the two midnight cases × (column without tz, with tz) — the shop is in India ── */
const shop = { timezone: 'Asia/Kolkata', country: 'IN' };
const cases = [
  { name: '00:05 IST on 12 Oct (18:35 UTC the 11th) — a server in India put it on the 11th', naive: '2026-10-11 18:35:00', tz: '2026-10-11 18:35:00+00', day: '2026-10-12' },
  { name: '23:55 IST on 11 Oct (18:25 UTC) — a DB in India put it on the 12th',             naive: '2026-10-11 18:25:00', tz: '2026-10-11 18:25:00+00', day: '2026-10-11' },
];
for (const c of cases) {
  const before = H.dayOf(naive(c.naive), shop), after = H.dayOf(withTz(c.tz), shop), raw = H.dayOf(c.naive, shop);
  eq(c.name + ' · column WITHOUT tz (before b301)', before, c.day);
  eq('…column WITH tz (after b301)', after, c.day);
  eq('…the raw naive string, had it reached the rule unparsed', raw, c.day);
  const b = H.dayBounds(c.day, shop), at = iso(withTz(c.tz));
  ok('…and the day close window of ' + c.day + ' holds it (' + b.from + ' ≤ ' + at + ' < ' + b.to + ')', b.from <= at && at < b.to);
  answers.push(before, after, raw, b.from, b.to);
}
eq('the shop day of 12 Oct in India is 18:30Z to 18:30Z', H.dayBounds('2026-10-12', 'IN'), { from: '2026-10-11T18:30:00.000Z', to: '2026-10-12T18:30:00.000Z' });

/* ── the zone a caller hands over: a setting row, an identity row, a country, an IANA name, nothing ── */
eq('the setting row carries the zone (identities.timezone); its country is the fallback', [H.zoneOf({ timezone: 'Australia/Sydney', country: 'AU' }), H.zoneOf({ timezone: null, country: 'AE' }), H.zoneOf({})], ['Australia/Sydney', 'Asia/Dubai', 'Asia/Kolkata']);
eq('a country code is its single zone, as b176 guessed it; nothing is India', [H.zoneOf('IN'), H.zoneOf('ae'), H.zoneOf(undefined), H.zoneOf('UTC')], ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Kolkata', 'UTC']);
eq('an unknown zone name does not throw — it falls back to India', H.dayOf('2026-10-11T18:35:00Z', 'Mars/Olympus'), '2026-10-12');
eq('the old callers still read: dayOf(moment, country), a Date or a string, a bare day, nothing', [H.dayOf(new Date('2026-09-28T20:00:00Z'), 'IN'), H.dayOf('2026-09-28T20:00:00Z', 'IN'), H.dayOf('2026-09-28T17:00:00.500Z', 'IN'), H.dayOf('2026-04-01', 'IN'), H.dayOf(null, 'IN'), H.dayOf('nope', 'IN')], ['2026-09-29', '2026-09-29', '2026-09-28', '2026-04-01', null, null]);
eq('Dubai is +04:00, not India\'s +05:30', [H.dayOf('2026-10-11T19:30:00Z', 'AE'), H.dayOf('2026-10-11T20:30:00Z', 'AE')], ['2026-10-11', '2026-10-12']);

/* ── Australia/Sydney across the DST change (first Sunday of October: 2026-10-04, 02:00 AEST → 03:00 AEDT) ── */
const syd = { timezone: 'Australia/Sydney', country: 'AU' };
eq('Sydney, the night before the change (+10): 23:55 is the 3rd, 00:05 is the 4th', [H.dayOf('2026-10-03T13:55:00Z', syd), H.dayOf('2026-10-03T14:05:00Z', syd)], ['2026-10-03', '2026-10-04']);
eq('Sydney, the night after the change (+11): 23:55 is the 4th, 00:05 is the 5th', [H.dayOf('2026-10-04T12:55:00Z', syd), H.dayOf('2026-10-04T13:05:00Z', syd)], ['2026-10-04', '2026-10-05']);
eq('the day of the change is 23 hours long — its close window ends at the NEXT midnight, not +24h', H.dayBounds('2026-10-04', syd), { from: '2026-10-03T14:00:00.000Z', to: '2026-10-04T13:00:00.000Z' });
eq('…the day after is a plain 24 hours at +11', H.dayBounds('2026-10-05', syd), { from: '2026-10-04T13:00:00.000Z', to: '2026-10-05T13:00:00.000Z' });
eq('…and the April change back (2027-04-04) is a 25-hour day', H.dayBounds('2027-04-04', syd), { from: '2027-04-03T13:00:00.000Z', to: '2027-04-04T14:00:00.000Z' });
eq('a naive column value on the change night still cuts by Sydney\'s clock', [H.dayOf(naive('2026-10-03 13:55:00'), syd), H.dayOf(naive('2026-10-03 14:05:00'), syd), H.dayOf(naive('2026-10-04 12:55:00'), syd), H.dayOf(naive('2026-10-04 13:05:00'), syd)], ['2026-10-03', '2026-10-04', '2026-10-04', '2026-10-05']);
for (const d of ['2026-10-03', '2026-10-04', '2026-10-05', '2027-04-04']) { const b = H.dayBounds(d, syd); answers.push(b.from, b.to); ok('every moment of ' + d + ' in Sydney reads as ' + d, H.dayOf(b.from, syd) === d && H.dayOf(new Date(Date.parse(b.to) - 1000), syd) === d && H.dayOf(b.to, syd) !== d); }

console.log('   ANSWERS ' + answers.join('|'));
console.log('\n   ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
