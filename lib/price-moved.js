'use strict';
/**
 * lib/price-moved.js — A DRAFT SENT LONG AFTER IT WAS PRICED: WHICH LINES MOVED, AND MAY THE PERSON SEND THEM AS DRAFTED (CTR-245, CTR-212 S4).
 *
 * OWNS      movedOf(lines, rows, since, currency) → { lines: [fact] } · whoAsks(req, business_json) → 'person' | 'till' | 'unattended' · ackVerdict(ack, found, now) → { ok, why }
 *           · ackBlockOf(ack, found, by, now) → the record kept on the bill · bodyFor(found, now) → the 409 body · readFor(entity, ids, draftId, withEntity) → { rows, since }
 * CALLED BY routes/chits.js (sendPriceMoved before the write, sendMovedTicket after it) · lib/price-drift (the ONE comparison: lineFact) · lib/money-check.raiseDrift (the one ticket)
 * FLOW      a person promotes a draft (promote_draft_id) → the shop's rows the lines name (ONE read) → a line whose row moved AFTER the draft was made and whose carried figure differs
 *           is named → 409 PRICE_MOVED with the lines and an ack to hand back · the same draft from the shop's own loopback (kind auto), or any key that is not a person, goes as authored
 *           and ONE ticket says so · a till body never meets this (its own check is lib/price-drift, after the store, a ticket)
 * CARD      09-counter/README
 *
 * ⚠️ SERVER-SIDE EQUALITY, NO ENGINE: two carried numbers (the line's price, the row's price) are compared by lib/price-drift; nothing is summed, re-priced or rounded here, and the server
 * never sends a total. The web re-prices ONCE, with its engine, when the person chooses "use new prices".
 * ⚠️ THE ACK IS BOUND: it names each line AND the row stamp it was shown, and is void after 5 minutes or when a stamp moved again. A rate that moved or a product withdrawn is never
 * passed by an ack (the rate in force is the law's): those two kinds are re-priced, removed or cancelled, never sent as drafted.
 */
const drift = require('./price-drift');
const { UUID_RE } = require('./trace');

/** an ack lives five minutes from the moment the server showed the lines (critic CTR-245 4) */
const ACK_LIFE_MS = 5 * 60 * 1000;
/** the kinds an ack may pass (a price only); every other kind is re-priced or removed */
const ACKABLE = ['price_moved'];
/** a draft's moment and its role, in the sender's own scope */
const DRAFT_SQL = 'SELECT created_at, role FROM chit_header WHERE chit_id = $1 AND entity_id = $2';

/** the catalogue product a draft line names: the line's own item_id, else the pick's ref (the storefront and the web cart write ref.item_id), only a uuid of the shop's own catalogue */
function idOf(line) {
  const id = line && (line.item_id != null ? line.item_id : line.ref && line.ref.item_id);
  return id != null && UUID_RE.test(String(id)) ? String(id) : null;
}

