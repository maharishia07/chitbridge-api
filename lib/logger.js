// lib/logger.js — single leveled, toggleable, structured logger.
// Switch verbosity with LOG_LEVEL=debug|info|warn|error|critical (default: info).
// Emits one JSON line per event so logs are greppable/aggregatable (Railway stdout today).
// CRITICAL events also fire a registered sink (DB write / alert) — see log.onCritical().
/**
 * ⭐⭐ THE TAXONOMY — WHAT EACH LEVEL MEANS, so the level keeps meaning something. Athi, 2026-08-22: *"other
 * than success, any other failure should be written as warning, error, critical — the standard way."*
 *
 * ⚠️⚠️ WITHOUT A WRITTEN RULE EVERY DEVELOPER PICKS `error`, and within a month the level is decoration: you
 * cannot alert on it, cannot filter by it, and the one genuinely urgent line is buried among four hundred
 * routine ones. The rule below is the whole point of having levels at all.
 *
 * The test for each is **who should act, and how soon** — not how bad the code felt when it was written.
 *
 *   debug     Nobody acts. Tracing while developing. Off in production by default.
 *             e.g. "GET inbox", cache hit, which branch was taken.
 *
 *   info      Nobody acts. A thing happened that a human might later ask about.
 *             e.g. request received, migration applied, entity registered.
 *
 *   warn      ⚠️ SOMETHING IS WRONG AND THE REQUEST STILL SUCCEEDED. This is the level that catches this
 *             codebase's characteristic bug — the SILENT one. A fallback was used, a column was missing and
 *             defaulted, a cap truncated a list, an optional lookup failed and was swallowed.
 *             **If you are about to write a bare `catch(_) {}`, that is a warn.**
 *             e.g. "pulse query failed, refreshing anyway", "b130 not applied, policy flags not stored".
 *
 *   error     ⚠️ THIS REQUEST FAILED. One person is stuck right now. Someone should look today.
 *             e.g. a 500, a failed write, an upstream that would not answer.
 *
 *   critical  ⚠️⚠️ SOMETHING IS WRONG FOR EVERYONE, OR DATA IS AT RISK. Wake someone.
 *             e.g. the database is unreachable, RLS is off on a tenant table, a migration half-applied, an
 *             attachment row exists whose bytes never landed.
 *             ⭐ Only `critical` fires `onCritical` — so this level is also a promise that the sink can keep.
 *             If everything is critical, the alert is noise and gets muted, and then nothing is critical.
 *
 * ⚠️ ALWAYS PASS THE CORRELATION ID: `log.warn('…', { id: req.id })`. Without it a line is a fact with no
 * story — you can see that something failed and never which request, which entity, or what the person was
 * doing. `req.id` is minted or propagated in server.js and echoed as `X-Request-Id`, so a client report and a
 * server line can be joined by it. That join is impossible to reconstruct afterwards.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, critical: 50 };
const threshold = LEVELS[String(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

let criticalSink = null; // register later: log.onCritical(rec => writeToErrorLogTable/alert(rec))

function emit(level, msg, ctx) {
  if (LEVELS[level] < threshold) return;
  const rec = { t: new Date().toISOString(), level, msg, ...(ctx || {}) };
  const line = JSON.stringify(rec);
  if (LEVELS[level] >= LEVELS.error) console.error(line); else console.log(line);
  if (level === 'critical' && typeof criticalSink === 'function') {
    try { criticalSink(rec); } catch (e) { console.error('criticalSink failed:', e.message); }
  }
}

const log = {
  debug:    (msg, ctx) => emit('debug', msg, ctx),
  info:     (msg, ctx) => emit('info', msg, ctx),
  warn:     (msg, ctx) => emit('warn', msg, ctx),
  error:    (msg, ctx) => emit('error', msg, ctx),
  critical: (msg, ctx) => emit('critical', msg, ctx),
  onCritical: (fn) => { criticalSink = fn; },  // wire the sink (error_log table / alert) when built
};

module.exports = log;
