/**
 * ── tests/reward-cycle.test.js · THE WHOLE CYCLE, ONE CUSTOMER, FOUR VISITS ────────────────────────────────────
 *
 * lib/rewards.js is tested on its own (tests/rewards.test.js, 33 checks). This is the other question: does the
 * SEQUENCE hold — earn, come back, encash, expire, register — when the pieces are put together the way the routes
 * put them together?
 *
 * ⚠️ IT RUNS AGAINST lib/reward-store.js WITH THE DATABASE STUBBED, not against a mock of the store. The stub is a
 * tiny append-only table with the same rules the real one has by GRANT: rows go in and never change. So what is
 * being tested is the real fold, the real expiry, the real claim — everything except the network.
 * ⚠️ AND THE STUB REFUSES AN UPDATE. If a future change ever tries to correct a balance by editing a row, this
 * fails here rather than in production against a table that would have refused it anyway.
 */
const assert = require('assert'), path = require('path');
const rewards = require(path.join(__dirname, '..', 'lib', 'rewards.js'));
const store = require(path.join(__dirname, '..', 'lib', 'reward-store.js'));

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
                           catch (e) { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; } };
const ita = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); }
                                  catch (e) { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; } };

/* ── the shop's own declaration. ONE shop's choice, not a default anybody inherits. ── */
const SHOP = '11111111-1111-1111-1111-111111111111';
const PROG = { definition_id: 'def-1', name: 'Shop points',
               earn: { kind: 'per_amount', per: 100, points: 1 },
               redeem: [{ kind: 'money', points: 100, amount: 1 }],
               expires_months: 12, walk_in_earns: false, min_balance_to_spend: 100 };

/* ── the stub: an append-only table and the two statements the store issues against it ── */
const TABLE = [];
const withEntity = async (entity_id, fn) => fn({
  query: async (sql, args) => {
    if (/^\s*SELECT d\.definition_id/.test(sql)) return { rows: [{ definition_id: 'def-1', name: 'Shop points', rules: PROG }] };
    if (/FROM reward_ledger/.test(sql)) {
      const [eid, scheme, value] = args;
      return { rows: TABLE.filter((r) => r.entity_id === eid && r.holder_scheme === scheme && r.holder_value === value)
                          .slice().sort((a, b) => String(b.at).localeCompare(String(a.at))) };
    }
    if (/^\s*INSERT INTO reward_ledger/.test(sql)) {
      const [entity_id, holder_scheme, holder_value, points, why, ref, note, definition_id, at] = args;
      /* ⚠️ THE REAL UNIQUE INDEX, reproduced: one entry per (shop, bill, reason, holder). A bill that syncs twice
         must not award twice, and the counter replays its queue as a matter of routine. */
      if (ref && TABLE.some((r) => r.entity_id === entity_id && r.ref === ref && r.why === why
                                && r.holder_scheme === holder_scheme && r.holder_value === holder_value))
        return { rows: [] };
      TABLE.push({ entity_id, holder_scheme, holder_value, points: Number(points), why, ref, note,
                   definition_id, at: at || new Date().toISOString() });
      return { rows: [] };
    }
    if (/^\s*UPDATE reward_ledger|^\s*DELETE FROM reward_ledger/i.test(sql))
      throw new Error('reward_ledger is append-only by GRANT — cb_app may not UPDATE or DELETE');
    return { rows: [] };
  },
});

/** the award path, as routes/till.js performs it — kept in one place so the visits below read as visits */
async function bill(holder, ref, net, spend) {
  const prog = await store.programme(SHOP, withEntity);
  const walkIn = holder.scheme === 'phone';
  const mayEarn = !walkIn || prog.walk_in_earns !== false;
  const added = mayEarn ? rewards.earnedOn(prog, { net, count: 1, lines: [] }) : 0;
  const before = await store.balance(SHOP, holder, withEntity, prog);
  const rows = before.expired.slice();
  if (spend > 0) rows.push(rewards.entry({ points: -spend, why: 'spent', ref, note: 'encashed on this bill' }));
  if (added > 0) rows.push(rewards.entry({ points: added, why: 'earned', ref, note: 'bill ' + ref }));
  for (const e of rows.filter(Boolean)) await store.append(SHOP, holder, e, prog.definition_id, withEntity);
  return { added, spent: spend || 0, points: before.points - (spend || 0) + added,
           overspent: (spend || 0) > before.points ? (spend || 0) - before.points : 0 };
}

