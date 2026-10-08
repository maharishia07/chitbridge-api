// @stage tested
// @stage-note Reached from db/index.js (armPool) and server.js (/health), which the boundary walk does not count as routes.
'use strict';
/**
 * ── E07 · THE SLOW-QUERY LOG — one JSON line per statement slower than DB_SLOW_MS (default 500), no SQL text ──────
 *
 * Every pooled connection's query() is timed (db/index.js arms each new connection). A slow one logs
 * `{ msg:'slow query', id, verb, fp, ms }` — the request id it ran under (lib/reqctx.js) and a FINGERPRINT of the
 * statement, never the statement: SQL text carries values (names, phone numbers, amounts) and a log is not where
 * they belong. The fingerprint is stable across values, so the same slow query on two requests has the same fp.
 *
 * A statement the database cancelled for running past its deadline (57014, E01) is logged the same way and its
 * code goes onto the request's own log line (res.locals.code = STATEMENT_TIMEOUT), even when the route catches
 * the error and answers a generic 500.
 */
const crypto = require('crypto');
const log = require('./logger');
const reqctx = require('./reqctx');

const slowMs = () => { const n = Number(process.env.DB_SLOW_MS); return Number.isFinite(n) && n >= 0 ? n : 500; };

/** values out, shape kept: strings, numbers, $n and IN-lists collapse; comments and spacing go */
function normalise(sql) {
  return String(sql || '')
    .replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, '?')
    .replace(/\$\d+/g, '?')
    .replace(/\b\d+(?:\.\d+)?\b/g, '?')
    .replace(/\(\s*\?(?:\s*,\s*\?)*\s*\)/g, '(?)')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}
const fingerprint = (sql) => crypto.createHash('sha1').update(normalise(sql)).digest('hex').slice(0, 12);
const verbOf = (sql) => (String(sql || '').replace(/^\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/|\s)*/, '').match(/^[a-z]+/i) || ['?'])[0].toUpperCase();

function textOf(arg) { return typeof arg === 'string' ? arg : (arg && typeof arg.text === 'string' ? arg.text : ''); }

function note(sql, ms, err, r) {
  if (err && err.code === '57014') {
    if (r && r.locals && !r.locals.code) r.locals.code = 'STATEMENT_TIMEOUT';
    log.warn('statement timeout', { id: r ? r.id : null, verb: verbOf(sql), fp: fingerprint(sql), ms });
    return;
  }
  if (ms > slowMs()) log.warn('slow query', { id: r ? r.id : null, verb: verbOf(sql), fp: fingerprint(sql), ms });
}

/** time every query on this client — promise form (client.query in a transaction) and callback form (pool.query
    calls it that way); a Submittable (cursor, stream) passes through untouched */
function watch(client) {
  if (!client || client.__cbWatched) return client;
  const orig = client.query;
  client.query = function (...args) {
    if (args[0] && typeof args[0].submit === 'function') return orig.apply(this, args);
    const t0 = Date.now(), sql = textOf(args[0]), r = reqctx.currentRequest();   /* caught NOW: a pg callback runs outside the request's context */
    const last = args[args.length - 1];
    if (typeof last === 'function') {
      args[args.length - 1] = function (err, res) { try { note(sql, Date.now() - t0, err || null, r); } catch (_) {} return last.apply(this, arguments); };
      return orig.apply(this, args);
    }
    const p = orig.apply(this, args);
    if (p && typeof p.then === 'function') p.then(() => { try { note(sql, Date.now() - t0, null, r); } catch (_) {} }, (e) => { try { note(sql, Date.now() - t0, e, r); } catch (_) {} });
    return p;
  };
  client.__cbWatched = true;
  return client;
}

module.exports = { watch, fingerprint, normalise, verbOf, slowMs };
