/* cmdb-records.cjs — every capability that names a CMDB record points at the ONE record page, with an id the API
 * actually ships a record for (chitbridge-api/data/cmdb/<CI>.json — what POST /api/testing/cmdb/seed loads).
 * Athi, 2026-09-28: "can it be linked in the cmdb database as part of this capability, so anyone can look at this?"
 * ⚠️ A link to a record nobody seeded opens a page that says "No such record" — a dead end nobody reports. This
 * reports it, offline, before it ships.
 * Run: node e2e/cmdb-records.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const PUB = path.join(__dirname, '..', 'public');
const SEED = path.join(__dirname, '..', '..', 'chitbridge-api', 'data', 'cmdb');
const src = fs.readFileSync(path.join(PUB, 'app', 'cap-legend.js'), 'utf8').replace(/\r\n/g, '\n');
const m = src.match(/const CAP_CATALOGUE = (\[[\s\S]*?\n\]);/);
if (!m) { console.log('✗ CAP_CATALOGUE not found — this check is measuring nothing'); process.exit(1); }
const caps = vm.runInNewContext(m[1]);
let bad = 0, n = 0;
if (!fs.existsSync(path.join(PUB, 'cmdb', 'record.html'))) { console.log('✗ public/cmdb/record.html is missing'); process.exit(1); }
caps.filter((c) => c.record).forEach((c) => {
  n++;
  const mm = String(c.record).match(/^\/cmdb\/record\.html#(CAP-[A-Z0-9-]+)$/);
  if (!mm) { bad++; console.log('✗ ' + c.id + ' → "' + c.record + '" is not /cmdb/record.html#CAP-…'); return; }
  const f = path.join(SEED, mm[1] + '.json');
  if (!fs.existsSync(SEED)) { console.log('  (chitbridge-api is not beside this repo — the id is checked for shape only)'); console.log('✓ ' + c.id + ' → ' + mm[1]); return; }
  if (!fs.existsSync(f)) { bad++; console.log('✗ ' + c.id + ' → ' + mm[1] + ': the API ships no record by that id'); return; }
  const r = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (r.ci !== mm[1]) { bad++; console.log('✗ ' + c.id + ' → ' + mm[1] + ': the shipped record calls itself ' + r.ci); return; }
  console.log('✓ ' + c.id + ' → ' + mm[1] + ' (' + r.title + ')');
});
if (!n) { console.log('✗ no capability names a record — the link was lost'); process.exit(1); }
console.log(bad ? '\n✗ ' + bad + ' broken record link(s)\n' : '\n✓ ' + n + ' record link(s) resolve to a shipped record\n');
process.exit(bad ? 1 : 0);
