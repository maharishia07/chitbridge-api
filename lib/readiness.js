/* OWNS the trade-readiness roll-up: the entity's standards, the gathered documents and the destination-resolved lanes
 * CALLED BY lib/forms, kyb, profile; routes/chits, entities, governance
 * FLOW standard keys (boilerplate or global) -> docs -> gathered evidence -> items (+ the India-only GST invoice-header item) -> summary
 * CARD 23-compliance-trade-and-attestation/trade-readiness */
const versionref = require('./versionref');
const log = require('./logger');
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
  } catch (e) { log.fellBack('readiness docsFor: the read failed — answered with none', e); return []; }
}
async function gatheredFor(entity_id) {
  const map = {};
  try {
    const g = await withEntity(entity_id, (c) => c.query(
      `SELECT standard_key, doc_key, status, evidence_ref, valid_until, verification FROM entity_compliance WHERE entity_id = $1`, [entity_id]));
    for (const row of g.rows) map[row.standard_key + '|' + row.doc_key] = row;
  } catch (e) { log.fellBack('readiness gatheredFor: the read failed — carried on without it', e); }
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
  return docs.map(item => {
    const ev = gathered[item.standard_key + '|' + item.doc_key];
    let status = 'pending';
    if (ev) {
      status = ev.status || 'gathered';
      if (ev.valid_until) {
        const date = new Date(ev.valid_until);
        if (date < today) status = 'expired';
        else if ((date - today) / 86400000 < EXPIRE_SOON_DAYS) status = 'expiring';
      }
    }
    const met = status === 'gathered' || status === 'expiring';
    return { standard: item.standard_key, doc: item.doc_key, title: item.title, scope: item.scope, frequency: item.frequency,
      status, rung: ev ? rungOf(ev) : null, evidence_ref: (ev && ev.evidence_ref) || null, valid_until: (ev && ev.valid_until) || null,
      verified_at: (ev && ev.verification && ev.verification.verified_at) || null,          // WHEN the platform confirmed it
      verified_by: (ev && ev.verification && ev.verification.provider) || null,             // which source confirmed it
      guidance: (!met && guidanceByStd && guidanceByStd[item.standard_key]) || null };   // guide the rest
  });
}
function summarize(items) {
  const met = items.filter(item => item.status === 'gathered' || item.status === 'expiring').length;
  return {
    total: items.length, met,
    pending: items.filter(item => item.status === 'pending').length,
    expiring: items.filter(item => item.status === 'expiring').length,
    expired: items.filter(item => item.status === 'expired').length,
    ready: items.length > 0 && items.every(item => item.status === 'gathered' || item.status === 'expiring'),
    percent: items.length ? Math.round((met / items.length) * 100) : 0,
    verified: items.filter(item => item.rung === 'verified').length,
    attested: items.filter(item => item.rung === 'attested').length,
    documented: items.filter(item => item.rung === 'documented').length,
  };
}

