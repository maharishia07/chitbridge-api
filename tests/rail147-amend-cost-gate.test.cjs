/**
 * tests/rail147-amend-cost-gate.test.cjs — RAIL-147: a cost-blind co-assist cannot WRITE a price on a cost-side chit through POST /amend or /reprice.
 *
 * OWNS      the proof, per door, that an actor without can_see_costs on a chit the shop BUYS on (or whose side is unknown) is refused 403 COST_BLIND with `blocked`
 *           naming the money keys he sent, and NOTHING is written; that his quantity-only or name-only amend (the price omitted or null, or re-sent unchanged)
 *           is recorded with the STORED price kept, and the answer carries no money; that a reprice (preview and apply) is refused; that on a SALES chit he amends and
 *           reprices exactly as today; and that the owner and a cost-allowed actor are untouched (no can_see_costs read, the library's answer byte for byte).
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/chits.js over a stand-in db and auth; every write statement is recorded, never run.
 * FLOW      world (who · the stored lines · the counterparty's role) → real route → status, body, the writes the stand-in saw → the rule
 * CARD      01-rail-core-the-chit/chits-routes
 *
 * Run: node tests/rail147-amend-cost-gate.test.cjs
 */
'use strict';
const path = require('path');
const express = require('express');
const http = require('http');
const API = path.join(__dirname, '..');
process.env.OUTPUT_ALLOWLIST = 'report';
let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(96) + (ok ? '' : JSON.stringify(got).slice(0, 300) + '   want ' + JSON.stringify(want).slice(0, 200)));
};
const SHOP = '11111111-1111-4111-8111-111111111111';
const CHIT = '22222222-2222-4222-8222-222222222222';
const SUPPLIER = '33333333-3333-4333-8333-333333333333';
const CUSTOMER = '55555555-5555-4555-8555-555555555555';
const STRANGER = '66666666-6666-4666-8666-666666666666';
const LINE = '88888888-8888-4888-8888-888888888888';
const LINE2 = '99999999-9999-4999-8999-999999999999';
const BLIND_ID = '44444444-4444-4444-8444-444444444444';
const GRANTED_ID = '77777777-7777-4777-8777-777777777777';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Owner', bridge_id: 'SHOP' };
const BLIND = { identity_id: BLIND_ID, identity_type: 'actor', access_level: 'editor', parent_entity_id: SHOP, hat: 'manager', display_name: 'Blind', bridge_id: 'SHOP' };
const GRANTED = Object.assign({}, BLIND, { identity_id: GRANTED_ID, display_name: 'Granted' });
const GRANTS = { [GRANTED_ID]: true };
const AT = '2026-10-01T10:00:00.000Z';
/* the supplier's rate on the stored line, a figure no other field could carry; and the figure a blind actor tries to write */
const STORED = 4242.5, TRIED = 9797.25;
const SECRETS = [String(STORED), String(TRIED), '42425', '97972'];

/* ── the copies ──────────────────────────────────────────────────────────────────────────────────────────────── */
/** the header's side columns as lib/cost-write SIDE_SQL selects them */
const header = (over) => Object.assign({ purpose: 'order', sender_entity_id: SUPPLIER, all_recipients: [{ entity_id: SUPPLIER, display_name: 'Mill' }, { entity_id: SHOP, display_name: 'Shop' }], business_json: {} }, over);
const PURCHASE = header({}); /* an order from a party on my supplier list: my PO — a BUY */
const SALE = header({ sender_entity_id: CUSTOMER, all_recipients: [{ entity_id: CUSTOMER, display_name: 'Ravi' }, { entity_id: SHOP, display_name: 'Shop' }] }); /* a customer's order: a SALE */
const UNLISTED = header({ sender_entity_id: STRANGER, all_recipients: [{ entity_id: STRANGER, display_name: 'Who' }, { entity_id: SHOP, display_name: 'Shop' }] }); /* no list names him: unknown */
const BILL = header({ purpose: 'invoice', business_json: { their_bill: { no: 'INV-7' } } }); /* a bill received: a BUY by its document kind, whatever the lists say */
/** the stored lines (chit_line, as lib/amend readLines selects them): one priced at the supplier's rate, one with no price yet */
const LINE_ROWS = [
  { line_id: LINE, seq: 1, particulars: 'Basmati rice 1kg', quantity: '10', unit: 'kg', unit_size: null, price: String(STORED), comment: null, asked_as: null, asked_unit: null, raw_phrase: null, removed: false, removed_reason: null, needs_human: false, flags: null },
  { line_id: LINE2, seq: 2, particulars: 'Toor dal 1kg', quantity: '5', unit: 'kg', unit_size: null, price: null, comment: null, asked_as: null, asked_unit: null, raw_phrase: null, removed: false, removed_reason: null, needs_human: false, flags: null }
];
const CATALOGUE = [{ item_id: LINE, item_data: { name: 'Basmati rice 1kg', price: { amount: 61, currency: 'INR' } }, updated_at: AT }];

