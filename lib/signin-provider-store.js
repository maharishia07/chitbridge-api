// OWNS      the pre-binding read of provider links: linksFor(claims) through ops.signin_provider_links (b878)
// FLOW      checked claims (provider, issuer, tenant, subject) ──▶ ONE exact-match door ──▶ [{ link_id, identity_id, entity_id }] (≤ 10) or []
// CALLED BY routes/signin-provider.js (the callback) · tests/signin-provider.test.cjs
// CARD      18-identity-sign-in-and-access/sign-in
'use strict';
/**
 * lib/signin-provider-store.js — SEC-112 P0 (P0-DESIGN §2a). The callback has no shop yet, so it asks the ONE definer door (the b857 pattern) for the
 * links of one exact provider identity. Writes to the link table (P1a) go through withEntity(entity_id), under row security, and live beside this file.
 * ⚠️ b878 MAY NOT BE RUN YET: a missing door (42883) or table (42P01) answers [] and logs ONCE per window — "nobody is linked yet", the same as the truth until it runs.
 * ⭐ THE KEY IS (provider, issuer, tenant, subject). The e-mail never finds a link.
 */
const { query } = require('../db');
const log = require('./logger');

const WINDOW_MS = 10 * 60 * 1000;
let _said = 0;
const KEYS = ['provider', 'issuer', 'tenant', 'subject'];

/** linksFor(claims) → rows { link_id, identity_id, entity_id }, at most 10; [] when any key part is missing or the door is not there yet */
async function linksFor(claims) {
  const c = claims || {};
  if (KEYS.some((name) => name !== 'tenant' && (typeof c[name] !== 'string' || !c[name].trim()))) return [];
  try {
    const answer = await query('SELECT link_id, identity_id, entity_id FROM ops.signin_provider_links($1, $2, $3, $4)', [c.provider, c.issuer, typeof c.tenant === 'string' ? c.tenant : '', c.subject]);
    return answer.rows;
  } catch (failure) {
    const code = failure && failure.code;
    if (code !== '42883' && code !== '42P01' && code !== '3F000') throw failure;
    const t = Date.now();
    if (!_said || t - _said >= WINDOW_MS) {
      _said = t;
      log.error('signin_provider_store', { code, why: 'b878 is not applied: nobody can be found by a provider link until it is' });
    }
    return [];
  }
}

module.exports = { linksFor };
