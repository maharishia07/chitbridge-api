/**
 * lib/offer-clash.js — TWO LIVE DISCOUNTS ON ONE SHELF, REFUSED AT SAVE (T2-LABS · OFF-E1, 2026-10-14).
 *
 * The rule is the ENGINE's, not this file's: CBOffers.clashes (engines v1.46.0) — only ONE item-level discount (percent ·
 * amount · tier) may apply to an item. Until now only the Offer Lab's page asked it, so an offer made live anywhere else
 * (Setup › Offers, the planner, the lab's own status button) ran beside another one on the same items and the stacking
 * order settled it in silence. This reads what the engine needs, inside the save's own transaction, and says no in words.
 *
 *   check(db, entity_id, saving) → null | { status: 409, body: { error, code: 'OFFER_CLASH', message, clashes: [{ definition_id, name, items }] } }
 *     saving: { definition_id (null on create), kind, sub_kind, name, rules, status } — the offer AS IT WILL BE after the save.
 *
 * ⭐ ONLY A SAVE THAT LEAVES THE OFFER LIVE IS ASKED, against the shop's OTHER LIVE offers. A draft is a draft (the lab warns
 *   while drafting); paused / approved / retired run nothing. Trips: one read of the live offers; a second (the catalogue rows
 *   an item list must be placed in a category by) only when one side names items and the other a category.
 */
'use strict';
const eng = require('./offers-engine').CBOffers;
const { offerFromRow } = require('./catalogue-view');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ids = (o, k) => { const s = o && o.applies_to; return (s && Array.isArray(s[k])) ? s[k].map(String) : []; };
const hasCats = (o) => { const s = (o && o.applies_to) || {}; return !!(s.category || (Array.isArray(s.category_ids) && s.category_ids.length)); };

async function check(db, entity_id, saving) {
  if (!saving || saving.kind !== 'offer' || saving.status !== 'live') return null;
  const me = offerFromRow({ definition_id: saving.definition_id || 'this-offer', name: saving.name, sub_kind: saving.sub_kind, rules: saving.rules });
  /* not an item-level discount (a basket offer, a gift, shipping…) → nothing can clash; asked of the engine, never a list here */
  if (!eng.clashes(me, [Object.assign({}, me, { id: 'probe' })]).length) return null;

  const r = await db.query(
    `SELECT d.definition_id, d.name, d.sub_kind, v.rules
       FROM definition d
       LEFT JOIN definition_version v ON v.definition_id = d.definition_id AND v.version = d.current_version
      WHERE d.entity_id = $1 AND d.kind = 'offer' AND d.status = 'live'
        AND ($2::uuid IS NULL OR d.definition_id <> $2::uuid)`,
    [entity_id, saving.definition_id && UUID.test(String(saving.definition_id)) ? saving.definition_id : null]);
  const others = (r.rows || []).map(offerFromRow).filter((o) => o.kind);
  if (!others.length) return null;

  /* the catalogue rows only when an item list must meet a category — one read, the ids both sides name */
  const all = [me].concat(others);
  const named = [...new Set(all.flatMap((o) => ids(o, 'item_ids')))].filter((x) => UUID.test(x));
  let items = [];
  if (named.length && all.some(hasCats)) {
    const c = await db.query(`SELECT item_id, item_data FROM catalogue_items WHERE entity_id = $1 AND item_id = ANY($2::uuid[])`, [entity_id, named]);
    items = (c.rows || []).map((x) => { const d = x.item_data || {};
      return { item_id: String(x.item_id), sku: d.sku || d.code || null, categories: (Array.isArray(d.categories) ? d.categories : []).map(String), name: d.name || '' }; });
  }
  const hits = eng.clashes(me, others, items);
  if (!hits.length) return null;

  const clashes = hits.map((h) => ({ definition_id: h.offer.id, name: h.offer.label, items: h.items.map((i) => i.name || i.item_id) }));
  const first = clashes[0];
  const where = first.items.length ? first.items.slice(0, 3).join(', ') + (first.items.length > 3 ? ' and ' + (first.items.length - 3) + ' more' : '') : 'the same items';
  const message = 'This offer overlaps "' + first.name + '" on ' + where + '. An item takes one discount at a time — pause "'
    + first.name + '", or take those items out of this offer.' + (clashes.length > 1 ? ' (' + (clashes.length - 1) + ' more offer' + (clashes.length > 2 ? 's' : '') + ' overlap too.)' : '');
  return { status: 409, body: { error: 'Offer clash', code: 'OFFER_CLASH', message, clashes } };
}

module.exports = { check };