/** the ids of a draft's catalogue lines, each once */
function idsOf(lines) {
  const ids = [];
  for (const line of Array.isArray(lines) ? lines : []) {
    const id = idOf(line);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** who is asking: 'till' (a counter's body, which never meets a refusal), 'unattended' (a key or the shop's own loopback, nobody waits), or 'person' (a signed-in person, waiting) */
function whoAsks(req, business_json) {
  const bill = business_json || {};
  if ((req.till && req.till.key) || bill.price_basis || (bill.till && bill.till.build)) return 'till';
  if (req.api_key || require('./price-note').isShopOwnSend(req)) return 'unattended';
  return 'person';
}

/** the rows the draft's products name and the draft's own moment, in ONE transaction → { rows: Map(item_id → row), since: ms | NaN, role } */
async function readFor(entity, ids, draftId, withEntity) {
  const rows = await drift.readRows(entity, ids, withEntity);
  const found = await withEntity(entity, (db) => db.query(DRAFT_SQL, [draftId, entity]));
  const draft = found.rows[0];
  return { rows, since: draft ? Date.parse(draft.created_at) : NaN, role: draft ? draft.role : null };
}

/** a figure the answer names, or null when it names none */
const orNull = (value) => (value == null ? null : value);

/** the fact the person and the ticket read, from a moved line (price_moved · rate_moved · withdrawn) */
function factOf(line, fact, kind) {
  const carried = fact.carried || {};
  const row = fact.row || {};
  return {
    line_id: orNull(line.line_id),
    item_id: fact.item_id,
    name: orNull(fact.name || line.particulars || line.name),
    kind,
    was_minor: orNull(carried.price_minor),
    now_minor: orNull(row.price_minor),
    was_rate: orNull(carried.gst_rate),
    now_rate: orNull(row.gst_rate),
    changed_at: orNull(fact.changed_at)
  };
}

/** a withdrawn product: the row is there and is no longer active (a deleted row has no date and may be another shop's id: not named) */
function withdrawnFact(line, row, currency) {
  const carried = drift.carriedPriceMinor(line, currency);
  return { line_id: line.line_id || null, item_id: String(row.item_id), name: line.particulars || line.name || null, kind: 'withdrawn', was_minor: carried, now_minor: null, was_rate: null, now_rate: null, changed_at: null };
}

/** one line against its row now → the fact, or null when nothing is to be said (no row, no stamp, not after the draft, the same figure) */
function lineMoved(line, row, ctx) {
  if (row.is_active === false) return withdrawnFact(line, row, ctx.currency);
  const fact = drift.lineFact(Object.assign({}, line, { item_id: String(row.item_id) }), row, ctx);
  return fact && fact.reason && fact.reason !== 'not_found' ? factOf(line, fact, fact.reason) : null;
}

/**
 * every line of a draft against the rows now → { lines: [fact] }: a row that moved AFTER the draft was made (since, ms) and whose figure differs, or a product withdrawn.
 * `rows` = Map(item_id → row). A line that names no product of the shop, a row with no stamp and a row not found are not named.
 */
function movedOf(lines, rows, since, currency) {
  const ctx = { billedMs: Date.now(), snapMs: since, currency };
  const out = [];
  for (const line of Array.isArray(lines) ? lines : []) {
    const row = rows.get(idOf(line));
    const fact = row ? lineMoved(line, row, ctx) : null;
    if (fact) out.push(fact);
  }
  return { lines: out };
}

/** the ack the server hands back with the 409: each moved line and the stamp it was shown, and when */
function ackOf(found, now) {
  return { issued_at: new Date(now).toISOString(), lines: found.lines.map((line) => ({ item_id: line.item_id, changed_at: line.changed_at })) };
}

/** the 409 body: the sentence, the code the web branches on, the lines and the ack (never a total) */
function bodyFor(found, now) {
  const rateOrGone = found.lines.some((line) => ACKABLE.indexOf(line.kind) < 0);
  const count = found.lines.length;
  return {
    code: 'PRICE_MOVED',
    error: 'Prices have moved since this draft was made.',
    message: (count === 1 ? 'One item' : count + ' items') + ' in this draft changed in the catalogue after the draft was made. Use the new prices, or ' + (rateOrGone ? 'change or remove the line before sending.' : 'send it as drafted.'),
    lines: found.lines,
    can_send_as_drafted: !rateOrGone,
    ack: ackOf(found, now)
  };
}

/** is the ack one the server issued less than five minutes ago (and not from the future)? */
function ackFresh(ack, now) {
  const issued = ack && typeof ack === 'object' ? Date.parse(ack.issued_at) : NaN;
  return !Number.isNaN(issued) && issued <= now + 5000 && now - issued <= ACK_LIFE_MS;
}

/** does the ack name every moved line with the very stamp it was shown (a stamp that moved again no longer matches)? */
function ackCovers(ack, found) {
  const shown = new Map((Array.isArray(ack.lines) ? ack.lines : []).map((line) => [String(line && line.item_id), line && line.changed_at]));
  return found.lines.every((line) => shown.has(line.item_id) && Date.parse(shown.get(line.item_id)) === Date.parse(line.changed_at));
}

/** does the person's ack cover THESE lines as they stand NOW (the stamp each was shown, five minutes, a price only)? → { ok: true } or { ok: false, why } */
function ackVerdict(ack, found, now) {
  if (found.lines.some((line) => ACKABLE.indexOf(line.kind) < 0)) return { ok: false, why: 'kind' };
  if (!ackFresh(ack, now)) return { ok: false, why: 'expired' };
  return ackCovers(ack, found) ? { ok: true } : { ok: false, why: 'moved_again' };
}

/** the record kept on the bill (business_json.price_basis.ack): who let it go as drafted, when, which lines and the stamp of each */
function ackBlockOf(found, by, now) {
  return { at: new Date(now).toISOString(), by: by || null, via: 'send_as_drafted', lines: found.lines.map((line) => ({ item_id: line.item_id, name: line.name, was_minor: line.was_minor, now_minor: line.now_minor, changed_at: line.changed_at })) };
}

/** the moved lines in the shape raiseDrift files: both carried figures side by side, the kind as the reason */
function ticketLinesOf(found) {
  return found.lines.map((line) => ({
    item_id: line.item_id,
    name: line.name,
    reason: line.kind,
    carried: { price_minor: line.was_minor, gst_rate: line.was_rate },
    row: { price_minor: line.now_minor, gst_rate: line.now_rate },
    changed_at: line.changed_at
  }));
}

module.exports = { ticketLinesOf, movedOf, whoAsks, ackVerdict, ackBlockOf, bodyFor, readFor, idsOf, idOf, ACK_LIFE_MS };
