'use strict';
/**
 * points.js — a reward point is NOT money, and this file exists so the two can never be confused.
 *
 * Athi, 2026-09-11: *"the reward point also one of the currency, correct? We can have a symbol or a name so it is
 * easy to handle?"* — and then the part that decided the design: *"my only view is it gets guarded."*
 *
 * ⭐⭐⭐ A SYMBOL CANNOT GUARD ANYTHING. He first suggested `##` or `## nnnn ##`, and a marker like that is a
 * string: strings concatenate, and nothing stops `'##' + 500` being added to a rupee total. What guards money in
 * this codebase is not its symbol but its SHAPE — `{ amount, currency }`, plus a `sum()` that refuses to mix.
 * Points get the same treatment and a DELIBERATELY DIFFERENT shape, so the type system does the guarding.
 *
 *   money    { amount: 3290, currency: 'INR' }
 *   points   { points: 500,  programme: 'Shop points' }
 *
 * ── ⚠️⚠️ WHY A SEPARATE FILE AND NOT A FIELD IN money.js ────────────────────────────────────────────────────
 *
 * Because the hole is real and narrow: `money.CODE_RE` is /^[A-Z]{3}$/, so `{ amount: 50, currency: 'PTS' }` would
 * pass every check money makes and be summed with rupees. One file that held both types would make that a typo
 * away at all times. Two files, two shapes, and each refusing the other is the only version that cannot be got
 * wrong by accident.
 *
 * ── ⭐⭐ AND THE REASON POINTS ARE NOT MONEY IS ATHI'S OWN RULE ──────────────────────────────────────────────
 *
 * Encashing points is a **TENDER, not a discount** (2026-09-09) — because a discount would restate the taxable
 * value of the bill and take the tax off twice. A tender is HOW YOU PAY, alongside cash and UPI. It is not money
 * ON the bill, it never changes what is owed, and it must never enter an arithmetic that produces a total.
 *
 * ── ⚠️ WHAT THIS FILE DELIBERATELY DOES NOT DO ─────────────────────────────────────────────────────────────
 *
 * It does not convert points to money, and there is no function here that takes a rate. What a point is WORTH is
 * a decision the shop makes and lib/rewards.js owns (`worthOf`); doing it here would put a rate in the type, and
 * a type that can become money is not a different type.
 *
 * @stage held
 * ⚠ HELD, NOT SHIPPED — and the boundary test is right to demand the label. The shape is done; the other half
 * of the guard is not. money.js still accepts { amount: 50, currency: 'PTS' } because 'PTS' passes its
 * /^[A-Z]{3}$/, so until money REFUSES points-shaped values and reward-ish codes, wiring a display here would
 * put the reassuring half in service while the actual hole stays open.
 */

/** ⚠️ A programme NAME, not a code. The shop chooses it ("Shop points", "Chola Rewards") and a customer reads it;
 *  a three-letter code here would be the first step back towards looking like a currency. */
const NAME_MAX = 40;

/** Is this already a points value? */
function isPoints(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v)
    && typeof v.points === 'number' && Number.isFinite(v.points)
    && typeof v.programme === 'string' && v.programme.trim().length > 0;
}

/**
 * ⚠️ THE CROSS-GUARD, AND THE WHOLE POINT OF THE FILE. A money value is not points, whatever its code says —
 * `{ amount: 50, currency: 'PTS' }` is somebody stamping points as money and must be refused at the door rather
 * than discovered in a total.
 */
function isMoneyShaped(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v)
    && typeof v.amount === 'number' && typeof v.currency === 'string';
}

/** Build one. Throws rather than produce a programme-less points value — the write-path guard, as money's is. */
function make(points, programme) {
  const n = Number(points);
  if (!Number.isFinite(n)) throw new Error('Points must be a finite number, got ' + JSON.stringify(points));
  /* ⚠️ points are WHOLE. A half point is a rounding artefact somebody will eventually have to explain to a
     customer, and every scheme in the world issues integers. */
  if (!Number.isInteger(n)) throw new Error('Points are whole, got ' + n);
  const p = String(programme == null ? '' : programme).trim();
  if (!p) throw new Error('Points must name the programme they belong to — a shop may run more than one.');
  if (p.length > NAME_MAX) throw new Error('A programme name is at most ' + NAME_MAX + ' characters.');
  return { points: n, programme: p };
}

/** the NUMBER, strictly — throws on anything that is not a points value, including money */
function pointsOf(v) {
  if (isPoints(v)) return v.points;
  if (isMoneyShaped(v)) throw new Error('That is money, not points. They are different things and cannot be mixed.');
  throw new Error('Not a points value: ' + JSON.stringify(v));
}

/**
 * the NUMBER, or NaN — never throws. For reading legacy rows, where a balance was stored as a bare integer.
 * ⚠️ Money still refuses, loosely or not: reading a rupee figure as points is the exact confusion this file exists
 * to prevent, and being tolerant about it would be tolerance of the one thing that must not happen.
 */
function pointsOfLoose(v) {
  if (isPoints(v)) return v.points;
  if (isMoneyShaped(v)) return NaN;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'string' && v.trim() !== '') { const n = Number(v.trim()); return Number.isFinite(n) ? n : NaN; }
  return NaN;
}

/** which programme these belong to, or null */
function programmeOf(v) { return isPoints(v) ? v.programme : null; }

/**
 * ⚠️⚠️ SUM REFUSES TO MIX, exactly as money's does — and refuses money outright.
 *
 * A shop may run more than one scheme (a house card and a manufacturer's), and adding them would produce a
 * balance that belongs to nobody. The refusal is the feature.
 */
function sum(list) {
  const rows = (list || []).filter((x) => x != null);
  if (!rows.length) return null;
  let programme = null, total = 0;
  for (const r of rows) {
    if (isMoneyShaped(r)) throw new Error('Money cannot be added to points.');
    if (!isPoints(r)) throw new Error('Not a points value: ' + JSON.stringify(r));
    if (programme === null) programme = r.programme;
    else if (programme !== r.programme)
      throw new Error('Two programmes cannot be added: ' + programme + ' and ' + r.programme);
    total += r.points;
  }
  return { points: total, programme: programme };
}

/**
 * ── ⭐⭐ HOW IT READS TO A PERSON ────────────────────────────────────────────────────────────────────────────
 *
 * Athi asked for a symbol so points are recognisable at a glance. `##` was checked and rejected: it is Markdown
 * H2 in our own documents, a comment marker to CSV importers, and `####` in Excel means "column too narrow" — so
 * a points column would read as broken in the one place a shopkeeper takes their figures. `★` is taken too; it
 * means Preferred supplier across the app.
 *
 * ⭐ SO THE PROGRAMME'S OWN NAME IS THE SYMBOL. The shop already chose it, the slip already prints it, and a
 * customer reads "500 Shop points" without being taught anything. `pts` is the compact form for a narrow column.
 * ⚠️ NEVER a currency symbol and never a bare number: "500" beside "₹500" on the same slip is the confusion.
 */
function format(v, opts) {
  const o = opts || {};
  if (!isPoints(v)) return '';
  const n = v.points.toLocaleString(o.locale || 'en-IN');
  return o.short ? (n + ' pts') : (n + ' ' + v.programme);
}

module.exports = { isPoints, isMoneyShaped, make, pointsOf, pointsOfLoose, programmeOf, sum, format, NAME_MAX };
