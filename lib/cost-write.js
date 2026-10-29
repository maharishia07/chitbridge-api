'use strict';
// lib/cost-write.js — what a cost-blind co-assist may WRITE on a chit (RAIL-147): the amend and reprice doors. Door-side only: nothing here writes a row.
//
// OWNS      sideOf (the side for the WRITING shop: lib/cost-view costSideOf over ONE small header read and ONE role read) · lockedLines (the stored lines under FOR UPDATE, by
//           line_id and, through the frozen payload replayed over the amendments, by line_index) · storedFor (the stored line an edit names; both keys must agree) · moneyKeysOf
//           (the money keys ONE replacement line would SET or CHANGE against its stored line) · insideDoor (the door, INSIDE amend.record's transaction) · recordAmend · repriceOpts · hideAmendments
// CALLED BY routes/chits.js — POST /:chit_id/amend (recordAmend in place of amend.record) · POST /:chit_id/reprice (repriceOpts); the refusal is the 403 COST_BLIND body of
//           lib/cost writeRefusal (the PATCH /products precedent: code · blocked = key names, never values), thrown as a refusal with its body — lib/chits-contract faultOf answers it
// FLOW      blind? (ONE can_see_costs read: the owner and a paired counter pay nothing) ──▶ amend.record(…, inside = insideDoor) ──▶ IN ITS TRANSACTION: side, the lines FOR UPDATE
//           ──▶ 'sell': as today ──▶ else per edit, the money keys it would set or change against the stored line (a re-sent equal price is not a change; an omitted or null
//           price is carried) ──▶ any → ONE 403 naming every such key, the transaction ends with nothing written ──▶ none → the carried lines are what record writes, and the
//           answer's lines are pruned to LINE_KEEP; reprice: 403 (preview too — it computes and answers prices by definition)
// CARD      01-rail-core-the-chit/chits-routes
//
// ⚠️ THE STORED LINE DECIDES, NEVER THE CLIENT — AND IT IS READ UNDER THE LOCK THAT WRITES IT. After RAIL-146 a blind reader never sees the price, so the amend screen re-sends
// a line WITHOUT one; an amendment is a full replacement line (lib/amend writeLine), so before this file that wrote NULL over the supplier's rate (#549's lesson in another
// coat). The price is read with SELECT … FOR UPDATE inside amend.record's own transaction (cb-security, #568: a read in a second transaction is the CAT-238 lost update — an
// owner's reprice landing in between would be overwritten by the stale carry). The side is the reader's own (RAIL-146): a sale stays as it was, anything not positively a sale
// is gated. amend writes the LIVE row by line_id (writeLine) and the audit row by both keys, so line_id is the key; an edit naming only line_index is resolved through the
// frozen payload replayed over the amendments (the overlay lib/amend liveSet reads, which is exactly what an erased price would have fallen out of); an edit whose two keys
// name different lines is refused 400 rather than carrying one line's price onto another.
const cost = require('./cost');
const costView = require('./cost-view');
const amend = require('./amend');
const booksStore = require('./books-store');
const { withEntity } = require('../db');
const { round: roundMoney } = require('./money');
const log = require('./logger');

/** the header columns the side needs: small, never the whole business_json (a frozen invoice is large) */
const SIDE_SQL = `SELECT ch.purpose, ch.sender_entity_id, ch.all_recipients, ${costView.smallBusinessJsonSql('ch')} AS business_json FROM chit_header ch WHERE ch.chit_id = $1 AND ch.entity_id = $2`;
/** the live rows, LOCKED for this transaction (the owner's concurrent reprice waits, or we read what it wrote); pre-b142 there is no table and no row. $1 shop, $2 chit */
const LINES_FOR_UPDATE = 'SELECT line_id, seq, price FROM chit_line WHERE entity_id = $1 AND chit_id = $2 ORDER BY seq, line_id FOR UPDATE';
/** the frozen payload, LOCKED (a chit with no line rows is serialised on its detail row). $1 shop, $2 chit */
const DETAIL_FOR_UPDATE = 'SELECT line_items FROM chit_detail WHERE entity_id = $1 AND chit_id = $2 LIMIT 1 FOR UPDATE';
const notMigrated = (e) => e && (e.code === '42P01' || e.code === '42703');
/** what a blind actor may still do on the line, said in the refusal */
const AMEND_MAY = 'You can change the item, the quantity and the unit';
const REPRICE_MAY = 'A reprice sets prices';
const MISMATCH = 'line_id and line_index name two different lines; send the line\'s own id (or its number alone).';
const isObject = (value) => !!value && typeof value === 'object';

