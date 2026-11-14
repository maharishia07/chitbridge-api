'use strict';
/**
 * lib/price-moved.js — A DRAFT SENT LONG AFTER IT WAS PRICED: WHICH LINES MOVED, AND MAY THE PERSON SEND THEM AS DRAFTED (CTR-245, CTR-212 S4).
 *
 * OWNS      movedOf(lines, rows, since, currency) → { lines: [fact], prices } · whoAsks(req) → 'person' | 'till' | 'unattended' · actorOf(req) · repricedLines(lines, found) · signAck / ackVerdict (a signed ack)
 *           · ackBlockOf(found, by, now) → the record kept on the bill · bodyFor(found, ctx, extra) → the 409 body · readFor(entity, ids, draftId, withEntity) → { rows, since }
 * CALLED BY routes/chits.js (sendPriceMoved before the write, sendMovedTicket after it) · lib/price-drift (the ONE comparison: lineFact) · lib/money-check.raiseDrift (the one ticket)
 * FLOW      a person promotes a draft (promote_draft_id) → the shop's rows the lines name (ONE read) → a line whose row moved AFTER the draft was made and whose carried figure differs
 *           is named → 409 PRICE_MOVED with the lines, the total before and after (the send's own engine, once each) and a signed ack to hand back · the same draft from the shop's own loopback
 *           (kind auto), or any key that is not a person, goes as authored and ONE ticket says so · a till KEY never meets this (its own check is lib/price-drift, after the store, a ticket)
 * CARD      09-counter/README
 *
 * ⚠️ SERVER-SIDE EQUALITY: two carried numbers (the line's price, the row's price) are compared by lib/price-drift; nothing is summed or rounded here. The totals in the 409 are the engine's
 * (invoiceAtSend, the one door a send prices through): before = the draft as sent, after = the same lines at the catalogue's prices, COPIED, never a formula.
 * ⚠️ THE ACK IS SIGNED AND BOUND: a JWT (JWT_SECRET, the one verifier) of the draft id, the actor, and each line with the row stamp it was shown; it expires in 5 minutes (the token's own exp), and is void
 * for another draft, another person, or when a stamp moved again. A rate that moved or a product withdrawn is never passed by an ack (the rate in force is the law's).
 * ⚠️ WHO IS A TILL is decided by the KEY (a till-scope key), never by what a body claims: a person whose body carries price_basis is still a person.
 */
const drift = require('./price-drift');
const { UUID_RE } = require('./trace');
const jsonWebToken = require('jsonwebtoken');
const { commercialOf } = require('./till-row');
const log = require('./logger');

/** the audience of the signed ack: only this module reads it, and no session reader accepts it (lib/jwt-verify) */
const ACK_AUDIENCE = 'cb-price-ack';
/** an ack lives five minutes from the moment the server showed the lines (critic CTR-245 4); the token's own exp says so */
const ACK_LIFE_S = 5 * 60;
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

/** is this send from a till KEY (a key whose scope is till and not connector)? the key decides, never a claim in the body */
function isTillKey(req) {
  const key = req.till && req.till.key;
  return !!key && Array.isArray(key.scopes) && key.scopes.includes('till') && !key.scopes.includes('connector');
}

/** who is asking: 'till' (a till key: a counter's bill, which never meets a refusal), 'unattended' (any other key or the shop's own loopback, nobody waits), or 'person' (a signed-in person, waiting) */
function whoAsks(req) {
  if (isTillKey(req)) return 'till';
  if (req.api_key || require('./price-note').isShopOwnSend(req)) return 'unattended';
  return 'person';
}

