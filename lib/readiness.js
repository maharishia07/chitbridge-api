// lib/readiness.js — TRADE READINESS roll-up + destination-resolved lanes. GENERIC: requirements are DERIVED from
// rules + attributes, never enumerated. The bridge (b91): required = HOME rules (origin export) ∪ DESTINATION rules
// (their import) ∪ UNIVERSAL (org quality, product hazard). Each STANDARD carries the predicate; resolution matches.
// See SPEC-trade-lane-confidence.md. Guidance on each gap = go as far as we can verify, GUIDE the rest.
const { query, withEntity } = require('../db');
const EXPIRE_SOON_DAYS = 60;

// ── shared helpers ──────────────────────────────────────────────────────────
async function docsFor(keys) {
  if (!keys || !keys.length) return [];
  try {
    const r = await query(
      `SELECT standard_key, doc_key, title, scope, frequency, display_order
         FROM standard_document WHERE standard_key = ANY($1) ORDER BY standard_key, display_order`, [keys]);
    return r.rows;
  } catch (_) { return []; }
}
async function gatheredFor(entity_id) {
  const map = {};
  try {
    const g = await withEntity(entity_id, (c) => c.query(
      `SELECT standard_key, doc_key, status, evidence_ref, valid_until, verification FROM entity_compliance WHERE entity_id = $1`, [entity_id]));
    for (const row of g.rows) map[row.standard_key + '|' + row.doc_key] = row;
  } catch (_) {}
  return map;
}
// the TRUST RUNG of a gathered clearance: verified (registry-checked) > attested (a party vouched) > documented
// (a chit/document on the rail) > declared (a bare claim). Derived from the verification stamp + the evidence.
function rungOf(ev) {
  if (!ev) return null;
  const v = ev.verification || {};
  if (v.method === 'registry') return 'verified';
  if (v.method === 'attested') return 'attested';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(String(ev.evidence_ref || ''))) return 'documented';   // an evidence chit_id
  return 'declared';
}
function buildItems(docs, gathered, guidanceByStd) {
  const today = new Date();
  return docs.map(d => {
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
    const met = status === 'gathered' || status === 'expiring';
    return { standard: d.standard_key, doc: d.doc_key, title: d.title, scope: d.scope, frequency: d.frequency,
      status, rung: ev ? rungOf(ev) : null, evidence_ref: (ev && ev.evidence_ref) || null, valid_until: (ev && ev.valid_until) || null,
      verified_at: (ev && ev.verification && ev.verification.verified_at) || null,          // WHEN the platform confirmed it
      verified_by: (ev && ev.verification && ev.verification.provider) || null,             // which source confirmed it
      guidance: (!met && guidanceByStd && guidanceByStd[d.standard_key]) || null };   // guide the rest
  });
}
function summarize(items) {
  const met = items.filter(i => i.status === 'gathered' || i.status === 'expiring').length;
  return {
    total: items.length, met,
    pending: items.filter(i => i.status === 'pending').length,
    expiring: items.filter(i => i.status === 'expiring').length,
    expired: items.filter(i => i.status === 'expired').length,
    ready: items.length > 0 && items.every(i => i.status === 'gathered' || i.status === 'expiring'),
    percent: items.length ? Math.round((met / items.length) * 100) : 0,
    verified: items.filter(i => i.rung === 'verified').length,
    attested: items.filter(i => i.rung === 'attested').length,
    documented: items.filter(i => i.rung === 'documented').length,
  };
}