/** the 403 body a cost-blind co-assist gets (lib/cost writeRefusal's shape: code COST_BLIND, blocked = key names, never values), thrown as a refusal with its body */
function costBlindRefusal(blocked, allowed) {
  const body = {
    error: 'Not permitted',
    code: 'COST_BLIND',
    blocked,
    message: 'Your access does not include cost or price. ' + allowed + '; the account owner can grant "Sees costs" in Co-assists to change: ' + blocked.join(', ') + '.'
  };
  return Object.assign(new Error(body.message), { status: 403, refused: true, code: body.code, body });
}
/** sideOf(db, shopId, chitId) → 'buy' | 'sell' | 'unknown' for the writing shop, on the caller's connection; a missing header or a failed read is unknown (gated) */
async function sideOf(db, shopId, chitId) {
  try {
    const header = (await db.query(SIDE_SQL, [chitId, shopId])).rows[0];
    if (!header) return 'unknown';
    const party = costView.counterpartyOf(header, shopId);
    const role = party ? (await booksStore.partiesOn(db, shopId, [party])).get(party) || null : null;
    return costView.costSideOf(header, shopId, role);
  } catch (failure) {
    log.fellBack('cost-write: a blind writer\'s side read failed — the side is unknown and the door is shut to money', failure);
    return 'unknown';
  }
}
/** the rows of one locked statement ($1 shop, $2 chit); a table that is not there (pre-b142) is no rows */
async function lockedRows(db, sql, shopId, chitId) {
  try {
    return (await db.query(sql, [shopId, chitId])).rows;
  } catch (failure) {
    if (notMigrated(failure)) return [];
    throw failure;
  }
}
/** the price of a line as a number, null when it has none or the line is gone */
const priceOf = (line) => (!line || line.price == null ? null : Number(line.price));
/**
 * lockedLines(db, shopId, chitId, prepared) → { byId, byIndex } — the stored lines under FOR UPDATE on THIS connection: the live rows by line_id ({ price } as stored); and,
 * unless every edit is a removal, the frozen payload replayed over the amendments by line_index ({ line_id of the original line, price of the live one }).
 */
async function lockedLines(db, shopId, chitId, prepared) {
  const rows = await lockedRows(db, LINES_FOR_UPDATE, shopId, chitId);
  const byId = new Map(rows.map((row) => [String(row.line_id), { price: priceOf(row) }]));
  if (!prepared.some((item) => item.line !== null)) return { byId, byIndex: new Map() };
  const detail = await lockedRows(db, DETAIL_FOR_UPDATE, shopId, chitId);
  const overlay = amend.liveSet((detail[0] && detail[0].line_items) || [], (await amend.list(shopId, chitId, db)).amendments);
  const byIndex = new Map(overlay.map((entry) => [entry.index, { line_id: entry.original && entry.original.line_id ? String(entry.original.line_id) : null, price: entry.removed ? null : priceOf(entry.live) }]));
  return { byId, byIndex };
}
/**
 * storedFor(locked, item) → the stored line a prepared edit names ({ price }, or null when the chit has no such line): by line_id (the key amend writes the live row by), else by
 * line_index through the overlay. Both given and naming different lines → a 400 refusal (a carry across lines is the hazard this guards).
 */
function storedFor(locked, item) {
  const byIndex = locked.byIndex.get(item.idx) || null;
  if (!item.line_id) return byIndex;
  if (byIndex && byIndex.line_id && byIndex.line_id !== String(item.line_id)) throw Object.assign(new Error(MISMATCH), { status: 400 });
  return locked.byId.get(String(item.line_id)) || byIndex;
}
/** is the price sent the stored line's own, to the money unit's rounding? (a re-sent figure is not a change); no stored price means any figure is a set */
function samePrice(sent, stored) {
  if (!stored || stored.price == null || sent == null || !Number.isFinite(Number(sent))) return false;
  return roundMoney(Number(sent)) === roundMoney(Number(stored.price));
}
/** every money key at ANY depth below a key that is not itself money (a picker's ref, a lot) */
function deepMoneyKeys(value, found) {
  if (!isObject(value)) return;
  Object.keys(value).forEach((key) => (costView.isMoneyKey(key) ? found.add(key) : deepMoneyKeys(value[key], found)));
}
/**
 * moneyKeysOf(line, stored) → the money keys ONE replacement line AS SENT would SET or CHANGE on a cost-side chit (lib/cost-view isMoneyKey at any depth: price, total, rate,
 * discount, the cost names …), except a top-level `price` equal to the stored line's, and a null price (carried). A removal (null) and a line with no money key answer [].
 * Judged on the line AS SENT, not the cleaned one: lib/amend clean keeps only LINE_FIELDS, and the refusal must name what was sent.
 */
