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
const { pickOf } = require('./counter-bill'); // the one pick of a bill's stored totals (ACC-268: a bill that reads 0 beside its own money.total)
const store = require('./books-store');
const { fromMinor } = require('./books-cashflow'); // the api's one minor -> major
const policy = require('./policy'); // [REV-01] flagOf() — the SELLER's own price_includes_tax, no second query
const I = require('./issued-invoice'); // ⭐ one invoice, everywhere — the check that only names a difference
const { placeOfSupply } = require('./tax');
const { BILLED_AT_SHAPE } = require('./books-hooks'); // the one shape of a billed_at the books honour (also postingMoment's) // ⭐ the ONE place-of-supply rule — the engine's, the counter's CBTax.placeOfSupply

/**
 * deliveredPos(businessJson, buyerState) → the place of supply a chit's RECORDED facts decide, else null (CTRY-81, IGST Act s.10).
 * `business_json.delivery.bill_to_ship_to: true` → the bill-to party's state (s.10(1)(b)); `delivery.state_code` → where the goods go
 * (s.10(1)(a), the counter's own key); neither → null, and the caller keeps its labelled buyer-GSTIN fallback. The state itself is read by
 * the engine's placeOfSupply (asked with no shop state, so a missing or bad code answers ''): never a second rule here.
 */
function deliveredPos(businessJson, buyerState) {
  const delivery = businessJson && typeof businessJson === 'object' && businessJson.delivery && typeof businessJson.delivery === 'object' ? businessJson.delivery : null;
  if (!delivery) return null;
  if (delivery.bill_to_ship_to === true) return String(buyerState || '').trim() || null;
  return placeOfSupply(businessJson, '') || null;
}
/** capturedSalePos(businessJson, buyerState, shopState) → a captured-message sale's place of supply: the recorded delivery, else the shop's state when the buyer names none, else unset (the buyer's own state decides). */
function capturedSalePos(businessJson, buyerState, shopState) {
  return deliveredPos(businessJson, buyerState) || (buyerState ? undefined : shopState);
}
/** withRecordedPos(buyer, businessJson) → the buyer, its place of supply set from the chit's recorded delivery when nothing set one before (CTRY-81). */
function withRecordedPos(buyer, businessJson) {
  const recorded = buyer && !buyer.Pos ? deliveredPos(businessJson, buyer.State) : null;
  if (recorded) buyer.Pos = recorded;
  return buyer;
}

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

/** CTRY-94: a party whose row names no country trades in MINE, as the captured supplier below does (the engine no longer reads India for it); one that names its own keeps it */
function tradesInMyCountry(party, meRow) {
  if (party.Country || !meRow.country) return party;
  party.Country = String(meRow.country).trim().toUpperCase();
  return party;
}
/** the identities one copy needs, by id: me, the other side, a captured bill's supplier (F10: read in the SAME query, one more id, never a second trip) */
function partyIdsOf(copy, shopId) {
  const otherId = T.otherPartyId(copy, shopId);
  const captured = capturedBill(copy, shopId),
    capId = captured ? capturedPartyId(copy.business_json) : null;
  return { otherId, captured, capId, ids: [String(shopId)].concat(otherId ? [String(otherId)] : []).concat(capId ? [capId] : []) };
}
/** the identity rows of some ids, ONE statement, by id (ACC-273: each party carries the owner's registration word) */
async function identityRowsOf(ids) {
  const r = await query(`SELECT identity_id, gstn, display_name, policy_flags, country FROM identities WHERE identity_id = ANY($1::uuid[])`, [ids]);
  return new Map((await Promise.all(r.rows.map((x) => T.withRegistration(x)))).map((x) => [String(x.identity_id), x]));
}
/**
 * SPD-18: the parties of a whole month's copies in ONE read (was one identities statement per chit). A copy whose ids cannot be worked out is left out here and fails again, alone, inside its own try of
 * ledgerFor; a failed read answers null and every copy reads its own, as before: the batch never makes a month fail that the per-copy path would have kept.
 */
