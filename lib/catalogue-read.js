// @stage tested
// @stage-note The ONE catalogue read: every line, whatever channel filled it, in one shape with its provenance.
// Pure — dependencies injected, like catalogue-view.js. No caller yet; catalogue-view is the intended first one.
'use strict';
/**
 * catalogue-read.js — one catalogue, many channels.
 *
 * Athi, 2026-08-06: *"the template and the excel upload are very different means of achieving the same objective of
 * filling the catalogue… all the paths come to the same source. Here it is the catalogue. It cannot be two
 * different items."*
 *
 * He is right, and the code disagreed with him: `buildPublicView` returned `items` AND `finishes` as two lists, and
 * every capability built this week — template, preflight, import, variants, export — read `catalogue_items` only.
 * The sharpest consequence was that an adopted catalogue never appeared in its own owner's CSV export.
 *
 * ── ONE READ, NOT ONE TABLE ────────────────────────────────────────────────────────────────────────────────────
 * The obvious reading of "it cannot be two different items" is: merge catalogue_source into catalogue_items. That
 * would destroy the thing the blueprint is FOR. A source is minted once and read by every distributor; copy it and
 * every retailer owns a private duplicate, the brand can no longer change one thing everywhere, and images are
 * duplicated per retailer — which is precisely what Athi's editability rule forbids.
 *
 * CB's own principle already says so: replicate what is owned and mutable, share-read what is immutable and
 * referenced. Two stores is the right STORAGE answer. One READ is what was missing.
 *
 * ── EDITABILITY FOLLOWS OWNERSHIP, PER FIELD ───────────────────────────────────────────────────────────────────
 * Athi: *"they can edit if it is the source itself. If it is a reference, it cannot be — you are showcasing the
 * product and its images from the source. If the image itself is given here, then they can edit."*
 *
 * ⚠️ It is PER FIELD, not per line. One adopted product carries a brand's name and unit (referenced, locked) beside
 * MY price and MY availability (mine, editable) — on the same row. A line-level flag cannot say that, so every line
 * carries `provenance: { field → 'own' | 'source' }`.
 *
 * ⚠️ And "can I change this" has TWO answers. The first version collapsed them into one `editable` boolean, and the
 * live read immediately produced a contradiction: Beta owns its source, so its adopted rows came back
 * `editable: true` AND `locked fields: name`. Both halves were half-true.
 *
 *     edit_scope    'all'      it is mine — every field, right here
 *                   'overlay'  a referenced line — my commercials, and nothing else, HERE
 *     i_own_source  I may change the source itself, elsewhere, FOR EVERY DISTRIBUTOR who adopted it
 *
 * A source field stays locked on this row even for the brand that owns it, because changing it changes it for
 * everyone. That is a deliberate act at the source, not an inline edit on one adopter's row.
 *
 * ── WHAT IT REFUSES TO DO ──────────────────────────────────────────────────────────────────────────────────────
 * It does not FLATTEN a rich source item into a product row. Whatever a source carries beyond the common core —
 * colour combinations, textures, media, application notes — passes through untouched under `detail`. Flattening
 * would be the same mistake as copying: it would quietly discard the reason the blueprint exists.
 *
 * ── ZERO DEPENDENCIES · TIER A ─────────────────────────────────────────────────────────────────────────────────
 * Dependencies are injected. This stays testable without a database.
 */

/** The fields every line has, whatever filled it. Everything else travels in `detail`, unread and unaltered. */
const CORE = ['sku', 'name', 'unit', 'price', 'price_min', 'price_max', 'availability', 'available_qty',
  'lead_time_days', 'min_order_qty', 'desc', 'code'];

/**
 * ownedLine — a row this entity typed, uploaded or captured. Everything on it is theirs.
 */
function ownedLine(row) {
  const d = (row && row.item_data) || {};
  const fields = {}, provenance = {};
  for (const [k, v] of Object.entries(d)) { fields[k] = v; provenance[k] = 'own'; }
  return {
    line_id: 'item:' + row.item_id,
    item_id: row.item_id,
    origin: 'own',
    source_key: null,
    owner_entity_id: null,
    edit_scope: 'all',      // it is mine: every field is changeable right here
    i_own_source: false,    // there is no source behind it
    fields,
    provenance,
    detail: null,
    created_at: row.created_at || null,
  };
}

/**
 * referencedLine — a line from an adopted source.
 *
 * The source's own values are REFERENCED and locked; the adopter's `commercials` overlay is theirs. Where both
 * carry the same key (a source suggests `unit`, the adopter confirms it) the OVERLAY wins and the field becomes
 * the adopter's — they stated it, so they own that statement.
 */
