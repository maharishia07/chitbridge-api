// lib/kyb.js — the "KNOW YOUR BUSINESS" value panel. Computes facts from data CB ALREADY holds, each carrying a TRUST
// RUNG. NOT a governance feature and makes no governance claim. Four sections, each behind a small internal interface
// (input: entity context → output: { facts, rungs }) so they can be recomposed/moved later without rework.
// Discipline (same as the security work): entity-scoped withEntity · rungs written by the PLATFORM (never a client
// field — the T1 rule) · fail-closed · thresholds/windows are CONFIG (not constants) · numbers rounded at the edge.
// See CB-CLI-DIRECTIVE-know-your-business-panel.
const { withEntity } = require('../db');
const readiness = require('./readiness');
const profile = require('./profile');

// ── CONFIG (cascade-config, NOT hardcoded constants) — env-overridable now; move to the governance cascade later. ──
function cfg() {
  return {
    EXPIRY_WINDOW_DAYS: Number(process.env.KYB_EXPIRY_WINDOW_DAYS || 60),   // "expiring soon" window
    CONCENTRATION_FLAG_PCT: Number(process.env.KYB_CONCENTRATION_PCT || 40), // flag a buyer above this % of business
    FIELD_CACHE_HOURS: Number(process.env.KYB_FIELD_CACHE_HOURS || 24),
    // STRUCTURAL requirements are NOT certificates — they can't be acquired now (turnover, track record, plant size).
    // Config-driven so the list is data, not code. Seeded minimally; extend in the cascade. `markets` = where it applies.
    STRUCTURAL: JSON.parse(process.env.KYB_STRUCTURAL || 'null') || [
      { key: 'turnover-threshold', label: 'Minimum annual turnover', note: 'Some tenders/markets require a turnover floor — a structural gap, not a certificate.', markets: ['EU', 'US'] },
      { key: 'track-record', label: 'Multi-year export track record', note: 'Built over time by trading — cannot be acquired now.', markets: ['EU', 'US', 'JP'] },
    ],
  };
}
const round1 = (n) => Math.round(Number(n || 0) * 10) / 10;
const daysUntil = (d) => d ? Math.ceil((new Date(d).getTime() - Date.now()) / 86400000) : null;

// ── SECTION 1 · YOURSELF — what you hold, and how much to trust it. Reads entity_profile + entity_compliance. ──
async function yourself(entity_id) {
  const rd = await readiness.resolveReadiness(entity_id).catch(() => ({ clearances: [] }));
  const win = cfg().EXPIRY_WINDOW_DAYS;
  const credentials = (rd.clearances || []).map((c) => {
    const d = daysUntil(c.valid_until);
    return {
      standard: c.standard, doc: c.doc, title: c.title || c.doc,
      rung: c.rung || null,                         // platform-written (verified/documented/declared); never from a client field
      held: c.status === 'gathered' || c.status === 'expiring',
      valid_until: c.valid_until || null,
      expiring: d != null && d >= 0 && d <= win,    // inside the expiry window
      expired: d != null && d < 0,
      days_left: d,
    };
  });
  const held = credentials.filter((c) => c.held);
  return {
    section: 'yourself',
    facts: {
      credentials,
      watched: credentials.map((c) => ({ standard: c.standard, title: c.title, held: c.held })),   // the list CB watches — user-extendable (the additions are the roadmap)
      summary: {
        held: held.length, total: credentials.length,
        verified: held.filter((c) => c.rung === 'verified').length,
        documented: held.filter((c) => c.rung === 'documented').length,
        declared: held.filter((c) => c.rung === 'declared').length,
        expiring: credentials.filter((c) => c.expiring).length,
      },
    },
    note: 'Every credential shows its trust rung. `declared` = you typed it; `documented` = a real owned evidence chit; `verified` = confirmed at the source registry.',
  };
}

