// lib/forms.js — the AUTHORITY-FORMS engine. Turns data CB already holds into a submission-ready form:
//   define (a form = an ordered set of fields) → resolve (fill each field by SOURCE PRECEDENCE, stamping provenance +
//   a trust rung) → issue (freeze-by-value into a form_instance, per-copy WITH RLS) → sign → transfer (rides the
//   existing chit rail — the issued form attaches to /chits/send; we do NOT duplicate send here).
//
// The field × source-precedence model is the point: each field auto-fills from the BEST available source (an order-bound
// chit, then the trade vault, then a derived value), and a human can override any field. ERP / IoT / AI are PLUGGABLE
// sources — INERT until configured (no fabrication, same discipline as the KYB field provider). Every filled value
// carries WHERE it came from and HOW MUCH TO TRUST IT (rung), and the PLATFORM writes the rung — never a client field
// (the T1 rule): a self-supplied value is `declared` no matter which channel carried it; only a real owned record
// (an order) is `documented`; a computed value is `derived`. Nothing here mints `verified`/`attested` from a self-write.
const crypto = require('crypto');
const { withEntity } = require('../db');
const profile = require('./profile');
const storage = require('./storage');

// ── SOURCE → RUNG (platform-written; the T1 rule). A channel never buys trust; only the nature of the datum does. ──
const SOURCE_RUNG = {
  order:  'documented',   // pulled from a real, owned, order-bound chit record (freeze-by-value already happened there)
  vault:  'declared',     // your gathered profile — reused, but still self-asserted until a registry verifies it
  manual: 'declared',     // typed for this form (an override/correction)
  derive: 'derived',      // computed by the platform (a date, a concatenation)
  erp:    'declared',     // machine-asserted, unverified — inert until an adapter is configured
  iot:    'declared',     // measured by a device — inert until configured
  ai:     'declared',     // AI-proposed — inert until configured; would also carry needs_confirm
};