/* ── the stand-in db: reads answer the scene, WRITES are recorded and echoed, never run ──────────────────────── */
let WHO = OWNER, SCENE = {}, WRITES = [], READS = [];
function handle(sql, params) {
  const s = String(sql).replace(/\s+/g, ' ');
  READS.push(s.slice(0, 60));
  if (/can_see_costs FROM identities/.test(s)) return { rows: [{ can_see_costs: !!GRANTS[params[0]] }] };
  if (/SELECT 1 FROM chit_header/.test(s)) return { rows: [{ '?column?': 1 }] };
  if (/SELECT ch\.purpose, ch\.sender_entity_id, ch\.all_recipients/.test(s)) return { rows: SCENE.header ? [SCENE.header] : [] };
  if (/FROM unnest\(\$2::uuid\[\]\)/.test(s)) return { rows: params[1].map((id) => ({ id, customer: id === CUSTOMER, supplier: id === SUPPLIER })) };
  if (/FROM chit_line WHERE entity_id = \$1 AND chit_id = \$2 ORDER BY seq/.test(s)) return { rows: SCENE.lines || LINE_ROWS };
  if (/chit_line_delivered_qty/.test(s)) return { rows: (SCENE.lines || LINE_ROWS).map((l) => ({ line_id: l.line_id, particulars: l.particulars, ordered_unit: l.unit, delivered: '0' })) };
  if (/INSERT INTO chit_line_amendment/.test(s)) {
    WRITES.push({ what: 'amendment', line: params[4] === null ? null : JSON.parse(params[4]) });
    return { rows: [{ amendment_id: CHIT, line_index: params[2], line_id: params[3], seq: 1, line: params[4] === null ? null : JSON.parse(params[4]), reason_code: params[5], reason: params[6], actor_name: params[8], created_at: AT }] };
  }
  if (/COALESCE\(flags,'\{\}'::jsonb\) AS flags/.test(s)) return { rows: [{ flags: {}, particulars: 'Basmati rice 1kg' }] };
  if (/UPDATE chit_line SET/.test(s)) { WRITES.push({ what: 'chit_line', price: params[7] }); return { rows: [], rowCount: 1 }; }
  if (/INSERT INTO state_log/.test(s)) { WRITES.push({ what: 'state_log', detail: params[4] }); return { rows: [] }; }
  if (/SELECT line_items FROM chit_detail/.test(s)) return { rows: [{ line_items: [{ particulars: 'Basmati rice 1kg' }, { particulars: 'Toor dal 1kg' }] }] };
  if (/FROM catalogue_items/.test(s)) return { rows: CATALOGUE };
  if (/information_schema/.test(s)) return { rows: [{ '?column?': 1 }] };
  return { rows: [] };
}
const post = (port, p, who, body) => new Promise((done) => {
  WHO = who; WRITES = []; READS = [];
  const data = JSON.stringify(body);
  const req = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
    let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { j = { raw }; } done({ status: res.statusCode, body: j, raw, writes: WRITES.slice(), reads: READS.slice() }); });
  });
  req.end(data);
});
/** the secret figures found as values anywhere in the raw body */
const leaked = (raw) => SECRETS.filter((s) => new RegExp('(^|[^0-9.])' + s.replace('.', '\\.') + '([^0-9]|$)').test(raw));
const edit = (line, over) => ({ edits: [Object.assign({ line_index: 0, line_id: LINE, line, reason_code: 'misread_by_ai' }, over)] });
const AMEND = '/api/chits/' + CHIT + '/amend', REPRICE = '/api/chits/' + CHIT + '/reprice';
const QTY_ONLY = { particulars: 'Basmati rice 1kg', quantity: 12, unit: 'kg' };

