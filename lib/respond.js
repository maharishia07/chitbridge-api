/*
 * OWNS      keeping internal/DB error text out of client responses: safeErr logs the real error and returns the one generic sentence.
 * CALLED BY ~45 route files and lib/problem.js (the 5xx path); see the knowledge-graph line below.
 * FLOW      route catch → safeErr(err, context) → log.error with request id → SAFE_SENTENCE to the caller
 * CARD      28-platform-and-operations/api-standard
 */
// lib/respond.js — keep internal/DB error text out of client responses.
// CALLED BY routes/actors.js, routes/adopt.js, routes/assist.js, routes/attachments.js, routes/books.js (+40 more)   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
// Logs the real error server-side (so nothing is lost) and returns a generic client message.
// Used as the `message` field in route 500 handlers: res.status(500).json({ error:'X', message: safeErr(err) }).
const log = require('./logger');
/* context (optional): extra log fields such as the request id, so the line can be joined to the answer the caller saw (lib/problem.js) */
const SAFE_SENTENCE = 'Something went wrong — please try again.';
const safeErr = (err, context) => {
  if (err) log.error('API error', Object.assign({ err: err.message || String(err), stack: err.stack }, context));
  return SAFE_SENTENCE;
};

module.exports = { safeErr, SAFE_SENTENCE };