// ── FORM REGISTRY (config-driven — a registry is DATA, not code; override the whole set via FORMS_REGISTRY json, or
// move to the governance cascade later). Each field: { id, label, required?, auto:[ ordered source specs ] }.
// A source spec is { from:'order'|'vault'|'derive'|'erp'|'iot'|'ai', path?:'group.key', fn?:'today' }.
// `manual` is not listed in auto — it is an override the human may supply for ANY field, and it always wins when given.
function registry() {
  const env = (() => { try { return JSON.parse(process.env.FORMS_REGISTRY || 'null'); } catch (_) { return null; } })();
  return env || {
    'certificate-of-origin': {
      title: 'Certificate of Origin',
      authority: 'Chamber of Commerce / issuing authority',
      fields: [
        { id: 'exporter',        label: 'Exporter (legal name & address)', required: true,  auto: [{ from: 'order', path: 'seller.legal_name' }, { from: 'vault', path: 'identity.legal_name' }] },
        { id: 'exporter_address', label: 'Exporter address',               required: true,  auto: [{ from: 'vault', path: 'identity.address' }] },
        { id: 'consignee',       label: 'Consignee',                       required: true,  auto: [{ from: 'order', path: 'buyer.legal_name' }, { from: 'order', path: 'consignee' }] },
        { id: 'origin_country',  label: 'Country of origin',               required: true,  auto: [{ from: 'vault', path: 'identity.country' }, { from: 'derive', fn: 'india' }] },
        { id: 'invoice_no',      label: 'Invoice number',                  required: true,  auto: [{ from: 'order', path: 'invoice_no' }] },
        { id: 'invoice_date',    label: 'Invoice date',                    required: true,  auto: [{ from: 'order', path: 'invoice_date' }] },
        { id: 'goods',           label: 'Description of goods',            required: true,  auto: [{ from: 'order', path: 'goods_description' }] },
        { id: 'hs_code',         label: 'HS / tariff code',                required: false, auto: [{ from: 'order', path: 'hs_code' }] },
        { id: 'gross_weight',    label: 'Gross weight',                    required: false, auto: [{ from: 'order', path: 'gross_weight' }, { from: 'iot', path: 'weigh.gross' }] },
        { id: 'signatory',       label: 'Authorised signatory',           required: true,  auto: [{ from: 'vault', path: 'signatory.name' }] },
        { id: 'place',           label: 'Place of issue',                  required: true,  auto: [{ from: 'vault', path: 'identity.city' }] },
        { id: 'issue_date',      label: 'Date of issue',                   required: true,  auto: [{ from: 'derive', fn: 'today' }] },
      ],
    },
    'commercial-invoice': {
      title: 'Commercial Invoice',
      authority: 'Customs / buyer',
      fields: [
        { id: 'seller',        label: 'Seller',            required: true,  auto: [{ from: 'vault', path: 'identity.legal_name' }] },
        { id: 'seller_gstin',  label: 'Seller GSTIN',      required: false, auto: [{ from: 'vault', path: 'registrations.gstin' }] },
        { id: 'seller_iec',    label: 'IEC',               required: false, auto: [{ from: 'vault', path: 'registrations.iec' }] },
        { id: 'buyer',         label: 'Buyer',             required: true,  auto: [{ from: 'order', path: 'buyer.legal_name' }] },
        { id: 'invoice_no',    label: 'Invoice number',    required: true,  auto: [{ from: 'order', path: 'invoice_no' }] },
        { id: 'invoice_date',  label: 'Invoice date',      required: true,  auto: [{ from: 'order', path: 'invoice_date' }, { from: 'derive', fn: 'today' }] },
        { id: 'incoterm',      label: 'Incoterm',          required: false, auto: [{ from: 'order', path: 'incoterm' }, { from: 'vault', path: 'logistics.incoterm' }] },
        { id: 'port_loading',  label: 'Port of loading',   required: false, auto: [{ from: 'vault', path: 'logistics.port_loading' }] },
        { id: 'total_value',   label: 'Invoice value',     required: true,  auto: [{ from: 'order', path: 'total_value' }] },
        { id: 'bank',          label: 'Beneficiary bank',  required: false, auto: [{ from: 'vault', path: 'banking.bank_name' }] },
        { id: 'account_no',    label: 'Account number',    required: false, auto: [{ from: 'vault', path: 'banking.account_no' }] },
        { id: 'swift',         label: 'SWIFT',             required: false, auto: [{ from: 'vault', path: 'banking.swift' }] },
      ],
    },
    'authority-application': {
      title: 'Authority application (generic NOC / licence)',
      authority: 'Issuing authority (municipal / panchayat / department)',
      fields: [
        { id: 'applicant',   label: 'Applicant (legal name)', required: true,  auto: [{ from: 'vault', path: 'identity.legal_name' }] },
        { id: 'address',     label: 'Registered address',     required: true,  auto: [{ from: 'vault', path: 'identity.address' }] },
        { id: 'gstin',       label: 'GSTIN',                  required: false, auto: [{ from: 'vault', path: 'registrations.gstin' }] },
        { id: 'pan',         label: 'PAN',                    required: false, auto: [{ from: 'vault', path: 'registrations.pan' }] },
        { id: 'signatory',   label: 'Authorised signatory',   required: true,  auto: [{ from: 'vault', path: 'signatory.name' }] },
        { id: 'designation', label: 'Designation',            required: false, auto: [{ from: 'vault', path: 'signatory.designation' }] },
        { id: 'purpose',     label: 'Purpose of application', required: true,  auto: [] },   // no auto source → must be supplied manually
        { id: 'date',        label: 'Date',                   required: true,  auto: [{ from: 'derive', fn: 'today' }] },
      ],
    },
  };
}

const nonEmpty = (v) => v != null && String(v).trim() !== '';
const dig = (obj, path) => String(path || '').split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

// pluggable, INERT sources — return null until a real adapter is configured. NO fabrication: CB will not invent an
// ERP reading or an IoT weight. (Same wall as the KYB field provider.)
function externalSource(from /*, path, ctx */) {
  const on = {
    erp: process.env.FORMS_ERP_PROVIDER && process.env.FORMS_ERP_KEY,
    iot: process.env.FORMS_IOT_PROVIDER && process.env.FORMS_IOT_KEY,
    ai:  process.env.FORMS_AI_PROVIDER  || process.env.OPENAI_API_KEY,   // AI would still need a human confirm before it counts
  }[from];
  return on ? null /* TODO(UAT): plug the adapter → returns a value */ : null;
}

function deriveValue(fn) {
  if (fn === 'today') return new Date().toISOString().slice(0, 10);
  if (fn === 'india') return 'India';
  if (fn === 'blank') return '';
  return null;
}

