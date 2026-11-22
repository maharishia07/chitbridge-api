/**
 * tests/ops121-oversell.test.cjs — OPS-121 (WALK AZ AZ-F-01): SELLING MORE THAN THE SHELF SHOWS — allowed and flagged by default; refused online before it posts when the shop's switch says `block`; an OFFLINE replay always posts.
 *
 * OWNS      lib/stock-oversell.js + lib/chits-send-bill.js sendOversell over real express and the real problem renderer; lib/stock-from-chit.js postMovements (the flag); lib/policy.js negative_stock (default, owner-only).
 *           Hand figures: jug stock 5, a bill of 20 → block: 409 STOCK_SHORT "only 5 on the shelf" and the shelf is read ONCE (one trip); allow (the default, no setting stored): 200 and NO shelf read, and the post names
 *           the line below zero (5 - 20 = -15); a bill struck 2 hours before it arrives (offline replay) under block: 200, never refused, shelf not read, flagged when posted; 5 against stock 5: not short (not above);
 *           two lines of 3 and 3 against 5: short (they add up to 6); a product the ledger never moved: unknown, not refused.
 * CALLED BY by hand: node tests/ops121-oversell.test.cjs
 * FLOW      POST body ──▶ express ──▶ sendOversell(sendState from the body) ──▶ 409 problem | 200
 * CARD      13-inventory-stock-and-traceability/on-hand-and-movements
 */
