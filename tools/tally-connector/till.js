#!/usr/bin/env node
/**
 * till.js — THE COUNTER (TILL-SPEC-2026-09-07).
 *
 * Athi, 2026-09-07: *"someone runs a store without a computer… why can't we develop a desktop application — you download it, we still
 * run everything in the cloud, but the minimum sits on the desktop so the billing works faster."*
 *
 * ── WHAT IT IS ────────────────────────────────────────────────────────────────────────────────────────────────
 * The connector kit with a screen. It runs on the shop PC beside the same connector.json, holds a COPY of the shop (items, prices,
 * offers, tax slabs, customers), serves one page at http://127.0.0.1:7071, and bills against that copy — so a sale costs nothing on
 * the network and works with the line down. Every bill is queued and sent afterwards as an ordinary chit, which is what makes the
 * shop's suppliers, books and reconciliation work without a second system.
 *
 * ── THE FOUR RULES IT KEEPS ───────────────────────────────────────────────────────────────────────────────────
 *  1 · A BILL IS NEVER LOST. It is written to disk before anything else happens, and the queue is a file, not memory.
 *  2 · A BILL IS NEVER SENT TWICE. Its number rides as `client_ref`; the server answers a repeat with the first chit.
 *  3 · A NUMBER IS NEVER REUSED. series.json is written before the bill is, and the financial year is part of the number.
 *  4 · IT NEVER BLOCKS A SALE. No network, no snapshot, no printer — the sale still records, and catches up later.
 *
 * ── WHAT IT IS NOT ────────────────────────────────────────────────────────────────────────────────────────────
 * Not stock control, not returns (version 2), not accounts. A till feature that puts nothing on the rail belongs to the shop's ERP.
 *
 * Run:  node till.js --config connector.json [--port 7071]
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const core = require('./core');

const argv = process.argv.slice(2);
const flag = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };
const log = (m) => console.log('[' + new Date().toISOString().slice(11, 19) + '] ' + m);

const cfgFile = path.resolve(flag('config', 'connector.json'));
const cfg = core.loadConfig(cfgFile);
const tillCfg = Object.assign({ port: 7071, id: 'C1', name: 'Counter 1', refreshMinutes: 15, drainSeconds: 20 }, cfg.till || {});
const PORT = Number(flag('port', tillCfg.port)) || 7071;
const DIR = path.join(path.dirname(cfgFile), 'till-data');
const F = {
  snapshot: path.join(DIR, 'snapshot.json'),
  series: path.join(DIR, 'series.json'),
  queue: path.join(DIR, 'queue.jsonl'),
  bills: (day) => path.join(DIR, 'bills-' + day + '.jsonl'),
  engine: (n) => path.join(DIR, 'engine-' + n + '.js'),
};
for (const d of [DIR]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });

const cb = new core.CB({ api: cfg.api, key: cfg.key, log });
cb.name = tillCfg.name || 'Till';

/* ── files, kept simple and crash-safe ─────────────────────────────────────────────────────────────────────── */
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return d; } };
/** write through a temp file: a power cut mid-write leaves the OLD file, never half a new one */
function writeJSON(f, obj) { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(obj, null, 2)); fs.renameSync(t, f); }
const appendLine = (f, obj) => fs.appendFileSync(f, JSON.stringify(obj) + '\n');
const readLines = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean); } catch (_) { return []; } };
const today = () => new Date().toISOString().slice(0, 10);

/**
 * ⭐ THE NUMBER. India's GST wants a series that is continuous within a financial year and unique to the shop; a till that is offline
 * cannot ask anyone, so the series is LOCAL and the counter's id is part of it: C1/26-27/0041. Two tills never collide, and a number is
 * written to disk BEFORE the bill it belongs to, so a crash costs a gap of one rather than a duplicate.
 */
