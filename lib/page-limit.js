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
 *   pageOut(key, rows, pg, total?) → { [key]: rows, total, page, limit }
 *       rows = the WHOLE list when the statement was not cut (cut here when asked), or the page itself when `total` is given
 *       (the statement did LIMIT/OFFSET and counted). `limit` answered = the page size, or the total when every row was answered.
 */
const WHOLE_LIST = null;   /* LIMIT NULL — the statement answers every row */

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
  return { asked, page, limit, offset: asked ? (page - 1) * limit : 0 };
}

/** the envelope every list answers (DISCIPLINES §2: top-level total · page · limit beside the list's own key) */
function pageOut(key, rows, pg, total) {
  const list = Array.isArray(rows) ? rows : [];
  const alreadyCut = total != null;
  const whole = alreadyCut ? Number(total) || 0 : list.length;
  const page = alreadyCut || !pg.asked ? list : list.slice(pg.offset, pg.offset + pg.limit);
  const out = {};
  out[key] = page;
  out.total = whole;
  out.page = pg.page;
  out.limit = pg.asked ? pg.limit : whole;
  return out;
}

module.exports = { limitOf, pageOf, pageArgs, pageOut, WHOLE_LIST };
