// @stage tested
// CALLED BY routes/catalogue-face.js, routes/products.js   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
// @stage-note What makes two rows the same product, and what makes one product several purchasable lines. Pure —
// no db handle, no request. The declaration lives in catalogue_face.face.identity; this file only reads it.
// CARD      06-catalogue-pim/catalogue-face
'use strict';
/**
 * identity.js — which line is this, and which product does it belong to?
 *
 * Athi, 2026-08-06: *"let us do variants and identity together."*
 *
 * Right, because they are one question asked twice. A variant's identity IS parent + option values, so a system
 * that cannot say what identifies a line also cannot say which lines belong together. Building them separately
 * means building identity twice and getting a different answer each time.
 *
 * ── THE GAP THIS CLOSES, MEASURED ──────────────────────────────────────────────────────────────────────────────
 * The Medusa mapping test took ONE paint with three pack sizes and produced THREE UNRELATED ROWS. Nothing tied them
 * together: "change the price of Tussar" was three edits, and a storefront showed three products where the merchant
 * saw one. Medusa and Saleor both model parent + children with typed options. We flattened.
 *
 * ── THE MODEL: A VARIANT IS A LINE THAT NAMES ITS PRODUCT ──────────────────────────────────────────────────────
 * There is no parent row and no new table.
 *
 *   sku        RP-1L        RP-4L        RP-10L      ← the LINE identity: what you order, what has a price
 *   product    tussar       tussar       tussar      ← the GROUP: what a person calls it
 *   size       1L           4L           10L         ← the OPTION that distinguishes lines within the group
 *
 * Chosen over a parent record for three reasons, and one cost:
 *   1. The order path already takes a LINE. `order_input` and every one of the 7 presets work on a purchasable
 *      line, so grouping changes what a person SEES and nothing about what is agreed. No preset is touched.
 *   2. A spreadsheet is inherently one row per line with the parent named in a column, so it round-trips by
 *      construction — the constraint that would otherwise flatten the catalogue back on the next upload.
 *   3. It needs no DDL. The declaration lives in `catalogue_face.face.identity`, which is already jsonb.
 *
 *   ⚠️ THE COST, stated rather than discovered: attributes shared by a whole product — description, images — REPEAT
 *      on every line. That is denormalised, and if two lines disagree about the description, nothing here decides
 *      which is right. It is how a merchant's spreadsheet already looks, and a parent record can be added later
 *      without moving the line identity, which is the part that would be expensive to change.
 *
 * ── THE DECLARATION ────────────────────────────────────────────────────────────────────────────────────────────
 *   face.identity = {
 *     key:     ['sku'],           // what makes a LINE unique. Default ['sku'].
 *     group:   'product',         // which field names the product a line belongs to. Optional — no group, no
 *                                 // variants, and the catalogue behaves exactly as it does today.
 *     options: ['size', 'colour'] // which declared fields DISTINGUISH lines inside a group.
 *   }
 *
 * `key` is a LIST because a trade may need more than one field: pharma identifies a lot by `batch_no`, and a
 * commodity desk may need `hs_code + origin_country`. Hardcoding `sku` was an assumption, not a rule.
 *
 * ⚠️ An option is NOT a new subsystem. It is a field the schema already declares, marked as distinguishing. We are
 * not building an option/attribute engine with its own types and validation — the schema does that job already.
 *
 * ── ZERO DEPENDENCIES · TIER A ─────────────────────────────────────────────────────────────────────────────────
 */

const DEFAULT_KEY = ['sku'];

/** Fields that can never be an identity or an option: they are not properties of a product. */
const NOT_IDENTIFYING = [
  'quantity',
  'order_input',
  'is_active',
  'item_id',
  'entity_id',
  'schema_id',
  'price',
  'price_min',
  'price_max',
  'price_currency',
  'available_qty',
  'availability'
];

const str = (v) => (v === null || v === undefined ? '' : String(v).trim());

/**
 * resolve(face) → the identity declaration, normalised and safe.
 *
 * A face that declares nothing gets `key: ['sku']`, no group and no options — which is exactly today's behaviour,
 * so nothing changes for a catalogue that has not opted in.
 */
