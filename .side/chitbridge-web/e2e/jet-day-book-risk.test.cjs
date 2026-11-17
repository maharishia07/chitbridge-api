'use strict';
// @type: unit
/**
 * jet-day-book-risk.test.cjs - JET (ASA 240 journal-entry risk filters; ASA 560 "after year end"): hand-computed fixture run through the REAL books-grant-filters.js and engine/money.js. No browser, no api.
 * OWNS      7 entries of an Australian shop (period 1 Jul 2025 - 30 Jun 2026, zone Australia/Sydney, AEST +10 in June/July) and the counts each filter must give (below)
 * CALLED BY by hand: node e2e/jet-day-book-risk.test.cjs
 * CARD      04-network/ACC-176-AUDITOR-GRANT
 *
 * HAND-COMPUTED (Sydney local moment = recorded_at UTC + 10 h):
 *   id  posting     recorded (UTC)        Sydney                 amount (A$)  by    narration  days late
 *   E1  2026-06-30  2026-07-14 02:00      Tue 14 Jul 12:00       1,500.00     Ann   written    14
 *   E2  2026-06-15  2026-06-15 22:30      Tue 16 Jun 08:30         123.45     Bob   none        1   (the UTC day is the 15th: the zone moves the day)
 *   E3  2026-06-20  2026-06-20 13:00      Sat 20 Jun 23:00      10,000.00     Ann   written     0
 *   E4  2026-06-10  2026-06-10 19:30      Thu 11 Jun 05:30          1.00      Bob   none        1
 *   E5  2026-05-01  2026-07-20 00:00      Mon 20 Jul 10:00     50,000.00      Cara  written    80
 *   E6  2026-06-30  2026-06-30 13:30      Tue 30 Jun 23:30      7,777.00      Cara  written     0   (UTC says 1 Jul: NOT after the period end in the shop zone)
 *   E7  2026-07-05  2026-07-05 01:00      Sun  5 Jul 11:00        200.00      Ann   written     0   (dated after the period)
 *   Recorded after period end: E1 E5 E7 = 3 · over 7 days: E1 E5 = 2 · over 30: E5 = 1 · over 90: 0 · weekend: E3 E7 = 2 · after hours (before 07:00 / from 20:00): E3 E4 E6 = 3
 *   Multiple of 100 (A$): E1 E3 E5 E7 = 4 · of 1,000: E3 E5 = 2 · makers: Ann Bob Cara · no narration: E2 E4 = 2
 *   E8  2026-06-17  2026-06-17 00:00      Wed 17 Jun 10:00          5.50        -     written     0   (the clean row: trips nothing)
 *   RISK (six rules, one point each: after end · over 7 days late · weekend · after hours · round x100 · no narration): E1 3 (end, late, round) · E2 1 (narration) · E3 3 (weekend, night, round) · E4 2 (night, narration) · E5 3 (end, late, round) · E6 1 (night) · E7 3 (end, weekend, round) · E8 0 -> Any risk = 7 rows, sorted E1 E3 E5 E7 | E4 | E2 E6 | E8
 *   WEEKEND, a Fri+Sat region (zone Asia/Riyadh, +3): F1 Fri 3 Jul 12:00 (flag) · F2 Sat 4 Jul 12:00 (flag) · F3 Sun 5 Jul 12:00 (NOT flagged) · F4 recorded Thu 2 Jul 21:30 UTC = Fri 00:30 shop time (flag: the zone moves the day). With no region answer (the fallback) and in AU: F2 F3 flag, F1 F4 do not.
 *   Year end, recorded after it and dated inside the period: E1 E5 = 2 · dated after it: E7 = 1 · the range read for "dated after" = 1 Jul 2026 .. 1 Jul 2027
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
let failures = 0;
const check = (ok, msg) => { console.log((ok ? '  ok ' : '  FAIL ') + msg); if (!ok) failures++; };
const pub = (...p) => fs.readFileSync(path.join(__dirname, '..', 'public', ...p), 'utf8');
const box = { URLSearchParams, setTimeout, console, Intl };
box.window = box; box.globalThis = box; box.CB_SHOP_TZ = 'Australia/Sydney';
vm.createContext(box);
vm.runInContext(pub('engine', 'money.js'), box);
vm.runInContext(pub('app', 'books-grant-filters.js'), box);
const F = box.CBBooksGrantFilters;
const rows = [
  { id: 'E1', posting_date: '2026-06-30', recorded_at: '2026-07-14T02:00:00.000Z', amount_minor: 150000, made_by: 'Ann', no_narration: false },
  { id: 'E2', posting_date: '2026-06-15', recorded_at: '2026-06-15T22:30:00.000Z', amount_minor: 12345, made_by: 'Bob', no_narration: true },
  { id: 'E3', posting_date: '2026-06-20', recorded_at: '2026-06-20T13:00:00.000Z', amount_minor: 1000000, made_by: 'Ann', no_narration: false },
  { id: 'E4', posting_date: '2026-06-10', recorded_at: '2026-06-10T19:30:00.000Z', amount_minor: 100, made_by: 'Bob', no_narration: true },
  { id: 'E5', posting_date: '2026-05-01', recorded_at: '2026-07-20T00:00:00.000Z', amount_minor: 5000000, made_by: 'Cara', no_narration: false },
  { id: 'E6', posting_date: '2026-06-30', recorded_at: '2026-06-30T13:30:00.000Z', amount_minor: 777700, made_by: 'Cara', no_narration: false },
  { id: 'E7', posting_date: '2026-07-05', recorded_at: '2026-07-05T01:00:00.000Z', amount_minor: 20000, made_by: 'Ann', no_narration: false },
  { id: 'E8', posting_date: '2026-06-17', recorded_at: '2026-06-17T00:00:00.000Z', amount_minor: 550, made_by: '', no_narration: false }
];
const period = { from: '2025-07-01', to: '2026-06-30' };
const filters = F.filtersFor(null, { period: () => period, currency: () => 'AUD', rows: () => rows });
const by = (key) => filters.find((f) => f.key === key);
const ids = (key, v) => rows.filter((r) => by(key).match(r, v)).map((r) => r.id).join(' ');

// the Risk column and the Any risk filter
const riskOf = (r) => F.riskOf(r, period, 'AUD').length;
check(rows.map(riskOf).join(',') === '3,1,3,2,3,1,3,0', 'Risk counts E1..E8 = 3,1,3,2,3,1,3,0 (hand-computed above)');
check(ids('risk', 'any') === 'E1 E2 E3 E4 E5 E6 E7', 'Any risk keeps E1..E7 and not the clean E8');
check(rows.slice().sort((a, b) => riskOf(b) - riskOf(a)).map((r) => r.id).join(' ').replace(/ E1 E3 E5 E7/, '') !== '' && rows.slice().sort((a, b) => riskOf(b) - riskOf(a) || a.id.localeCompare(b.id)).map((r) => r.id).join(' ') === 'E1 E3 E5 E7 E4 E2 E6 E8', 'sorted by count: E1 E3 E5 E7 | E4 | E2 E6 | E8');
check(F.riskOf(rows[2], period, 'AUD').join('|') === 'At a weekend|After hours|Round sum', 'E3 trips weekend, after hours, round sum, said in words');
check(ids('rec', 'afterend') === 'E1 E5 E7', 'Recorded after period end: E1 E5 E7 (E6 recorded 23:30 Sydney on 30 Jun is inside, though UTC says 1 Jul)');
check(ids('rec', 'late7') === 'E1 E5' && ids('rec', 'late30') === 'E5' && ids('rec', 'late90') === '', 'Over 7 / 30 / 90 days late: E1 E5 · E5 · none');
check(ids('time', 'weekend') === 'E3 E7', 'Weekend (shop time): E3 (Sat 23:00) and E7 (Sun)');
check(ids('time', 'night') === 'E3 E4 E6', 'After hours: E3 23:00 · E4 05:30 · E6 23:30');
check(ids('round', '100') === 'E1 E3 E5 E7' && ids('round', '1000') === 'E3 E5', 'Round sum, A$: multiple of 100 = E1 E3 E5 E7 · of 1,000 = E3 E5');
check(F.round(rows[0], 1000, 'JPY') === true && F.round(rows[0], 1000, 'AUD') === false, 'the currency decides what a minor unit is: 150000 is Y150,000 (round to 1,000) but A$1,500.00 (not)');
check(ids('by', 'Ann') === 'E1 E3 E7' && ids('by', 'Bob') === 'E2 E4' && ids('by', 'Cara') === 'E5 E6', 'Made by: Ann 3 · Bob 2 · Cara 2');
check(JSON.stringify(by('by').options().map((o) => o.v)) === '["Ann","Bob","Cara"]', 'the Made by choices are the people on the page, sorted');
check(ids('narr', 'none') === 'E2 E4', 'Narration none written: E2 E4');
check(ids('ye', 'recorded') === 'E1 E5' && ids('ye', 'dated') === 'E7', 'Year end: recorded after it, dated inside = E1 E5 · dated after it = E7');
check(ids('ye', 'recorded').split(' ').every((x) => ids('rec', 'afterend').split(' ').indexOf(x) >= 0), 'one definition: Year end "recorded after" is a subset of Recorded "after period end" (same afterEnd)');
check(JSON.stringify(F.afterRange(period)) === '{"from":"2026-07-01","to":"2027-07-01"}' && F.afterRange(null) === null, 'the range read for "dated after it": 1 Jul 2026 to 1 Jul 2027');
check(F.daysLate({ posting_date: '2026-06-30' }) === 0 && F.weekend({}) === false && F.afterHours({ recorded_at: 'nonsense' }) === false, 'a row with no recorded moment (or a bad one) is never flagged');
box.CB_SHOP_TZ = 'Not/AZone';
check(typeof F.weekend(rows[2]) === 'boolean', 'an unknown shop zone falls back to the viewer zone and never throws');
box.CB_SHOP_TZ = 'Australia/Sydney';
const keys = ['mark', 'ev', 'risk', 'rec', 'time', 'round', 'by', 'narr', 'ye', 'kind'];
check(JSON.stringify(filters.map((f) => f.key)) === JSON.stringify(keys), 'the Day book filters, in order: ' + keys.join(' '));
const all = { mark: 'notchecked', ev: 'flag', kind: 'Other', rec: 'afterend', time: 'weekend', round: '100', by: 'Ann', narr: 'none', ye: 'dated' };
const addr = F.toAddress(all);
check(addr === 'dbf_mark=notchecked&dbf_ev=flag&dbf_kind=Other&dbf_rec=afterend&dbf_time=weekend&dbf_round=100&dbf_by=Ann&dbf_narr=none&dbf_ye=dated' && JSON.stringify(F.fromAddress('?' + addr)) === JSON.stringify(all), 'each filter has its own address word, and the address gives the same choices back');
check(F.paramNames().length === 11 && F.paramNames().indexOf('dbf_risk') >= 0 && F.paramNames().indexOf('dbf_ye') >= 0 && F.paramNames().indexOf('dbf_flag') >= 0, 'paramNames names all eleven address words, dbf_risk and dbf_flag included (the page wipes them from one list)');
check(F.carry('?open=c1&view=daybook&dbf_rec=afterend', 'c1') === '&dbf_rec=afterend' && F.carry('?open=c1&dbf_rec=afterend', 'c2') === '', 'a new filter rides to the same client only');
// the ONE weekend answer: the region's rest days, Sat+Sun only as the fallback
const fri = [
  { id: 'F1', recorded_at: '2026-07-03T09:00:00.000Z' }, { id: 'F2', recorded_at: '2026-07-04T09:00:00.000Z' },
  { id: 'F3', recorded_at: '2026-07-05T09:00:00.000Z' }, { id: 'F4', recorded_at: '2026-07-02T21:30:00.000Z' }
];
const weekendIds = () => fri.filter((r) => F.weekend(r)).map((r) => r.id).join(' ');
box.CB_SHOP_TZ = 'Asia/Riyadh';
check(box.CBLocale === undefined && weekendIds() === 'F2 F3', 'no region answer: the fallback is Sat + Sun (F2 F3)');
box.CBLocale = { weekInfo: () => ({ firstDay: 6, weekend: [5, 6], minimalDays: 1 }) };
check(weekendIds() === 'F1 F2 F4', 'a Fri+Sat region flags Friday (F1, and F4 = Fri 00:30 shop time) and Saturday, NOT Sunday (F3)');
box.CBLocale = { weekInfo: () => ({ weekend: [6, 7] }) };
check(weekendIds() === 'F2 F3', 'an AU region (Sat+Sun) flags F2 F3 only');
box.CBLocale = { weekInfo: () => null };
check(weekendIds() === 'F2 F3', 'a reader that answers nothing falls back to Sat + Sun');
// the SHOP's country decides (the audited entity's calendar), never the viewer's chosen locale: the real reader, widened to take a region
const locSrc = pub('engine', 'locale.js');
check(locSrc.indexOf('weekInfo: function (region)') > 0, 'CBLocale.weekInfo takes a region (one reader, widened, not copied)');
const reader = (viewer) => (region) => { const l = new Intl.Locale(/^[A-Za-z]{2}$/.test(region || '') ? 'en-' + String(region).toUpperCase() : viewer); return typeof l.getWeekInfo === 'function' ? l.getWeekInfo() : l.weekInfo; };
const sat = [{ id: 'Fri', recorded_at: '2026-07-03T09:00:00.000Z' }, { id: 'Sat', recorded_at: '2026-07-04T09:00:00.000Z' }, { id: 'Sun', recorded_at: '2026-07-05T09:00:00.000Z' }];
const flagged = (region) => sat.filter((r) => F.weekend(r, region)).map((r) => r.id).join('+');
box.CB_SHOP_TZ = 'UTC';
box.CBLocale = { weekInfo: reader('en-IN') };
check(flagged('AU') === 'Sat+Sun', 'viewer en-IN + AU shop: Sat + Sun flagged (got ' + flagged('AU') + ')');
check(flagged() === 'Sun', 'no shop country known: the viewer en-IN (Sunday alone) stands');
box.CBLocale = { weekInfo: reader('en-AU') };
check(flagged('SA') === 'Fri+Sat', 'viewer en-AU + SA shop: Fri + Sat flagged (got ' + flagged('SA') + ')');
check(flagged('AE') === 'Sat+Sun', 'AE shop: Sat + Sun since the 2022 change (got ' + flagged('AE') + ')');
check(flagged('IN') === 'Sun', 'IN shop: Sunday alone (got ' + flagged('IN') + ')');
const ctxFilters = F.filtersFor(null, { period: () => period, currency: () => 'AUD', region: () => 'SA', rows: () => sat });
check(sat.filter((r) => ctxFilters.find((f) => f.key === 'time').match(r, 'weekend')).map((r) => r.id).join('+') === 'Fri+Sat', 'the Made filter follows the shop region from the view ctx');
check(F.riskOf({ id: 'x', recorded_at: '2026-07-03T09:00:00.000Z', posting_date: '2026-07-03', amount_minor: 12345, made_by: 'a' }, period, 'AUD', 'SA').indexOf('At a weekend') >= 0 && F.riskOf({ id: 'x', recorded_at: '2026-07-03T09:00:00.000Z', posting_date: '2026-07-03', amount_minor: 12345 }, period, 'AUD', 'AU').indexOf('At a weekend') < 0, 'the Risk count follows the shop region (Friday risky in SA, not in AU)');
const view = pub('app', 'books-grant-view.js') + ['reports', 'cells', 'marks', 'list'].map((part) => pub('app', 'books-grant-' + part + '.js')).join('\n');
/* fb9f8fb2 (decided 17 Nov): the Day book opens in book order, not risk-first; Risk stays the one column the reader sorts, most risks first on a press (dir0 -1) */
check(view.indexOf('sortDefault') < 0 && view.indexOf("sort: column[2] === 'risk' ? true") > 0 && view.indexOf("dir0: column[2] === 'risk' ? -1") > 0, 'the Day book opens in book order; a press on Risk sorts most risks first');
delete box.CBLocale; box.CB_SHOP_TZ = 'Australia/Sydney';
const src = pub('app', 'books-grant-filters.js');
check(!/'Sat'|"Sat"/.test(src), 'no second weekend definition: Sat and Sun appear only in the ISO_DOW name table and the [6, 7] fallback (no quoted day names)');
check(!/fetch\(|XMLHttpRequest|\.range\s*=/.test(src), 'the filters file reads and compares only: no call out, no write to the period');
console.log(failures ? '\nFAILED ' + failures : '\nall passed');
process.exit(failures ? 1 : 0);
