/**
 * books-report-period-week.test.cjs — MIS A0: periodOf 'week' (Monday-start ISO week to today) and 'mtd', priorOf how:'week' (same ISO week last year, same weekdays; null for week 53), knownPreset,
 * and books-practice.yoyDates now calling periodOf + priorOf with NO change of output (compared with the old hand-written rule over every day of 8 years x every FY start month).
 * Pure: no database, no clock. Run: node tests/books-report-period-week.test.cjs
 */
'use strict';
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';
const RP = require('../lib/books-report-period');
let pass = 0, fail = 0;
const t = (name, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want); if (a === b) pass++; else { fail++; console.log('   FAIL ' + name + '\n     got  ' + a + '\n     want ' + b); } };
const week = (today, step) => RP.periodOf({ preset: 'week', step }, today, 7);
/* the week: Tuesday 17 Nov 2026 → Monday 16 to today */
t('week: Tue 17 Nov 2026 runs Mon 16 → Tue 17', week('2026-11-17'), { preset: 'week', step: 0, from: '2026-11-16', to: '2026-11-17', can_next: false });
t('week: a Monday is a one-day week', [week('2026-11-16').from, week('2026-11-16').to], ['2026-11-16', '2026-11-16']);
t('week: a Sunday closes the week (Mon 9 → Sun 15 Nov a step back is whole)', [week('2026-11-17', -1).from, week('2026-11-17', -1).to, week('2026-11-17', -1).can_next], ['2026-11-09', '2026-11-15', true]);
t('week across 30 June (Tue): Mon 29 Jun → 30 Jun; last year the same ISO week 27 = Mon 30 Jun 2025 → Tue 1 Jul', [week('2026-06-30'), RP.priorOf(week('2026-06-30'), 'week')], [{ preset: 'week', step: 0, from: '2026-06-29', to: '2026-06-30', can_next: false }, { from: '2025-06-30', to: '2025-07-01' }]);
t('week across 1 Jan: Sun 3 Jan 2027 is the end of 2026 week 53 (Mon 28 Dec)', [week('2027-01-03').from, RP.isoWeekOf(week('2027-01-03').from)], ['2026-12-28', { year: 2026, week: 53 }]);
t('week 53 has no week last year (2025 has 52): priorOf is null, never a wrong week', RP.priorOf(week('2027-01-03'), 'week'), null);
t('week 53 of 2020 → null as well', RP.priorOf(week('2020-12-31'), 'week'), null);
t('week 1 of 2026 (Mon 29 Dec 2025 holds 1 Jan 2026) compares with week 1 of 2025 (Mon 30 Dec 2024)', [RP.isoWeekOf('2025-12-29'), RP.priorOf({ from: '2025-12-29', to: '2026-01-02' }, 'week')], [{ year: 2026, week: 1 }, { from: '2024-12-30', to: '2025-01-03' }]);
t('week over 29 Feb 2028 (Tue): Mon 28 Feb → 29 Feb; last year is ISO week 9 of 2027, Mon 1 Mar → Tue 2 Mar', [week('2028-02-29').from, RP.priorOf(week('2028-02-29'), 'week')], ['2028-02-28', { from: '2027-03-01', to: '2027-03-02' }]);
t('weekday alignment: every prior week starts on a Monday and keeps the span, for 400 weeks', (() => { let bad = 0; for (let i = 0; i < 400; i++) { const today = RP.priorOf({ from: '2019-01-07', to: '2019-01-07' }, 'period'); const d = new Date(Date.UTC(2019, 0, 7 + i * 7 + 2)).toISOString().slice(0, 10); const r = week(d), p = RP.priorOf(r, 'week'); if (p && (RP.isoWeekday(p.from) !== 1 || Date.parse(p.to) - Date.parse(p.from) !== Date.parse(r.to) - Date.parse(r.from))) bad++; void today; } return bad; })(), 0);
/* month to date */
t('mtd: 17 Nov → 1 Nov to 17 Nov; a step back is the whole of October', [RP.periodOf({ preset: 'mtd' }, '2026-11-17', 7), RP.periodOf({ preset: 'mtd', step: -1 }, '2026-11-17', 7)], [{ preset: 'mtd', step: 0, from: '2026-11-01', to: '2026-11-17', can_next: false }, { preset: 'mtd', step: -1, from: '2026-10-01', to: '2026-10-31', can_next: true }]);
t('mtd on 1 July (a one-day year start for the FY): 1 July → 1 July', [RP.periodOf({ preset: 'mtd' }, '2027-07-01', 7).from, RP.periodOf({ preset: 'mtd' }, '2027-07-01', 7).to], ['2027-07-01', '2027-07-01']);
t('mtd on 29 Feb 2028 against last year the same dates: 1 Feb → 29 Feb vs 1 Feb → 28 Feb 2027', RP.priorOf(RP.periodOf({ preset: 'mtd' }, '2028-02-29', 7), 'year'), { from: '2027-02-01', to: '2027-02-28' });
/* the words */
t('knownPreset: week and mtd are known with the old four; anything else is not (the MIS route answers 400, never the silent year to date)', ['ytd', 'month', 'quarter', 'year', 'week', 'mtd', 'weekly', '', undefined].map(RP.knownPreset), [true, true, true, true, true, true, false, false, false]);
t('the P&L is untouched: an unknown preset is still the year to date, and the four presets list is unchanged', [RP.periodOf({ preset: 'bogus' }, '2026-11-17', 7).preset, RP.PRESETS.map((x) => x[0])], ['ytd', ['ytd', 'month', 'quarter', 'year']]);
/* yoyDates: same output as the hand-written rule it replaced */
const oldYoy = (today, fyMonth) => { const year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7)), startYear = month >= fyMonth ? year : year - 1, pad = (n) => (n < 10 ? '0' : '') + n; const back = (today.slice(5) === '02-29' ? '02-28' : today.slice(5)); return [startYear + '-' + pad(fyMonth) + '-01', today, startYear - 1 + '-' + pad(fyMonth) + '-01', year - 1 + '-' + back]; };
const { yoyDates } = require('../lib/books-practice');
let diff = 0, n = 0;
for (let ms = Date.UTC(2020, 0, 1); ms < Date.UTC(2028, 11, 31); ms += 86400000) { const today = new Date(ms).toISOString().slice(0, 10); for (let fy = 1; fy <= 12; fy++) { n++; if (JSON.stringify(yoyDates(today, fy)) !== JSON.stringify(oldYoy(today, fy))) { diff++; if (diff < 4) console.log('   differs', today, fy, yoyDates(today, fy), oldYoy(today, fy)); } } }
t('yoyDates over ' + n + ' (day, FY start month) pairs equals the old rule: 0 differences', diff, 0);
t('yoyDates: the five days of the critic (17 Nov 2026, 29 Feb 2028, 1 Jul 2027, 30 Jun 2027, 1 Mar 2027), FY July', ['2026-11-17', '2028-02-29', '2027-07-01', '2027-06-30', '2027-03-01'].map((d) => yoyDates(d, 7)), ['2026-11-17', '2028-02-29', '2027-07-01', '2027-06-30', '2027-03-01'].map((d) => oldYoy(d, 7)));
console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
