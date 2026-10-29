'use strict';
// lib/cost-view.js — what a cost-blind co-assist may READ of a chit (RAIL-146). Answer-side only: the stored copy, its sealed body and the digest are never touched.
//
// OWNS      costSideOf (buy · sell · unknown: folder-inventory.docOf, then the counterparty's role on the READER's own lists; unknown hides) · counterpartyOf
//           · isMoneyKey / dropMoneyKeys (the rule: every money-bearing key, at any depth) · LINE_KEEP (what a blind receiver keeps of a line) · sideColsSql (the two
//           columns a blind reader's list selects) · rolesFor (ONE party-role read per page) · moneyParams (the amount filters and sort a blind reader may not use)
//           · bundleExtras · chitAnswer / hideChitCosts (GET /:chit_id) · listRows / hideRowCosts (a list row) · rollupGroups / rollupMembersSql / rollupRoles (/rollup)
// CALLED BY routes/chits.js — GET /:chit_id · /inbox · /folder · /sent · /rollup; `blind` is lib/cost isCostBlind, read ONCE per request (the owner pays no read)
// FLOW      blind? ──▶ side = costSideOf(copy, shop, role) ──▶ structuredClone(answer) ──▶ half (i): cost.dropCostKeys on EVERY chit (a cost-named key is never sales data)
//           ──▶ half (ii), unless the side is POSITIVELY 'sell': a line keeps LINE_KEEP, the header and the detail lose every money key, the deliveries keep the actor's
//           own adds ──▶ cost_hidden:true ONLY when half (ii) withheld money — the field the client branches on
// CARD      01-rail-core-the-chit/chits-routes
//
// ⚠️ FAIL CLOSED. business_json.side is written by the SENDER (lib/workflow.js:24 documents it; a supplier's "sell" must not unhide its bill for the receiver), so the
// side is read from the reader's own view: the document kind (docOf) and the counterparty's role on the reader's lists (lib/books-store partiesOn). A chit is sales-side
// only when that view says so; service, inquiry, resale, general, a chit with no sender, an order to a party on no list — all hide. Athi, 2026-08-12: "the permission is
// about READING AT ALL" (lib/cost.js header).
const cost = require('./cost');
const folderInventory = require('./folder-inventory');
const booksStore = require('./books-store');
const { round: roundMoney } = require('./money');
const log = require('./logger');

const ORDERISH = ['order', 'offer', 'subscription'];
/** purposes that are the shop's SALE whoever holds the copy (money in) */
const KNOWN_SELL = ['income'];
/** what a blind receiver keeps of a LINE on a cost-side chit: what it is, how much, its rates and codes — never a figure of money (an allowlist, so a new money key cannot slip in) */
const LINE_KEEP = new Set([
  'line_id', 'seq', 'particulars', 'name', 'product', 'quantity', 'qty', 'unit', 'unit_size', 'gst_rate', 'cess_rate', 'tax_name', 'tax_scheme', 'tax_slab_name', 'tax_source',
  'hsn', 'sku', 'code', 'item_id', 'comment', 'asked_as', 'asked_unit', 'raw_phrase', 'removed', 'removed_reason', 'needs_human', 'flags', 'item_data', 'trace', 'lot', 'batch',
  'expiry', 'serial', 'kind'
]);
/** the money-bearing key names (the rule for headers, summaries, item_data and a list row: a denylist by WORD, at any depth, because business_json is open-ended) */
const MONEY_WORDS = new Set([
  'price', 'total', 'amount', 'net', 'gross', 'tax', 'taxable', 'cgst', 'sgst', 'igst', 'cess', 'mrp', 'rate', 'discount', 'value', 'paid', 'due', 'change', 'subtotal',
  'savings', 'charged', 'offers', 'offer', 'money', 'invoice', 'costs', 'goods', 'extras', 'input_tax', 'landed_total', 'unit_price', 'list_price', 'line_total', 'round_off',
  'balance', 'advance', 'total_value', 'invoiced', 'spent', 'margin', 'margin_pct'
]);
const MONEY_SUFFIX = /_(minor|amount|total|price|value|paid|due|tax|taxable|discount)$/;
const ROLLUP_MEMBER_CAP = 200;
const isObject = (value) => !!value && typeof value === 'object';
/** is this key money, or a cost? a rate (gst_rate), a name (tax_name) and a count (line_item_count) are not */
const isMoneyKey = (key) => {
  const word = String(key).toLowerCase();
  return MONEY_WORDS.has(word) || MONEY_SUFFIX.test(word) || cost.isCostKey(key);
};
/** every money or cost key gone at ANY depth, in place (the header's summary and business data, a line's item_data, a list row's summary) */
function dropMoneyKeys(value) {
  if (!isObject(value)) return value;
  Object.keys(value).forEach((key) => {
    if (isMoneyKey(key)) delete value[key];
    else dropMoneyKeys(value[key]);
  });
  return value;
}
/** a line as a blind receiver may read it: LINE_KEEP only, and its item_data without money or cost */
function keepLine(line) {
  Object.keys(line).forEach((key) => {
    if (!LINE_KEEP.has(key)) delete line[key];
  });
  dropMoneyKeys(line.item_data);
}