// read the order/context — the entity's OWN chit copy (per-copy, withEntity). Shapes vary, so every path is tolerant.
async function readOrder(entity_id, context_ref) {
  if (!context_ref) return {};
  try {
    const r = await withEntity(entity_id, (c) => c.query(
      `SELECT subject, sender_entity_display_name, all_recipients, total_value, summary_json
         FROM chit_header WHERE entity_id = $1 AND chit_id = $2`, [entity_id, context_ref]));
    const row = r.rows[0]; if (!row) return {};
    const s = row.summary_json || {};
    const firstTo = (Array.isArray(row.all_recipients) ? row.all_recipients : []).find((x) => x.role === 'receiver' || x.role === 'to');
    // present a flat, forgiving view the field paths dig into
    return {
      ...s,
      invoice_no: s.invoice_no || row.subject || null,
      invoice_date: s.invoice_date || (s.commercial && s.commercial.invoice_date) || null,
      total_value: row.total_value != null ? row.total_value : (s.total_value || null),
      goods_description: s.goods_description || (Array.isArray(s.line_items) ? s.line_items.map((li) => li.description).filter(Boolean).join('; ') : null),
      seller: s.seller || { legal_name: row.sender_entity_display_name || null },
      buyer: s.buyer || { legal_name: (firstTo && firstTo.display_name) || null },
      consignee: s.consignee || (firstTo && firstTo.display_name) || null,
      incoterm: (s.commercial && s.commercial.incoterm) || s.incoterm || null,
    };
  } catch (_) { return {}; }
}

// resolve ONE field: manual override wins; else walk `auto` in order; first non-empty source wins. Stamp provenance.
function resolveField(field, ctx) {
  const { vault, order, manual } = ctx;
  if (manual && nonEmpty(manual[field.id])) {
    return { id: field.id, label: field.label, required: !!field.required, value: String(manual[field.id]).trim(), source: 'manual', rung: SOURCE_RUNG.manual };
  }
  for (const src of (field.auto || [])) {
    let val = null;
    if (src.from === 'vault') val = dig(vault, src.path);
    else if (src.from === 'order') val = dig(order, src.path);
    else if (src.from === 'derive') val = deriveValue(src.fn);
    else val = externalSource(src.from, src.path, ctx);   // erp/iot/ai → inert
    if (nonEmpty(val)) {
      return { id: field.id, label: field.label, required: !!field.required, value: String(val).trim(), source: src.from, rung: SOURCE_RUNG[src.from] || 'declared' };
    }
  }
  return { id: field.id, label: field.label, required: !!field.required, value: null, source: null, rung: null };
}

function listForms() {
  const reg = registry();
  return Object.keys(reg).map((k) => ({ key: k, title: reg[k].title, authority: reg[k].authority, field_count: reg[k].fields.length }));
}
function getForm(form_key) {
  const def = registry()[form_key];
  if (!def) { const e = new Error('Unknown form: ' + form_key); e.status = 404; throw e; }
  return def;
}

// ── RESOLVE — fill the whole form (free; a read + compute over owned data). Does NOT persist. ──
async function resolveForm(entity_id, form_key, { context_ref, manual } = {}) {
  const def = getForm(form_key);
  const p = await profile.getProfile(entity_id).catch(() => ({}));
  const order = await readOrder(entity_id, context_ref);
  const ctx = { vault: p.vault || {}, order, manual: manual || {} };
  const fields = def.fields.map((f) => resolveField(f, ctx));
  const filled = fields.filter((f) => nonEmpty(f.value));
  const unresolved_required = fields.filter((f) => f.required && !nonEmpty(f.value)).map((f) => ({ id: f.id, label: f.label }));
  // provenance roll-up — how much of the form stands on what
  const by_source = {}; filled.forEach((f) => { by_source[f.source] = (by_source[f.source] || 0) + 1; });
  return {
    form_key, title: def.title, authority: def.authority, context_ref: context_ref || null,
    fields,
    completeness: { filled: filled.length, total: fields.length, pct: fields.length ? Math.round((filled.length / fields.length) * 100) : 0 },
    provenance: by_source,
    ready: unresolved_required.length === 0,
    unresolved_required,
    note: 'Each field shows its source and trust rung. `documented` = pulled from a real order; `declared` = from your vault or typed here; `derived` = computed. Nothing here is `verified` — verify at the issuing authority. Not a governance claim.',
  };
}

function contentHash(form_key, fields, context_ref) {
  const canon = JSON.stringify({ form_key, context_ref: context_ref || null, fields: fields.map((f) => ({ id: f.id, value: f.value, source: f.source })) });
  return crypto.createHash('sha256').update(canon).digest('hex');
}

