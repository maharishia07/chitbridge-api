'use strict';
// lib/cost-view.js — what a cost-blind co-assist may READ of a chit (RAIL-146). Answer-side only: the stored copy, its sealed body and the digest are never touched.
//
// OWNS      costSideOf (buy · sell · unknown: folder-inventory.docOf, then the counterparty's party role) · counterpartyOf · sideColsSql (the two columns a list selects)
//           · rolesFor (ONE party-role read per page) · bundleExtras (the chit read's role and delivery rows) · chitAnswer / hideChitCosts (the GET /:chit_id answer)
//           · listRows / hideRowCosts (a list row) · rollupGroup · rollupMembersSql · rollupRoles (a /rollup group) · PRICE_KEYS · HEADER_MONEY_KEYS · BJ_MONEY_KEYS
// CALLED BY routes/chits.js — GET /:chit_id · /inbox · /folder · /sent · /rollup; `blind` is lib/cost isCostBlind, read ONCE per request (the owner pays no read)
// FLOW      blind? ──▶ side = costSideOf(copy, shop, role) ──▶ structuredClone(answer) ──▶ half (i): cost.dropCostKeys on EVERY chit (a cost-named key is never sales data)
//           ──▶ half (ii): price · total · the header money hide unless the side is 'sell' (unknown fails closed) ──▶ cost_hidden:true, the field the client branches on
// CARD      01-rail-core-the-chit/chits-routes
//
// ⚠️ WHY TWO HALVES. business_json.side is written by nobody yet (lib/workflow.js:24 only documents it), so an order's side is resolved by WHO the counterparty is
// on the shop's own lists (lib/books-store partiesOn): a supplier means the shop buys, a customer means it sells, anything else is unknown and hides. The cost-named
// keys need no side at all, so they go first and always. Athi, 2026-08-12: "the permission is about READING AT ALL" (lib/cost.js header).
const cost = require('./cost');
const folderInventory = require('./folder-inventory');
const booksStore = require('./books-store');
const { round: roundMoney } = require('./money');

const ORDERISH = ['order', 'offer', 'subscription'];
/** the priced keys of ONE LINE that hide on a cost-side chit (a rate — gst_rate, cess_rate — is not a price and stays) */
const PRICE_KEYS = ['price', 'total', 'list_price', 'discount', 'offer', 'taxable', 'tax', 'rate', 'value', 'amount'];
/** the summary_json keys that ARE the purchase amount */
const HEADER_MONEY_KEYS = ['money', 'total_value', 'offers'];
/** the business_json keys that carry it on a bill or a receipt (the frozen invoice, the till's receipt figures) */
const BJ_MONEY_KEYS = ['invoice', 'costs', 'goods', 'extras', 'input_tax'];
const PAYMENT_KEYS = ['paid', 'due', 'change', 'amount'];
const isObject = (value) => !!value && typeof value === 'object';

/** the OTHER party of a copy: its sender when that is not the shop, else the first recipient that is not the shop; null for a self chit */
function counterpartyOf(copy, shopId) {
  const mine = String(shopId);
  const sender = copy && copy.sender_entity_id ? String(copy.sender_entity_id) : null;
  if (sender && sender !== mine) return sender;
  const recipients = copy && Array.isArray(copy.all_recipients) ? copy.all_recipients : [];
  const other = recipients.find((recipient) => recipient && recipient.entity_id && String(recipient.entity_id) !== mine);
  return other ? String(other.entity_id) : null;
}
/** an order-ish chit's side: the declared business_json.side wins; else the counterparty's role on the shop's lists; else unknown */
function orderSide(businessJson, role) {
  const said = typeof businessJson.side === 'string' ? businessJson.side.toLowerCase() : null;
  if (said === 'buy' || said === 'sell') return said;
  if (!role) return 'unknown';
  if (role.supplier && !role.customer) return 'buy';
  if (role.customer && !role.supplier) return 'sell';
  return 'unknown';
}
/** the side a DOCUMENT kind decides on its own (folder-inventory docOf); null when the kind does not decide it */
function documentSide(doc, purpose, sentByMe) {
  if (doc === 'bill_received' || doc === 'expense') return 'buy';
  if (doc === 'bill_issued') return 'sell';
  if (doc === 'return') return sentByMe ? 'sell' : 'buy';
  if (doc === 'receipt') return purpose === 'receipt' ? 'buy' : 'sell'; /* the counter's goods receipt · a payment received */
  return null;
}
/** the shop's own spend, whatever the direction: a payment it made, stock taken to its own use */
const isOwnSpend = (purpose, businessJson) => businessJson.kind === 'payment_made' || purpose === 'own_use';
/** a despatch note: the goods left the seller — the seller's copy sells, the receiver's buys */
const isDespatch = (purpose, businessJson) => purpose === 'delivery_note' || businessJson.doc === 'despatch';
const businessJsonOf = (chit) => (isObject(chit.business_json) ? chit.business_json : {});
const sentByShop = (chit, shopId) => !!chit.sender_entity_id && String(chit.sender_entity_id) === String(shopId);
/**
 * costSideOf(copy, shopId, role) → 'buy' | 'sell' | 'unknown' — is this copy the reading shop's COST side?
 * copy: { purpose, sender_entity_id, all_recipients, business_json } (a chit_header row, or a list row's side columns); role: the counterparty's { customer, supplier }, or null.
 * The document kinds come from the ONE classification (folder-inventory docOf); only an order-ish chit needs the party role.
 */
