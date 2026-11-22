/**
 * tests/walkd-reward-replay.test.cjs — WALK-D D-F-12: A REWARD REPLAY IS ANSWERED WITH WHAT THE FIRST CALL RECORDED, NOT THE SUM AGAIN.
 *
 * OWNS      lib/reward-store.settle over a ledger stand-in (the unique (holder, ref, why) of reward_ledger): bill C3/2026/0001 earns 10 points. First call: added 10, points 10.
 *           The SAME bill again under another key: added 10 (what the ledger holds for the ref), points 10 (the balance, not 20), nothing written a second time. A spend of 4 on the bill replays as spent 4.
 *           The slip printed from the replay therefore matches the first one. routes/till.js rewardSettled passes the answer through.
 * CALLED BY by hand: node tests/walkd-reward-replay.test.cjs
 * FLOW      settle → settledBefore (entries under this ref?) → yes: { added, spent, after = balance now, replayed } | no: earn, write, { added, spent, after }
 * CARD      14-crm/rewards-and-loyalty
 */
'use strict';
const path = require('path');
process.env.NODE_ENV = 'test';
const HERE = path.join(__dirname, '..');
const store = require(path.join(HERE, 'lib', 'reward-store'));
const counterBill = require(path.join(HERE, 'lib', 'counter-bill'));
const rewards = require(path.join(HERE, 'lib', 'rewards'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

const ledger = [];
const db = {
  query: async (sql, params) => {
    if (/INSERT INTO reward_ledger/.test(sql)) {
      const [, scheme, value, points, why, ref] = params;
      if (ledger.some((x) => x.value === value && x.ref === ref && x.why === why)) return { rows: [] };
      ledger.push({ scheme, value, points, why, ref, at: new Date() });
      return { rows: [{ entry_id: ledger.length }] };
    }
    if (/GROUP BY why/.test(sql)) {
      const mine = ledger.filter((x) => x.ref === params[3] && (x.why === 'earned' || x.why === 'spent'));
      const sums = {};
      mine.forEach((x) => { sums[x.why] = (sums[x.why] || 0) + x.points; });
      return { rows: Object.keys(sums).map((why) => ({ why, points: sums[why] })) };
    }
    if (/FROM reward_ledger/.test(sql)) {
      const total = ledger.reduce((sum, x) => sum + x.points, 0);
      return { rows: ledger.map((x) => Object.assign({}, x, { total })).reverse() };
    }
    return { rows: [] };
  }
};
const withEntity = async (entity, fn) => fn(db);
require('../lib/xact-lock').lockKeys = async () => undefined;
counterBill.byRef = async () => ({ billed_at: null, line_items: [] });
rewards.earnedOn = () => 10; /* the programme: 10 points on this bill (hand figure) */
const prog = { definition_id: 'd1', name: 'Points' };
const holder = { scheme: 'phone', value: '9840012345' };

(async () => {
  console.log('\n== WALK-D D-F-12 · a reward replay does not overstate ==\n');
  const first = await store.settle('e1', holder, prog, { ref: 'C3/2026/0001', spend: 0, earn: true }, withEntity);
  ok('first call: added 10, balance after 10, one entry', first.added === 10 && first.after === 10 && !first.replayed && ledger.length === 1, JSON.stringify(first));
  const second = await store.settle('e1', holder, prog, { ref: 'C3/2026/0001', spend: 0, earn: true }, withEntity);
  ok('the same bill again: added 10 (what the ledger holds), points 10 (not 20), replayed', second.added === 10 && second.after === 10 && second.replayed === true, JSON.stringify(second));
  ok('…and nothing was written a second time (ledger still holds one entry)', ledger.length === 1);
  /* a spend of 4 on another bill: 10 - 4 + 10 = 16, and its replay says spent 4, points 16 */
  const spendFirst = await store.settle('e1', holder, prog, { ref: 'C3/2026/0002', spend: 4, earn: true }, withEntity);
  ok('bill 2 with a spend of 4: added 10, spent 4, points 10 - 4 + 10 = 16', spendFirst.added === 10 && spendFirst.spent === 4 && spendFirst.after === 16, JSON.stringify(spendFirst));
  const spendAgain = await store.settle('e1', holder, prog, { ref: 'C3/2026/0002', spend: 4, earn: true }, withEntity);
  ok('its replay: added 10, spent 4, points 16 (the same slip)', spendAgain.added === 10 && spendAgain.spent === 4 && spendAgain.after === 16 && spendAgain.replayed === true, JSON.stringify(spendAgain));
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
