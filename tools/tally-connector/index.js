#!/usr/bin/env node
/**
 * ChitBridge connector — CLI.
 *   node index.js sync-products  --config connector.json [--adapter tally|csv] [--dry]
 *   node index.js evaluate       --config connector.json --lines lines.json          (basket lines → what comes off, and why)
 *   node index.js once           --config connector.json                              (catch-up: push every received order not yet pushed)
 *   node index.js sync-stock     --config connector.json                              (closing stock → stamped availability, now)
 *   node index.js sync-profile   --config connector.json                              (the store's name · GSTIN · state · address … from its own system)
 *   node index.js watch          --config connector.json [--sync-minutes 30] [--stock-minutes 5] [--retry-minutes 5]
 *                                (catch-up, hold the push stream; re-read products every N min, stock every M min; answer the storefront's stock asks)
 * connector.json: { "api": "https://chitbridge-api-production.up.railway.app", "key": "<API key, scope connector>",
 *                   "adapter": "tally", "tally": { "url": "http://localhost:9000", "company": "…", "partyLedger": "Cash", "salesLedger": "Sales" } }
 */
'use strict';
const path = require('path');
const fs = require('fs');
const core = require('./core');

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };
const log = (m) => console.log('[' + new Date().toISOString().slice(11, 19) + '] ' + m);

