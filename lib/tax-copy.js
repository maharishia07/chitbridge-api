// @stage tested
// @stage-note ONE copy of a chit as a tax record: its parties, its invoice (frozen or live), the month's copies, the freeze at completed.
'use strict';
/**
 * tax-copy.js — the DB-facing half of tax-lines.js. routes/tax.js reads through it; routes/chits.js freezes through it.
 * Kept out of the routes so the invoice a chit is stamped with and the invoice the ledger reads are one function.
 *
 * OWNS      a chit's tax record: its parties (who sells, the seller's price-includes-tax — policy.flagOf with its country), its invoice, the freeze.
 * CALLED BY routes/tax.js · routes/chits.js · routes/books.js · routes/invoice.js · lib/books-hooks.js · lib/bill-use.js · lib/bill-privacy.js ·
 *           lib/books-pack.js · lib/open-orders.js
 * FLOW      chit → partiesFor (one identities read) → T.invoiceFor / the frozen invoice → entryFor → the month's ledger
 * CARD      15-tax-and-country-packs/tax-compute-rate-invoice-tax
 */
const { query, withEntity } = require('../db');
const log = require('./logger');
const T = require('./tax-lines');
const policy = require('./policy'); // [REV-01] flagOf() — the SELLER's own price_includes_tax, no second query
const I = require('./issued-invoice'); // ⭐ one invoice, everywhere — the check that only names a difference
const { placeOfSupply } = require('./tax'); // ⭐ the ONE place-of-supply rule — the engine's, the counter's CBTax.placeOfSupply

/**
 * ⭐ A DOCUMENT A COUNTER ISSUED: a bill number from a till. The same test lib/books-hooks.js classify() makes
 * (`till && bj.bill_no`) and the SQL in lib/books-store.js counterBills() makes — the shop whose counter numbered it sold it.
 */
function counterIssued(bj) {
  return !!(bj && typeof bj === 'object' && bj.bill_no && bj.till && bj.till.id);
}

/**
 * ⭐ A BILL I RECEIVED — my copy of something another business SOLD me: their counter bill, or their invoice. The two
 * kinds lib/books-hooks.js posts as my purchase only once I accept them (buyerGate), so the two kinds goods-in may accept
 * when every line has come in (routes/chits.js deliver-lines).
 */
function billReceived(hdr, me) {
  const h = hdr || {};
  if (capturedBill(h, me)) return true;
  if (!h.sender_entity_id || String(h.sender_entity_id) === String(me)) return false;
  const p = String(h.purpose || '');
  return p === 'invoice' || (/^(order|offer|subscription)$/.test(p) && counterIssued(h.business_json));
}

/**
 * ⭐⭐ F10 — A COUNTER RECEIPT THAT CARRIES THE SUPPLIER'S BILL IS THAT BILL (Athi, 14 Oct). The Receive form asks for their bill no. and
 * total (till rcvConfirm → business_json.their_bill); with BOTH, my own receipt is the supplier bill I accept — Bills · Received
 * (folder-inventory's `their_bill` term, the same test), behind my acceptance (books-hooks buyerGate). Only MY receipt: a till key
 * addresses nobody but its own shop. Without their bill it stays a goods receipt that posts nothing.
 */
function capturedBill(hdr, me) {
  const h = hdr || {};
  if (String(h.purpose || '') !== 'receipt' || !require('./folder-inventory').theirBill(h.business_json)) return false;
  return me == null || !h.sender_entity_id || String(h.sender_entity_id) === String(me);
}
/** the supplier a captured bill names: business_json.party.party_id when the counter picked a known one (F11) */
function capturedPartyId(bj) {
  const p = bj && bj.party,
    id = p && (p.party_id || p.identity_id);
  return id && /^[0-9a-f-]{36}$/i.test(String(id)) ? String(id) : null;
}

