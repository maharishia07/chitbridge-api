// @stage tested
// @stage-note The door check for a NUL byte (API-15); proved by tests/api-nul-input.test.cjs.
// CARD 28-platform-and-operations/api-standard
// owns: the one door check for text the database cannot hold: a NUL byte (\u0000) in a body, a query or a path is refused 400 INVALID_CHARACTER.
// called by: server.js (once, after the body parsers, before every router).
// FLOW  request → hasNul(path, query, body) → 400 problem+json | next()
'use strict';
/**
 * lib/input-hygiene.js — A NUL BYTE NEVER REACHES POSTGRES (API-15, BH-3, 2026-10-31).
 *
 * Postgres cannot store \u0000 in text and answers 22021 "invalid byte sequence". One NUL pasted from a PDF or sent by a barcode scanner made a whole
 * save or search answer 500 on 44 write routes and 6 reads. Every route catches its own errors, so translating 22021 in lib/knownerr.js would not
 * reach them; the door is the one place all of them pass. Only NUL is refused: a tab and a new line are text the database stores.
 *
 * refuseNul(req, res, next) — mount once after the parsers. Looks at the decoded path, the query (keys and values) and the parsed JSON / form body (keys and values, any depth).
 */
const { problem } = require('./problem');

const hasNulText = (text) => typeof text === 'string' && text.indexOf('\u0000') !== -1;

/** true when any string, key or nested value of `value` holds a NUL; a Buffer (raw webhook body) is left alone */
function hasNul(value, depth) {
  if (hasNulText(value)) return true;
  if (!value || typeof value !== 'object' || Buffer.isBuffer(value) || (depth || 0) > 40) return false;
  const next = (depth || 0) + 1;
  if (Array.isArray(value)) return value.some((item) => hasNul(item, next));
  return Object.keys(value).some((key) => hasNulText(key) || hasNul(value[key], next));
}

function refuseNul(req, res, next) {
  if (!(hasNul(req.path) || hasNul(req.query) || hasNul(req.body))) return next();
  return problem(req, res, { status: 400, code: 'INVALID_CHARACTER', detail: 'What was sent holds a character that cannot be saved (often pasted from a PDF or a scanner).', hint: 'Remove the odd character, or type that part again.' });
}

module.exports = { refuseNul, hasNul };