(async () => {
  if (!cmd || cmd === 'help') { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 10).join('\n')); return; }
  const cfgFile = path.resolve(flag('config', 'connector.json'));
  /* ⭐ RESTART WITH NOBODY THERE (Athi, 2026-09-06: "if the connector fails or stops running, how will that be restarted? no one will be there").
     Adopt the operating system: a Task Scheduler task starts the watcher every 5 minutes; Task Scheduler's default (do not start a new
     instance) means it only ever starts when the watcher is NOT running — a crash, a reboot, a closed window all heal within 5 minutes. */
  if (cmd === 'install' || cmd === 'uninstall') {
    const taskName = 'ChitBridge connector ' + path.basename(cfgFile, '.json');
    if (process.platform !== 'win32') { console.log('install registers a Windows scheduled task. On Linux/macOS run the watcher under systemd or launchd — see docs/'); return; }
    const sp = require('child_process').spawnSync;
    if (cmd === 'uninstall') { const r = sp('schtasks', ['/Delete', '/F', '/TN', taskName], { encoding: 'utf8' }); console.log(r.status === 0 ? 'Removed "' + taskName + '"' : (r.stderr || r.stdout)); return; }
    const tr = 'cmd /c cd /d "' + __dirname + '" && node index.js watch --config "' + cfgFile + '" >> watch.log 2>&1';
    const r = sp('schtasks', ['/Create', '/F', '/SC', 'MINUTE', '/MO', '5', '/TN', taskName, '/TR', tr], { encoding: 'utf8' });
    console.log(r.status === 0
      ? 'Registered "' + taskName + '": Task Scheduler starts the watcher every 5 minutes whenever it is not running (crash, reboot, closed window). Log: watch.log. Remove: node index.js uninstall'
      : 'Could not register the task: ' + (r.stderr || r.stdout || r.error));
    return;
  }
  const cfg = core.loadConfig(cfgFile); cfg._configFile = cfgFile; cfg.dry = !!flag('dry', false); cfg.log = log;
  const adapterName = flag('adapter', cfg.adapter || 'tally');
  const adapter = require('./adapters/' + adapterName)(cfg);
  const cb = new core.CB({ api: cfg.api, key: cfg.key, log }); cb.name = cfg.name || (adapterName + ' connector');
  const receipts = new core.Receipts(cfg.receipts);
  /* ⭐ THE HANDSHAKE, KEPT: every run reports this PC and the Tally company; a kit not yet approved for this PC waits (watch: a minute
     at a time, so approving in the browser makes it go live with nobody at the store PC) or stops (any other command); a GSTIN that
     differs from the account's stops it for good — wrong store, or wrong account. Server side: routes/integrations.js heartbeat. */
  if (cmd !== 'help') {
    let facts = {}; try { if (typeof adapter.readProfile === 'function') { const p = await adapter.readProfile(); facts = { company: p.trade_name || null, gstin: p.gstin || null }; } } catch (_) {}
    cb.tally = facts;
    const readFacts = async () => { try { if (typeof adapter.readProfile === 'function') { const p = await adapter.readProfile(); if (p && (p.trade_name || p.gstin)) facts = { company: p.trade_name || null, gstin: p.gstin || null }; } } catch (_) {} cb.tally = facts; };
    const gate = async () => {
      /* Tally closed when we started → no company, no GSTIN, no automatic approval; ask again each time we wait (found 2026-09-06 on the two live kits) */
      if (!facts.company && !facts.gstin) await readFacts();
      const hb = await cb.heartbeat({ name: cb.name, adapter: adapterName, counters: core.counts(receipts), note: cmd, tally: facts });
      if (hb && hb.policy) cb.policy = hb.policy;   /* orders go to the books at received · accepted · completed · manual */
      if (!hb || hb.approved !== false) return true;
      if (/mismatch/.test(hb.reason || '')) { log('STOP — ' + hb.reason + '. This PC\'s Tally company does not belong to this ChitBridge account; nothing will be synced.'); process.exit(3); }
      log('waiting for approval — ChitBridge › Settings › Integrations › Running connectors › Approve this PC (' + require('os').hostname() + (facts.company ? ' · ' + facts.company : '') + ')');
      return false;
    };
    while (!(await gate())) { if (cmd !== 'watch') process.exit(4); await new Promise((r) => setTimeout(r, 60000)); }
  }
  if (cmd === 'sync-products') { const r = await core.syncProducts({ cb, adapter, receipts, log }); console.log(JSON.stringify(r)); return; }
  if (cmd === 'evaluate') { const lines = JSON.parse(fs.readFileSync(path.resolve(flag('lines', 'lines.json')), 'utf8')); const r = await core.evaluate({ cb, lines: Array.isArray(lines) ? lines : lines.lines, offers: lines.offers }); console.log(JSON.stringify(r, null, 2)); return; }
  if (cmd === 'sync-profile') { const r = await core.syncProfile({ cb, adapter, receipts, log }); console.log(JSON.stringify(r && { written: r.written, kept: r.kept, filled: r.filled, total: r.total, issues: r.issues })); return; }
  if (cmd === 'sync-stock') { const r = await core.syncStock({ cb, adapter, receipts, log }); console.log(JSON.stringify(r)); return; }
  /* the ledgers the vouchers need — created in the outside system when the adapter can (Tally: master import); watch does this first */
  if (cmd === 'ensure') { if (!adapter.ensure) { console.log(adapterName + ' has no ensure step'); return; } const r = await adapter.ensure(); console.log(JSON.stringify(r)); return; }
  if (cmd === 'watch' && adapter.ensure) { try { const r = await adapter.ensure(); if (r.created && r.created.length) log('created: ' + r.created.join(' · ')); } catch (e) { log('ensure: ' + e.message + ' — vouchers may be refused until the ledgers exist'); } }
  /* ⭐ ROLE (2026-09-05): 'seller' books the orders I receive (Sales); 'buyer' books the orders I placed and marked completed
     (Purchase, with my ITC); 'both' does both. connector.json: "role": "both" — default seller, as it always was. */
  const role = String(flag('role', cfg.role || 'seller'));
  if (cmd === 'purchases') { const r = await core.syncPurchases({ cb, adapter, receipts, log }); console.log(JSON.stringify(r)); return; }
  if (cmd === 'once') { const r = await core.catchUp({ cb, adapter, receipts, log }); if (/buyer|both/.test(role)) { const p = await core.syncPurchases({ cb, adapter, receipts, log }); console.log(JSON.stringify({ orders: r, purchases: p })); return; } console.log(JSON.stringify(r)); return; }
  if (cmd === 'watch') {
    const ac = new AbortController(); process.on('SIGINT', () => { log('stopping'); ac.abort(); });
    /* ⭐ THE PRODUCT LIST IS MAINTAINED IN THEIR SYSTEM, NOT OURS (Athi, 2026-09-05). While watching, re-read it every N minutes:
       only rows whose hash changed are sent, so a quiet shelf costs one read of the source and nothing else. */
    const every = Number(flag('sync-minutes', cfg.syncMinutes || 0)) || 0;
    if (every > 0) { const tick = async () => { try { await core.syncProducts({ cb, adapter, receipts, log }); } catch (e) { log('sync: ' + e.message); } }; await tick(); const t = setInterval(tick, every * 60 * 1000); ac.signal.addEventListener('abort', () => clearInterval(t)); log('products re-read every ' + every + ' min'); }
    /* ⭐ TALLY WAS DOWN, NOW IT IS BACK (Athi, 2026-09-05: "even if Tally is not available and when it is back, automatically
       sync happens?"). A voucher that failed while Tally was closed left a 'failed' receipt and waited for the next bell or a
       restart. Now the catch-up runs every retry-minutes (default 5): every order without an ok/dry/skipped receipt is
       pushed again, receipts included — so a morning's orders land the moment Tally opens, nothing typed, nothing twice. */
    const retryEvery = Number(flag('retry-minutes', cfg.retryMinutes != null ? cfg.retryMinutes : 5)) || 0;
    const buyerSide = async () => { if (!/buyer|both/.test(role)) return; try { const out = await core.syncPurchases({ cb, adapter, receipts, log }); const n = out.filter((x) => x.outcome === 'ok').length; if (n) log('purchases: ' + n + ' booked'); } catch (e) { log('purchases: ' + e.message); } };
    await buyerSide();
    const sellerSide = async () => { if (/^buyer$/.test(role)) return; try { const out = await core.catchUp({ cb, adapter, receipts, log }); const n = out.filter((x) => x.outcome === 'ok').length; if (n) log('catch-up: ' + n + ' order(s) landed'); } catch (e) { log('catch-up: ' + e.message); } };
    if (retryEvery > 0) { const t = setInterval(async () => { await sellerSide(); await buyerSide(); }, retryEvery * 60 * 1000); t.unref && t.unref(); }
    const stockEvery = Number(flag('stock-minutes', cfg.stockMinutes || 0)) || 0;
    if (stockEvery > 0) { const tick = async () => { try { await core.syncStock({ cb, adapter, receipts, log }); } catch (e) { log('stock: ' + e.message); } }; await tick(); const t = setInterval(tick, stockEvery * 60 * 1000); ac.signal.addEventListener('abort', () => clearInterval(t)); log('stock re-read every ' + stockEvery + ' min, and on demand'); }
    await core.watchOrders({ cb, adapter, receipts, log, signal: ac.signal, role, onEvent: (d) => log('bell: ' + JSON.stringify(d)) }); return; }
  console.error('unknown command ' + cmd); process.exit(2);
})().catch((e) => { console.error('connector: ' + (e && e.message)); process.exit(1); });
