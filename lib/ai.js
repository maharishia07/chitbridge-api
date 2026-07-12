// lib/ai.js — the AI CO-ASSIST. ONE co-assist per entity runs MANY skills; a skill = one purpose. Every skill is
// INVOKED (opt-in, never autonomous) → PROPOSES → the human confirms. You do NOT mint one co-assist per purpose:
// purpose is a parameter (skill_id), not a separate actor. All AI in the platform flows through invokeSkill() — the
// SINGLE point of change (model, pricing, gating, metering all live here). See C:\dev\AI-INVENTORY.md for every path.
const { withEntity } = require('../db');
const MODEL = process.env.AI_MODEL || 'claude-haiku-4-5-20251001';   // cheap + fast for drafting; override via env
const PRICE = { in: Number(process.env.AI_PRICE_IN || 1), out: Number(process.env.AI_PRICE_OUT || 5) };  // $/1M tokens (estimate)
const MAX_TOKENS = Number(process.env.AI_MAX_TOKENS || 1600);

// ── SKILL REGISTRY ── one entry per AI purpose. To add an invocation point anywhere in the model, add a skill HERE
// (one place) and call invokeSkill(entity_id, id, context) from that path. Fields:
//   category — where it's invoked (clearance / commerce / chit / dispute / onboarding …)
//   gate     — the human control: 'confirm' = human accepts the draft before it's used (all drafting is 'confirm').
//              AI never crosses the hard gates (money · send/commit · payment release · dispute resolve · re-adopt).
//   kind     — document | classify | summarize | suggest  (shape of the output, for the UI)
//   system   — the instruction. Every one insists: use ONLY provided data, mark unknowns [to confirm], never fabricate.
const SKILLS = {
  'export-declaration': { category: 'clearance', gate: 'confirm', kind: 'document', label: 'Export Declaration',
    system: 'You are a trade-compliance assistant. Draft a concise Export Declaration / Shipping Bill for the consignment described in the JSON. Include the standard fields: Exporter, Consignee, HS Code, Goods description, Quantity, Unit value & total value, Currency, Incoterm, Country of origin, Ports of loading/discharge. Use ONLY the data provided; put [to confirm] for anything missing. Never invent values. Return a clean labelled form, not prose.' },
  'hs-code': { category: 'clearance', gate: 'confirm', kind: 'classify', label: 'HS Code classification',
    system: 'You are a customs classification assistant. From the product described, give the most likely HS Code (6 digits), the heading description, and a one-line rationale. If uncertain, say so and give the best candidate with a confidence note. Do not fabricate.' },
  'sds': { category: 'clearance', gate: 'confirm', kind: 'document', label: 'Safety Data Sheet (GHS)',
    system: 'You are a chemical-safety documentation assistant. Draft a GHS-format Safety Data Sheet (the 16 standard sections) for the product/formulation described. For any hazard/property you cannot determine from the input, write [to confirm] — never fabricate hazard or toxicology data. Keep each section brief.' },
  'commercial-invoice': { category: 'commerce', gate: 'confirm', kind: 'document', label: 'Commercial Invoice',
    system: 'You are a trade-documents assistant. Draft a Commercial Invoice for the order in the JSON: seller, buyer, invoice no [to confirm], line items (description, HS code, qty, unit price, amount), subtotal, total, currency, Incoterm, payment terms. Use ONLY provided data; [to confirm] for gaps. Never invent values.' },
  'packing-list': { category: 'commerce', gate: 'confirm', kind: 'document', label: 'Packing List',
    system: 'You are a trade-documents assistant. Draft a Packing List for the order in the JSON: seller, buyer, package count, package type, net/gross weight, dimensions, marks & numbers, line items with quantities. Use ONLY provided data; [to confirm] for gaps. Never invent weights or dimensions.' },
  'lc-checklist': { category: 'commerce', gate: 'confirm', kind: 'summarize', label: 'LC document checklist (UCP 600)',
    system: 'You are a trade-finance assistant. From the Letter of Credit terms in the JSON, list the documents the beneficiary must present for a compliant presentation under UCP 600 (bill of lading, invoice, insurance, certificate of origin, etc.), with the key requirement/deadline for each. Flag any discrepancy risk. This is guidance for a human to check — do not assert compliance. Mark unknowns [to confirm].' },
  'incoterm-advice': { category: 'commerce', gate: 'confirm', kind: 'suggest', label: 'Incoterm suggestion',
    system: 'You are a trade-terms assistant. From the trade lane and parties in the JSON, suggest a suitable Incoterms 2020 term, explain where risk/cost transfers, and note what each side is then responsible for (insurance, freight, clearance). Give a recommendation with a one-line rationale, not a commitment. Mark unknowns [to confirm].' },
};

