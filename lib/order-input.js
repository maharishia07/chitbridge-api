'use strict';
/**
 * order-input.js — WHAT A CATALOGUE RECEIVES, declared as a schema (SPEC-negotiation-position, revised).
 *
 * The business decides ONCE, at catalogue level, what data it accepts from the other side. That declaration is a
 * JSON Schema fragment — not an enum of widgets — so a new kind of input is a DATA change, not a release:
 *
 *     cart      { quantity }                          price comes from the catalogue
 *     qty       { quantity }                          price hidden; the shop quotes later
 *     range     { quantity, price: min..max }         the seller's band bounds the buyer
 *     choice    { quantity, price: enum[...] }        "range, but only these options" — no new code
 *     qtyprice  { quantity, price }                   unbounded; name your price
 *     enquiry   { message }                           no commerce at all
 *     form      { ...declared fields }                the catalogue IS a set of forms
 *
 * The preset is only a friendly LABEL over the schema, kept so the wizard reads in plain language.
 *
 * THE PIPELINE IS THE REAL SPLIT. The declaration decides which path a submission takes:
 *   commerce — resolve item → reprice against the catalogue → total → order chit   (cart/qty/range/choice/qtyprice)
 *   payload  — validate against the declared schema → carry the answers → chit     (enquiry/form)
 * A form has no price and no quantity, so on the commerce path it would (correctly) be rejected as unpriced. Same
 * rail, same chit, same governance and per-copy isolation — only the middle step differs.
 *
 * CATALOGUE decides the CONTRACT (what kind of data). Each ITEM carries its own VALUES inside it (its band, its
 * fields). An item may override the contract via RFC 7386 merge-patch — the same mechanism the catalogue already uses
 * for golden records — but that is opt-in: absent an item declaration, the catalogue's contract governs.
 *
 * ⚠️ VALIDATION SCOPE: `validate()` implements a deliberately small subset of JSON Schema 2020-12 (type · minimum ·
 * maximum · exclusiveMinimum · enum · maxLength · required · properties, additionalProperties closed). It is NOT a
 * conformant validator and must not be sold as one. The moment a declaration needs more than this subset, ADOPT ajv
 * rather than growing this file — that is a dependency decision for Athi, not a silent expansion here.
 */

const QTY = { type: 'number', exclusiveMinimum: 0, maximum: 100000 };

// Platform ceilings for carried documents. A catalogue may declare something SMALLER, never larger.
const DOC_MAX_COUNT = 5;
const DOC_MAX_BYTES = 6 * 1024 * 1024;          // per file — same limit the existing attachments route enforces
const DOC_MAX_TOTAL = 12 * 1024 * 1024;         // per submission
const DOC_MIME_ALLOW = ['application/pdf', 'image/jpeg', 'image/png'];

// The presets. `pipeline` is the load-bearing field; `schema` is what the submission is checked against.
const PRESETS = {
  cart:     { pipeline: 'commerce', showsPrice: true,  negotiable: false, schema: { type: 'object', properties: { quantity: QTY }, required: ['quantity'] } },
  qty:      { pipeline: 'commerce', showsPrice: false, negotiable: false, schema: { type: 'object', properties: { quantity: QTY }, required: ['quantity'] } },
  range:    { pipeline: 'commerce', showsPrice: true,  negotiable: true,  schema: { type: 'object', properties: { quantity: QTY, price: { type: 'number', exclusiveMinimum: 0 } }, required: ['quantity', 'price'] } },
  choice:   { pipeline: 'commerce', showsPrice: true,  negotiable: true,  schema: { type: 'object', properties: { quantity: QTY, price: { type: 'number', enum: [] } },        required: ['quantity', 'price'] } },
  qtyprice: { pipeline: 'commerce', showsPrice: false, negotiable: true,  schema: { type: 'object', properties: { quantity: QTY, price: { type: 'number', exclusiveMinimum: 0 } }, required: ['quantity', 'price'] } },
  enquiry:  { pipeline: 'payload',  showsPrice: false, negotiable: false, schema: { type: 'object', properties: { message: { type: 'string', maxLength: 4000 } }, required: ['message'] } },
  form:     { pipeline: 'payload',  showsPrice: false, negotiable: false, schema: { type: 'object', properties: {} } },
};
// 'text' was the old name for an information-only catalogue; keep it working.
const ALIASES = { text: 'enquiry', information: 'enquiry' };

