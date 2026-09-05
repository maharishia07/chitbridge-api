#!/usr/bin/env node
/**
 * ChitBridge connector — CLI.
 *   node index.js sync-products  --config connector.json [--adapter tally|csv] [--dry]
 *   node index.js evaluate       --config connector.json --lines lines.json          (basket lines → what comes off, and why)
 *   node index.js once           --config connector.json                              (catch-up: push every received order not yet pushed)
 *   node index.js watch          --config connector.json                              (catch-up, then hold the push stream; Ctrl-C to stop)
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
  const cfg = core.loadConfig(cfgFile); cfg._configFile = cfgFile; cfg.dry = !!flag('dry', false); cfg.log = log;
  const adapterName = flag('adapter', cfg.adapter || 'tally');
  const adapter = require('./adapters/' + adapterName)(cfg);
  const cb = new core.CB({ api: cfg.api, key: cfg.key, log }); cb.name = cfg.name || (adapterName + ' connector');
  const receipts = new core.Receipts(cfg.receipts);
  if (cmd !== 'help') cb.heartbeat({ name: cb.name, adapter: adapterName, counters: core.counts(receipts), note: cmd });
  if (cmd === 'sync-products') { const r = await core.syncProducts({ cb, adapter, receipts, log }); console.log(JSON.stringify(r)); return; }
  if (cmd === 'evaluate') { const lines = JSON.parse(fs.readFileSync(path.resolve(flag('lines', 'lines.json')), 'utf8')); const r = await core.evaluate({ cb, lines: Array.isArray(lines) ? lines : lines.lines, offers: lines.offers }); console.log(JSON.stringify(r, null, 2)); return; }
  if (cmd === 'once') { const r = await core.catchUp({ cb, adapter, receipts, log }); console.log(JSON.stringify(r)); return; }
  if (cmd === 'watch') { const ac = new AbortController(); process.on('SIGINT', () => { log('stopping'); ac.abort(); }); await core.watchOrders({ cb, adapter, receipts, log, signal: ac.signal, onEvent: (d) => log('bell: ' + JSON.stringify(d)) }); return; }
  console.error('unknown command ' + cmd); process.exit(2);
})().catch((e) => { console.error('connector: ' + (e && e.message)); process.exit(1); });
