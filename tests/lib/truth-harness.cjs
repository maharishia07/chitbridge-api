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
/** the options a bill or a credit note may carry (LIFECYCLE-B3, widened never copied): a third argument that is a string stays `billedAt` for the older callers */
function billOpts(o) { return typeof o === 'string' ? { billedAt: o } : o || {}; }
/** a counter line: `discount` (the offer's saving, till.html `save`) lowers `total` and rides as `offer`; `gst_rate` and `hsn` travel when given (till chitOf) */
function billLine(row) {
  const [p, qty, discount] = row, l = Object.assign(line(p, qty, p.unit, p.price), { item_id: p.id });
  if (p.gst_rate !== undefined) l.gst_rate = p.gst_rate;
  if (p.hsn) l.hsn = p.hsn;
  if (discount) { l.total = qty * p.price - discount; l.offer = { off: discount, label: String(discount) + ' off' }; }
  return l;
}
/** the counter's bill chit (till.html chitOf). opts: parts · customer · invoice (the engine's determine(), carried unchanged) · terms · billedAt · till · cashRound · slip */
function bill(no, rows, optsOrBilledAt) {
  const o = billOpts(optsOrBilledAt), lines = rows.map(billLine);
  const total = o.invoice && o.invoice.ValDtls ? Number(o.invoice.ValDtls.TotInvVal) : lines.reduce((a, l) => a + l.total, 0);
  const parts = o.parts || [{ how: 'cash', amount: total }], paid = parts.reduce((a, x) => a + (Number(x.amount) || 0), 0);
  const till = Object.assign({ id: 'C1', name: 'Counter 1', host: 'browser' }, o.till || {});
  return { recipients: [{ self: true, name: 'self' }], purpose: 'order', subject: 'Counter sale ' + no, manual_subject: 'Counter sale ' + no, client_ref: no,
    business_json: Object.assign({ customer: o.customer || { name: 'Walk-in' }, till, bill_no: no, billed_at: o.billedAt || new Date().toISOString(),
      payment: { mode: parts.map((x) => x.how).join('+'), paid, change: 0, parts, cash_round: o.cashRound }, slip: o.slip || 'cash' },
    o.terms ? { terms: o.terms } : {}, o.invoice ? { invoice: o.invoice } : {}),
    line_items: lines };
}
/** the counter's credit note (till.html chitOfCN). opts: invoice (of what goes back, so the api never derives through the shop's price flag — services.js:201) · parts (the refund) · customer · till · againstId */
function creditNote(no, against, rows, opts) {
  const o = opts || {}, lines = rows.map(billLine);
  const total = o.invoice && o.invoice.ValDtls ? Number(o.invoice.ValDtls.TotInvVal) : lines.reduce((a, l) => a + l.total, 0);
  const parts = o.parts || [{ how: 'cash', amount: total }], till = Object.assign({ id: 'C1', name: 'Counter 1', host: 'browser' }, o.till || {});
  return { recipients: [{ self: true, name: 'self' }], purpose: 'credit_note', subject: 'Credit note ' + no, manual_subject: 'Credit note ' + no, client_ref: no,
    business_json: Object.assign({ customer: o.customer || { name: 'Walk-in' }, till, doc: 'credit_note', slip: 'credit_note', bill_no: no,
      billed_at: o.billedAt || new Date().toISOString(), against: Object.assign({ bill_no: against }, o.againstId ? { chit_id: o.againstId } : {}), reason: 'returned',
      refund: { parts, total } }, o.invoice ? { invoice: o.invoice } : {}),
    line_items: lines };
}
/** a fresh shop made for this run: register → verify with the dev code → country. `tag` keeps User IDs apart (≤ 20 chars).
 *  `opts.tax`: tax registration is NEVER assumed (DECISIONS 2026-10-29) — left out, the shop's tax stays UNKNOWN; a test that means "not registered"
 *  says so: freshShop(tag, label, { tax: { registered: false } }). (Today's route stores an absent tax as registered:false — SET-38, settings area.) */
async function freshShop(tag, label, opts) {
  const o = opts || {}, email = tag + '@local.test';
  ok(await j('/api/entities/register', { method: 'POST', body: { email, display_name: label + ' ' + tag, user_id: tag } }), 'register');
  const v = ok(await j('/api/entities/verify', { method: 'POST', body: { email, otp: ENTITY_OTP } }), 'verify (is DEV_OTP armed?)').b;
  const entity = (v.entity && (v.entity.identity_id || v.entity.entity_id)) || (v.identity && v.identity.identity_id);
  const shop = { token: v.token, bridge: v.entity.bridge_id, entity, name: label + ' ' + tag, products: {} };
  ok(await j('/api/entities/profile', { method: 'PATCH', token: shop.token, body: { catalogue_visibility: 'public' } }), 'publish');
  /* the country step as the Country setup screen sends it; `country · currency · fy_start_month · timezone` default to the IN shop, a multi-zone country (AU) must state its zone */
  const country = { country: o.country || 'IN', currency: o.currency || 'INR', fy_start_month: o.fy_start_month || 4 };
  if (o.timezone) country.timezone = o.timezone;
  ok(await j('/api/governance/country-setup', { method: 'PUT', token: shop.token, body: Object.assign(country, o.tax ? { tax: o.tax } : {}) }), 'country');
  return shop;
}
/** a check the run cannot make yet (a later stage's ids): recorded as a skip, never a pass and never a red */
function skip(id, title, why) { results.push({ id, title, pass: true, skip: true, seen: 'SKIP: ' + why, gap: undefined }); console.log('  skip ' + id + ' ' + title + ' (' + why + ')'); }

/** the closing line + optional JSON file (env var named by the caller) */
function finish(label, jsonFile, extra) {
  const skips = results.filter((r) => r.skip).length, pass = results.filter((r) => r.pass && !r.skip).length, fail = results.length - pass - skips;
  console.log('\n── ' + results.length + ' cases · ' + pass + ' pass · ' + fail + ' fail (' + results.filter((r) => !r.pass && r.gap).length + ' of them known gaps)' + (skips ? ' · ' + skips + ' skip' : '') + ' ──');
  if (jsonFile) require('fs').writeFileSync(jsonFile, JSON.stringify(Object.assign({ label, results }, extra || {}), null, 2));
  /* a FAIL on a case without a `gap:` marker is a real red; known gaps are recorded, not red */
  process.exitCode = results.some((r) => !r.pass && !r.gap) ? 1 : 0;
}

module.exports = { API, DB, ENTITY_OTP, CUSTOMER_OTP, results, j, ok, pause, kase, skip, expect, near, line, receipt, bill, billLine, creditNote, freshShop, finish };