// A user can ADD a credential CB has never heard of (village NOC, municipal licence). Lands `declared`; rises to
// `documented` only with a real owned evidence chit — reuses gatherDocument (which enforces the ownership check + strips
// any client-supplied verification, so it can NEVER mint verified/attested from a self-write). standard_key is the caller's.
async function addCredential(entity_id, { title, standard_key, doc_key, evidence_ref, valid_until }) {
  const std = String(standard_key || ('custom-' + String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40))).slice(0, 60);
  const doc = String(doc_key || 'certificate').slice(0, 60);
  if (!title && !standard_key) { const e = new Error('a title or standard_key is required'); e.status = 400; throw e; }
  // NO verification passed → at most `documented` (with an owned chit) or `declared`. Platform sets the rung.
  await readiness.gatherDocument(entity_id, { standard_key: std, doc_key: doc, evidence_ref, valid_until, status: 'gathered' });
  return { added: { standard: std, doc, title: title || std } };
}

// ── SECTION 2 · POSITION — what you can reach, and what blocks the rest. Reads Section 1 + lane requirement rules. ──
async function position(entity_id, { vertical, origin } = {}) {
  const p = await profile.getProfile(entity_id).catch(() => ({}));
  const vert = vertical || (p.sectors && p.sectors[0]) || 'paint';
  const org = origin || 'IN';
  const matrix = await readiness.resolveLaneMatrix(entity_id, vert, org).catch(() => ({ lanes: [] }));
  const structural = cfg().STRUCTURAL;

  // markets-unlocked per standard: how many destinations that gap standard gates (the "+N markets" value).
  const gatesCount = {};
  (matrix.lanes || []).forEach((l) => (l.gaps || l.missing || []).forEach((g) => {
    const k = g.standard || g; gatesCount[k] = (gatesCount[k] || 0) + 1;
  }));

  const lanes = (matrix.lanes || []).map((l) => {
    const missing = (l.gaps || l.missing || []).map((g) => {
      const k = g.standard || g;
      return { standard: k, title: g.title || k, kind: 'closeable', unlocks: gatesCount[k] || 1,
        path: 'Acquire ' + (g.title || k) + ' → unlocks ' + (gatesCount[k] || 1) + ' market(s).' };
    });
    // structural gaps that apply to this destination — SHOWN, LABELLED, no "how to fix".
    const structGaps = structural.filter((s) => (s.markets || []).includes(l.dest_key)).map((s) => ({
      standard: s.key, title: s.label, kind: 'structural', note: s.note }));
    return {
      dest_key: l.dest_key, dest_name: l.dest_name || l.dest_key,
      readiness_pct: round1(l.percent != null ? l.percent : (l.summary && l.summary.percent) || 0),
      met: (l.met != null ? l.met : (l.summary && l.summary.met)) || 0,
      total: (l.total != null ? l.total : (l.summary && l.summary.total)) || 0,
      gaps: missing.concat(structGaps),
    };
  });
  // rank the CLOSEABLE gaps across all lanes by value ÷ effort (value = markets unlocked; effort = config weight, default 1).
  const ranked = Object.keys(gatesCount).map((k) => ({ standard: k, unlocks: gatesCount[k], score: round1(gatesCount[k] / 1) }))
    .sort((a, b) => b.score - a.score);
  // DIRECTIONAL buckets — the "where can I sell more" view at a glance: reachable NOW · ONE step away · STRUCTURAL.
  const reach = { reachable_now: [], one_step: [], structural: [] };
  lanes.forEach((l) => {
    const closeable = l.gaps.filter((g) => g.kind === 'closeable');
    const struct = l.gaps.filter((g) => g.kind === 'structural');
    if (closeable.length === 0 && struct.length === 0) reach.reachable_now.push({ dest: l.dest_name, dest_key: l.dest_key });
    else if (closeable.length === 1 && struct.length === 0) reach.one_step.push({ dest: l.dest_name, dest_key: l.dest_key, needs: closeable[0].title });
    else if (struct.length > 0) reach.structural.push({ dest: l.dest_name, dest_key: l.dest_key, blocked_by: struct.map((s) => s.title) });
    else reach.one_step.push({ dest: l.dest_name, dest_key: l.dest_key, needs: closeable.map((c) => c.title).join(' + ') });
  });
  return { section: 'position', facts: { reach, lanes, ranked_actions: ranked },
    note: 'Where you can sell, directionally: REACHABLE NOW (you hold what\'s needed) · ONE STEP AWAY (a certificate you can acquire, with the markets it unlocks) · STRUCTURAL (turnover / track record — shown and labelled, not something to "fix" now).' };
}