// ── the entity's own standards (boilerplate, else global) — the non-destination "My readiness" ──
async function standardKeysFor(entity_id) {
  try {
    const { entityBoilerplateKey, resolveBoilerplate } = require('./boilerplate');
    const bk = await entityBoilerplateKey(withEntity, entity_id);
    if (bk) { const bp = await resolveBoilerplate(bk); if (bp && bp.standards) { const k = Object.values(bp.standards).map((item) => versionref.keyOf(item)); if (k.length) return k; } }
  } catch (e) { log.fellBack('readiness standardKeysFor: the read failed — carried on without it', e); }
  try { const r = await query(`SELECT DISTINCT standard_key FROM standard_source WHERE active = true AND COALESCE(facet,'') <> 'commerce'`); return r.rows.map(x => x.standard_key); } catch (e) { log.fellBack('readiness standardKeysFor: the read failed — answered with none', e); return []; }
}
/** N2: the GST Rule 46 invoice-header item belongs to India's pack - a shop of another country (or none stated) is not asked for it */
function isIndiaParty(party) { return String(party.country || '').toUpperCase() === 'IN'; }
/** the invoice-header clearance item: gathered when the supplier details are complete, else pending with what is missing */
function invoiceHeaderItem(party, rung, note) {
  return ({ standard: 'IN-GST', doc: 'invoice_header', title: 'Invoice header — supplier details (GST Rule 46)', scope: 'org', frequency: 'once',
    status: party.complete ? 'gathered' : 'pending', rung, evidence_ref: null, valid_until: null, verified_at: null, verified_by: null,
    guidance: party.complete ? note : ('Missing: ' + party.missing.join(', ') + ' — ' + party.fix) });
}
async function resolveReadiness(entity_id) {
  let keys = await standardKeysFor(entity_id);
  let docs = await docsFor(keys);
  if (!docs.length) {   // FLOOR: never empty while active standards exist
    try { const g = await query(`SELECT DISTINCT standard_key FROM standard_source WHERE active = true AND COALESCE(facet,'') <> 'commerce'`); const gd = await docsFor(g.rows.map(x => x.standard_key)); if (gd.length) { docs = gd; keys = g.rows.map(x => x.standard_key); } } catch (e) { log.fellBack('readiness resolveReadiness: the read failed — carried on without it', e); }
  }
  const items = buildItems(docs, await gatheredFor(entity_id), null);
  /* ⭐ the INVOICE HEADER is a clearance too (GST Rule 46 — Athi, 2026-09-04: "tied with trade ready"): the same
     reader the Invoice row uses, so the two can never disagree. Never fails the roll-up if the read itself fails. */
  try {
    const P = require('./profile'); const PM = require('./profile-map');
    const party = await P.invoiceParty(entity_id);
    /* ⭐ THE RUNG FOLLOWS THE PROFILE MAP (Athi, 2026-09-05: "that should get Trade ready updated, so when another connects from
       the supplier network it reflects better"). The header's rung is the LOWEST rung among the fields it is made of:
       declared (typed) → documented (copied from the store's own books, or checked by our arithmetic) → verified (registry).
       A counterparty reading this entity's readiness sees the same item, so the view improves the moment the sync runs. */
    let rung = party.complete ? 'declared' : null, note = null;
    try {
      const a = PM.assess(await P.profileValues(entity_id));
      const keys = ['legal_name', 'gstin', 'state', 'address'].concat(a.fields.phone.value ? ['phone'] : (a.fields.email.value ? ['email'] : []));
      const rungs = keys.map((item) => (a.fields[item] && a.fields[item].rung) || 'declared');
      const low = rungs.reduce((total, item) => (PM.rank(item) < PM.rank(total) ? item : total), 'verified');
      if (party.complete) rung = low === 'verified' ? 'verified' : (low === 'declared' ? 'declared' : 'documented');
      const g = a.fields.gstin;
      if (party.complete && g && g.value) note = 'GSTIN ' + (g.rung === 'verified' ? 'verified against the registry' : g.rung === 'checked' ? 'check digit and state agree' : g.rung === 'copied' ? 'copied from ' + (g.source || 'the store\'s system') : 'as typed') + (g.as_of ? ' · ' + String(g.as_of).slice(0, 10) : '') + (a.issues.length ? ' · ⚠ ' + a.issues.map((item) => item.issue).join('; ') : '');
    } catch (e) { log.fellBack('readiness resolveReadiness: failed — carried on without it', e); }
    /* N2: the GST Rule 46 invoice-header item belongs to India's pack - any other shop (or none stated) is not asked for it */
    if (isIndiaParty(party)) items.push(invoiceHeaderItem(party, rung, note));
  } catch (e) { log.fellBack('readiness resolveReadiness: the helper failed — carried on without it', e); }
  /* ⭐ ONE GSTIN (walk 2026-10-09, K1): the GST Registration row said NOT HELD while the shop's bills printed its GSTIN — two answers to one
     fact. The counter reads the GSTIN from invoiceParty (identity column, else the profile vault), so this row reads THE SAME. Held with no
     registry proof is 'declared' — said so, never 'not held'. */
  try { if (items.some((item) => item.standard === 'gst-registration' && item.status === 'pending')) adoptBillGstin(items, await require('./profile').invoiceParty(entity_id)); } catch (e) { log.fellBack('readiness resolveReadiness: the helper failed — carried on without it', e); }
  return { standards: keys, clearances: items, summary: summarize(items) };
}
/** the GST Registration row reads the GSTIN the bills print (invoiceParty): held with no registry proof is 'declared' — pure, tested */
function adoptBillGstin(items, party) {
  const row = (items || []).find((item) => item.standard === 'gst-registration' && item.doc === 'gstn');
  if (!row || row.status !== 'pending' || !party || !party.gstin) return false;
  row.status = 'gathered'; row.rung = 'declared';
  row.guidance = 'Declared, not yet verified against the GST registry — this is the GSTIN ' + party.gstin + ' your bills print.';
  return true;
}