/* ── the lib on its own ──────────────────────────────────────────────────────────────────────────────────────── */
function unitCases() {
  let lib = null;
  try { lib = require(API + '/lib/cost-write'); } catch (_) { lib = null; }
  t('lib/cost-write | the module exists (RAIL-147)', !!lib, true);
  if (!lib) return;
  const stored = { line_id: LINE, price: STORED };
  console.log('   lib/cost-write · moneyKeysOf: the money keys a replacement line would SET or CHANGE against the stored line');
  t('moneyKeysOf | a new price is a change; total, rate, discount, a cost name, a nested price (a picker\'s ref) are all named as sent', lib.moneyKeysOf({ particulars: 'x', price: TRIED, total: 1, rate: 2, discount: 3, unit_cost: 4, ref: { item_id: 'i', price: { amount: 5 } } }, stored), ['price', 'total', 'rate', 'discount', 'unit_cost']);
  t('moneyKeysOf | the stored price re-sent (as a number or text, to the money unit\'s rounding) is NOT a change; quantity, unit, name, comment, lot are not money', [lib.moneyKeysOf({ particulars: 'x', quantity: 12, unit: 'kg', comment: 'c', lot: { batch: 'B1' }, price: STORED }, stored), lib.moneyKeysOf({ price: String(STORED) }, stored), lib.moneyKeysOf({ price: STORED + 0.001 }, stored)], [[], [], []]);
  t('moneyKeysOf | an omitted or null price is not a set (it is carried); a price where the stored line has NONE is a set; no stored line at all: any price is a set; a removal names nothing', [lib.moneyKeysOf({ particulars: 'x' }, stored), lib.moneyKeysOf({ price: null }, stored), lib.moneyKeysOf({ price: STORED }, { price: null }), lib.moneyKeysOf({ price: 1 }, null), lib.moneyKeysOf(null, stored)], [[], [], ['price'], ['price'], []]);
  t('moneyKeysOf | gst_rate, tax_name and quantity are not money (a rate is not a price)', lib.moneyKeysOf({ gst_rate: 5, tax_name: 'GST', quantity: 2 }, stored), []);
  const given = edit({ particulars: 'x', quantity: 12 }).edits[0];
  const carried = lib.carryStoredPrice(given, stored);
  t('carryStoredPrice | the stored price is filled in on a COPY (the body is untouched); null is treated as omitted; a sent price and a removal pass as they are', [carried.line.price, given.line.price, lib.carryStoredPrice(edit({ price: null, particulars: 'x' }).edits[0], stored).line.price, lib.carryStoredPrice(edit({ price: 7 }).edits[0], stored).line.price, lib.carryStoredPrice(edit(null).edits[0], stored).line], [STORED, undefined, STORED, 7, null]);
  t('carryStoredPrice | nothing to carry when the stored line has no price', lib.carryStoredPrice(given, { price: null }).line.price, undefined);
  const hidden = lib.hideAmendments({ amendments: [{ amendment_id: CHIT, line_index: 0, line_id: LINE, seq: 1, line: { particulars: 'x', quantity: 12, unit: 'kg', price: STORED, total: 50910, unit_cost: 1 }, reason_code: 'misread_by_ai', reason: 'they charged ₹9', actor_name: 'Blind', created_at: AT }] });
  t('hideAmendments | the line keeps LINE_KEEP only (no price, total or cost), the typed reason goes, the ids and codes stay', hidden.amendments[0], { amendment_id: CHIT, line_index: 0, line_id: LINE, seq: 1, line: { particulars: 'x', quantity: 12, unit: 'kg' }, reason_code: 'misread_by_ai', actor_name: 'Blind', created_at: AT });
}