// ── SECTION 3 · RISK — where your exposure actually sits. Reads trade history + credential expiries. Names, never advises. ──
async function risk(entity_id) {
  const win = cfg().EXPIRY_WINDOW_DAYS, flagPct = cfg().CONCENTRATION_FLAG_PCT;
  // trade history: the entity's OWN chit copies (per-copy, withEntity). Counterparty = the other party; value = total_value.
  let rows = [];
  try {
    const r = await withEntity(entity_id, (c) => c.query(
      `SELECT direction, sender_entity_display_name, all_recipients, COALESCE(total_value,0) AS total_value, purpose, created_at
         FROM chit_header WHERE entity_id = $1`, [entity_id]));
    rows = r.rows || [];
  } catch (_) { rows = []; }

  const counterparty = (row) => {
    if (row.direction === 'received') return row.sender_entity_display_name || 'unknown';
    const ar = row.all_recipients || [];
    const to = (Array.isArray(ar) ? ar : []).filter((x) => x.role === 'receiver' || x.role === 'to').map((x) => x.display_name);
    return (to[0]) || 'unknown';
  };
  const byParty = {}; let totalVal = 0, n = 0;
  rows.forEach((row) => { const v = Number(row.total_value || 0); const cp = counterparty(row); byParty[cp] = (byParty[cp] || 0) + v; totalVal += v; n++; });
  const parties = Object.keys(byParty).map((k) => ({ counterparty: k, value: round1(byParty[k]), pct: totalVal ? round1((byParty[k] / totalVal) * 100) : 0 }))
    .sort((a, b) => b.value - a.value);
  const top = parties[0];

  // expiry exposure: credentials expiring inside the window (a paper a live/likely deal may need).
  const rd = await readiness.resolveReadiness(entity_id).catch(() => ({ clearances: [] }));
  const expiring = (rd.clearances || []).filter((c) => { const d = daysUntil(c.valid_until); return d != null && d >= 0 && d <= win; })
    .map((c) => ({ title: c.title || c.doc, valid_until: c.valid_until, days_left: daysUntil(c.valid_until), rung: c.rung }));

  const facts = { exposures: [] };
  if (top && top.pct >= flagPct) facts.exposures.push({ kind: 'concentration', severity: top.pct >= 60 ? 'high' : 'medium',
    fact: round1(top.pct) + '% of your business sits with one buyer (' + top.counterparty + ').',
    detail: 'A single counterparty this large is a quiet risk — a general fact, not advice. Spreading it is a conversation for your CA / bank.' });
  expiring.forEach((e) => facts.exposures.push({ kind: 'expiry', severity: e.days_left <= 14 ? 'high' : 'medium',
    fact: e.title + ' expires in ' + e.days_left + ' day(s).', detail: 'A lapse can block a live or likely deal that needs this paper. Renew via the issuer.' }));
  facts.concentration = { top: top || null, parties: parties.slice(0, 8), chits: n };
  facts.expiring = expiring;
  return { section: 'risk', facts,
    // HARD LINE: naming an exposure is analysis; recommending a hedge/instrument is regulated advice — we do NOT.
    note: 'These are facts from your own trade data — not advice. Naming an exposure is analysis; choosing an instrument to hedge it is a regulated decision for your bank / CA.' };
}

