// @stage tested
// @stage-note PERF1 · the ONE page-size clamp every list route reads (DISCIPLINES §2: a sensible default, a server-side maximum — never the client's word).
'use strict';
/**
 * lib/page-limit.js — how many rows a list answers, and which page.
 *
 * The same clamp was spelled in each route (`Math.min(Math.max(parseInt(req.query.limit || '60', 10) || 60, 1), 400)` and its cousins in chits ·
 * crm · notifications · products · till) and the Inbox had none at all: `?limit=1000000` was obeyed (PERF1, 14 Oct). One reader, here.
 *   limitOf(v, dflt, max) → a whole number in [1, max]; `dflt` when v is absent or not a number
 *   pageOf(v)             → a whole page number ≥ 1 (1 when absent or not a number)
 */
function limitOf(v, dflt, max) {
  const n = parseInt(v, 10);
  return Math.min(max, Math.max(1, Number.isFinite(n) ? n : dflt));
}
function pageOf(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
module.exports = { limitOf, pageOf };
