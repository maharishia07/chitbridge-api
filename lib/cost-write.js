'use strict';
// lib/cost-write.js — what a cost-blind co-assist may WRITE on a chit (RAIL-147): the amend and reprice doors. Door-side only: nothing here writes a row.
//
// OWNS      doorFacts (the chit's side for the WRITING shop, lib/cost-view costSideOf over ONE small header read and ONE role read, plus the stored lines, one transaction)
//           · moneyKeysOf (the money keys ONE replacement line would SET or CHANGE against its STORED line) · carryStoredPrice (an omitted or null price KEEPS the stored one,
//           never erases it) · amendEdits (the amend door) · recordAmend (the door, the record, the answer's lines through lib/cost-view's own allowlist) · repriceOpts
// CALLED BY routes/chits.js — POST /:chit_id/amend (recordAmend in place of amend.record) · POST /:chit_id/reprice (repriceOpts); the refusal is the 403 COST_BLIND body of
//           lib/cost writeRefusal (the PATCH /products precedent: code · blocked = key names, never values), thrown as a refusal with its body — lib/chits-contract faultOf answers it
// FLOW      blind? (ONE can_see_costs read: the owner and a paired counter pay nothing) ──▶ side = costSideOf(header, shop, role) ──▶ 'sell': as today ──▶ else amend: per edit,
//           the money keys it would set or change against the stored line (a re-sent equal price is not a change; an omitted or null price is carried from the stored line)
//           ──▶ any → ONE 403 naming every such key, nothing written ──▶ none → amend.record, and the answer's lines pruned to LINE_KEEP; reprice: 403 (preview too — it
//           computes and answers prices by definition)
// CARD      01-rail-core-the-chit/chits-routes
//
// ⚠️ THE STORED LINE DECIDES, NEVER THE CLIENT. After RAIL-146 a blind reader never sees the price, so the amend screen re-sends a line WITHOUT one; before this file that
// wrote NULL over the supplier's rate (an amendment is a full replacement line, lib/amend writeLine) — #549's lesson in another coat. Here the omitted price is filled from
// the stored line before the library records the replacement, so a quantity or name correction by a blind actor keeps the figure he may not see. The side is the reader's own
// (RAIL-146): a sale stays as it was for him, anything not positively a sale is gated.
const cost = require('./cost');
const costView = require('./cost-view');
const amend = require('./amend');
const booksStore = require('./books-store');
const { withEntity } = require('../db');
const { round: roundMoney } = require('./money');
const log = require('./logger');

/** the header columns the side needs: small, never the whole business_json (a frozen invoice is large) */
const SIDE_SQL = `SELECT ch.purpose, ch.sender_entity_id, ch.all_recipients, ${costView.smallBusinessJsonSql('ch')} AS business_json FROM chit_header ch WHERE ch.chit_id = $1 AND ch.entity_id = $2`;
/** what a blind actor may still do on the line, said in the refusal */
const AMEND_MAY = 'You can change the item, the quantity and the unit';
const REPRICE_MAY = 'A reprice sets prices';
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

/**
 * doorFacts(shopId, chitId) → { side, byId } — the chit's side for the writing shop and its stored lines by line_id (lib/amend readLines; empty before chit_line),
 * read in ONE transaction. A failed read is { side: 'unknown', byId: empty }: unknown is gated, and with no stored line any price sent is a set.
 */
