'use strict';
/**
 * tests/reward-walkins-one-reader.test.cjs - DRIFT cluster 5 (27 Nov 2026): the CRM walk-in list quoted the raw stored SUM while the till spends the expiry-folded balance.
 * OWNS (1) walkIns(A) equals balanceOn(A).points for every phone, on a fake ledger with expires_months 12 (A: earned 100 fourteen months old + 50 one month old -> 50; B: 80 fifteen months old -> dropped;
 *      C: earned then claimed away -> net 0, dropped; D: no expiry in the programme -> raw sum);
 * CALLED BY scripts/guards-list-1.cjs   Run: node tests/reward-walkins-one-reader.test.cjs   
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
let TERMS = null; /* the newest reward definition's rules when no programme is live (a paused / ended programme) */
const db = { async query(sql, p) {
  if (/FROM definition d JOIN definition_version/.test(sql)) return /status = 'live'/.test(sql) ? { rows: [] } : { rows: TERMS ? [{ definition_id: 'd1', name: 'Points', rules: TERMS }] : [] };
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
  /* a given point is a promise (DECISIONS 28 Nov): no live programme -> the holder still holds the stored balance, in the list and at the till, never 0 */
  const withE = async (_e, fn) => fn(db);
  const kept = await store.balance('shop', { scheme: 'phone', value: 'A' }, withE, null);
  eq('never ran a programme: balance of A is the stored 150, not 0', [kept.programme, kept.points, kept.worth], [null, 150, null]);
  /* PAUSED / ENDED programme: the expiry term is part of the promise (DECISIONS 5d9ed0f7): A still 50, B 0 and not listed - what can be spent that day, never the stored sum */
  TERMS = { expires_months: 12 };
  const paused = await store.termsOf('shop', withE);
  const wp = await store.walkIns(db, 'shop', paused);
  for (const ph of ['A', 'B']) eq('paused programme: list = till for ' + ph, Object.fromEntries(wp.rows.map((x) => [x.phone, x.points]))[ph] || 0, Math.max(0, (await store.balance('shop', { scheme: 'phone', value: ph }, withE, null)).points));
  eq('paused programme: A holds 50, B is not listed', [Object.fromEntries(wp.rows.map((x) => [x.phone, x.points])).A, wp.rows.some((x) => x.phone === 'B')], [50, false]);
  eq('paused programme: no new earning side effect, programme answer is null', (await store.balance('shop', { scheme: 'phone', value: 'A' }, withE, null)).programme, null);
  TERMS = null;
  console.log(pass + fail + ' checks, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
