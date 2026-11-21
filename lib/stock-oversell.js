'use strict';
/**
 * lib/stock-oversell.js — SELLING MORE THAN THE SHELF SHOWS: allowed and flagged by default, refused before it posts when the shop's switch says so (OPS-121, 22 Nov 2026; WALK AZ AZ-F-01: 20 jugs billed against 5, stock -15, no word).
 *
 * OWNER     cb-operations
 * RISK      money
 * OWNS      shortOf (pure: the lines that take a product below what is on hand) · refusalOf (the one pre-send judgement) · wordsOf · CODE
 * CALLED BY lib/chits-send-bill.js sendOversell (a step of the send, after the line figures are read, before anything is stored)
 * FLOW      the chit's goods-out movements (stock-from-chit movementsFor: the SAME reading the post uses) → none, or an offline replay → null · the shop's switch (policy negative_stock) → allow → null · block → ONE read of the on-hand of those products (stock-store onHand) → shortOf → 409 STOCK_SHORT | null
 * CARD      13-inventory-stock-and-traceability/on-hand-and-movements
 *
 * ⚠️ ALLOW IS THE DEFAULT AND COSTS NOTHING ON THE SEND: the sale is stored and the stock posts after the answer as always; the figure that goes below zero is the flag (Stock "below zero", Home "N items below zero",
 *    the log line stock.oversold from sendStock). Only a sale with goods lines reads the switch (one identity row); only `block` reads the shelf (one balance read, filtered to the bill's own products).
 * ⚠️ AN OFFLINE REPLAY IS NEVER REFUSED (the till has already handed the goods over; the same 15 minute rule as the cash step, cash-step.replayOf): it posts and is flagged.
 * ⚠️ UNKNOWN IS NOT ZERO. A product the ledger never moved, and a dish made to order (not counted), have no figure here and are never refused (stock-store onHand answers them ABSENT).
 */
const fromChit = require('./stock-from-chit');
const store = require('./stock-store');
const cashStep = require('./cash-step');
const policy = require('./policy');

const CODE = 'STOCK_SHORT';
const qty3 = (n) => Math.round(n * 1000) / 1000;

/** the goods a chit takes OUT, one row per product (two lines of one product add up): [{ item_id, asked, line, name }] — the movements the post will make, read by the post's own reader */
function goodsOut(chit) {
  const by = new Map();
  const lines = chit.line_items || [];
  fromChit.movementsFor(chit).forEach((move) => {
    if (move.skip || move.reason !== 'sale') return;
    const row = by.get(move.item_id) || { item_id: move.item_id, asked: 0, line: lines.findIndex((one) => fromChit.itemIdOf(one) === move.item_id), name: move.note || null };
    row.asked = qty3(row.asked + move.qty);
    by.set(move.item_id, row);
  });
  return [...by.values()];
}

/** PURE: the products whose asked quantity is above a KNOWN on-hand → [{ item_id, name, line, asked, on_hand }]; `onHand` is stock-store onHand's answer ({ [item_id]: { qty } }), a product absent from it is unknown, never short */
function shortOf(goods, onHand) {
  return goods.filter((row) => onHand[row.item_id] && row.asked > onHand[row.item_id].qty).map((row) => ({ item_id: row.item_id, name: row.name, line: row.line, asked: row.asked, on_hand: onHand[row.item_id].qty }));
}

/** the shopkeeper's sentence for what is short (what happened, what it means, what to do) */
function wordsOf(found) {
  const one = found[0];
  const name = one.name ? '"' + one.name + '"' : 'a product';
  const first = name + ': ' + one.asked + ' on this bill, ' + (one.on_hand > 0 ? 'only ' + one.on_hand : 'none') + ' on the shelf.';
  const more = found.length > 1 ? ' ' + (found.length - 1) + ' more line' + (found.length > 2 ? 's are' : ' is') + ' short too.' : '';
  return first + more + ' Nothing was sent. Lower the quantity, or enter the goods you received first.';
}

/**
 * refusalOf(entity_id, chit, deps) → null | { status: 409, code: 'STOCK_SHORT', message, line, items }.
 * deps (a test stands in the reads): withEntity (required), now (ms), flagOf(entity_id) → 'allow' | 'block', onHand(entity_id, withEntity, opts).
 */
async function refusalOf(entity_id, chit, deps) {
  const goods = goodsOut(chit);
  if (!goods.length || cashStep.replayOf(chit.business_json, (deps.now || Date.now)())) return null;
  const switchOf = deps.flagOf || (async (id) => (await policy.get(id)).negative_stock);
  if ((await switchOf(entity_id)) !== 'block') return null;
  const onHand = await (deps.onHand || store.onHand)(entity_id, deps.withEntity, { items: goods.map((row) => row.item_id), counted_only: true });
  const found = shortOf(goods, onHand);
  return found.length ? { status: 409, code: CODE, line: found[0].line, message: 'Line ' + (found[0].line + 1) + ' ' + wordsOf(found), items: found } : null;
}

module.exports = { goodsOut, shortOf, wordsOf, refusalOf, CODE };