function referencedLine(src, item, me, container) {
  /**
   * ── THE CONTAINER IS THE TRUTH, NOT THE SNAPSHOT ─────────────────────────────────────────────────────────────
   * Athi, 2026-08-06: *"if they ever want to change the image, they release the new image as the next version. We
   * always refer the container which holds the image — if the version changes, that will be directly reflecting.
   * But in the chit we hold the image reference rather than the container. So the catalogue refers the container
   * and the chit refers the image, and it meets the identity."*
   *
   * `container.js` already says the same thing in its own header — resolve(container) is the current version and
   * auto-reflects the latest enhancement; resolve(container, N) is what a chit pinned. It was simply never read
   * here: the catalogue served `catalogue_source.items`, a stored snapshot, so publishing v2 moved the pointer and
   * changed nothing anyone could see.
   *
   * When the caller resolves a container for this item, its CURRENT content wins over the snapshot. No container
   * (b80 not applied, or an item never synced) falls back to the snapshot exactly as before.
   */
  const base = (container && container.content && typeof container.content === 'object') ? container.content : item;

  const fields = {}, provenance = {};
  for (const [k, v] of Object.entries(base || {})) {
    if (k === 'commercials') continue;                  // the overlay is applied below, not carried as a field
    fields[k] = v; provenance[k] = 'source';
  }
  const com = (item && item.commercials) || {};
  for (const [k, v] of Object.entries(com)) {
    if (v === null || v === undefined || v === '') continue;
    fields[k] = v; provenance[k] = 'own';               // I said this, so it is mine — and editable
  }
  // Anything the source carries beyond the common core stays whole, unread. See the header.
  const detail = {};
  for (const [k, v] of Object.entries(base || {})) {
    if (k !== 'commercials' && !CORE.includes(k)) detail[k] = v;
  }
  const owner = src.owner_entity_id || null;
  const mine = !!(owner && me && String(owner) === String(me));
  return {
    line_id: 'src:' + src.source_key + ':' + (item.sku || item.name || ''),
    item_id: null,
    origin: 'source',
    source_key: src.source_key,
    source_title: src.title || null,
    owner_entity_id: owner,
    /**
     * ⚠️ A referenced line is ALWAYS overlay-only HERE — even for the brand that owns the source.
     *
     * The live read exposed this: Beta owns `beta-fresh@v2`, so the first version marked its adopted rows
     * `editable: true` while still reporting `locked fields: name`. Both halves were half-true and the row read as
     * a contradiction.
     *
     * The sharp answer is that "can I change this" has TWO answers, and collapsing them lost the important one:
     * changing a SOURCE field changes it for EVERY distributor who adopted it. That is a deliberate act performed
     * at the source, never an inline edit on one adopter's row — and it is exactly as true when the adopter and
     * the owner are the same business. So:
     *
     *   edit_scope 'overlay'  what I may change HERE: my commercials, and nothing else
     *   i_own_source          may I go and change the source itself, elsewhere, for everyone
     */
    edit_scope: 'overlay',
    i_own_source: mine,
    // What the chit will pin. The catalogue tracks the pointer; the chit freezes the number.
    container: container ? { ref: container.container_id, version: container.version,
      current_version: container.current_version, is_current: container.is_current !== false } : null,
    fields,
    provenance,
    detail: Object.keys(detail).length ? detail : null,
    created_at: null,
  };
}

/**
 * lines({ owned, sources, me, identity, ident }) → the one list.
 *
 * `owned`   rows from catalogue_items         (already read by the caller)
 * `sources` resolved adoptions [{ source_key, title, owner_entity_id, items:[…] }]
 * `me`      the reading entity, to decide editability
 *
 * Order: owned lines first in the order given, then each source in the order adopted. Deliberate — the merchant's
 * own products are the ones they maintain, and an arbitrary interleave would put a rule where a decision belongs.
 */
function lines(opts = {}) {
  const out = [];
  for (const row of (opts.owned || [])) { if (row) out.push(ownedLine(row)); }
  for (const src of (opts.sources || [])) {
    if (!src) continue;
    const byId = opts.containers || {};
    for (const item of (src.items || [])) {
      if (!item) continue;
      // The caller resolves containers in one batch and hands them in — this file stays pure and database-free.
      const cid = opts.containerIdFor ? opts.containerIdFor(src.source_key, item.name) : null;
      out.push(referencedLine(src, item, opts.me, cid ? byId[cid] : null));
    }
  }
  // Identity and variants apply to EVERY line, not only the owned ones — which is the whole point of one read.
  if (opts.identity && opts.ident) {
    for (const l of out) {
      l.identity = opts.identity.identityOf(l.fields, opts.ident);
      l.variant = opts.identity.variantLabel(l.fields, opts.ident);
    }
  }
  return out;
}

/** What a person may change on this line, and what they may not. For a UI that has to explain itself. */
function editableFields(line) {
  if (!line) return [];
  return Object.keys(line.provenance || {}).filter((k) => line.provenance[k] === 'own');
}
/**
 * Fields that cannot be changed on THIS row, whoever is reading.
 *
 * A source field stays locked even for the brand that owns it, because changing it here would change it for every
 * distributor. They change it at the source;  says whether that door is open to them.
 */
function lockedFields(line) {
  if (!line) return [];
  return Object.keys(line.provenance || {}).filter((k) => line.provenance[k] === 'source');
}

/** A count a person can act on: how much of this catalogue is actually mine to change? */
function summary(ls) {
  const list = ls || [];
  return {
    total: list.length,
    own: list.filter((l) => l.origin === 'own').length,
    referenced: list.filter((l) => l.origin === 'source').length,
    fully_mine: list.filter((l) => l.edit_scope === 'all').length,
    overlay_only: list.filter((l) => l.edit_scope === 'overlay').length,
    i_own_source: list.filter((l) => l.i_own_source).length,
    sources: [...new Set(list.filter((l) => l.source_key).map((l) => l.source_key))],
  };
}

module.exports = { lines, ownedLine, referencedLine, editableFields, lockedFields, summary, CORE };
