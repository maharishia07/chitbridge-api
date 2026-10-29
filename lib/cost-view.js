'use strict';
// lib/cost-view.js — what a cost-blind co-assist may READ of a chit (RAIL-146). Answer-side only: the stored copy, its sealed body and the digest are never touched.
//
// OWNS      costSideOf (buy · sell · unknown — from the READER's own view only: the document kind, whether the reader sent it, the counterparty's role on the reader's
//           lists; unknown hides) · counterpartyOf · isMoneyKey / dropMoneyKeys (the rule: every money-bearing key, at any depth) · LINE_KEEP (what a blind receiver keeps
//           of a line) · sideColsSql (the two columns a blind reader's list selects) · rolesFor (ONE party-role read per page) · moneyParams (the amount filters and sort
//           a blind reader may not use, normalised the way the consumer reads them) · bundleExtras · chitAnswer / hideChitCosts (GET /:chit_id: a walk over EVERY
//           top-level key) · listRows / hideRowCosts (a list row) · rollupGroups / rollupMembersSql / rollupRoles (/rollup)
// CALLED BY routes/chits.js — GET /:chit_id · /inbox · /folder · /sent · /rollup; `blind` is lib/cost isCostBlind, read ONCE per request (the owner pays no read)
// FLOW      blind? ──▶ side = costSideOf(copy, shop, role) ──▶ structuredClone(answer) ──▶ half (i): cost.dropCostKeys on EVERY chit (a cost-named key is never sales data)
//           ──▶ half (ii), unless the side is POSITIVELY 'sell': every line keeps LINE_KEEP, every other top-level value loses every money key at any depth, the
//           deliveries keep the actor's own adds ──▶ cost_hidden:true ONLY when a money key was actually removed — the field the client branches on
// CARD      01-rail-core-the-chit/chits-routes
//
// ⚠️ FAIL CLOSED, FROM THE READER'S VIEW. purpose, business_json.kind and business_json.side are written by the SENDER (a supplier's "sell" or "payment_received" must not
// unhide its chit for the receiver), so a SELL verdict needs the reader to be the sender, or the counterparty to be on the reader's own customer list only (lib/books-store
// partiesOn). On a received copy nothing the sender wrote can make it a sale. Athi, 2026-08-12: "the permission is about READING AT ALL" (lib/cost.js header).
const cost = require('./cost');
const folderInventory = require('./folder-inventory');
const booksStore = require('./books-store');
const deliverline = require('./deliverline');
const { round: roundMoney } = require('./money');
const log = require('./logger');

/** purposes that are the shop's SALE when the shop SENT the chit (money in) */
const KNOWN_SELL = ['income'];
/** what a blind receiver keeps of a LINE on a cost-side chit: what it is, how much, its rates and codes — never a figure of money (an allowlist, so a new money key cannot slip in) */
const LINE_KEEP = new Set([
  'line_id', 'seq', 'particulars', 'name', 'product', 'quantity', 'qty', 'unit', 'unit_size', 'gst_rate', 'cess_rate', 'tax_name', 'tax_scheme', 'tax_slab_name', 'tax_source',
  'hsn', 'sku', 'code', 'item_id', 'asked_as', 'asked_unit', 'removed', 'removed_reason', 'needs_human', 'flags', 'item_data', 'trace', 'lot', 'batch', 'expiry', 'serial', 'kind'
]); /* comment and raw_phrase are the sender's prose ("2 kg @ 60") and go; particulars is the item's name and stays (a residual: a sender may type a figure in a name) */
/* ── THE ALLOWLIST of everything that is NOT a line on a cost-side chit (the third review: money survives in VALUES — books_wait.why is prose with the figure in it,
   a number under `figure`, `paise`, `n`, `v` or `minor`, a "₹" in any string — so a name-based denylist cannot be enough). One spec tree, written once: a key not
   named here is dropped. ANY keeps a value as it is (ids, dates, statuses, booleans, the engine's own vocabulary); LINE applies LINE_KEEP; '*' is a map keyed by data.
   HOW IT WAS CHOSEN: every key the GET /:chit_id answer writes (routes/chits.js res.json literal, the libs behind each value: chit_participants, lib/storage listForChit,
   lib/amend list/readLines, lib/deliverline progress/summarise, lib/books-store waitOfChitSql, lib/assign current) was read and kept only when it is an id, a party, a
   date, a status, a purpose/kind, a count, a quantity, a unit, a rate, a code, or a word the ENGINE chooses (actions.why, doc, todo, wait). Free text a person typed
   (books_wait.why, amendments[].reason, state_log[].detail, a delivery's note, an assignment's note, a line's comment) is dropped because a sentence can carry a figure.
   Residuals the subject keeps: manual_subject / auto_subject (the chit's title, the sender's), particulars (an item's name), an attachment's file name, an assignment's
   task (the shop's own words) — listed in the PR for the coordinator. */
