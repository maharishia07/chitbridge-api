'use strict';
/**
 * lib/person-session.js — A PERSON SIGNED IN ON A DEVICE: listed, bound, revocable (M05, SPEC-iam-build §3.3/§3.4, D3, D14).
 *
 * Until M05 an owner's or an employee's token was a bare 7-day JWT: no jti, no listing, nothing the shop could take back
 * (REVIEW-signin-iam I6). A person session now carries `jti` + `device_id` and is alive only while its jti is LISTED under
 * its device in the shop's `identities.policy_flags.devices` — the same "a credential is as alive as its listing" rule a
 * key already lives by (middleware/auth.js keyListed). No table, no SQL: `policy_flags` is already the home of `api_keys`
 * and `counters` (D14). docs/FIELDS.md has the entry.
 *
 *   policy_flags.devices[device_id] = { label, kind, by, first_seen, seen, ua, revoked_at?, revoked_by?,
 *                                       sessions: [{ jti, iat, exp, surface, by, renewed_from? }] }
 *
 * ⭐ LIFE (D3, Athi 2026-10-07): surface 'till' (a phone at the counter) 30 days, every other surface 7 days.
 *
 * ⚠️⚠️ ONLY A DEVICE THAT NAMED ITSELF GETS A SESSION. A session token is bound: every request must carry
 * `X-Device-Id` equal to the token's device_id. A client that never sent a device id at sign-in will not send the header
 * afterwards either — so binding it would turn every one of its requests into a 401. Today's pages send none, so they keep
 * getting today's token (legacy: no jti, unlisted, honoured until its own exp). The person door (M06) and the phone (M08)
 * send `device_id`; from then on a sign-in is a session.
 *
 * ⚠️ REVOCATION REACHES EVERY SERVER WITHIN 60 s. The answer for a jti is cached per process for CACHE_MS (60 s), exactly
 * as _keyCache does for keys. A revoke on THIS process forgets the jti at once; another process sees it when its cache
 * entry ages out — and an entry is never older than 60 s, so a revoked jti is refused within 60 s everywhere.
 * tests/person-session.test.cjs proves the bound with a fake clock (setClock).
 *
 * ⚠️ EVERY WRITE LOCKS THE ROW (FOR UPDATE) AND WRITES ONLY `devices` (jsonb_set) — the routes/keys.js mint() lesson: a
 * whole-object write from a stale read erases a concurrent writer's change. Two phones signing in at the same moment both
 * stay listed; sign-in on device B never touches device A.
 */
const crypto = require('crypto');

const DAY = 86400;
const LIFE = { till: 30 * DAY };            // seconds, by surface; anything else → DEFAULT_LIFE
const DEFAULT_LIFE = 7 * DAY;
const CACHE_MS = 60000;                     // ⚠️ the revocation bound — never raise it above 60 s
const RENEW_REPLAY_S = 60;                  // a renew repeated within 60 s answers the same new session (idempotent)
const MAX_SESSIONS_PER_DEVICE = 10;         // two or three people share a counter phone; ten is generous, and bounds the jsonb

let _now = () => Date.now();
/** tests only — a fake clock for the 60 s proof */
function setClock(fn) { _now = typeof fn === 'function' ? fn : () => Date.now(); }
const nowS = () => Math.floor(_now() / 1000);

/** a device id the page made (localStorage.cb_device_id): 8–80 of [A-Za-z0-9_.:-]; anything else is not a device id */
function deviceIdOf(v) {
  const s = v == null ? '' : String(v).trim();
  /* ⚠️ a device id becomes an object key in policy_flags.devices — never one that reaches Object.prototype */
  if (/^(__proto__|constructor|prototype)$/.test(s)) return null;
  return /^[A-Za-z0-9_.:-]{8,80}$/.test(s) ? s : null;
}
/** the surface the sign-in came from — a short lower-case word, else 'web' */
function surfaceOf(v) {
  const s = v == null ? '' : String(v).trim().toLowerCase();
  return /^[a-z]{2,16}$/.test(s) ? s : 'web';
}
/** D3 — how long a session on this surface lives, in seconds */
function lifeOf(surface) { return LIFE[surfaceOf(surface)] || DEFAULT_LIFE; }
/** the shop slot a person's devices are listed under — the business, never the employee's own row */
function shopOf(identity) { const i = identity || {}; return i.parent_entity_id || i.identity_id || null; }

/**
 * deviceOfSignin(req) → { device_id, surface, ua } — what a sign-in door hands issueToken(). The device id comes from the
 * body (`device_id`) or the X-Device-Id header; a door that has neither gets device_id null → today's legacy token.
 */
