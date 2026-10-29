'use strict';
/**
 * tests/lib/truth-harness.cjs — THE ONE HARNESS every `tests/<box>-truth.realstack.cjs` shares (K-TRUTH-1, 2026-10-19).
 *
 * owns: the local-only guard · the doors (j/ok) · the case runner with the `gap:` marker · expect/near · a fresh test shop.
 * called by: tests/stock-truth.realstack.cjs, tests/rail-truth.realstack.cjs (and each later box file: one file per box).
 * Lifted out of stock-truth (widen, never copy). A case whose expected result is the PRINCIPLE (not today's code) carries
 * `gap:` — a FAIL there is a RECORDED finding (RAIL-BACKLOG / toolset/known-failing.json), never a quiet fix inside the test.
 *
 * ⚠️ LOCAL ONLY: refuses any api that is not on this machine and any database that is not the local container. Writes go
 * through routes; the database is read with SELECT (a case that must ARM a precondition says so in its own words).
 * CARD 01-rail-core-the-chit/README
 */
const API = (process.env.API_BASE || 'http://127.0.0.1:3100').replace(/\/$/, '');
const DB = process.env.TRUTH_DB || process.env.STOCK_DB || 'postgres://postgres:cblocal@127.0.0.1:55432/cb_local';
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(API)) { console.error('REFUSED: local api only, not ' + API); process.exit(3); }
if (!/@(127\.0\.0\.1|localhost):55432\//.test(DB)) { console.error('REFUSED: local database only'); process.exit(3); }

const ENTITY_OTP = '123456', CUSTOMER_OTP = '123123';   /* lib/dev-otp.js */
const results = [];

/** the doors (the seed's own j()); an unsigned write is a public door, each call its own attempt with its own Idempotency-Key (API-3 S36) */
async function j(path, { method = 'GET', token, body } = {}) {
  const once = !token && method !== 'GET' ? { 'idempotency-key': crypto.randomUUID() } : {};
  const r = await fetch(API + path, { method, headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}, once), body: body ? JSON.stringify(body) : undefined });
  let b = null; try { b = await r.json(); } catch (_) { /* a reply with no JSON body (bytes, 204) is read as {} */ }
  return { status: r.status, b: b || {} };
}
function ok(reply, what) { if (reply.status >= 300) throw new Error(what + ': HTTP ' + reply.status + ' ' + JSON.stringify(reply.b).slice(0, 240)); return reply; }
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

/** the case runner: an expectation that fails is recorded with what was seen */
async function kase(id, title, fn, gap) {
  try { const seen = await fn(); results.push({ id, title, pass: true, seen: seen || '', gap }); console.log('  ok   ' + id + ' ' + title); }
  catch (e) { results.push({ id, title, pass: false, seen: e.message, gap }); console.log('  FAIL ' + id + ' ' + title + (gap ? '  [gap: ' + gap + ']' : '') + '\n         ' + e.message); }
}
function expect(cond, said) { if (!cond) throw new Error(said); }
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-6;

