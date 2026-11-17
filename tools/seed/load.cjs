/**
 * load.cjs — push a generated catalogue into a shop through a CONNECTOR key.
 *
 * /api/products/bulk takes at most 200 in one call (BULK_MAX), so 10,400 rows is 52 calls. Four at a time: enough to finish in a
 * minute across the Pacific, few enough that it is never mistaken for a flood.
 *
 * ⚠️ IT ONLY INSERTS. There is no upsert here and no delete — running it twice gives you the catalogue twice. Empty the shelf
 * first (migrations/b208) and then load once.
 *
 * Run:  node tools/seed/load.cjs tools/seed/tallytest-10k.json
 */
'use strict';
const path = require('path');
const cfg = require(path.join(__dirname, '..', 'tally-connector', 'connector.json'));
const FILE = process.argv[2] || path.join(__dirname, 'tallytest-10k.json');
const items = require(path.isAbsolute(FILE) ? FILE : path.join(process.cwd(), FILE));
const SIZE = 200, LANES = 4;

const batches = [];
for (let i = 0; i < items.length; i += SIZE) batches.push(items.slice(i, i + SIZE));

let done = 0, added = 0, failed = 0;
const started = Date.now();

async function send(b, n) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(cfg.api + '/api/products/bulk', { method: 'POST',
        headers: { 'X-Api-Key': cfg.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: b }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { added += (j.added || 0); return; }
      if (attempt === 3) { failed += b.length; console.log('  batch ' + n + ' FAILED ' + r.status + ' ' + JSON.stringify(j).slice(0, 200)); }
    } catch (e) {
      if (attempt === 3) { failed += b.length; console.log('  batch ' + n + ' threw: ' + e.message); }
    }
  }
}

(async () => {
  console.log(items.length + ' products · ' + batches.length + ' batches of ' + SIZE + ' · ' + LANES + ' at a time');
  const queue = batches.map((b, i) => [b, i + 1]);
  await Promise.all(Array.from({ length: LANES }, async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      await send(next[0], next[1]);
      done++;
      if (done % 10 === 0 || done === batches.length)
        console.log('  ' + done + '/' + batches.length + ' batches · ' + added + ' added · ' + Math.round((Date.now() - started) / 1000) + 's');
    }
  }));
  console.log('\nadded ' + added + (failed ? (', FAILED ' + failed) : '') + ' in ' + Math.round((Date.now() - started) / 1000) + 's');
})();