// ── RFC 7386 JSON Merge Patch — same semantics as the web catalogue-model.js mergePatch() ──
function mergePatch(target, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = (target && typeof target === 'object' && !Array.isArray(target)) ? { ...target } : {};
  for (const k of Object.keys(patch)) {
    if (patch[k] === null) delete out[k];
    else out[k] = mergePatch(out[k], patch[k]);
  }
  return out;
}

/** Resolve a face's stored declaration into {preset, pipeline, schema, showsPrice, negotiable}. Unknown → cart. */
function resolve(stored) {
  const raw = stored && typeof stored === 'object' ? stored : {};
  const name = ALIASES[raw.preset] || raw.preset;
  const base = PRESETS[name] || PRESETS.cart;
  const preset = PRESETS[name] ? name : 'cart';
  // A declared schema OVERRIDES the preset's (merge-patch), so a form catalogue names its own fields while still
  // reading as a friendly preset in the UI.
  const schema = raw.schema ? mergePatch(base.schema, raw.schema) : base.schema;
  // DOCUMENTS the catalogue accepts alongside the answers (SPEC-document-carrying). Absent → none accepted, so no
  // existing storefront changes behaviour. Caps are clamped here: a declaration can only ever be MORE restrictive
  // than the platform ceiling, never less.
  const documents = raw.documents ? {
    max:      Math.max(1, Math.min(DOC_MAX_COUNT, Number(raw.documents.max) || 1)),
    accept:   (Array.isArray(raw.documents.accept) && raw.documents.accept.length
                 ? raw.documents.accept.filter((m) => DOC_MIME_ALLOW.includes(m)) : DOC_MIME_ALLOW.slice()),
    required: !!raw.documents.required,
    label:    raw.documents.label ? String(raw.documents.label).slice(0, 120) : 'Supporting document',
  } : null;
  return { preset, pipeline: raw.pipeline === 'payload' || raw.pipeline === 'commerce' ? raw.pipeline : base.pipeline,
           showsPrice: base.showsPrice, negotiable: base.negotiable, schema, documents };
}

/** An ITEM may override the catalogue's contract. Opt-in: no item declaration → the catalogue governs. */
function forItem(catalogueInput, itemDecl) {
  if (!itemDecl || typeof itemDecl !== 'object') return catalogueInput;
  return resolve(mergePatch({ preset: catalogueInput.preset, pipeline: catalogueInput.pipeline, schema: catalogueInput.schema }, itemDecl));
}

/** Bound a numeric property by the seller's declared values (a band, or an allowed set). Returns a NEW schema. */
function withBounds(schema, key, bounds) {
  if (!bounds || !schema || !schema.properties || !schema.properties[key]) return schema;
  const p = { ...schema.properties[key] };
  if (Array.isArray(bounds.options) && bounds.options.length) p.enum = bounds.options.map(Number).filter(Number.isFinite);
  if (bounds.min != null && Number.isFinite(Number(bounds.min))) p.minimum = Number(bounds.min);
  if (bounds.max != null && Number.isFinite(Number(bounds.max))) p.maximum = Number(bounds.max);
  return { ...schema, properties: { ...schema.properties, [key]: p } };
}

/**
 * Validate a submission against the declared schema. Returns { ok, value, errors[] }.
 * Closed by default: a property not declared is REJECTED, never silently carried.
 */
