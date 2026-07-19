// lib/trace.js — the traceability edge (Fragment 1: the doubly-linked, co-held, frozen handoff edge).
//
// WHY here and not a new column: the edge rides in `summary_json.trace`, the same migration-free, frozen-per-copy,
// co-held path the rail already uses for retention/clearances/commercial folds. That buys three directive
// requirements for free: FREEZE-ON-SEAL (summary_json is snapshotted per copy, never re-computed → TR-7), CO-HOLD
// (summary_json is copied to every participant → both parties hold the same frozen edge, no unilateral forge/delete),
// and no migration for the demo (lower friction for the human live-run). If we productionise, lift `trace.parents`
// into a real `parent_chit_ids uuid[]` column + GIN index — "loose until stamped".
//
// The forward link is a SET (one batch fans out to many — that IS the spread). A non-origin handoff MUST carry >=1
// parent (no silent holes). base_qty/base_unit are frozen now so mass-balance (Fragment 3) computes from the frozen
// body. The cross-entity forward WALK (past parties you don't co-hold) is Fragment 2's participant-gated definer.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// DECLARED conversion map for the demo. Unknown units convert to THEMSELVES (identity) — honest, never a false
// normalization; `unit_known:false` flags it so mass-balance can refuse to compare incomparable units. Extend as
// real verticals appear (this is demo-grade on purpose).
const UNIT_BASE = {
  // mass → grams
  mg:{ base:'g', f:0.001 }, g:{ base:'g', f:1 }, gram:{ base:'g', f:1 }, grams:{ base:'g', f:1 },
  kg:{ base:'g', f:1000 }, ton:{ base:'g', f:1_000_000 }, tonne:{ base:'g', f:1_000_000 },
  // volume → millilitres
  ml:{ base:'ml', f:1 }, l:{ base:'ml', f:1000 }, litre:{ base:'ml', f:1000 }, litres:{ base:'ml', f:1000 }, liter:{ base:'ml', f:1000 },
  // count → unit
  unit:{ base:'unit', f:1 }, units:{ base:'unit', f:1 }, tablet:{ base:'unit', f:1 }, tablets:{ base:'unit', f:1 },
  tab:{ base:'unit', f:1 }, tabs:{ base:'unit', f:1 }, strip:{ base:'unit', f:1 }, strips:{ base:'unit', f:1 },
  box:{ base:'unit', f:1 }, boxes:{ base:'unit', f:1 }, piece:{ base:'unit', f:1 }, pieces:{ base:'unit', f:1 }, pcs:{ base:'unit', f:1 },
};

// qty+unit → canonical base units. Unknown unit → identity (known:false).
function toBase(qty, unit) {
  const q = Number.isFinite(+qty) ? +qty : null;
  const u = String(unit || '').trim().toLowerCase();
  const c = UNIT_BASE[u];
  if (!c) return { base_qty: q, base_unit: u || null, unit_known: false };
  return { base_qty: q === null ? null : q * c.f, base_unit: c.base, unit_known: true };
}

// Validate + normalize the declared edge from the send body's `trace` object.
// Returns { edge } on success (edge:null means "not a traceability handoff"), or { error } (→ 400).
// Rule: a non-origin handoff MUST carry >=1 valid parent chit_id (the no-silent-holes contract). is_origin:true is
// the only way to omit parents, and only the chain origin may claim it.
function buildEdge(input) {
  if (input == null) return { edge: null };
  if (typeof input !== 'object' || Array.isArray(input)) return { error: 'trace must be an object' };
  const isOrigin = input.is_origin === true;
  const parents = [...new Set((Array.isArray(input.parents) ? input.parents : [])
    .filter((p) => typeof p === 'string' && UUID_RE.test(p)))];
  if (!isOrigin && parents.length === 0) {
    return { error: 'Handoff requires a parent reference (no silent holes). Set is_origin:true only for the chain origin.' };
  }
  const qty = Number.isFinite(+input.qty) ? +input.qty : null;
  const unit = (typeof input.unit === 'string' && input.unit.trim()) ? input.unit.trim().slice(0, 24) : null;
  const product = (typeof input.product === 'string' && input.product.trim()) ? input.product.trim().slice(0, 120) : null;
  const { base_qty, base_unit, unit_known } = toBase(qty, unit);
  return { edge: { parents, is_origin: isOrigin, product, qty, unit, base_qty, base_unit, unit_known } };
}

module.exports = { UNIT_BASE, UUID_RE, toBase, buildEdge };
