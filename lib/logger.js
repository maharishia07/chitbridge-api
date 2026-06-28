// lib/logger.js — single leveled, toggleable, structured logger.
// Switch verbosity with LOG_LEVEL=debug|info|warn|error|critical (default: info).
// Emits one JSON line per event so logs are greppable/aggregatable (Railway stdout today).
// CRITICAL events also fire a registered sink (DB write / alert) — see log.onCritical().
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