function costSideOf(copy, shopId, role) {
  const chit = copy || {};
  const businessJson = businessJsonOf(chit);
  const purpose = String(chit.purpose || '');
  const sentByMe = sentByShop(chit, shopId);
  const byDocument = documentSide(folderInventory.docOf(chit, shopId), purpose, sentByMe);
  if (byDocument) return byDocument;
  if (isOwnSpend(purpose, businessJson)) return 'buy';
  if (ORDERISH.includes(purpose)) return orderSide(businessJson, role);
  if (isDespatch(purpose, businessJson)) return sentByMe ? 'sell' : 'buy';
  return 'sell';
}

/** the few business_json keys docOf and orderSide read, as one small jsonb (never the whole document: a frozen invoice is large) */
const smallBusinessJsonSql = (alias) =>
  `jsonb_build_object('side', ${alias}.business_json->'side', 'doc', ${alias}.business_json->'doc', 'kind', ${alias}.business_json->'kind', 'bill_no', ${alias}.business_json->'bill_no', ` +
  `'till', jsonb_build_object('id', ${alias}.business_json->'till'->'id'), 'their_bill', ${alias}.business_json->'their_bill')`;
/** the two columns a list SELECT adds for the side (never on the wire: the S34 row mappers leave them out): the sender, and the small business_json */
const sideColsSql = (alias) => `${alias}.sender_entity_id AS _sender, ${smallBusinessJsonSql(alias)} AS _bj`;
/** a list row (with sideColsSql's columns) as costSideOf reads it */
const copyOfRow = (rawRow) => ({ purpose: rawRow.purpose, sender_entity_id: rawRow._sender, all_recipients: rawRow.all_recipients, business_json: rawRow._bj });
/** ONE party-role read for a page of rows → Map(counterparty id → { customer, supplier }); null when the reader is not blind (no read at all) */
async function rolesFor(db, shopId, rawRows, blind) {
  if (!blind) return null;
  const ids = (rawRows || []).map((rawRow) => counterpartyOf(copyOfRow(rawRow), shopId)).filter(Boolean);
  return booksStore.partiesOn(db, shopId, ids);
}
/** the role of ONE copy's counterparty out of a roles map; null when unknown */
function roleOf(copy, shopId, roles) {
  const party = counterpartyOf(copy, shopId);
  return party && roles ? roles.get(party) || null : null;
}

/** half (i) on any value: the cost-named keys gone at any depth; true when one was there */
function dropNamed(value) {
  const hadNamed = cost.costKeysIn(value).length > 0;
  cost.dropCostKeys(value);
  return hadNamed;
}
/**
 * hideRowCosts(row, side) → a COPY of a list row as a blind actor may read it: cost-named keys gone; on a cost side (buy or unknown) the summary's money too;
 * cost_hidden:true whenever anything was taken. A 'sell' row with nothing named is returned as it was.
 */