// ── ISSUE — freeze-by-value into a form_instance (per-copy, WITH RLS). Refuses if a required field is unresolved. ──
async function issueForm(entity_id, form_key, { context_ref, manual } = {}) {
  const resolved = await resolveForm(entity_id, form_key, { context_ref, manual });
  if (!resolved.ready) { const e = new Error('Form is not ready — required fields unresolved: ' + resolved.unresolved_required.map((u) => u.label).join(', ')); e.status = 400; e.code = 'FORM_NOT_READY'; e.unresolved = resolved.unresolved_required; throw e; }
  const hash = contentHash(form_key, resolved.fields, context_ref);
  const provenance = { by_source: resolved.provenance, fields: resolved.fields.map((f) => ({ id: f.id, source: f.source, rung: f.rung })) };
  try {
    const r = await withEntity(entity_id, (db) => db.query(
      `INSERT INTO form_instance (entity_id, form_key, context_ref, title, fields, provenance, content_hash, ready)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,true) RETURNING form_id, created_at`,
      [entity_id, form_key, context_ref || null, resolved.title, JSON.stringify(resolved.fields), JSON.stringify(provenance), hash]));
    return { form_id: r.rows[0].form_id, form_key, title: resolved.title, content_hash: hash, created_at: r.rows[0].created_at, ready: true,
      note: 'Issued and frozen by value. Attach to a chit to transfer it on the rail (/chits/send), or print → sign → hand to the authority.' };
  } catch (e) {
    if (e && (e.code === '42P01' || e.code === '42703')) { const err = new Error('Forms not migrated yet (b108).'); err.status = 503; err.code = 'FORMS_STORE_MISSING'; throw err; }
    throw e;
  }
}

async function listInstances(entity_id) {
  try {
    const r = await withEntity(entity_id, (db) => db.query(
      `SELECT form_id, form_key, title, content_hash, ready, signed_at, created_at FROM form_instance WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 100`, [entity_id]));
    return { instances: r.rows };
  } catch (e) { if (e && (e.code === '42P01')) return { instances: [], note: 'Forms not migrated yet (b108).' }; throw e; }
}

async function getInstance(entity_id, form_id) {
  const r = await withEntity(entity_id, (db) => db.query(`SELECT * FROM form_instance WHERE entity_id = $1 AND form_id = $2`, [entity_id, form_id]));
  if (!r.rows[0]) { const e = new Error('Form instance not found'); e.status = 404; throw e; }
  return r.rows[0];
}

// ── SIGN — stamp WHO signed + when onto the frozen instance. Phase 1 = an attestation record (name/designation/ts);
// cryptographic e-sign is a later rung. The platform stamps signed_at; the signatory identity comes from the vault by
// default (an authorised signatory), or an explicit one is passed. Signing an already-signed or unready form is refused.
async function signForm(entity_id, form_id, { name, designation } = {}) {
  const inst = await getInstance(entity_id, form_id);
  if (inst.signed_at) { const e = new Error('Form is already signed'); e.status = 409; throw e; }
  if (!inst.ready) { const e = new Error('Cannot sign an unready form'); e.status = 400; throw e; }
  let sig = { name, designation };
  if (!nonEmpty(sig.name)) { const p = await profile.getProfile(entity_id).catch(() => ({})); const v = (p.vault && p.vault.signatory) || {}; sig = { name: v.name || null, designation: designation || v.designation || null }; }
  if (!nonEmpty(sig.name)) { const e = new Error('No signatory — set an authorised signatory in the vault, or pass one'); e.status = 400; throw e; }
  const r = await withEntity(entity_id, (db) => db.query(
    `UPDATE form_instance SET signatory = $3::jsonb, signed_at = now() WHERE entity_id = $1 AND form_id = $2 RETURNING form_id, signed_at, signatory`,
    [entity_id, form_id, JSON.stringify(sig)]));
  return { form_id: r.rows[0].form_id, signed_at: r.rows[0].signed_at, signatory: r.rows[0].signatory, note: 'Signed (attestation record). Cryptographic e-sign is a later rung.' };
}

