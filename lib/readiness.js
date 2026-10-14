const versionref = require('./versionref');
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
    if (bk) { const bp = await resolveBoilerplate(bk); if (bp && bp.standards) { const k = Object.values(bp.standards).map((r) => versionref.keyOf(r)); if (k.length) return k; } }
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
  /* TRADE-SRV1 G2 (grep the siblings of a removed India default): the GST Rule 46 header row and the GSTIN row are INDIA's law — an AU or AE
     shop, or one with no country yet, is not told to gather a GSTIN. invoiceParty already carries the shop's country (no extra read). */
  let party = null;
  try { party = await require('./profile').invoiceParty(entity_id); } catch (_) { party = null; }
  const india = !!party && String(party.country || '').toUpperCase() === 'IN';
  if (india) try {
    const P = require('./profile'); const PM = require('./profile-map');
    /* ⭐ THE RUNG FOLLOWS THE PROFILE MAP (Athi, 2026-09-05: "that should get Trade ready updated, so when another connects from
       the supplier network it reflects better"). The header's rung is the LOWEST rung among the fields it is made of:
       declared (typed) → documented (copied from the store's own books, or checked by our arithmetic) → verified (registry).
       A counterparty reading this entity's readiness sees the same item, so the view improves the moment the sync runs. */
    let rung = party.complete ? 'declared' : null, note = null;
    try {
      const a = PM.assess(await P.profileValues(entity_id));
      const keys = ['legal_name', 'gstin', 'state', 'address'].concat(a.fields.phone.value ? ['phone'] : (a.fields.email.value ? ['email'] : []));
      const rungs = keys.map((k) => (a.fields[k] && a.fields[k].rung) || 'declared');
      const low = rungs.reduce((m, r) => (PM.rank(r) < PM.rank(m) ? r : m), 'verified');
      if (party.complete) rung = low === 'verified' ? 'verified' : (low === 'declared' ? 'declared' : 'documented');
      const g = a.fields.gstin;
      if (party.complete && g && g.value) note = 'GSTIN ' + (g.rung === 'verified' ? 'verified against the registry' : g.rung === 'checked' ? 'check digit and state agree' : g.rung === 'copied' ? 'copied from ' + (g.source || 'the store\'s system') : 'as typed') + (g.as_of ? ' · ' + String(g.as_of).slice(0, 10) : '') + (a.issues.length ? ' · ⚠ ' + a.issues.map((i) => i.issue).join('; ') : '');
    } catch (_) {}
    items.push({ standard: 'IN-GST', doc: 'invoice_header', title: 'Invoice header — supplier details (GST Rule 46)', scope: 'org', frequency: 'once',
      status: party.complete ? 'gathered' : 'pending', rung, evidence_ref: null, valid_until: null, verified_at: null, verified_by: null,
      guidance: party.complete ? note : ('Missing: ' + party.missing.join(', ') + ' — ' + party.fix) });
  } catch (_) {}
  /* ⭐ ONE GSTIN (walk 2026-10-09, K1): the GST Registration row said NOT HELD while the shop's bills printed its GSTIN — two answers to one
     fact. The counter reads the GSTIN from invoiceParty (identity column, else the profile vault), so this row reads THE SAME. Held with no
     registry proof is 'declared' — said so, never 'not held'. */
  if (india && items.some((i) => i.standard === 'gst-registration' && i.status === 'pending')) adoptBillGstin(items, party);
  return { standards: keys, clearances: items, summary: summarize(items) };
}
/** the GST Registration row reads the GSTIN the bills print (invoiceParty): held with no registry proof is 'declared' — pure, tested */
function adoptBillGstin(items, party) {
  const row = (items || []).find((i) => i.standard === 'gst-registration' && i.doc === 'gstn');
  if (!row || row.status !== 'pending' || !party || !party.gstin) return false;
  row.status = 'gathered'; row.rung = 'declared';
  row.guidance = 'Declared, not yet verified against the GST registry — this is the GSTIN ' + party.gstin + ' your bills print.';
  return true;
}

