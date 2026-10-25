'use strict';
/**
 * tests/crossing/lib/flow.cjs — the steps more than one scenario takes, and the database reads that verify a side. (One helper per repeated step: DISCIPLINES.)
 * OWNS      add-supplier-by-address · catalogue read · the order body the screen sends · "my copy" reads (header, status, proposals, messages, queue) on a shop's own installation · the waits for the ctp-return cron
 * CALLED BY the scenario files
 * FLOW      API call as the shop (what the screen does) → read the rows on EACH installation (what the database holds) → compare
 * The answers of the API are checked, but the DATABASE decides pass/fail for "both sides agree": nothing here trusts a response body for the other installation.
 */
const db = require('./db.cjs');
const { waitFor } = require('./compare.cjs');

/** both shops of the scenario's pair, signed in, plus their keys */
async function actors(ctx, id) {
  const pair = ctx.pair(id);
  return { pair, buyer: await ctx.shop(pair.buyer.key), seller: await ctx.shop(pair.seller.key), bk: pair.buyer.key, sk: pair.seller.key };
}

/** the status of an entity's row on an installation (the seller's SHADOW on the buyer's side is the stub id) */
async function statusAt(ctx, installation, entityId, chitId) {
  const rows = await ctx.q(installation, 'SELECT current_status FROM chit_status WHERE chit_id = ' + db.uuid(chitId) + ' AND entity_id = ' + db.uuid(entityId) + ' LIMIT 1');
  return rows[0] ? rows[0].current_status : null;
}

/** the address the screen builds: bridge_id@host-of-that-installation (same-installation sellers are added by User ID, as the walk did) */
function addressOf(ctx, buyer, seller) {
  if (seller.installation === buyer.installation) return seller.user_id;
  return seller.bridge_id + '@' + ctx.topo.installations[seller.installation].host;
}

/** add a supplier (an existing row is fine: 409 Exists) and find its row in my list. → { add, stub } */
async function addSupplier(ctx, buyerKey, sellerKey) {
  const buyer = await ctx.shop(buyerKey);
  const seller = Object.assign({ key: sellerKey }, ctx.topo.shops[sellerKey]);
  const add = await buyer.post('/api/relationships/suppliers', { supplier_bridge_id: addressOf(ctx, buyer, seller) });
  const stub = await findSupplier(buyer, seller);
  return { add, stub };
}

/** my supplier list row for a shop, by bridge id then user id; null when absent */
async function findSupplier(buyer, seller) {
  const list = await buyer.get('/api/relationships/suppliers?limit=100');
  const rows = list.body.suppliers || list.body.rows || list.body.items || [];
  const wantUser = String(seller.user_id || '').toLowerCase();
  return rows.find((row) => (seller.bridge_id && row.bridge_id === seller.bridge_id) || (row.user_id && String(row.user_id).toLowerCase() === wantUser)) || null;
}

/** the supplier's catalogue as the buyer's screen reads it */
async function catalogue(buyer, supplierEntityId) {
  const got = await buyer.get('/api/relationships/suppliers/' + supplierEntityId + '/catalogue');
  const body = got.body || {};
  const currency = (body.supplier && body.supplier.currency_code) || (body.shop && body.shop.currency_code) || null;
  return { status: got.status, body, items: body.items || [], currency, remote: body.remote || null };
}

const nameOf = (item) => String((item.item_data && (item.item_data.name || item.item_data.code)) || item.name || 'item');
/** the catalogue answers price as { amount, currency }; a bare number is still read */
const priceRaw = (item) => (item.item_data && item.item_data.price != null ? item.item_data.price : item.price);
const priceOf = (item) => { const p = priceRaw(item); return Number(p && typeof p === 'object' ? p.amount : p); };
const currencyOf = (item) => { const p = priceRaw(item); return (p && typeof p === 'object' && p.currency) || (item.item_data && item.item_data.currency) || null; };

/** the catalogue item whose name matches (case-insensitive), else null */
function pickItem(items, match) {
  const re = new RegExp(String(match || '.'), 'i');
  return items.find((item) => re.test(nameOf(item))) || null;
}

