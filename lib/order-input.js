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

// T1.9 · resolve() used to hand out PRESETS[name].schema BY REFERENCE — the same object for every tenant in the
// process. Nothing mutated it, so it was latent rather than live, but one stray `oi.schema.properties.x = …` would
// have poisoned every tenant for the process lifetime. Freeze the source of truth AND return clones.
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.values(o).forEach(deepFreeze); Object.freeze(o); }
  return o;
};
deepFreeze(PRESETS);

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

// ── T1.1 · KEYWORD WHITELIST — the declaration must not LIE about what it enforces ────────────────────────────────
// Review finding, and the worst of the batch: `resolve()` merge-patched a declared schema verbatim, so a catalogue
// owner writing {"type":"string","pattern":"^[0-9]{15}$"} for a GSTIN got a rule that LOOKED enforced and was not.
// That is worse than having no validator, because the owner stops checking. Only keywords `validate()` actually
// implements are allowed; anything else is REJECTED at declare time rather than silently ignored at run time.
const FIELD_KEYWORDS = ['type', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'enum', 'maxLength', 'description'];
const FIELD_TYPES    = ['string', 'number', 'integer', 'boolean'];
const SCHEMA_KEYWORDS = ['type', 'properties', 'required'];

/**
 * Reject a declaration that uses anything we do not enforce. Returns [] when clean, else a list of reasons.
 * This is the honest alternative to growing the validator: when a real declaration needs `pattern` or `format` or
 * nested objects, ADOPT ajv — do not quietly widen this list.
 */
function declarationErrors(schema) {
  const errs = [];
  if (schema == null) return errs;
  if (typeof schema !== 'object' || Array.isArray(schema)) return ['schema must be an object'];
  for (const k of Object.keys(schema)) {
    if (!SCHEMA_KEYWORDS.includes(k)) errs.push(`schema keyword "${k}" is not supported (supported: ${SCHEMA_KEYWORDS.join(', ')})`);
  }
  if (schema.required != null && !Array.isArray(schema.required)) errs.push('"required" must be an array');
  const props = schema.properties;
  if (props != null) {
    if (typeof props !== 'object' || Array.isArray(props)) return errs.concat('"properties" must be an object');
    for (const [name, p] of Object.entries(props)) {
      if (p === null) continue;                                   // a merge-patch tombstone is legitimate
      if (typeof p !== 'object' || Array.isArray(p)) { errs.push(`field "${name}" must be an object`); continue; }
      for (const k of Object.keys(p)) {
        if (!FIELD_KEYWORDS.includes(k)) errs.push(`field "${name}": keyword "${k}" is declared but NOT enforced — remove it or use one of: ${FIELD_KEYWORDS.join(', ')}`);
      }
      if (p.type != null && !FIELD_TYPES.includes(p.type)) errs.push(`field "${name}": type "${p.type}" is not supported (supported: ${FIELD_TYPES.join(', ')})`);
      if (p.type == null) errs.push(`field "${name}": a "type" is required — an untyped field cannot be validated`);
      if (p.enum != null && (!Array.isArray(p.enum) || p.enum.length === 0)) errs.push(`field "${name}": "enum" must be a non-empty array`);
    }
  }
  for (const r of (Array.isArray(schema.required) ? schema.required : [])) {
    if (!props || !Object.prototype.hasOwnProperty.call(props, r)) errs.push(`"${r}" is required but not declared in properties`);
  }
  return errs;
}

/**
 * Resolve a face's stored declaration into {preset, pipeline, schema, showsPrice, negotiable, documents, errors}.
 * Unknown preset → cart. A declaration whose schema uses unsupported keywords is REPORTED in `errors` and the
 * preset's own schema governs — fail CLOSED to something known rather than honour a rule we cannot keep.
 */
function resolve(stored) {
  const raw = stored && typeof stored === 'object' ? stored : {};
  const name = ALIASES[raw.preset] || raw.preset;
  const base = PRESETS[name] || PRESETS.cart;
  const preset = PRESETS[name] ? name : 'cart';
  // A declared schema OVERRIDES the preset's (merge-patch), so a form catalogue names its own fields while still
  // reading as a friendly preset in the UI.
  const errors = declarationErrors(raw.schema);
  let schema = (raw.schema && errors.length === 0) ? mergePatch(base.schema, raw.schema) : clone(base.schema);
  // Deleting a property with a merge-patch tombstone must also drop it from `required` — otherwise the merged schema
  // demands a field it no longer declares, which is exactly what declarationErrors() rejects. Found by the T3.1 test.
  if (schema && Array.isArray(schema.required)) {
    const props = schema.properties || {};
    const kept = schema.required.filter((k) => Object.prototype.hasOwnProperty.call(props, k));
    if (kept.length !== schema.required.length) schema = { ...schema, required: kept };
  }
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
           showsPrice: base.showsPrice, negotiable: base.negotiable, schema, documents, errors,
           _raw: { preset: raw.preset, pipeline: raw.pipeline, schema: raw.schema, documents: raw.documents } };
}

/**
 * An ITEM may override the catalogue's contract. Opt-in: no item declaration → the catalogue governs.
 *
 * T1.2 · carries `documents` through. It used to rebuild only {preset, pipeline, schema}, so ANY item declaration —
 *        even one naming only fields — nulled the catalogue's document rule, turning a REQUIRED proof into an optional
 *        one while the client still rendered a mandatory upload the server then refused.
 * T3.1 · merges over the RAW declaration, not the already-merged result. Merge-patch is not idempotent over a merged
 *        document: re-merging resurrected fields the catalogue had deleted with a `null` tombstone, along with their
 *        `required` entries.
 */