/** The two parties of MY copy: me, and the other side (sender if received; first "to" recipient if sent). */
async function partiesFor(hdr, me) {
  const sent = String(hdr.sender_entity_id) === String(me);
  const otherId = T.otherPartyId(hdr, me);
  /* F10: a captured bill's supplier is read in the SAME query (one more id, never a second trip) */
  const cap = capturedBill(hdr, me),
    capId = cap ? capturedPartyId(hdr.business_json) : null;
  const ids = [String(me)].concat(otherId ? [String(otherId)] : []).concat(capId ? [capId] : []);
  const r = await query(`SELECT identity_id, gstn, display_name, policy_flags, country FROM identities WHERE identity_id = ANY($1::uuid[])`, [ids]);
  const rows = new Map(r.rows.map((x) => [String(x.identity_id), x]));
  const meRow = rows.get(String(me)) || {},
    otherRow = otherId ? rows.get(String(otherId)) || {} : {};
  /**
   * ⭐ F10: MY RECEIPT OF THEIR BILL — the supplier sells, I buy. The supplier is the party the counter picked (its identity row: GSTIN,
   * state, country), else the name typed at the door; one with no country is taken as trading in mine (they charged my country's tax at
   * my door), and an Indian supplier with no GSTIN takes the state the counter typed (input_tax.vendor_state) — or none, and the engine
   * says CGST/SGST vs IGST cannot be decided (never guessed). The goods arrived at MY shop: that is the place of supply.
   * The rates are theirs as the counter recorded them — input_tax.inclusive says whether their prices included the tax.
   */
  if (cap) {
    const bj0 = hdr.business_json || {},
      it = bj0.input_tax && typeof bj0.input_tax === 'object' ? bj0.input_tax : {};
    const meParty = T.partyOf(meRow, { entity_id: String(me) });
    const pr = capId ? rows.get(capId) : null;
    const nestedSeller = T.partyOf(pr || { display_name: (bj0.party && bj0.party.name) || null }, { entity_id: pr ? capId : null });
    if (!nestedSeller.LglNm) nestedSeller.LglNm = (bj0.party && bj0.party.name) || 'the supplier';
    if (!nestedSeller.Country) nestedSeller.Country = meParty.Country || null;
    if (!nestedSeller.State && it.vendor_state && String(it.vendor_state).trim()) nestedSeller.State = String(it.vendor_state).trim();
    const nestedBuyer = Object.assign({}, meParty, { Pos: meParty.State || null });
    return { seller: nestedSeller, buyer: nestedBuyer, direction: 'received', sells: false, me: meParty, captured: true, priceIncludesTax: !!it.inclusive };
  }
  /* ⭐ WHO SELLS IS NOT WHO SENDS. A storefront ORDER (purpose 'order' / 'offer') is SENT by the customer and RECEIVED by
     the shop — the shop is the supplier. Before this the shop's own copy of an order was taxed with the customer as the
     seller: no seller state, supply 'unknown', tax 0, and the ledger filed it as input credit (the two-party tour,
     2026-09-05). Any other purpose keeps the rule 'the sender sells'. */
  const orderLike = /^(order|offer)$/.test(String(hdr.purpose || ''));
  /* ⚠️⚠️ BUT A COUNTER BILL IS SOLD BY THE SHOP THAT SENT IT (the two-sided counter bill, 2026-10-01). Its purpose is 'order'
     too, so once the counter sent a bill to an on-rail customer, the CUSTOMER's copy read as the customer's sale — output tax
     in their ledger and a line in their GSTR-1 for goods they bought. A copy of a counter bill I did not send is my PURCHASE:
     the sender sells, I buy (tests/tax-copy.test.cjs). */
  const theirCounterBill = orderLike && !sent && counterIssued(hdr.business_json);
  const iSell = theirCounterBill ? false : orderLike ? !sent : sent;
  const seller = T.partyOf(iSell ? meRow : otherRow, { entity_id: iSell ? String(me) : String(otherId || '') });
  const buyer = T.partyOf(iSell ? otherRow : meRow, { entity_id: iSell ? String(otherId || '') : String(me) });
  /* ⭐ A WALK-IN CUSTOMER HAS NO STATE. A storefront buyer is an OTP identity — no GSTIN, no state — so the engine could not
     decide intra/inter and charged nothing (tax 0, supply 'unknown'). GST's B2C rule: the place of supply is where the goods
     are handed over — the shop's state — unless a delivery address says otherwise (that refinement reads the order's
     delivery address; not yet). The engine's note still says the place of supply was assumed. */
  if (orderLike && buyer && !buyer.State && !buyer.Pos && !buyer.Gstin && seller && seller.State) buyer.Pos = seller.State;
  /* ⭐⭐ MY COPY OF A COUNTER BILL I BOUGHT — 'order' in the older shape, 'invoice' + counter_bill as the send route now names it:
     the seller's counter handed the goods over in the seller's state, so that is the place of supply — the ONE rule
     (lib/tax placeOfSupply), never my own state (2026-10-02, bill C2/26-27/0007). */
  if (!sent && counterIssued(hdr.business_json) && buyer && seller && seller.State) buyer.Pos = placeOfSupply(hdr.business_json, seller.State);
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
  const cust =
    bj.customer && typeof bj.customer === 'object'
      ? bj.customer
      : via && toSelf
        ? { name: via.name || via.from || 'Customer', phone: via.from || null, channel: via.channel || null }
        : null;
  if (cust && typeof cust === 'object' && (orderLike || toSelf) && !theirCounterBill) {
    const meParty = T.partyOf(meRow, { entity_id: String(me) });
    const g = cust.gstin ? String(cust.gstin).trim().toUpperCase() : null;
    let b = {
      LglNm: cust.name || 'Customer',
      Gstin: g,
      State: g && /^\d{2}/.test(g) ? g.slice(0, 2) : null,
      Country: meParty.Country || null /* CX1 (T5): no 'IN' by name — tax-lines.walkIn gives a buyer with no country the shop's */,
      RegType: g ? 'regular' : 'unregistered',
      Ph: cust.phone || null,
      Em: cust.email || null,
      entity_id: null
    };
    /**
     * ⭐⭐ A CUSTOMER ON THE RAIL IS NAMED BY THE RAIL (Athi, 2026-10-01: B2B on the seller's side). The bill was SENT to them
     * (customer.entity_id is the 'to' recipient), so their identity row is already in hand from the one query above: the
     * buyer is their GSTIN, legal name and state — GSTR-1 reports the bill b2b, and the buyer's GSTR-2B can see the credit
     * they take on it. Only the BUYER moves; the lines and the tax are computed exactly as before. A rail customer with no
     * GSTIN stays unregistered (B2C), and a walk-in or an outside customer is what the counter wrote down.
     */
    const railId = cust.entity_id ? String(cust.entity_id) : null;
    if (railId && otherId && railId === String(otherId) && otherRow && otherRow.identity_id) {
      const rp = T.partyOf(otherRow, { entity_id: railId });
      b = Object.assign({}, rp, {
        LglNm: rp.LglNm || b.LglNm,
        Country: rp.Country || b.Country,
        RegType: rp.Gstin ? rp.RegType : 'unregistered',
        Ph: b.Ph,
        Em: b.Em
      });
    }
    /**
     * ⭐⭐⭐ PLACE OF SUPPLY FOLLOWS THE LAW, NOT THE BUYER'S GSTIN (Athi, 2026-10-02; IGST Act s.10(1)(a)). A counter bill is
     * handed over at the counter → the shop's state → CGST + SGST, even for a registered buyer from another state; only a
     * bill recording a delivery to another state is inter-state. Before this a rail buyer's GSTIN state became the place of
     * supply and the server filed IGST on a bill the counter had printed as CGST + SGST. Any other self chit with a customer
     * (a captured message) keeps what it had: the buyer's state, else the shop's.
     */
    if (counterIssued(bj)) b.Pos = placeOfSupply(bj, meParty.State);
    else if (!b.State) b.Pos = meParty.State;
    /* [REV-01] a counter/captured sale always sells as ME — my own price_includes_tax setting, not a default. */
    return {
      seller: meParty,
      buyer: b,
      direction: sent ? 'sent' : 'received',
      sells: true,
      me: meParty,
      counter: true,
      priceIncludesTax: policy.flagOf(meRow.policy_flags, 'price_includes_tax', meRow.country) === 'yes'
    };
  }
  /* [REV-01] whichever row actually sells (meRow or otherRow) — the row is already in hand from the one query
     above; flagOf() reads it directly, never a second trip to identities for a column already sitting here. */
  const sellRow = iSell ? meRow : otherRow,
    priceIncludesTax = policy.flagOf(sellRow.policy_flags, 'price_includes_tax', sellRow.country) === 'yes';
  return { seller, buyer, direction: sent ? 'sent' : 'received', sells: iSell, me: T.partyOf(meRow, { entity_id: String(me) }), priceIncludesTax };
}

