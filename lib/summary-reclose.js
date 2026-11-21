'use strict';
/**
 * lib/summary-reclose.js — A SUMMARY CLOSED AGAIN UNDER THE SAME REFERENCE (CTR-181).
 * CARD 09-counter/day-close
 *
 * OWNS      the verdict on a summary chit whose reference (SUM/D/<till>/<day>, lib/rollup refOf) the shop already holds: the same figures
 *           (a retry), or NEW figures (a day reopened, sold more, closed again) which are stored as the next VERSION "<ref>#<n>".
 * CALLED BY routes/chits.js sendReplay (the one place a held reference is looked at) and its lost-race rerun
 * FLOW      POST /api/chits/send → sendReplay → byRef holds it → judge(db, shop, ref, body) → 'replay' (200 duplicate:true, the NEWEST chit)
 *           | 'version' (the body is re-referenced and sent as a new chit) | null (not a summary: the ordinary replay answer).
 * ⚠️ Append-only: the held chit is never updated. lib/till-summary and rollup.acrossCounters read newest-first, one row per counter per key, so the
 *    newest version is the one that stands and the old ones stay as history. Books: a DAY summary posts the walk-in day (books-hooks daySummaryVerdict → postDay, source_ref walkin:<counter>:<day>), and that posting is idempotent (entryBySource) — version #2 answers duplicate and nothing is posted twice (tests/ctr-181-books-once.test.cjs); a week/month/year summary posts nothing.
 * ⚠️ Two CARRIED totals are compared (mismatch, not recompute) — no engine is run here. A summary is not a bill: lib/counter-bill replayDiffers reads invoice money
 *    and lines, which a summary does not carry, so it gives a summary no verdict and this is the summary's own.
 */
const SEPARATOR = '#';

/** the held versions of one reference, oldest first: the reference itself, then <ref>#2, #3 … (the LIKE pattern is escaped: a till id may hold _ or %) */
const VERSIONS_SQL = `SELECT chit_id, business_json->'summary' AS summary
       FROM chit_header
      WHERE entity_id = $1 AND purpose = 'general'
        AND (business_json->>'client_ref' = $2 OR business_json->>'client_ref' LIKE $3 ESCAPE '!')
      ORDER BY created_at`;

const likeEscaped = (text) => String(text).replace(/[!%_]/g, (char) => '!' + char); /* '!' is the ESCAPE character above */

/** the summary object a send body carries, or null when the body is not a counter summary (a bill, a note, a payment…) */
function summaryOf(body) {
  const summary = body && body.business_json && body.business_json.summary;
  return body && body.purpose === 'general' && summary && typeof summary === 'object' && !Array.isArray(summary) && summary.totals ? summary : null;
}

/**
 * AW-F-03: the sentence for a DAY summary the books could never post (null when it is sound, or not a day one). The day the books read is the first YYYY-MM-DD in summary.key
 * (books-hooks daySummaryVerdict reads the same key) and the counter is summary.till.id: a missing counter, a day that is not on the calendar (30 Feb) or lies after tomorrow
 * (the till's clock may run a day ahead of the server's) is refused at the door. A day before the ledger began is the books' own answer, not this door's.
 */
function malformedDay(body, now) {
  const summary = summaryOf(body);
  if (!summary || summary.period !== 'day') return null;
  const found = /(\d{4})-(\d{2})-(\d{2})/.exec(String(summary.key || ''));
  const counter = (summary.till && summary.till.id) || (body.business_json.till && body.business_json.till.id);
  if (!found) return 'This day summary has no day. Close the day again from the counter.';
  const day = new Date(Date.UTC(+found[1], +found[2] - 1, +found[3]));
  if (day.getUTCFullYear() !== +found[1] || day.getUTCMonth() !== +found[2] - 1 || day.getUTCDate() !== +found[3]) return found[0] + ' is not a day on the calendar. Close the day again from the counter.';
  if (day.getTime() > (now || Date.now()) + 2 * 86400000) return 'The day ' + found[0] + ' has not come yet. Check the date on the counter and close the day again.';
  if (!counter) return 'This day summary does not say which counter closed ' + found[0] + '. Close the day again from the counter.';
  return null;
}

/** the figures, in a form that compares by value whatever order the keys were written in */
function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  return JSON.stringify(value === undefined ? null : value);
}

/** the version a held summary stands for: its stamped revision, else 1 (the first close carries none) */
function versionOf(row) {
  const carried = Number(row.summary && row.summary.revision);
  return Number.isInteger(carried) && carried > 0 ? carried : 1;
}

/**
 * judge(db, shop, ref, body) → null | { replay: chit_id, revision } | { version: n, ref: '<ref>#n', supersedes: chit_id }
 * `db` is a withEntity() handle (chit_header is FORCE RLS). The body is the same figures as the NEWEST version, or carries the same summarised_at as any held
 * version (a late retry of an older send) → a replay of that chit; anything else is the next version.
 */
async function judge(db, shop, ref, body) {
  const incoming = summaryOf(body);
  if (!incoming) return null;
  const held = (await db.query(VERSIONS_SQL, [shop, ref, likeEscaped(ref + SEPARATOR) + '%'])).rows.filter((row) => row.summary && row.summary.totals);
  if (!held.length) return null;
  const newest = held[held.length - 1];
  const sameFigures = stable(newest.summary.totals) === stable(incoming.totals);
  const lateRetry = held.find((row) => incoming.summarised_at && row.summary.summarised_at === incoming.summarised_at && stable(row.summary.totals) === stable(incoming.totals));
  const same = sameFigures ? newest : lateRetry;
  if (same) return { replay: same.chit_id, revision: versionOf(same) };
  const next = Math.max(...held.map(versionOf), held.length) + 1;
  return { version: next, ref: ref + SEPARATOR + next, supersedes: newest.chit_id };
}

/** the day reference without its version: SUM/D/C1/2026-11-12#3 → SUM/D/C1/2026-11-12 */
const baseRef = (ref) => String(ref).replace(/#[0-9]+$/, '');

module.exports = { judge, summaryOf, malformedDay, baseRef, SEPARATOR };