function forItem(catalogueInput, itemDecl) {
  if (!itemDecl || typeof itemDecl !== 'object') return catalogueInput;
  const rawBase = (catalogueInput && catalogueInput._raw) || {};
  return resolve(mergePatch({ preset: rawBase.preset, pipeline: rawBase.pipeline,
                              schema: rawBase.schema, documents: rawBase.documents }, itemDecl));
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
  // T1.5 · read OWN properties only. Without this, a field named `constructor` (or `toString`…) was satisfied
  // WITHOUT being sent, and the function source got sealed onto the chit.
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const missing = (k) => !own(src, k) || src[k] === undefined || src[k] === null || src[k] === '';

  for (const k of Object.keys(src)) {
    if (!own(props, k)) errors.push(`"${k}" is not accepted by this catalogue`);
  }
  for (const k of required) {
    if (missing(k)) errors.push(`"${k}" is required`);
  }
  for (const k of Object.keys(props)) {
    if (missing(k)) continue;
    const p = props[k] || {};
    let v = src[k];
    // T1.4 · a value that is not a primitive is REJECTED, never stringified. `{type:'string'}` given an object used
    // to become the literal "[object Object]" and get sealed as if it were the customer's answer.
    if (v !== null && typeof v === 'object') { errors.push(`"${k}" must be a single value, not a list or object`); continue; }
    if (p.type === 'number' || p.type === 'integer') {
      // Number('') is 0 and Number(true) is 1 — accept only genuine numeric input.
      const n = (typeof v === 'number') ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
      if (!Number.isFinite(n)) { errors.push(`"${k}" must be a number`); continue; }
      if (p.type === 'integer' && !Number.isInteger(n)) { errors.push(`"${k}" must be a whole number`); continue; }
      if (p.exclusiveMinimum != null && !(n > p.exclusiveMinimum)) errors.push(`"${k}" must be greater than ${p.exclusiveMinimum}`);
      if (p.exclusiveMaximum != null && !(n < p.exclusiveMaximum)) errors.push(`"${k}" must be less than ${p.exclusiveMaximum}`);
      if (p.minimum != null && n < p.minimum) errors.push(`"${k}" is below the allowed minimum (${p.minimum})`);
      if (p.maximum != null && n > p.maximum) errors.push(`"${k}" is above the allowed maximum (${p.maximum})`);
      // T1.8 · an EMPTY enum is a constraint that nothing satisfies, not "no constraint". `choice` ships enum:[] and
      // used to degrade to unbounded — the opposite of fail-closed.
      if (Array.isArray(p.enum) && !p.enum.includes(n)) {
        errors.push(p.enum.length ? `"${k}" must be one of: ${p.enum.join(', ')}` : `"${k}" has no allowed values declared — the catalogue must declare its options`);
      }
      v = n;
    } else if (p.type === 'boolean') {
      // T1.7 · an unrecognised value is REJECTED. It used to fall through to false, so {agreed:'yes'} recorded a
      // consent the customer never gave.
      if (v === true || v === 'true' || v === 1 || v === '1') v = true;
      else if (v === false || v === 'false' || v === 0 || v === '0') v = false;
      else { errors.push(`"${k}" must be true or false`); continue; }
    } else {
      if (typeof v !== 'string' && typeof v !== 'number') { errors.push(`"${k}" must be text`); continue; }
      v = String(v);
      if (p.maxLength != null && v.length > p.maxLength) errors.push(`"${k}" is longer than ${p.maxLength} characters`);
      if (Array.isArray(p.enum) && !p.enum.includes(v)) {
        errors.push(p.enum.length ? `"${k}" must be one of: ${p.enum.join(', ')}` : `"${k}" has no allowed values declared — the catalogue must declare its options`);
      }
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
function validateDocuments(raw, decl, crypto, budget) {
  const errors = [];
  const list = Array.isArray(raw) ? raw : (raw == null ? [] : [raw]);
  if (!list.length) {
    if (decl && decl.required) errors.push(`${decl.label} is required`);
    return { ok: errors.length === 0, docs: [], errors };
  }
  if (!decl) return { ok: false, docs: [], errors: ['This catalogue does not accept documents'] };
  if (list.length > decl.max) return { ok: false, docs: [], errors: [`At most ${decl.max} document(s) may be attached`] };
  // T1.6 · the caps are PER SUBMISSION, which is what DOC_MAX_TOTAL's own comment always claimed. Called once per
  // form, a bundle of 5 forms could carry 25 files / 150 MB against a stated ceiling of 5 / 12 MB. The caller passes
  // a shared `budget` so the totals accumulate across the whole submission.
  const b = budget || { count: 0, bytes: 0 };

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
  b.count += docs.length; b.bytes += total;
  if (b.count > DOC_MAX_COUNT) errors.push(`At most ${DOC_MAX_COUNT} documents per submission`);
  if (b.bytes > DOC_MAX_TOTAL) errors.push(`Documents total more than ${Math.round(DOC_MAX_TOTAL / 1048576)} MB per submission`);
  return { ok: errors.length === 0, docs, errors };
}

module.exports = { PRESETS, ALIASES, resolve, forItem, withBounds, validate, validateDocuments, mergePatch,
                   DOC_MAX_COUNT, DOC_MAX_BYTES, DOC_MAX_TOTAL, DOC_MIME_ALLOW };