// ── SECTION 4 · FIELD / DIRECTION — where's the demand, and can I reach it? THE WALLED-OFF ONE. ──
// The honest version of "find me a buyer": returns MARKETS / DEMAND / PATHS, never leads. Every result is `declared`
// (platform-set), carries a source URL + as-of date + "verify at the source"; no source → dropped. On-demand only,
// metered, cached ~24h per (entity, profile). The narrowing (constrain by the entity's own profile) IS the product.
const crypto = require('crypto');

// the demand SOURCE is pluggable and INERT until a real trade-data / search provider is configured (no fabrication —
// CB has no buyer database; a made-up "source URL" would violate this section's own rules). Same pattern as the webhooks.
function fieldProvider() {
  if (process.env.KYB_FIELD_PROVIDER && process.env.KYB_FIELD_KEY) {
    return null;   // TODO(UAT): plug a real trade-data/search adapter here → returns [{market, demand, source_url, as_of}]
  }
  return null;
}

function profileHash(p) {
  const key = JSON.stringify({ sectors: p.sectors || [], markets: p.markets || [], adopted: p.adopted || [], mode: p.trade_mode || '' });
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
}

async function field(entity_id) {
  const p = await profile.getProfile(entity_id).catch(() => ({}));
  const hash = profileHash(p);
  const win = cfg().FIELD_CACHE_HOURS;
  // 1 · CACHE (idempotent billing): same entity + same profile within the window → served FREE, cached.
  try {
    const c = await withEntity(entity_id, (db) => db.query(
      `SELECT result, created_at FROM kyb_field_cache WHERE entity_id = $1 AND profile_hash = $2 AND created_at > now() - ($3 || ' hours')::interval ORDER BY created_at DESC LIMIT 1`,
      [entity_id, hash, String(win)]));
    if (c.rows[0]) return { section: 'field', cached: true, charged: false, ...c.rows[0].result };
  } catch (_) { /* pre-b107 → no cache; fall through */ }

  // 2 · the provider is inert until connected — return the walled-off "not configured" state (NOT charged, NO fabrication).
  const prov = fieldProvider();
  if (!prov) {
    return { section: 'field', cached: false, charged: false, configured: false, results: [],
      note: 'Field/direction search is not connected yet. When a trade-data source is plugged in, this returns WHERE the demand is (with a source URL + as-of date on every line) — never a buyer list. Always verify at the source before you act.',
      wall: true };
  }

  // 3 · run the search, constrained by the profile. Enforce the honesty rules on the way out.
  let raw = [];
  try { raw = await prov.search(p); } catch (_) { raw = []; }
  const results = (raw || [])
    .filter((r) => r && r.source_url && r.as_of)              // F1: no source URL + as-of → DROPPED
    .map((r) => ({ market: r.market, demand: r.demand || null, source_url: r.source_url, as_of: r.as_of, rung: 'declared' }));  // F2: rung is ALWAYS declared (platform-set)
  // F3: markets/demand/paths only — never a named "buyer to contact" (the provider contract returns markets, not buyers).
  const reach = await position(entity_id).then((x) => x.facts.reach).catch(() => null);   // fold "reachable today" back in
  const out = { section: 'field', cached: false, charged: true, configured: true, results, reach,
    note: 'Found on the web — verify at the source before you act. Every line carries its source + as-of date. This is where demand is, not who to contact.', wall: true };
  // 4 · meter (once) + cache (idempotency for the 24h window).
  try {
    await withEntity(entity_id, (db) => db.query(
      "INSERT INTO usage_ledger (entity_id, meter, detail, quantity, cost_usd) VALUES ($1,'kyb.field',$2,1,$3)",
      [entity_id, hash, Number(process.env.KYB_FIELD_COST_USD || 0.02)]));
    await withEntity(entity_id, (db) => db.query(
      `INSERT INTO kyb_field_cache (entity_id, profile_hash, result) VALUES ($1,$2,$3::jsonb)`, [entity_id, hash, JSON.stringify(out)]));
  } catch (_) { /* pre-b107 → uncached, still returned */ }
  return out;
}

module.exports = { yourself, addCredential, position, risk, field, profileHash, cfg, round1 };
