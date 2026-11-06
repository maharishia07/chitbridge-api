'use strict';
/**
 * tests/till-counter-doors.test.cjs - TWO COUNTER DOORS NOBODY TESTED: verify and reconcile the counter, and pair a customer display.
 * The REAL routes/till.js behind the real router, over a stubbed database (tests/support/route-golden.cjs); only the key mint is a stand-in.
 * PART 1 - GET /verify and POST /reconcile (the two read-only questions a counter asks the shop)
 *   reconcile  each bill's chit is read back: ok (same number AND same moment) / absorbed (the chit records ANOTHER bill, never "ok")
 *              / missing (no chit id, or no such chit for this shop) / unknown (the chit carries no billed_at: left alone, not guessed)
 *              ONE query for the whole batch, at most 200 bills, a bill with no number is dropped, a malformed chit id counts as none
 *   verify     total = how many sellable products; the shop named; a sample of at most 8 rows spread FIRST..LAST across the shelf
 *              (page one alone must not pass), ONE sample query; an empty shelf asks for no sample; a failed sample read answers with none
 *   never writes: no INSERT / UPDATE / DELETE in either door
 * PART 2 - POST /pair and /pair/claim (what tools/tally-connector/promo.html calls)
 *   pair   a signed-in person or a COUNTER key gets a six-character code from the alphabet without O 0 I 1 L, good for 10 minutes;
 *          a counter's code names that counter key as the parent of the screen; a key that is not a counter (a screen, a connector) is refused 403
 *   claim  the screen swaps the code for a key whose scope is ['screen'] and nothing else, with the shop named; typed as the TV shows it
 *          it still works; the code is SPENT on the first read (a second claim is 404 PAIR_CODE_UNKNOWN); an expired code is 404;
 *          a wrong code is 404; after 8 wrong codes from one address the door shuts with 429 for a minute
 * CARD      09-counter/verify-and-reconcile-the-counter
 * CARD      09-counter/customer-display-promo-screen
 * Run: node tests/till-counter-doors.test.cjs
 */
const assert = require('assert');
const G = require('./support/route-golden.cjs');

const SHOP = '11111111-1111-4111-8111-111111111111';
const PSHOP = '22222222-2222-4222-8222-222222222222';
const C = (n) => '0000000' + n + '-0000-4000-8000-000000000000';
const CHITS = { [C(1)]: { ref: 'C1/26-27/0001', billed_at: '2026-11-06T10:00:00Z' }, [C(2)]: { ref: 'C2/26-27/0009', billed_at: '2026-11-06T10:05:00Z' }, [C(3)]: { ref: 'C1/26-27/0003', billed_at: null } };
let shelf = 20, sampleFails = false;
const h = G.harness({
  known: { [SHOP]: 'SHOP', [PSHOP]: 'PSHOP' },
  rows: (sql, params) => {
    if (/FROM chit_header WHERE entity_id/.test(sql)) return params[1].filter((id) => CHITS[id]).map((id) => ({ chit_id: id, ref: CHITS[id].ref, billed_at: CHITS[id].billed_at }));
    if (/SELECT display_name FROM identities/.test(sql)) return [{ display_name: 'Anand Stores' }];
    if (/SELECT count\(\*\)::int AS n FROM catalogue_items/.test(sql)) return [{ n: shelf }];
    if (/WITH live AS/.test(sql)) {
      if (sampleFails) throw new Error('sample read failed');
      return params[1].map((n) => ({ item_id: 'i' + n, n, item_data: { name: 'Item ' + n, price: 10 + n, tax_slab: '5' } }));
    }
    return [];
  },
});
const till = require('../routes/till');
const minted = [];
require('../lib/api-keys').mint = async (entity, owner, opts) => { minted.push({ entity, owner, opts }); return { key: 'cbk_screen_' + minted.length }; };
const app = h.app('/api/till', till);
const run = (method, url, body, extra) => h.run(app, Object.assign({ method, url, body, identity: { identity_id: SHOP }, settle: 5 }, extra || {}));
const sqlOf = (rec, re) => rec.calls.filter((c) => re.test(c.sql || ''));
const pair = (extra) => run('POST', '/api/till/pair', {}, Object.assign({ identity: { identity_id: PSHOP } }, extra || {}));
const claim = (code) => run('POST', '/api/till/pair/claim', { code }, { identity: { identity_id: PSHOP } });