function hideRowCosts(row, side) {
  const out = structuredClone(row);
  const hadNamed = dropNamed(out);
  const priced = side !== 'sell' && isObject(out.summary_json);
  if (priced) HEADER_MONEY_KEYS.forEach((key) => delete out.summary_json[key]);
  if (hadNamed || side !== 'sell') out.cost_hidden = true;
  return out;
}
/** the rows of a list as the caller may read them: a blind actor's through hideRowCosts (each row's side from the page's roles); everyone else's the mapper's, untouched */
function listRows(rawRows, mapper, view) {
  if (!view.blind) return rawRows.map(mapper);
  return rawRows.map((rawRow) => {
    const copy = copyOfRow(rawRow);
    return hideRowCosts(mapper(rawRow), costSideOf(copy, view.shopId, roleOf(copy, view.shopId, view.roles)));
  });
}

/** every line-shaped object of a chit answer: the delivered payload, the live set (now · original · history), the amendments' lines */
function linesOf(out) {
  const found = [];
  const collect = (line) => isObject(line) && found.push(line);
  ((out.detail && out.detail.line_items) || []).forEach(collect);
  (out.live_set || []).forEach((entry) => {
    collect(entry.live);
    collect(entry.original);
    (entry.history || []).forEach(collect);
  });
  (out.amendments || []).forEach((amendment) => collect(amendment.line));
  return found;
}
/** a payment's amounts gone (paid · due · change · amount, and each part's amount); the mode and the parts' kinds stay */
function hidePaymentMoney(payment) {
  PAYMENT_KEYS.forEach((key) => delete payment[key]);
  (Array.isArray(payment.parts) ? payment.parts : []).forEach((part) => isObject(part) && delete part.amount);
}
/** the header's money gone: summary_json money · total_value · offers; the frozen invoice and the receipt's figures; their bill's total (its number stays); a payment's amounts */
function hideHeaderMoney(header) {
  if (!isObject(header)) return;
  delete header.total_value;
  if (isObject(header.summary_json)) HEADER_MONEY_KEYS.forEach((key) => delete header.summary_json[key]);
  const businessJson = header.business_json;
  if (!isObject(businessJson)) return;
  BJ_MONEY_KEYS.forEach((key) => delete businessJson[key]);
  if (isObject(businessJson.their_bill)) delete businessJson.their_bill.total;
  if (isObject(businessJson.payment)) hidePaymentMoney(businessJson.payment);
}
/** the delivery ids THIS actor recorded (the one-shot's delivery rows carry recorded_by_actor_id); no rows means none are his */
function mineDeliveries(deliveryRows, actorId) {
  const mine = new Set();
  (deliveryRows || []).forEach((row) => row && row.delivery_id && String(row.recorded_by_actor_id || '') === String(actorId) && mine.add(String(row.delivery_id)));
  return mine;
}
/** ONE line's delivery money: the actor's own `add` amounts stay and are summed; every other amount goes; true when `charged` was exactly his own sum and stays */
function hideLineDeliveryMoney(entry, mine) {
  const added = Array.isArray(entry.added) ? entry.added : [];
  let ownSum = 0;
  added.forEach((addition) => {
    if (!addition || addition.amount == null) return;
    if (mine.has(String(addition.delivery_id))) ownSum += Number(addition.amount) || 0;
    else delete addition.amount;
  });
  if (entry.charged == null || roundMoney(ownSum) === roundMoney(Number(entry.charged) || 0)) return true;
  delete entry.charged; /* deliverline sums EVERY event's amount: a figure above his own holds somebody else's money */
  return false;
}
/** the money on the deliveries: "rows they entered themselves" stay (lib/cost.js); the chit's `delivery_summary.charged` stays only when every line's did */
function hideDeliveryMoney(out, mine) {
  if (!isObject(out.line_delivery)) return;
  const allMine = Object.values(out.line_delivery).map((entry) => hideLineDeliveryMoney(entry, mine)).every(Boolean);
  if (!allMine && isObject(out.delivery_summary)) delete out.delivery_summary.charged;
}
/**
 * hideChitCosts(answer, { side, mine }) → a COPY of the GET /:chit_id answer as a blind actor may read it. Called LAST, after the rail's actions and docOf read the
 * real header; the answer object given is never changed (structuredClone), nor is any row behind it. side: costSideOf; mine: mineDeliveries.
 */