const ANY = Symbol('keep as it is');
const LINE = Symbol('a line: LINE_KEEP');
const PARTY = { entity_id: ANY, display_name: ANY, bridge_id: ANY, role: ANY, self: ANY, identity_id: ANY };
const SUMMARY_KEEP = { line_item_count: ANY, currency_code: ANY, priority_external: ANY, purpose: ANY, is_promotion: ANY, via: { channel: ANY, source: ANY, at: ANY }, detail_design: ANY, schema_id: ANY,
  order_details: { channel: ANY, fulfilment: ANY, requested_delivery: ANY, name: ANY }, trace: { product: ANY, qty: ANY, unit: ANY, base_qty: ANY, base_unit: ANY, is_origin: ANY, parents: ANY, network: { id: ANY } } };
const BUSINESS_KEEP = { doc: ANY, kind: ANY, side: ANY, bill_no: ANY, printed_as: ANY, client_ref: ANY, doc_no: ANY, billed_at: ANY, doc_at: ANY, counter_bill: ANY, deal_type: ANY, ref: ANY, cartons: ANY,
  weight: ANY, use: ANY, their_bill: { no: ANY, date: ANY }, till: { id: ANY, name: ANY }, order: { from: ANY }, against: { chit_id: ANY }, source: { name: ANY, sectors: ANY, supply_kind: ANY, bridge_id: ANY },
  payment: { mode: ANY, how: ANY, at: ANY }, differences: { name: ANY, by: ANY, reason: ANY } };
const HEADER_KEEP = { chit_id: ANY, entity_id: ANY, direction: ANY, role: ANY, purpose: ANY, sender_entity_id: ANY, sender_entity_display_name: ANY, sender_entity_bridge_id: ANY, all_recipients: PARTY,
  auto_subject: ANY, manual_subject: ANY, created_at: ANY, sent_at: ANY, updated_at: ANY, created_by_actor_id: ANY, schema_version: ANY, schema_id: ANY, chit_hash: ANY, detail_type: ANY,
  line_item_count: ANY, currency_code: ANY, folder_id: ANY, summary_json: SUMMARY_KEEP, business_json: BUSINESS_KEEP };