function validate(input, schema) {
  const errors = [];
  const props = (schema && schema.properties) || {};
  const required = (schema && schema.required) || [];
  const src = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
  const value = {};

  for (const k of Object.keys(src)) {
    if (!Object.prototype.hasOwnProperty.call(props, k)) errors.push(`"${k}" is not accepted by this catalogue`);
  }
  for (const k of required) {
    if (src[k] === undefined || src[k] === null || src[k] === '') errors.push(`"${k}" is required`);
  }
  for (const k of Object.keys(props)) {
    if (src[k] === undefined || src[k] === null || src[k] === '') continue;
    const p = props[k] || {};
    let v = src[k];
    if (p.type === 'number' || p.type === 'integer') {
      const n = Number(v);
      if (!Number.isFinite(n)) { errors.push(`"${k}" must be a number`); continue; }
      if (p.type === 'integer' && !Number.isInteger(n)) { errors.push(`"${k}" must be a whole number`); continue; }
      if (p.exclusiveMinimum != null && !(n > p.exclusiveMinimum)) errors.push(`"${k}" must be greater than ${p.exclusiveMinimum}`);
      if (p.minimum != null && n < p.minimum) errors.push(`"${k}" is below the allowed minimum (${p.minimum})`);
      if (p.maximum != null && n > p.maximum) errors.push(`"${k}" is above the allowed maximum (${p.maximum})`);
      if (Array.isArray(p.enum) && p.enum.length && !p.enum.includes(n)) errors.push(`"${k}" must be one of: ${p.enum.join(', ')}`);
      v = n;
    } else if (p.type === 'boolean') {
      v = (v === true || v === 'true' || v === 1 || v === '1');
    } else {
      v = String(v);
      if (p.maxLength != null && v.length > p.maxLength) errors.push(`"${k}" is longer than ${p.maxLength} characters`);
      if (Array.isArray(p.enum) && p.enum.length && !p.enum.includes(v)) errors.push(`"${k}" must be one of: ${p.enum.join(', ')}`);
    }
    value[k] = v;
  }
  return { ok: errors.length === 0, value, errors };
}

/**
 * Validate + hash the documents carried with a submission — "the filled form and its proof".
 * Returns { ok, docs:[{name, mime, size, sha256, buffer}], errors[] }. The sha256 is what gets SEALED onto the chit;
 * the buffer is stored per-copy afterwards. Rejects before any byte is written.
 */
function validateDocuments(raw, decl, crypto) {
  const errors = [];
  const list = Array.isArray(raw) ? raw : (raw == null ? [] : [raw]);
  if (!list.length) {
    if (decl && decl.required) errors.push(`${decl.label} is required`);
    return { ok: errors.length === 0, docs: [], errors };
  }
  if (!decl) return { ok: false, docs: [], errors: ['This catalogue does not accept documents'] };
  if (list.length > decl.max) return { ok: false, docs: [], errors: [`At most ${decl.max} document(s) may be attached`] };

  const docs = []; let total = 0;
  list.forEach((d, i) => {
    const label = (d && d.name) ? String(d.name).slice(0, 200) : `document ${i + 1}`;
    const mime = String((d && d.mime) || '').toLowerCase().split(';')[0].trim();
    if (decl.accept.indexOf(mime) < 0) { errors.push(`"${label}": ${mime || 'unknown type'} is not accepted (allowed: ${decl.accept.join(', ')})`); return; }
    let buffer;
    try { buffer = Buffer.from(String((d && d.data_base64) || '').replace(/^data:[^;]+;base64,/, ''), 'base64'); }
    catch (_) { errors.push(`"${label}": could not be read`); return; }
    if (!buffer.length) { errors.push(`"${label}": empty file`); return; }
    if (buffer.length > DOC_MAX_BYTES) { errors.push(`"${label}": larger than ${Math.round(DOC_MAX_BYTES / 1048576)} MB`); return; }
    total += buffer.length;
    docs.push({ name: label, mime, size: buffer.length, sha256: crypto.createHash('sha256').update(buffer).digest('hex'), buffer });
  });
  if (total > DOC_MAX_TOTAL) errors.push(`Documents total more than ${Math.round(DOC_MAX_TOTAL / 1048576)} MB`);
  return { ok: errors.length === 0, docs, errors };
}

module.exports = { PRESETS, ALIASES, resolve, forItem, withBounds, validate, validateDocuments, mergePatch,
                   DOC_MAX_COUNT, DOC_MAX_BYTES, DOC_MAX_TOTAL, DOC_MIME_ALLOW };
