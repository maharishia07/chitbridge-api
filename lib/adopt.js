/**
 * ── lib/adopt.js · WHAT A SHOP MAY TAKE INTO ITS OWN CATALOGUE ─────────────────────────────────────────────────
 *
 * Athi, 2026-09-10, on receiving goods from suppliers in three different trades:
 *
 *   *"actually speaking, i would purchase what I intend to sell, rest i may use it, so all cannot go into
 *    catalogue… it has to be like create the product and SKU etc according to your own way of doing and then
 *    accept the product, but we can offer that facility so he doesn't need to create all by himself. So offer is
 *    the right way of doing, but should not be so easy — just a button should not accept the product, it has to
 *    ask for confirmation. If it is not his own vertical, refuse and say if you want to override then please
 *    say so."*
 *
 * Four rules come out of that, and each of them is a refusal to do something convenient:
 *
 * ⭐⭐⭐ 1 · NOT EVERYTHING RECEIVED IS FOR SALE. A shop buys what it will sell AND what it will use — packing
 * material, cleaning supplies, a new kettle. Only goods bought for RESALE can reach a catalogue. Everything else
 * is still stock while it sits there, and is still worth counting, but it never belongs on a shelf a customer
 * reads. Systems that skip this end up with "Toilet cleaner (staff)" on a storefront.
 *
 * ⭐⭐⭐ 2 · ADOPTION MINTS THE RECEIVER'S OWN PRODUCT. It is NOT a copy of the supplier's row. The shop's name for
 * it, the shop's SKU, the shop's price. What the supplier sent is a SEED — it fills the form so nobody types
 * forty products by hand — and the moment it is accepted it is the shop's own record and diverges freely. This is
 * the whole difference between adopting and syncing: a synced catalogue is somebody else's, for ever.
 *
 * ⭐⭐ 3 · A VERTICAL MISMATCH IS REFUSED, NOT WARNED. A pharma product arriving at a grocery stops. It is not a
 * formatting problem — a shop that starts stocking medicines takes on a licence, an expiry obligation and a
 * recall duty, and none of that should begin because somebody tapped Accept on a delivery. The override exists,
 * and it is deliberately a separate act with its own sentence.
 *
 * ⚠️ 4 · AND IT IS NEVER ONE TAP. Athi: *"should not be so easy."* This module answers what MAY be offered and
 * why; the confirmation is the caller's, and the caller must not skip it.
 */
'use strict';
const lotfields = require('./lotfields');

/**
 * ⚠️ WHAT THE GOODS ARE FOR. Declared per line at goods-in, never inferred — a guess here decides whether a
 * product appears on a storefront, and no heuristic is worth that.
 *   resale   → may be offered to the catalogue, and is the only kind that can
 *   own_use  → stock the shop holds and consumes; counted, never sold
 *   unknown  → nobody said yet. Offered as a QUESTION, not resolved by default.
 */
const PURPOSES = { resale: 'to sell', own_use: 'for the shop to use', unknown: 'not said yet' };

/**
 * ⭐⭐⭐ WHAT THESE GOODS ARE FOR — ASKED OF THE SUPPLIER, NOT OF EVERY LINE.
 *
 * Athi, 2026-09-10: *"can we designate the supplier list — he is for my own use and he is my real supplier?
 * There itself the demarcation happens."* It is the better answer, and it is better because it matches how a
 * shop works: the stationery supplier is never selling you things to resell, and the FMCG distributor always is.
 * The fact belongs to the RELATIONSHIP, so it is answered once instead of forty times on one delivery.
 *
 * ⚠️ A DEFAULT, NOT A LAW. The distributor who sells you biscuits also sells you the shelf labels, so a line may
 * still say otherwise. The supplier answers for the 95%, the line answers for the exception, and a system that
 * allowed only one of the two would be wrong twice.
 */
function purposeFor(supplier, lineSays) {
  if (PURPOSES[lineSays]) return { purpose: lineSays, from: 'line',
    why: 'somebody marked this line ' + PURPOSES[lineSays] };
  const k = supplier && supplier.supply_kind;
  if (k === 'own_use') return { purpose: 'own_use', from: 'supplier',
    why: (supplier.name || 'this supplier') + ' is a sundry supplier — what they send is for the shop to use' };
  if (k === 'resale') return { purpose: 'resale', from: 'supplier',
    why: (supplier.name || 'this supplier') + ' supplies goods you sell' };
  /* ⚠️ NOBODY HAS SAID. Not guessed either way — an unasked supplier is a question, and the delivery says so. */
  return { purpose: 'unknown', from: null,
    why: 'nobody has said whether this supplier sells you goods or things the shop uses' };
}