let n = 0, failed = 0;
const it = async (name, fn) => {
  n++;
  try { await fn(); console.log('  ok  ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
};

(async () => {
  console.log('— verify and reconcile —');
  await it('reconcile: ok / absorbed / missing / unknown, one verdict per bill, in order', async () => {
    const r = await run('POST', '/api/till/reconcile', { bills: [
      { no: 'C1/26-27/0001', at: '2026-11-06T10:00:00Z', chit_id: C(1) },   /* same number, same moment: ok */
      { no: 'C1/26-27/0002', at: '2026-11-06T10:05:00Z', chit_id: C(2) },   /* the chit records C2/0009: another PC's sale was absorbed */
      { no: 'C1/26-27/0003', at: '2026-11-06T10:09:00Z', chit_id: C(3) },   /* the chit has no billed_at: unknown, not guessed */
      { no: 'C1/26-27/0004', at: '2026-11-06T10:10:00Z', chit_id: C(4) },   /* no such chit for this shop */
      { no: 'C1/26-27/0005', at: '2026-11-06T10:11:00Z', chit_id: 'not-a-uuid' }  /* malformed id counts as none */
    ] });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.checked, 5);
    assert.deepStrictEqual(r.body.bills.map((b) => b.verdict), ['ok', 'absorbed', 'unknown', 'missing', 'missing']);
    assert.strictEqual(r.body.bills[1].recorded_as, 'C2/26-27/0009', 'an absorbed bill must say which bill the chit really holds');
  });
  await it('reconcile: the same number at ANOTHER moment is absorbed (two PCs, one number)', async () => {
    const r = await run('POST', '/api/till/reconcile', { bills: [{ no: 'C1/26-27/0001', at: '2026-11-06T11:11:11Z', chit_id: C(1) }] });
    assert.strictEqual(r.body.bills[0].verdict, 'absorbed');
  });
  await it('reconcile: the whole batch is ONE chit_header read, scoped to the shop', async () => {
    const r = await run('POST', '/api/till/reconcile', { bills: [1, 2, 3].map((k) => ({ no: 'B' + k, at: 'x', chit_id: C(k) })) });
    const reads = sqlOf(r, /FROM chit_header/);
    assert.strictEqual(reads.length, 1, 'one query per batch, not one per bill');
    assert.strictEqual(reads[0].params[0], 'SHOP', 'the read names the shop');
  });
  await it('reconcile: nothing named asks nothing; at most 200 bills are answered; a bill with no number is dropped', async () => {
    let r = await run('POST', '/api/till/reconcile', { bills: [{ no: '', at: 'x', chit_id: C(1) }] });
    assert.deepStrictEqual([r.body.checked, sqlOf(r, /FROM chit_header/).length], [0, 0]);
    r = await run('POST', '/api/till/reconcile', { bills: Array.from({ length: 230 }, (_, k) => ({ no: 'N' + k, at: 'x' })) });
    assert.strictEqual(r.body.checked, 200);
    assert.strictEqual(sqlOf(r, /FROM chit_header/).length, 0, 'no chit ids, so no read at all');
  });
  await it('verify: total, the shop by name, a sample of 8 spread first..last (a copy that stopped at page one fails)', async () => {
    shelf = 20;
    const r = await run('GET', '/api/till/verify');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.total, 20);
    assert.strictEqual(r.body.shop.name, 'Anand Stores');
    const at = r.body.sample.map((s) => s.at_offset);
    assert.strictEqual(at.length, 8);
    assert.strictEqual(at[0], 0);
    assert.strictEqual(at[7], 19);
    assert.ok(at.every((v, i) => i === 0 || v > at[i - 1]), 'the sample runs across the shelf, in order');
    assert.strictEqual(r.body.sample[0].name, 'Item 0');
    assert.strictEqual(sqlOf(r, /WITH live AS/).length, 1, 'ONE sample query, not eight');
    assert.ok(typeof r.body.at === 'string', 'the server clock travels so a stale copy is obvious');
  });
  await it('verify: a small shelf samples what it has once; an empty shelf asks for no sample', async () => {
    shelf = 3;
    let r = await run('GET', '/api/till/verify');
    assert.deepStrictEqual(r.body.sample.map((s) => s.at_offset), [0, 1, 2]);
    shelf = 0;
    r = await run('GET', '/api/till/verify');
    assert.strictEqual(r.body.total, 0);
    assert.deepStrictEqual(r.body.sample, []);
  });
  await it('verify: a failed sample read still answers (total and shop), with no sample', async () => {
    shelf = 20; sampleFails = true;
    const r = await run('GET', '/api/till/verify');
    sampleFails = false;
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual([r.body.total, r.body.sample], [20, []]);
  });
  await it('neither door writes: no INSERT / UPDATE / DELETE statement ran', async () => {
    shelf = 20;
    const a = await run('GET', '/api/till/verify');
    const b = await run('POST', '/api/till/reconcile', { bills: [{ no: 'X', at: 'x', chit_id: C(1) }] });
    for (const rec of [a, b]) assert.strictEqual(rec.calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql || '')).length, 0);
  });

  console.log('— pairing a customer display —');
  let code;
  await it('a signed-in person gets a six-character code (no O 0 I 1 L) good for 10 minutes', async () => {
    const r = await pair();
    assert.strictEqual(r.status, 200);
    code = r.body.code;
    assert.ok(/^[ACDEFGHJKMNPQRTUVWXY2345678]{6}$/.test(code), 'code ' + code);
    assert.strictEqual(r.body.minutes, 10);
    assert.ok(r.body.expires_at, 'the code says when it runs out');
  });
  await it('the screen swaps the code for a SCREEN key and nothing else, and the shop comes back named', async () => {
    const r = await claim(code.toLowerCase().slice(0, 3) + '-' + code.slice(3));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(/^cbk_screen_/.test(r.body.key));
    assert.strictEqual(r.body.shop.name, 'Anand Stores');
    const m = minted[minted.length - 1];
    assert.deepStrictEqual(m.opts.scopes, ['screen']);
    assert.strictEqual(m.opts.parent, null, 'paired by a person: no parent counter');
    assert.strictEqual(m.entity, PSHOP);
  });
  await it('the code is SPENT on the first read: a second claim is 404 PAIR_CODE_UNKNOWN and mints nothing', async () => {
    const before = minted.length;
    const r = await claim(code);
    assert.strictEqual(r.status, 404);
    assert.ok(/PAIR_CODE_UNKNOWN/.test(JSON.stringify(r.body)), JSON.stringify(r.body));
    assert.strictEqual(minted.length, before);
  });
  await it('a COUNTER key may pair a screen, and the screen key names that counter key as its parent', async () => {
    const r = await pair({ till: { key: { scopes: ['till'], jti: 'counter-C1' } } });
    assert.strictEqual(r.status, 200);
    const c = await claim(r.body.code);
    assert.strictEqual(c.status, 200);
    assert.strictEqual(minted[minted.length - 1].opts.parent, 'counter-C1');
    assert.deepStrictEqual(minted[minted.length - 1].opts.scopes, ['screen']);
  });
  await it('a key that is not a counter (a screen key, a connector) may not pair a screen: 403 TILL_SIGN_IN_FIRST', async () => {
    for (const scopes of [['screen'], ['connector']]) {
      const r = await pair({ till: { key: { scopes, jti: 'k' } } });
      assert.strictEqual(r.status, 403);
      assert.ok(/TILL_SIGN_IN_FIRST/.test(JSON.stringify(r.body)));
    }
  });
  await it('an EXPIRED code is refused 404 (a code is only good for its ten minutes)', async () => {
    const r = await pair();
    const real = Date.now;
    Date.now = () => real() + 11 * 60000;
    let c;
    try { c = await claim(r.body.code); } finally { Date.now = real; }
    assert.strictEqual(c.status, 404);
  });
  await it('a wrong code is 404, and after 8 wrong codes the address is shut out: 429 PAIR_TOO_MANY_TRIES, even for a right code', async () => {
    const good = (await pair()).body.code;
    const first = await claim('ZZZZZ0');
    assert.strictEqual(first.status, 404);
    let shutAt = 0;
    for (let k = 1; k <= 12 && !shutAt; k++) if ((await claim('ZZZZZ' + k)).status === 429) shutAt = k;
    assert.ok(shutAt > 0 && shutAt <= 8, 'the door must shut within 8 wrong codes; shut at ' + shutAt);
    const shut = await claim(good);
    assert.strictEqual(shut.status, 429);
    assert.ok(/PAIR_TOO_MANY_TRIES/.test(JSON.stringify(shut.body)));
  });

  console.log('\n  ' + (n - failed) + ' passed, ' + failed + ' failed · ' + n + ' checks');
  process.exit(failed ? 1 : 0);
})();
