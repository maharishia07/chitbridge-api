// @stage tested
// @stage-note WHAT A BILL I RECEIVED IS FOR — resale · use · asset — decided by the buyer before acceptance, per bill or per line.
'use strict';
/**
 * ── lib/bill-use.js · WHAT THE MATERIALS ARE FOR (Athi, 2026-10-01) ──────────────────────────────────────────────────
 *
 * A bill another business sold me is not always stock. Brake pads a workshop resells are; the oil it burns servicing its
 * own van is not; a compressor is an asset. Which one decides the posting (Purchases · an expense · an asset) and whether
 * goods-in puts it on the shelf — so it is the BUYER's fact, chosen on THEIR copy before they accept it:
 *
 *   business_json.use = { bill: 'resale'|'use'|'asset'|null, lines: { <line_id>: 'resale'|'use'|'asset' }, by, at }
 *
 * ⭐ NOTHING CHOSEN → THE CATALOGUE DECIDES, per line: a product my own catalogue sells (the one matcher, lib/itemmatch —
 *   name or a declared synonym) is `resale`; anything else is `use`. A line's own choice beats the bill's; the bill's beats
 *   the catalogue.
 * ⚠️ CHANGEABLE UNTIL ACCEPTED, NEVER AFTER: once the purchase has posted, a different answer would be a different entry —
 *   that is a correction (a reversal), not an edit of a choice.
 * ⚠️ A catalogue that cannot be READ is not an empty one — strict, so the hook parks the bill with the reason instead of
 *   quietly posting every line as an expense.
 */
const USES = ['resale', 'use', 'asset'];
const OPEN = /^(pending|delivered|read)$/;
const isUse = (v) => USES.indexOf(String(v)) >= 0;

/** the stored choice on a copy, cleaned — never more than the three words */
function chosenOf(bj) {
  const u = (bj && bj.use && typeof bj.use === 'object') ? bj.use : {};
  const lines = {};
  if (u.lines && typeof u.lines === 'object') for (const k of Object.keys(u.lines)) if (isUse(u.lines[k])) lines[k] = u.lines[k];
  const o = { bill: isUse(u.bill) ? u.bill : null, lines };
  /* an asset bill also says WHAT KIND of asset and the day it was put to use (the register's two facts); absent for every other bill */
  if (typeof u.asset_class === 'string' && /^[a-z_]{2,30}$/.test(u.asset_class)) o.asset_class = u.asset_class;
  if (typeof u.put_to_use === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(u.put_to_use)) o.put_to_use = u.put_to_use;
  return o;
}

/** is this line a product my catalogue sells? (the one matcher; an ambiguous name is still "in the catalogue") */
function inCatalogue(line, cat) {
  const name = String((line && (line.particulars || line.name)) || '').trim();
  if (!name || !cat || !Array.isArray(cat.items) || !cat.items.length) return false;
  const m = require('./itemmatch').match(name, '', cat);
  return !!(m && !m.unmatched);
}

/**
 * effective(copy, cat) → { bill, lines: [{ index, line_id, name, use, source: 'line'|'bill'|'catalogue' }], uses: [...] }
 * `lines` is in the copy's order with removed lines left out — the same order lib/tax-lines invoiceFor puts the
 * invoice's ItemList in, so lines[i] is ItemList[i].
 */
function effective(copy, cat) {
  const c = copy || {};
  const ch = chosenOf(c.business_json);
  const lines = (Array.isArray(c.line_items) ? c.line_items : []).filter((l) => l && !l.removed).map((l, index) => {
    const id = l.line_id ? String(l.line_id) : null;
    let use, source;
    if (id && ch.lines[id]) { use = ch.lines[id]; source = 'line'; }
    else if (ch.bill) { use = ch.bill; source = 'bill'; }
    else { use = inCatalogue(l, cat) ? 'resale' : 'use'; source = 'catalogue'; }
    return { index, line_id: id, name: String(l.particulars || l.name || ''), use, source };
  });
  const out = { bill: ch.bill, lines, uses: [...new Set(lines.map((x) => x.use))] };
  if (ch.asset_class) out.asset_class = ch.asset_class;
  if (ch.put_to_use) out.put_to_use = ch.put_to_use;
  return out;
}

/** does deciding this copy need the catalogue at all? (every line already chosen → no read) */
function needsCatalogue(copy) {
  const ch = chosenOf((copy || {}).business_json);
  if (ch.bill) return false;
  return (Array.isArray(copy && copy.line_items) ? copy.line_items : []).some((l) => l && !l.removed && !(l.line_id && ch.lines[String(l.line_id)]));
}