// ── the entity's own standards (boilerplate, else global) — the non-destination "My readiness" ──
async function standardKeysFor(entity_id) {
  try {
    const { entityBoilerplateKey, resolveBoilerplate } = require('./boilerplate');
    const bk = await entityBoilerplateKey(withEntity, entity_id);
    if (bk) { const bp = await resolveBoilerplate(bk); if (bp && bp.standards) { const k = Object.values(bp.standards).map(r => String(r).split('@')[0]); if (k.length) return k; } }
  } catch (_) {}
  try { const r = await query(`SELECT DISTINCT standard_key FROM standard_source WHERE active = true AND COALESCE(facet,'') <> 'commerce'`); return r.rows.map(x => x.standard_key); } catch (_) { return []; }
}
async function resolveReadiness(entity_id) {
  let keys = await standardKeysFor(entity_id);
  let docs = await docsFor(keys);
  if (!docs.length) {   // FLOOR: never empty while active standards exist
    try { const g = await query(`SELECT DISTINCT standard_key FROM standard_source WHERE active = true AND COALESCE(facet,'') <> 'commerce'`); const gd = await docsFor(g.rows.map(x => x.standard_key)); if (gd.length) { docs = gd; keys = g.rows.map(x => x.standard_key); } } catch (_) {}
  }
  const items = buildItems(docs, await gatheredFor(entity_id), null);
  /* ⭐ the INVOICE HEADER is a clearance too (GST Rule 46 — Athi, 2026-09-04: "tied with trade ready"): the same
     reader the Invoice row uses, so the two can never disagree. Never fails the roll-up if the read itself fails. */
  try {
    const party = await require('./profile').invoiceParty(entity_id);
    items.push({ standard: 'IN-GST', doc: 'invoice_header', title: 'Invoice header — supplier details (GST Rule 46)', scope: 'org', frequency: 'once',
      status: party.complete ? 'gathered' : 'pending', rung: party.complete ? 'declared' : null, evidence_ref: null, valid_until: null, verified_at: null, verified_by: null,
      guidance: party.complete ? null : ('Missing: ' + party.missing.join(', ') + ' — ' + party.fix) });
  } catch (_) {}
  return { standards: keys, clearances: items, summary: summarize(items) };
}

// ── b91 · TRADE LANES — the generic bridge (origin rules ∪ destination rules ∪ universal) ──
async function jurisdictions() {
  try { const r = await query(`SELECT dest_key, name, domestic FROM jurisdiction ORDER BY display_order`); return r.rows; } catch (_) { return []; }
}
async function verticalCategories(vertical) {
  try { const r = await query(`SELECT category FROM vertical_category WHERE vertical = $1`, [vertical || 'paint']); return r.rows.map(x => x.category); } catch (_) { return []; }
}
async function activeStandards() {
  try { const r = await query(`SELECT DISTINCT ON (standard_key) standard_key, title, applicability, guidance FROM standard_source WHERE active = true AND COALESCE(facet,'') <> 'commerce' ORDER BY standard_key, minted_at DESC`); return r.rows; } catch (_) { return []; }
}
// ⭐ THE ALGORITHM — a standard applies to a lane (origin → destination, product categories) if its home-rule, its
// destination-rule, its cross-border flag AND its category all match. An empty condition = "not conditioned on this".
function standardApplies(std, origin, dest_key, categories) {
  const a = std.applicability || {}, org = a.origin || [], dst = a.destination || [], cats = a.categories || [];
  const originOk = !org.length || org.indexOf('any') >= 0 || org.indexOf(origin) >= 0;
  const destOk   = !dst.length || dst.indexOf('any') >= 0 || dst.indexOf(dest_key) >= 0;
  const crossOk  = !a.cross_border || (origin !== dest_key);          // export-only rules (e.g. export policy)
  const catOk    = !cats.length || cats.some(c => categories.indexOf(c) >= 0);
  return originOk && destOk && crossOk && catOk;
}

