'use strict';
/**
 * lib/clearance-gather.js — THE TWO THINGS THE CLEARANCE DOOR (POST /governance/compliance) CHECKS BEFORE lib/readiness.gatherDocument RECORDS (AR-F-06, walk AR 22 Nov 2026; split out so readiness.js holds its size row)
 * OWNER     cb-rail
 * RISK      trust: a clearance gathered with no evidence counted as MET, and an unknown standard answered "gathered" while recording nothing
 * OWNS      standardKnown · statusOf · refuseUnknown
 * CALLED BY routes/governance.js (POST /compliance) · tests/ar-1129.test.cjs
 * FLOW      body { standard_key, doc_key, evidence_ref } ──▶ refuseUnknown (422 STANDARD_UNKNOWN in words) ──▶ statusOf (no evidence = 'pending') ──▶ gatherDocument
 * CARD      23-compliance-trade-and-attestation/trade-readiness
 * The door only: a KYB credential (lib/kyb) may carry its own custom standard and gatherDocument itself never refuses one.
 */
const { withEntity } = require('../db');
const log = require('./logger');

/** → null when the platform knows the standard and its document, else the 422 refusal in words; a read that fails says nothing and lets the gather go on */
async function standardKnown(entity_id, standard_key, doc_key) {
  if (!standard_key || !doc_key) return null; /* gatherDocument's own 400 says it */
  const known = await withEntity(entity_id, (c) => c.query('SELECT 1 FROM standard_document WHERE standard_key = $1 AND doc_key = $2 LIMIT 1', [standard_key, doc_key])).catch((e) => {
    log.fellBack('clearance-gather: the standard read failed — the gather goes on', e);
    return null;
  });
  if (!known || known.rows.length) return null;
  return Object.assign(new Error('No standard "' + String(standard_key).slice(0, 60) + '" with a document "' + String(doc_key).slice(0, 60) + '" is known here, so nothing was recorded. Check the names against your readiness list.'), { status: 422, code: 'STANDARD_UNKNOWN' });
}
/** the status a clearance is recorded with: with evidence, the status as sent; with NONE, a 'declared' document stays declared (a self-declaration carries no file) and any other (gathered / documented) is 'pending' — a claim, never counted as met */
const statusOf = (evidence_ref, status) => (String(evidence_ref || '').trim() || status === 'declared' ? status : 'pending');
/** throws the refusal of an unknown standard / document (the route's catch answers it) */
async function refuseUnknown(entity_id, body) {
  const refusal = await standardKnown(entity_id, body.standard_key, body.doc_key);
  if (refusal) throw refusal;
}
module.exports = { standardKnown, statusOf, refuseUnknown };
