'use strict';
/**
 * lib/knownerr.js — A REFUSAL THE DATABASE MAKES ON PURPOSE, ANSWERED AS ONE (external review §23, 2026-09-28).
 *
 * server.js's error handler translated b247's population boundary ("a test entity cannot trade with a production
 * one") into a 409 a person can read. But no route passes its errors to next(err): each route catches its own and
 * answers 500 — so that translation had never once run, and the refusal reached people as "Send failed" /
 * "Order failed", which reads as a fault in the product. The first person files a bug; the second works around it.
 *
 * ⭐ ONE TRANSLATION, USED WHERE THE ERROR IS ACTUALLY CAUGHT: the send route, the storefront order, and the global
 * handler (still the net for anything that does reach it). Matched on the trigger's OWN WORDS, not the bare SQLSTATE —
 * 23514 is every CHECK constraint in the schema, and answering "cannot trade" to a tax-slab violation would be worse
 * than saying nothing. Anything else returns null and the caller answers exactly as it did before.
 *
 * known(err) → { status, body } | null
 */
function known(err) {
  if (err && err.code === '23514' && /cannot trade with a/.test(String(err.message || ''))) {
    return { status: 409, body: {
      error: 'Test and live cannot mix',
      message: String(err.message),
      hint: err.hint || 'Test data must never reach a real business\'s books. Use a test counterparty.',
      code: 'POPULATION_BOUNDARY',
    } };
  }
  /* E01 — the body parser's own refusal (lib/limits.js decides the budget per route) */
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return { status: 413, body: {
      error: 'Too large',
      message: 'What was sent is bigger than this address accepts' + (err.limit ? ' (' + Math.round(err.limit / 1024) + ' KB)' : '') + '.',
      code: 'BODY_TOO_LARGE',
    } };
  }
  /* E01 — 57014 query_canceled: the statement ran past DB_STATEMENT_TIMEOUT_MS (db/index.js sets it) */
  if (err && err.code === '57014') {
    return { status: 503, body: {
      error: 'Took too long',
      message: 'The database took too long to answer and the request was stopped. Try again; if it keeps happening, tell us.',
      code: 'STATEMENT_TIMEOUT',
    } };
  }
  return null;
}

module.exports = { known };