// ── b91 · TRADE LANES — the generic bridge (origin rules ∪ destination rules ∪ universal) ──
async function jurisdictions() {
  /* a two-letter key reads as the country's own name (country-setup.nameOf — the one name reader), so the pre-b538 'Domestic (India)' row
     never tells a shop elsewhere that India is home; GULF and other groupings keep the table's name */
  const { nameOf } = require('./country-setup');
  try {
    const r = await query(`SELECT dest_key, name, domestic FROM jurisdiction ORDER BY display_order`);
    return r.rows.map((x) => { const n = codeOf(x.dest_key) ? nameOf(x.dest_key) : null; return { ...x, name: n && n !== x.dest_key ? n : x.name }; });
  } catch (e) { log.fellBack('readiness jurisdictions: the read failed — answered with none', e); return []; }   /* pre-b91: no lanes, said by an empty list */
}
/* TRADE-SRV1 G2: no sector stated → no product categories (only the rules that apply to every product), never 'paint' */
async function verticalCategories(vertical) {
  if (!vertical) return [];
  try { const r = await query(`SELECT category FROM vertical_category WHERE vertical = $1`, [vertical]); return r.rows.map(x => x.category); }
  catch (e) { log.fellBack('readiness verticalCategories: the read failed — answered with none', e); return []; }   /* pre-b91: no categories — the rules for every product still show */
}

/* ⭐⭐ TRADE-SRV1 G2 · A LANE STARTS FROM THE SHOP'S STATED COUNTRY AND SECTOR — asked, never India / paint. Both readers already exist:
   the country is lib/country-setup's (identities.country, CONFIRMED by the Country setup step — the column's 'IN' default is not a statement,
   b299 ⚠️), the sector is the governance profile's (entity_profile.sectors, lib/profile.getProfile). A query value wins (the screen's picker).
   An unstated value comes back in `asked` with a CODE the client branches on (never a regex over the sentence). */
const ORIGIN_UNSTATED = 'Say which country you trade from in Country setup — every lane starts there.';
const SECTOR_UNSTATED = 'Say what you sell (your sector) to see each market\'s product rules. Until then only the rules for every product show.';
const codeOf = (v) => { const c = String(v == null ? '' : v).trim().toUpperCase(); return /^[A-Z]{2}$/.test(c) ? c : null; };
/** statedOrigin(st) → the shop's country when the owner has stated it, else null — st is country-setup.status(); pure, tested */
function statedOrigin(st) { return st && st.country && !st.required ? codeOf(st.country.code) : null; }
/** asks(origin, vertical) → { asked: ['origin'|'sector'], code, why } — pure, tested */
function asks(origin, vertical) {
  const asked = []; if (!origin) asked.push('origin'); if (!vertical) asked.push('sector');
  return { asked, code: !origin ? 'ORIGIN_UNSTATED' : (!vertical ? 'SECTOR_UNSTATED' : null), why: !origin ? ORIGIN_UNSTATED : (!vertical ? SECTOR_UNSTATED : null) };
}
/** originOf(entity) → the shop's stated country or null (country-setup.status — cached a minute per shop) */
async function originOf(entity_id) {
  try { return statedOrigin(await withEntity(entity_id, (h) => require('./country-setup').status(h, entity_id))); }
  catch (e) { log.warn('readiness.origin_unread', { entity_id, error: String(e && e.message).slice(0, 200) }); return null; }   /* the shop is asked, not told India */
}
/** laneOf(entity, { vertical, origin }) → { origin, vertical, asked, code, why } — the query's values, else the shop's stated ones */
async function laneOf(entity_id, q) {
  const o = q || {};
  let origin = codeOf(o.origin), vertical = o.vertical ? String(o.vertical).trim().toLowerCase().slice(0, 40) || null : null;
  if (!origin) origin = await originOf(entity_id);
  if (!vertical) {
    try { const p = await require('./profile').getProfile(entity_id); vertical = (p && Array.isArray(p.sectors) && p.sectors[0]) || null; }
    catch (e) { log.warn('readiness.sector_unread', { entity_id, error: String(e && e.message).slice(0, 200) }); }
  }
  return { origin, vertical, ...asks(origin, vertical) };
}
async function activeStandards() {
  try { const r = await query(`SELECT DISTINCT ON (standard_key) standard_key, title, applicability, guidance FROM standard_source WHERE active = true AND COALESCE(facet,'') <> 'commerce' ORDER BY standard_key, minted_at DESC`); return r.rows; } catch (e) { log.fellBack('readiness activeStandards: the read failed — answered with none', e); return []; }
}
// ⭐ THE ALGORITHM — a standard applies to a lane (origin → destination, product categories) if its home-rule, its
// destination-rule, its cross-border flag AND its category all match. An empty condition = "not conditioned on this".
function standardApplies(std, origin, dest_key, categories) {
  const a = std.applicability || {}, org = a.origin || [], dst = a.destination || [], cats = a.categories || [];
  const originOk = !org.length || org.indexOf('any') >= 0 || org.indexOf(origin) >= 0;
  const destOk   = !dst.length || dst.indexOf('any') >= 0 || dst.indexOf(dest_key) >= 0;
  const crossOk  = !a.cross_border || (origin !== dest_key);          // export-only rules (e.g. export policy)
  const catOk    = !cats.length || cats.some(item => categories.indexOf(item) >= 0);
  return originOk && destOk && crossOk && catOk;
}

