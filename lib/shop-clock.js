/**
 * shop-clock.js — THE ONE CLOCK EVERY LEDGER POSTING READS (Athi, 2026-10-09: "the shop clock is required, built BEFORE Trip 0";
 * extended 2026-10-10 to a three-year simulation).
 *
 * A posting path never says `new Date()` or `Date.now()`: it says `clock.now()` / `clock.nowMs()` / `clock.today(country)`. In life
 * these ARE the system clock. A test (or tools/simulate-years.cjs) can SET it and ADVANCE it, so a year of shop life runs in seconds.
 *
 * ⚠️ Setting is refused unless NODE_ENV is 'test' or SHOP_CLOCK_ALLOW=1 (the local stack) — the live server cannot be moved
 * by a request, a typo or a stray require. tests/shop-clock-guard.test.cjs fails a new raw clock read in posting code.
 *
 * ⚠️ NOT covered: SQL `now()` defaults (audit columns: created_at, locked_at, updated_at) — the database stamps those. The
 * posting DAY never comes from them except chit_header.created_at (DECISIONS "day-close breaks past midnight").
 */
'use strict';

let offsetMs = null;                       /* null = the real clock; a number = (simulated − real) at the moment it was set */
let frozen = null;                         /* ms when frozen to an exact moment (simulator), else null */

const allowed = () => process.env.NODE_ENV === 'test' || process.env.SHOP_CLOCK_ALLOW === '1';
const toMs = (v) => { const t = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v); if (!isFinite(t)) throw new Error('shop-clock: not a moment: ' + v); return t; };

const nowMs = () => (frozen !== null ? frozen : Date.now() + (offsetMs || 0));
const now = () => new Date(nowMs());
/** the shop's calendar day (YYYY-MM-DD) — books-hooks.dayOf is the one rule for the zone; the clock only supplies the moment */
const today = (country) => require('./books-hooks').dayOf(now(), country);
/** the shop's calendar day of ANY moment — one door, so a posting path never reaches for books-hooks.dayOf and Date separately */
const bizDay = (ts, country) => require('./books-hooks').dayOf(ts === undefined ? now() : ts, country);

function guard() { if (!allowed()) throw new Error('shop-clock: the clock can only be moved in tests or on the local stack'); }
/** FREEZE the clock at a moment (ISO string, ms or Date). Time stands still until advance() or reset(). */
function set(v) { guard(); frozen = toMs(v); return now(); }
/** move the clock forward (ms) — freezes at now first if it was running */
function advance(ms) { guard(); frozen = nowMs() + Number(ms || 0); return now(); }
function advanceDays(d) { return advance(Number(d) * 86400000); }
/** back to the system clock */
function reset() { frozen = null; offsetMs = null; }
const isSimulated = () => frozen !== null || offsetMs !== null;

module.exports = { now, nowMs, today, bizDay, set, advance, advanceDays, reset, isSimulated };