/** the body the supplier screen sends for an order (web app.html supSendOrder): states the CART's currency, the list price, purpose 'order' */
function orderBody(ctx, stub, seller, item, qty, opts) {
  const o = opts || {};
  const business_json = {};
  if (o.currency) business_json.currency = o.currency;
  if (o.dealType) business_json.deal_type = o.dealType;
  const price = priceOf(item);
  const subject = ctx.subject(o.subject || 'order');
  const to = { name: stub.display_name, display_name: stub.display_name, entity_id: stub.supplier_entity_id, bridge_id: seller.bridge_id || stub.bridge_id, kind: 'to', role: 'to', self: false };
  const line = { particulars: nameOf(item), unit: (item.item_data && item.item_data.unit) || 'unit', quantity: qty, item_id: item.item_id, price, total: qty * price, comment: '' };
  const ref = 'ctpx-' + ctx.runId + '-' + (o.ref || Math.random().toString(16).slice(2, 8));
  return { recipients: [to], purpose: 'order', subject, manual_subject: subject, priority: 'normal', client_ref: ref, business_json, line_items: [line] };
}

/** a general (non-order) chit to a supplier, as deploy/network/prove.cjs does: for the status / message / dispute rails */
function generalBody(ctx, stub, seller, text) {
  const subject = ctx.subject(text);
  const to = { display_name: stub.display_name, entity_id: stub.supplier_entity_id, bridge_id: seller.bridge_id || stub.bridge_id, kind: 'to' };
  const ref = 'ctpx-' + ctx.runId + '-' + Math.random().toString(16).slice(2, 8);
  return { recipients: [to], purpose: 'general', subject, manual_subject: subject, client_ref: ref, business_json: { note: 'made by the crossing pack ' + ctx.runId } };
}

/* ── database: my copy, on my installation ─────────────────────────────────────────────────── */
async function copy(ctx, shopKey, chitId) {
  const id = await ctx.entityId(shopKey);
  const sql =
    "SELECT h.chit_id, h.business_json, h.summary_json, md5((h.summary_json->'money')::text) AS money_md5, md5((h.business_json->'invoice')::text) AS invoice_md5, " +
    's.current_status, s.cancel_requested_at IS NOT NULL AS cancel_requested, s.cancel_confirmed_at IS NOT NULL AS cancel_confirmed ' +
    'FROM chit_header h LEFT JOIN chit_status s ON s.chit_id = h.chit_id AND s.entity_id = h.entity_id ' +
    'WHERE h.chit_id = ' + db.uuid(chitId) + ' AND h.entity_id = ' + db.uuid(id) + ' LIMIT 1';
  const rows = await ctx.q(ctx.topo.shops[shopKey].installation, sql);
  return rows[0] || null;
}

async function proposals(ctx, shopKey, chitId) {
  const id = await ctx.entityId(shopKey);
  const sql =
    "SELECT proposal_id, round, kind, status, currency_code, summary->'money' AS money, md5(invoice::text) AS invoice_md5, request, terms, note FROM chit_proposal " +
    'WHERE chit_id = ' + db.uuid(chitId) + ' AND entity_id = ' + db.uuid(id) + ' ORDER BY round, created_at';
  return ctx.q(ctx.topo.shops[shopKey].installation, sql);
}

async function queueOut(ctx, shopKey, chitId) {
  const id = await ctx.entityId(shopKey);
  const sql =
    'SELECT seq, kind, status, attempts, accepted_at, created_at, last_error FROM ctp_event_out WHERE chit_id = ' + db.uuid(chitId) + ' AND from_entity_id = ' + db.uuid(id) + ' ORDER BY seq, id';
  return ctx.q(ctx.topo.shops[shopKey].installation, sql);
}

async function messages(ctx, shopKey, chitId) {
  const id = await ctx.entityId(shopKey);
  const sql =
    'SELECT message_id, thread_type, message_text, sender_display_name, created_at, is_dispute, dispute_id FROM chit_messages WHERE chit_id = ' + db.uuid(chitId) + ' AND entity_id = ' + db.uuid(id) + ' ORDER BY created_at';
  return ctx.q(ctx.topo.shops[shopKey].installation, sql);
}