// Call the model for one skill. Returns { skill, draft, model, usage, gate, note }. 503 if AI not connected; 400 unknown skill.
async function invokeSkill(entity_id, skill_id, context) {
  const skill = SKILLS[skill_id];
  if (!skill) { const e = new Error('Unknown AI skill "' + skill_id + '".'); e.status = 400; throw e; }
  if (!process.env.ANTHROPIC_API_KEY) { const e = new Error('AI not connected — set ANTHROPIC_API_KEY.'); e.status = 503; throw e; }
  const userMsg = 'Do the task from this data (JSON). Mark anything not present as [to confirm]:\n\n' + JSON.stringify(context || {}, null, 2);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system: skill.system, messages: [{ role: 'user', content: userMsg }] }),
  });
  if (!res.ok) { let t = ''; try { t = await res.text(); } catch (_) {} const e = new Error('AI HTTP ' + res.status + (t ? ': ' + t.slice(0, 240) : '')); e.status = 502; throw e; }
  const j = await res.json();
  const draft = (j.content && j.content[0] && j.content[0].text) || '';
  const u = j.usage || {};
  const est_cost_usd = +(((u.input_tokens || 0) * PRICE.in + (u.output_tokens || 0) * PRICE.out) / 1e6).toFixed(4);
  try { await logUsage(entity_id, skill_id, MODEL, u.input_tokens || 0, u.output_tokens || 0, est_cost_usd); } catch (_) {}   // metering, best-effort
  return { skill: skill_id, kind: skill.kind, gate: skill.gate, draft, model: MODEL,
    usage: { input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0, est_cost_usd },
    note: 'AI DRAFT — review and confirm; not evidence until you accept it.' };
}

// The inventory the UI/plumbing reads to know what it can invoke where. (id · category · kind · gate · label)
function listSkills() {
  return Object.keys(SKILLS).map((id) => ({ id, category: SKILLS[id].category, kind: SKILLS[id].kind, gate: SKILLS[id].gate, label: SKILLS[id].label }));
}

// Back-compat: the doc-drafting entry point is just invokeSkill by another name.
function draftDocument(entity_id, doc_type, context) { return invokeSkill(entity_id, doc_type, context); }

// Write one row to the GENERAL usage_ledger. AI runs are meter='ai.draft'; detail = the skill. Same table meters everything else.
async function logUsage(entity_id, skill_id, model, itok, otok, cost) {
  await withEntity(entity_id, (c) => c.query(
    "INSERT INTO usage_ledger (entity_id, meter, detail, quantity, cost_usd, meta) VALUES ($1,'ai.draft',$2,$3,$4,$5)",
    [entity_id, skill_id, itok + otok, cost, JSON.stringify({ model, input_tokens: itok, output_tokens: otok })]));
}
// AI spend for this entity, plus the prepaid wallet balance (credits − ALL-meter spend, so it reflects total drawdown).
async function usageSummary(entity_id) {
  try {
    const r = await withEntity(entity_id, (c) => c.query(
      "SELECT count(*)::int AS calls, COALESCE(sum(quantity),0)::bigint AS tokens, COALESCE(sum(cost_usd),0)::numeric(12,4) AS spent_usd FROM usage_ledger WHERE meter='ai.draft' AND entity_id = $1", [entity_id]));
    const t = await withEntity(entity_id, (c) => c.query(
      'SELECT COALESCE(sum(cost_usd),0)::numeric(12,4) AS all_spent FROM usage_ledger WHERE entity_id = $1', [entity_id]));
    const w = await withEntity(entity_id, (c) => c.query(
      'SELECT COALESCE(credits_usd,0)::numeric(12,4) AS credits FROM entity_wallet WHERE entity_id = $1', [entity_id]));
    const ai = r.rows[0] || { calls: 0, tokens: 0, spent_usd: 0 };
    const credits = Number((w.rows[0] && w.rows[0].credits) || 0);
    const all_spent = Number((t.rows[0] && t.rows[0].all_spent) || 0);
    return { ...ai, credits_usd: credits, balance_usd: +(credits - all_spent).toFixed(4) };
  } catch (_) { return { calls: 0, tokens: 0, spent_usd: 0, credits_usd: 0, balance_usd: 0, note: 'metering not migrated yet (b99)' }; }
}

module.exports = { invokeSkill, listSkills, draftDocument, usageSummary, SKILLS, DOC_TYPES: Object.keys(SKILLS) };