async function identityRowsOfMonth(copies, shopId) {
  if (!copies.length) return null; /* an empty month reads nobody: no trip */
  try {
    const ids = new Set([String(shopId)]);
    copies.forEach((copy) => {
      try {
        partyIdsOf(copy, shopId).ids.forEach((id) => ids.add(id));
      } catch (e) {
        log.fellBack('tax-copy identityRowsOfMonth: a copy names no readable party — it is read, and dropped with its words, in ledgerFor', e);
      }
    });
    return await identityRowsOf([...ids]);
  } catch (e) {
    log.fellBack('tax-copy identityRowsOfMonth: one read failed — each copy reads its own', e);
    return null;
  }
}
/** The two parties of MY copy: me, and the other side (sender if received; first "to" recipient if sent). `known` = the month's identity rows already read (SPD-18); without it this copy reads its own. */
async function partiesFor(hdr, me, known) {
  const sent = String(hdr.sender_entity_id) === String(me);
  const { otherId, captured, capId, ids } = partyIdsOf(hdr, me);
  const rows = known || (await identityRowsOf(ids));
  const meRow = rows.get(String(me)) || {},
    otherRow = otherId ? rows.get(String(otherId)) || {} : {};
  /**
   * ⭐ F10: MY RECEIPT OF THEIR BILL — the supplier sells, I buy. The supplier is the party the counter picked (its identity row: GSTIN,
   * state, country), else the name typed at the door; one with no country is taken as trading in mine (they charged my country's tax at
   * my door), and an Indian supplier with no GSTIN takes the state the counter typed (input_tax.vendor_state) — or none, and the engine
   * says CGST/SGST vs IGST cannot be decided (never guessed). The goods arrived at MY shop: that is the place of supply.
   * The rates are theirs as the counter recorded them — input_tax.inclusive says whether their prices included the tax.
   */
  if (captured) {
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
  const seller = tradesInMyCountry(T.partyOf(iSell ? meRow : otherRow, { entity_id: iSell ? String(me) : String(otherId || '') }), meRow);
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
    else b.Pos = capturedSalePos(bj, b.State, meParty.State);
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
  return { seller, buyer: withRecordedPos(buyer, hdr.business_json), direction: sent ? 'sent' : 'received', sells: iSell, me: T.partyOf(meRow, { entity_id: String(me) }), priceIncludesTax };
}

/**
 * invoiceFrom(entry) → THE invoice answer of one copy: the INV-01 block (who, which, how far, the invoice) plus `sells` (a party
 * fact, no price) and the heads. ⭐ M3 (2026-10-30): GET /api/invoice/:id and GET /api/tax/invoice/:id both answer with THIS and nothing
 * else (the two had each spelled it and drifted: `sells` was on one only); costView.invoiceAnswer is the reader filter on top of it.
 */
function invoiceFrom(entry) {
  return {
    chit_id: entry.chit_id,
    direction: entry.direction,
    sells: entry.sells,
    status: entry.status,
    provisional: entry.provisional,
    frozen: entry.frozen,
    rated: entry.rated,
    unrated: entry.unrated,
    seller: entry.seller,
    buyer: entry.buyer,
    invoice: entry.invoice,
    heads: T.heads(entry.invoice)
  };
}
/** invoiceOf(copyHeader, shopId) → the invoice answer of MY copy `copyHeader` (entryFor, then invoiceFrom) */
async function invoiceOf(copyHeader, shopId) {
  return invoiceFrom(await entryFor(copyHeader, shopId));
}

/** the copy read, with `extra` columns (a leading comma) after the usual ones */
const copySql = (extra) => `SELECT h.chit_id, h.sender_entity_id, h.all_recipients, h.business_json, h.summary_json, h.purpose,
                         h.auto_subject, h.manual_subject, h.sent_at, h.created_at,
                         d.line_items, d.currency_code, s.current_status, s.direction, s.updated_at AS status_at${extra}
                    FROM chit_header h
                    LEFT JOIN chit_detail d ON d.chit_id = h.chit_id AND d.entity_id = h.entity_id
                    LEFT JOIN chit_status s ON s.chit_id = h.chit_id AND s.entity_id = h.entity_id`;
const COPY_SQL = copySql('');

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
 * The moment the books post a copy at, in SQL (books-hooks postingMoment): the counter's billed_at when it has the shape the books honour
 * (BILLED_AT_SHAPE, the very regex postingMoment tests — a malformed free-text value falls back in both, and never throws here), else the send, else the creation.
 */
const POSTED_AT_SQL = `COALESCE(CASE WHEN h.business_json ->> 'billed_at' ~ '${BILLED_AT_SHAPE.source}'
                                  THEN (h.business_json ->> 'billed_at')::timestamptz END, h.sent_at, h.created_at)`;

/**
 * ⭐ THE BOOKS HOLD IT (Fable review of #362, C1): a copy is in the return only when the books hold an entry for it that nothing has reversed — the home itself,
 * not a copy of the posting rule. The entry is the bill's own (source_ref chit:<id>…, as books-store unreversedForChit), a walk-in bill's own (bill:<id>), or the
 * day entry that covers it (source_chit_ids), or a walk-in bill that came after its day was posted (walkin-late:<id>, books-hooks postChit — ACC-202, lifecycle
 * B3 S9-8: the late bill was in the books and not in the return). A payment's entry (chitpay:…) is not the bill. So a payment advice, a storefront order, a bill still waiting
 * for acceptance / a dispute / a supplier / its tax head, an undecided sale, a cancelled or rejected one — none has an entry, none is here. Same reversal test as
 * unreversedForChit.
 */
const ENTRY_OF_COPY_SQL = `j.entity_id = h.entity_id AND j.reverses_entry_id IS NULL
       AND (j.source_ref LIKE 'chit:' || h.chit_id::text || '%' OR j.source_ref = 'bill:' || h.chit_id::text OR j.source_ref = 'walkin-late:' || h.chit_id::text
            OR j.source_chit_ids @> ARRAY[h.chit_id::uuid])`;
/** ACC-270: the same test AS AT a day — `asAt` is a SQL day parameter ('$5'): an entry, or a reversal, posted on or after that day does not yet count, so a September bill reversed in October is still in the books at the end of September. No `asAt` = the books today. */
const booksEntryOfCopy = (asAt) =>
  `${ENTRY_OF_COPY_SQL}${asAt ? `
       AND to_char(j.posting_date, 'YYYY-MM-DD') < ${asAt}` : ''}
       AND NOT EXISTS (SELECT 1 FROM journal_entry r WHERE r.entity_id = j.entity_id AND r.reverses_entry_id = j.entry_id${asAt ? ` AND to_char(r.posting_date, 'YYYY-MM-DD') < ${asAt}` : ''})`;
const BOOKS_ENTRY_OF_COPY_SQL = booksEntryOfCopy();
const POSTED_IN_BOOKS_SQL = `EXISTS (SELECT 1 FROM journal_entry j WHERE ${BOOKS_ENTRY_OF_COPY_SQL})`;
/**
 * ⭐ ACC-224 — THE DAY THE BOOKS HOLD THE COPY: the posting_date of its unreversed entry ('YYYY-MM-DD'). It is the invoice's own day, unless the books moved it
 * (its month was locked, or it pre-dates the ledger: books.postingDateFor) — then it is a later day, and that later month is the month of record.
 */
const BOOKS_DAY_SQL = `(SELECT to_char(j.posting_date, 'YYYY-MM-DD') FROM journal_entry j WHERE ${BOOKS_ENTRY_OF_COPY_SQL} ORDER BY j.posting_date DESC LIMIT 1)`;

/** the first days of the shop's locked months: a bill moved forward from one of them was moved by a LOCK; from none, by the ledger's first day (ACC-224) */
const LOCKED_STARTS_SQL = `(SELECT array_agg(to_char(p.start_date, 'YYYY-MM-DD')) FROM fiscal_period p WHERE p.entity_id = h.entity_id AND p.status <> 'open')`;

/**
 * ⭐ ACC-270 — REVERSED AFTER ITS MONTH: the day (YYYY-MM-DD) a reversal was posted in [days.from $4, days.to $5) against an entry of this copy that was posted BEFORE $4. The bill is not in
 * this month's return (the books no longer hold it) and not silently gone either: ledgerFor names it. A reversal in the bill's own month nets to nothing and is not named.
 */
const REVERSED_AFTER_SQL = `(SELECT to_char(r.posting_date, 'YYYY-MM-DD') FROM journal_entry j JOIN journal_entry r ON r.entity_id = j.entity_id AND r.reverses_entry_id = j.entry_id
       WHERE ${ENTRY_OF_COPY_SQL} AND to_char(j.posting_date, 'YYYY-MM-DD') < $4 AND to_char(r.posting_date, 'YYYY-MM-DD') >= $4 AND to_char(r.posting_date, 'YYYY-MM-DD') < $5
       ORDER BY r.posting_date DESC LIMIT 1)`;
/** ACC-270 — A COUNTER BILL OF MY OWN THE BOOKS HOLD NO ENTRY FOR AT ALL (not reversed: never posted), in a shop that KEEPS books (books_setting.enabled; a books-off shop has no entries by design). A cancelled / rejected one never posts by rule (books-hooks REFUSED), a payment advice or an order is no counter bill. */
const NO_ENTRY_BILL_SQL = `(h.sender_entity_id = h.entity_id AND (h.business_json ->> 'bill_no') IS NOT NULL AND (h.business_json -> 'till' ->> 'id') IS NOT NULL
       AND COALESCE(s.current_status, '') !~ '^(rejected|cancelled)$'
       AND EXISTS (SELECT 1 FROM books_setting k WHERE k.entity_id = h.entity_id AND k.enabled)
       AND NOT EXISTS (SELECT 1 FROM journal_entry j WHERE ${ENTRY_OF_COPY_SQL}))`;

/**
 * My copies posted in [from, to) that the books hold — drafts excluded; a copy's moment is the one the books post it at. With `days` ({ from, to }, 'YYYY-MM-DD'),
 * also the copies the books HOLD on a day in [days.from, days.to) whatever their own moment (ACC-224: a late bill the books moved into this month); each row says
 * `books_posting_date`, and ledgerFor decides which month is the copy's (monthOfRecord).
 */
async function copiesFor(me, from, to, days) {
  if (!days) return copiesPlain(me, from, to);
  /* ACC-270: the books AS AT the month's end ($5) — a reversal posted later is not yet in this month's return, which stays as it was filed */
  const asAt = booksEntryOfCopy('$5'),
    bookedDay = `(SELECT to_char(j.posting_date, 'YYYY-MM-DD') FROM journal_entry j WHERE ${asAt} ORDER BY j.posting_date DESC LIMIT 1)`,
    booked = `EXISTS (SELECT 1 FROM journal_entry j WHERE ${asAt})`;
  const found = await withEntity(me, (db) =>
    db.query(
      copySql(`, ${bookedDay} AS books_posting_date, ${LOCKED_STARTS_SQL} AS books_locked_starts, ${REVERSED_AFTER_SQL} AS books_reversed_day, ${NO_ENTRY_BILL_SQL} AS books_no_entry`) +
        ` WHERE h.entity_id = $1 AND h.role <> 'Draft'
        AND ((${booked} AND ((${POSTED_AT_SQL} >= $2::timestamptz AND ${POSTED_AT_SQL} < $3::timestamptz) OR (${bookedDay} >= $4 AND ${bookedDay} < $5)))
             OR (NOT ${booked} AND ${REVERSED_AFTER_SQL} IS NOT NULL)
             OR (${NO_ENTRY_BILL_SQL} AND ${POSTED_AT_SQL} >= $2::timestamptz AND ${POSTED_AT_SQL} < $3::timestamptz))
      ORDER BY ${POSTED_AT_SQL}`,
      [me, from, to, days.from, days.to]
    )
  );
  return found.rows;
}
/** the copies posted in [from, to) that the books hold today (no month view: the plain read) */
async function copiesPlain(shopId, from, to) {
  const found = await withEntity(shopId, (db) =>
    db.query(
      copySql(`, ${BOOKS_DAY_SQL} AS books_posting_date, ${LOCKED_STARTS_SQL} AS books_locked_starts`) +
        ` WHERE h.entity_id = $1 AND h.role <> 'Draft' AND ${POSTED_IN_BOOKS_SQL}
        AND (${POSTED_AT_SQL} >= $2::timestamptz AND ${POSTED_AT_SQL} < $3::timestamptz)
      ORDER BY ${POSTED_AT_SQL}`,
      [shopId, from, to]
    )
  );
  return found.rows;
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
async function entryFor(hdr, me, known) {
  const p = await partiesFor(hdr, me, known);
  const bj = hdr.business_json || {};
  const frozen = bj.invoice ? bj.invoice : null;
  const lines = Array.isArray(hdr.line_items) ? hdr.line_items : [];
  const at = iso(hdr.sent_at || hdr.created_at);
  /* ⭐ CTRY-139: the one question both the check and the computed path ask; bill_day = the shop's day of the document, for the dated price band */
  const asked = { lines, seller: p.seller, buyer: p.buyer, currency: hdr.currency_code, chit_id: hdr.chit_id, at, bill_day: T.billDayOf(bj, hdr.purpose, at, p.seller), purpose: hdr.purpose, priceIncludesTax: p.priceIncludesTax };
  /* ⭐ the counter's own invoice: a counter bill whose invoice was carried at send (a server stamp carries frozen_at) */
  const issued = !!(frozen && counterIssued(bj) && frozen.ValDtls && !frozen.frozen_at);
  let taxCheck = null;
  if (issued) {
    try {
      const server = T.invoiceFor(asked).invoice;
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
    : T.invoiceFor(asked); /* [REV-01] — see partiesFor() */
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
    now = require('./shop-clock').today(zone), /* the shop's day by the one clock (a posting path never says new Date) */
    mm = /^(\d{4})-(\d{2})$/.exec(require('./books-period').monthGiven(m, 'month', now.slice(0, 7))); /* ACC-333/334: a month GIVEN and not a real one is a 400, never this month */
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

/** 'YYYY-MM' → the first day of the month after it */
const nextMonthDay = (month) => {
  const year = Number(month.slice(0, 4)),
    monthNo = Number(month.slice(5, 7));
  return (monthNo === 12 ? year + 1 : year) + '-' + pad2(monthNo === 12 ? 1 : monthNo + 1) + '-01';
};

/**
 * ⭐ ACC-224 — ONE PERIOD OF RECORD, the books': a bill is in the return of the month the BOOKS hold it in. That is its own invoice month, unless the books moved it
 * forward because that month was locked (filed) or pre-dates the ledger (books.postingDateFor, by design — a locked month never takes a late entry): then it is the month
 * of its books date, and it is reported there as a late invoice of an earlier month (an invoice left out of its own period is reported in the next open period's GSTR-1 with its original date, the usual practice; statute sub-section not cited until the Act text is read; the filed return is never reopened). `shopDay` is the shop's day of the invoice.
 * Returns { month, prior } — prior is null for a bill in its own month, else the words and the facts for the return to name.
 */
function monthOfRecord(row, shopDay) {
  const booked = row.books_posting_date ? String(row.books_posting_date).slice(0, 10) : null;
  const ownMonth = String(shopDay || '').slice(0, 7);
  if (!booked || booked.slice(0, 7) <= ownMonth) return { month: ownMonth, prior: null };
  const locked = (Array.isArray(row.books_locked_starts) ? row.books_locked_starts : []).some((start) => String(start).slice(0, 7) === ownMonth);
  const cause = locked ? 'entered after ' + ownMonth + ' was closed' : 'dated before this ledger began';
  const prior = {
    chit_id: row.chit_id,
    kind: 'prior_period',
    cause: locked ? 'month_closed' : 'before_ledger',
    invoice_day: shopDay,
    invoice_month: ownMonth,
    booked_day: booked,
    month: booked.slice(0, 7),
    words: 'Dated ' + shopDay + ' (' + ownMonth + ') but ' + cause + ' (booked ' + booked + '): it is in this ' + booked.slice(0, 7) + ' return as a late invoice of ' + ownMonth + ', with its own date. ' + ownMonth + ' is not reopened.'
  };
  return { month: prior.month, prior };
}

/** the pack's input-tax ledger roles by head (IN: input_cgst, input_sgst, input_igst, input_cess) */
const inputRolesOf = (pack) => ['cgst', 'sgst', 'igst', 'cess'].filter((head) => (pack.taxLedgers[head] || {}).input).map((head) => ({ head, role: pack.taxLedgers[head].input }));
/** the pack that reads an expense chit's input tax from the books: IN only (AU's BAS 1B and AE's VAT201 read the posted ledger themselves through gst-returns.returnFor, so they are never read here); null for a chit that carries an invoice (counted from it, once), one with no expense, or a shop with no country pack (T2-NATDEF: nothing assumed) */
function expenseItcPack(header, shop) {
  const business = header.business_json || {};
  if (!business.expense || business.invoice || !shop || !shop.country) return null;
  const pack = require('./regulation').lookup(shop.country);
  return pack.fallback || pack.id !== 'IN' ? null : pack;
}
/** one chit's posted minor amounts by role -> { cgst, sgst, igst, cess } in major units (0 for a head with nothing posted) */
function majorByHead(wanted, rows, money) {
  const byHead = { cgst: 0, sgst: 0, igst: 0, cess: 0 };
  wanted.forEach((item) => {
    byHead[item.head] = fromMinor(rows[item.role] || 0, money);
  });
  return byHead;
}
/** the input tax posted in the month for ALL the month's expense chits, ONE read: { <chit_id>: { cgst, sgst, igst, cess } } in major units (store.inputTaxOfChits; a reversed or other-month posting is not in it) */
async function postedInputTaxOf(headers, shopId, pack, bounds) {
  const wanted = inputRolesOf(pack);
  if (!headers.length || !wanted.length) return {};
  const posted = await withEntity(shopId, (db) => store.inputTaxOfChits(db, shopId, headers.map((header) => header.chit_id), wanted.map((item) => item.role), bounds.from, bounds.to));
  const byChit = {};
  headers.forEach((header) => {
    byChit[header.chit_id] = majorByHead(wanted, posted[String(header.chit_id)] || {}, header.currency_code || pack.currency);
  });
  return byChit;
}
/** the invoice-shaped values the ledger sums for an expense: the posted input tax by head, over what was paid (nothing computed) */
function expenseItcInvoice(header, pack, byHead, inputTotal) {
  const expense = header.business_json.expense;
  const paid = Number(expense.amount) || inputTotal;
  const values = { AssVal: Math.max(0, paid - inputTotal), CgstVal: byHead.cgst, SgstVal: byHead.sgst, IgstVal: byHead.igst, CesVal: byHead.cess, TotInvVal: paid };
  return { currency: header.currency_code || pack.currency, DocDtls: { Typ: 'INV', No: header.chit_id }, ValDtls: values, ItemList: [] };
}
/**
 * ⭐ ACC-269 — AN EXPENSE CHIT'S INPUT TAX IS READ FROM WHAT THE BOOKS POSTED (ACC-230: Dr input_cgst / input_sgst / input_igst / input_cess). The entry, with that tax as a received
 * purchase for the ONE ledger sum (T.ledger / gstr3b - no second sum); returned as it was when nothing is posted in the month (reversed, another month, or the tax went to cost: a blocked credit).
 */
function expenseItcEntry(header, entry, shop, postedByChit) {
  const pack = expenseItcPack(header, shop),
    byHead = postedByChit[header.chit_id];
  const inputTotal = byHead ? byHead.cgst + byHead.sgst + byHead.igst + byHead.cess : 0;
  if (!pack || !(inputTotal > 0)) return entry;
  const supplier = { LglNm: String(header.business_json.expense.what || 'Expense'), RegType: 'regular', Country: entry.me && entry.me.Country, entity_id: null };
  return Object.assign({}, entry, { direction: 'received', sells: false, seller: supplier, invoice: expenseItcInvoice(header, pack, byHead, inputTotal), provisional: false, expense_itc: true });
}
/**
 * ⭐ ACC-269 live path — the till's expense chit (business_json.expense{what, mode, amount}, no invoice, no summary_json.money) is money paid OUT: no supply and, with no GST stated, no ITC.
 * ACC-268 names a bill the return left out that states no total; an expense states its amount in expense.amount and is no bill the return should have counted, so the whole month is not refused for it.
 * It is NAMED beside the return (expense_no_tax) with why no ITC is claimed: "not stated" (or "stated, not yet in the books"), never a 0 ITC claimed in silence.
 * A chit that carries an invoice is a bill (its tax is read from the invoice) and stays under the ACC-268 rule.
 */
function expenseNoTaxItem(copy) {
  const x = copy.business_json.expense,
    number = copy.business_json.bill_no || copy.business_json.printed_as;
  const said = 'Expense ' + (number || copy.chit_id) + ' (' + String(x.what || 'expense') + ', ' + Number(x.amount) + ')';
  const stated = !!x.input_tax && typeof x.input_tax === 'object' && Object.keys(x.input_tax).length > 0;
  const reason = stated ? ': it states GST but the books hold no input tax for it, so no ITC is claimed for it. Post it, then ask for the return again.' : ': no GST is stated on it, so no ITC is claimed for it. Enter the GST on it in the books to claim it.';
  return { chit_id: copy.chit_id, kind: stated ? 'tax_not_in_books' : 'tax_not_stated', amount: Number(x.amount), words: said + reason };
}
/* the kind is the chit's own purpose (the till sends purpose 'expense'): a sale or any other kind that merely carries an expense key stays refused (ACC-268) */
const isExpenseChit = (copy) => String(copy.purpose || '') === 'expense' && !!(copy.business_json && copy.business_json.expense && !copy.business_json.invoice && Number(copy.business_json.expense.amount) > 0);
/** the unread bills (ACC-268) minus the till expenses with no ITC, which are named as expense_no_tax instead */
function splitExpenseNoTax(read, unread) {
  const byId = new Map(read.map((item) => [item.copy.chit_id, item.copy]));
  const isTillExpense = (item) => byId.has(item.chit_id) && isExpenseChit(byId.get(item.chit_id));
  return { expense_no_tax: unread.filter(isTillExpense).map((item) => expenseNoTaxItem(byId.get(item.chit_id))), unread: unread.filter((item) => !isTillExpense(item)) };
}
/**
 * the month's expense chits whose input tax the books hold, read ONCE (nothing is read for a pack that does not read it this way) → { tax, unreadable }.
 * ACC-302: when that one read fails, each expense chit is read on its own: the one that cannot be read is NAMED in `unreadable` (ledgerFor drops it with its words), the others keep their input tax. Never carried on
 * with an empty `tax` (every expense would lose its ITC in silence, a wrong return); when NO chit can be read on its own the first fault is thrown, as before (the database is down, not one copy).
 */
async function expenseTaxOfMonth(copies, shopId, shop, bounds) {
  const expenses = copies.filter((header) => expenseItcPack(header, shop));
  if (!expenses.length) return { tax: {}, unreadable: new Set() };
  const pack = expenseItcPack(expenses[0], shop),
    span = { from: bounds.month + '-01', to: nextMonthDay(bounds.month) };
  try {
    return { tax: await postedInputTaxOf(expenses, shopId, pack, span), unreadable: new Set() };
  } catch (batchFault) {
    log.fellBack('tax-copy expenseTaxOfMonth: the month read failed — reading each expense chit on its own', batchFault);
    return readExpenseTaxOneByOne(expenses, shopId, pack, span, batchFault);
  }
}
/** ACC-302: each expense chit's posted input tax on its own; the faults are named, never swallowed whole (see expenseTaxOfMonth) */
async function readExpenseTaxOneByOne(expenses, shopId, pack, span, batchFault) {
  const taxByChit = {},
    unreadable = new Set();
  for (const header of expenses) {
    try {
      Object.assign(taxByChit, await postedInputTaxOf([header], shopId, pack, span));
    } catch (e) {
      unreadable.add(header.chit_id);
    }
  }
  if (unreadable.size === expenses.length) throw batchFault;
  return { tax: taxByChit, unreadable };
}

/** one copy's entry for the month's ledger; ACC-302: a copy whose input tax could not be read throws, so ledgerFor's own catch names it in dropped with its words and every other bill is untouched */
async function monthEntryFor(copy, shopId, known, unreadable) {
  if (unreadable.has(copy.chit_id)) throw new Error('its input tax could not be read');
  return entryFor(copy, shopId, known);
}

/**
 * The month's ledger for me, with the party I am. ONE SOURCE WITH THE BOOKS (Fable review 2026-10-23, findings 1 and 2): the month is the shop's
 * (monthBounds), a copy sits in it by the moment the books post it at, and is counted only if the books hold its unreversed entry (copiesFor). Each row carries `day`, the shop's calendar day of that moment —
 * the date a return names the document by.
 */
async function ledgerFor(me, month) {
  const books = require('./books-hooks');
  const shop = await T.withRegistration(Object.assign({ identity_id: String(me) }, (await query(`SELECT gstn, display_name, policy_flags, timezone, country FROM identities WHERE identity_id = $1`, [me])).rows[0] || {})); /* ACC-273 */
  const b = monthBounds(month, shop);
  const copies = await copiesFor(me, b.from, b.to, { from: b.month + '-01', to: nextMonthDay(b.month) });
  const { tax: expenseTax, unreadable } = await expenseTaxOfMonth(copies, me, shop, b); /* ACC-269: ONE read for the month's expense chits */
  const known = await identityRowsOfMonth(copies, me); /* SPD-18: and ONE read of the parties of the month's copies */
  const entries = [],
    read = [],
    failed = [];
  const prior_period = []; /* ACC-224: late bills of an earlier month that the books hold in this one — NAMED, with words */
  const dropped = []; /* ACC-266 C5 / ACC-268: a copy that could not be read is NAMED, never a shorter month in silence */
  const reversed = []; /* ACC-270: a bill reversed in this month after an earlier month held it — named, never netted in silence */
  const not_in_books = []; /* ACC-270: a counter bill of this month the books hold no entry for — in no return until posted */
  for (const h of copies) {
    try {
      const booksGap = booksGapOf(h, b.month, books.dayOf(books.postingMoment(h), shop));
      if (booksGap) {
        if (booksGap.item) (booksGap.kind === 'reversed' ? reversed : not_in_books).push(booksGap.item);
        continue; /* not in the books this month: named, not built */
      }
      const e = expenseItcEntry(h, await monthEntryFor(h, me, known, unreadable), shop, expenseTax);
      const shopDay = books.dayOf(books.postingMoment(h), shop),
        record = monthOfRecord(h, shopDay);
      if (record.month !== b.month) continue; /* the books hold it in another month's return */
      if (record.prior) prior_period.push(record.prior);
      entries.push(Object.assign(e, { day: shopDay, period_of_record: record.month, prior_period: record.prior }));
      read.push({ copy: h, entry: e });
    } catch (e) {
      dropped.push(h.chit_id);
      failed.push({ chit_id: h.chit_id, why: 'Bill ' + h.chit_id + ': it could not be read.' });
      log.fellBack('tax-copy ledgerFor: failed — carried on without it', e); /* one bad copy must not hide the month — the caller is told which */
    }
  }
  const meParty = entries.length ? entries[0].me : T.partyOf(shop, { entity_id: String(me) });
  const monthLedger = T.ledger(entries, meParty);
  const { expense_no_tax, unread } = splitExpenseNoTax(read, unreadCopies(read, monthLedger));
  dropped.push(...unread.map((item) => item.chit_id));
  Object.assign(monthLedger, { reversed, not_in_books, expense_no_tax }); /* the return's _cb reads them beside prior_period (tax-lines reversedOf / notInBooksOf) */
  return { bounds: b, me: meParty, ledger: monthLedger, dropped, dropped_why: failed.concat(unread), prior_period, reversed, not_in_books, expense_no_tax };
}

/**
 * ⭐ ACC-270 — a copy the month's read gave that the books do NOT hold in this month, NAMED with words instead of dropped:
 *   · books_reversed_day (and no live entry): an earlier month held it, a reversal was posted this month. The earlier return stays as it was filed (copiesFor reads the books as at
 *     the month's end); this month's return does not count the bill; the shop reports the credit in this open month.
 *   · books_no_entry: a counter bill the books hold no entry for at all — in no return until posted. A bill whose own money.total is 0 is no gap; one with NO stored figure is named without an amount (we cannot say it is free).
 * Returns null for an ordinary booked copy, else { kind, item } (item null = nothing to name).
 */
function booksGapOf(row, month, shopDay) {
  const number = row.business_json && (row.business_json.bill_no || row.business_json.printed_as);
  const label = 'Bill ' + (number || row.chit_id);
  if (row.books_reversed_day && !row.books_posting_date) return reversedGap(row, label, month, shopDay);
  if (row.books_no_entry === true && !row.books_posting_date) return noEntryGap(row, label, month, shopDay);
  return null;
}
/** a bill an earlier month held, reversed in this month: { kind: 'reversed', item } */
function reversedGap(row, label, month, shopDay) {
  const reversedDay = String(row.books_reversed_day).slice(0, 10),
    from = String(shopDay || '').slice(0, 7);
  return {
    kind: 'reversed',
    item: { chit_id: row.chit_id, kind: 'reversed_after_filed', invoice_day: shopDay, invoice_month: from, reversed_day: reversedDay, month, words: label + ' (dated ' + shopDay + '): reversed on ' + reversedDay + ' after ' + from + ' was filed. ' + from + ' still holds it as filed and is not reopened; report the credit in the open month, ' + month + '.' }
  };
}
/** a counter bill of a shop that keeps books and has no entry at all: { kind: 'none', item } — item null for a free bill (stored total 0) */
function noEntryGap(row, label, month, shopDay) {
  const total = billTotal(row);
  return {
    kind: 'none',
    item: total === 0 ? null : { chit_id: row.chit_id, kind: 'not_in_books', invoice_day: shopDay, month, words: label + ' (dated ' + shopDay + (total === null ? '' : ', for ' + total) + '): the books hold no entry for it, so it is in no GST return. Post it, or cancel it, then ask for the return again.' }
  };
}

/** the total in words; a live bill may carry no figure at all (SIT part 6: no money block), which is said, never taken for 0 */
const saidTotal = (total) => (total === null ? 'the bill states no total' : 'the bill is for ' + total);
const unreadWords = {
  no_invoice: (total) => 'it holds no invoice the return can read, so the return left it out (' + saidTotal(total) + ').',
  no_side: (total) => 'it is neither a sale of the shop nor a purchase, so the return left it out (' + saidTotal(total) + ').',
  zero: (total) => (total === null ? 'it reads as 0 and the bill states no total, so it cannot be told from a free bill.' : 'it reads as 0 but the bill itself says it is for ' + total + '.'),
  lines: (total) => 'its lines cannot be read, so the return counts it as 0 (' + saidTotal(total) + ').'
};
/**
 * ACC-268: the bills the return's own source (copiesFor, the books hold an entry) gave and the ledger did NOT count, or counted as nothing.
 * `read` = [{ copy, entry }] the copies that built an entry; `monthLedger` = T.ledger of those entries (it names what it skipped, by index; it is the only sum).
 *   · left out by the ledger, with money on the bill (summary_json.money.total) → named. A bill the shop wrote to ITSELF (self_supply) is the ledger's own rule "not a supply": not named.
 *   · counted but all heads 0 while the bill's own money.total is not 0 → named. A genuinely free bill (money.total 0) is not.
 */
function unreadCopies(read, monthLedger) {
  const skipped = monthLedger.skipped || [];
  const skippedAt = new Set(skipped.map((item) => item.at));
  const named = skipped.filter((item) => item.kind !== 'self_supply').map((item) => unreadItem(read[item.at].copy, unreadWords[item.kind]));
  const countedRows = read.filter((item, at) => !skippedAt.has(at)).map((item) => item.copy);
  countedRows.forEach((copy, rowAt) => {
    const heads = monthLedger.rows[rowAt].heads;
    if (!linesReadable(copy)) named.push(unreadItem(copy, unreadWords.lines, true));
    else if (heads.total === 0 && heads.taxable === 0 && heads.tax === 0) named.push(unreadItem(copy, unreadWords.zero));
  });
  return named.filter(Boolean);
}
/** what the bill itself says it is for: its money.total (the engine's header figure, counter-bill.pickOf), else the frozen invoice's total (counter-bill.pickOf copies.invoice, the field the books post from), else the header's total_value (a live counter bill may carry only that), else null = states none */
const billTotal = (copy) => {
  const copies = pickOf(copy).copies;
  if (copies.money !== null) return copies.money;
  return copies.invoice !== null ? copies.invoice : copies.total_value;
};
/** the bill's lines are a list of objects (a stored [null], a non-object line, or a line_items that is present but not a list cannot be read: the return would count the bill as 0); an absent key is the old reading */
const linesReadable = (copy) => !('line_items' in copy) || (Array.isArray(copy.line_items) && copy.line_items.every((line) => line && typeof line === 'object'));
/** one named bill { chit_id, why } in words — null when the bill itself says 0 with readable lines (a genuinely free bill is no gap); a bill that states NO total is named (not known to be free); `unreadable` (lines that cannot be read) is named whatever the total */
function unreadItem(copy, reason, unreadable) {
  const total = billTotal(copy);
  if (total === 0 && !unreadable) return null;
  const number = copy.business_json && (copy.business_json.bill_no || copy.business_json.printed_as);
  return { chit_id: copy.chit_id, why: 'Bill ' + (number || copy.chit_id) + ': ' + reason(total) };
}

module.exports = {
  counterIssued,
  withRecordedPos,
  billReceived,
  capturedBill,
  capturedPartyId,
  partiesFor,
  copyOf,
  copyOn,
  copiesFor,
  monthOfRecord,
  entryFor,
  invoiceFrom,
  invoiceOf,
  freezeOnComplete,
  monthBounds,
  ledgerFor
};
