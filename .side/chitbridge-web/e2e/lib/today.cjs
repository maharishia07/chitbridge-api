/**
 * e2e/lib/today.cjs — THE ONE "TODAY" OF A WALK (round QW1-TODAY, 2026-10-14).
 *
 * CB_TODAY=YYYY-MM-DD fixes the business day every walk runs on; unset = the real day. A walk (or a stand-in under it) never says
 * `new Date()` for a business date — it asks here. lib/walk.cjs freezes the PAGE's clock to NOW when CB_TODAY is set (Playwright ctx.clock),
 * so the browser and the stand-in answer the same day. e2e/guard-walk-today.cjs fails a raw clock read in a walk.
 * Not moved: the real api (--real) — chitbridge-api lib/shop-clock.js has no env override yet, so walk.cjs leaves the page clock alone there.
 */
'use strict';
const SET = process.env.CB_TODAY || '';
if (SET && (!/^\d{4}-\d{2}-\d{2}$/.test(SET) || isNaN(Date.parse(SET + 'T00:00:00Z')))) { console.log('CB_TODAY is not a YYYY-MM-DD day: ' + SET); process.exit(2); }

const injected = !!SET;
/** the zone the walks run the page in (lib/walk.cjs default `timezoneId || 'Asia/Kolkata'`); a walk that sets another zone asks todayIn(zone) */
const ZONE = 'Asia/Kolkata';
/** the calendar day in `zone` (en-CA formats YYYY-MM-DD). UTC differs from the page's bkToday() between 18:30 and 24:00 UTC. */
const todayIn = (zone) => new Intl.DateTimeFormat('en-CA', { timeZone: zone || ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());   // clock-ok: the default day when CB_TODAY is unset
const real = () => todayIn(ZONE);
const TODAY = SET || real();
/** the injected instant: 06:00Z = 11:30 IST, the same calendar day in the shop's zone and in UTC; real now when nothing is injected */
const now = () => (injected ? new Date(SET + 'T06:00:00Z') : new Date());   // clock-ok
const nowIso = () => now().toISOString();
const nowMs = () => now().getTime();
/** TODAY ± n calendar days, as YYYY-MM-DD */
const dayPlus = (n, from) => { const d = new Date((from || TODAY) + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

module.exports = { TODAY, ZONE, todayIn, injected, now, nowIso, nowMs, dayPlus };
