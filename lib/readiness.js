// lib/readiness.js — TRADE READINESS roll-up. For an entity, resolve the documents its standards require (from the
// b90 catalogue) against what it has GATHERED (per-entity evidence), producing the status that feeds BOTH the supplier
// "trade readiness" view and the buyer "trade confidence" view. gatherDocument() records a gathered clearance.
const { query, withEntity } = require('../db');
const EXPIRE_SOON_DAYS = 60;

// the standard keys that apply to this entity: its boilerplate's DECLARED standards, else all active (self-healing).
async function standardKeysFor(entity_id) {
  try {
    const { entityBoilerplateKey, resolveBoilerplate } = require('./boilerplate');
    const bk = await entityBoilerplateKey(withEntity, entity_id);
    if (bk) { const bp = await resolveBoilerplate(bk); if (bp && bp.standards) { const k = Object.values(bp.standards).map(r => String(r).split('@')[0]); if (k.length) return k; } }
  } catch (_) {}
  try { const r = await query(`SELECT DISTINCT standard_key FROM standard_source WHERE active = true`); return r.rows.map(x => x.standard_key); } catch (_) { return []; }
}

// resolveReadiness(entity_id) → { standards, items[], summary }. Server-mediated, so it serves the entity's OWN view
// AND a counterparty's shareable passport (status + validity only — never raw evidence contents).
async function resolveReadiness(entity_id) {
  const docsFor = async (ks) => {
    if (!ks || !ks.length) return [];
    try {
      const r = await query(
        `SELECT standard_key, doc_key, title, mandate, capture_type, scope, frequency, display_order
           FROM standard_document WHERE standard_key = ANY($1) ORDER BY standard_key, display_order`, [ks]);
      return r.rows;
    } catch (_) { return []; /* b90 not applied */ }
  };
  const keys = await standardKeysFor(entity_id);
  let docs = await docsFor(keys);
  // FLOOR: if the resolved standards carry no documents, fall back to the GLOBAL active standards' docs — so an entity
  // is never shown "no standards" while active standards exist (handles a boilerplate that declares undocumented keys).
  if (!docs.length) {
    try {
      const g = await query(`SELECT DISTINCT standard_key FROM standard_source WHERE active = true`);
      const gd = await docsFor(g.rows.map(x => x.standard_key));
      if (gd.length) docs = gd;
    } catch (_) {}
  }
  const gathered = {};
  try {
    const g = await withEntity(entity_id, (c) => c.query(
      `SELECT standard_key, doc_key, status, evidence_ref, valid_until FROM entity_compliance WHERE entity_id = $1`, [entity_id]));
    for (const row of g.rows) gathered[row.standard_key + '|' + row.doc_key] = row;
  } catch (_) {}
  const today = new Date();
  const items = docs.map(d => {
    const ev = gathered[d.standard_key + '|' + d.doc_key];
    let status = 'pending';
    if (ev) {
      status = ev.status || 'gathered';
      if (ev.valid_until) {
        const vu = new Date(ev.valid_until);
        if (vu < today) status = 'expired';
        else if ((vu - today) / 86400000 < EXPIRE_SOON_DAYS) status = 'expiring';
      }
    }
    return { standard: d.standard_key, doc: d.doc_key, title: d.title, scope: d.scope, frequency: d.frequency,
      status, evidence_ref: (ev && ev.evidence_ref) || null, valid_until: (ev && ev.valid_until) || null };
  });
  const met = items.filter(i => i.status === 'gathered' || i.status === 'expiring').length;
  const summary = {
    total: items.length, met,
    pending: items.filter(i => i.status === 'pending').length,
    expiring: items.filter(i => i.status === 'expiring').length,
    expired: items.filter(i => i.status === 'expired').length,
    ready: items.length > 0 && items.every(i => i.status === 'gathered' || i.status === 'expiring'),
    percent: items.length ? Math.round((met / items.length) * 100) : 0,
  };
  // NOTE: key is `clearances` (not `items`) on purpose — the web client's unwrap() would strip a top-level `items`
  // array and drop standards/summary. `clearances` passes through whole.
  return { standards: keys, clearances: items, summary };
}

// gatherDocument — record/refresh a gathered clearance for the acting entity (the supplier's "gather" action).
async function gatherDocument(entity_id, { standard_key, doc_key, evidence_ref, valid_until, status }) {
  if (!standard_key || !doc_key) { const e = new Error('standard_key and doc_key required'); e.status = 400; throw e; }
  return withEntity(entity_id, (c) => c.query(
    `INSERT INTO entity_compliance (entity_id, standard_key, doc_key, status, evidence_ref, valid_until)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (entity_id, standard_key, doc_key)
       DO UPDATE SET status = EXCLUDED.status, evidence_ref = EXCLUDED.evidence_ref, valid_until = EXCLUDED.valid_until, gathered_at = now()`,
    [entity_id, standard_key, doc_key, status || 'gathered', evidence_ref || null, valid_until || null]));
}

module.exports = { resolveReadiness, gatherDocument };
