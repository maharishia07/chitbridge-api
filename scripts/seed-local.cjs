'use strict';
/**
 * scripts/seed-local.cjs — ONE test shop on a LOCAL api (toolset/local-stack.sh `up` runs this). Idempotent: run it twice, get one shop.
 *
 *   Mayur Restaurant — a restaurant on the storefront, 20 products (4 with photos), counters C1–C5, one staff login with a PIN,
 *   one local supplier, one customer. Everything goes through the api's own routes (no direct SQL), so the shape is whatever the
 *   routes make — nothing here can drift from them.
 *
 * ⚠️ DEV_OTP must be armed on the server (lib/dev-otp.js: 123456 entity · 123123 customer). Refuses any api that is not on this machine.
 * Run: API_BASE=http://127.0.0.1:3100 node scripts/seed-local.cjs
 */
const zlib = require('zlib');
const API = (process.env.API_BASE || 'http://127.0.0.1:3100').replace(/\/$/, '');
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(API)) { console.error('REFUSED: seed-local only seeds an api on this machine, not ' + API); process.exit(3); }

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
  const r = await fetch(API + path, { method, headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}), body: body ? JSON.stringify(body) : undefined });
  let b = null; try { b = await r.json(); } catch (_) { /* no body */ }
  return { status: r.status, b: b || {} };
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
  while (!counters.some((c) => c.id === 'C5')) {
    const r = must(await j('/api/counters', { method: 'POST', token, body: { name: 'Counter ' + (counters.length + 1) } }), 'add counter');
    counters = counters.concat([r.b.counter]);
  }
  step('counters ' + counters.map((c) => c.id).join(' '));

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
      const me = (list.actors || list.rows || list || []).find((a) => a.actor_key === STAFF.key);
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
  console.log('── seed done. shop bridge id ' + bridge + ' ──\n');
})().catch((e) => { console.error('seed failed:', e && e.message); process.exit(1); });