// ── TRANSFER — file the issued form onto a chit as a PER-COPY attachment (rides the existing rail; cb-core-principle).
// The frozen instance renders to a self-contained document (portable, print→PDF on the receiver's side). We attach it
// with storage.putForParticipants → one row PER participant entity (each owns its copy; verify/dispute on their side).
// mime text/html is force-DOWNLOADED by the attachment route (S2), never rendered inline on our origin.
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function renderFormHtml(inst) {
  const def = registry()[inst.form_key] || {};
  const rows = (inst.fields || []).filter((f) => f.value != null && f.value !== '')
    .map((f) => `<tr><td class="k">${esc(f.label)}</td><td class="v">${esc(f.value)}</td></tr>`).join('');
  const sig = inst.signatory ? `${esc(inst.signatory.name)}${inst.signatory.designation ? '<br><small>' + esc(inst.signatory.designation) + '</small>' : ''}` : 'Signature';
  const signed = inst.signed_at ? `<div class="signed">Signed ${esc(String(inst.signed_at).slice(0, 10))}</div>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(inst.title)}</title><style>
body{font-family:Georgia,'Times New Roman',serif;color:#111;max-width:720px;margin:32px auto;padding:0 24px}
h1{text-align:center;font-size:20px;margin:0 0 3px}.auth{text-align:center;font-size:11px;color:#555;text-transform:uppercase;letter-spacing:.08em;margin-bottom:22px}
table{width:100%;border-collapse:collapse}td{padding:8px 4px;border-bottom:1px dotted #ccc;font-size:14px;vertical-align:top}
td.k{width:42%;color:#444;font-weight:bold}.sigblock{margin-top:40px;text-align:right}.signed{color:#2f7a45;font-weight:bold;font-size:12px;margin-bottom:6px}
.sigline{display:inline-block;border-top:1px solid #333;padding-top:5px;min-width:200px;font-size:13px;text-align:left}
.meta{margin-top:26px;font-size:10px;color:#999;border-top:1px solid #eee;padding-top:8px}@media print{body{margin:0}}
</style></head><body><h1>${esc(inst.title)}</h1><div class="auth">${esc(def.authority || '')}</div>
<table>${rows}</table><div class="sigblock">${signed}<div class="sigline">${sig}</div></div>
<div class="meta">Issued via Chit &amp; Bridge &middot; content hash ${esc(String(inst.content_hash || '').slice(0, 24))}… &middot; self-prepared submission — verify at the issuing authority.</div>
</body></html>`;
}

async function attachToChit(entity_id, form_id, chit_id, uploaded_by) {
  if (!chit_id) { const e = new Error('chit_id is required'); e.status = 400; throw e; }
  try {
    const inst = await getInstance(entity_id, form_id);   // 404 if not the caller's / not found
    // caller must be a participant on the chit — its own copy carries the full roster
    const roster = await withEntity(entity_id, (db) => db.query(
      `SELECT all_recipients FROM chit_header WHERE chit_id = $1 AND entity_id = $2 LIMIT 1`, [chit_id, entity_id]));
    if (!roster.rows.length) { const e = new Error('Not a participant on this chit'); e.status = 403; throw e; }
    let participants = [...new Set((roster.rows[0].all_recipients || []).map((r) => r.entity_id).filter(Boolean))];
    if (!participants.includes(entity_id)) participants.push(entity_id);

    const buffer = Buffer.from(renderFormHtml(inst), 'utf8');
    const name = (inst.title || 'form').replace(/[^\w .-]+/g, '_').slice(0, 80) + '.html';
    const attachment_id = await storage.putForParticipants({
      chit_id, message_id: null, line_index: null, name, mime: 'text/html', size: buffer.length, buffer,
      uploaded_by: uploaded_by || null, participants, forEntity: entity_id });
    // stamp the transfer on the instance (idempotency/audit) — best-effort
    const rec = { chit_id, attachment_id, at: new Date().toISOString() };
    try {
      await withEntity(entity_id, (db) => db.query(
        `UPDATE form_instance SET transfers = COALESCE(transfers, '[]'::jsonb) || $3::jsonb WHERE entity_id = $1 AND form_id = $2`,
        [entity_id, form_id, JSON.stringify([rec])]));
    } catch (_) { /* transfers column pre-b108 → skip the stamp, attachment still filed */ }
    return { attachment_id, chit_id, name, participants: participants.length,
      note: 'Filed on the rail — every participant now has their OWN copy (per-copy; they verify / dispute on their side).' };
  } catch (e) {
    if (e && (e.code === '42P01' || e.code === '42703')) { const err = new Error('Forms not migrated yet (b108).'); err.status = 503; err.code = 'FORMS_STORE_MISSING'; throw err; }
    throw e;
  }
}

module.exports = { listForms, getForm, resolveForm, issueForm, listInstances, getInstance, signForm, attachToChit, renderFormHtml, contentHash, registry, SOURCE_RUNG };
