'use strict';
/**
 * lib/lead-may.js — may this seat move the lead? (DRIFT 21, PROOF-2026-11-27 row 21)
 * OWNER     crm (cb-crm)
 * RISK      saying "may" for a seat the stage POST refuses draws a live button that then answers 403 READ_ONLY.
 * OWNS      leadMay(ready, may) (no route, no state)
 * CALLED BY routes/crm.js GET /parties/:id (rec.lead.may)
 * FLOW      leads migrated? no → NOT_READY words · yes → the seat's own write verdict (lib/access.mayWrite via crmMay(req).write) → { ok, code?, why? }
 * CARD      11-crm-and-marketing/crm-leads
 */
const memberships = require('./memberships');
/** the lead's "Move to…" may: b297 not run -> M.NOT_READY; else the verdict the stage POST refuses with (a viewer or commenter is greyed with the rail's sentence and code) */
function leadMay(ready, may) {
  if (!ready) return { ok: false, why: memberships.NOT_READY };
  return may.write.may ? { ok: true } : { ok: false, code: may.write.code, why: may.write.why };
}
module.exports = { leadMay };
