#!/usr/bin/env node
/**
 * setup.js — THE ONLY SCREEN THE CONNECTOR HAS: a short conversation in the console (Athi, 2026-09-05: "how will they
 * upload the key, where is it supposed to be — within Tally? does our connector open any screen?").
 *
 *   node setup.js            (or double-click start.cmd on Windows)
 *
 * It asks for the key (paste it — it is never shown again), where Tally listens, which company; it TESTS both ends before
 * writing anything (the key against ChitBridge, the port against Tally); it writes connector.json; it runs the first
 * product sync so the person sees their items appear; it prints the two commands that matter. Nothing is installed
 * inside Tally: Tally only needs its XML port switched on (F1 › Settings › Connectivity).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const core = require('./core');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q, d) => new Promise((ok) => rl.question(q + (d ? ' [' + d + ']' : '') + ': ', (a) => ok((a || '').trim() || d || '')));
const here = __dirname;
const cfgFile = path.join(here, 'connector.json');

(async () => {
  console.log('\nChitBridge connector — setup\n');
  let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch (_) {}
  const api = await ask('ChitBridge API', cfg.api || 'https://chitbridge-api-production.up.railway.app');
  const adapter = (await ask('Which system (tally / zoho / gofrugal / csv)', cfg.adapter || 'tally')).toLowerCase();
  let key = cfg.key && !/PASTE/.test(cfg.key) ? cfg.key : '';
  if (key) { const keep = await ask('A key is already saved (…' + key.slice(-4) + '). Keep it? (y/n)', 'y'); if (!/^y/i.test(keep)) key = ''; }
  while (!key) { key = await ask('Paste the key from Settings › Integrations (scope connector)'); if (!key) console.log('  a key is required — mint one under Settings › Integrations'); }

  /* 1 · the key against ChitBridge */
  process.stdout.write('Checking the key against ' + api + ' … ');
  const cb = new core.CB({ api, key, log: () => {} });
  try { const r = await cb.call('POST', '/api/integrations/heartbeat', { name: 'setup', adapter, host: require('os').hostname(), version: '1.0.0', note: 'setup' }); console.log('ok (connector ' + (r.created ? 'registered' : 'known') + ')'); }
  catch (e) { console.log('FAILED — ' + e.message); console.log('  Mint a key with scope connector and paste it exactly.'); rl.close(); process.exit(1); }

  /* 2 · the outside system */
  const out = Object.assign({}, cfg, { api, key, adapter });
  if (adapter === 'tally') {
    const url = await ask('Where Tally listens', (cfg.tally && cfg.tally.url) || 'http://localhost:9000');
    const company = await ask('Company name in Tally (blank = the open company)', (cfg.tally && cfg.tally.company) || '');
    const party = await ask('Party ledger for storefront orders', (cfg.tally && cfg.tally.partyLedger) || 'Cash');
    const sales = await ask('Sales ledger', (cfg.tally && cfg.tally.salesLedger) || 'Sales');
    /* the Receipt voucher when you mark a chit paid: where the money lands (a cash-sale party needs none) */
    const bank = /^cash$/i.test(party) ? (cfg.tally && cfg.tally.bankLedger) || 'Bank' : await ask('Bank ledger for UPI / card payments (Receipt voucher)', (cfg.tally && cfg.tally.bankLedger) || 'Bank');
    const cash = /^cash$/i.test(party) ? (cfg.tally && cfg.tally.cashLedger) || 'Cash' : await ask('Cash ledger for cash payments', (cfg.tally && cfg.tally.cashLedger) || 'Cash');
    out.tally = Object.assign({}, cfg.tally || {}, { url, company: company || null, partyLedger: party, salesLedger: sales, bankLedger: bank, cashLedger: cash, voucherType: (cfg.tally && cfg.tally.voucherType) || 'Sales' });
    process.stdout.write('Checking Tally at ' + url + ' … ');
    try { const t = require('./adapters/tally')(Object.assign({ log: () => {} }, out)); const items = await t.readProducts(); console.log('ok — ' + items.length + ' stock item(s) readable'); }
    catch (e) { console.log('FAILED — ' + e.message); console.log('  In Tally: F1 (Help) › Settings › Connectivity › Client/Server: TallyPrime acts as Both, Enable ODBC/XML, port 9000. Keep the company open.'); const go = await ask('Save the settings anyway and try later? (y/n)', 'y'); if (!/^y/i.test(go)) { rl.close(); process.exit(1); } }
  } else if (adapter === 'zoho') {
    out.zoho = Object.assign({}, cfg.zoho || {}, { base: await ask('Zoho API base', (cfg.zoho && cfg.zoho.base) || 'https://www.zohoapis.in'), org: await ask('Organisation id', (cfg.zoho && cfg.zoho.org) || ''), token: await ask('Access token', (cfg.zoho && cfg.zoho.token) || ''), customer_name: await ask('Customer name for storefront orders', (cfg.zoho && cfg.zoho.customer_name) || 'Walk-in') });
  } else if (adapter === 'gofrugal') {
    out.gofrugal = Object.assign({}, cfg.gofrugal || {}, { url: await ask('GoFrugal WebReporter URL', (cfg.gofrugal && cfg.gofrugal.url) || 'http://localhost:8482'), token: await ask('GoFrugal API key (X-Auth-Token)', (cfg.gofrugal && cfg.gofrugal.token) || ''), locationId: (await ask('Location id (blank = all)', (cfg.gofrugal && cfg.gofrugal.locationId) || '')) || null });
  } else {
    out.csv = Object.assign({}, cfg.csv || {}, { products: await ask('Products CSV', (cfg.csv && cfg.csv.products) || 'products.csv'), orders: await ask('Folder for order files', (cfg.csv && cfg.csv.orders) || 'orders') });
  }
  /* the side(s) this connector books: seller (orders I receive → Sales), buyer (orders I placed and completed → Purchase), both */
  out.role = (await ask('Role: seller / buyer / both', cfg.role || 'seller')).toLowerCase();
  out.syncMinutes = Number(await ask('Re-read products every N minutes while watching (0 = off)', String(cfg.syncMinutes || 30))) || 0;
  out.stockMinutes = Number(await ask('Re-read stock every N minutes while watching (0 = off)', String(cfg.stockMinutes || 5))) || 0;
  fs.writeFileSync(cfgFile, JSON.stringify(out, null, 2) + '\n');
  console.log('\nSaved ' + cfgFile + ' (the key is stored there — keep this folder private).');

  /* 3 · first sync, so the person sees it work */
  const first = await ask('Run the first product sync now? (y/n)', 'y');
  if (/^y/i.test(first)) {
    try {
      const ad = require('./adapters/' + adapter)(Object.assign({ log: (m) => console.log('  · ' + m) }, out, { _configFile: cfgFile }));
      const receipts = new core.Receipts(path.join(here, 'receipts.jsonl'));
      const r = await core.syncProducts({ cb, adapter: ad, receipts, log: (m) => console.log('  · ' + m) });
      console.log('  Products: read ' + r.read + ' · added ' + r.added + ' · updated ' + r.updated + ' · unchanged ' + r.unchanged + (r.failed ? ' · FAILED ' + r.failed : ''));
      if (typeof ad.readProfile === 'function') { const p = await core.syncProfile({ cb, adapter: ad, receipts, log: (m) => console.log('  · ' + m) }); if (p) console.log('  Profile: ' + (p.written || []).length + ' field(s) copied · ' + p.filled + '/' + p.total + ' filled'); }
    } catch (e) { console.log('  first sync failed: ' + e.message + ' — fix and run: node index.js sync-products --config connector.json'); }
  }
  console.log('\nTo keep it running with nobody there (Windows):  node index.js install --config connector.json');
  console.log('\nNext:\n  node index.js watch --config connector.json' + (out.syncMinutes ? ' --sync-minutes ' + out.syncMinutes : '') + (out.stockMinutes ? ' --stock-minutes ' + out.stockMinutes : '') + '\n    (leave it running — orders land in ' + adapter + ' as they arrive; Settings › Integrations shows it checking in)\n  node index.js once --config connector.json --dry     (see the first voucher before it is posted)\n');
  rl.close();
})().catch((e) => { console.error('setup: ' + (e && e.message)); rl.close(); process.exit(1); });