/** who the ack is bound to: the acting person, else the entity */
const actorOf = (req) => String((req.identity && (req.identity.actor_id || req.identity.identity_id)) || '');

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
 * every line of a draft against the rows now → { lines: [fact], prices }: a row that moved AFTER the draft was made (since, ms) and whose figure differs, or a product withdrawn.
 * `rows` = Map(item_id → row); `prices` = Map(item_id → the catalogue's price now, as the row carries it). A line that names no product of the shop, a row with no stamp and a row not found are not named.
 */
function movedOf(lines, rows, since, currency) {
  const ctx = { billedMs: Date.now(), snapMs: since, currency };
  const out = { lines: [], prices: new Map() };
  for (const line of Array.isArray(lines) ? lines : []) {
    const row = rows.get(idOf(line));
    const fact = row ? lineMoved(line, row, ctx) : null;
    if (!fact) continue;
    out.lines.push(fact);
    out.prices.set(fact.item_id, commercialOf(row.item_data || {}).price);
  }
  return out;
}

/** the lines as they would be at the catalogue's prices now: a moved price takes the row's price (its line total is left to the engine), a withdrawn line is left out */
function repricedLines(lines, found) {
  const kinds = new Map(found.lines.map((fact) => [fact.item_id, fact.kind]));
  const out = [];
  for (const line of Array.isArray(lines) ? lines : []) {
    const kind = kinds.get(idOf(line));
    const price = found.prices.get(idOf(line));
    if (kind === 'withdrawn') continue;
    out.push(kind && price != null ? Object.assign({}, line, { price, total: undefined }) : line);
  }
  return out;
}

/** the signed ack handed back with the 409: the draft, the actor, each moved line and the stamp it was shown; null when no secret is set (then nothing may be sent as drafted) */
function signAck(found, ctx) {
  const lines = found.lines.map((line) => ({ item_id: line.item_id, changed_at: line.changed_at }));
  try {
    return jsonWebToken.sign({ kind: 'price_ack', draft: ctx.draft, actor: ctx.actor, lines }, process.env.JWT_SECRET, { algorithm: 'HS256', audience: ACK_AUDIENCE, expiresIn: ACK_LIFE_S });
  } catch (e) {
    return log.orElse('price-moved: the ack could not be signed (no JWT_SECRET?); the draft cannot be sent as drafted', null)(e);
  }
}

/** the 409 body: the sentence, the code the web branches on, the lines, the totals the engine gave (extra.total, extra.reach) and the signed ack (never a figure the server worked out here) */
function bodyFor(found, ctx, extra) {
  const signed = module.exports.signAck(found, ctx); /* through the exports so a scene can fix the token */
  const rateOrGone = found.lines.some((line) => ACKABLE.indexOf(line.kind) < 0) || !signed;
  const count = found.lines.length;
  return Object.assign({
    code: 'PRICE_MOVED',
    error: 'Prices have moved since this draft was made.',
    message: (count === 1 ? 'One item' : count + ' items') + ' in this draft changed in the catalogue after the draft was made. Use the new prices, or ' + (rateOrGone ? 'change or remove the line before sending.' : 'send it as drafted.'),
    lines: found.lines,
    can_send_as_drafted: !rateOrGone,
    ack: signed
  }, extra || {});
}

/** does the ack name every moved line with the very stamp it was shown (a stamp that moved again no longer matches)? */
function ackCovers(claims, found) {
  const shown = new Map((Array.isArray(claims.lines) ? claims.lines : []).map((line) => [String(line && line.item_id), line && line.changed_at]));
  return found.lines.every((line) => shown.has(line.item_id) && Date.parse(shown.get(line.item_id)) === Date.parse(line.changed_at));
}

/** the claims of a signed ack, or { why } when it is not one of ours, expired, or void (a bad signature, a wrong kind) */
function claimsOf(token) {
  if (typeof token !== 'string' || !token) return { why: 'missing' };
  try {
    const claims = require('./jwt-verify').verifyJwt(token, { audience: ACK_AUDIENCE }).claims;
    return claims && claims.kind === 'price_ack' ? { claims } : { why: 'kind' };
  } catch (e) {
    return { why: e && e.name === 'TokenExpiredError' ? 'expired' : 'invalid' };
  }
}

/** does the person's ack cover THESE lines as they stand NOW, for THIS draft and THIS person (signed, 5 minutes, the stamp each was shown, a price only)? → { ok: true } or { ok: false, why } */
function ackVerdict(token, found, ctx) {
  if (found.lines.some((line) => ACKABLE.indexOf(line.kind) < 0)) return { ok: false, why: 'kind' };
  const read = claimsOf(token);
  if (!read.claims) return { ok: false, why: read.why };
  if (read.claims.draft !== ctx.draft) return { ok: false, why: 'other_draft' };
  if (read.claims.actor !== ctx.actor) return { ok: false, why: 'other_actor' };
  return ackCovers(read.claims, found) ? { ok: true } : { ok: false, why: 'moved_again' };
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

module.exports = { ticketLinesOf, movedOf, repricedLines, whoAsks, actorOf, isTillKey, signAck, ackVerdict, ackBlockOf, bodyFor, readFor, idsOf, idOf, ACK_LIFE_S, ACK_AUDIENCE };