// ── b91 · TRADE LANES — the generic bridge (origin rules ∪ destination rules ∪ universal) ──
async function jurisdictions() {
  try { const r = await query(`SELECT dest_key, name, domestic FROM jurisdiction ORDER BY display_order`); return r.rows; } catch (_) { return []; }
}
/* TRADE-SRV1 G2: no sector → no categories (the universal and cross-border rules still apply) — never paint's */
async function verticalCategories(vertical) {
  if (!vertical) return [];
  try { const r = await query(`SELECT category FROM vertical_category WHERE vertical = $1`, [vertical]); return r.rows.map(x => x.category); } catch (_) { return []; }
}
/** the sentences a lane is refused or asked with — a code beside each, the screen branches on the code */
const ORIGIN_UNSTATED = { code: 'TRADE_ORIGIN_UNSTATED', why: 'Set the shop’s country (Country setup) — the trade lanes are read from it.' };
const SECTOR_UNSTATED = { field: 'sector', code: 'TRADE_SECTOR_UNSTATED', why: 'Pick the sector you trade in — the rules for its goods are read from it.' };
/**
 * ⭐ laneContext(entity_id, vertical, origin) → { origin, vertical, categories, asked: [] } — WHAT A LANE IS RESOLVED FOR (TRADE-SRV1 G2).
 *   origin   = the query's, else the shop's own country (profile.homeOf: identities.country) — NEVER 'IN'. Neither → refused 422 with
 *              TRADE_ORIGIN_UNSTATED in words (DECISIONS 2026-10-03: no silent India).
 *   vertical = the query's, else the first sector the shop stated (entity_profile.sectors) — NEVER 'paint'. Neither → null: the lane is
 *              still resolved (universal + cross-border rules) and `asked` names the sector with its code, so the screen asks.
 */
async function laneContext(entity_id, vertical, origin) {
  const P = require('./profile');
  const asked = [];
  let o = String(origin == null ? '' : origin).trim().toUpperCase() || null;
  if (!o) o = (await P.homeOf(entity_id)).country;
  if (!o) { const e = new Error(ORIGIN_UNSTATED.why); e.status = 422; e.code = ORIGIN_UNSTATED.code; e.say = ORIGIN_UNSTATED.why; e.refused = true; throw e; }
  let v = String(vertical == null ? '' : vertical).trim().toLowerCase() || null;
  if (!v) v = (await P.statedSectors(entity_id))[0] || null;
  if (!v) asked.push(Object.assign({}, SECTOR_UNSTATED));
  return { origin: o, vertical: v, categories: await verticalCategories(v), asked };
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
  const L = await laneContext(entity_id, vertical, origin);
  const juris = await jurisdictions(), d = juris.find(x => x.dest_key === dest_key);
  const stds = (await activeStandards()).filter(s => standardApplies(s, L.origin, dest_key, L.categories));
  const keys = stds.map(s => s.standard_key);
  const guidance = {}; for (const s of stds) guidance[s.standard_key] = s.guidance;
  const items = buildItems(await docsFor(keys), await gatheredFor(entity_id), guidance);
  return { origin: L.origin, vertical: L.vertical, asked: L.asked, destination: dest_key, dest_name: (d && d.name) || dest_key, domestic: dest_key === L.origin,
    standards: keys, clearances: items, summary: summarize(items) };
}

// resolveLaneMatrix(entity, vertical, origin) → readiness % per destination + gap standards (the eye-opener). All DERIVED.
/* b571: a lane is DOMESTIC when it is the shop's own country — computed here, never the stored b91 flag (an AU shop's home lane is AU) */
async function resolveLaneMatrix(entity_id, vertical, origin) {
  const L = await laneContext(entity_id, vertical, origin);
  const juris = await jurisdictions();
  const allStds = await activeStandards(), gathered = await gatheredFor(entity_id);
  const titles = {}; for (const s of allStds) titles[s.standard_key] = s.title;
  /* the documents of EVERY active standard in one read, sliced per lane in memory — not one read per lane (no per-row queries) */
  const allDocs = await docsFor(allStds.map(s => s.standard_key));
  const out = [];
  for (const d of juris) {
    const keys = new Set(allStds.filter(s => standardApplies(s, L.origin, d.dest_key, L.categories)).map(s => s.standard_key));
    const items = buildItems(allDocs.filter(x => keys.has(x.standard_key)), gathered, null);
    const s = summarize(items);
    const gapKeys = [...new Set(items.filter(i => i.status !== 'gathered' && i.status !== 'expiring').map(i => i.standard))];
    out.push({ dest_key: d.dest_key, dest_name: d.name, domestic: d.dest_key === L.origin, percent: s.percent, met: s.met, total: s.total, ready: s.ready,
      gaps: gapKeys.map(k => titles[k] || k) });
  }
  return { vertical: L.vertical, origin: L.origin, asked: L.asked, lanes: out };
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

module.exports = { rungOf, resolveReadiness, resolveForDestination, resolveLaneMatrix, laneContext, gatherDocument, adoptBillGstin, activeStandards, standardApplies, verticalCategories, ORIGIN_UNSTATED, SECTOR_UNSTATED };