async function doorFacts(shopId, chitId) {
  try {
    return await withEntity(shopId, async (db) => {
      const header = (await db.query(SIDE_SQL, [chitId, shopId])).rows[0];
      const party = header ? costView.counterpartyOf(header, shopId) : null;
      const role = party ? (await booksStore.partiesOn(db, shopId, [party])).get(party) || null : null;
      const rows = (await amend.readLines(shopId, chitId, db)) || [];
      return { side: header ? costView.costSideOf(header, shopId, role) : 'unknown', byId: new Map(rows.map((row) => [String(row.line_id), row])) };
    });
  } catch (failure) {
    log.fellBack('cost-write: a blind writer\'s side read failed — the side is unknown and the door is shut to money', failure);
    return { side: 'unknown', byId: new Map() };
  }
}
/** the stored line an edit addresses, by its line_id; null when it names none or the row is not there */
const storedOf = (facts, edit) => (edit && edit.line_id ? facts.byId.get(String(edit.line_id)) || null : null);
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
 * moneyKeysOf(line, stored) → the money keys ONE replacement line would SET or CHANGE on a cost-side chit, named as sent: every money key at any depth (lib/cost-view
 * isMoneyKey: price, total, rate, discount, the cost names …), except a top-level `price` equal to the stored line's, and a null price (carried, §carryStoredPrice).
 * A removal (null) and a line with no money key answer []. Over-refusing a key the library would drop anyway is fine: the refusal says what was sent.
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
/** the edit with the stored price filled in when the client sent none (undefined or null): a COPY, the body is not changed; a removal and an edit with its own price pass as they are */
function carryStoredPrice(edit, stored) {
  if (!isObject(edit) || !isObject(edit.line) || edit.line.price != null || !stored || stored.price == null) return edit;
  return Object.assign({}, edit, { line: Object.assign({}, edit.line, { price: stored.price }) });
}
/**
 * amendEdits(req, shopId, chitId, edits) → { edits, hide } | { refused } — the amend door. The owner, a cost-allowed actor, an empty batch and a SALES chit answer the
 * edits exactly as given (hide false: the library's own answer, byte for byte as today). On a cost-side chit (buy or unknown, the reader's own view) every edit is judged
 * against its STORED line: a money key it would set or change → ONE refusal naming every such key across the batch, and nothing is written; otherwise each omitted price
 * is carried from the stored line and the answer is to be pruned (hide true).
 */
async function amendEdits(req, shopId, chitId, edits) {
  const list = (Array.isArray(edits) ? edits : [edits]).filter(Boolean);
  if (!list.length || !(await cost.isCostBlind(req, shopId))) return { edits, hide: false };
  const facts = await doorFacts(shopId, chitId);
  if (facts.side === 'sell') return { edits, hide: false };
  const blocked = new Set();
  list.forEach((edit) => moneyKeysOf(edit.line, storedOf(facts, edit)).forEach((key) => blocked.add(key)));
  if (blocked.size) return { refused: costBlindRefusal(Array.from(blocked), AMEND_MAY) };
  return { edits: list.map((edit) => carryStoredPrice(edit, storedOf(facts, edit))), hide: true };
}
/** the amendments as a blind actor on a cost-side chit reads them back: lib/cost-view's own spec for amendments[] (the line by LINE_KEEP, no typed reason) — on a COPY */
function hideAmendments(out) {
  const copy = structuredClone(out);
  cost.dropCostKeys(copy);
  costView.prune(copy.amendments, costView.ANSWER_KEEP.amendments);
  return copy;
}
/**
 * recordAmend(req, shopId, chitId, edits, writer) → amend.record's answer — the door and the record in one call, so the route's line stays one line. Throws the refusal
 * (status 403, refused, body) when the door is shut; the route's faultOf answers it in its own words. For everyone but a blind actor on a cost-side chit this IS amend.record.
 */
async function recordAmend(req, shopId, chitId, edits, writer) {
  const door = await amendEdits(req, shopId, chitId, edits);
  if (door.refused) throw door.refused;
  const out = await amend.record(shopId, chitId, door.edits, writer);
  return door.hide ? hideAmendments(out) : out;
}
/**
 * repriceOpts(req, shopId, chitId, opts) → opts — the reprice door: a reprice sets prices by definition (and its preview computes and answers them), so a cost-blind
 * co-assist is refused on any chit that is not positively the shop's sale; the owner, a cost-allowed actor and a sales chit pass with the options untouched.
 */
async function repriceOpts(req, shopId, chitId, opts) {
  if (!(await cost.isCostBlind(req, shopId))) return opts;
  if ((await doorFacts(shopId, chitId)).side === 'sell') return opts;
  throw costBlindRefusal(['price'], REPRICE_MAY);
}

module.exports = { doorFacts, moneyKeysOf, carryStoredPrice, amendEdits, recordAmend, repriceOpts, hideAmendments, SIDE_SQL };
