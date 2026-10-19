// lib/respond.js — keep internal/DB error text out of client responses.
// CALLED BY routes/actors.js, routes/adopt.js, routes/assist.js, routes/attachments.js, routes/books.js (+40 more)   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
// Logs the real error server-side (so nothing is lost) and returns a generic client message.
// Used as the `message` field in route 500 handlers: res.status(500).json({ error:'X', message: safeErr(err) }).
const log = require('./logger');
const safeErr = (err) => {
  if (err) log.error('API error', { err: err.message || String(err), stack: err.stack });
  return 'Something went wrong — please try again.';
};

module.exports = { safeErr };