/** the vertical a set of sectors resolves to, or null when a shop has declared none */
function verticalOf(sectors) {
  const p = lotfields.packFor(sectors);
  return p ? p.key : null;
}

/**
 * ⭐⭐ WHAT A LINE WOULD BECOME, and whether it may.
 *
 *   line     what arrived: { particulars, quantity, unit, price, item_data:{ batch, expiry, serial, unit_cost … } }
 *   from     the sender: { name, sectors }  — their trade, which travels ON the chit
 *   me       the receiver: { sectors, has_item }  — has_item(name) says "I already stock this"
 *   opts     { purpose, override }  — what a person said about THIS line
 *
 * Returns { may, why, needs, seed, vertical, refused } — `may` is 'offer' · 'refuse' · 'already' · 'not_for_sale'.
 */
function consider(line, from, me, opts) {
  const o = opts || {};
  const l = line || {};
  const d = l.item_data || {};
  const theirs = verticalOf(from && from.sectors);
  const mine = verticalOf(me && me.sectors);
  const name = String(l.particulars || d.name || '').trim();

  if (!name) return { may: 'refuse', why: 'this line has no product name to adopt', vertical: theirs };

  /* ⭐ 1 · ALREADY MINE. Nothing to adopt; goods-in matches it and the stock moves. Said plainly, because "why is
     this not offered" is the first question a shopkeeper asks about a list that skipped something. */
  if (me && typeof me.has_item === 'function' && me.has_item(name))
    return { may: 'already', why: 'you already stock this — the delivery will match it', vertical: theirs };

  /* ⭐ 2 · WHAT IS IT FOR? Only resale can reach a catalogue. Unknown is a question, not a no. */
  /* ⭐ the supplier decides unless this line was marked otherwise (b216) */
  const decided = purposeFor(from, o.purpose);
  const purpose = decided.purpose;
  if (purpose === 'own_use')
    return { may: 'not_for_sale', why: decided.why + ', so it is a purchase and not something you sell',
             vertical: theirs, purpose, decided_by: decided.from };

  /**
   * ⭐⭐⭐ 3 · THE VERTICAL GATE. Refused, not warned — and the sentence has to say what taking it on MEANS,
   * because "vertical mismatch" is a word from our world, not the shopkeeper's.
   * ⚠️ AN UNDECLARED SECTOR IS NOT A MISMATCH. A shop that has said nothing about its trade cannot be told it is
   * the wrong one; it is told what these goods will require of it and allowed to proceed.
   */
  if (theirs && mine && theirs !== mine && !o.override) {
    return { may: 'refuse', refused: 'vertical', vertical: theirs, purpose,
      why: 'these are ' + theirs + ' goods and you are set up as ' + mine + '. Stocking them brings '
         + theirs + ' obligations with it — ' + obligationOf(theirs)
         + '. If you mean to sell them, say so and it will be added.',
      override_says: 'Yes, I stock ' + theirs + ' goods too' };
  }

  /**
   * ⭐ 4 · WHAT THE GOODS THEMSELVES REQUIRE. Resolved from the SENDER'S trade, because a batch number is a fact
   * about the medicine, not about who is holding it — the receiver's own sector cannot make an expiry optional.
   * ⚠️ A missing REQUIRED field is not a refusal to adopt; it is a refusal to adopt SILENTLY. The product can be
   * created, and the shop is told what this delivery failed to carry, because that is a conversation to have with
   * the supplier rather than a row to quietly accept.
   */
  const pack = lotfields.forEntity(from && from.sectors);
  const missing = (pack.required || []).filter((f) => !valueOf(d, f));

  return {
    may: 'offer', why: null, vertical: theirs, purpose,
    /**
     * ⚠️⚠️ "NOBODY SAID" MUST NOT BEHAVE LIKE "TO SELL". An undeclared supplier falls through to offer — which is
     * the right place to end up, and the wrong thing to do silently, because the shopkeeper never agreed to it.
     * This flag is what turns it into a question on the screen: "is this a supplier you buy goods to sell from?"
     * asked once, and never again for that supplier.
     */
    ask_purpose: purpose === 'unknown',
    decided_by: decided.from,
    purpose_why: decided.why,
    overridden: !!(o.override && theirs && mine && theirs !== mine),
    needs: pack.required || [],
    missing,
    /**
     * ⭐⭐ THE SEED — a filled form, not a record. Everything here is a SUGGESTION the shop edits before accepting:
     * their name for it, their SKU, their price. The supplier's cost arrives as a cost, never as a selling price,
     * because a shop that sold at cost because a form pre-filled it would have been failed by this file.
     */
    seed: {
      name,                                            /* their words, for the shop to rewrite */
      unit: l.unit || null,
      sku: null,                                       /* ⚠️ NEVER the supplier's — the shop mints its own */
      suggested_sku: suggestSku(name, me && me.sku_style),
      cost: num(d.unit_cost) != null ? num(d.unit_cost) : num(l.price),
      price: null,                                     /* ⚠️ what to SELL at is the shop's decision, always */
      batch_tracked: (pack.required || []).indexOf('batch') >= 0 || (pack.required || []).indexOf('serial') >= 0,
      from: { name: (from && from.name) || null, vertical: theirs },
      attributes: attributesOf(d, pack),
    },
  };
}

