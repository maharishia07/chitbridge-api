'use strict';
/**
 * tests/reward-walkins-one-reader.test.cjs - DRIFT cluster 5 (27-28 Nov 2026): the CRM walk-in list quoted the raw stored SUM while the till spends the expiry-folded balance; and a programme that stopped zeroed the till.
 * OWNS walkIns(db) equals balanceOn(A).points for every phone, on a fake ledger with expires_months 12 (A: earned 100 fourteen months old + 50 one month old -> 50; B: 80 fifteen months old -> dropped; C: earned then claimed away
 *      -> net 0, dropped), in four states of the programme: LIVE, LIVE without expiry (stored sums), NEVER RAN (stored sums), ENDED/PAUSED (the expiry term stays: A 50, B dropped; DECISIONS 5d9ed0f7). The one-reader guard is
 *      tests/one-reader-tables.test.cjs (docs/one-reader/reward_ledger.json).
 * CALLED BY scripts/guards-list-1.cjs   Run: node tests/reward-walkins-one-reader.test.cjs
 */
const path = require('path');
process.env.NODE_ENV = 'test';
const store = require(path.join(__dirname, '..', 'lib', 'reward-store'));
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
/* the world: RULES = the newest definition that ever ran; LIVE = it is live now (programme() answers it) */
let RULES = null, LIVE = false;
const rulesRow = () => (RULES ? { definition_id: 'd1', name: 'Points', rules: RULES } : null);
const byHolder = () => { const g = {}; for (const x of ledger) { const k = x.holder_value; g[k] = g[k] || { phone: k, points: 0, last_at: x.at, list: [] }; g[k].points += x.points; if (x.at > g[k].last_at) g[k].last_at = x.at; g[k].list.push(x); } return g; };
const db = { async query(sql, p) {
  if (/WITH t AS/.test(sql)) { /* walkIns: ONE statement */
    const expiry = RULES && Number(RULES.expires_months) > 0;
    return { rows: Object.values(byHolder()).filter((x) => x.points > 0).sort((a, b) => (a.last_at < b.last_at ? 1 : -1)).map((x) => ({ phone: x.phone, points: x.points, last_at: x.last_at, rules: RULES, entries: expiry ? x.list.slice().sort((a, b) => (a.at < b.at ? 1 : -1)) : null })) };
  }
  if (/ORDER BY \(d\.status = 'live'\) DESC/.test(sql)) return { rows: rulesRow() ? [rulesRow()] : [] }; /* termsOf */
  if (/d\.status = 'live'/.test(sql) && /FROM definition d JOIN definition_version/.test(sql)) return { rows: LIVE && rulesRow() ? [rulesRow()] : [] }; /* programme() */
  if (/FROM reward_ledger/.test(sql)) { const mine = ledger.filter((x) => x.holder_value === p[2]).sort((a, b) => (a.at < b.at ? 1 : -1)); const total = mine.reduce((t, x) => t + x.points, 0); return { rows: mine.slice(0, p[3] == null ? undefined : p[3]).map((x) => ({ ...x, total })) }; }
  return { rows: [] };
} };
const withE = async (_e, fn) => fn(db);
const list = async () => Object.fromEntries((await store.walkIns(db, 'shop')).rows.map((x) => [x.phone, x.points]));
const till = async (ph) => (await store.balance('shop', { scheme: 'phone', value: ph }, withE)).points;
(async () => {
  /* 1. LIVE programme, expires 12 months */
  RULES = { expires_months: 12 }; LIVE = true;
  let by = await list();
  for (const ph of ['A', 'B', 'C']) eq('live: walk-in list = till for ' + ph, by[ph] || 0, Math.max(0, await till(ph)));
  eq('live: A quotes 50 (the 100 lapsed)', by.A, 50);
  eq('live: B (all lapsed) and C (claimed away) are not listed', ['B' in by, 'C' in by], [false, false]);
  /* 2. LIVE, no expiry declared: the stored sums */
  RULES = { expires_months: 0 };
  eq('live, no expiry: stored sums', await list(), { A: 150, B: 80 });
  /* 3. NEVER RAN a programme: the holder still holds the stored balance, never 0 */
  RULES = null; LIVE = false;
  const kept = await store.balance('shop', { scheme: 'phone', value: 'A' }, withE);
  eq('never ran: balance of A is the stored 150, programme null, worth null', [kept.programme, kept.points, kept.worth], [null, 150, null]);
  eq('never ran: list = stored sums', await list(), { A: 150, B: 80 });
  /* 4. ENDED / PAUSED: no NEW earning, but the expiry term is part of the promise (DECISIONS 5d9ed0f7): A still 50, B 0 and not listed */
  RULES = { expires_months: 12 }; LIVE = false;
  by = await list();
  eq('ended: A holds 50 in the list, B and C not listed', [by.A, 'B' in by, 'C' in by], [50, false, false]);
  for (const ph of ['A', 'B']) eq('ended: list = till for ' + ph, by[ph] || 0, Math.max(0, await till(ph)));
  eq('ended: the till answers programme null (held, not redeemable), points 50', [(await store.balance('shop', { scheme: 'phone', value: 'A' }, withE)).programme, await till('A')], [null, 50]);
  console.log(pass + fail + ' checks, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