async function disputes(ctx, shopKey, chitId) {
  const id = await ctx.entityId(shopKey);
  const sql =
    'SELECT dispute_id, status, category, reason, resolution_note FROM chit_disputes WHERE chit_id = ' + db.uuid(chitId) + ' AND entity_id = ' + db.uuid(id) + ' ORDER BY created_at';
  return ctx.q(ctx.topo.shops[shopKey].installation, sql);
}

/** the attachment rows a shop holds on a chit (id, name, size) */
async function attachments(ctx, shopKey, chitId) {
  const id = await ctx.entityId(shopKey);
  const sql = 'SELECT id, name, size, mime FROM cb_attachment WHERE chit_id = ' + db.uuid(chitId) + ' AND entity_id = ' + db.uuid(id) + ' ORDER BY created_at';
  return ctx.q(ctx.topo.shops[shopKey].installation, sql);
}

/* ── waits: the ctp-return cron runs about once a minute; stop at the first yes ───────────────── */
const crossBudget = (ctx) => ({ timeoutMs: ctx.topo.waits.crossMs, everyMs: ctx.topo.waits.everyMs });

/** wait until a chit has a copy for this shop (it crossed) */
function waitCopy(ctx, shopKey, chitId) {
  return waitFor(() => copy(ctx, shopKey, chitId), crossBudget(ctx));
}

/** wait until predicate(copy) holds on this shop's copy */
function waitCopyWhere(ctx, shopKey, chitId, predicate) {
  return waitFor(async () => {
    const c = await copy(ctx, shopKey, chitId);
    return c && predicate(c) ? c : null;
  }, crossBudget(ctx));
}

/** wait until predicate(rows) holds on this shop's proposals */
function waitProposals(ctx, shopKey, chitId, predicate) {
  return waitFor(async () => {
    const rows = await proposals(ctx, shopKey, chitId);
    return predicate(rows) ? rows : null;
  }, crossBudget(ctx));
}

/** wait until this shop holds a message with exactly this text */
function waitMessage(ctx, shopKey, chitId, text) {
  return waitFor(async () => {
    const rows = await messages(ctx, shopKey, chitId);
    return rows.find((row) => row.message_text === text) || null;
  }, crossBudget(ctx));
}

/** wait until predicate(rows) holds on this shop's disputes */
function waitDisputes(ctx, shopKey, chitId, predicate) {
  return waitFor(async () => {
    const rows = await disputes(ctx, shopKey, chitId);
    return predicate(rows) ? rows : null;
  }, crossBudget(ctx));
}

/** a shop's own standing facts on its installation: currency, price-list visibility, trade mode (the opt-in) */
async function shopState(ctx, shopKey) {
  const id = await ctx.entityId(shopKey);
  const sql =
    "SELECT i.currency_code, i.catalogue_visibility, coalesce(ep.trade_mode, 'domestic') AS trade_mode FROM identities i LEFT JOIN entity_profile ep ON ep.entity_id = i.identity_id WHERE i.identity_id = " + db.uuid(id);
  const rows = await ctx.q(ctx.topo.shops[shopKey].installation, sql);
  return rows[0] || null;
}

/** the installation key as the DATABASES and the search 'where' know it (topology key unless the row says db_key) */
const dbKeyOf = (ctx, installation) => ctx.topo.installations[installation].db_key || installation;

/** the buyer's and the seller's copy of one chit, side by side */
async function bothCopies(ctx, chitId, buyerKey, sellerKey) {
  return { buyer: await copy(ctx, buyerKey, chitId), seller: await copy(ctx, sellerKey, chitId) };
}

const num = (v) => (v === null || v === undefined ? null : Number(v));

module.exports = {
  actors, statusAt, addressOf, addSupplier, findSupplier, catalogue, pickItem, nameOf, priceOf, currencyOf, orderBody, generalBody,
  copy, proposals, queueOut, messages, disputes, attachments,
  shopState, dbKeyOf, bothCopies, waitCopy, waitCopyWhere, waitProposals, waitMessage, waitDisputes, num
};
