/**
 * prove.js — THE CONNECTOR LOOP ON ONE MACHINE, against a fake Tally and the LIVE ChitBridge API.
 *   CB_TOKEN=<a session token> node prove.js [api]
 * Mints a connector key with the session, starts fake-tally on a free port, syncs its three items to the catalogue,
 * evaluates a basket through the key, places a storefront order for one item (the customer rail, dev OTP), runs the
 * catch-up, and checks the voucher reached the fake Tally exactly once — then runs the catch-up again (no duplicate),
 * marks the chit paid through the API and checks ONE Receipt voucher reached the fake Tally (and not twice), and revokes
 * the key. Prints PASS/FAIL per step. Leaves the products behind (the shared test account accumulates —
 * a known cost); the key is revoked; the receipts file is temporary.
 */
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const core = require('./core');

const API = (process.argv[2] || process.env.CB_API || 'https://chitbridge-api-production.up.railway.app').replace(/\/$/, '');
const TOKEN = process.env.CB_TOKEN; if (!TOKEN) { console.error('CB_TOKEN (a session token) is required'); process.exit(2); }
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS ' + m); } else { fail++; console.log('FAIL ' + m); } };
async function session(method, p, body) { const r = await fetch(API + p, { method, headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch (_) { j = { raw: t }; } return { status: r.status, j }; }
async function pub(method, p, body) { const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch (_) { j = { raw: t }; } return { status: r.status, j }; }

(async () => {
  /* 0 · a fake Tally on a free port */
  const port = 9100 + Math.floor(Math.random() * 400);
  const fake = spawn(process.execPath, [path.join(__dirname, 'fake-tally.js'), String(port)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-conn-'));
  let jti = null;
  try {
    /* 1 · a connector key, minted by the session */
    const k = await session('POST', '/api/keys', { name: 'prove.js', scopes: ['connector', 'offers'], days: 1 });
    ok(k.status === 201 && k.j.key, 'key minted (' + k.status + ')'); jti = k.j.jti;
    const key = k.j.key;
    const cfg = { api: API, key, adapter: 'tally', tally: { url: 'http://localhost:' + port, partyLedger: 'Cash', salesLedger: 'Sales' }, receipts: path.join(tmp, 'receipts.jsonl') };
    const log = (m) => console.log('   · ' + m);
    const cb = new core.CB({ api: API, key, log });
    /* a credit party, so the Receipt step has something to book (a cash sale books none — that is a PASS of another kind) */
    const adapter = require('./adapters/tally')(Object.assign({ log }, cfg, { tally: Object.assign({}, cfg.tally || {}, { partyLedger: 'Prove Customer', bankLedger: 'Prove Bank' }) }));
    const receipts = new core.Receipts(cfg.receipts);

    /* 2 · products up, twice: added then unchanged */
    const s1 = await core.syncProducts({ cb, adapter, receipts, log });
    ok(s1.read === 3 && s1.failed === 0 && (s1.added + s1.updated) >= 1, 'products up: read 3 · added ' + s1.added + ' · updated ' + s1.updated + ' · failed ' + s1.failed);
    const s2 = await core.syncProducts({ cb, adapter, receipts, log });
    ok(s2.unchanged === 3, 'second sync: unchanged 3 (receipts)');

    /* 3 · offers back through the key */
    const ev = await core.evaluate({ cb, lines: [{ key: 'a', item_id: 'A', qty: 2, unitPrice: 100 }, { key: 'b', item_id: 'B', qty: 1, unitPrice: 50 }], offers: [{ id: 'o1', label: 'Rice+oil', kind: 'bundle_price', bundle_items: ['A', 'B'], bundle_price: 120 }] });
    ok(ev.total === 220 && ev.explain && ev.explain.length === 2, 'offers back: 250 → ' + ev.total + ' with ' + (ev.explain || []).length + ' reasons');

    /* 4 · a storefront order for Basmati 25kg (the customer rail, dev OTP) */
    await session('PATCH', '/api/entities/profile', { catalogue_visibility: 'public' });   /* the storefront must be public to be ordered from */
    const me = await session('GET', '/api/entities/me'); const ent = me.j.entity || me.j; const handle = ent.user_id || ent.bridge_id;
    const cat = await pub('GET', '/api/catalogue/' + encodeURIComponent(handle));
    const item = (cat.j.items || []).find((x) => /BAS-25/i.test(String((x.item_data || {}).code || '')) || /Basmati 25kg/i.test(String((x.item_data || {}).name || '')));
    ok(cat.status === 200 && item, 'storefront serves the synced product (' + cat.status + ')');
    const ident = 'prove' + Date.now().toString().slice(-6) + '@example.com';
    const st = await pub('POST', '/api/catalogue/' + encodeURIComponent(handle) + '/order/start', { identifier: ident, name: 'Prove Buyer' });
    const otp = (st.j && st.j.dev_otp) || process.env.CB_CUSTOMER_OTP || '123123';
    const cf = await pub('POST', '/api/catalogue/' + encodeURIComponent(handle) + '/order/confirm', { identifier: ident, name: 'Prove Buyer', otp, location: 'Chennai', line_items: [{ kind: 'product', item_id: item && item.item_id, name: (item && item.item_data && item.item_data.name) || 'Basmati 25kg', quantity: 6 }] });
    ok(cf.status < 300 && cf.j.chit_id, 'order placed (' + cf.status + ') ' + String(cf.j.chit_id || cf.j.message || JSON.stringify(cf.j).slice(0, 120)));
    const chitId = cf.j.chit_id;

    /* 5 · orders down: the catch-up pushes it to Tally once */
    await new Promise((r) => setTimeout(r, 1500));
    const c1 = await core.catchUp({ cb, adapter, receipts, log });
    const mine = c1.find((x) => x.chit_id === chitId);
    ok(mine && mine.outcome === 'ok', 'catch-up pushed the order: ' + JSON.stringify(mine));
    const v1 = await new Promise((r) => http.get('http://localhost:' + port + '/_vouchers', (res) => { let b = ''; res.on('data', (c) => b += c); res.on('end', () => r(JSON.parse(b))); }));
    const vch = v1.find((v) => v.ref === 'CB-' + String(chitId).slice(0, 8));
    ok(vch && vch.items.length === 1 && /6 bag/.test(vch.items[0].qty), 'the voucher is in Tally: ' + JSON.stringify(vch && vch.items));
    const c2 = await core.catchUp({ cb, adapter, receipts, log });
    const again = c2.find((x) => x.chit_id === chitId);
    const v2 = await new Promise((r) => http.get('http://localhost:' + port + '/_vouchers', (res) => { let b = ''; res.on('data', (c) => b += c); res.on('end', () => r(JSON.parse(b))); }));
    ok(again && again.outcome === 'duplicate' && v2.length === v1.length, 'second catch-up: duplicate, no second voucher');

    /* 5b · the payment loop: Mark paid (session) → the Receipt voucher, once; above the quote → refused */
    const over = await session('POST', '/api/chits/' + chitId + '/payment', { method: 'upi', ref: 'PROVE-OVER', amount: 999999 });
    ok(over.status === 422, 'a payment far above the quote is refused (' + over.status + ')');
    const paid = await session('POST', '/api/chits/' + chitId + '/payment', { method: 'upi', ref: 'PROVE-UPI-1' });
    ok(paid.status === 200 && paid.j.payment && paid.j.payment.method === 'upi', 'marked paid (' + paid.status + ')');
    const r1 = await core.pushReceipt({ cb, adapter, receipts, log, chit_id: chitId });
    const v3 = await new Promise((r) => http.get('http://localhost:' + port + '/_vouchers', (res) => { let b = ''; res.on('data', (c) => b += c); res.on('end', () => r(JSON.parse(b))); }));
    const rcpt = v3.find((v) => v.vtype === 'Receipt' && v.ref === 'CB-' + String(chitId).slice(0, 8));
    ok(r1.outcome === 'ok' && rcpt && rcpt.ledgers.some((l) => l.ledger === 'Prove Bank' && l.dr) && rcpt.ledgers.some((l) => l.ledger === 'Prove Customer' && !l.dr), 'the Receipt voucher is in Tally: ' + JSON.stringify(rcpt && rcpt.ledgers));
    const r2 = await core.pushReceipt({ cb, adapter, receipts, log, chit_id: chitId });
    const v4 = await new Promise((r) => http.get('http://localhost:' + port + '/_vouchers', (res) => { let b = ''; res.on('data', (c) => b += c); res.on('end', () => r(JSON.parse(b))); }));
    ok(r2.outcome === 'duplicate' && v4.length === v3.length, 'second receipt push: duplicate, no second voucher');

    /* 6 · the key cannot reach a session-only route */
    const bad = await fetch(API + '/api/keys', { headers: { 'X-Api-Key': key } });
    ok(bad.status === 403, 'the key cannot manage keys (' + bad.status + ')');
  } catch (e) { fail++; console.log('FAIL exception: ' + (e && e.message)); }
  finally {
    if (jti) { const d = await session('DELETE', '/api/keys/' + jti); ok(d.status === 200, 'key revoked (' + d.status + ')'); }
    try { fake.kill(); } catch (_) {}
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
    console.log((fail ? 'RED ' : 'GREEN ') + pass + ' passed · ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
  }
})();
