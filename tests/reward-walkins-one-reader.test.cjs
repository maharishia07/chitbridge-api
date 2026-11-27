'use strict';
/**
 * tests/reward-walkins-one-reader.test.cjs - DRIFT cluster 5 (27 Nov 2026): the CRM walk-in list quoted the raw stored SUM while the till spends the expiry-folded balance.
 * OWNS (1) walkIns(A) equals balanceOn(A).points for every phone, on a fake ledger with expires_months 12 (A: earned 100 fourteen months old + 50 one month old -> 50; B: 80 fifteen months old -> dropped;
 *      C: earned then claimed away -> net 0, dropped; D: no expiry in the programme -> raw sum); (2) the GUARD: no file in lib/ or routes/ other than lib/reward-store.js holds SQL on reward_ledger.
 * CALLED BY scripts/guards-list-1.cjs   Run: node tests/reward-walkins-one-reader.test.cjs   (SCAN_SELFTEST=1 plants a read and must fail)
 */
const fs = require('fs'), path = require('path');
process.env.NODE_ENV = 'test';
const API = path.join(__dirname, '..');
const store = require(path.join(API, 'lib', 'reward-store'));
let pass = 0, fail = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? '   ok   ' : '   FAIL ') + name + (ok ? '' : '  got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want))); };
const months = (n) => new Date(Date.now() - n * 30.5 * 864e5).toISOString();
const ledger = [
  { holder_value: 'A', points: 100, why: 'earned', ref: 'a1', note: null, at: months(14) },
  { holder_value: 'A', points: 50, why: 'earned', ref: 'a2', note: null, at: months(1) },
  { holder_value: 'B', points: 80, why: 'earned', ref: 'b1', note: null, at: months(15) },
  { holder_value: 'C', points: 40, why: 'earned', ref: 'c1', note: null, at: months(2) },
  { holder_value: 'C', points: -40, why: 'claimed', ref: 'c2', note: null, at: months(1) }
];
const db = { async query(sql, p) {
  if (/GROUP BY holder_value/.test(sql)) { const g = {}; for (const x of ledger) { const k = x.holder_value; g[k] = g[k] || { phone: k, points: 0, last_at: x.at }; g[k].points += x.points; if (x.at > g[k].last_at) g[k].last_at = x.at; } return { rows: Object.values(g).filter((x) => x.points > 0).sort((a, b) => (a.last_at < b.last_at ? 1 : -1)) }; }
  if (/holder_value = ANY/.test(sql)) return { rows: ledger.filter((x) => p[1].includes(x.holder_value)).sort((a, b) => (a.holder_value === b.holder_value ? (a.at < b.at ? 1 : -1) : a.holder_value < b.holder_value ? -1 : 1)) };
  if (/FROM reward_ledger/.test(sql)) { const mine = ledger.filter((x) => x.holder_value === p[2]).sort((a, b) => (a.at < b.at ? 1 : -1)); const total = mine.reduce((t, x) => t + x.points, 0); return { rows: mine.slice(0, p[3] == null ? undefined : p[3]).map((x) => ({ ...x, total })) }; }
  return { rows: [] };
} };
(async () => {
  const prog = { expires_months: 12 };
  const w = await store.walkIns(db, 'shop', prog);
  const by = Object.fromEntries(w.rows.map((x) => [x.phone, x.points]));
  for (const ph of ['A', 'B', 'C']) {
    const till = (await store.balanceOn(db, 'shop', { scheme: 'phone', value: ph }, prog)).points;
    eq('walk-in list = till balance for ' + ph, by[ph] || 0, till > 0 ? till : 0);
  }
  eq('A quotes 50 (the 100 lapsed)', by.A, 50);
  eq('B (all lapsed) is not listed', 'B' in by, false);
  eq('C (claimed away) is not listed', 'C' in by, false);
  const none = await store.walkIns(db, 'shop', { expires_months: 0 });
  eq('no expiry declared: stored sums as before', Object.fromEntries(none.rows.map((x) => [x.phone, x.points])), { A: 150, B: 80 });
  /* the guard: one reader of reward_ledger */
  const hits = [];
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:])\/\/.*$/gm, '$1');
  const roots = ['lib', 'routes'];
  const scan = (root) => { for (const f of fs.readdirSync(path.join(API, root))) { const rel = root + '/' + f; if (!/\.(js|cjs)$/.test(f) || rel === 'lib/reward-store.js') continue; strip(fs.readFileSync(path.join(API, rel), 'utf8')).split('\n').forEach((line, i) => { if (/\breward_ledger\b/.test(line) && !/tables:\s*\[/.test(line)) hits.push(rel + ':' + (i + 1)); }); } };
  roots.forEach(scan);
  if (process.env.SCAN_SELFTEST) hits.push('selftest:1');
  eq('no SQL on reward_ledger outside lib/reward-store.js (file:line of any hit)', hits, []);
  console.log(pass + fail + ' checks, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
