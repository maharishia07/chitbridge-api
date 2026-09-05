/**
 * ChitBridge connector CORE — the half that talks to ChitBridge. Adapters (./adapters/*.js) talk to the outside system.
 *
 * Athi, 2026-09-05: "read the product data from the existing system, create offers in ours and pass back to their
 * system; when the order is made we take care of network connectivity and others." — and: "does it mean we can use it
 * for any system which has a similar connector? GoFrugal or any other system in the world?" Yes: this core never knows
 * what Tally is. An adapter is two functions — readProducts() and pushOrder(order) — and a name; readStock(), readProfile()
 * and pushReceipt(p) (the Receipt voucher when the seller marks a chit paid) are optional and skipped when absent.
 *
 * ── WHAT RUNS WHERE ──────────────────────────────────────────────────────────────────────────────────────────
 *   The store PC runs this (node ≥ 18, no dependencies). It needs OUTBOUND internet only: it calls ChitBridge with an
 *   API key minted under Settings › Integrations (scope 'connector'), and it holds the push stream (the mailbox bell)
 *   so an order rings here within a second. No open port, no static IP, no VPN.
 *
 * ── TRANSFER MODE: PROCESS-THEN-FORGET, KEEP A RECEIPT ───────────────────────────────────────────────────────
 *   Every transfer writes one line to receipts.jsonl — { at, kind, ref, hash, outcome }. A product whose hash is
 *   unchanged is not sent again; an order whose chit_id has a receipt is never pushed twice, however many times the
 *   stream reconnects or the catch-up runs. A failure is a receipt too (outcome 'failed'), retried on the next run.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* one unit, three names — the same table the API and the app hold (lib/units.js / app/units.js); a unit we cannot map is kept as spelt */
const UNITS = (() => { try { return require('../../lib/units'); } catch (_) { return null; } })();
function unitOf(u) { const k = UNITS && UNITS.unitOf(u); return k || String(u || 'unit').trim().toLowerCase(); }
function hashOf(o) { return crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 16); }

