// @stage tested
// @stage-note What a store HAS, and when that was last true. Pure — no DB. The routes store and read it.
'use strict';
/**
 * availability.js — a quantity is not an answer without a date.
 *
 * Athi, 2026-08-08: *"if there is a query about one product, how can we provide where exactly the product is and
 * how quickly this can be sent across?"*
 *
 * ── THE RULE THAT SHAPES EVERYTHING HERE ────────────────────────────────────────────────────────────────────────
 * **A stock figure with no timestamp is a rumour.** A live ERP feed, a nightly file and a number somebody typed in
 * March are three different facts, and flattening them into one integer is how a network promises stock it does not
 * have. So every quantity carries WHERE it came from and WHEN it was last true, and the caller is told which — not
 * so it can be pretty, but because "6 in stock" and "6 in stock, as of five months ago" lead to different decisions.
 *
 * ── AND THE ONE THAT WILL BE TEMPTING TO BREAK ──────────────────────────────────────────────────────────────────
 * **Absent is not zero.** A store that has never reported is UNKNOWN. Zero means "I looked, there are none" and is
 * a real, useful answer; unknown means "nobody has said". Rendering unknown as 0 makes a silent store look
 * out-of-stock, and a network then routes around a store that may well have the part on the shelf. They are
 * different states and they must stay different all the way to the screen.
 *
 * ── ZERO DEPENDENCIES · TIER A ──────────────────────────────────────────────────────────────────────────────────
 */

/** Where a number came from. `manual` is honest and common; `unknown` is what an unlabelled number becomes. */
const SOURCES = ['erp', 'iot', 'manual', 'unknown'];

/** How old a figure may be before it stops being worth the same trust. Minutes. */
const FRESH = { live: 15, today: 24 * 60, week: 7 * 24 * 60 };

/**
 * stamp({ qty, source, as_of }) → the record to store, or null when nothing usable was said.
 *
 * A negative quantity is refused rather than clamped: it means the feed is wrong, and a wrong feed silently
 * rounded to zero looks like an out-of-stock store instead of a broken connector.
 */
function stamp(input, nowIso) {
  const i = input && typeof input === 'object' ? input : {};
  if (i.qty === null || i.qty === undefined || i.qty === '') return null;
  const n = Number(i.qty);
  if (!Number.isFinite(n) || n < 0) return null;
  const src = SOURCES.indexOf(String(i.source || '').toLowerCase()) >= 0
    ? String(i.source).toLowerCase() : 'unknown';
  // as_of is the moment the number was TRUE, which is not always the moment it was written — a nightly file
  // carries last night's timestamp. The caller may supply it; otherwise it is now.
  const at = i.as_of ? new Date(i.as_of) : null;
  const as_of = (at && !isNaN(at.getTime())) ? at.toISOString() : (nowIso || new Date().toISOString());
  return { qty: Math.round(n), source: src, as_of };
}

/**
 * freshness(as_of, now) → { minutes, bucket, stale, label }
 *
 * `stale` is the single boolean a screen can act on; `label` is what it says out loud. A figure with no date is
 * `unknown` rather than `old`, because "we do not know when" is not the same as "we know it is old".
 */
function freshness(as_of, now) {
  const t = as_of ? new Date(as_of) : null;
  if (!t || isNaN(t.getTime())) return { minutes: null, bucket: 'unknown', stale: true, label: 'no date' };
  const mins = Math.max(0, Math.round(((now ? new Date(now) : new Date()) - t) / 60000));
  if (mins <= FRESH.live) return { minutes: mins, bucket: 'live', stale: false, label: mins <= 1 ? 'just now' : mins + ' min ago' };
  if (mins <= FRESH.today) return { minutes: mins, bucket: 'today', stale: false, label: Math.round(mins / 60) + ' h ago' };
  const days = Math.round(mins / 1440);
  if (mins <= FRESH.week) return { minutes: mins, bucket: 'week', stale: true, label: days + ' day' + (days === 1 ? '' : 's') + ' ago' };
  return { minutes: mins, bucket: 'old', stale: true, label: days + ' days ago' };
}

/**
 * Great-circle distance in km. Two numerics and this function answer "who is nearest" for any network that fits
 * in a page of stores — see migrations/b119 for why this is not PostGIS.
 */
function distanceKm(a, b) {
  if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const R = 6371, rad = (x) => (Number(x) * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(s))));
}

/**
 * answer(rows, { from, now }) → the rows a person can act on, best first, plus a one-line summary.
 *
 * ORDER: has stock before has none; then FRESH before stale — a confident 6 from last night beats a confident 6
 * from March; then nearest. Distance last on purpose: the closest store is no use if its number cannot be trusted.
 */
function answer(rows, opts) {
  const o = opts || {};
  const out = (Array.isArray(rows) ? rows : []).map((r) => {
    const f = freshness(r.as_of, o.now);
    const km = distanceKm(o.from, r);
    // UNKNOWN is preserved all the way out. Anything that turns it into 0 here has thrown away the distinction.
    const known = r.qty !== null && r.qty !== undefined;
    return Object.assign({}, r, { known, freshness: f, km });
  });
  out.sort((a, b) => {
    const av = a.known && a.qty > 0, bv = b.known && b.qty > 0;
    if (av !== bv) return av ? -1 : 1;
    if (a.freshness.stale !== b.freshness.stale) return a.freshness.stale ? 1 : -1;
    const ak = a.km == null ? Infinity : a.km, bk = b.km == null ? Infinity : b.km;
    return ak - bk;
  });
  const withStock = out.filter((r) => r.known && r.qty > 0);
  const unknown = out.filter((r) => !r.known);
  return {
    rows: out,
    total: withStock.reduce((s, r) => s + r.qty, 0),
    stores_with_stock: withStock.length,
    stores_unknown: unknown.length,
    // Said in one line, and it refuses to round the unknowns away — "and 2 stores have not reported" is the part a
    // person needs in order to know whether to go and ask.
    summary: withStock.length
      ? `${withStock.reduce((s, r) => s + r.qty, 0)} across ${withStock.length} store${withStock.length === 1 ? '' : 's'}`
        + (unknown.length ? `, and ${unknown.length} ${unknown.length === 1 ? 'store has' : 'stores have'} not reported` : '')
      : (unknown.length ? `Nobody has reported stock — ${unknown.length} store${unknown.length === 1 ? '' : 's'} unknown`
                        : 'None in the network'),
  };
}

module.exports = { stamp, freshness, distanceKm, answer, SOURCES, FRESH };