function deviceOfSignin(req) {
  const b = (req && req.body) || {}, h = (req && req.headers) || {};
  return { device_id: deviceIdOf(b.device_id) || deviceIdOf(h['x-device-id']), surface: surfaceOf(b.surface),
           ua: String(h['user-agent'] || '').slice(0, 160) || null };
}

/* ── the read side: is this jti alive? ─────────────────────────────────────────────────────────────────────────── */
const _cache = new Map();   // jti → { v: verdict, at }
function forget(jti) { _cache.delete(String(jti)); }

/**
 * verdictOf(devices, device_id, jti) → { ok:true, surface, counter } | { ok:false, code } — pure, the rule in one place.
 *   DEVICE_REVOKED   the owner removed this device (revoked_at), whatever sessions it lists
 *   SESSION_EXPIRED  the jti is not listed under this device (logout, revoke, renew, or never listed)
 * A jti that was RENEWED in the last 60 s also carries `renewed_to` — auth admits it to POST /api/signin/renew ONLY, so a
 * renew whose answer was lost can be repeated and gets the same new session (idempotent), while every other route
 * refuses the old token at once.
 */
function verdictOf(devices, device_id, jti) {
  const d = devices && Object.prototype.hasOwnProperty.call(devices, device_id) ? devices[device_id] : null;
  if (d && d.revoked_at) return { ok: false, code: 'DEVICE_REVOKED' };
  const s = d && Array.isArray(d.sessions) ? d.sessions.find((x) => x && String(x.jti) === String(jti)) : null;
  if (!s) {
    const t = nowS();
    const next = d && Array.isArray(d.sessions)
      ? d.sessions.find((x) => x && x.renewed_from === String(jti) && t - Number(x.iat) <= RENEW_REPLAY_S) : null;
    return next ? { ok: false, code: 'SESSION_EXPIRED', renewed_to: next.jti } : { ok: false, code: 'SESSION_EXPIRED' };
  }
  return { ok: true, surface: s.surface || null, counter: (d.till && d.till.prefix) || null };
}

/**
 * deviceListed(query, shop, device_id, jti) → verdict. One read of the shop's policy_flags per jti per 60 s.
 * ⚠️ A DATABASE FAULT THROWS (auth answers 500 "our fault") — it is never reported as "your session ended", which would
 * sign a person out over our outage.
 */
async function deviceListed(query, shop, device_id, jti) {
  const c = _cache.get(String(jti));
  if (c && _now() - c.at < CACHE_MS) return c.v;
  const r = await query('SELECT policy_flags FROM identities WHERE identity_id = $1', [shop]);
  const pf = (r.rows[0] && r.rows[0].policy_flags) || {};
  const v = verdictOf(pf.devices || {}, device_id, jti);
  _cache.set(String(jti), { v, at: _now() });
  return v;
}

/* ── the write side: one locked read, one jsonb_set of `devices` ──────────────────────────────────────────────── */
async function edit(withTransaction, shop, fn) {
  return withTransaction(async (db) => {
    const r = await db.query('SELECT policy_flags FROM identities WHERE identity_id = $1 FOR UPDATE', [shop]);
    if (!r.rows[0]) throw Object.assign(new Error('shop not found'), { status: 404 });
    const pf = r.rows[0].policy_flags || {};
    const devices = (pf.devices && typeof pf.devices === 'object' && !Array.isArray(pf.devices)) ? pf.devices : {};
    const out = fn(devices);
    if (out && out.unchanged) return out;
    await db.query(`UPDATE identities SET policy_flags = jsonb_set(COALESCE(policy_flags, '{}'::jsonb), '{devices}', $2::jsonb)
                     WHERE identity_id = $1`, [shop, JSON.stringify(devices)]);
    return out;
  });
}
const live = (sessions, t) => (Array.isArray(sessions) ? sessions : []).filter((s) => s && s.jti && !(Number(s.exp) <= t));
const iso = (s) => new Date(s * 1000).toISOString();

/**
 * open(withTransaction, shop, { device_id, surface, by, ua, label, kind, renewed_from? }) → { jti, iat, exp, surface, device_id }
 * Lists a new session under the device (made on first sign-in). Expired sessions on that device are dropped on the way.
 * ⚠️ A REVOKED DEVICE STAYS REVOKED: throws { status:403, code:'DEVICE_REVOKED' } — only the owner can let it back.
 */
