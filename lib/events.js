/**
 * ⭐ THE MAILBOX BELL — server push, Server-Sent Events (SSE, WHATWG HTML §9.2; adopted, not invented).
 *
 * Athi, 2026-09-04: *"the periodic refresh is annoying — is there any different way of callback which notifies the
 * client with new data? Only the task has to be refreshed, if one comes — why can't we notify like a mailbox?"*
 *
 * A signed-in tab holds ONE open GET (/api/events/stream). When something ARRIVES for an entity — a chit sent to it,
 * an inbound message captured for it, a capture auto-raised into a chit — the API writes one small event down that
 * connection and the client refreshes only the list that changed. Nothing polls. The 20-second timer stays only as
 * a fallback, stretched to two minutes while the stream is up.
 *
 * ⚠️ WHY A TICKET. EventSource cannot send an Authorization header, and a session token in a URL lands in every
 * proxy log. So the client first POSTs (with its token) for a ONE-TIME ticket, 60 s to live, and opens the stream
 * with that. The ticket is spent on first use; the stream carries no token at all.
 *
 * ⚠️ SCOPE. Process-local: subscribers live in this process. One Railway instance today, so every write that emits
 * is in this process. A second instance needs Postgres LISTEN/NOTIFY fan-out (the hook is emitNotify below, unused
 * until then) — the client contract does not change.
 *
 * ⚠️ NOTHING SENSITIVE RIDES THE EVENT. kind · id · who (display name) · at. The client goes and READS through the
 * normal, RLS-guarded routes; the event only says "something moved".
 */
'use strict';
const crypto = require('crypto');
const subs = new Map();      // entity_id → Set<res>
const tickets = new Map();   // ticket → { entity_id, exp }
const MAX_PER_ENTITY = 6, TICKET_TTL_MS = 60 * 1000, HEARTBEAT_MS = 25 * 1000;

function ticketFor(entity_id) {
  const t = crypto.randomBytes(24).toString('base64url');
  tickets.set(t, { entity_id: String(entity_id), exp: Date.now() + TICKET_TTL_MS });
  if (tickets.size > 5000) for (const [k, v] of tickets) { if (v.exp < Date.now()) tickets.delete(k); }
  return { ticket: t, ttl_s: TICKET_TTL_MS / 1000 };
}
function spend(ticket) {
  const v = tickets.get(String(ticket || '')); if (!v) return null;
  tickets.delete(ticket); if (v.exp < Date.now()) return null;
  return v.entity_id;
}
function subscribe(entity_id, req, res) {
  const id = String(entity_id);
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 5000\n');
  res.write('event: hello\ndata: ' + JSON.stringify({ at: new Date().toISOString() }) + '\n\n');
  let set = subs.get(id); if (!set) { set = new Set(); subs.set(id, set); }
  if (set.size >= MAX_PER_ENTITY) { const first = set.values().next().value; try { first.end(); } catch (_) {} set.delete(first); }
  set.add(res);
  /**
   * ── ⭐⭐⭐ A TAB ALSO LISTENS ON THE SHARED TEST BOARD ─────────────────────────────────────────────────
   *
   * ⚠️⚠️ THIS IS THE TRAP IN MAKING THE BOARD PLATFORM DATA, AND IT WOULD HAVE FAILED SILENTLY. Channels
   * here are keyed by ENTITY, and a tab subscribes with its own. The moment the testing routes started
   * writing to the shared board entity, their announcements were emitted to a channel with no subscribers:
   * every retest notification would simply have stopped arriving, with no error anywhere — the loop would
   * look exactly like a loop where nobody had fixed anything. [[feedback-silence-is-the-bug]]
   *
   * ⭐ So a signed-in tab joins TWO channels: its own entity, and the board. No ticket change, no client
   * change — the board is a channel, and channels are this file's business.
   * ⚠️ Only when a board is configured, and never twice when the caller IS the board entity.
   */
  let bset = null;
  const board = require('./testboard').shared();
  if (board && board !== id) {
    bset = subs.get(board); if (!bset) { bset = new Set(); subs.set(board, bset); }
    /* ⚠️ NO MAX_PER_ENTITY EVICTION HERE. On the shared board that cap counts every tab on the platform, so
       enforcing it would have tabs silently evicting one another's board feed while their own stayed live. */
    bset.add(res);
  }
  /**
   * ⚠⚠⚠ A COMMENT IS INVISIBLE TO THE CLIENT ([TILL-167]). ': ping' keeps proxies from closing the stream,
   * and that is all it does: an SSE comment fires NO EventSource listener — not onmessage, not a named one.
   * So a browser could not tell a quiet bell from a dead one, which is how every counter and TV stayed deaf
   * for weeks while the connection was open the whole time. [[project-bell-was-deaf]]
   *
   * ⭐ BOTH GO OUT: the comment for the proxies, and a NAMED event the counter can actually hear and time.
   */
  const hb = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) {}
    try { res.write('event: ping\ndata: {"t":' + Date.now() + '}\n\n'); } catch (_) {}
  }, HEARTBEAT_MS);
  const bye = () => {
    clearInterval(hb);
    set.delete(res); if (!set.size) subs.delete(id);
    /* ⚠️ both memberships must be dropped, or a closed response stays in the board set for ever and every
       later emit writes to a dead socket */
    if (bset) { bset.delete(res); if (!bset.size) subs.delete(board); }
  };
  req.on('close', bye); res.on('error', bye);
}
/** emit(entity_ids, evt) — evt: { kind: 'chit'|'capture'|'task'|'pulse', id?, who?, note? } */
function emit(entity_ids, evt) {
  const ids = [].concat(entity_ids || []).filter(Boolean).map(String);
  const payload = 'event: cb\ndata: ' + JSON.stringify(Object.assign({ at: new Date().toISOString() }, evt || {})) + '\n\n';
  let n = 0;
  for (const id of new Set(ids)) { const set = subs.get(id); if (!set) continue; for (const res of set) { try { res.write(payload); n++; } catch (_) {} } }
  return n;
}
/** notifyAfter(res, entity_ids, evt) — emit once the response has gone out (after the transaction committed). */
function notifyAfter(res, entity_ids, evt) {
  if (!res || res.locals.__cb_notify_hooked) { if (res) (res.locals.__cb_notify = res.locals.__cb_notify || []).push([entity_ids, evt]); return; }
  res.locals.__cb_notify_hooked = true; res.locals.__cb_notify = [[entity_ids, evt]];
  res.on('finish', () => { if (res.statusCode < 300) for (const [ids, e] of res.locals.__cb_notify) { try { emit(ids, e); } catch (_) {} } });
}
function stats() { let conns = 0; for (const s of subs.values()) conns += s.size; return { entities: subs.size, connections: conns, tickets: tickets.size }; }
module.exports = { ticketFor, spend, subscribe, emit, notifyAfter, stats };
