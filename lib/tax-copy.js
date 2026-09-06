// @stage tested
// @stage-note ONE copy of a chit as a tax record: its parties, its invoice (frozen or live), the month's copies, the freeze at completed.
'use strict';
/**
 * tax-copy.js — the DB-facing half of tax-lines.js. routes/tax.js reads through it; routes/chits.js freezes through it.
 * Kept out of the routes so the invoice a chit is stamped with and the invoice the ledger reads are one function.
 */
const { query, withEntity } = require('../db');
const T = require('./tax-lines');

/** The two parties of MY copy: me, and the other side (sender if received; first "to" recipient if sent). */
async function partiesFor(hdr, me) {
  const sent = String(hdr.sender_entity_id) === String(me);
  const otherId = T.otherPartyId(hdr, me);
  const ids = [String(me)].concat(otherId ? [String(otherId)] : []);
  const r = await query(`SELECT identity_id, gstn, display_name, policy_flags, country FROM identities WHERE identity_id = ANY($1::uuid[])`, [ids]);
  const rows = new Map(r.rows.map((x) => [String(x.identity_id), x]));
  const meRow = rows.get(String(me)) || {}, otherRow = otherId ? (rows.get(String(otherId)) || {}) : {};
  /* ⭐ WHO SELLS IS NOT WHO SENDS. A storefront ORDER (purpose 'order' / 'offer') is SENT by the customer and RECEIVED by
     the shop — the shop is the supplier. Before this the shop's own copy of an order was taxed with the customer as the
     seller: no seller state, supply 'unknown', tax 0, and the ledger filed it as input credit (the two-party tour,
     2026-09-05). Any other purpose keeps the rule 'the sender sells'. */
  const orderLike = /^(order|offer)$/.test(String(hdr.purpose || ''));
  const iSell = orderLike ? !sent : sent;
  const seller = T.partyOf(iSell ? meRow : otherRow, { entity_id: iSell ? String(me) : String(otherId || '') });
  const buyer = T.partyOf(iSell ? otherRow : meRow, { entity_id: iSell ? String(otherId || '') : String(me) });
  /* ⭐ A WALK-IN CUSTOMER HAS NO STATE. A storefront buyer is an OTP identity — no GSTIN, no state — so the engine could not
     decide intra/inter and charged nothing (tax 0, supply 'unknown'). GST's B2C rule: the place of supply is where the goods
     are handed over — the shop's state — unless a delivery address says otherwise (that refinement reads the order's
     delivery address; not yet). The engine's note still says the place of supply was assumed. */
  if (orderLike && buyer && !buyer.State && !buyer.Pos && !buyer.Gstin && seller && seller.State) buyer.Pos = seller.State;
  /* ⭐ A COUNTER BILL (Record a sale / Bill, 2026-09-05): a chit to SELF with business_json.customer — the shop sells, the
     customer is whoever the counter wrote down (name · phone · email · GSTIN if a business). Without this a self chit had
     the shop on both sides of its own invoice. */
  const bj = hdr.business_json || {};
  /* ⭐ A CAPTURED MESSAGE IS A COUNTER SALE TOO ([CAP-02], 2026-09-06): a chit to SELF with business_json.via (WhatsApp, email, any
     channel) was sent BY the shop about a customer who wrote in — the shop sells, the writer is the walk-in. Without this the
     self chit had the shop on both sides, no place of supply, tax 0 (cart ₹378, invoice ₹360). The customer block wins when
     both are present; either applies whatever the purpose, because a self chit has no other party to sell to. */
  const toSelf = !otherId || String(otherId) === String(me);
  const via = bj.via && typeof bj.via === 'object' ? bj.via : null;
  const cust = (bj.customer && typeof bj.customer === 'object') ? bj.customer
             : (via && toSelf) ? { name: via.name || via.from || 'Customer', phone: via.from || null, channel: via.channel || null } : null;
  if (cust && typeof cust === 'object' && (orderLike || toSelf)) {
    const meParty = T.partyOf(meRow, { entity_id: String(me) });
    const g = cust.gstin ? String(cust.gstin).trim().toUpperCase() : null;
    const b = { LglNm: cust.name || 'Customer', Gstin: g, State: g && /^\d{2}/.test(g) ? g.slice(0, 2) : null, Country: meParty.Country || 'IN', RegType: g ? 'regular' : 'unregistered', Ph: cust.phone || null, Em: cust.email || null, entity_id: null };
    if (!b.State) b.Pos = meParty.State;
    return { seller: meParty, buyer: b, direction: sent ? 'sent' : 'received', sells: true, me: meParty, counter: true };
  }
  return { seller, buyer, direction: sent ? 'sent' : 'received', sells: iSell, me: T.partyOf(meRow, { entity_id: String(me) }) };
}