const COPY_SQL = `SELECT h.chit_id, h.sender_entity_id, h.all_recipients, h.business_json, h.summary_json, h.purpose,
                         h.auto_subject, h.manual_subject, h.sent_at, h.created_at,
                         d.line_items, d.currency_code, s.current_status, s.direction, s.updated_at AS status_at
                    FROM chit_header h
                    LEFT JOIN chit_detail d ON d.chit_id = h.chit_id AND d.entity_id = h.entity_id
                    LEFT JOIN chit_status s ON s.chit_id = h.chit_id AND s.entity_id = h.entity_id`;

/**
 * One copy, read on a handle the CALLER owns.
 *
 * ⭐ WHY THIS IS SEPARATE FROM copyOf: routes/chits.js already has this row open inside the status-change
 * transaction — it reads chit_header there to learn who the sender is. Reading it a second time to freeze the
 * invoice was a whole extra transaction (BEGIN · set_config · SELECT · COMMIT) for a row already in hand.
 */
function copyOn(db, chit_id, me) {
  return db.query(COPY_SQL + ` WHERE h.chit_id = $1 AND h.entity_id = $2`, [chit_id, me]).then((reply) => reply.rows[0] || null);
}

/** My copy of one chit, or null. */
async function copyOf(chit_id, me) {
  return withEntity(me, (db) => copyOn(db, chit_id, me));
}