/* T2-NATDEF's originOf (the profile's country) is superseded by the one above (INT6c): the STATED country from Country setup, asked with a code when none */
// resolveForDestination(entity, dest, vertical, origin) → readiness DERIVED for exporting FROM origin TO dest, w/ guidance.
async function resolveForDestination(entity_id, dest_key, vertical, origin) {
  const lane = await laneOf(entity_id, { vertical, origin });   /* G2: stated or asked — never India / paint */
  origin = lane.origin;
  const juris = await jurisdictions(), d = juris.find(x => x.dest_key === dest_key);
  if (!origin) return { origin: null, vertical: lane.vertical, destination: dest_key, dest_name: (d && d.name) || dest_key, domestic: false,
    asked: lane.asked, code: lane.code, why: lane.why, standards: [], clearances: [], summary: summarize([]) };
  const cats = await verticalCategories(lane.vertical);
  const stds = (await activeStandards()).filter(item => standardApplies(item, origin, dest_key, cats));
  const keys = stds.map(item => item.standard_key);
  const guidance = {}; for (const s of stds) guidance[s.standard_key] = s.guidance;
  const items = buildItems(await docsFor(keys), await gatheredFor(entity_id), guidance);
  return { origin, vertical: lane.vertical, destination: dest_key, dest_name: (d && d.name) || dest_key, domestic: dest_key === origin,
    asked: lane.asked, code: lane.code, why: lane.why, standards: keys, clearances: items, summary: summarize(items) };
}

// resolveLaneMatrix(entity, vertical, origin) → readiness % per destination + gap standards (the eye-opener). All DERIVED.
async function resolveLaneMatrix(entity_id, vertical, origin) {
  const lane = await laneOf(entity_id, { vertical, origin });   /* G2: stated or asked — never India / paint */
  origin = lane.origin;
  if (!origin) return { vertical: lane.vertical, origin: null, asked: lane.asked, code: lane.code, why: lane.why, lanes: [] };
  const juris = await jurisdictions(), cats = await verticalCategories(lane.vertical);
  const allStds = await activeStandards(), gathered = await gatheredFor(entity_id);
  const titles = {}; for (const s of allStds) titles[s.standard_key] = s.title;
  /* ONE documents read for every lane (was one per lane — a per-row query that grew with b538's two lanes) */
  const perLane = juris.map((item) => allStds.filter(s => standardApplies(s, origin, item.dest_key, cats)).map(s => s.standard_key));
  const allDocs = await docsFor([...new Set([].concat(...perLane))]);
  const out = [];
  for (const [i, d] of juris.entries()) {
    const keys = perLane[i];
    const items = buildItems(allDocs.filter(x => keys.indexOf(x.standard_key) >= 0), gathered, null);
    const s = summarize(items);
    const gapKeys = [...new Set(items.filter(item => item.status !== 'gathered' && item.status !== 'expiring').map(item => item.standard))];
    /* domestic = the lane whose key is the shop's own country (G2) — computed, not the table's flag (which said India for every shop) */
    out.push({ dest_key: d.dest_key, dest_name: d.name, domestic: d.dest_key === origin, percent: s.percent, met: s.met, total: s.total, ready: s.ready,
      gaps: gapKeys.map(item => titles[item] || item) });
  }
  return { vertical: lane.vertical, origin, asked: lane.asked, code: lane.code, why: lane.why, lanes: out };
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
    } catch (e) { log.fellBack('readiness: the read failed — carried on without it', e); /* if the check itself fails, be conservative: keep ref (RLS still scopes reads) */ }
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

module.exports = { rungOf, resolveReadiness, resolveForDestination, resolveLaneMatrix, gatherDocument, adoptBillGstin, activeStandards, standardApplies, verticalCategories,
  laneOf, originOf, statedOrigin, asks, ORIGIN_UNSTATED, SECTOR_UNSTATED };
