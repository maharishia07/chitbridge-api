'use strict';
/**
 * scripts/seed-local.cjs — ONE test shop on a LOCAL api (toolset/local-stack.sh `up` runs this). Idempotent: run it twice, get one shop.
 *
 *   Mayur Restaurant — a restaurant on the storefront, 20 products (4 with photos), counters C1–C5, one staff login with a PIN,
 *   one local supplier, one customer. Everything goes through the api's own routes (no direct SQL), so the shape is whatever the
 *   routes make — nothing here can drift from them.
 *   --demo-month (opt-in, after the above): trade a month in it - country, books, costs, 40 bills, a supplier bill into stock, an open order, a task,
 *   consent, an Offer Lab draft, a Combo Lab set. Idempotent too; a step whose route refuses is skipped and listed.
 *
 * ⚠️ DEV_OTP must be armed on the server (lib/dev-otp.js: 123456 entity · 123123 customer). Refuses any api that is not on this machine.
 * Run: API_BASE=http://127.0.0.1:3100 node scripts/seed-local.cjs [--demo-month]
 * CALLED BY toolset/local-stack.sh (up); by hand before a demo (--demo-month).
 * FLOW register + sign in -> products -> counters -> staff login -> supplier -> customer -> (--demo-month) country, books, costs, bills, stock, supplier bill, order, task, consent, labs.
 * CARD 28-platform-and-operations/local-seed
 */
const zlib = require('zlib');
const API = (process.env.API_BASE || 'http://127.0.0.1:3100').replace(/\/$/, '');
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(API)) { console.error('REFUSED: seed-local only seeds an api on this machine, not ' + API); process.exit(3); }

if (process.env.DATABASE_URL && process.env.DATABASE_URL !== 'postgres://postgres:cblocal@127.0.0.1:55432/cb_local') { console.error('REFUSED: seed-local only works against the local test database'); process.exit(3); }

const SHOP = { email: 'mayur@local.test', name: 'Mayur Restaurant' };
const STAFF = { name: 'Asha Cashier', key: 'asha01', pin: '2468' };
const CUSTOMER = { email: 'priya@local.test', name: 'Priya Customer' };
const SUPPLIER = 'Sri Ganesh Provisions';
const ENTITY_OTP = '123456', CUSTOMER_OTP = '123123';
const MENU = [
  ['Masala Dosa', 'plate', 90, 'Dosa'], ['Plain Dosa', 'plate', 70, 'Dosa'], ['Idli (2 pc)', 'plate', 50, 'Tiffin'], ['Medu Vada (2 pc)', 'plate', 55, 'Tiffin'],
  ['Pongal', 'plate', 65, 'Tiffin'], ['Upma', 'plate', 55, 'Tiffin'], ['Poori Masala', 'plate', 75, 'Tiffin'], ['Veg Meals', 'plate', 140, 'Meals'],
  ['Curd Rice', 'plate', 80, 'Meals'], ['Lemon Rice', 'plate', 70, 'Meals'], ['Veg Biryani', 'plate', 150, 'Meals'], ['Paneer Butter Masala', 'plate', 180, 'Curries'],
  ['Dal Tadka', 'bowl', 110, 'Curries'], ['Chapati (2 pc)', 'plate', 40, 'Breads'], ['Parotta', 'piece', 25, 'Breads'], ['Filter Coffee', 'cup', 30, 'Drinks'],
  ['Masala Tea', 'cup', 20, 'Drinks'], ['Fresh Lime Soda', 'glass', 45, 'Drinks'], ['Gulab Jamun (2 pc)', 'plate', 60, 'Sweets'], ['Payasam', 'cup', 50, 'Sweets'],
];
const PHOTOS = { 'Masala Dosa': [222, 160, 60], 'Veg Meals': [90, 160, 70], 'Filter Coffee': [110, 70, 40], 'Gulab Jamun (2 pc)': [150, 50, 40] };