/**
 * The moment the books post a copy at, in SQL (books-hooks postingMoment): the counter's billed_at when it is a well-formed ISO moment (the field is
 * free text — a malformed one falls back, never throws), else the send, else the creation.
 */
const POSTED_AT_SQL = `COALESCE(CASE WHEN h.business_json ->> 'billed_at' ~ '^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])T([01]\\d|2[0-3]):[0-5]\\d'
                                  THEN (h.business_json ->> 'billed_at')::timestamptz END, h.sent_at, h.created_at)`;

/** My copies posted in [from, to) — drafts excluded; a copy's moment is the one the books post it at. */
async function copiesFor(me, from, to) {
  const r = await withEntity(me, (db) =>
    db.query(
      COPY_SQL +
        ` WHERE h.entity_id = $1 AND h.role <> 'Draft'
        AND ${POSTED_AT_SQL} >= $2::timestamptz AND ${POSTED_AT_SQL} < $3::timestamptz
      ORDER BY ${POSTED_AT_SQL}`,
      [me, from, to]
    )
  );
  return r.rows;
}

const iso = (date) => (date && date.toISOString ? date.toISOString() : String(date || ''));

/**
 * One copy → a ledger entry: the frozen invoice when the copy was stamped, else computed live and marked provisional.
 *
 * ⭐⭐⭐ A COUNTER BILL CARRIES ITS INVOICE, AND THAT IS THE INVOICE (Athi, 2026-10-02: "the computation should happen in only
 * one place like billing, rest all the places the value has to only read"). The counter's billMoney() computed it with
 * CBTax.determine() — this same engine's INV-01 shape — and chitOf carried it unchanged as business_json.invoice, the slot
 * this function already posts a frozen invoice from. So both copies (the shop's sale, the rail customer's purchase) post it
 * as it is. The server's own computation runs ONLY to check it (lib/issued-invoice check): a difference is named on the
 * entry (`tax_check`) and never written over the stored invoice. A bill with no invoice (older bills, other hosts) keeps
 * the path it always had.
 */
