/**
 * lib/holder.js — WHO HOLDS A REQUEST (M04, 2026-10-07). middleware/auth.js sets req.till = holderOf(decoded, keyRecord) on
 * every authenticated request. It lives in lib/ (not inside auth.js) so a test that stubs auth can still build the REAL shape
 * — a stub that invents its own holder is a second builder, and the day the shape grows (M05) the stub would lie.
 */
'use strict';

/**
 * holderOf(decoded, rec, sess) → req.till — THE ONE HOLDER BUILDER (M04, SPEC-iam-build §4.1). Every authenticated request
 * gets the same shape, whoever is behind it:
 *   holder     'key:'+jti (a machine: counter PC, connector, screen) · 'actor:'+identity_id (a co-assist) ·
 *              'person:'+identity_id (an owner's session) · 'dev:'+device_id (M05: a person session on a device)
 *   kind       'key' | 'actor' | 'person'
 *   key        { jti, scopes } for a key, else null — what req.api_key carried, so a reader switched to req.till answers
 *              exactly as it did (scope gates themselves still read req.api_key / requireScope, unchanged)
 *   counter    the key's claimed bill series (rec.till.id), or the device's (M05: policy_flags.devices[d].till.prefix), or null
 *   device_id  the device a person session is bound to (M05), else null
 *   by         the identity acting (a person/actor), or the key record's `by` when it names one
 *   session    M05: { jti, device_id, surface } for a person session (a token with a jti), else null
 * ⭐ M05 (2026-10-07): a person token that carries a jti is held by its DEVICE — holder 'dev:'+device_id. `kind` stays the
 * identity's ('person' | 'actor'). A legacy token (no jti) keeps the M04 holder, plus `session: null`. A second builder
 * anywhere is the bug this prevents.
 */
function holderOf(decoded, rec, sess) {
  const d = decoded || {};
  if (d.kind === 'api_key') {
    return { holder: 'key:' + d.jti, kind: 'key', key: { jti: d.jti, scopes: Array.isArray(d.scopes) ? d.scopes : [] },
             counter: (rec && rec.till && rec.till.id) || null, device_id: null, by: (rec && rec.by) || null, session: null };
  }
  const kind = d.identity_type === 'actor' ? 'actor' : 'person';
  if (d.jti && d.device_id) {
    return { holder: 'dev:' + d.device_id, kind, key: null, counter: (sess && sess.counter) || null, device_id: d.device_id,
             by: d.identity_id || null, session: { jti: d.jti, device_id: d.device_id, surface: d.surface || (sess && sess.surface) || null } };
  }
  return { holder: kind + ':' + d.identity_id, kind, key: null, counter: null, device_id: null, by: d.identity_id || null, session: null };
}
module.exports = { holderOf };