const step = (s) => console.log('  · ' + s);
async function j(path, { method = 'GET', token, body } = {}) {
  const reply = await fetch(API + path, { method, headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}), body: body ? JSON.stringify(body) : undefined });
  let b = null; try { b = await reply.json(); } catch (_) { /* no body */ }
  return { status: reply.status, b: b || {} };
}
const must = (r, what) => { if (r.status >= 300) { console.error('seed failed at ' + what + ': HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 300)); process.exit(1); } return r; };

/** a small solid-colour PNG, built here so the seed needs no image file */
function png([r, g, b], size = 48) {
  const crc = (buf) => { let c, n, t = crc.t || (crc.t = Array.from({ length: 256 }, (_, i) => { c = i; for (n = 0; n < 8; n++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; })); c = 0xFFFFFFFF; for (const x of buf) c = t[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [r, g, b]).flat())]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: size }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
}

/* ───────────────────────────── --demo-month ─────────────────────────────
 * Opt-in (Athi, 2026-10-17: "keep first impression as the motto"): makes Mayur look like a shop that has traded, so every Home tile shows a
 * live number. Same rules as the rest of this file: the api's own routes only; a second run adds nothing (every record has a fixed
 * client_ref / name / note and is looked up first). A step whose route refuses is SKIPPED and listed at the end - it never aborts the rest.
 * Reuses: lib/item-cost.setCost (the cost shape) · lib/rollup (the counter's own day summary) - no second calculation.
 */
const DEMO_NOTE = 'demo-month';
const BILL_COUNT = 40;
const OPENING_STOCK = 200;
const skippedSteps = [];

async function tryStep(label, work) {
  try { await work(); } catch (failure) {
    skippedSteps.push(label + ': ' + (failure && failure.message));
    console.log('  ! skipped ' + label + ' - ' + (failure && failure.message));
  }
}
function expectOk(reply, what) {
  if (reply.status >= 300) throw new Error(what + ' HTTP ' + reply.status + ' ' + JSON.stringify(reply.b).slice(0, 200));
  return reply;
}
const menuUnit = (productName) => MENU.find((entry) => entry[0] === productName)[1];
const menuPrice = (productName) => MENU.find((entry) => entry[0] === productName)[2];
const costOfPrice = (price) => Math.round(price * 0.4);   /* a restaurant's food cost: about 40% of the menu price */

/* 1 · India, rupees; the financial year comes from the pack (the owner's step zero) */
async function demoSetCountry({ token }) {
  const current = expectOk(await j('/api/governance/country-setup', { token }), 'read country').b;
  if (current.done && current.country && current.country.code === 'IN') return step('country IN · INR · FY from April (already set)');
  const india = { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: false } };
  expectOk(await j('/api/governance/country-setup', { method: 'PUT', token, body: india }), 'set country');
  step('country IN · INR · FY from April');
}

/* 8 · the ledger, switched on before the bills so they post as they arrive */
async function demoSwitchBooksOn({ token }) {
  const status = expectOk(await j('/api/books/status', { token }), 'books status').b;
  if (status.enabled) return step('books already on');
  expectOk(await j('/api/books/enable', { method: 'POST', token, body: { walkin_grain: 'day' } }), 'enable books');
  step('books switched on');
}

/* 2 · a cost on 15 of the 20 products (Catalogue and Product Lab stop saying "no cost") */
async function demoAddCosts({ token, ids }) {
  const itemCost = require('../lib/item-cost');
  const products = expectOk(await j('/api/products?limit=500', { token }), 'list products').b.items || [];
  let added = 0;
  for (const [name, , price] of MENU.slice(0, 15)) {
    const product = products.find((row) => row.item_id === ids[name]);
    if (!product || (product.item_data || {}).cost) continue;
    const patch = { merge: true, item_data: itemCost.setCost(costOfPrice(price), 'manual', DEMO_NOTE) };
    expectOk(await j('/api/products/' + ids[name], { method: 'PATCH', token, body: patch }), 'cost of ' + name);
    added++;
  }
  step('costs on 15 products (' + added + ' new)');
}

/* 2 · a tax slab (the shop still charges none until it has a tax number - the slab is what Tax Lab lists) */
async function demoAddTaxSlab({ token }) {
  const slab = { kind: 'tax', name: 'GST 5% (restaurant)', note: DEMO_NOTE, status: 'live', rules: { rate: 5 } };
  const reply = await j('/api/definitions', { method: 'POST', token, body: slab });
  if (reply.status !== 409) expectOk(reply, 'tax slab');
  step('tax slab GST 5%' + (reply.status === 409 ? ' (already there)' : ''));
}

/** the same bill every run: a counter, a few dishes, cash or UPI, a fixed minute of the day - so a re-send is the bill already held */
function demoBillNumber(shop, sequence) {
  const counterId = 'C' + (sequence % 5 + 1);
  let randomState = sequence * 7919;
  const pick = (limit) => { randomState = (randomState * 1103515245 + 12345) & 0x7fffffff; return (randomState >> 8) % limit; };
  const lines = [];
  for (let dish = 0, dishes = 1 + pick(3); dish < dishes; dish++) {
    const name = MENU[pick(MENU.length)][0];
    if (!lines.some((line) => line.name === name)) lines.push({ name, qty: 1 + pick(3), price: menuPrice(name) });
  }
  const total = lines.reduce((sum, line) => sum + line.qty * line.price, 0);
  const tender = sequence % 3 === 0 ? 'upi' : 'cash';
  const paid = tender === 'cash' ? Math.ceil(total / 10) * 10 : total;
  const billedAt = new Date(shop.dayStart.getTime() + (60 + sequence * 5) * 60000).toISOString();
  const billNo = 'DM-' + shop.stamp + '-' + counterId + '-' + String(sequence).padStart(3, '0');
  return { counterId, billNo, lines, total, tender, paid, billedAt };
}
/** the chit the counter sends for a sale (tools/tally-connector/till.html chitOf) */
function demoBillChit(shop, bill) {
  const { counterId, billNo, lines, total, tender, paid } = bill;
  const subject = 'Counter sale ' + billNo;
  return { recipients: [{ self: true, name: 'self' }], purpose: 'order', subject, manual_subject: subject, client_ref: billNo,
    business_json: { customer: { name: 'Walk-in' }, till: { id: counterId, name: 'Counter ' + counterId.slice(1), host: 'browser' }, bill_no: billNo, billed_at: bill.billedAt,
      note: DEMO_NOTE, payment: { mode: tender, paid, change: paid - total, parts: [{ how: tender, amount: total }] }, slip: 'cash' },
    line_items: lines.map((line) => ({ particulars: line.name, quantity: line.qty, unit: menuUnit(line.name), price: line.price, total: line.qty * line.price, item_id: shop.ids[line.name] })) };
}
/** each counter's day summary - the chit the till sends at day end, built by the engine's own chitOf */
async function demoSendDaySummaries(shop, takingsByCounter) {
  const rollup = require('../lib/rollup');
  for (const counterId of Object.keys(takingsByCounter)) {
    const till = { id: counterId, name: 'Counter ' + counterId.slice(1) };
    const summary = rollup.summary('day', rollup.dayKey(shop.now), rollup.totals(takingsByCounter[counterId]), { till });
    const reply = await j('/api/chits/send', { method: 'POST', token: shop.token, body: rollup.chitOf(summary) });
    if (reply.status >= 300 && reply.status !== 409) expectOk(reply, 'day summary of ' + counterId);
  }
}
/* 3 · BILL_COUNT counter bills across C1-C5, posted the way the counter posts them (POST /api/chits/send) */
async function demoPostBills(shop) {
  const takingsByCounter = {};
  for (let sequence = 1; sequence <= BILL_COUNT; sequence++) {
    const bill = demoBillNumber(shop, sequence);
    expectOk(await j('/api/chits/send', { method: 'POST', token: shop.token, body: demoBillChit(shop, bill) }), 'bill ' + bill.billNo);
    (takingsByCounter[bill.counterId] = takingsByCounter[bill.counterId] || []).push({ total: bill.total, payments: [{ how: bill.tender, amount: bill.total }] });
  }
  await demoSendDaySummaries(shop, takingsByCounter);
  step(BILL_COUNT + ' counter bills C1-C5, cash and UPI, and the counters\' day summaries (a re-send is answered with the bill already held)');
}

/** a goods-in (the till's Receive screen, chitOfDoc kind receipt) of OPENING_STOCK of each product named */
function demoReceiptChit(reference, products) {
  const lines = products.map(([name, unit, price]) => ({ particulars: name, quantity: OPENING_STOCK, unit, price: costOfPrice(price), total: OPENING_STOCK * costOfPrice(price) }));
  const subject = 'Goods received - opening stock ' + reference;
  return { recipients: [{ self: true, name: 'self' }], purpose: 'receipt', subject, manual_subject: subject, client_ref: reference, line_items: lines,
    business_json: { doc: 'receipt', doc_no: reference, doc_at: new Date().toISOString(), note: DEMO_NOTE, till: { id: 'C1', name: 'Counter 1', host: 'browser' }, party: { name: 'Opening stock' } } };
}
/* 4 · opening stock, so the shelf shows what the month sold from */
async function demoOpeningStock({ token, ids, stamp }) {
  const reference = 'OPEN-' + stamp;
  const withItemIds = (chit) => Object.assign(chit, { line_items: chit.line_items.map((line, index) => Object.assign(line, { item_data: { item_id: ids[MENU[index][0]] } })) });
  expectOk(await j('/api/chits/send', { method: 'POST', token, body: withItemIds(demoReceiptChit(reference, MENU)) }), 'opening stock');
  /* a balance counts in ONE unit (the stock ledger refuses a second): a product whose earlier sales were counted in another unit still shows
     nothing on hand - receive that one in the unit it is counted in */
  const onHand = expectOk(await j('/api/till/stock', { token }), 'stock read').b.balances || {};
  const missing = MENU.filter(([name]) => !(onHand[ids[name]] && onHand[ids[name]].qty > 0));
  if (missing.length) {
    const inPlates = demoReceiptChit(reference + '-b', missing.map(([name, , price]) => [name, 'plate', price]));
    inPlates.line_items.forEach((line, index) => { line.item_data = { item_id: ids[missing[index][0]] }; });
    expectOk(await j('/api/chits/send', { method: 'POST', token, body: inPlates }), 'opening stock (second unit)');
  }
  step('opening stock: ' + OPENING_STOCK + ' of each of ' + MENU.length + ' products on the shelf' + (missing.length ? ' (' + missing.length + ' in the unit their sales used)' : ''));
}

/** Sri Ganesh Provisions as a shop on the rail: registers, signs in, and is put on Mayur's supplier list so the books can post its bill */
async function demoSupplierShop({ token }) {
  const supplier = { email: 'ganesh@local.test', display_name: SUPPLIER, user_id: 'sri-ganesh' };
  expectOk(await j('/api/entities/register', { method: 'POST', body: supplier }), 'supplier register');
  const signedIn = expectOk(await j('/api/entities/verify', { method: 'POST', body: { email: supplier.email, otp: ENTITY_OTP } }), 'supplier verify');
  const listed = await j('/api/relationships/suppliers', { method: 'POST', token, body: { supplier_bridge_id: signedIn.b.entity.bridge_id, supply_kind: 'resale' } });
  if (listed.status !== 409) expectOk(listed, 'supplier on the list');
  return signedIn.b.token;
}
const SUPPLIER_GOODS = [['Parotta', 'piece', 60, 12], ['Gulab Jamun (2 pc)', 'plate', 30, 28], ['Payasam', 'cup', 30, 22], ['Fresh Lime Soda', 'glass', 40, 18]];
/* 4 · one bill RECEIVED from the seeded supplier: resale chosen, goods counted in (which accepts it) */
async function demoSupplierBill(shop) {
  const supplierToken = await demoSupplierShop(shop);
  const reference = 'SG-' + shop.stamp + '-001';
  const invoice = { recipients: [{ display_name: SHOP.name, bridge_id: shop.bridge, kind: 'to' }], purpose: 'invoice', subject: 'Invoice ' + reference, manual_subject: 'Invoice ' + reference, client_ref: reference,
    business_json: { bill_no: reference, billed_at: shop.dayStart.toISOString(), note: DEMO_NOTE },
    line_items: SUPPLIER_GOODS.map(([name, unit, quantity, rate]) => ({ particulars: name, quantity, unit, price: rate, total: quantity * rate })) };
  const sent = expectOk(await j('/api/chits/send', { method: 'POST', token: supplierToken, body: invoice }), 'supplier sends the bill');
  const mine = expectOk(await j('/api/chits/' + sent.b.chit_id, { token: shop.token }), 'read the received bill').b;
  if ((mine.state_log || []).some((entry) => entry.step === 'accepted')) {
    await j('/api/books/outbox/retry', { method: 'POST', token: shop.token });   /* a bill held back until the supplier was on the list posts now */
    return step('supplier bill ' + reference + ' (already accepted)');
  }
  const lineIds = ((mine.detail && mine.detail.line_items) || []).map((line) => line.line_id);
  expectOk(await j('/api/chits/' + sent.b.chit_id + '/use', { method: 'PUT', token: shop.token, body: { use: 'resale' } }), 'bill use = resale');
  const counted = SUPPLIER_GOODS.map(([, unit, quantity], index) => ({ line_id: lineIds[index], quantity, unit, client_ref: reference + ':' + index }));
  expectOk(await j('/api/chits/' + sent.b.chit_id + '/deliver-lines', { method: 'POST', token: shop.token, body: { rows: counted } }), 'goods in');
  step('bill ' + reference + ' from ' + SUPPLIER + ': resale, accepted, ' + SUPPLIER_GOODS.length + ' lines counted in');
}

/* 5 · an open order from Priya through the storefront's own order door */
async function demoCustomerOrder({ bridge, ids }) {
  const door = '/api/catalogue/' + bridge;
  const contact = { email: CUSTOMER.email, name: CUSTOMER.name };
  expectOk(await j(door + '/order/start', { method: 'POST', body: contact }), 'customer start');
  const signedIn = expectOk(await j(door + '/login/verify', { method: 'POST', body: { email: CUSTOMER.email, otp: CUSTOMER_OTP } }), 'customer sign-in');
  const placed = expectOk(await j(door + '/my-orders', { token: signedIn.b.token }), 'customer orders').b.orders || [];
  if (placed.length) return step('the order from ' + CUSTOMER.email + ' (already placed)');
  expectOk(await j(door + '/order/start', { method: 'POST', body: contact }), 'customer start again (signing in spent the first code)');
  const basket = [['Veg Biryani', 2], ['Filter Coffee', 2], ['Gulab Jamun (2 pc)', 1]].map(([name, quantity]) => ({ item_id: ids[name], quantity }));
  const order = expectOk(await j(door + '/order/confirm', { method: 'POST', body: { email: CUSTOMER.email, otp: CUSTOMER_OTP, line_items: basket } }), 'customer order');
  step('open order from ' + CUSTOMER.email + ' ' + (order.b.chit_id || ''));
}
/* 5 · one task for the staff login */
async function demoStaffTask({ token }) {
  const staff = (expectOk(await j('/api/actors', { token }), 'list staff').b.actors || []).find((actor) => actor.actor_key === STAFF.key);
  if (!staff) throw new Error('no staff login ' + STAFF.key);
  const subject = 'Restock dosa batter before the evening rush';
  const task = { recipients: [{ self: true, name: 'self' }], purpose: 'general', subject, manual_subject: subject, client_ref: 'DM-TASK-1', business_json: { note: DEMO_NOTE }, line_items: [] };
  const sent = expectOk(await j('/api/chits/send', { method: 'POST', token, body: task }), 'task');
  if (sent.b.duplicate && staff.current_task_count > 0) return step('task for ' + STAFF.key + ' (already there)');
  expectOk(await j('/api/chits/assign-bulk', { method: 'POST', token, body: { chit_ids: [sent.b.chit_id], target_actor_id: staff.identity_id } }), 'assign the task');
  step('task "Restock dosa batter" assigned to ' + STAFF.key);
}

const DEMO_CUSTOMERS = [['Ravi Kumar', '9876500001'], ['Meena Iyer', '9876500002'], ['Karthik S', '9876500003']];
/** the three customers' party ids: added now, or (a re-run) read off the shop's own list */
async function demoCustomerIds({ token }) {
  const partyIds = {};
  for (const [name, phone] of DEMO_CUSTOMERS) {
    const added = await j('/api/crm/walk-ins/add', { method: 'POST', token, body: { name, phone } });
    if (added.status === 201) partyIds[name] = added.b.party.party_id; else if (added.status !== 409) expectOk(added, 'add customer ' + name);
  }
  if (DEMO_CUSTOMERS.every(([name]) => partyIds[name])) return partyIds;
  const list = expectOk(await j('/api/crm/parties?limit=200', { token }), 'list parties').b;
  for (const party of (list.parties || list.items || list.rows || [])) if (party.display_name && !partyIds[party.display_name]) partyIds[party.display_name] = party.party_id || party.identity_id;
  return partyIds;
}
/* 6 · two of them agreed to offers: one consent row each, the append-only record of what they said */
async function demoConsent(shop) {
  shop.partyIds = await demoCustomerIds(shop);
  let recorded = 0;
  for (const name of ['Ravi Kumar', 'Meena Iyer']) {
    const partyId = shop.partyIds[name];
    if (!partyId) throw new Error('no party id for ' + name);
    const earlier = expectOk(await j('/api/crm/parties/' + partyId + '/contact-prefs', { token: shop.token }), 'read consent').b;
    if ((earlier.history || []).some((row) => row.purpose === 'marketing' && row.allowed)) continue;
    const agreed = { channel: 'whatsapp', purpose: 'marketing', allowed: true, basis: 'consent' };
    expectOk(await j('/api/crm/parties/' + partyId + '/contact-prefs', { method: 'POST', token: shop.token, body: agreed }), 'consent of ' + name);
    recorded++;
  }
  step('3 customers on the list, 2 agreed to offers (' + recorded + ' new)');
}

/* 7 · one Offer Lab draft */
async function demoOfferDraft({ token, ids }) {
  const draft = { kind: 'offer', sub_kind: 'percent_off', name: 'Lunch 10% off Meals', note: DEMO_NOTE, status: 'draft', rules: { percent: 10, item_ids: [ids['Veg Meals']] } };
  const reply = await j('/api/definitions', { method: 'POST', token, body: draft });
  if (reply.status !== 409) expectOk(reply, 'offer draft');
  step('Offer Lab draft "Lunch 10% off Meals"' + (reply.status === 409 ? ' (already there)' : ''));
}
/* 7 · one Combo Lab saved set */
async function demoComboSet({ token }) {
  const saved = expectOk(await j('/api/combo-templates', { token }), 'list combos').b.templates || [];
  if (saved.some((template) => template.name === 'Tiffin combo')) return step('Combo Lab set (already saved)');
  const groups = [{ name: 'Pick a tiffin', options: [{ name: 'Masala Dosa', price: 0 }, { name: 'Idli (2 pc)', price: 0 }, { name: 'Pongal', price: 5 }] },
    { name: 'Pick a drink', options: [{ name: 'Filter Coffee', price: 0 }, { name: 'Masala Tea', price: 0 }] }];
  expectOk(await j('/api/combo-templates', { method: 'POST', token, body: { name: 'Tiffin combo', price: 99, definition: groups } }), 'combo set');
  step('Combo Lab set "Tiffin combo"');
}

/* 8 · a cheque from a customer (Finance), and the ledger's own check (Accounts shows it ran) */
async function demoCheque({ token, partyIds }) {
  const customerId = partyIds && partyIds['Ravi Kumar'];
  if (!customerId) throw new Error('no customer to take the cheque from');
  const chequeDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const payment = { party_id: customerId, direction: 'in', amount_minor: 450000, currency: 'INR', mode: 'cheque', cheque: { number: '000417', bank: 'SBI', date: chequeDate },
    client_ref: 'DM-CHQ-1', allocate: 'none', acknowledge: ['ALREADY_PAID'] };
  expectOk(await j('/api/books/payments', { method: 'POST', token, body: payment }), 'cheque');
  step('cheque 000417 from Ravi Kumar, Rs 4,500 (a re-run is answered with the first)');
}
async function demoLedgerCheck({ token }) {
  expectOk(await j('/api/books/check', { method: 'POST', token, body: {} }), 'books check');
  step('ledger check run');
}

const DEMO_STEPS = [['1 country', demoSetCountry], ['8 books', demoSwitchBooksOn], ['2 costs', demoAddCosts], ['2 tax slab', demoAddTaxSlab], ['3 bills', demoPostBills],
  ['4 opening stock', demoOpeningStock], ['4 supplier bill', demoSupplierBill], ['5 order', demoCustomerOrder], ['5 task', demoStaffTask], ['6 consent', demoConsent],
  ['7 offer draft', demoOfferDraft], ['7 combo set', demoComboSet], ['8 cheque', demoCheque], ['8 ledger check', demoLedgerCheck]];
async function demoMonth({ token, bridge, ids }) {
  console.log('  ── demo month ──');
  const now = new Date(), dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const shop = { token, bridge, ids, now, dayStart, stamp: dayStart.toISOString().slice(0, 10).replace(/-/g, ''), partyIds: null };
  for (const [label, work] of DEMO_STEPS) await tryStep(label, () => work(shop));
  console.log(skippedSteps.length ? '  skipped: ' + skippedSteps.join(' | ') : '  nothing skipped');
}

(async () => {
  console.log('\n── seeding the local test shop (' + API + ') ──');
  const health = await j('/health'); must(health, 'health');

  /* the shop: register is also sign-in (the code is the dev one), so a second run just signs in */
  must(await j('/api/entities/register', { method: 'POST', body: { email: SHOP.email, display_name: SHOP.name } }), 'shop register');
  const ver = must(await j('/api/entities/verify', { method: 'POST', body: { email: SHOP.email, otp: ENTITY_OTP } }), 'shop verify (is DEV_OTP armed?)');
  const token = ver.b.token, bridge = ver.b.entity.bridge_id, userId = ver.b.identity.user_id;
  step('shop ' + SHOP.name + ' · bridge ' + bridge + ' · user id ' + userId);
  must(await j('/api/entities/profile', { method: 'PATCH', token, body: { catalogue_visibility: 'public' } }), 'publish the storefront');

  /* products — by name, so a re-run adds nothing */
  const have = must(await j('/api/products?limit=500', { token }), 'list products');
  const rows = have.b.items || have.b.products || have.b.rows || [];
  const byName = new Map(rows.map((x) => [String((x.item_data || x).name || '').toLowerCase(), x.item_id || x.id]));
  let added = 0; const ids = {};
  for (const [name, unit, price, category] of MENU) {
    let id = byName.get(name.toLowerCase());
    if (!id) { const r = must(await j('/api/products', { method: 'POST', token, body: { item_data: { name, unit, price, category } } }), 'add ' + name); id = r.b.item.item_id; added++; }
    ids[name] = id;
  }
  step(MENU.length + ' products (' + added + ' new)');
  let photos = 0;
  for (const [name, rgb] of Object.entries(PHOTOS)) {
    const cur = rows.find((x) => (x.item_id || x.id) === ids[name]);
    if (cur && ((cur.item_data || {}).media || []).length) continue;
    must(await j('/api/products/' + ids[name] + '/media', { method: 'POST', token, body: { name: name + '.png', mime: 'image/png', data_base64: png(rgb).toString('base64') } }), 'photo ' + name);
    photos++;
  }
  step(Object.keys(PHOTOS).length + ' products with a photo (' + photos + ' new)');

  /* counters C1..C5 — the api hands out the lowest free number, so five creates give C5 */
  let counters = must(await j('/api/counters', { token }), 'list counters').b.counters || [];
  while (!counters.some((item) => item.id === 'C5')) {
    const r = must(await j('/api/counters', { method: 'POST', token, body: { name: 'Counter ' + (counters.length + 1) } }), 'add counter');
    counters = counters.concat([r.b.counter]);
  }
  step('counters ' + counters.map((item) => item.id).join(' '));

  /* the staff login: created with a one-time code, signs in with it, sets a PIN, then signs in with the PIN */
  const login = STAFF.key + '@' + userId;
  const made = await j('/api/actors', { method: 'POST', token, body: { display_name: STAFF.name, actor_key: STAFF.key, actor_role: 'Cashier', hat: 'act' } });
  if (made.status >= 300 && !/exist|taken|already|duplicate/i.test(JSON.stringify(made.b))) must(made, 'create staff');
  const pinIn = await j('/api/actors/login', { method: 'POST', body: { username: login, pin: STAFF.pin } });
  if (pinIn.status !== 200) {
    /* a re-run finds the first code spent: the owner issues a fresh one (the same act as "Reset PIN"), and with DEV_OTP armed it is the fixed entity code */
    let code = made.b.otp;
    if (!code) {
      const list = must(await j('/api/actors', { token }), 'list staff').b;
      const me = (list.actors || list.rows || list || []).find((item) => item.actor_key === STAFF.key);
      must(await j('/api/actors/' + me.identity_id + '/otp', { method: 'POST', token }), 'fresh staff code'); code = ENTITY_OTP;
    }
    const otpIn = must(await j('/api/actors/login', { method: 'POST', body: { username: login, otp: code } }), 'staff login with the code');
    const set = await j('/api/actors/set-pin', { method: 'POST', token: otpIn.b.token, body: { pin: STAFF.pin, confirm_pin: STAFF.pin } });
    must(set, 'staff set PIN');
    must(await j('/api/actors/login', { method: 'POST', body: { username: login, pin: STAFF.pin } }), 'staff login with the PIN');
  }
  step('staff ' + login + ' · PIN ' + STAFF.pin);

  const sup = await j('/api/relationships/suppliers', { method: 'POST', token, body: { name: SUPPLIER } });
  if (sup.status !== 409) must(sup, 'supplier');   // 409 = already in the list: a re-run
  step('supplier ' + SUPPLIER);

  /* the customer: a first storefront order creates them; a re-run signs them in instead */
  const start = must(await j('/api/catalogue/' + bridge + '/order/start', { method: 'POST', body: { email: CUSTOMER.email, name: CUSTOMER.name } }), 'customer start');
  const sig = await j('/api/catalogue/' + bridge + '/login/verify', { method: 'POST', body: { email: CUSTOMER.email, otp: CUSTOMER_OTP } });
  if (sig.status === 200) step('customer ' + CUSTOMER.email + ' (already exists)');
  else {
    const order = must(await j('/api/catalogue/' + bridge + '/order/confirm', { method: 'POST', body: { email: CUSTOMER.email, otp: CUSTOMER_OTP, line_items: [{ item_id: ids['Masala Dosa'], quantity: 2 }] } }), 'customer first order');
    step('customer ' + CUSTOMER.email + ' · first order ' + (order.b.chit_id || ''));
  }
  void start;

  if (process.argv.includes('--demo-month')) await demoMonth({ token, bridge, ids });
  console.log('── seed done. shop bridge id ' + bridge + ' ──\n');
})().catch((e) => { console.error('seed failed:', e && e.message); process.exit(1); });
