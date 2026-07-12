// lib/ai.js — the AI CO-ASSIST. INVOKED (never autonomous) → PROPOSES a draft → the human confirms. Gated on
// ANTHROPIC_API_KEY (honest 503 if not connected). The key is platform-shared, so every call LOGS per-entity usage
// (tokens + est cost) for metering / charge-back. The AI never commits — it returns a draft for a human to accept.
const { withEntity } = require('../db');
const MODEL = process.env.AI_MODEL || 'claude-haiku-4-5-20251001';   // cheap + fast for drafting; override via env
const PRICE = { in: Number(process.env.AI_PRICE_IN || 1), out: Number(process.env.AI_PRICE_OUT || 5) };  // $/1M tokens (estimate)

// doc_type → how to draft it. Instructions insist on: use ONLY provided data, mark unknowns [to confirm], never fabricate.
const DOCS = {
  'export-declaration': 'You are a trade-compliance assistant. Draft a concise Export Declaration / Shipping Bill for the consignment described in the JSON. Include the standard fields: Exporter, Consignee, HS Code, Goods description, Quantity, Unit value & total value, Currency, Incoterm, Country of origin, Ports of loading/discharge. Use ONLY the data provided; put [to confirm] for anything missing. Never invent values. Return a clean labelled form, not prose.',
  'hs-code': 'You are a customs classification assistant. From the product described, give the most likely HS Code (6 digits), the heading description, and a one-line rationale. If uncertain, say so and give the best candidate with a confidence note. Do not fabricate.',
  'sds': 'You are a chemical-safety documentation assistant. Draft a GHS-format Safety Data Sheet (the 16 standard sections) for the product/formulation described. For any hazard/property you cannot determine from the input, write [to confirm] — never fabricate hazard or toxicology data. Keep each section brief.',
  'commercial-invoice': 'You are a trade-documents assistant. Draft a Commercial Invoice for the order in the JSON: seller, buyer, invoice no [to confirm], line items (description, HS code, qty, unit price, amount), subtotal, total, currency, Incoterm, payment terms. Use ONLY provided data; [to confirm] for gaps. Never invent values.',
};

async function draftDocument(entity_id, doc_type, context) {
  if (!process.env.ANTHROPIC_API_KEY) { const e = new Error('AI not connected — set ANTHROPIC_API_KEY.'); e.status = 503; throw e; }
  const system = DOCS[doc_type];
  if (!system) { const e = new Error('Unknown document type "' + doc_type + '".'); e.status = 400; throw e; }
  const userMsg = 'Draft the document from this data (JSON). Mark anything not present as [to confirm]:\n\n' + JSON.stringify(context || {}, null, 2);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 1600, system, messages: [{ role: 'user', content: userMsg }] }),
  });
  if (!res.ok) { let t = ''; try { t = await res.text(); } catch (_) {} const e = new Error('AI HTTP ' + res.status + (t ? ': ' + t.slice(0, 240) : '')); e.status = 502; throw e; }
  const j = await res.json();
  const draft = (j.content && j.content[0] && j.content[0].text) || '';
  const u = j.usage || {};
  const est_cost_usd = +(((u.input_tokens || 0) * PRICE.in + (u.output_tokens || 0) * PRICE.out) / 1e6).toFixed(4);
  try { await logUsage(entity_id, doc_type, MODEL, u.input_tokens || 0, u.output_tokens || 0, est_cost_usd); } catch (_) {}   // metering, best-effort
  return { draft, model: MODEL, usage: { input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0, est_cost_usd }, note: 'AI DRAFT — review and confirm; not evidence until you accept it.' };
}

// Write one row to the GENERAL usage_ledger. AI drafts are meter='ai.draft'; the same table meters everything else.
async function logUsage(entity_id, doc_type, model, itok, otok, cost) {
  await withEntity(entity_id, (c) => c.query(
    "INSERT INTO usage_ledger (entity_id, meter, detail, quantity, cost_usd, meta) VALUES ($1,'ai.draft',$2,$3,$4,$5)",
    [entity_id, doc_type, itok + otok, cost, JSON.stringify({ model, input_tokens: itok, output_tokens: otok })]));
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

module.exports = { draftDocument, usageSummary, DOC_TYPES: Object.keys(DOCS) };
