// @stage tested
// @stage-note [TRADE · MAY/WHY] The one answer to "may this caller change a trade record?" — read by the trade GETs (readiness · lanes · forms)
// @stage-note so a refused button is greyed WITH its sentence, and asserted by every trade write (gather · verify · profile · issue · sign · attach).
'use strict';
/**
 * lib/trade-may.js — MAY THIS CALLER WRITE A TRADE RECORD? (TRADE-SRV1 G8, 2026-10-14)
 *
 * ⭐ THE SERVER DECIDES, ONCE. Before this file an API key (a connector) and a viewer co-assist could gather a clearance, verify a registry id,
 *   rewrite the trade profile, issue, sign and file a form — `auth` alone stood at every door, and no GET said may/why, so a screen could only
 *   find out by trying. The same pattern as routes/books.js fxMay and lib/people.js may.*: the GET carries { may, why, code } per action, the
 *   POST/PUT refuses with the SAME sentence and code (403). A sentence the client branches on ships with a code (REVIEW-standards 14 Oct).
 * ⭐ WHO MAY: a signed-in person with edit access (lib/access canEdit — the owner, or a co-assist the owner made an editor). Not an API key
 *   (a key reads and files chits; a trade record is a person's declaration). Not a viewer / commenter co-assist.
 * Flow: TRD step 1 · lanes (the may on the readiness screen) · step 3 · papers (the may on the forms page).
 */
const access = require('./access');

const CODES = {
  TRADE_KEY_NOT_ALLOWED: 'An API key may not change trade records — a person signs in and does it.',
  TRADE_READ_ONLY: 'Your access here is read-only — ask the owner to make you an editor.',
};

/** mayWrite(req) → { may: true, why: null, code: null } | { may: false, why, code } */
function mayWrite(req) {
  if (!req || req.api_key) return { may: false, why: CODES.TRADE_KEY_NOT_ALLOWED, code: 'TRADE_KEY_NOT_ALLOWED' };
  if (!access.canEdit(req.identity)) return { may: false, why: CODES.TRADE_READ_ONLY, code: 'TRADE_READ_ONLY' };
  return { may: true, why: null, code: null };
}

/** mayOf(req, ['gather', 'verify']) → { gather: { may, why, code }, verify: { … } } — the same answer under each action a screen shows */
function mayOf(req, actions) {
  const m = mayWrite(req), out = {};
  (actions || []).forEach((a) => { out[a] = Object.assign({}, m); });
  return out;
}

/** refuse(req, res) → true when the write was refused (403 written, in words with its code); false = go on */
function refuse(req, res) {
  const m = mayWrite(req);
  if (m.may) return false;
  res.status(403).json({ code: m.code, error: m.why, message: m.why });
  return true;
}

module.exports = { mayWrite, mayOf, refuse, CODES };
