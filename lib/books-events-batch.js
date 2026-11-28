'use strict';
/**
 * lib/books-events-batch.js — THE CAPABILITY "POST A LIST OF EVENTS TO THE BOOKS" (CAP-BOOKS-EVENTS-BATCH; split out of routes/books.js, 1129).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      postEventsBatch(ctx, events): 1..100 events, each through the ONE event writer (lib/books-manual.post, the writer POST /events uses), one result per line;
 *           a refused line is named by index and the rest post; a shop that asks the owner to approve a Bookkeeper's entries holds the whole batch (nothing posts).
 * CALLED BY routes/books-events-batch.js (POST /api/books/events/batch). Could call it instead of looping single events: the bank Add (statement lines), move-in (opening entries), the till day close.
 * FLOW      events → 1..100 check → isHeld? (the shop's owner-approves mode) → each line through the one writer, a refusal kept as its row → receipt → one trace line
 * ADDRESS   lib/books-events-batch.postEventsBatch(ctx, events)
 * IN        ctx { entity, books, by, request_id, isHeld: async () => boolean, said: (err) => {status, code, detail}, post?: writer } · events: array of 1..100 event objects
 * OUT       ALWAYS a receipt, never undefined: { ok, capability, request_id, written, held, refused: [{index, code}], posted, failed, results, code?, refusal? }
 *           ok false = a line was refused or the batch was not taken (code names why); written = lines newly posted (a replay is a duplicate, not written); held = lines not taken because the shop holds them.
 * LOUD      no catch swallows: a refused line is in refused[] with its code and in results[]; a batch that is not taken carries refusal {status, code, detail}; an error of the gate or the list itself is thrown to the caller;
 *           every call writes ONE log line 'capability' naming the capability and the request_id.
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 */
const log = require('./logger');
const CAPABILITY = 'CAP-BOOKS-EVENTS-BATCH';
const LIMIT = 100;
const SEND_BETWEEN = 'Send between 1 and 100 events.';
const HELD_WORDS = 'This shop asks the owner to approve entries, so a batch is not taken: send them one at a time.';

/** the receipt: the one shape every outcome answers in, and the one trace line */
function receipt(ctx, fields) {
  const out = Object.assign({ ok: false, capability: CAPABILITY, request_id: ctx.request_id || null, written: 0, held: 0, refused: [], posted: 0, failed: 0, results: [] }, fields);
  log[out.ok ? 'info' : 'warn']('capability', { capability: CAPABILITY, id: out.request_id, ok: out.ok, written: out.written, held: out.held, refused: out.refused.length, code: out.code || null });
  return out;
}

/** a batch that is not taken: its code and the words the caller shows (status rides along for an HTTP door) */
const notTaken = (ctx, status, code, detail, held) => receipt(ctx, { code, held: held || 0, refusal: { status, code, detail } });

/** the line's own client_ref as text, or null: the key a retry is named by */
const clientRefOf = (event) => (event && typeof event === 'object' && event.client_ref != null ? String(event.client_ref) : null);
/** a line that is not an object is not an entry */
const isEntry = (event) => !!event && typeof event === 'object' && !Array.isArray(event);

/** one line through the one writer: its result row (a refusal keeps its own status, code and words) */
async function postOne(ctx, event, index) {
  const client_ref = clientRefOf(event);
  if (!isEntry(event)) return { index, client_ref, ok: false, status: 400, code: 'BOOKS_BAD_REQUEST', detail: 'This line is not an entry.' };
  try {
    const out = await (ctx.post || require('./books-manual').post)(ctx.entity, ctx.books, event, ctx.by);
    return Object.assign({ index, client_ref, ok: out.ok !== false, duplicate: out.duplicate === true, entry_no: out.entry_no, entry_id: out.entry_id, posting_date: out.posting_date }, out.held ? { held: true, action_id: out.action_id, state: out.state, total_minor: out.total_minor, currency: out.currency } : {}); /* BB-P1-2: a proposed line is held for the owner, not posted */
  } catch (err) {
    const said = ctx.said(err) || {};
    return { index, client_ref, ok: false, status: said.status || 500, code: said.code || 'INTERNAL', detail: said.detail || said.message || 'This line could not be posted.' };
  }
}

/** the capability: 1..100 events in → a receipt out (see OUT above); a batch not taken says why in refusal, a fault of the gate is thrown */
async function postEventsBatch(ctx, events) {
  if (!Array.isArray(events) || events.length < 1 || events.length > LIMIT) return notTaken(ctx, 400, 'BOOKS_BAD_REQUEST', SEND_BETWEEN);
  if (await ctx.isHeld()) return notTaken(ctx, 409, 'BOOKS_BATCH_HELD', HELD_WORDS, events.length);
  const results = [];
  for (let index = 0; index < events.length; index++) results.push(await postOne(ctx, events[index], index));
  const failedRows = results.filter((one) => !one.ok);
  return receipt(ctx, {
    ok: failedRows.length === 0,
    code: failedRows.length ? 'BOOKS_BATCH_PARTIAL' : undefined,
    written: results.filter((one) => one.ok && !one.duplicate && !one.held).length,
    held: results.filter((one) => one.ok && one.held).length, /* BB-P1-2: lines proposed to the owner (the isHeld whole-batch refusal above keeps held = lines not taken) */
    refused: failedRows.map((one) => ({ index: one.index, code: one.code })),
    posted: results.length - failedRows.length,
    failed: failedRows.length,
    results
  });
}

module.exports = { postEventsBatch, CAPABILITY };