/** my catalogue, read strictly (see the note above); tests replace it */
async function catalogueOf(entity) { return require('./itemmatch').loadCatalogue(entity, { strict: true }); }

/** forCopy(entity, copy) → effective(...) with the catalogue read only when something is undecided */
async function forCopy(entity, copy) {
  const cat = needsCatalogue(copy) ? await module.exports.catalogueOf(entity) : null;
  return effective(copy, cat);
}

/**
 * validate(body, copy) → { ok, use } | { ok: false, status, message } — { use?: 'resale'|'use'|'asset', lines?: { id: use } }
 * Only lines the copy has; only the three words; at least one thing said.
 */
function validate(body, copy) {
  const b = body || {};
  const out = {};
  if (b.use !== undefined && b.use !== null) {
    if (!isUse(b.use)) return { ok: false, status: 400, message: 'use must be resale, use or asset' };
    out.bill = b.use;
  }
  if (b.lines !== undefined && b.lines !== null) {
    if (typeof b.lines !== 'object' || Array.isArray(b.lines)) return { ok: false, status: 400, message: 'lines must be { line_id: use }' };
    const known = new Set((Array.isArray(copy && copy.line_items) ? copy.line_items : []).map((l) => l && l.line_id && String(l.line_id)).filter(Boolean));
    out.lines = {};
    for (const k of Object.keys(b.lines)) {
      if (!known.has(String(k))) return { ok: false, status: 400, message: 'No line ' + k + ' on this bill' };
      if (!isUse(b.lines[k])) return { ok: false, status: 400, message: 'use must be resale, use or asset' };
      out.lines[String(k)] = b.lines[k];
    }
  }
  if (b.asset_class !== undefined && b.asset_class !== null) {
    if (!/^[a-z_]{2,30}$/.test(String(b.asset_class))) return { ok: false, status: 400, message: 'asset_class is one of the asset kinds (buildings, plant, furniture, vehicles, office, computers)' };
    out.asset_class = String(b.asset_class);
  }
  if (b.put_to_use !== undefined && b.put_to_use !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.put_to_use))) return { ok: false, status: 400, message: 'put_to_use is the day it was put to use, YYYY-MM-DD' };
    out.put_to_use = String(b.put_to_use);
  }
  if (out.bill === undefined && !out.lines && !out.asset_class && !out.put_to_use) return { ok: false, status: 400, message: 'Say what it is for: use, or lines' };
  return { ok: true, use: out };
}

/**
 * set(entity, chit_id, body, by, deps) — the ONE writer of business_json.use, on MY received copy of a bill I bought, and
 * only while it is still to accept. Merge, never replace: a bill-level answer keeps the lines already chosen, and a line
 * answer keeps the rest (feedback-partial-writes-merge-patch).
 * → { ok, use, effective } | { ok: false, status, message }
 */
async function set(entity, chit_id, body, by, deps) {
  const d = deps || {};
  const TC = d.taxCopy || require('./tax-copy');
  const withEntity = d.withEntity || require('../db').withEntity;
  const copy = await TC.copyOf(chit_id, entity);
  if (!copy) return { ok: false, status: 404, message: 'Chit not found' };
  if (!TC.billReceived(copy, entity)) return { ok: false, status: 409, message: 'Only a bill you received says what its goods are for' };
  if (!OPEN.test(String(copy.current_status || ''))) {
    return { ok: false, status: 409, message: 'This bill is already ' + copy.current_status + ' — what it was for is settled' };
  }
  const v = validate(body, copy);
  if (!v.ok) return v;
  const was = chosenOf(copy.business_json);
  const use = { bill: v.use.bill !== undefined ? v.use.bill : was.bill, lines: Object.assign({}, was.lines, v.use.lines || {}),
                ...((v.use.asset_class || was.asset_class) ? { asset_class: v.use.asset_class || was.asset_class } : {}),
                ...((v.use.put_to_use || was.put_to_use) ? { put_to_use: v.use.put_to_use || was.put_to_use } : {}),
                by: (by && by.name) || null, at: new Date().toISOString() };
  await withEntity(entity, (db) => db.query(
    `UPDATE chit_header SET business_json = COALESCE(business_json, '{}'::jsonb) || jsonb_build_object('use', $1::jsonb)
      WHERE chit_id = $2 AND entity_id = $3`, [JSON.stringify(use), chit_id, entity]));
  const next = Object.assign({}, copy, { business_json: Object.assign({}, copy.business_json, { use }) });
  return { ok: true, use, effective: await forCopy(entity, next) };
}

module.exports = { USES, chosenOf, inCatalogue, effective, needsCatalogue, catalogueOf, forCopy, validate, set };