(async () => {
console.log('— a walk-in with no number —');

await ita('⚠️ earns nothing, and there is nobody to accrue it to', async () => {
  const h = rewards.holderOf({ name: 'Walk-in' });
  assert.strictEqual(h, null, 'a walk-in who gave nothing must hold nothing');
});

console.log('— visit 1: a walk-in who gives a phone number —');

const PHONE = { scheme: 'phone', value: '9840012345' };
await ita('⚠️ THIS SHOP DECLARED walk_in_earns:false, so a phone holder earns nothing — and is told, not ignored', async () => {
  const r = await bill(PHONE, 'B-001', 640, 0);
  assert.strictEqual(r.added, 0, 'the shop said walk-ins do not earn, and the counter awarded anyway');
  assert.strictEqual(r.points, 0);
});

console.log('— visit 2: the same person, now on the shop’s list —');

const ME = { scheme: 'identity', value: 'cust-77' };
await ita('⭐ 1 point per ₹100 — ₹640 earns 6, not 6.4', async () => {
  const r = await bill(ME, 'B-002', 640, 0);
  assert.strictEqual(r.added, 6, 'a fraction of a point is not a point');
  assert.strictEqual(r.points, 6);
});

await ita('⭐⭐ and the SAME bill arriving again awards nothing — the counter replays its queue', async () => {
  const before = TABLE.length;
  const r = await bill(ME, 'B-002', 640, 0);
  assert.strictEqual(TABLE.length, before, 'a replayed bill wrote a second row');
  assert.strictEqual((await store.balance(SHOP, ME, withEntity)).points, 6, 'a replay doubled the balance');
});

console.log('— visits 3 to 20: enough to be worth something —');

await ita('⭐ a year of ordinary shopping', async () => {
  for (let n = 3; n <= 20; n++) await bill(ME, 'B-0' + String(n).padStart(2, '0'), 1200, 0);
  const b = await store.balance(SHOP, ME, withEntity);
  assert.strictEqual(b.points, 6 + 18 * 12, '18 bills of ₹1,200 earn 12 each');
  assert.strictEqual(b.worth, 2.22, '222 points at 100 = ₹1 is ₹2.22 the shop owes');
});

await ita('⭐⭐ and the shopkeeper is told what it MEANS, not just the number', async () => {
  const b = await store.balance(SHOP, ME, withEntity);
  const w = rewards.worthOf(PROG, b.points, {});
  assert.ok(/^222 points · worth 2\.22/.test(w.says), 'got: ' + w.says);
});

console.log('— visit 21: encashing —');

await ita('⭐⭐⭐ points pay for part of the bill; they do NOT reduce it', async () => {
  const before = (await store.balance(SHOP, ME, withEntity)).points;
  const r = await bill(ME, 'B-021', 500, 200);
  assert.strictEqual(r.spent, 200);
  assert.strictEqual(r.added, 5, '₹500 still earns 5 — the bill was 500, not 498');
  assert.strictEqual(r.points, before - 200 + 5);
  assert.strictEqual(r.overspent, 0);
});

await ita('⚠️ a spend the balance cannot cover is STILL WRITTEN, and reported', async () => {
  const r = await bill(ME, 'B-022', 100, 5000);
  assert.ok(r.overspent > 0, 'an unaffordable spend was silently accepted with no warning');
  const b = await store.balance(SHOP, ME, withEntity);
  assert.ok(b.negative, 'the ledger does not add up and is not saying so');
  /* ⚠️ THE REASON IT IS WRITTEN: the customer already paid a reduced price at the counter. Refusing the record
     here would leave them with the goods AND the points, and the shop with neither. */
});

console.log('— the year after —');

await ita('⭐⭐ points expire twelve months after they were earned, as an ENTRY the customer can read', async () => {
  const OLD = { scheme: 'identity', value: 'cust-old' };
  TABLE.push({ entity_id: SHOP, holder_scheme: 'identity', holder_value: 'cust-old', points: 500,
               why: 'earned', ref: 'B-OLD', note: null, definition_id: 'def-1',
               at: '2024-06-01T00:00:00.000Z' });
  const b = await store.balance(SHOP, OLD, withEntity);
  assert.strictEqual(b.points, 0, 'a two-year-old balance is still being counted');
  assert.strictEqual(b.expired.length, 1);
  assert.strictEqual(b.expired[0].points, -500);
  assert.strictEqual(b.expired[0].why, 'expired', 'expiry must be readable in the ledger, not a silent filter');
});

console.log('— the walk-in who registers —');

await ita('⭐⭐ a phone balance moves onto the account as two entries netting to zero', async () => {
  const PH = { scheme: 'phone', value: '9000011111' }, ID = { scheme: 'identity', value: 'cust-new' };
  await store.append(SHOP, PH, rewards.entry({ points: 340, why: 'earned', ref: 'B-W1' }), 'def-1', withEntity);
  const from = await store.balance(SHOP, PH, withEntity);
  const c = rewards.claim(from, PH, ID, 'CLAIM-1');
  assert.strictEqual(c.ok, true);
  for (const e of c.entries) await store.append(SHOP, e.holder, e, 'def-1', withEntity);
  assert.strictEqual((await store.balance(SHOP, PH, withEntity)).points, 0, 'the phone still holds points');
  assert.strictEqual((await store.balance(SHOP, ID, withEntity)).points, 340, 'the account did not receive them');
});

console.log('— what the ledger will not let anyone do —');

await ita('⚠️⚠️ nothing corrects a balance by editing a row', async () => {
  await assert.rejects(
    () => withEntity(SHOP, (db) => db.query('UPDATE reward_ledger SET points = 0 WHERE ref = $1', ['B-002'])),
    /append-only/, 'an UPDATE against the ledger was allowed');
});

it('⭐ and every row that was ever written is still there', () => {
  assert.ok(TABLE.length >= 25, 'only ' + TABLE.length + ' rows — something removed history');
  assert.ok(TABLE.every((r) => r.points !== 0), 'a zero entry records nothing and should never have been written');
});

console.log(pass + ' checks');
})();