function resolve(face) {
  const raw = (face && face.identity) || {};
  const clean = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(str).filter((item) => item && !NOT_IDENTIFYING.includes(item));

  const key = clean(raw.key);
  const nestedGroup = NOT_IDENTIFYING.includes(str(raw.group)) ? '' : str(raw.group);
  // An option that is also part of the line key would be doing two jobs; the key wins and the option is dropped,
  // because a field cannot both distinguish lines and identify one.
  const options = clean(raw.options).filter((item) => !key.includes(item) && item !== nestedGroup);

  return {
    key: key.length ? key : DEFAULT_KEY.slice(),
    group: nestedGroup || null,
    options,
    declared: !!(raw.key || raw.group || raw.options),
    variants: !!nestedGroup
  };
}

/**
 * identityOf(item, id) → the string that answers "which line is this?", or null.
 *
 * Null when the item does not carry every part of the key — a PARTIAL identity is not an identity, and treating
 * one as if it were would match the wrong product. The caller must treat null as "cannot be matched", never as a
 * value to compare.
 */
function identityOf(item, id) {
  const parts = [];
  for (const k of id.key) {
    const v = str(item && item[k]);
    if (!v) return null;
    parts.push(v);
  }
  return parts.join('\u001f'); // a separator no product code contains, so "A|B" and "A" + "|B" cannot collide
}

/** Which product this line belongs to. Falls back to its own identity, so an ungrouped line is a group of one. */
function groupOf(item, id) {
  if (id.group) {
    const g = str(item && item[id.group]);
    if (g) return g;
  }
  return identityOf(item, id);
}

/** "1L · Matt" — what distinguishes this line from its siblings, for a person. */
function variantLabel(item, id) {
  const bits = id.options.map((o) => str(item && item[o])).filter(Boolean);
  return bits.join(' · ');
}

/**
 * group(items, id) → [{ group, label, lines: [{ item, identity, variant }], options }]
 *
 * Order is preserved: groups appear in the order their first line does, and lines within a group keep their order.
 * A merchant who arranged their sheet did so for a reason, and re-sorting it here would be the column-order bug
 * again in a different costume.
 */
function group(items, id) {
  const out = [];
  const byKey = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item) continue;
    const g = groupOf(item, id) || '\u0000ungrouped';
    let bucket = byKey.get(g);
    if (!bucket) {
      bucket = { group: g === '\u0000ungrouped' ? null : g, label: '', lines: [], options: {} };
      byKey.set(g, bucket);
      out.push(bucket);
    }
    bucket.lines.push({ item, identity: identityOf(item, id), variant: variantLabel(item, id) });
    for (const o of id.options) {
      const v = str(item[o]);
      if (!v) continue;
      (bucket.options[o] = bucket.options[o] || []).push(v);
    }
  }
  for (const b of out) {
    // The group's label is the first line's name — the product a person recognises, not the code.
    b.label = str(b.lines[0] && b.lines[0].item && (b.lines[0].item.name || b.lines[0].item.product)) || b.group || '';
    for (const o of Object.keys(b.options)) b.options[o] = [...new Set(b.options[o])];
  }
  return out;
}

/**
 * duplicates(items, id) → [{ identity, indexes }]
 *
 * Two lines with the SAME identity are a mistake, not a variant — variants differ by their key. This is what makes
 * "upload the same sheet twice" detectable, and it is now keyed off the DECLARATION rather than off `sku`.
 */
function duplicates(items, id) {
  const seen = new Map();
  for (let index = 0; index < (items || []).length; index++) {
    const k = identityOf(items[index], id);
    if (!k) continue; // no identity is a separate problem, reported elsewhere
    (seen.get(k) || seen.set(k, []).get(k)).push(index);
  }
  return [...seen.entries()].filter(([, ix]) => ix.length > 1).map(([identity, indexes]) => ({ identity, indexes }));
}

/**
 * check(id, accepted) → [] or a list of problems with the DECLARATION itself.
 *
 * A declaration naming a field the catalogue does not have is worse than no declaration: every line would fail to
 * identify, so every upload would look like a catalogue full of new products.
 */
function check(id, accepted) {
  const have = new Set(accepted || []);
  const problems = [];
  if (!have.size) return problems; // nothing to check against
  for (const k of id.key) if (!have.has(k)) problems.push(`the identity field "${k}" is not a column in this catalogue`);
  if (id.group && !have.has(id.group)) problems.push(`the product field "${id.group}" is not a column in this catalogue`);
  for (const o of id.options) if (!have.has(o)) problems.push(`the variant field "${o}" is not a column in this catalogue`);
  return problems;
}

module.exports = { resolve, identityOf, groupOf, variantLabel, group, duplicates, check, DEFAULT_KEY, NOT_IDENTIFYING };