function fyOf(d) {
  const y = d.getFullYear(), apr = d.getMonth() >= 3;      /* the Indian financial year starts on 1 April */
  const a = apr ? y : y - 1;
  return String(a).slice(2) + '-' + String(a + 1).slice(2);
}
function nextNumber() {
  const fy = fyOf(new Date());
  const s = readJSON(F.series, null) || { prefix: tillCfg.id || 'C1', fy: fy, next: 1 };
  if (s.fy !== fy) { s.fy = fy; s.next = 1; }              /* a new year starts at 1, as the law expects */
  const n = s.next;
  s.next = n + 1;
  writeJSON(F.series, s);
  return (s.prefix || 'C1') + '/' + fy + '/' + String(n).padStart(4, '0');
}

/* ── the copy of the shop ──────────────────────────────────────────────────────────────────────────────────── */
let snapshot = readJSON(F.snapshot, null);
let online = false;

async function refresh() {
  try {
    const snap = await cb.call('GET', '/api/till/snapshot');
    if (snap && snap.shop) {
      const changed = !snapshot || snapshot.version !== snap.version;
      snapshot = snap; writeJSON(F.snapshot, snap);
      online = true;
      if (changed) log('the shop was re-read: ' + (snap.items || []).length + ' items, ' + (snap.offers || []).length + ' offer(s), version ' + snap.version);
    }
    /* the engines, cached beside the snapshot — the till prices with the same code the server does.
       ⚠️ CB.call parses JSON and hands back { raw } when the body is not JSON, which is exactly what a .js file is. */
    for (const [name, file] of [['offers', F.engine('offers')], ['tax', F.engine('tax')]]) {
      try { const r = await cb.call('GET', '/api/till/engine/' + name); const js = (r && typeof r.raw === 'string') ? r.raw : '';
        if (js.length > 500) fs.writeFileSync(file, js); }
      catch (_) { /* keep the copy we have — an engine we already hold is what makes the counter work offline */ }
    }
    return true;
  } catch (e) { online = false; log('offline (' + e.message + ') — billing continues from the copy on disk'); return false; }
}

/* ── the queue: every bill leaves exactly once ─────────────────────────────────────────────────────────────── */
let draining = false;
async function drain() {
  if (draining) return; draining = true;
  try {
    const rows = readLines(F.queue);
    if (!rows.length) { draining = false; return; }
    const left = [];
    for (const bill of rows) {
      try {
        const r = await cb.call('POST', '/api/chits/send', chitOf(bill));
        const id = r && (r.chit_id || (r.chit && r.chit.chit_id));
        log('bill ' + bill.no + ' → ' + (r && r.duplicate ? 'already recorded' : 'recorded') + (id ? ' (' + String(id).slice(0, 8) + ')' : ''));
        online = true;
      } catch (e) {
        online = false;
        left.push(bill);                                    /* keep it; the next tick tries again */
      }
    }
    fs.writeFileSync(F.queue, left.map((b) => JSON.stringify(b)).join('\n') + (left.length ? '\n' : ''));
  } catch (e) { log('queue: ' + e.message); }
  draining = false;
}

/** the bill, as the chit every other part of ChitBridge already understands */
function chitOf(bill) {
  return {
    recipients: [{ self: true, name: 'self' }],
    purpose: 'order',
    subject: 'Counter sale ' + bill.no,
    manual_subject: 'Counter sale ' + bill.no,
    client_ref: bill.no,
    business_json: {
      customer: bill.customer && bill.customer.name ? bill.customer : { name: 'Walk-in' },
      till: { id: tillCfg.id, name: tillCfg.name, host: os.hostname() },
      bill_no: bill.no, billed_at: bill.at,
      catalogue_version: bill.catalogue_version || null,
      payment: { mode: (bill.payments || []).map((p) => p.how).join('+') || 'cash', paid: bill.paid, change: bill.change, parts: bill.payments || [] },
      slip: bill.kind || 'cash',
    },
    line_items: (bill.lines || []).map((l) => Object.assign({
      particulars: l.name, quantity: l.qty, unit: l.unit || 'piece', price: l.price, total: l.net,
    }, l.item_id ? { item_id: l.item_id } : {}, l.hsn ? { hsn: l.hsn } : {}, l.gst_rate != null ? { gst_rate: l.gst_rate } : {},
       l.off ? { offer: { off: l.save, label: l.off_label || 'Offer' } } : {})),
  };
}