function moneyKeysOf(line, stored) {
  if (!isObject(line)) return [];
  const found = new Set();
  Object.keys(line).forEach((key) => {
    if (!costView.isMoneyKey(key)) return deepMoneyKeys(line[key], found);
    if (key === 'price' && (line.price === null || samePrice(line.price, stored))) return;
    found.add(key);
  });
  return Array.from(found);
}
/** the prepared edit's line with the stored price carried when the client sent none (undefined or null) — re-cleaned by lib/amend clean, the one place a line's total is computed */
function priceCarried(item, sentEdits, stored) {
  if (item.line === null || item.line.price !== undefined || !stored || stored.price == null) return item.line;
  return amend.clean(Object.assign({}, sentEdits.line, { price: stored.price }));
}
/**
 * insideDoor(db, shopId, chitId, prepared, sentEdits, door) → prepared — the amend door for a blind actor, run INSIDE amend.record's transaction (its `inside` step), before anything
 * is written: the side and the stored lines are read on this connection under FOR UPDATE; a sale leaves the edits as they are; on a cost side every edit is judged against its
 * stored line (a money key it would set or change → ONE 403 naming every such key across the batch, the transaction ends with nothing written), else each omitted price is
 * carried in place and door.hide says the answer is to be pruned.
 */
async function insideDoor(db, shopId, chitId, prepared, sentEdits, door) {
  if ((await sideOf(db, shopId, chitId)) === 'sell') return prepared;
  const locked = await lockedLines(db, shopId, chitId, prepared);
  const stored = prepared.map((item) => storedFor(locked, item));
  const blocked = new Set();
  prepared.forEach((item, position) => moneyKeysOf(sentEdits[position].line, stored[position]).forEach((key) => blocked.add(key)));
  if (blocked.size) throw costBlindRefusal(Array.from(blocked), AMEND_MAY);
  prepared.forEach((item, position) => {
    item.line = priceCarried(item, sentEdits[position], stored[position]);
  });
  door.hide = true;
  return prepared;
}
/** the amendments as a blind actor on a cost-side chit reads them back: lib/cost-view's own spec for amendments[] (the line by LINE_KEEP, no typed reason) — on a COPY */
function hideAmendments(out) {
  const copy = structuredClone(out);
  cost.dropCostKeys(copy);
  costView.prune(copy.amendments, costView.ANSWER_KEEP.amendments);
  return copy;
}
/**
 * recordAmend(req, shopId, chitId, edits, writer) → amend.record's answer — the door and the record in one call, so the route's line stays one line. For the owner, a
 * cost-allowed actor and an empty batch this IS amend.record (its answer byte for byte); a blind actor's record runs with insideDoor as its inside step, and a thrown refusal
 * (status 403 or 400, nothing written) reaches the route's faultOf.
 */
async function recordAmend(req, shopId, chitId, edits, writer) {
  const sentEdits = (Array.isArray(edits) ? edits : [edits]).filter(Boolean);
  if (!sentEdits.length || !(await cost.isCostBlind(req, shopId))) return amend.record(shopId, chitId, edits, writer);
  const door = { hide: false };
  const out = await amend.record(shopId, chitId, sentEdits, writer, (db, prepared) => insideDoor(db, shopId, chitId, prepared, sentEdits, door));
  return door.hide ? hideAmendments(out) : out;
}
/**
 * repriceOpts(req, shopId, chitId, opts) → opts — the reprice door: a reprice sets prices by definition (and its preview computes and answers them), so a cost-blind
 * co-assist is refused on any chit that is not positively the shop's sale; the owner, a cost-allowed actor and a sales chit pass with the options untouched.
 */
async function repriceOpts(req, shopId, chitId, opts) {
  if (!(await cost.isCostBlind(req, shopId))) return opts;
  if ((await withEntity(shopId, (db) => sideOf(db, shopId, chitId))) === 'sell') return opts;
  throw costBlindRefusal(['price'], REPRICE_MAY);
}

module.exports = { sideOf, lockedLines, storedFor, moneyKeysOf, priceCarried, insideDoor, recordAmend, repriceOpts, hideAmendments, SIDE_SQL, LINES_FOR_UPDATE, DETAIL_FOR_UPDATE };
