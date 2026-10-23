// CARD 01-rail-core-the-chit/chits-routes
// owns: database refusals, one-shot conflicts and refusals thrown on purpose (refused + a 4xx status + a code), answered in words.
// called by: routes/chits.js send · routes/catalogue.js order/confirm · server.js handler.
// FLOW  err → known(err) → { status, body } | null
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
/** b247's population boundary, matched on the trigger's own words (23514 alone is every CHECK constraint) */
function populationBoundary(err) {
  if (err.code !== '23514' || !/cannot trade with a/.test(String(err.message || ''))) return null;
  return {
    status: 409,
    body: {
      error: 'Test and live cannot mix',
      message: String(err.message),
      hint: err.hint || "Test data must never reach a real business's books. Use a test counterparty.",
      code: 'POPULATION_BOUNDARY'
    }
  };
}

/* ORD-FIX O7 — a shopper code that a first confirm already spent (lib/otp spendShopperOtp): the second tap is told, not given a second order */
const spentCode = (err) => (err.code === 'code_already_used' ? { status: 409, body: { error: 'Already sent', message: err.message, code: 'code_already_used' } } : null);

/** E01 — the body parser's own refusal (lib/limits.js decides the budget per route) */
function tooLarge(err) {
  if (err.type !== 'entity.too.large' && err.status !== 413) return null;
  return {
    status: 413,
    body: {
      error: 'Too large',
      message: 'What was sent is bigger than this address accepts' + (err.limit ? ' (' + Math.round(err.limit / 1024) + ' KB)' : '') + '.',
      code: 'BODY_TOO_LARGE'
    }
  };
}

/** E01 — 57014 query_canceled: the statement ran past DB_STATEMENT_TIMEOUT_MS (db/index.js sets it) */
function tookTooLong(err) {
  if (err.code !== '57014') return null;
  return {
    status: 503,
    body: {
      error: 'Took too long',
      message: 'The database took too long to answer and the request was stopped. Try again; if it keeps happening, tell us.',
      code: 'STATEMENT_TIMEOUT'
    }
  };
}

/**
 * ORD-65 — a refusal a route THROWS on purpose (err.refused, a 4xx status, a code: e.g. deliverEdge's NO_MONEY) keeps its own status,
 * code and words; without this fromError answered it 500 INTERNAL. Books refusals carry no status and are answered by their own routes.
 */
function thrownRefusal(err) {
  const status = Number(err.status);
  if (err.refused !== true || !err.code || !(status >= 400 && status < 500)) return null;
  return { status, body: { error: err.title || 'Refused', message: String(err.message), code: err.code } };
}

const READERS = [populationBoundary, spentCode, tooLarge, tookTooLong, thrownRefusal];

/** known(err) → { status, body } | null: the first reader that recognises the error; null and the caller answers exactly as before */
function known(err) {
  if (!err) return null;
  for (const reader of READERS) {
    const answer = reader(err);
    if (answer) return answer;
  }
  return null;
}

module.exports = { known };
