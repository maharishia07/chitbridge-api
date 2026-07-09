// lib/compliance.js — BOTTOM-UP conform-check (FIRST LIGHT of the `ai:conform-verdict@v1` slot).
// Design (see C:\dev\SPEC-ai-slots.md):
//   • DETERMINISTIC FLOOR FIRST — required data points are evaluated by rules (threshold/presence/equals); NO model
//     is used to decide compliance. A verdict is a fact computed from the template, not an opinion.
//   • The AI slot's job is the RUNG-2 SUMMARISE layer only — a human-readable "what's wrong + what to do" narrative,
//     added by the caller (routes/assist.js) ONLY when a model is configured. Absent a model, the verdict still
//     stands (self-healing) — it just has no narrative.
//   • Templates START as a CODE fallback (mint to a `compliance_template` catalogue LATER — same self-heal pattern
//     as workpattern.js BLUEPRINTS). IP-safe: encode the STRUCTURE + CITE the standard; never copy standard text.
//   • Version-frozen: a template is keyed `<standard>@v<N>`; a verdict only means something against that version.

// Hand-seeded first template. Structure modeled on cold-chain food-safety requirements — cited, not copied.
const TEMPLATES = {
  'food-safety@v1': {
    standard: 'food-safety@v1',
    title: 'Food safety — cold-chain storage',
    cite: 'Structure modeled on HACCP / ISO 22000 cold-chain principles (data-point structure only; not a reproduction of the standard).',
    points: [
      { key: 'storage_temp_c', label: 'Storage temperature (°C)', obligation: 'must', rule: { max: 5 } },
      { key: 'batch_id',       label: 'Batch / lot identifier',    obligation: 'must', rule: { present: true } },
      { key: 'expiry_date',    label: 'Expiry date',               obligation: 'must', rule: { present: true } },
      { key: 'haccp_checked',  label: 'HACCP check performed',     obligation: 'must', rule: { equals: true } },
    ],
  },
};

function getTemplate(standard) {
  // Self-healing hook: a DB-minted template would be read here first; for first light we serve the code fallback.
  return TEMPLATES[standard] || null;
}

function listTemplates() {
  // Include the required data points (+ their rule) — this is the "what must be collected" the UI renders as a form,
  // and it's exactly what the standards layer is meant to surface (transparency: the requirement is visible).
  return Object.values(TEMPLATES).map((t) => ({
    standard: t.standard, title: t.title,
    points: t.points.map((p) => ({ key: p.key, label: p.label, obligation: p.obligation, rule: p.rule })),
  }));
}

// Evaluate ONE data point against its rule → { status: 'ok' | 'missing' | 'violated', detail }.
function evalPoint(p, payload) {
  const has = payload != null && Object.prototype.hasOwnProperty.call(payload, p.key)
    && payload[p.key] !== null && payload[p.key] !== '';
  const v = has ? payload[p.key] : undefined;
  const r = p.rule || {};
  if (!has) {
    // Optional points that are absent are fine; a required-but-absent point is a gap.
    return { status: p.obligation === 'must' ? 'missing' : 'ok', value: null, detail: p.obligation === 'must' ? 'required, not provided' : 'optional, absent' };
  }
  if (r.present === true) return { status: 'ok', value: v, detail: 'present' };
  if (r.equals !== undefined) {
    const ok = v === r.equals;
    return { status: ok ? 'ok' : 'violated', value: v, detail: ok ? 'matches' : `must equal ${r.equals}` };
  }
  if (r.max !== undefined) {
    const n = Number(v);
    if (Number.isNaN(n)) return { status: 'violated', value: v, detail: 'not a number' };
    const ok = n <= r.max;
    return { status: ok ? 'ok' : 'violated', value: n, detail: ok ? `≤ ${r.max}` : `exceeds max ${r.max}` };
  }
  if (r.min !== undefined) {
    const n = Number(v);
    if (Number.isNaN(n)) return { status: 'violated', value: v, detail: 'not a number' };
    const ok = n >= r.min;
    return { status: ok ? 'ok' : 'violated', value: n, detail: ok ? `≥ ${r.min}` : `below min ${r.min}` };
  }
  return { status: 'ok', value: v, detail: 'no rule' };
}

// evaluate(template, payload) → the DETERMINISTIC verdict. compliant iff no 'must' point is missing/violated.
function evaluate(tpl, payload) {
  const points = tpl.points.map((p) => {
    const e = evalPoint(p, payload || {});
    return { key: p.key, label: p.label, obligation: p.obligation, status: e.status, value: e.value, detail: e.detail };
  });
  const gaps = points.filter((p) => p.obligation === 'must' && p.status !== 'ok');
  return {
    standard: tpl.standard,
    title: tpl.title,
    cite: tpl.cite,
    compliant: gaps.length === 0,
    points,
    gaps: gaps.map((g) => ({ key: g.key, label: g.label, status: g.status, detail: g.detail })),
  };
}

module.exports = { getTemplate, listTemplates, evaluate };