const DELIVERY_EVENT = { delivery_id: ANY, quantity: ANY, unit: ANY, reference: ANY, at: ANY, by: ANY, by_actor: ANY, by_id: ANY, mine: ANY, off_unit: ANY, particulars: ANY, amount: ANY };
const LINE_DELIVERY_KEEP = { unit: ANY, ordered: ANY, delivered: ANY, mine: ANY, theirs: ANY, complete: ANY, divergent: ANY, other_units: ANY, unit_mismatch: ANY, unacknowledged: ANY, removed: ANY, charged: ANY, events: DELIVERY_EVENT, added: DELIVERY_EVENT };
const ANSWER_KEEP = {
  _timing: ANY, cost_hidden: ANY, doc: ANY, lines_from: ANY, order_billed: ANY, amendments_migrated: ANY, bill_private: ANY, actions: ANY,
  header: HEADER_KEEP,
  detail: { detail_type: ANY, line_item_count: ANY, currency_code: ANY, line_items: LINE, payload_delivered_at: ANY, payload_deleted_at: ANY },
  participants: { entity_id: ANY, current_status: ANY, read_at: ANY, assigned_to_actor_display_name: ANY, updated_at: ANY, display_name: ANY, bridge_id: ANY },
  state_log: { action: ANY, action_by_identity_id: ANY, action_by_display_name: ANY, previous_status: ANY, new_status: ANY, created_at: ANY, code: ANY, step: ANY, mine: ANY },
  attachments: { id: ANY, name: ANY, mime: ANY, size: ANY, line_index: ANY },
  amendments: { amendment_id: ANY, line_index: ANY, line_id: ANY, seq: ANY, line: LINE, reason_code: ANY, actor_name: ANY, created_at: ANY },
  books_wait: { todo: ANY, wait: ANY },
  live_set: { index: ANY, line_id: ANY, live: LINE, original: LINE, history: LINE, removed: ANY, reason_code: ANY, versions: ANY },
  line_assignment: { '*': { line_id: ANY, seq: ANY, assignee_actor_id: ANY, assignee_name: ANY, assignee_type: ANY, task: ANY, due_date: ANY, created_at: ANY, state: ANY } },
  line_delivery: { '*': LINE_DELIVERY_KEEP },
  delivery_summary: { lines: ANY, complete: ANY, started: ANY, none: ANY, partial: ANY, accruing: ANY, charged: ANY, divergent: ANY, unit_mismatch: ANY, unacknowledged: ANY }
};
/** the money-bearing key names (the rule for everything that is not a line: a denylist by WORD, at any depth, because the answer's documents are open-ended) */
const MONEY_WORDS = new Set([
  'price', 'total', 'amount', 'net', 'gross', 'tax', 'taxable', 'cgst', 'sgst', 'igst', 'cess', 'mrp', 'rate', 'discount', 'value', 'paid', 'due', 'change', 'subtotal',
  'savings', 'charged', 'offers', 'offer', 'money', 'invoice', 'costs', 'goods', 'extras', 'input_tax', 'landed_total', 'unit_price', 'list_price', 'line_total', 'round_off',
  'balance', 'advance', 'total_value', 'invoiced', 'spent', 'margin', 'margin_pct', 'short', 'theirs', 'ours'
]);
const MONEY_SUFFIX = /_(minor|amount|total|price|value|paid|due|tax|taxable|discount)$/;
const ROLLUP_MEMBER_CAP = 200;
const isObject = (value) => !!value && typeof value === 'object';
/** is this key money, or a cost? a rate (gst_rate), a name (tax_name) and a count (line_item_count) are not */
const isMoneyKey = (key) => {
  const word = String(key).toLowerCase();
  return MONEY_WORDS.has(word) || MONEY_SUFFIX.test(word) || cost.isCostKey(key);
};
/** every money or cost key gone at ANY depth, in place → how many were removed */
function dropMoneyKeys(value) {
  if (!isObject(value)) return 0;
  let removed = 0;
  Object.keys(value).forEach((key) => {
    if (isMoneyKey(key)) {
      delete value[key];
      removed += 1;
    } else removed += dropMoneyKeys(value[key]);
  });
  return removed;
}
/** a line as a blind receiver may read it: LINE_KEEP only, and its item_data without money or cost → how many keys were removed */
function keepLine(line) {
  if (!isObject(line)) return 0;
  let removed = 0;
  Object.keys(line).forEach((key) => {
    if (LINE_KEEP.has(key)) return;
    delete line[key];
    removed += 1;
  });
  return removed + dropMoneyKeys(line.item_data);
}
/** prune(value, spec) → keeps of `value` only what `spec` names, in place, at every depth; an array is pruned element by element → how many keys were removed */
function prune(value, spec) {
  if (spec === ANY || value == null || typeof value !== 'object') return 0;
  if (spec === LINE) return Array.isArray(value) ? value.reduce((count, line) => count + keepLine(line), 0) : keepLine(value);
  if (Array.isArray(value)) return value.reduce((count, item) => count + prune(item, spec), 0);
  let removed = 0;
  Object.keys(value).forEach((key) => {
    const subSpec = spec['*'] || spec[key];
    if (subSpec === undefined) {
      delete value[key];
      removed += 1;
    } else removed += prune(value[key], subSpec);
  });
  return removed;
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
/** the document kinds (folder-inventory docOf) that are the reader's spend whoever holds the copy, and the ones that are its sale ONLY when the reader issued the copy */
const BUY_DOCS = ['bill_received', 'expense'];
const SELL_DOCS_IF_MINE = ['bill_issued', 'return', 'receipt'];
/** a buy verdict a document kind gives on its own: a bill received, an expense, the counter's goods receipt, a return received */
const buyByDocument = (doc, purpose, sentByMe) => BUY_DOCS.includes(doc) || (doc === 'receipt' && purpose === 'receipt') || (doc === 'return' && !sentByMe);
/** the side a DOCUMENT kind decides: a buy verdict always; a sell verdict only when the READER sent the copy (a payment received, a bill or return issued); null otherwise */
function documentSide(doc, purpose, sentByMe) {
  if (buyByDocument(doc, purpose, sentByMe)) return 'buy';
  return sentByMe && SELL_DOCS_IF_MINE.includes(doc) ? 'sell' : null;
}
/** the shop's own spend, whatever the direction: a payment it made, stock taken to its own use */
const isOwnSpend = (purpose, businessJson) => businessJson.kind === 'payment_made' || purpose === 'own_use';
/** a despatch note: the goods left the seller — the seller's copy sells, the receiver's buys */
const isDespatch = (purpose, businessJson) => purpose === 'delivery_note' || businessJson.doc === 'despatch';
/** a sender-declared side can only hide more: 'buy' counts, 'sell' is ignored (the sender wrote it) */
const declaredBuy = (businessJson) => typeof businessJson.side === 'string' && businessJson.side.toLowerCase() === 'buy';
const businessJsonOf = (chit) => (isObject(chit.business_json) ? chit.business_json : {});
const sentByShop = (chit, shopId) => !!chit.sender_entity_id && String(chit.sender_entity_id) === String(shopId);
/**
 * costSideOf(copy, shopId, role) → 'buy' | 'sell' | 'unknown' — is this copy the reading shop's COST side? Anything not POSITIVELY a sale is unknown, and unknown hides.
 * copy: { purpose, sender_entity_id, all_recipients, business_json } (a chit_header row, or a list row's side columns); role: the counterparty's { customer, supplier } on
 * the READER's lists, or null. Sales-side, from the reader's own view only: a document kind the reader issued (its counter bill, a return, a payment received), income
 * it sent, its own despatch, or any chit whose counterparty is on its customer list only. A sent order to such a party IS a sale by the shop's own lists: a PO to it is
 * a mis-listed party, and the fix is the list.
 */
function costSideOf(copy, shopId, role) {
  const chit = copy || {};
  const businessJson = businessJsonOf(chit);
  const purpose = String(chit.purpose || '');
  const sentByMe = sentByShop(chit, shopId);
  const byDocument = documentSide(folderInventory.docOf(chit, shopId), purpose, sentByMe);
  if (byDocument) return byDocument;
  if (isOwnSpend(purpose, businessJson) || declaredBuy(businessJson)) return 'buy';
  if (isDespatch(purpose, businessJson)) return sentByMe ? 'sell' : 'buy';
  if (sentByMe && KNOWN_SELL.includes(purpose)) return 'sell';
  return roleSide(roleWord(role));
}
/** the counterparty's role decides what the document kind did not: a supplier buys, a customer sells, anything else is unknown (hidden) */
const roleSide = (word) => (word === 'supplier' ? 'buy' : word === 'customer' ? 'sell' : 'unknown');

/** the few business_json keys docOf and declaredBuy read, as one small jsonb (never the whole document: a frozen invoice is large) */
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
 * moneyParams(req, blind) → the list params a blind reader may not use, taken OFF req.query and named: amount_min and amount_max in ANY form, and sort unless it is a
 * plain string other than 'amount' — the consumers index their maps by the raw value, so `?sort[]=amount` (an array) must go the same way as `?sort=amount`. [] for
 * everyone else. The route names them back in `cost_params_ignored` so the client knows its ask was not honoured.
 */
function moneyParams(req, blind) {
  if (!blind) return [];
  const ignored = [];
  ['amount_min', 'amount_max'].forEach((name) => {
    if (req.query[name] === undefined) return;
    delete req.query[name];
    ignored.push(name);
  });
  const sort = req.query.sort;
  if (sort !== undefined && (typeof sort !== 'string' || sort === 'amount')) {
    delete req.query.sort;
    ignored.push('sort');
  }
  return ignored;
}
/** `cost_params_ignored` for the answer: the names, or nothing at all when nothing was asked (undefined is left out of the JSON) */
const ignoredField = (ignored) => (ignored.length ? ignored : undefined);

/**
 * hideRowCosts(row, side) → a COPY of a list row as a blind actor may read it: cost-named keys gone on any side; on a cost side (buy or unknown) every money key of the
 * row at any depth, and cost_hidden:true ONLY when one was actually removed. A 'sell' row says nothing (a cost-named key is not the row's money).
 */
function hideRowCosts(row, side) {
  const out = structuredClone(row);
  cost.dropCostKeys(out);
  if (side === 'sell') return out;
  if (prune(out.summary_json, SUMMARY_KEEP) + dropMoneyKeys(out) > 0) out.cost_hidden = true; /* the summary by its allowlist, the row's other keys by the money rule */
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
/** the delivery ids THIS actor recorded (the delivery rows carry recorded_by_actor_id); no rows means none are his */
function mineDeliveries(deliveryRows, actorId) {
  const mine = new Set();
  (deliveryRows || []).forEach((row) => row && row.delivery_id && String(row.recorded_by_actor_id || '') === String(actorId) && mine.add(String(row.delivery_id)));
  return mine;
}
/** ONE line's delivery money: the actor's own `add` amounts stay and are summed; every other amount goes; `charged` stays only when it is exactly his own sum → how many removed */
function hideLineDeliveryMoney(entry, mine) {
  const added = Array.isArray(entry.added) ? entry.added : [];
  let ownSum = 0, removed = 0;
  added.forEach((addition) => {
    if (!addition || addition.amount == null) return;
    if (mine.has(String(addition.delivery_id))) ownSum += Number(addition.amount) || 0;
    else {
      delete addition.amount;
      removed += 1;
    }
  });
  if (entry.charged == null || roundMoney(ownSum) === roundMoney(Number(entry.charged) || 0)) return removed;
  delete entry.charged; /* deliverline sums EVERY event's amount: a figure above his own holds somebody else's money */
  return removed + 1;
}
/** the money on the deliveries: "rows they entered themselves" stay (lib/cost.js); the chit's `delivery_summary.charged` stays only when every line's did → how many removed */
function hideDeliveryMoney(out, mine) {
  if (!isObject(out.line_delivery)) return 0;
  const removed = Object.values(out.line_delivery).reduce((count, entry) => count + hideLineDeliveryMoney(entry, mine), 0);
  if (removed && isObject(out.delivery_summary) && out.delivery_summary.charged != null) {
    delete out.delivery_summary.charged;
    return removed + 1;
  }
  return removed;
}
/**
 * hideChitCosts(answer, { side, mine }) → a COPY of the GET /:chit_id answer as a blind actor may read it. Called LAST, after the rail's actions and docOf read the
 * real header; the answer object given is never changed (structuredClone), nor is any row behind it. On a cost side the answer is pruned to ANSWER_KEEP — an ALLOWLIST at
 * every depth (lines by LINE_KEEP, the deliveries after the own-add rule), so a figure in a value (books_wait.why, a number under any unnamed key, a "₹" in a string) cannot
 * survive under a key the rule never heard of. cost_hidden:true only when a key was actually removed.
 */
function hideChitCosts(answer, options) {
  const out = structuredClone(answer);
  cost.dropCostKeys(out);
  if (options.side === 'sell') return out;
  const removed = hideDeliveryMoney(out, options.mine || new Set()) + prune(out, ANSWER_KEEP);
  if (removed) out.cost_hidden = true;
  return out;
}
/**
 * bundleExtras(db, blind, shopId, header, deliveryRows) → what the chit read's bundle carries for a BLIND actor: the counterparty's role (one statement, the same
 * transaction; a failed read is unknown = hidden) and the delivery rows whose adds are his own — the one-shot's rows when it ran, else ONE read of deliverline's own
 * statement (the fallback path). {} for everyone else: no read, no key, the owner's answer byte for byte.
 */
async function bundleExtras(db, blind, shopId, header, deliveryRows) {
  if (!blind) return {};
  const party = counterpartyOf(header, shopId);
  let role = null, rows = deliveryRows || null;
  try {
    role = party ? (await booksStore.partiesOn(db, shopId, [party])).get(party) || null : null;
    if (!rows && header && header.chit_id) rows = (await db.query(deliverline.PROGRESS_SQL('l.chit_id = $2'), [shopId, header.chit_id])).rows;
  } catch (failure) {
    log.fellBack('cost-view: a blind reader\'s side read failed — the side is unknown and the cost hidden, no add is his', failure);
  }
  return { party: role, deliveryRows: rows };
}
/** the GET /:chit_id answer for its reader: the literal itself for the owner and a cost-allowed actor; a blind actor's copy through hideChitCosts */
function chitAnswer(answer, blind, header, shopId, bundle, actorId) {
  if (!blind) return answer;
  return hideChitCosts(answer, { side: costSideOf(header, shopId, bundle.party), mine: mineDeliveries(bundle.deliveryRows, actorId) });
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
  costSideOf, counterpartyOf, isMoneyKey, dropMoneyKeys, LINE_KEEP, ANSWER_KEEP, prune, sideColsSql, rolesFor, moneyParams, ignoredField, listRows, hideRowCosts, hideChitCosts, mineDeliveries,
  bundleExtras, chitAnswer, rollupGroup, rollupGroups, rollupMembersSql, rollupRoles, ROLLUP_MEMBER_CAP
};
