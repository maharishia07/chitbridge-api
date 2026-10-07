'use strict';
/**
 * lib/signin-events.js — the sign-in log writer (b282 `signin_events`, M06, SPEC-iam-build §b282, decision D11).
 *
 * Modelled on lib/access-events.js record() — a failed write NEVER fails the sign-in — but, unlike it was at first, NEVER
 * SILENT: every lost row is said with log.error('signin_events', { code }).
 *
 * ⚠️ b282 MAY NOT BE APPLIED YET (Athi runs migrations; code deploys first). An absent table (42P01) is logged ONCE per
 *   window (WINDOW_MS) with the number of rows lost since the last line — loud enough to be seen, not one line per
 *   sign-in. Any other failure (an RLS refusal 42501, a dead connection) is logged every time: that is a real lost row.
 * ⚠️ NO VALUE OUTSIDE THE b282 CHECK LISTS IS EVER SENT (IAM §30: a writer that cannot fail loudly must not be handed
 *   something it will fail at). ACTIONS / METHODS below ARE the migration's lists — tests/signin-routes.test.cjs reads
 *   migrations/b282_signin_events.sql and compares. A new value means widening the CHECK in the same PR.
 * ⭐ FIRE AND FORGET. A route calls record() without awaiting it: the row costs the person no round trip, and record()
 *   never rejects. flush() waits for the rows in flight (tests; a graceful shutdown).
 * ⭐ RLS WITH (b282 policy on app.current_entity): the INSERT runs inside withEntity(entity_id), so it files under the shop.
 *   An attempt with no shop (an unknown id) has no row here — the request log (res.locals.code NO_ACCOUNT) carries it.
 */
const net = require('net');
const log = require('./logger');

const ACTIONS = ['ask', 'in', 'fail', 'locked', 'renew', 'out', 'revoke', 'link', 'unlink', 'device_new', 'device_revoke'];
const METHODS = ['otp', 'pin', 'passkey', 'google', 'apple', 'microsoft', 'key'];
const WINDOW_MS = 10 * 60 * 1000;
const COLS = ['entity_id', 'identity_id', 'action', 'method', 'device_id', 'jti', 'ip', 'ua', 'code', 'surface'];

let _missing = { at: 0, lost: 0 };   // 42P01: when it was last said, and how many rows were lost since
const _pending = new Set();

function refuse(why, ev) {
  log.error('signin_events', { code: 'NOT_WRITTEN', why, action: ev && ev.action, method: ev && ev.method });
  return { written: false, code: 'NOT_WRITTEN', why };
}

async function write(ev) {
  const e = ev || {};
  if (!e.entity_id) return refuse('no entity_id (NOT NULL)', e);
  if (!ACTIONS.includes(e.action)) return refuse('action outside the b282 CHECK: ' + e.action, e);
  if (e.method != null && !METHODS.includes(e.method)) return refuse('method outside the b282 CHECK: ' + e.method, e);
  const row = {
    entity_id: e.entity_id, identity_id: e.identity_id || null, action: e.action, method: e.method || null,
    device_id: e.device_id ? String(e.device_id).slice(0, 80) : null, jti: e.jti || null,
    ip: e.ip && net.isIP(String(e.ip)) ? String(e.ip) : null,           // inet: an unparseable address is null, never an error
    ua: e.ua ? String(e.ua).slice(0, 160) : null, code: e.code ? String(e.code).slice(0, 60) : null,
    surface: e.surface ? String(e.surface).slice(0, 20) : null,
  };
  try {
    const { withEntity } = require('../db');
    await withEntity(row.entity_id, (db) => db.query(
      `INSERT INTO signin_events (${COLS.join(', ')}) VALUES (${COLS.map((_, i) => '$' + (i + 1)).join(', ')})`,
      COLS.map((c) => row[c])));
    return { written: true };
  } catch (err) {
    const code = (err && err.code) || 'UNKNOWN';
    if (code === '42P01') {
      _missing.lost++;
      const t = Date.now();
      if (!_missing.at || t - _missing.at >= WINDOW_MS) {
        log.error('signin_events', { code, why: 'b282 not applied — sign-in rows are being lost; sign-in itself is unaffected',
                                     lost_since_last_line: _missing.lost, window_min: WINDOW_MS / 60000 });
        _missing = { at: t, lost: 0 };
      }
    } else {
      log.error('signin_events', { code, why: (err && err.message) || String(err), action: row.action });
    }
    return { written: false, code };
  }
}

/** record(ev) → Promise<{ written, code? }> — never rejects; call it without await from a route */
function record(ev) {
  const p = write(ev).catch((err) => { log.error('signin_events', { code: 'WRITER_THREW', why: String(err && err.message) }); return { written: false }; });
  _pending.add(p);
  p.then(() => _pending.delete(p));
  return p;
}
async function flush() { while (_pending.size) await Promise.all(Array.from(_pending)); }

/** the request half of a row: device, surface, ua, ip — read the same way the sign-in door reads them */
function fromRequest(req) {
  const h = (req && req.headers) || {}, b = (req && req.body) || {};
  const sessions = require('./person-session');
  const d = sessions.deviceOfSignin(req);
  const ip = String(h['x-forwarded-for'] || '').split(',')[0].trim() || (req && req.ip) || '';
  return { device_id: d.device_id || null, surface: d.surface || (typeof b.surface === 'string' ? b.surface : null), ua: d.ua, ip };
}

module.exports = { record, flush, fromRequest, ACTIONS, METHODS, WINDOW_MS, _resetWindow: () => { _missing = { at: 0, lost: 0 }; } };