async function entryFor(hdr, me) {
  const p = await partiesFor(hdr, me);
  const bj = hdr.business_json || {};
  const frozen = bj.invoice ? bj.invoice : null;
  const lines = Array.isArray(hdr.line_items) ? hdr.line_items : [];
  const at = iso(hdr.sent_at || hdr.created_at);
  /* ⭐ the counter's own invoice: a counter bill whose invoice was carried at send (a server stamp carries frozen_at) */
  const issued = !!(frozen && counterIssued(bj) && frozen.ValDtls && !frozen.frozen_at);
  let taxCheck = null;
  if (issued) {
    try {
      const server = T.invoiceFor({
        lines,
        seller: p.seller,
        buyer: p.buyer,
        currency: hdr.currency_code,
        chit_id: hdr.chit_id,
        at,
        priceIncludesTax: p.priceIncludesTax
      }).invoice;
      taxCheck = I.check(frozen, server);
    } catch (e) {
      taxCheck = {
        ok: false,
        differences: [{ what: 'server check', issued: null, server: String(e && e.message).slice(0, 120) }],
        says: 'the server could not check this bill'
      };
    }
  }
  const inv = frozen
    ? { invoice: frozen, rated: null, unrated: null, provisional: false }
    : T.invoiceFor({
        lines,
        seller: p.seller,
        buyer: p.buyer,
        currency: hdr.currency_code,
        chit_id: hdr.chit_id,
        at,
        priceIncludesTax: p.priceIncludesTax
      }); /* [REV-01] — see partiesFor() */
  return {
    chit_id: hdr.chit_id,
    subject: hdr.manual_subject || hdr.auto_subject || '',
    purpose: hdr.purpose,
    status: hdr.current_status,
    /* the number the customer holds — a counter bill's or credit note's own series (GSTR-1 Table 13, cdnr nt_num) */
    doc_no: (hdr.business_json && (hdr.business_json.bill_no || hdr.business_json.printed_as)) || null,
    direction: p.direction,
    sells: p.sells,
    at,
    seller: p.seller,
    buyer: p.buyer,
    invoice: inv.invoice,
    rated: inv.rated,
    unrated: inv.unrated,
    provisional: !frozen,
    frozen: !!frozen,
    issued,
    tax_check: taxCheck,
    me: p.me
  };
}

/**
 * ⭐ THE STAMP (decision G3, taken 2026-09-04 night): when MY copy reaches `completed`, the invoice is computed once
 * more from the copy's own lines and parties and FROZEN into business_json.invoice — by value, with the moment.
 * A later slab change, a later GSTIN correction, a later rename: none of them move what this copy says it was
 * taxed at. Fails open: a copy that cannot be frozen stays provisional and the ledger says so.
 */
/**
 * ⭐ `pre` is the copy the caller ALREADY read (see copyOn). Passing it skips a transaction; passing `null`
 * means "I looked and there is no such copy", which is why this tests `undefined` and not falsiness — a
 * truthiness test would turn a caller's honest null into a second read of a row that is not there.
 */