'use strict';
const path = require('path'), http = require('http');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
const HERE = path.join(__dirname, '..');
const SHOP = '11111111-1111-4111-8111-111111111111';
const JUG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NEW = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; /* never moved: unknown */
let setting = null, shelfReads = 0;
const dbFile = require.resolve(path.join(HERE, 'db'));
const real = require(dbFile);
const answer = async (sql) => {
  if (/FROM identities/.test(sql) && /policy_flags/.test(sql)) return { rows: [{ policy_flags: setting ? { negative_stock: setting } : {}, self_copy_pref: 'received' }], rowCount: 1 };
  if (/FROM stock_balance b/.test(sql)) { shelfReads++; return { rows: [{ item_id: JUG, item_kind: 'catalogue', lot: '', expires_at: null, qty: '5', value: '50', avg_cost: '10', last_at: null, moves: '2' }], rowCount: 1 }; }
  if (/batch_tracked/.test(sql)) return { rows: [{ item_id: JUG, batch_tracked: null, stocked: null }], rowCount: 1 };
  return { rows: [], rowCount: 0 };
};
require.cache[dbFile].exports = Object.assign({}, real, { query: answer, withEntity: async (entity, fn) => fn({ query: answer }) });
const express = require('express');
const chits = require(path.join(HERE, 'routes', 'chits.js'));
const fromChit = require(path.join(HERE, 'lib', 'stock-from-chit.js'));
const store = require(path.join(HERE, 'lib', 'stock-store.js'));
const policy = require(path.join(HERE, 'lib', 'policy.js'));
const oversell = require(path.join(HERE, 'lib', 'stock-oversell.js'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

(async () => {
  console.log('\n== OPS-121 · selling more than the shelf shows ==\n');
  ok('routes/chits.js exports the real sendOversell', typeof chits.sendOversell === 'function');
  const app = express();
  app.use(express.json());
  app.post('/send', async (req, res) => {
    const state = { sender_id: SHOP, purpose: req.body.purpose, is_draft: !!req.body.is_draft, business_json: req.body.business_json || {}, line_items: req.body.line_items };
    if (await chits.sendOversell(state, req, res)) return;
    if (!res.headersSent) res.json({ message: 'Chit sent successfully' });
  });
  const server = await new Promise((resolve) => { const s = http.createServer(app).listen(0, () => resolve(s)); });
  const url = 'http://127.0.0.1:' + server.address().port + '/send';
  const post = async (body) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const line = (qty, id) => ({ name: 'Jug', particulars: 'Jug', quantity: qty, price: 10, item_id: id || JUG });
  const bill = (lines, at) => ({ purpose: 'order', line_items: lines, business_json: { bill_no: 'B-1', client_ref: 'ref-' + Math.random(), billed_at: at || new Date().toISOString() } });
  const words = (r) => String(r.body.detail || r.body.message);

  /* the switch: default allow, owner only */
  ok('negative_stock defaults to allow (no setting stored)', policy.defaults().negative_stock === 'allow');
  ok("negative_stock is the owner's alone (refusalFor names the sentence)", /owner/i.test(String(policy.refusalFor({ negative_stock: 'block' }, false))) && policy.refusalFor({ negative_stock: 'block' }, true) == null);
  ok('a stored "block" coerces; a junk value does not stick', policy.coerce('negative_stock', 'block') === 'block' && policy.coerce('negative_stock', 'zzz') !== 'zzz');
  ok('the Business rules card carries the row, and its help says the offline bill is never refused', /offline/i.test(String(((policy.schemaFor(null).negative_stock || {}).ui || {}).help)));

  /* ALLOW (default): 20 against 5 goes through, no shelf read on the send */
  setting = null; shelfReads = 0;
  let r = await post(bill([line(20)]));
  ok('allow (default): a bill of 20 against stock 5 → 200', r.status === 200, JSON.stringify(r));
  ok('allow: the shelf is NOT read on the send (the counter stays fast)', shelfReads === 0, 'reads ' + shelfReads);

  /* ALLOW + FLAG: the post names the line that went below zero (the flag) */
  store.issue = async (entity, mv) => ({ ok: true, parts: [{ ok: true, below_zero: 5 - mv.qty < 0 }], moved: 1, duplicate: 0, short: 0 });
  store.post = async (entity, mv) => ({ ok: true, duplicate: false, below_zero: 5 - mv.qty < 0 });
  const through = async (e, fn) => fn({ query: answer });
  const wanted = fromChit.movementsFor({ purpose: 'order', business_json: { bill_no: 'B-1' }, line_items: [line(20)] });
  const posted = await fromChit.postMovements(SHOP, wanted, through, {});
  ok('allow + flag: the post lists the item that went below zero (20 against 5 = -15)', Array.isArray(posted.below_zero) && posted.below_zero.length === 1 && posted.below_zero[0].item_id === JUG, JSON.stringify(posted));
  const fine = await fromChit.postMovements(SHOP, fromChit.movementsFor({ purpose: 'order', business_json: { bill_no: 'B-2' }, line_items: [line(2)] }), through, {});
  ok('a bill inside the stock flags nothing', Array.isArray(fine.below_zero) && fine.below_zero.length === 0);

  /* BLOCK online */
  setting = 'block'; shelfReads = 0;
  r = await post(bill([line(20)]));
  ok('block: 20 against 5, online → 409 STOCK_SHORT', r.status === 409 && r.body.code === 'STOCK_SHORT', JSON.stringify(r));
  ok('block: the words say what is on the shelf and that nothing was sent', /only 5/.test(words(r)) && /Nothing was sent/.test(words(r)), JSON.stringify(r.body));
  ok('block: ONE shelf read for the check', shelfReads === 1, 'reads ' + shelfReads);
  ok('block: 5 against 5 is not short', (await post(bill([line(5)]))).status === 200);
  ok('block: two lines of 3 and 3 against 5 add up and are short', (await post(bill([line(3), line(3)]))).status === 409);
  ok('block: a product the ledger never moved is unknown, not refused', (await post(bill([line(50, NEW)]))).status === 200);
  ok('block: a draft is never judged', (await post(Object.assign(bill([line(20)]), { is_draft: true }))).status === 200);
  ok('block: a bill with no product line (free text) is not judged', (await post(bill([{ particulars: 'labour', quantity: 20, price: 5 }]))).status === 200);

  /* OFFLINE: never refused */
  shelfReads = 0;
  const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  r = await post(bill([line(20)], twoHoursAgo));
  ok('block + OFFLINE replay (billed 2 h ago): 200, never refused after the fact', r.status === 200, JSON.stringify(r));
  ok('offline: the shelf is not even read; the post flags it (see allow + flag)', shelfReads === 0);

  /* pure */
  ok('shortOf: an unknown product is never short; equal is not short', oversell.shortOf([{ item_id: 'x', asked: 9 }, { item_id: 'y', asked: 5 }], { y: { qty: 5 } }).length === 0);
  server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