async function open(withTransaction, shop, o) {
  const device_id = deviceIdOf(o && o.device_id);
  if (!device_id) throw Object.assign(new Error('device_id is required'), { status: 400, code: 'NO_DEVICE' });
  const surface = surfaceOf(o.surface), t = nowS();
  const sess = { jti: crypto.randomUUID(), iat: t, exp: t + lifeOf(surface), surface, by: o.by || null };
  if (o.renewed_from) sess.renewed_from = String(o.renewed_from);
  return edit(withTransaction, shop, (devices) => {
    const d = devices[device_id] || { label: null, kind: surface === 'till' ? 'till' : 'web', by: o.by || null,
                                      first_seen: iso(t), sessions: [] };
    if (d.revoked_at) throw Object.assign(new Error('The shop removed this device. Ask the owner.'), { status: 403, code: 'DEVICE_REVOKED' });
    d.sessions = live(d.sessions, t).concat([sess]).slice(-MAX_SESSIONS_PER_DEVICE);
    d.seen = iso(t);
    if (o.ua) d.ua = String(o.ua).slice(0, 160);
    if (o.label && !d.label) d.label = String(o.label).slice(0, 60);
    devices[device_id] = d;
    return { jti: sess.jti, iat: sess.iat, exp: sess.exp, surface, device_id };
  });
}

/**
 * close(withTransaction, shop, device_id, jti) → { removed } — logout, or a revoke of one session. Idempotent.
 * When device_id is null the jti is looked for under every device (an owner revoking a jti from the list).
 */
async function close(withTransaction, shop, device_id, jti) {
  const out = await edit(withTransaction, shop, (devices) => {
    let removed = false;
    for (const id of Object.keys(devices)) {
      if (device_id && id !== device_id) continue;
      const d = devices[id]; const before = Array.isArray(d.sessions) ? d.sessions.length : 0;
      d.sessions = (d.sessions || []).filter((s) => !(s && String(s.jti) === String(jti)));
      if (d.sessions.length !== before) removed = true;
    }
    return removed ? { removed } : { removed, unchanged: true };
  });
  forget(jti);
  return { removed: !!out.removed };
}

/**
 * renew(withTransaction, shop, device_id, jti, by) → the new session; the old jti is forgotten in the same write.
 * ⭐ IDEMPOTENT WITHIN 60 s: a renew repeated with the OLD jti (a retry whose answer was lost) answers the session that
 * renew already made, instead of failing — so a lost reply never signs a phone out.
 */
async function renew(withTransaction, shop, device_id, jti, by) {
  const t = nowS();
  const out = await edit(withTransaction, shop, (devices) => {
    const d = devices[device_id];
    if (!d || d.revoked_at) throw Object.assign(new Error('The shop removed this device. Ask the owner.'), { status: 401, code: 'DEVICE_REVOKED' });
    const ss = live(d.sessions, t);
    const again = ss.find((s) => s.renewed_from === String(jti) && t - Number(s.iat) <= RENEW_REPLAY_S);
    if (again) return { unchanged: true, sess: again };
    const old = ss.find((s) => String(s.jti) === String(jti));
    if (!old) throw Object.assign(new Error('Sign in to continue.'), { status: 401, code: 'SESSION_EXPIRED' });
    const sess = { jti: crypto.randomUUID(), iat: t, exp: t + lifeOf(old.surface), surface: old.surface, by: by || old.by || null,
                   renewed_from: String(jti) };
    d.sessions = ss.filter((s) => s !== old).concat([sess]).slice(-MAX_SESSIONS_PER_DEVICE);
    d.seen = iso(t);
    return { sess };
  });
  forget(jti);
  const s = out.sess;
  return { jti: s.jti, iat: s.iat, exp: s.exp, surface: s.surface, device_id };
}

/** revokeDevice(withTransaction, shop, device_id, by) → { revoked } — the owner removes a device: every session on it ends */
async function revokeDevice(withTransaction, shop, device_id, by) {
  const out = await edit(withTransaction, shop, (devices) => {
    const d = devices[device_id];
    if (!d) return { revoked: false, unchanged: true };
    const jtis = (d.sessions || []).map((s) => s && s.jti).filter(Boolean);
    d.revoked_at = iso(nowS()); d.revoked_by = by || null; d.sessions = [];
    return { revoked: true, jtis };
  });
  /* forgotten AFTER the write commits — forgetting first would let a request in between re-cache the old answer */
  (out.jtis || []).forEach(forget);
  return { revoked: !!out.revoked };
}

/** devicesOf(query, shop) → the listing as stored ({} when none) */
async function devicesOf(query, shop) {
  const r = await query('SELECT policy_flags FROM identities WHERE identity_id = $1', [shop]);
  const pf = (r.rows[0] && r.rows[0].policy_flags) || {};
  return (pf.devices && typeof pf.devices === 'object' && !Array.isArray(pf.devices)) ? pf.devices : {};
}

module.exports = {
  deviceIdOf, surfaceOf, lifeOf, shopOf, deviceOfSignin, verdictOf, deviceListed, forget, open, close, renew, revokeDevice, devicesOf,
  setClock, CACHE_MS, LIFE, DEFAULT_LIFE,
};