async function freezeOnComplete(chit_id, me, pre) {
  try {
    const hdr = pre !== undefined ? pre : await copyOf(chit_id, me);
    if (!hdr) return null;
    /* already stamped — and a counter bill's carried invoice (CBTax.determine at the counter) IS its stamp: never re-stamped */
    if (hdr.business_json && hdr.business_json.invoice) return hdr.business_json.invoice;
    const e = await entryFor(hdr, me);
    const block = Object.assign({}, e.invoice, { frozen_at: new Date().toISOString(), rated: e.rated, unrated: e.unrated });
    await withEntity(me, (db) =>
      db.query(
        `UPDATE chit_header SET business_json = COALESCE(business_json, '{}'::jsonb) || jsonb_build_object('invoice', $1::jsonb)
        WHERE chit_id = $2 AND entity_id = $3`,
        [JSON.stringify(block), chit_id, me]
      )
    );
    return block;
  } catch (e) {
    log.fellBack('tax-copy freezeOnComplete: the write failed — answered with nothing', e);
    return null;
  }
}

const pad2 = (number) => String(number).padStart(2, '0');

/**
 * The month as the SHOP lives it: [from, to) are the instants its first day begins and the next month's first day begins, in the shop's zone
 * (books-hooks dayBounds — the books' own day), so a bill at 23:30 IST on the last day is that month's and one at 00:30 IST on the 1st is the next's.
 * No month asked → the shop's current month, by the shop's clock. `zone` is an IANA name or a row carrying { timezone, country } (books-hooks zoneOf).
 */
function monthBounds(m, zone) {
  const books = require('./books-hooks'),
    mm = /^(\d{4})-(\d{2})$/.exec(String(m || '')),
    now = books.dayOf(new Date(), zone) || new Date().toISOString().slice(0, 10);
  const y = mm ? Number(mm[1]) : Number(now.slice(0, 4)),
    mo = mm ? Number(mm[2]) : Number(now.slice(5, 7));
  const first = y + '-' + pad2(mo) + '-01',
    next = (mo === 12 ? y + 1 : y) + '-' + pad2(mo === 12 ? 1 : mo + 1) + '-01';
  return {
    from: books.dayBounds(first, zone).from,
    to: books.dayBounds(next, zone).from,
    period: pad2(mo) + String(y),
    month: y + '-' + pad2(mo)
  };
}

/**
 * The month's ledger for me, with the party I am. ONE SOURCE WITH THE BOOKS (Fable review 2026-10-23, findings 1 and 2): the month is the shop's
 * (monthBounds), a copy sits in it by the moment the books post it at (copiesFor), and a copy is counted only if the books would count it
 * (books-hooks countsInBooks: not cancelled; a bill I bought only once accepted). Each row carries `day`, the shop's calendar day of that moment —
 * the date a return names the document by.
 */
async function ledgerFor(me, month) {
  const books = require('./books-hooks');
  const shop = (await query(`SELECT gstn, display_name, policy_flags, timezone, country FROM identities WHERE identity_id = $1`, [me])).rows[0] || {};
  const b = monthBounds(month, shop);
  const copies = await copiesFor(me, b.from, b.to);
  const entries = [];
  for (const h of copies) {
    try {
      const e = await entryFor(h, me);
      if (!books.countsInBooks(h, e, me)) continue;
      entries.push(Object.assign(e, { day: books.dayOf(books.postingMoment(h), shop) }));
    } catch (e) {
      log.fellBack('tax-copy ledgerFor: failed — carried on without it', e); /* one bad copy must not hide the month */
    }
  }
  const meParty = entries.length ? entries[0].me : T.partyOf(shop, { entity_id: String(me) });
  return { bounds: b, me: meParty, ledger: T.ledger(entries, meParty) };
}

module.exports = {
  counterIssued,
  billReceived,
  capturedBill,
  capturedPartyId,
  partiesFor,
  copyOf,
  copyOn,
  copiesFor,
  entryFor,
  freezeOnComplete,
  monthBounds,
  ledgerFor
};
