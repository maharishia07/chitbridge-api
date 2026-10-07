'use strict';
/**
 * /api/signin — A PERSON'S SESSIONS: renew · logout · list · revoke (M05, SPEC-iam-build §4.2, D3, D14).
 *
 *   POST /api/signin/renew              (person)  → { token, jti, exp, device_id } — new jti, same device, old jti gone
 *   POST /api/signin/logout             (person)  → { ok, removed } — removes this session's jti; 200 even if already gone
 *   GET  /api/signin/sessions           (person)  → { sessions:[…] } — my own sessions on every device in this shop
 *   GET  /api/signin/devices            (owner)   → { devices:[…] } — every device listed in this shop
 *   POST /api/signin/sessions/revoke    { jti }        — my own session, or (owner) anyone's
 *                                       { device_id }  — (owner) the device: revoked_at, every session on it ends
 *
 * The sign-in itself (ask · verify · pin) moves here in M06. Sessions are stored and judged in ONE place,
 * lib/person-session.js; a token is signed in ONE place, lib/identity-auth.js (issueToken / signToken).
 *
 * ⚠️ A KEY CANNOT SIGN IN. Every route here answers a key (kind:'api_key', a counter PC / connector / screen) 403 —
 * keys are listed and revoked on /api/keys.
 * ⭐ A LEGACY TOKEN (no jti, issued before M05 or by a page that did not name its device) is welcome here: logout answers
 * 200 (nothing listed to remove — the page clears itself), and renew turns it into a listed session when the request
 * names its device (X-Device-Id) — so a phone can move onto a revocable session without anybody signing in again.
 */
const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const auth = require('../middleware/auth');
const { query, withTransaction } = require('../db');
const sessions = require('../lib/person-session');
const identityAuth = require('../lib/identity-auth');
const { isOwner } = require('../lib/owner');

const personOnly = (req, res, next) => {
  if (req.api_key) { res.locals.code = 'KEY_CANNOT_SIGN_IN';
    return res.status(403).json({ error: 'Forbidden', code: 'KEY_CANNOT_SIGN_IN', message: 'A key cannot sign in — sign in.' }); }
  next();
};
const ownerOnly = (req, res, next) => (isOwner(req) ? next()
  : res.status(403).json({ error: 'Forbidden', message: 'Only the owner may do this.' }));
const fail = (res, e) => {
  const status = (e && e.status) || 500;
  if (e && e.code) res.locals.code = e.code;
  if (status >= 500) console.error('signin:', (e && e.message) || e);
  res.status(status).json({ error: status >= 500 ? 'Server error' : 'Refused', code: (e && e.code) || null,
                            message: status >= 500 ? 'Could not change your session. This is our fault.' : String(e.message) });
};
/** the claims of the token this request came with — auth already verified it */
const claimsOf = (req) => jwt.decode(String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')) || {};
const shopOf = (req) => auth.entityOf(req);
const me = (req) => req.identity.identity_id;

router.post('/renew', auth, personOnly, async (req, res) => {
  try {
    const shop = shopOf(req);
    let s;
    if (req.session) {
      s = await sessions.renew(withTransaction, shop, req.session.device_id, req.session.jti, me(req));
    } else {
      /* a legacy token: becomes a listed session on the device the request names — or stays as it is */
      const device_id = sessions.deviceIdOf(req.headers['x-device-id']);
      if (!device_id) return res.status(400).json({ error: 'Refused', code: 'NO_DEVICE', message: 'Send X-Device-Id to renew.' });
      s = await sessions.open(withTransaction, shop, { device_id, surface: (req.body && req.body.surface) || 'web', by: me(req),
        ua: String(req.headers['user-agent'] || '').slice(0, 160) || null });
    }
    const token = identityAuth.signToken(claimsOf(req), s);
    res.json({ token, jti: s.jti, exp: s.exp, device_id: s.device_id, surface: s.surface });
  } catch (e) { fail(res, e); }
});

router.post('/logout', auth, personOnly, async (req, res) => {
  try {
    if (!req.session) return res.json({ ok: true, removed: false, legacy: true });
    const out = await sessions.close(withTransaction, shopOf(req), req.session.device_id, req.session.jti);
    res.json({ ok: true, removed: out.removed });
  } catch (e) { fail(res, e); }
});

router.get('/sessions', auth, personOnly, async (req, res) => {
  try {
    const devices = await sessions.devicesOf(query, shopOf(req));
    const t = Math.floor(Date.now() / 1000), out = [];
    for (const [device_id, d] of Object.entries(devices)) {
      if (!d || d.revoked_at) continue;
      for (const s of (d.sessions || [])) {
        if (!s || s.by !== me(req) || Number(s.exp) <= t) continue;
        out.push({ jti: s.jti, device_id, surface: s.surface || null, iat: s.iat, exp: s.exp,
                   current: !!(req.session && req.session.jti === s.jti),
                   device: { label: d.label || null, kind: d.kind || null, seen: d.seen || null } });
      }
    }
    res.json({ sessions: out, legacy: !req.session });
  } catch (e) { fail(res, e); }
});

router.get('/devices', auth, personOnly, ownerOnly, async (req, res) => {
  try {
    const devices = await sessions.devicesOf(query, shopOf(req));
    const t = Math.floor(Date.now() / 1000);
    res.json({ devices: Object.entries(devices).map(([device_id, d]) => ({
      device_id, label: d.label || null, kind: d.kind || null, by: d.by || null, first_seen: d.first_seen || null, seen: d.seen || null,
      revoked_at: d.revoked_at || null, till_prefix: (d.till && d.till.prefix) || null,
      sessions: (d.sessions || []).filter((s) => s && Number(s.exp) > t).length })) });
  } catch (e) { fail(res, e); }
});

router.post('/sessions/revoke', auth, personOnly, async (req, res) => {
  try {
    const b = req.body || {}, shop = shopOf(req);
    if (b.device_id) {
      if (!isOwner(req)) return res.status(403).json({ error: 'Forbidden', message: 'Only the owner may remove a device.' });
      const device_id = sessions.deviceIdOf(b.device_id);
      if (!device_id) return res.status(400).json({ error: 'Refused', message: 'device_id is not a device id.' });
      const out = await sessions.revokeDevice(withTransaction, shop, device_id, me(req));
      if (!out.revoked) return res.status(404).json({ error: 'Not found', message: 'No such device in this shop.' });
      return res.json({ ok: true, revoked: 'device', device_id });
    }
    if (!b.jti) return res.status(400).json({ error: 'Refused', message: 'Send { jti } or { device_id }.' });
    /* whose session is it? — a person may end their own; the owner may end anyone's */
    const devices = await sessions.devicesOf(query, shop);
    let found = null;
    for (const [device_id, d] of Object.entries(devices))
      for (const s of ((d && d.sessions) || [])) if (s && String(s.jti) === String(b.jti)) found = { device_id, by: s.by };
    if (!found) return res.json({ ok: true, removed: false });
    if (found.by !== me(req) && !isOwner(req)) return res.status(403).json({ error: 'Forbidden', message: 'Only the owner may end another person’s session.' });
    const out = await sessions.close(withTransaction, shop, found.device_id, String(b.jti));
    res.json({ ok: true, revoked: 'session', removed: out.removed });
  } catch (e) { fail(res, e); }
});

module.exports = router;