(async () => {
  console.log('\n-- RAIL-147 · a cost-blind co-assist cannot write a price on a cost-side chit (amend · reprice) --\n');
  require.cache[require.resolve(API + '/middleware/auth')] = { exports: Object.assign((req, res, next) => { req.identity = WHO; next(); }, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id }) };
  const client = { query: async (sql, params) => handle(sql, params) };
  require.cache[require.resolve(API + '/db')] = { exports: { query: client.query, withEntity: async (_id, fn) => fn(client), withTransaction: async (fn) => fn(client), onEntity: async (_i, _d, fn) => fn(client), readBatch: async () => [], trySavepoint: async (db, run, fallback) => { try { return await run(db); } catch (_) { return fallback; } } } };
  console.error = () => undefined;
  const app = express(); app.use(express.json());
  app.use('/api/chits', require(API + '/routes/chits'));
  unitCases();
  const server = app.listen(0); const port = server.address().port;
  const refused = (label, r, blocked) => {
    t(label + ' | 403 COST_BLIND, blocked names the keys (never a value), the products shape', [r.status, r.body.code, r.body.blocked, r.body.error, /Sees costs/.test(r.body.message)], [403, 'COST_BLIND', blocked, 'Not permitted', true]);
    t(label + ' | NOTHING written (no amendment, no chit_line, no state_log) and no secret figure in the answer', [r.writes, leaked(r.raw)], [[], []]);
  };
  const recorded = (label, r, price) => {
    t(label + ' | 200, the amendment and the live row both carry the STORED price (' + STORED + '), the total recomputed from it', [r.status, r.writes.filter((w) => w.what === 'amendment').map((w) => w.line.price), r.writes.filter((w) => w.what === 'chit_line').map((w) => w.price), r.writes[0].line.total], [200, [price], [price], 12 * price]);
    t(label + ' | the answer carries no price, no total, no secret figure, no typed reason; the line\'s name, quantity and unit stay', [leaked(r.raw), 'price' in r.body.amendments[0].line, 'total' in r.body.amendments[0].line, 'reason' in r.body.amendments[0], r.body.amendments[0].line], [[], false, false, false, { particulars: 'Basmati rice 1kg', quantity: 12, unit: 'kg' }]);
  };

  console.log('\n   a PURCHASE (an order from a party on my supplier list): the blind actor may not set or change money');
  SCENE = { header: PURCHASE };
  refused('blind sets a price', await post(port, AMEND, BLIND, edit(Object.assign({}, QTY_ONLY, { price: TRIED }))), ['price']);
  refused('blind sends total and a cost name beside the stored price', await post(port, AMEND, BLIND, edit(Object.assign({}, QTY_ONLY, { price: STORED, total: 1, unit_cost: 2 }))), ['total', 'unit_cost']);
  refused('blind prices the line that has NO price yet (a set)', await post(port, AMEND, BLIND, edit({ particulars: 'Toor dal 1kg', quantity: 5, unit: 'kg', price: 12 }, { line_id: LINE2 })), ['price']);
  refused('blind: one bad edit in a batch of two refuses the WHOLE batch', await post(port, AMEND, BLIND, { edits: [edit(QTY_ONLY).edits[0], edit({ particulars: 'Toor dal 1kg', quantity: 5, unit: 'kg', price: 12 }, { line_id: LINE2 }).edits[0]] }), ['price']);
  refused('blind sets a price as text', await post(port, AMEND, BLIND, edit(Object.assign({}, QTY_ONLY, { price: '12' }))), ['price']);
  refused('blind reprice (apply)', await post(port, REPRICE, BLIND, {}), ['price']);
  refused('blind reprice (preview)', await post(port, REPRICE, BLIND, { preview: true, line_ids: [LINE] }), ['price']);
  const previewed = await post(port, REPRICE, BLIND, { preview: true });
  t('blind reprice | refused before the catalogue is read (no catalogue price computed for him)', previewed.reads.some((r) => /catalogue_items/.test(r)), false);
  console.log('\n   the same purchase: what the blind actor MAY do, and the stored price survives it');
  recorded('blind amends the quantity only (no price key at all — the screen after RAIL-146)', await post(port, AMEND, BLIND, edit(QTY_ONLY)), STORED);
  recorded('blind amends with price: null (a blank field)', await post(port, AMEND, BLIND, edit(Object.assign({}, QTY_ONLY, { price: null }))), STORED);
  recorded('blind re-sends the stored price unchanged', await post(port, AMEND, BLIND, edit(Object.assign({}, QTY_ONLY, { price: STORED }))), STORED);
  const removed = await post(port, AMEND, BLIND, edit(null));
  t('blind removes a line (line: null): recorded as today, nothing priced', [removed.status, removed.writes.map((w) => w.what), removed.body.amendments[0].line], [200, ['amendment', 'chit_line', 'state_log'], null]);
  const nameOnly = await post(port, AMEND, BLIND, edit({ particulars: 'Basmati rice 1 kg', quantity: 10, unit: 'kg' }, { reason_code: 'misread_by_ai' }));
  t('blind corrects the name: the synonym candidate still comes back (names are not money)', [nameOnly.status, nameOnly.body.synonym_candidates && nameOnly.body.synonym_candidates[0].means], [200, 'Basmati rice 1 kg']);
  const empty = await post(port, AMEND, BLIND, { edits: [] });
  t('blind sends an empty batch: 400 "Nothing to amend" as today (no door read)', [empty.status, empty.reads.some((r) => /can_see_costs/.test(r))], [400, false]);

  console.log('\n   a BILL received and an order from a party on NO list: gated the same (a document kind; unknown fails closed)');
  SCENE = { header: BILL };
  refused('blind sets a price on a bill received', await post(port, AMEND, BLIND, edit(Object.assign({}, QTY_ONLY, { price: TRIED }))), ['price']);
  SCENE = { header: UNLISTED };
  refused('blind sets a price on an order from an unlisted party', await post(port, AMEND, BLIND, edit(Object.assign({}, QTY_ONLY, { price: TRIED }))), ['price']);
  refused('blind reprice on an unlisted party\'s order', await post(port, REPRICE, BLIND, {}), ['price']);
  SCENE = {}; /* no header row at all: the side read finds nothing */
  refused('blind sets a price when the side cannot be read: unknown, shut', await post(port, AMEND, BLIND, edit(Object.assign({}, QTY_ONLY, { price: TRIED }))), ['price']);

  console.log('\n   a SALE (a customer\'s order): the blind actor\'s rights are as today');
  SCENE = { header: SALE };
  const saleAmend = await post(port, AMEND, BLIND, edit(Object.assign({}, QTY_ONLY, { price: TRIED })));
  t('blind sets a price on a sale: 200, written as sent, the answer carries the price (as today)', [saleAmend.status, saleAmend.writes.filter((w) => w.what === 'chit_line').map((w) => w.price), saleAmend.body.amendments[0].line.price, saleAmend.body.amendments[0].reason_code], [200, [TRIED], TRIED, 'misread_by_ai']);
  const saleOmit = await post(port, AMEND, BLIND, edit(QTY_ONLY));
  t('blind omits the price on a sale: the replacement line has none, as today (the library\'s own rule, unchanged on a sale)', [saleOmit.status, saleOmit.writes.filter((w) => w.what === 'chit_line').map((w) => w.price)], [200, [null]]);
  const saleReprice = await post(port, REPRICE, BLIND, { preview: true });
  t('blind reprice on a sale: the preview answers the catalogue price, as today', [saleReprice.status, saleReprice.body.will_price.map((w) => w.to)], [200, [61]]);

  console.log('\n   the owner and a cost-allowed actor: untouched, on the purchase');
  SCENE = { header: PURCHASE };
  for (const [name, who] of [['owner', OWNER], ['cost-allowed', GRANTED]]) {
    const r = await post(port, AMEND, who, edit(Object.assign({}, QTY_ONLY, { price: TRIED })));
    t(name + ' sets a price on a purchase: 200, written as sent, priced answer, typed reason kept', [r.status, r.writes.filter((w) => w.what === 'chit_line').map((w) => w.price), r.body.amendments[0].line.price, r.body.amendments[0].line.total], [200, [TRIED], TRIED, 12 * TRIED]);
    const omit = await post(port, AMEND, who, edit(QTY_ONLY));
    t(name + ' omits the price on a purchase: the replacement line has none (the library\'s rule as today; he can see what he erases)', [omit.status, omit.writes.filter((w) => w.what === 'chit_line').map((w) => w.price)], [200, [null]]);
    const rp = await post(port, REPRICE, who, { preview: true });
    t(name + ' reprice preview on a purchase: 200 with the catalogue price', [rp.status, rp.body.will_price.map((w) => w.to), rp.body.will_price[0].replaces_stated_price], [200, [61], true]);
    t(name + ' | ' + (who === OWNER ? 'no can_see_costs read at all and ' : '') + 'no side read (the door costs the owner nothing)', [who === OWNER && r.reads.some((x) => /can_see_costs/.test(x)), r.reads.some((x) => /SELECT ch.purpose, ch.sender_entity_id/.test(x))], [false, false]);
  }
  server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