function hideChitCosts(answer, options) {
  const out = structuredClone(answer);
  dropNamed(out);
  if (options.side !== 'sell') {
    linesOf(out).forEach((line) => PRICE_KEYS.forEach((key) => delete line[key]));
    hideHeaderMoney(out.header);
    if (isObject(out.detail)) delete out.detail.total_value;
    hideDeliveryMoney(out, options.mine || new Set());
  }
  out.cost_hidden = true;
  return out;
}
/**
 * bundleExtras(db, blind, shopId, header, deliveryRows) → what the chit read's bundle carries for a blind actor: the counterparty's role (one statement, the same
 * transaction; a failed read is unknown = hidden) and the one-shot's delivery rows (whose adds are his own). Empty for everyone else: no read, no keys.
 */
async function bundleExtras(db, blind, shopId, header, deliveryRows) {
  if (!blind) return {};
  const party = counterpartyOf(header, shopId);
  let role = null;
  try {
    role = party ? (await booksStore.partiesOn(db, shopId, [party])).get(party) || null : null;
  } catch (failure) {
    require('./logger').fellBack('cost-view: the party-role read failed — the side is unknown and the cost hidden', failure);
  }
  return { party: role, deliveryRows: deliveryRows || null };
}
/** the GET /:chit_id answer for its reader: the literal itself for the owner and a cost-allowed actor; a blind actor's copy through hideChitCosts */
function chitAnswer(answer, blind, header, shopId, bundle, actorId) {
  if (!blind) return answer;
  return hideChitCosts(answer, { side: costSideOf(header, shopId, bundle.party), mine: mineDeliveries(bundle.deliveryRows, actorId) });
}

/** the json_agg a blind actor's /rollup selects beside its sum: what costSideOf needs of each member, nothing more; '' for everyone else */
function rollupMembersSql(alias, blind) {
  if (!blind) return '';
  return (
    `, json_agg(json_build_object('total_value', ${alias}.summary_json->>'total_value', 'purpose', ${alias}.purpose, 'sender_entity_id', ${alias}.sender_entity_id, ` +
    `'all_recipients', ${alias}.all_recipients, 'business_json', ${smallBusinessJsonSql(alias)})) AS members`
  );
}
/** the roles of every member of every rollup group, one read; null when the reader is not blind */
async function rollupRoles(db, shopId, groups, blind) {
  if (!blind) return null;
  const ids = [];
  (groups || []).forEach((group) => (Array.isArray(group.members) ? group.members : []).forEach((member) => ids.push(counterpartyOf(member, shopId))));
  return booksStore.partiesOn(db, shopId, ids.filter(Boolean));
}
/**
 * rollupGroup(group, shopId, roles) → a /rollup group for a blind actor: the chit count stays, the sum leaves out every cost-side member, and cost_hidden:true says
 * when it did. `group.members` is rollupMembersSql's json_agg ({ total_value, purpose, sender_entity_id, all_recipients, business_json } per copy).
 */
function rollupGroup(group, shopId, roles) {
  const members = Array.isArray(group.members) ? group.members : [];
  const kept = members.filter((member) => costSideOf(member, shopId, roleOf(member, shopId, roles)) === 'sell');
  const sum = roundMoney(kept.reduce((total, member) => total + (Number(member.total_value) || 0), 0));
  const out = { key: group.key, chits: group.chits, total_value: sum.toFixed(2) }; /* as the statement's SUM(numeric) arrives: text, two places */
  if (kept.length < members.length) out.cost_hidden = true;
  return out;
}
/** a /rollup group for its reader: the statement's three columns, or a blind actor's rollupGroup */
const rollupGroups = (rows, blind, shopId, roles) => rows.map((row) => (blind ? rollupGroup(row, shopId, roles) : { key: row.key, chits: row.chits, total_value: row.total_value }));

module.exports = { costSideOf, counterpartyOf, sideColsSql, rolesFor, listRows, hideRowCosts, hideChitCosts, bundleExtras, chitAnswer, mineDeliveries, rollupGroup, rollupGroups, rollupMembersSql, rollupRoles, PRICE_KEYS, HEADER_MONEY_KEYS, BJ_MONEY_KEYS };