/** the chits a counter and goods-in send (shapes: seed-local demoBillChit / demoReceiptChit; till.html chitOfCN / chitOfDoc) */
const line = (p, qty, unit, price) => ({ particulars: p.name, quantity: qty, unit: unit || p.unit, price, total: qty * price });
function receipt(no, rows, at) {
  return { recipients: [{ self: true, name: 'self' }], purpose: 'receipt', subject: 'Goods received ' + no, manual_subject: 'Goods received ' + no, client_ref: no,
    business_json: { doc: 'receipt', doc_no: no, doc_at: at || new Date().toISOString(), party: { name: 'Stock truth supplier' } },
    line_items: rows.map(([p, qty, cost, unit]) => Object.assign(line(p, qty, unit, cost), { item_data: { item_id: p.id } })) };
}
function bill(no, rows, billedAt) {
  const total = rows.reduce((a, [p, qty]) => a + qty * p.price, 0);
  return { recipients: [{ self: true, name: 'self' }], purpose: 'order', subject: 'Counter sale ' + no, manual_subject: 'Counter sale ' + no, client_ref: no,
    business_json: { customer: { name: 'Walk-in' }, till: { id: 'C1', name: 'Counter 1', host: 'browser' }, bill_no: no, billed_at: billedAt || new Date().toISOString(),
      payment: { mode: 'cash', paid: total, change: 0, parts: [{ how: 'cash', amount: total }] }, slip: 'cash' },
    line_items: rows.map(([p, qty]) => Object.assign(line(p, qty, p.unit, p.price), { item_id: p.id })) };
}
function creditNote(no, against, rows) {
  const total = rows.reduce((a, [p, qty]) => a + qty * p.price, 0);
  return { recipients: [{ self: true, name: 'self' }], purpose: 'credit_note', subject: 'Credit note ' + no, manual_subject: 'Credit note ' + no, client_ref: no,
    business_json: { customer: { name: 'Walk-in' }, till: { id: 'C1', name: 'Counter 1', host: 'browser' }, doc: 'credit_note', slip: 'credit_note', bill_no: no,
      billed_at: new Date().toISOString(), against: { bill_no: against }, reason: 'returned', refund: { parts: [{ how: 'cash', amount: total }], total } },
    line_items: rows.map(([p, qty]) => Object.assign(line(p, qty, p.unit, p.price), { item_id: p.id })) };
}
/** a fresh shop made for this run: register → verify with the dev code → country. `tag` keeps User IDs apart (≤ 20 chars).
 *  `opts.tax`: tax registration is NEVER assumed (DECISIONS 2026-10-29) — left out, the shop's tax stays UNKNOWN; a test that means "not registered"
 *  says so: freshShop(tag, label, { tax: { registered: false } }). (Today's route stores an absent tax as registered:false — SET-38, settings area.) */
async function freshShop(tag, label, opts) {
  const email = tag + '@local.test';
  ok(await j('/api/entities/register', { method: 'POST', body: { email, display_name: label + ' ' + tag, user_id: tag } }), 'register');
  const v = ok(await j('/api/entities/verify', { method: 'POST', body: { email, otp: ENTITY_OTP } }), 'verify (is DEV_OTP armed?)').b;
  const entity = (v.entity && (v.entity.identity_id || v.entity.entity_id)) || (v.identity && v.identity.identity_id);
  const shop = { token: v.token, bridge: v.entity.bridge_id, entity, name: label + ' ' + tag, products: {} };
  ok(await j('/api/entities/profile', { method: 'PATCH', token: shop.token, body: { catalogue_visibility: 'public' } }), 'publish');
  ok(await j('/api/governance/country-setup', { method: 'PUT', token: shop.token, body: Object.assign({ country: 'IN', currency: 'INR', fy_start_month: 4 }, opts && opts.tax ? { tax: opts.tax } : {}) }), 'country');
  return shop;
}

/** the closing line + optional JSON file (env var named by the caller) */
function finish(label, jsonFile, extra) {
  const pass = results.filter((r) => r.pass).length, fail = results.length - pass;
  console.log('\n── ' + results.length + ' cases · ' + pass + ' pass · ' + fail + ' fail (' + results.filter((r) => !r.pass && r.gap).length + ' of them known gaps) ──');
  if (jsonFile) require('fs').writeFileSync(jsonFile, JSON.stringify(Object.assign({ label, results }, extra || {}), null, 2));
  /* a FAIL on a case without a `gap:` marker is a real red; known gaps are recorded, not red */
  process.exitCode = results.some((r) => !r.pass && !r.gap) ? 1 : 0;
}

module.exports = { API, DB, ENTITY_OTP, CUSTOMER_OTP, results, j, ok, pause, kase, expect, near, line, receipt, bill, creditNote, freshShop, finish };
