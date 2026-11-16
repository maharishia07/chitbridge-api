#!/usr/bin/env node
/**
 * tools/seed/make-history-84.cjs — writes tools/seed/mis-history-84.json: 84 months (7 years, 2019-11 to 2026-10) of AU walk-in takings for the MIS showcase.
 * The LAST 26 months are tools/seed/mis-history.json exactly (so the hand-written sample months hold in both files); the 58 months before are the same calendar month of
 * Sep 2024-Aug 2025 taken back at the file's own growth (8 % a year), whole dollars, with a trading dip in Apr-Jun 2020 (the lockdown) and a quick recovery.
 * usage: node tools/seed/make-history-84.cjs   (rewrites the file; the data is deterministic)
 */
'use strict';
const fs = require('fs'),
  path = require('path');
const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'mis-history.json'), 'utf8'));
const GROWTH = 1.08,
  DIP = { '2020-03': 0.9, '2020-04': 0.62, '2020-05': 0.68, '2020-06': 0.8, '2020-07': 0.9, '2020-08': 0.95 };
const keyOf = (y, m) => y + '-' + String(m).padStart(2, '0');
const daily = {};
for (let y = 2019, m = 11; keyOf(y, m) <= '2026-10'; m === 12 ? (y++, (m = 1)) : m++) {
  const key = keyOf(y, m);
  if (base.daily_ex_gst[key] != null) {
    daily[key] = base.daily_ex_gst[key];
    continue;
  }
  const ref = base.daily_ex_gst[keyOf(m >= 9 ? 2024 : 2025, m)]; /* Sep 2024 - Aug 2025 holds every calendar month once */
  const yearsBack = (m >= 9 ? 2024 : 2025) - y;
  daily[key] = Math.round((ref / Math.pow(GROWTH, yearsBack)) * (DIP[key] || 1));
}
const out = Object.assign({}, base, {
  _about:
    'MIS showcase (REQ-MIS-SHOWCASE-2026-11-16): 84 months, Nov 2019 to Oct 2026. Every figure is AUD and DEMO. daily_ex_gst = the walk-in cash takings of EVERY day of that month before 10% GST. The last 26 months are mis-history.json unchanged (so tools/seed/mis-history-expected.json holds here too); earlier months take the same calendar month back at 8% a year with a Mar-Aug 2020 dip. Made by tools/seed/make-history-84.cjs.',
  start: '2019-11-01',
  daily_ex_gst: daily
});
fs.writeFileSync(path.join(__dirname, 'mis-history-84.json'), JSON.stringify(out, null, 2) + '\n');
console.log(Object.keys(daily).length + ' months written');