const COPY_SQL = `SELECT h.chit_id, h.sender_entity_id, h.all_recipients, h.business_json, h.summary_json, h.purpose,
                         h.auto_subject, h.manual_subject, h.sent_at, h.created_at,
                         d.line_items, d.currency_code, s.current_status, s.direction, s.updated_at AS status_at
                    FROM chit_header h
                    LEFT JOIN chit_detail d ON d.chit_id = h.chit_id AND d.entity_id = h.entity_id
                    LEFT JOIN chit_status s ON s.chit_id = h.chit_id AND s.entity_id = h.entity_id`;

/** My copy of one chit, or null. */
async function copyOf(chit_id, me) {
  const r = await withEntity(me, (db) => db.query(COPY_SQL + ` WHERE h.chit_id = $1 AND h.entity_id = $2`, [chit_id, me]));
  return r.rows[0] || null;
}

/** My copies in [from, to) — drafts excluded. */
async function copiesFor(me, from, to) {
  const r = await withEntity(me, (db) => db.query(COPY_SQL +
    ` WHERE h.entity_id = $1 AND h.role <> 'Draft'
        AND COALESCE(h.sent_at, h.created_at) >= $2::timestamptz AND COALESCE(h.sent_at, h.created_at) < $3::timestamptz
      ORDER BY COALESCE(h.sent_at, h.created_at)`, [me, from, to]));
  return r.rows;
}

const iso = (v) => (v && v.toISOString) ? v.toISOString() : String(v || '');

/** One copy → a ledger entry: the frozen invoice when the copy was stamped, else computed live and marked provisional. */
async function entryFor(hdr, me) {
  const p = await partiesFor(hdr, me);
  const frozen = hdr.business_json && hdr.business_json.invoice ? hdr.business_json.invoice : null;
  const lines = Array.isArray(hdr.line_items) ? hdr.line_items : [];
  const at = iso(hdr.sent_at || hdr.created_at);
  const inv = frozen ? { invoice: frozen, rated: null, unrated: null, provisional: false }
                     : T.invoiceFor({ lines, seller: p.seller, buyer: p.buyer, currency: hdr.currency_code, chit_id: hdr.chit_id, at });
  return { chit_id: hdr.chit_id, subject: hdr.manual_subject || hdr.auto_subject || '', purpose: hdr.purpose, status: hdr.current_status,
           direction: p.direction, sells: p.sells, at, seller: p.seller, buyer: p.buyer, invoice: inv.invoice, rated: inv.rated, unrated: inv.unrated,
           provisional: !frozen, frozen: !!frozen, me: p.me };
}

/**
 * ⭐ THE STAMP (decision G3, taken 2026-09-04 night): when MY copy reaches `completed`, the invoice is computed once
 * more from the copy's own lines and parties and FROZEN into business_json.invoice — by value, with the moment.
 * A later slab change, a later GSTIN correction, a later rename: none of them move what this copy says it was
 * taxed at. Fails open: a copy that cannot be frozen stays provisional and the ledger says so.
 */
async function freezeOnComplete(chit_id, me) {
  try {
    const hdr = await copyOf(chit_id, me);
    if (!hdr) return null;
    if (hdr.business_json && hdr.business_json.invoice) return hdr.business_json.invoice;   // already stamped
    const e = await entryFor(hdr, me);
    const block = Object.assign({}, e.invoice, { frozen_at: new Date().toISOString(), rated: e.rated, unrated: e.unrated });
    await withEntity(me, (db) => db.query(
      `UPDATE chit_header SET business_json = COALESCE(business_json, '{}'::jsonb) || jsonb_build_object('invoice', $1::jsonb)
        WHERE chit_id = $2 AND entity_id = $3`, [JSON.stringify(block), chit_id, me]));
    return block;
  } catch (_) { return null; }
}

function monthBounds(m) {
  const mm = /^(\d{4})-(\d{2})$/.exec(String(m || ''));
  const now = new Date();
  const y = mm ? Number(mm[1]) : now.getUTCFullYear(), mo = mm ? Number(mm[2]) : now.getUTCMonth() + 1;
  const from = new Date(Date.UTC(y, mo - 1, 1)), to = new Date(Date.UTC(y, mo, 1));
  return { from: from.toISOString(), to: to.toISOString(), period: String(mo).padStart(2, '0') + String(y), month: y + '-' + String(mo).padStart(2, '0') };
}

/** The month's ledger for me, with the party I am. */
async function ledgerFor(me, month) {
  const b = monthBounds(month);
  const copies = await copiesFor(me, b.from, b.to);
  const entries = [];
  for (const h of copies) { try { entries.push(await entryFor(h, me)); } catch (_) { /* one bad copy must not hide the month */ } }
  const meParty = entries.length ? entries[0].me
    : T.partyOf((await query(`SELECT gstn, display_name, policy_flags FROM identities WHERE identity_id = $1`, [me])).rows[0] || {}, { entity_id: String(me) });
  return { bounds: b, me: meParty, ledger: T.ledger(entries, meParty) };
}

module.exports = { partiesFor, copyOf, copiesFor, entryFor, freezeOnComplete, monthBounds, ledgerFor };