class Receipts {
  constructor(file) { this.file = file; this.rows = []; try { this.rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch (_) {} }
  last(kind, ref) { for (let i = this.rows.length - 1; i >= 0; i--) { const r = this.rows[i]; if (r.kind === kind && r.ref === ref) return r; } return null; }
  add(r) { const row = Object.assign({ at: new Date().toISOString() }, r); this.rows.push(row); fs.appendFileSync(this.file, JSON.stringify(row) + '\n'); return row; }
}

class CB {
  constructor({ api, key, log }) { this.api = api.replace(/\/$/, ''); this.key = key; this.log = log || (() => {}); }
  async call(method, p, body) {
    const r = await fetch(this.api + p, { method, headers: { 'X-Api-Key': this.key, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (_) { j = { raw: text }; }
    if (!r.ok) { const e = new Error(method + ' ' + p + ' → ' + r.status + ' ' + ((j && (j.message || j.error)) || text.slice(0, 120))); e.status = r.status; e.body = j; throw e; }
    return j;
  }
  products() { return this.call('GET', '/api/products?limit=500'); }
  addProducts(items) { return this.call('POST', '/api/products/bulk', { items }); }
  editProduct(id, item_data) { return this.call('PATCH', '/api/products/' + encodeURIComponent(id), { item_data }); }
  evaluate(lines, offers) { return this.call('POST', '/api/offers/explain', Object.assign({ lines }, offers ? { offers } : {})); }
  chit(id) { return this.call('GET', '/api/chits/' + encodeURIComponent(id)); }
  inbox() { return this.call('GET', '/api/chits/inbox?limit=100'); }
  ticket() { return this.call('POST', '/api/events/ticket'); }
  stock(items) { return this.call('POST', '/api/products/availability/bulk', { items }); }
  /** the frozen/built invoice for a chit — the buyer's GSTIN, the place of supply, the CGST/SGST/IGST split (B2B vouchers) */
  invoice(chit_id) { return this.call('GET', '/api/invoice/' + encodeURIComponent(chit_id)); }
  profile(fields, source) { return this.call('POST', '/api/integrations/profile', { source, as_of: new Date().toISOString(), fields }); }
  /** the heartbeat: Settings › Integrations lists this connector with its last-seen time and counters (never fails a command) */
  async heartbeat(info) { try { return await this.call('POST', '/api/integrations/heartbeat', Object.assign({ host: require('os').hostname(), version: '1.0.0' }, info || {})); } catch (e) { this.log('heartbeat: ' + e.message); return null; } }
}

/** ── PRODUCTS UP: the outside system's items become (or update) ChitBridge products, matched by code ── */
async function syncProducts({ cb, adapter, receipts, log }) {
  const theirs = await adapter.readProducts();
  const mine = await cb.products();
  const list = Array.isArray(mine) ? mine : (mine.items || mine.products || []);
  const byCode = new Map();
  for (const p of list) { const d = p.item_data || p; const code = String(d.code || d.sku || '').trim().toLowerCase(); if (code) byCode.set(code, p); }
  const toAdd = [], toEdit = [], unchanged = [];
  for (const t of theirs) {
    const code = String(t.code || '').trim().toLowerCase(); if (!code || !t.name) continue;
    const rec = { name: t.name, code: t.code, unit: unitOf(t.unit), ...(t.unit && unitOf(t.unit) !== String(t.unit).toLowerCase() ? { unit_source: t.unit } : {}), price: Number(t.price) || 0, ...(t.hsn ? { hsn: t.hsn } : {}), ...(t.gst_rate != null ? { gst_rate: Number(t.gst_rate) } : {}), ...(t.category ? { category_name: t.category } : {}), source_system: adapter.name, source_ref: t.ref || t.code };
    const h = hashOf(rec);
    const last = receipts.last('product', code);
    if (last && last.hash === h && last.outcome === 'ok') { unchanged.push(code); continue; }
    const have = byCode.get(code);
    if (have) toEdit.push({ id: have.item_id || have.id, item_data: Object.assign({}, have.item_data || {}, rec), code, h }); else toAdd.push({ rec, code, h });
  }
  let added = 0, edited = 0, failed = 0;
  if (toAdd.length) {
    for (let i = 0; i < toAdd.length; i += 100) {
      const slice = toAdd.slice(i, i + 100);
      try { await cb.addProducts(slice.map((x) => x.rec)); slice.forEach((x) => { receipts.add({ kind: 'product', ref: x.code, hash: x.h, outcome: 'ok', how: 'added' }); added++; }); }
      catch (e) { slice.forEach((x) => receipts.add({ kind: 'product', ref: x.code, hash: x.h, outcome: 'failed', why: e.message })); failed += slice.length; log('add failed: ' + e.message); }
    }
  }
  for (const x of toEdit) {
    try { await cb.editProduct(x.id, x.item_data); receipts.add({ kind: 'product', ref: x.code, hash: x.h, outcome: 'ok', how: 'updated' }); edited++; }
    catch (e) { receipts.add({ kind: 'product', ref: x.code, hash: x.h, outcome: 'failed', why: e.message }); failed++; log('update failed ' + x.code + ': ' + e.message); }
  }
  const out = { read: theirs.length, added, updated: edited, unchanged: unchanged.length, failed };
  log('products: ' + JSON.stringify(out));
  return out;
}

/** ── STOCK WITH A STAMP: the source's closing stock, written in one call with the moment it was read ── */
async function syncStock({ cb, adapter, receipts, log, codes }) {
  if (typeof adapter.readStock !== 'function') { log('stock: the ' + adapter.name + ' adapter has no readStock'); return { read: 0, written: 0 }; }
  const at = new Date().toISOString();
  let rows = await adapter.readStock();
  if (Array.isArray(codes) && codes.length) { const want = new Set(codes.map((c) => String(c).toLowerCase())); rows = rows.filter((r) => want.has(String(r.code || '').toLowerCase())); }
  const items = rows.filter((r) => r && r.code && Number.isFinite(Number(r.qty))).map((r) => ({ code: r.code, qty: Math.max(0, Number(r.qty)), source: 'erp', as_of: r.at || at }));
  if (!items.length) { log('stock: nothing to write'); return { read: rows.length, written: 0 }; }
  let written = 0, unknown = 0;
  for (let i = 0; i < items.length; i += 500) { const r = await cb.stock(items.slice(i, i + 500)); written += r.written || 0; unknown += r.unknown || 0; }
  receipts.add({ kind: 'stock', ref: 'all', hash: hashOf(items.map((x) => [x.code, x.qty])), outcome: 'ok', written, unknown });
  log('stock: ' + written + ' written' + (unknown ? ' · ' + unknown + ' unknown code(s)' : '') + ' · as of ' + at.slice(11, 19));
  return { read: rows.length, written, unknown, at };
}

/** ── THE PROFILE FROM THEIR SYSTEM: name · GSTIN · state · address … copied with source + as_of; the API checks and ranks ── */
async function syncProfile({ cb, adapter, receipts, log }) {
  if (typeof adapter.readProfile !== 'function') { log('profile: the ' + adapter.name + ' adapter has no readProfile'); return null; }
  const p = await adapter.readProfile(); if (!p || !Object.keys(p).length) { log('profile: nothing read'); return null; }
  const r = await cb.profile(p, adapter.name);
  receipts.add({ kind: 'profile', ref: 'store', hash: hashOf(p), outcome: 'ok', written: r.written, kept: r.kept });
  log('profile: ' + (r.written || []).length + ' written (' + (r.written || []).join(', ') + ')' + ((r.kept || []).length ? ' · kept ' + r.kept.map((k) => k.key).join(', ') : '') + ' · ' + r.filled + '/' + r.total + ' filled' + (r.issues && r.issues.length ? ' · ⚠ ' + r.issues.map((i) => i.issue).join('; ') : ''));
  return r;
}

/** ── OFFERS BACK: the outside system's basket lines → what comes off and why (the same engine as the storefront) ── */
async function evaluate({ cb, lines, offers }) {
  const norm = lines.map((l, i) => ({ key: String(l.key != null ? l.key : i), item_id: l.item_id || null, sku: l.code || l.sku || null, name: l.name || '', qty: Number(l.qty) || 0, unitPrice: Number(l.unitPrice != null ? l.unitPrice : l.price) || 0 }));
  return cb.evaluate(norm, offers);
}

/** ── ORDERS DOWN: a chit that arrived becomes the outside system's document, once ── */
function orderOf(c) {
  const h = c.header || c.chit || c, d = c.detail || {};
  const lines = (d.line_items || c.lines || []).filter((l) => l && l.kind !== 'payload').map((l) => ({
    name: l.name || l.particulars || '', code: (l.ref && (l.ref.code || l.ref.sku)) || l.code || l.sku || null, item_id: l.item_id || (l.ref && l.ref.item_id) || null,
    qty: Number(l.quantity != null ? l.quantity : l.qty) || 0, unit: l.unit || '', price: Number(l.price) || 0, list_price: l.list_price != null ? Number(l.list_price) : null,
    offer: l.offer ? { label: l.offer.label, off: Number(l.offer.off) || 0 } : null, total: Number(l.total) || 0, gst_rate: l.gst_rate != null ? Number(l.gst_rate) : null, hsn: l.hsn || null }));
  return { chit_id: h.chit_id, at: h.created_at || h.at || null, purpose: h.purpose || null, status: h.current_status || h.status || null,
           subject: h.manual_subject || h.auto_subject || '', buyer: h.sender_entity_display_name || (h.sender && h.sender.display_name) || 'Customer', currency: d.currency_code || 'INR',
           total: (h.summary_json && h.summary_json.total_value) || lines.reduce((t, l) => t + l.total, 0), lines };
}
/** the payment the seller recorded on their copy (business_json.payment) — level 1 by hand, level 2 by a gateway */
function paymentOf(c) { const h = c.header || c.chit || c; const bj = (h && h.business_json) || c.business_json || {}; return bj.payment || null; }
async function pushReceipt({ cb, adapter, receipts, log, chit_id }) {
  const last = receipts.last('receipt', chit_id);
  if (last && (last.outcome === 'ok' || last.outcome === 'skipped')) return { chit_id, outcome: 'duplicate' };
  const c = await cb.chit(chit_id); const pay = paymentOf(c); const order = orderOf(c);
  if (!pay) return { chit_id, outcome: 'unpaid' };
  const o = receipts.last('order', chit_id) || {};   /* what THEIR system called the order (invoice id, party) — a hosted system applies the payment to it */
  const p = { chit_id, at: pay.at, method: pay.method, ref: pay.ref, amount: pay.amount != null ? Number(pay.amount) : order.total, buyer: order.buyer, order: { their_ref: o.their_ref || null, their_id: o.their_id || null, their_party: o.their_party || null } };
  if (!adapter.pushReceipt) { receipts.add({ kind: 'receipt', ref: chit_id, hash: hashOf(p), outcome: 'skipped', why: adapter.name + ' has no pushReceipt' }); return { chit_id, outcome: 'skipped' }; }
  try { const r = await adapter.pushReceipt(p);
    if (r && r.ref === 'dry-run') { receipts.add({ kind: 'receipt', ref: chit_id, hash: hashOf(p), outcome: 'dry' }); return { chit_id, outcome: 'dry' }; }
    if (r && r.skipped) { receipts.add({ kind: 'receipt', ref: chit_id, hash: hashOf(p), outcome: 'skipped', why: r.skipped }); log('receipt ' + chit_id.slice(0, 8) + ' skipped: ' + r.skipped); return { chit_id, outcome: 'skipped', why: r.skipped }; }
    receipts.add({ kind: 'receipt', ref: chit_id, hash: hashOf(p), outcome: 'ok', their_ref: (r && r.ref) || null }); log('receipt ' + chit_id.slice(0, 8) + ' → ' + adapter.name + ' ' + ((r && r.ref) || '')); return { chit_id, outcome: 'ok', their_ref: r && r.ref }; }
  catch (e) { receipts.add({ kind: 'receipt', ref: chit_id, hash: hashOf(p), outcome: 'failed', why: e.message }); log('receipt ' + chit_id.slice(0, 8) + ' failed: ' + e.message); return { chit_id, outcome: 'failed', why: e.message }; }
}
async function pushOrder({ cb, adapter, receipts, log, chit_id }) {
  const last = receipts.last('order', chit_id);
  if (last && last.outcome === 'ok') { log('order ' + chit_id.slice(0, 8) + ' already pushed'); return { chit_id, outcome: 'duplicate' }; }
  const c = await cb.chit(chit_id);
  const order = orderOf(c);
  if (order.purpose && !/^(order|offer)$/.test(order.purpose)) { receipts.add({ kind: 'order', ref: chit_id, hash: hashOf(order), outcome: 'skipped', why: 'purpose ' + order.purpose }); return { chit_id, outcome: 'skipped' }; }
  /**
   * ⭐ B2B (Athi, 2026-09-05: "if we try ordering from another shop instead of the storefront? their GSTIN and so on").
   * When the buyer is a registered business the seller's books want a party ledger with the buyer's GSTIN, the place of
   * supply, and the tax split — all of it already on the chit's invoice (the same engine that prints the invoice tab).
   * The invoice is read once here and handed to the adapter as `order.b2b`; a walk-in order has none and books as before.
   */
  try {
    const inv = await cb.invoice(chit_id);
    const b = (inv && inv.invoice && inv.invoice.BuyerDtls) || {};
    if (b.Gstin) {
      const h = (inv.heads) || {}; const cbx = (inv.invoice && inv.invoice._cb) || {};
      order.b2b = { buyer: { name: b.LglNm || b.TrdNm || order.buyer, gstin: b.Gstin, state_code: b.State || String(b.Gstin).slice(0, 2), addr: [b.Addr1, b.Addr2].filter(Boolean).join(', '), loc: b.Loc || '', pin: b.Pin || '', reg_type: 'Regular' },
                    place_of_supply: b.Pos || cbx.place_of_supply || b.State || String(b.Gstin).slice(0, 2), supply: cbx.supply || null,
                    taxes: { cgst: Number(h.cgst) || 0, sgst: Number(h.sgst) || 0, igst: Number(h.igst) || 0, cess: Number(h.cess) || 0 }, taxable: Number(h.taxable) || 0, total: Number(h.total) || order.total,
                    items: ((inv.invoice && inv.invoice.ItemList) || []).map((it) => ({ name: it.PrdDesc, hsn: it.HsnCd, rate: Number(it.GstRt) || 0, ass: Number(it.AssAmt) || 0, cgst: Number(it.CgstAmt) || 0, sgst: Number(it.SgstAmt) || 0, igst: Number(it.IgstAmt) || 0 })) };
      if (adapter.ensureParty) { try { const pr = await adapter.ensureParty(order.b2b.buyer); if (pr && pr.created) log('party ledger created: ' + pr.created); } catch (e) { log('party ledger: ' + e.message); } }
    }
  } catch (e) { log('invoice read (B2B check): ' + e.message + ' — booking as a walk-in order'); }
  try { const r = await adapter.pushOrder(order);
    /* ⚠️ A DRY RUN IS NOT A PUSH (first live day, 2026-09-05): it used to write outcome 'ok' with their_ref 'dry-run', and the
       real `once` then said "already pushed". A dry run leaves a 'dry' receipt — visible in the file, never a duplicate. */
    if (r && r.ref === 'dry-run') { receipts.add({ kind: 'order', ref: chit_id, hash: hashOf(order), outcome: 'dry' }); return { chit_id, outcome: 'dry' }; }
    receipts.add({ kind: 'order', ref: chit_id, hash: hashOf(order), outcome: 'ok', their_ref: (r && r.ref) || null, ...(r && r.their_id ? { their_id: r.their_id } : {}), ...(r && r.their_party ? { their_party: r.their_party } : {}) }); log('order ' + chit_id.slice(0, 8) + ' → ' + adapter.name + ' ' + ((r && r.ref) || 'ok')); return { chit_id, outcome: 'ok', their_ref: r && r.ref }; }
  catch (e) { receipts.add({ kind: 'order', ref: chit_id, hash: hashOf(order), outcome: 'failed', why: e.message }); log('order ' + chit_id.slice(0, 8) + ' failed: ' + e.message); return { chit_id, outcome: 'failed', why: e.message }; }
}
/** catch-up: every received order in the inbox without an ok receipt */
async function catchUp({ cb, adapter, receipts, log }) {
  const inbox = await cb.inbox();
  const rows = (inbox.chits || inbox.rows || inbox.items || (Array.isArray(inbox) ? inbox : [])).filter((r) => /^(order|offer)$/.test(String(r.purpose || '')));
  const out = [];
  for (const r of rows) { const id = r.chit_id || r.id; if (!id) continue; out.push(await pushOrder({ cb, adapter, receipts, log, chit_id: id })); }
  /* payments recorded while we were away: every pushed order without a receipt receipt */
  for (const r of rows) { const id = r.chit_id || r.id; if (!id) continue; const o = receipts.last('order', id); if (o && o.outcome === 'ok' && !receipts.last('receipt', id)) { try { await pushReceipt({ cb, adapter, receipts, log, chit_id: id }); } catch (e) { log('receipt catch-up: ' + e.message); } } }
  return out;
}
/** live: hold the push stream; on an arrival push that order; reconnect with backoff; the catch-up runs first */
async function watchOrders({ cb, adapter, receipts, log, onEvent, signal }) {
  await catchUp({ cb, adapter, receipts, log });
  const beat = () => cb.heartbeat({ name: (cb.name || adapter.name + ' connector'), adapter: adapter.name, counters: counts(receipts), note: 'watching' });
  await beat(); const hb = setInterval(beat, 5 * 60 * 1000); if (signal) signal.addEventListener('abort', () => clearInterval(hb));
  let backoff = 3000;
  while (!(signal && signal.aborted)) {
    try {
      const t = await cb.ticket();
      const res = await fetch(cb.api + '/api/events/stream?t=' + encodeURIComponent(t.ticket), { signal });
      if (!res.ok || !res.body) throw new Error('stream ' + res.status);
      log('stream up'); backoff = 3000;
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i; while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /^event: (\S+)/m.exec(chunk), data = /^data: (.*)$/m.exec(chunk);
          if (ev && ev[1] === 'cb' && data) { let d = {}; try { d = JSON.parse(data[1]); } catch (_) {} if (onEvent) onEvent(d);
            if (d.kind === 'chit' && d.id) await pushOrder({ cb, adapter, receipts, log, chit_id: d.id });
            /* the seller marked it paid (or a gateway did): the Receipt voucher */
            if (d.kind === 'paid' && d.id) { try { await pushReceipt({ cb, adapter, receipts, log, chit_id: d.id }); } catch (e) { log('receipt: ' + e.message); } }
            /* the storefront asked for fresh stock: read the source now, write the stamped figures */
            if (d.kind === 'ask' && d.what === 'stock') { try { await syncStock({ cb, adapter, receipts, log, codes: d.codes }); } catch (e) { log('stock on demand: ' + e.message); } } }
        }
      }
      log('stream closed');
    } catch (e) { if (signal && signal.aborted) break; log('stream error: ' + e.message + ' — retry in ' + backoff / 1000 + 's'); }
    await new Promise((ok) => setTimeout(ok, backoff)); backoff = Math.min(backoff * 2, 60000);
  }
}

function counts(receipts) { const c = { products_ok: 0, orders_ok: 0, stock_ok: 0, receipts_ok: 0, failed: 0 }; for (const r of receipts.rows) { if (r.outcome === 'ok') { if (r.kind === 'product') c.products_ok++; else if (r.kind === 'receipt') c.receipts_ok++; else if (r.kind === 'order') c.orders_ok++; else if (r.kind === 'stock') c.stock_ok++; } else if (r.outcome === 'failed') c.failed++; } return c; }
function loadConfig(file) {
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!cfg.api || !cfg.key) throw new Error('config needs api and key (mint one under Settings › Integrations, scope connector)');
  cfg.receipts = cfg.receipts || path.join(path.dirname(file), 'receipts.jsonl');
  return cfg;
}
module.exports = { pushReceipt, paymentOf, counts, syncStock, syncProfile, CB, Receipts, syncProducts, evaluate, pushOrder, catchUp, watchOrders, orderOf, loadConfig, hashOf };
