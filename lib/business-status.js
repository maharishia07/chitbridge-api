'use strict';
/**
 * lib/business-status.js — HAS THIS BUSINESS ENDED? An erased or closed business opens no door: no sign-in, no renewal,
 * no session, no key (FABLE-RISK-2 R2-03). The status lives on the business's own identities row (`status`, set to
 * 'erased' by PATCH /entities/:id/erase); this is the ONE place that names which values end a business.
 *
 * OWNS      endedStatus(status) · businessEnded(entity_id, run) (one read per business per minute) · forget(entity_id)
 * FLOW      middleware/auth.js judge → businessEnded (every request) · lib/identity-auth.js verifyCredential → endedStatus / businessEnded (every sign-in)
 * CARD      18-identity-sign-in-and-access/sessions-and-devices
 */
const ENDED = new Set(['erased', 'closed']);
const CACHE_MS = 60 * 1000; /* the same minute a revoked key and a removed device take to reach every server */
const seen = new Map(); // entity_id → { ended, at }

/** endedStatus(status) → true for a status that ends a business ('pending', 'active' and an unset status do not) */
const endedStatus = (status) => ENDED.has(String(status == null ? '' : status).toLowerCase());

/**
 * businessEnded(entity_id, run) → true when the business is erased or closed, or when its status cannot be read (fails closed).
 * A business that is not found is not "ended": its row is checked where the credential is checked, and a stand-in database that
 * answers no rows must not lock out the callers that never asked for this.
 */
async function businessEnded(entity_id, run) {
  if (!entity_id) return false;
  const known = seen.get(entity_id);
  if (known && Date.now() - known.at < CACHE_MS) return known.ended;
  try {
    const r = await run('SELECT status FROM identities WHERE identity_id = $1', [entity_id]);
    const ended = endedStatus(r && r.rows && r.rows[0] && r.rows[0].status);
    seen.set(entity_id, { ended, at: Date.now() });
    return ended;
  } catch (_) {
    return true;
  }
}

/** forget(entity_id) — drop the remembered answer (the erase door calls it, so this server refuses at once, not within the minute) */
const forget = (entity_id) => seen.delete(entity_id);

module.exports = { endedStatus, businessEnded, forget };