// resolveForDestination(entity, dest, vertical, origin) → readiness DERIVED for exporting FROM origin TO dest, w/ guidance.
async function resolveForDestination(entity_id, dest_key, vertical, origin) {
  origin = origin || 'IN';
  const juris = await jurisdictions(), d = juris.find(x => x.dest_key === dest_key);
  const cats = await verticalCategories(vertical);
  const stds = (await activeStandards()).filter(s => standardApplies(s, origin, dest_key, cats));
  const keys = stds.map(s => s.standard_key);
  const guidance = {}; for (const s of stds) guidance[s.standard_key] = s.guidance;
  const items = buildItems(await docsFor(keys), await gatheredFor(entity_id), guidance);
  return { origin, destination: dest_key, dest_name: (d && d.name) || dest_key, standards: keys, clearances: items, summary: summarize(items) };
}

// resolveLaneMatrix(entity, vertical, origin) → readiness % per destination + gap standards (the eye-opener). All DERIVED.
async function resolveLaneMatrix(entity_id, vertical, origin) {
  origin = origin || 'IN';
  const juris = await jurisdictions(), cats = await verticalCategories(vertical);
  const allStds = await activeStandards(), gathered = await gatheredFor(entity_id);
  const titles = {}; for (const s of allStds) titles[s.standard_key] = s.title;
  const out = [];
  for (const d of juris) {
    const stds = allStds.filter(s => standardApplies(s, origin, d.dest_key, cats));
    const items = buildItems(await docsFor(stds.map(s => s.standard_key)), gathered, null);
    const s = summarize(items);
    const gapKeys = [...new Set(items.filter(i => i.status !== 'gathered' && i.status !== 'expiring').map(i => i.standard))];
    out.push({ dest_key: d.dest_key, dest_name: d.name, percent: s.percent, met: s.met, total: s.total, ready: s.ready,
      gaps: gapKeys.map(k => titles[k] || k) });
  }
  return { vertical: vertical || 'paint', origin, lanes: out };
}

// gatherDocument — record/refresh a gathered clearance for the acting entity.
async function gatherDocument(entity_id, { standard_key, doc_key, evidence_ref, valid_until, status, verification, trusted }) {
  if (!standard_key || !doc_key) { const e = new Error('standard_key and doc_key required'); e.status = 400; throw e; }
  // T1 (reviewer 2026-07-13) — defense in depth: the verification stamp is the PLATFORM's attestation. Only a TRUSTED
  // caller (the /verify path) may assert 'registry'/'attested'. Any untrusted verification claiming those is dropped,
  // so rungOf() can never mint 'verified'/'attested' from an entity's own write, even if a future caller forgets.
  let ver = verification || {};
  if (!trusted && (ver.method === 'registry' || ver.method === 'attested')) ver = {};
  // T4 (reviewer 2026-07-13) — `documented` must mean a REAL evidence chit owned by this entity, not just a UUID-shaped
  // string. If evidence_ref looks like a chit_id but no owned chit exists, null it so rungOf() drops to `declared`.
  let ref = evidence_ref || null;
  if (ref && /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(String(ref))) {
    try {
      const chk = await withEntity(entity_id, (c) => c.query('SELECT 1 FROM chit_status WHERE chit_id = $1 LIMIT 1', [ref]));
      if (!chk.rows.length) ref = null;   // no owned chit behind it → not a document on the rail
    } catch (_) { /* if the check itself fails, be conservative: keep ref (RLS still scopes reads) */ }
  }
  return withEntity(entity_id, (c) => c.query(
    `INSERT INTO entity_compliance (entity_id, standard_key, doc_key, status, evidence_ref, valid_until, verification)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
     ON CONFLICT (entity_id, standard_key, doc_key)
       DO UPDATE SET status = EXCLUDED.status, evidence_ref = EXCLUDED.evidence_ref, valid_until = EXCLUDED.valid_until,
         verification = CASE WHEN EXCLUDED.verification = '{}'::jsonb THEN entity_compliance.verification ELSE EXCLUDED.verification END,
         gathered_at = now()`,
    [entity_id, standard_key, doc_key, status || 'gathered', ref, valid_until || null, JSON.stringify(ver)]));
}

module.exports = { resolveReadiness, resolveForDestination, resolveLaneMatrix, gatherDocument };