/* ── the screen ────────────────────────────────────────────────────────────────────────────────────────────── */
const PAGE = path.join(__dirname, 'till.html');
const send = (res, code, type, body) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
const json = (res, code, obj) => send(res, code, 'application/json; charset=utf-8', JSON.stringify(obj));

function todayTotals() {
  const rows = readLines(F.bills(today()));
  const by = {};
  let total = 0;
  for (const b of rows) { total += Number(b.total) || 0; for (const p of (b.payments || [])) by[p.how] = Math.round(((by[p.how] || 0) + Number(p.amount || 0)) * 100) / 100; }
  return { count: rows.length, total: Math.round(total * 100) / 100, by: by };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html'))
      return send(res, 200, 'text/html; charset=utf-8', fs.readFileSync(PAGE, 'utf8'));

    if (req.method === 'GET' && /^\/engine\/(offers|tax)\.js$/.test(url.pathname)) {
      const n = url.pathname.split('/')[2].replace('.js', '');
      if (!fs.existsSync(F.engine(n))) return send(res, 503, 'text/plain', '// the engine has not been fetched yet — press Refresh while online');
      return send(res, 200, 'application/javascript; charset=utf-8', fs.readFileSync(F.engine(n), 'utf8'));
    }

    if (req.method === 'GET' && url.pathname === '/api/state')
      return json(res, 200, { snapshot: snapshot, online: online, queued: readLines(F.queue).length, today: todayTotals(),
                              till: { id: tillCfg.id, name: tillCfg.name, host: os.hostname() },
                              engines: { offers: fs.existsSync(F.engine('offers')), tax: fs.existsSync(F.engine('tax')) } });

    if (req.method === 'POST' && url.pathname === '/api/refresh') { const ok = await refresh(); return json(res, 200, { ok: ok, online: online, at: snapshot && snapshot.at }); }

    if (req.method === 'GET' && url.pathname === '/api/bills')
      return json(res, 200, { day: today(), bills: readLines(F.bills(today())).slice(-50).reverse(), totals: todayTotals() });

    if (req.method === 'POST' && url.pathname === '/api/bill') {
      let body = ''; for await (const c of req) body += c;
      const b = JSON.parse(body || '{}');
      if (!Array.isArray(b.lines) || !b.lines.length) return json(res, 400, { error: 'a bill needs at least one line' });
      /* ⚠️ THE NUMBER FIRST, THEN THE FILE, THEN THE QUEUE — in that order, so a crash can cost a gap but never a duplicate. */
      const bill = Object.assign({ no: nextNumber(), at: new Date().toISOString(), till: tillCfg.id,
                                   catalogue_version: snapshot && snapshot.version }, b);
      appendLine(F.bills(today()), bill);
      appendLine(F.queue, bill);
      drain().catch(() => {});                              /* try at once; if the line is down the queue keeps it */
      return json(res, 200, { ok: true, bill: bill, today: todayTotals() });
    }

    return json(res, 404, { error: 'not here' });
  } catch (e) { json(res, 500, { error: String(e && e.message) }); }
});

(async () => {
  log('till ' + tillCfg.id + ' starting · data in ' + DIR);
  await refresh();
  if (!snapshot) log('⚠ no copy of the shop yet — connect once, then this till bills with the line down');
  setInterval(() => refresh().catch(() => {}), Math.max(1, Number(tillCfg.refreshMinutes) || 15) * 60 * 1000).unref();
  setInterval(() => drain().catch(() => {}), Math.max(5, Number(tillCfg.drainSeconds) || 20) * 1000).unref();
  server.listen(PORT, '127.0.0.1', () => {
    log('counter ready → http://127.0.0.1:' + PORT);
    log('bills are kept in ' + DIR + ' and sent when the line is up');
  });
})();