/** the OTHER party of a copy: its sender when that is not the shop, else the first recipient that is not the shop; null for a self chit */
function counterpartyOf(copy, shopId) {
  const mine = String(shopId);
  const sender = copy && copy.sender_entity_id ? String(copy.sender_entity_id) : null;
  if (sender && sender !== mine) return sender;
  const recipients = copy && Array.isArray(copy.all_recipients) ? copy.all_recipients : [];
  const other = recipients.find((recipient) => recipient && recipient.entity_id && String(recipient.entity_id) !== mine);
  return other ? String(other.entity_id) : null;
}
/** the counterparty's role, as the READER's lists say: 'customer' (on the customer list only), 'supplier' (on the supplier list), or null (neither, both, or no counterparty) */
function roleWord(role) {
  if (!role) return null;
  if (role.supplier) return 'supplier';
  return role.customer ? 'customer' : null;
}
/** an order-ish chit's side: a sender-declared 'buy' can only hide more; a declared 'sell' is ignored (the sender wrote it); else the reader's own lists; else unknown */
function orderSide(businessJson, role) {
  if (typeof businessJson.side === 'string' && businessJson.side.toLowerCase() === 'buy') return 'buy';
  const word = roleWord(role);
  return word === 'supplier' ? 'buy' : word === 'customer' ? 'sell' : 'unknown';
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
 * costSideOf(copy, shopId, role) → 'buy' | 'sell' | 'unknown' — is this copy the reading shop's COST side? Anything not POSITIVELY a sale is unknown, and unknown hides.
 * copy: { purpose, sender_entity_id, all_recipients, business_json } (a chit_header row, or a list row's side columns); role: the counterparty's { customer, supplier } on
 * the READER's lists, or null. Sales-side: a document kind that says so (a bill I issued, a payment received, a return I issued), a known sell purpose (income), my own
 * despatch, or a chit I SENT to a party on my customer list only. A sent order to a party on the customer list only IS a sale by the shop's own lists: a PO to such a
 * party is a mis-listed party, and the fix is the list.
 */
function costSideOf(copy, shopId, role) {
  const chit = copy || {};
  const businessJson = businessJsonOf(chit);
  const purpose = String(chit.purpose || '');
  const sentByMe = sentByShop(chit, shopId);
  const byDocument = documentSide(folderInventory.docOf(chit, shopId), purpose, sentByMe);
  if (byDocument) return byDocument;
  if (isOwnSpend(purpose, businessJson)) return 'buy';
  if (isDespatch(purpose, businessJson)) return sentByMe ? 'sell' : 'buy';
  if (ORDERISH.includes(purpose)) return orderSide(businessJson, role);
  return otherSide(purpose, sentByMe, role);
}
/** any other purpose: a known sell purpose, or a chit I sent to a party on my customer list only, is a sale; everything else is unknown (hidden) */
function otherSide(purpose, sentByMe, role) {
  if (KNOWN_SELL.includes(purpose)) return 'sell';
  return sentByMe && roleWord(role) === 'customer' ? 'sell' : 'unknown';
}
/** `cost_params_ignored` for the answer: the names, or nothing at all when nothing was asked (undefined is left out of the JSON) */
const ignoredField = (ignored) => (ignored.length ? ignored : undefined);

/** the few business_json keys docOf and orderSide read, as one small jsonb (never the whole document: a frozen invoice is large) */
const smallBusinessJsonSql = (alias) =>
  `jsonb_build_object('side', ${alias}.business_json->'side', 'doc', ${alias}.business_json->'doc', 'kind', ${alias}.business_json->'kind', 'bill_no', ${alias}.business_json->'bill_no', ` +
  `'till', jsonb_build_object('id', ${alias}.business_json->'till'->'id'), 'their_bill', ${alias}.business_json->'their_bill')`;
/** the two columns a BLIND reader's list SELECT adds for the side (never on the wire: the S34 row mappers leave them out); '' for everyone else, so the owner's statement is as it was */
const sideColsSql = (alias, blind) => (blind ? `, ${alias}.sender_entity_id AS _sender, ${smallBusinessJsonSql(alias)} AS _bj` : '');
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
/**
 * moneyParams(req, blind) → the list params a blind reader may not use, taken OFF req.query (amount_min, amount_max, sort=amount — a filter or an order over the hidden
 * total would let a reader search for it); [] for everyone else. The route names them back in `cost_params_ignored` so the client knows its ask was not honoured.
 */
function moneyParams(req, blind) {
  if (!blind) return [];
  const ignored = [];
  ['amount_min', 'amount_max'].forEach((name) => {
    if (req.query[name] === undefined) return;
    delete req.query[name];
    ignored.push(name);
  });
  if (req.query.sort === 'amount') {
    delete req.query.sort;
    ignored.push('sort');
  }
  return ignored;
}

/**
 * hideRowCosts(row, side) → a COPY of a list row as a blind actor may read it: cost-named keys gone on any side; on a cost side (buy or unknown) every money key of the
 * summary too, and cost_hidden:true says money was withheld. A 'sell' row says nothing (a cost-named key is not the row's money).
 */
function hideRowCosts(row, side) {
  const out = structuredClone(row);
  cost.dropCostKeys(out);
  if (side === 'sell') return out;
  dropMoneyKeys(out.summary_json);
  out.cost_hidden = true;
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
/** ONE line's delivery money: the actor's own `add` amounts (deliverline added[].by_id) stay and are summed; every other amount goes; true when `charged` was exactly his own sum and stays */
function hideLineDeliveryMoney(entry, actorId) {
  const added = Array.isArray(entry.added) ? entry.added : [];
  let ownSum = 0;
  added.forEach((addition) => {
    if (!addition || addition.amount == null) return;
    if (addition.by_id && String(addition.by_id) === String(actorId)) ownSum += Number(addition.amount) || 0;
    else delete addition.amount;
  });
  if (entry.charged == null || roundMoney(ownSum) === roundMoney(Number(entry.charged) || 0)) return true;
  delete entry.charged; /* deliverline sums EVERY event's amount: a figure above his own holds somebody else's money */
  return false;
}
/** the money on the deliveries: "rows they entered themselves" stay (lib/cost.js); the chit's `delivery_summary.charged` stays only when every line's did */
function hideDeliveryMoney(out, actorId) {
  if (!isObject(out.line_delivery)) return;
  const allMine = Object.values(out.line_delivery).map((entry) => hideLineDeliveryMoney(entry, actorId)).every(Boolean);
  if (!allMine && isObject(out.delivery_summary)) delete out.delivery_summary.charged;
}
/**
 * hideChitCosts(answer, { side, actorId }) → a COPY of the GET /:chit_id answer as a blind actor may read it. Called LAST, after the rail's actions and docOf read the
 * real header; the answer object given is never changed (structuredClone), nor is any row behind it. cost_hidden:true only when money was withheld (not a 'sell').
 */
function hideChitCosts(answer, options) {
  const out = structuredClone(answer);
  cost.dropCostKeys(out);
  if (options.side === 'sell') return out;
  linesOf(out).forEach(keepLine);
  if (isObject(out.header)) {
    delete out.header.total_value;
    dropMoneyKeys(out.header.summary_json);
    dropMoneyKeys(out.header.business_json);
  }
  if (isObject(out.detail)) delete out.detail.total_value;
  hideDeliveryMoney(out, options.actorId);
  out.cost_hidden = true;
  return out;
}
/** what the chit read's bundle carries for a blind actor: the counterparty's role (one statement, the same transaction; a failed read is unknown = hidden). {} for everyone else */
async function bundleExtras(db, blind, shopId, header) {
  if (!blind) return {};
  const party = counterpartyOf(header, shopId);
  let role = null;
  try {
    role = party ? (await booksStore.partiesOn(db, shopId, [party])).get(party) || null : null;
  } catch (failure) {
    log.fellBack('cost-view: the party-role read failed — the side is unknown and the cost hidden', failure);
  }
  return { party: role };
}
/** the GET /:chit_id answer for its reader: the literal itself for the owner and a cost-allowed actor; a blind actor's copy through hideChitCosts */
function chitAnswer(answer, blind, header, shopId, bundle, actorId) {
  if (!blind) return answer;
  return hideChitCosts(answer, { side: costSideOf(header, shopId, bundle.party), actorId });
}

/** the members a blind actor's /rollup selects beside its sum, CAPPED on the wire (ROLLUP_MEMBER_CAP + 1: one more says the group is too big to sum honestly); '' for everyone else */
function rollupMembersSql(alias, blind) {
  if (!blind) return '';
  return (
    `, (array_agg(json_build_object('total_value', ${alias}.summary_json->>'total_value', 'purpose', ${alias}.purpose, 'sender_entity_id', ${alias}.sender_entity_id, ` +
    `'all_recipients', ${alias}.all_recipients, 'business_json', ${smallBusinessJsonSql(alias)})))[1:${ROLLUP_MEMBER_CAP + 1}] AS members`
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
 * rollupGroup(group, shopId, roles) → a /rollup group for a blind actor: the chit count stays; the sum keeps the sales-side members only and cost_hidden:true says when
 * it left some out; a group above ROLLUP_MEMBER_CAP members answers total_value null (no plausible wrong number) and cost_hidden:true.
 */
function rollupGroup(group, shopId, roles) {
  const members = Array.isArray(group.members) ? group.members : [];
  if (members.length > ROLLUP_MEMBER_CAP) return { key: group.key, chits: group.chits, total_value: null, cost_hidden: true };
  const kept = members.filter((member) => costSideOf(member, shopId, roleOf(member, shopId, roles)) === 'sell');
  const sum = roundMoney(kept.reduce((total, member) => total + (Number(member.total_value) || 0), 0));
  const out = { key: group.key, chits: group.chits, total_value: sum.toFixed(2) }; /* as the statement's SUM(numeric) arrives: text, two places */
  if (kept.length < members.length) out.cost_hidden = true;
  return out;
}
/** a /rollup group for its reader: the statement's three columns, or a blind actor's rollupGroup */
const rollupGroups = (rows, blind, shopId, roles) => rows.map((row) => (blind ? rollupGroup(row, shopId, roles) : { key: row.key, chits: row.chits, total_value: row.total_value }));

module.exports = {
  costSideOf, counterpartyOf, isMoneyKey, dropMoneyKeys, LINE_KEEP, sideColsSql, rolesFor, moneyParams, ignoredField, listRows, hideRowCosts, hideChitCosts, bundleExtras, chitAnswer,
  rollupGroup, rollupGroups, rollupMembersSql, rollupRoles, ROLLUP_MEMBER_CAP
};