/** ⚠️ read the value under either the field's own name or the GS1 word for it — goods-in captures both shapes */
function valueOf(d, field) {
  const v = d[field] != null ? d[field] : (field === 'batch' ? d.lot : undefined);
  return v == null || v === '' ? null : v;
}

/** what arrived, kept under the vertical's own field names, so a pharma product carries pharma facts */
function attributesOf(d, pack) {
  const out = {};
  for (const f of (pack.required || []).concat(pack.optional || [])) {
    const v = valueOf(d, f);
    if (v != null) out[f] = v;
  }
  return out;
}

/**
 * ⚠️ THE SENTENCE A SHOPKEEPER WEIGHS THE DECISION WITH. "Vertical mismatch" tells them nothing; "you will need
 * to record a batch and an expiry on every delivery, and you can be asked to recall by batch" tells them what
 * they are agreeing to. This is the whole reason the gate exists, so it must not be a code.
 */
function obligationOf(vertical) {
  return ({
    pharma:     'a batch and an expiry on every delivery, and a recall you can be asked to act on by batch',
    food:       'a batch on every delivery, and dates you have to sell against',
    serialised: 'a serial number for every single unit, one at a time',
    chemical:   'a batch, and often a grade and a production date',
    lot:        'a lot number where the trade asks for one',
  })[vertical] || 'record-keeping this shop does not do today';
}

/** ⚠️ A SUGGESTION, and only that. Nothing is created under it until a person has seen it and pressed accept. */
function suggestSku(name, style) {
  const words = String(name || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const head = words.slice(0, 2).map((w) => w.slice(0, 3)).join('-');
  return (style && style.prefix ? String(style.prefix).toUpperCase() + '-' : '') + head;
}

function num(v) { const n = Number(v); return isFinite(n) ? n : null; }

/**
 * ⭐ THE WHOLE DELIVERY AT ONCE — what a person is actually shown after goods-in. Grouped by what may happen to
 * it, because "three new products, one needs a decision, two you already stock" is a sentence somebody can act
 * on, and a list of forty rows is not.
 */
function considerAll(lines, from, me, opts) {
  const rows = (Array.isArray(lines) ? lines : []).map((l, i) =>
    Object.assign({ line: i, particulars: l && l.particulars },
                  consider(l, from, me, Object.assign({}, opts, (opts && opts.per_line && opts.per_line[i]) || {}))));
  return {
    rows,
    offer:  rows.filter((r) => r.may === 'offer'),
    refused: rows.filter((r) => r.may === 'refuse'),
    already: rows.filter((r) => r.may === 'already'),
    not_for_sale: rows.filter((r) => r.may === 'not_for_sale'),
    /* ⚠️ THE HEADLINE SAYS WHAT NEEDS A PERSON, not how many rows there are */
    says: says(rows),
  };
}

function says(rows) {
  const n = (k) => rows.filter((r) => r.may === k).length;
  const bits = [];
  if (n('offer')) bits.push(n('offer') + ' new product' + (n('offer') === 1 ? '' : 's') + ' you can add');
  if (n('refuse')) bits.push(n('refuse') + ' that need' + (n('refuse') === 1 ? 's' : '') + ' your say-so');
  if (n('already')) bits.push(n('already') + ' you already stock');
  if (n('not_for_sale')) bits.push(n('not_for_sale') + ' for the shop to use');
  return bits.length ? bits.join(' · ') : 'nothing on this delivery is new to you';
}

module.exports = { PURPOSES, consider, considerAll, verticalOf, obligationOf, suggestSku, purposeFor };
