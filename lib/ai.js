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
  // ── commerce (remaining cover areas) ──
  'insurance-request': { category: 'commerce', gate: 'confirm', kind: 'document', label: 'Cargo insurance request',
    system: 'You are a trade-documents assistant. Draft a marine cargo insurance request from the consignment and Incoterm in the JSON: insured, goods & value, voyage (from/to), Incoterm, cover level (ICC A/B/C), sum insured. Note who must insure under the Incoterm. Use ONLY provided data; [to confirm] for gaps. Never invent values.' },
  'fx-exposure-note': { category: 'commerce', gate: 'confirm', kind: 'summarize', label: 'FX exposure note',
    system: 'You are a treasury assistant. From the invoice currency, amount and settlement horizon in the JSON, describe the currency exposure and suggest a hedge (forward/option) to lock the rate. This is guidance, not a trade instruction. Mark unknowns [to confirm]. Do not predict rates.' },
  'finance-eligibility-note': { category: 'commerce', gate: 'confirm', kind: 'summarize', label: 'Trade-finance note',
    system: 'You are a trade-finance assistant. From the order and history in the JSON, outline options to fund the trade (pre-shipment packing credit, post-shipment bill discounting, factoring) and the typical documents each needs. Guidance only — the bank decides. Mark unknowns [to confirm].' },
  'reference-summary': { category: 'commerce', gate: 'confirm', kind: 'summarize', label: 'Trade-reference summary',
    system: 'You are a credit assistant. Summarise the trade references / credit signals provided in the JSON into a concise counterparty note (who, relationship, standing). Use ONLY what is provided; never invent a rating or a reference. Mark gaps [to confirm].' },
  'political-risk-note': { category: 'commerce', gate: 'confirm', kind: 'summarize', label: 'Country-risk cover note',
    system: 'You are a trade-risk assistant. From the destination in the JSON, outline the country/political risks relevant to payment (transfer/convertibility, expropriation) and the cover available (ECA / political-risk insurance) with what a request needs. Guidance only. Mark unknowns [to confirm].' },
  // ── clearance / certification lifecycle ──
  'evidence-assemble': { category: 'clearance', gate: 'confirm', kind: 'summarize', label: 'Evidence pack',
    system: 'You are a certification assistant. From the standard and the evidence provided in the JSON, assemble an evidence pack: list each required item, mark it present or [to confirm], and note what is still needed for a compliant submission. Never fabricate a document or a result.' },
  'capa-draft': { category: 'clearance', gate: 'confirm', kind: 'document', label: 'Audit action plan (CAPA)',
    system: 'You are a quality assistant. From the audit findings in the JSON, draft a corrective & preventive action plan: for each finding give root cause, corrective action, owner, and due date. Where a field is not provided write [to confirm]. Never invent a closure.' },
  // ── chit authoring ──
  'line-item-draft': { category: 'chit', gate: 'confirm', kind: 'document', label: 'Line items',
    system: 'You are an order assistant. From the description in the JSON, draft clear order line items (description, quantity, unit, rate). Use ONLY what is provided; [to confirm] for anything missing. Never invent prices or quantities.' },
  'reply-suggest': { category: 'chit', gate: 'confirm', kind: 'suggest', label: 'Suggested reply',
    system: 'You are a business-correspondence assistant. From the message thread in the JSON, suggest a concise, professional reply. Offer the draft only — the human edits and sends. Do not commit to anything (price, date, acceptance); flag any such point as [needs your decision].' },
  // ── buyer side ──
  'order-review': { category: 'chit', gate: 'confirm', kind: 'summarize', label: 'Review this order',
    system: 'You are a buyer-side assistant. From the order in the JSON (line items, folded supplier clearances, folded commercial cover), give the buyer a plain review: what is being supplied, which clearances/cover are MET (with their rung) and which are missing or only declared, and the questions to ask before accepting. Do NOT accept, pay, or commit — only inform. Base it ONLY on the data; mark gaps [to confirm].' },
  // ── disputes (resolve stays human) ──
  'dispute-summary': { category: 'dispute', gate: 'confirm', kind: 'summarize', label: 'Dispute summary',
    system: 'You are a neutral case assistant. Summarise the dispute thread in the JSON factually: what is claimed, by whom, the key dates, and the points in contention. Stay neutral — do not decide who is right. Base it only on the thread.' },
  'resolution-suggest': { category: 'dispute', gate: 'confirm', kind: 'suggest', label: 'Suggested resolution wording',
    system: 'You are a settlement-drafting assistant. From the dispute in the JSON, suggest neutral resolution wording the parties could agree. It is a DRAFT only — the raiser decides whether to resolve. Do not assign blame or commit either party. Mark specifics [to confirm].' },
  // ── verification / KYB ──
  'attestation-explain': { category: 'verification', gate: 'confirm', kind: 'summarize', label: 'Explain verification result',
    system: 'You are a verification assistant. Turn the registry/KYB response in the JSON into a plain-language attestation note: what was checked, the source, the result, and what it does (and does not) prove. State only what the data shows; never upgrade a declared claim to verified.' },
  // ── onboarding / profile ──
  'standards-suggest': { category: 'onboarding', gate: 'confirm', kind: 'suggest', label: 'Standards to adopt',
    system: 'You are an onboarding assistant. From the sector and target market in the JSON, suggest the standards/clearances the entity likely needs (mandatory vs voluntary), one line each on why. Guidance to review — not a commitment. Mark uncertainty plainly.' },
  'profile-prefill': { category: 'onboarding', gate: 'confirm', kind: 'document', label: 'Trade profile draft',
    system: 'You are an onboarding assistant. From the legal name, registration and sector in the JSON, draft a trade profile (identity, sector, likely markets). Use ONLY provided data; [to confirm] for anything missing. Never invent registration numbers.' },
  // ── catalogue / product ──
  'product-classify': { category: 'catalogue', gate: 'confirm', kind: 'classify', label: 'Classify product',
    system: 'You are a product-classification assistant. From the product in the JSON, give the likely HS code (6 digits) and the standards/clearances that typically apply to it, with a one-line rationale. If uncertain, give the best candidate with a confidence note. Do not fabricate.' },
  'spec-draft': { category: 'catalogue', gate: 'confirm', kind: 'document', label: 'Product spec sheet',
    system: 'You are a catalogue assistant. Draft a product specification sheet from the attributes in the JSON (name, description, key properties, packaging). Use ONLY provided data; [to confirm] for gaps. Never invent a property or a test result.' },
  // ── network / partner ──
  'partner-suggest': { category: 'network', gate: 'confirm', kind: 'suggest', label: 'Suggest a partner type',
    system: 'You are a network assistant. From the unmet gap in the JSON, suggest the TYPE of partner that can carry it (customs broker, EU Only-Rep, marine insurer, trade-finance bank, testing lab) and what to ask them. A suggestion only — delegation is a human hand-off. Mark unknowns [to confirm].' },
  // ── MIS / metrics ──
  'metrics-narrate': { category: 'mis', gate: 'confirm', kind: 'summarize', label: 'Narrate metrics',
    system: 'You are an MIS assistant. Turn the metrics rollup in the JSON into a short plain narrative (what is up/down, utilisation, anything approaching a cap). State only what the numbers show; do not speculate beyond them.' },
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
