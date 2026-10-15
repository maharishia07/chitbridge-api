// @stage tested
// @stage-note PERF1 · the ONE page-size clamp every list route reads (DISCIPLINES §2: a sensible default, a server-side maximum — never the client's word).
'use strict';
/**
 * lib/page-limit.js — how many rows a list answers, and which page. THE ONE PAGER (DISCIPLINES §2, LIM2).
 *
 * owns: the page a list route is asked for (`?page=` · `?limit=`) and the envelope it answers (`total · page · limit`).
 * called by: every list GET in routes/*.js (tests/list-paging-guard.test.cjs holds the unpaged count at zero outside its allow-list),
 *            lib/privacy.requests, lib/crm.list, routes/books pageQ (keyset), routes/testing readPage.
 * FLOW  req.query → pageArgs() → the route's statement (LIMIT $n OFFSET $m, or unchanged) → pageOut() → res.json
 * // CARD 28-platform-and-operations/page-limit
 *
 * The same clamp was spelled in each route (`Math.min(Math.max(parseInt(req.query.limit || '60', 10) || 60, 1), 400)` and its cousins in chits ·
 * crm · notifications · products · till) and the Inbox had none at all: `?limit=1000000` was obeyed (PERF1, 14 Oct). One reader, here.
 * W1-PLAT (15 Oct): the primitive AROUND the clamp — was it asked · which page · which offset · the envelope — was spelled six more times
 * (products offset/limit, catalogue `pg`, chits /folder and /disputes/queue, crm timeline, notifications). Lifted here as pageArgs / pageOut.
 *
 *   limitOf(v, dflt, max) → a whole number in [1, max]; `dflt` when v is absent or not a number
 *   pageOf(v)             → a whole page number ≥ 1 (1 when absent or not a number)
 *   pageArgs(query, dflt, max) → { asked, page, limit, offset }
 *       asked   true when ?page= or ?limit= was given. ⭐ NOT ASKED = EVERY ROW, AS BEFORE (FIELDS.md: "no page/limit = every matching row") —
 *               no screen changes behaviour until it asks; `limit` is then null (Postgres: LIMIT NULL = no limit) and `offset` 0.
 *   pageOut(key, rows, pg, total?) → { [key]: rows, total, page, limit, capped?, cap_note? }
 *       rows = the WHOLE list when the statement was not cut (cut here when asked), or the page itself when `total` is given
 *       (the statement did LIMIT/OFFSET and counted). `limit` answered = the page size, or the rows answered when every row was.
 *   capOf(pg, answered, total)    → {} or { capped: true, cap_note } — ⭐ W2-RAIL R2: A CAP SAYS SO IN WORDS. `capped` is the code a
 *       screen branches on; `cap_note` the sentence a person reads. Set when ?limit= asked for more than the max (pg.capped), or
 *       when a list that was not asked for a page was still cut by its route's own ceiling (total > rows answered).
 *   totalOf(rows, pg, again?) → the whole set's count from a WINDOW-COUNTED page (`count(*) OVER () AS total_rows` on every row,
 *       as routes/testing readPage counts). An empty page past the end carries no row to read it from: `again(limit, offset)`
 *       answers the first row (W2-CRM: lifted so crm-followups and crm-calls do not each spell the re-ask).
 */
const WHOLE_LIST = null;   /* LIMIT NULL — the statement answers every row */
const TOTAL_COLUMN = 'total_rows';   /* the window count's column name every counted statement uses */

/** the words a cut list carries (≤ 20 words, DESIGN rules): what you see · what to do */
function capNote(answered, total, max) {
  return total != null
    ? 'Showing ' + answered + ' of ' + total + '. Narrow the search, or load the next page.'
    : 'A page shows at most ' + max + '. Load the next page for more.';
}
/** was this answer cut short of what exists — the code and the sentence, or nothing at all when the list is whole */
function capOf(pg, answered, total) {
  const p = pg || {};
  const whole = total == null ? null : Number(total) || 0;
  const got = Number(answered || 0);
  /* asked for more than the max, and more exists (or the total is not known on this page — a keyset page past the first) */
  const cutByAsk = !!p.capped && (whole == null || whole > got);
  /* not asked for a page at all, yet the route's own ceiling kept some rows back */
  const cutByRoute = !p.asked && whole != null && whole > got;
  if (!cutByAsk && !cutByRoute) return {};
  return { capped: true, cap_note: capNote(got, whole, p.max) };
}

function limitOf(v, dflt, max) {
  const n = parseInt(v, 10);
  return Math.min(max, Math.max(1, Number.isFinite(n) ? n : dflt));
}
function pageOf(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** the page a list was asked for — one reading of ?page= and ?limit=, so no route spells "was it asked" or the offset itself */
function pageArgs(query, dflt, max) {
  const q = query || {};
  const asked = q.page != null || q.limit != null;
  const limit = asked ? limitOf(q.limit, dflt, max) : WHOLE_LIST;
  const page = asked ? pageOf(q.page) : 1;
  const wanted = parseInt(q.limit, 10);
  /* capped: the caller asked for more rows a page than the route's max — the answer is the max, and says so (capOf) */
  const capped = asked && Number.isFinite(wanted) && wanted > max;
  return { asked, page, limit, offset: asked ? (page - 1) * limit : 0, max, capped };
}

/** the envelope every list answers (DISCIPLINES §2: top-level total · page · limit beside the list's own key — and the cap words) */
function pageOut(key, rows, pg, total) {
  const list = Array.isArray(rows) ? rows : [];
  const alreadyCut = total != null;
  const whole = alreadyCut ? Number(total) || 0 : list.length;
  const page = alreadyCut || !pg.asked ? list : list.slice(pg.offset, pg.offset + pg.limit);
  const out = {};
  out[key] = page;
  out.total = whole;
  out.page = pg.page;
  out.limit = pg.asked ? pg.limit : (alreadyCut ? page.length : whole);
  return Object.assign(out, capOf(pg, page.length, whole));
}

/** the whole set's count a window-counted page carries on its first row; a page past the end asks `again` for one row (a wrong 0 is never answered) */
async function totalOf(rows, pg, again) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length) return Number(list[0][TOTAL_COLUMN]) || 0;
  if (!pg || pg.page <= 1 || typeof again !== 'function') return 0;
  const first = await again(1, 0);
  return first && first.length ? Number(first[0][TOTAL_COLUMN]) || 0 : 0;
}

module.exports = { limitOf, pageOf, pageArgs, pageOut, capOf, capNote, totalOf, WHOLE_LIST, TOTAL_COLUMN };
