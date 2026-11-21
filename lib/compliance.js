// CALLED BY routes/assist.js
// OWNS      the deterministic conform-check: the compliance template per standard and evaluate(template, payload) giving a verdict, no model involved
// FLOW      standard ──▶ getTemplate ──▶ evaluate(template, payload): evalPoint per data point ──▶ { compliant, points } ──▶ routes/assist.js adds the narrative only when a model is configured
// CARD      21-compliance-attestation-and-trade/attestation-and-verification
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
      { key: 'batch_id', label: 'Batch / lot identifier', obligation: 'must', rule: { present: true } },
      { key: 'expiry_date', label: 'Expiry date', obligation: 'must', rule: { present: true } },
      { key: 'haccp_checked', label: 'HACCP check performed', obligation: 'must', rule: { equals: true } }
    ]
  }
};

function getTemplate(standard) {
  // Self-healing hook: a DB-minted template would be read here first; for first light we serve the code fallback.
  return TEMPLATES[standard] || null;
}

function listTemplates() {
  // Include the required data points (+ their rule) — this is the "what must be collected" the UI renders as a form,
  // and it's exactly what the standards layer is meant to surface (transparency: the requirement is visible).
  return Object.values(TEMPLATES).map((item) => ({
    standard: item.standard,
    title: item.title,
    points: item.points.map((entry) => ({ key: entry.key, label: entry.label, obligation: entry.obligation, rule: entry.rule }))
  }));
}

// A number-bounded rule (max or min): the value must be a number on the right side of the bound.
function evalBound(value, bound, direction) {
  const number = Number(value);
  if (Number.isNaN(number)) return { status: 'violated', value, detail: 'not a number' };
  const ok = direction === 'max' ? number <= bound : number >= bound;
  const holds = direction === 'max' ? `≤ ${bound}` : `≥ ${bound}`;
  const breaks = direction === 'max' ? `exceeds max ${bound}` : `below min ${bound}`;
  return { status: ok ? 'ok' : 'violated', value: number, detail: ok ? holds : breaks };
}

// Evaluate ONE data point against its rule → { status: 'ok' | 'missing' | 'violated', detail }.
function evalPoint(point, payload) {
  const provided = payload != null && Object.prototype.hasOwnProperty.call(payload, point.key) && payload[point.key] !== null && payload[point.key] !== '';
  const value = provided ? payload[point.key] : undefined;
  const rule = point.rule || {};
  if (!provided) {
    // Optional points that are absent are fine; a required-but-absent point is a gap.
    return { status: point.obligation === 'must' ? 'missing' : 'ok', value: null, detail: point.obligation === 'must' ? 'required, not provided' : 'optional, absent' };
  }
  if (rule.present === true) return { status: 'ok', value, detail: 'present' };
  if (rule.equals !== undefined) {
    const ok = value === rule.equals;
    return { status: ok ? 'ok' : 'violated', value, detail: ok ? 'matches' : `must equal ${rule.equals}` };
  }
  if (rule.max !== undefined) return evalBound(value, rule.max, 'max');
  if (rule.min !== undefined) return evalBound(value, rule.min, 'min');
  return { status: 'ok', value, detail: 'no rule' };
}

// evaluate(template, payload) → the DETERMINISTIC verdict. compliant iff no 'must' point is missing/violated.
function evaluate(template, payload) {
  const points = template.points.map((item) => {
    const verdict = evalPoint(item, payload || {});
    return { key: item.key, label: item.label, obligation: item.obligation, status: verdict.status, value: verdict.value, detail: verdict.detail };
  });
  const gaps = points.filter((item) => item.obligation === 'must' && item.status !== 'ok');
  return {
    standard: template.standard,
    title: template.title,
    cite: template.cite,
    compliant: gaps.length === 0,
    points,
    gaps: gaps.map((item) => ({ key: item.key, label: item.label, status: item.status, detail: item.detail }))
  };
}

module.exports = { getTemplate, listTemplates, evaluate };
