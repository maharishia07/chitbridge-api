/**
 * ao-reward-return.test.cjs - AO-F-05 (walk AO, 22 Nov 2026): a return takes back the points its bill earned, pro rata. Fake ledger db, no Postgres; the arithmetic is the stored engine totals' ratio (counter-bill.pickOf), floored, capped.
 * Hand: a 13.50 bill earned 20 points. Full return (13.50 / 13.50) -> -20, balance 0. Half (6.75 / 13.50) -> floor(20 x 0.5) = -10. A third part (4.50 / 13.50) -> floor(6.67) = -6. A second full return after a half: the rest, -10.
 * A replay writes nothing (the note's own ref); points already spent are never taken below zero (earned 20, balance 5 -> -5).
 * Run: node tests/ao-reward-return.test.cjs
 */
'use strict';
const path = require('path');
process.env.NODE_ENV = 'test';
const store = require(path.join(__dirname, '..', 'lib', 'reward-store'));
let pass = 0, fail = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? '   ok   ' : '   FAIL ') + name + (ok ? '' : '\n          got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want))); };
const H = { scheme: 'phone', value: '0501234567' };
function world(billTotal, earned, spentPoints) {
  const ledger = [{ ...H, points: earned, why: 'earned', ref: 'C1/2026/0002' }];
  if (spentPoints) ledger.push({ ...H, points: -spentPoints, why: 'spent', ref: 'other' });
  const notes = {};
  const db = { async query(sql, p) {
    if (/FROM chit_header WHERE entity_id = \$1 AND chit_id = \$2/.test(sql)) return { rows: [{ summary_json: p[1] === 'bill-chit' ? { money: { total: billTotal } } : notes[p[1]] }] };
    if (/business_json->>'client_ref'/.test(sql)) return { rows: [{ chit_id: 'bill-chit' }] };
    if (/SUM\(points\) FILTER/.test(sql)) { const r = ledger.filter((x) => x.ref === p[1] || String(x.ref).startsWith(p[1] + '|')); const sum = (why) => r.filter((x) => x.why === why).reduce((t, x) => t + x.points, 0); return { rows: r.length ? [{ holder_scheme: H.scheme, holder_value: H.value, earned: sum('earned'), reversed: sum('reversed') }] : [] }; }
    if (/FROM reward_ledger/.test(sql)) { const total = ledger.reduce((t, x) => t + x.points, 0); return { rows: ledger.map((x) => ({ ...x, note: null, at: new Date(), total })) }; }
    if (/INSERT INTO reward_ledger/.test(sql)) { if (ledger.some((x) => x.ref === p[5] && x.why === p[4])) return { rows: [] }; ledger.push({ ...H, points: p[3], why: p[4], ref: p[5] }); return { rows: [{ entry_id: 1 }] }; }
    return { rows: [] }; /* the advisory lock */
  } };
  const withEntity = async (_e, fn) => fn(db);
  const balance = () => ledger.reduce((t, x) => t + x.points, 0);
  const back = (id, total) => { notes[id] = { money: { total } }; return store.takeBackOnReturn('shop', id, 'C1/2026/0002', withEntity); };
  return { back, balance };
}
(async () => {
  let w = world(13.5, 20);
  eq('a full return takes back all 20; the balance is 0', [(await w.back('n1', 13.5)).reversed, w.balance()], [20, 0]);
  eq('the same note again writes nothing (replay)', [(await w.back('n1', 13.5)).reversed, w.balance()], [0, 0]);
  w = world(13.5, 20);
  eq('half returned: floor(20 x 0.5) = 10 back', [(await w.back('n2', 6.75)).reversed, w.balance()], [10, 10]);
  eq('then the other half (a full-size share of what is left): the rest, 10', [(await w.back('n3', 13.5)).reversed, w.balance()], [10, 0]);
  w = world(13.5, 20);
  eq('a third of the bill: floor(6.67) = 6 back', [(await w.back('n4', 4.5)).reversed, w.balance()], [6, 14]);
  w = world(13.5, 20, 15);
  eq('points already spent: only what the holder still has (5) is taken back, never below zero', [(await w.back('n5', 13.5)).reversed, w.balance()], [5, 0]);
  w = world(13.5, 0);
  eq('a bill that earned nothing: nothing to take back', [(await w.back('n6', 13.5)).reversed, w.balance()], [0, 0]);
  console.log('\n   ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   CRASH ' + (e && e.stack)); process.exit(1); });
