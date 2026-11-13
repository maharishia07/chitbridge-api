/**
 * tests/ctr-213-invoice-lease.test.cjs — CTR-213 (ACC-192 S2): a till LEASES blocks of invoice numbers from the server's ONE invoice counter (lib/invoice-lease).
 *
 * HAND FIGURES (written before the code; the counter is books_counter series 'invoice', fiscal_year '-', so the FIRST number of an empty counter is 1; a block of N from next_no k is k..k+N-1 and moves next_no to k+N):
 *   H1  two tills ask at once, size 50, empty counter:        A 1..50 · B 51..100 · counter next_no 101 · a further invoice then takes 101
 *   H2  till A holds 1..50 and prints 1..30; the block EXPIRES; A asks again:   the new block is 51..100 (the counter moved to 51, nothing else was taken), 1..50 is NEVER re-leased;
 *       the report names 31..50 unused (reason 'expired'), no gap; 1..30 recorded
 *   H3  counter next_no 7, till asks for 3:                    7..9 · it prints 7, 8, 9 (all recorded, no ahead, no gap) · a 10th number printed anyway is RECORDED, listed OUTSIDE (never refused)
 *   H4  lease 1..5 (open), recorded 1, 2, 4:                   gaps [3] · ahead 5..5 · unused [] ; a reason {3, void} turns the gap into unused [{3, void}] and leaves gaps []
 *   H5  lease 1..5 for A and a till number 77 recorded:        outside [77] ; a further invoice of 6 has no till id, so it is not listed as outside
 *   H6  till holds 1..50 (size 50 → refill at 10 left): remaining 11 → the SAME block (reused, counter unmoved at 51) · remaining 10 → a NEW block 51..100 · now two open → remaining 0 → the newest again (no third block)
 *   H7  a lease runs under the key 'note-series|invoice|<issuer>' — the lock a further invoice takes — so a give-back is never a silent no-op between them
 *   H8  closing 1..50 (1..30 recorded) with {31, void}: unused 31 void + 32..50 'unused', gaps []; naming recorded number 7 unused → LEASE_NUMBER_WAS_USED; 99 → LEASE_NUMBER_NOT_IN_LEASE; reason 'lost' → LEASE_REASON_INVALID
 *   H9  numberOfPrinted: '0043' → 43 · '43' → 43 · 'C1/0043' → null · '' → null · '0' → null · '1e3' → null · '-5' → null · 16 digits → null
 *   H10 pack gate: AE leases · IN and AU do not (LEASE_NOT_FOR_COUNTRY 409) · no country does not
 *   H11 want: absent → 50 · 200 → 200 · 0, -3, 'abc', 1.5, 201, true → LEASE_WANT_INVALID (refused, never clamped) · unknown till → LEASE_TILL_UNKNOWN 404
 *
 * Run: node tests/ctr-213-invoice-lease.test.cjs   (no database: a stand-in that mirrors only the statements lib/invoice-lease sends; the SQL itself is unrun on a real Postgres — see the PR)
 */
'use strict';
const assert = require('assert');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';

const lease = require('../lib/invoice-lease');
const priceNote = require('../lib/price-note');
const dbModule = require('../db');

let pass = 0;
let fail = 0;
const t = async (name, fn) => {
  try {
    await fn();
    pass++;
    console.log('   ok   ' + name);
  } catch (e) {
    fail++;
    console.log('   FAIL ' + name + '\n          ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n          ') : e));
  }
};
const refusedWith = async (code, status, fn) => {
  try {
    await fn();
  } catch (e) {
    assert.strictEqual(e.code, code, 'code ' + e.code + ' ' + e.message);
    assert.strictEqual(e.status, status);
    return;
  }
  assert.fail('expected ' + code);
};

const ISSUER = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-13T09:00:00.000Z');
const LATER = new Date('2026-11-25T09:00:00.000Z'); /* past the seven days */

/** the stand-in: the counter row, the lease table and the shop's till chits (client_ref + till id), answering only the statements lib/invoice-lease and books-store.nextNo send */
function makeShop(options) {
  const shop = { nextNo: (options && options.nextNo) || 1, leases: [], chits: [], counterTouches: 0, nextId: 1 };
  shop.chit = (clientRef, tillId) => shop.chits.push({ client_ref: String(clientRef), till_id: tillId || null });
  const printedNumbers = () => shop.chits.map((chit) => ({ number: /^[0-9]{1,15}$/.test(chit.client_ref) && chit.till_id ? Number(chit.client_ref) : null, till_id: chit.till_id })).filter((row) => row.number != null);
  shop.db = {
    async query(text, params) {
      if (/INSERT INTO books_counter/.test(text)) {
        const size = Number(params[3]);
        shop.counterTouches++;
        shop.nextNo += size;
        return { rows: [{ n: shop.nextNo - size }] };
      }
      if (/INSERT INTO till_invoice_lease/.test(text)) {
        const row = { lease_id: 'L' + shop.nextId++, till_id: params[1], first_no: params[2], last_no: params[3], expires_at: params[4], leased_at: NOW.toISOString(), closed_at: null, unused_json: [] };
        assert.ok(!shop.leases.some((other) => other.first_no === row.first_no), 'unique (entity, first_no)');
        shop.leases.push(row);
        return { rows: [row] };
      }
      if (/FROM till_invoice_lease WHERE entity_id = \$1 AND till_id = \$2 AND closed_at IS NULL/.test(text)) {
        const open = shop.leases.filter((row) => row.till_id === params[1] && !row.closed_at && new Date(row.expires_at) > new Date(params[2]));
        return { rows: open.sort((left, right) => right.first_no - left.first_no).slice(0, 5) };
      }
      if (/count\(\*\) OVER/.test(text)) {
        const rows = shop.leases.filter((row) => !params[1] || row.till_id === params[1]).sort((left, right) => right.first_no - left.first_no);
        return { rows: rows.slice(params[3], params[3] + params[2]).map((row) => Object.assign({}, row, { total: rows.length })) };
      }
      if (/RETURNING|FOR UPDATE/.test(text) && /FROM till_invoice_lease WHERE entity_id = \$1 AND lease_id/.test(text)) return { rows: shop.leases.filter((row) => row.lease_id === params[1]) };
      if (/UPDATE till_invoice_lease/.test(text)) {
        const row = shop.leases.find((other) => other.lease_id === params[1]);
        row.unused_json = JSON.parse(params[2]);
        row.closed_at = row.closed_at || params[3];
        return { rows: [] };
      }
      if (/NOT EXISTS \(SELECT 1 FROM till_invoice_lease/.test(text)) return { rows: printedNumbers().filter((row) => !shop.leases.some((other) => row.number >= other.first_no && row.number <= other.last_no)).sort((left, right) => left.number - right.number) };
      if (/WHERE n BETWEEN/.test(text)) return { rows: printedNumbers().filter((row) => row.number >= params[1] && row.number <= params[2]) };
      throw new Error('unexpected statement: ' + text.slice(0, 80));
    }
  };
  shop.deps = (tills, at) => ({ knownTill: async (till) => (tills || ['A', 'B', 'C1']).includes(till), withEntity: async (_issuer, fn) => fn(shop.db), now: () => at || NOW });
  return shop;
}

(async () => {
  await t('H1 two tills ask at once: A 1..50, B 51..100, counter 101, the further invoice takes 101', async () => {
    const shop = makeShop();
    const [a, b] = await Promise.all([lease.leaseFor(ISSUER, 'AE', { till_id: 'A' }, shop.deps()), lease.leaseFor(ISSUER, 'AE', { till_id: 'B' }, shop.deps())]);
    const ranges = [[a.first_no, a.last_no], [b.first_no, b.last_no]].sort((left, right) => left[0] - right[0]);
    assert.deepStrictEqual(ranges, [[1, 50], [51, 100]]);
    assert.strictEqual(shop.nextNo, 101);
    const books = require('../lib/books-store');
    assert.strictEqual(await books.nextNo(shop.db, ISSUER, lease.SERIES, lease.FISCAL_KEY), 101, 'the further invoice draws from the same counter');
  });

  await t('H2 an expired block is never re-leased; the unprinted tail is unused, not a gap', async () => {
    const shop = makeShop();
    const first = await lease.leaseFor(ISSUER, 'AE', { till_id: 'A' }, shop.deps());
    for (let number = 1; number <= 30; number++) shop.chit(String(number).padStart(4, '0'), 'A');
    const second = await lease.leaseFor(ISSUER, 'AE', { till_id: 'A' }, shop.deps(null, LATER));
    assert.deepStrictEqual([first.first_no, first.last_no, second.first_no, second.last_no], [1, 50, 51, 100]);
    assert.strictEqual(second.reused, false);
    const report = await lease.reportFor(shop.db, ISSUER, { till_id: 'A' }, LATER);
    const expired = report.leases.find((row) => row.first_no === 1);
    assert.strictEqual(expired.state, 'expired');
    assert.strictEqual(expired.recorded.length, 30);
    assert.deepStrictEqual(expired.unused.map((row) => row.no), Array.from({ length: 20 }, (_, i) => 31 + i));
    assert.ok(expired.unused.every((row) => row.reason === 'expired'));
    assert.deepStrictEqual(expired.gaps, []);
  });

  await t('H3 offline inside a block of 3: 7, 8, 9 recorded; a 10th printed anyway is recorded and listed OUTSIDE, never refused', async () => {
    const shop = makeShop({ nextNo: 7 });
    const block = await lease.leaseFor(ISSUER, 'AE', { till_id: 'A', want: 3 }, shop.deps());
    assert.deepStrictEqual([block.first_no, block.last_no], [7, 9]);
    ['7', '8', '9'].forEach((number) => shop.chit(number, 'A'));
    let report = await lease.reportFor(shop.db, ISSUER, {}, NOW);
    assert.deepStrictEqual([report.leases[0].recorded, report.leases[0].gaps, report.leases[0].ahead, report.outside.numbers], [[7, 8, 9], [], null, []]);
    shop.chit('10', 'A');
    report = await lease.reportFor(shop.db, ISSUER, {}, NOW);
    assert.deepStrictEqual(report.outside.numbers, [{ no: 10, till_id: 'A' }]);
  });

  await t('H4 lease 1..5 with 1, 2, 4 printed: gap 3, ahead 5; a reason turns the gap into unused', async () => {
    const shop = makeShop();
    await lease.leaseFor(ISSUER, 'AE', { till_id: 'A', want: 5 }, shop.deps());
    ['1', '2', '4'].forEach((number) => shop.chit(number, 'A'));
    let row = (await lease.reportFor(shop.db, ISSUER, {}, NOW)).leases[0];
    assert.deepStrictEqual([row.recorded, row.gaps, row.ahead, row.unused], [[1, 2, 4], [3], { from: 5, to: 5 }, []]);
    await lease.closeLease(shop.db, ISSUER, { lease_id: row.lease_id, unused: [{ no: 3, reason: 'void' }] }, NOW.toISOString());
    row = (await lease.reportFor(shop.db, ISSUER, {}, NOW)).leases[0];
    assert.deepStrictEqual([row.gaps, row.unused, row.state], [[], [{ no: 3, reason: 'void' }, { no: 5, reason: 'unused' }], 'closed']);
  });

  await t('H5 a till number in no block is OUTSIDE; a number with no till id (a further invoice) is not', async () => {
    const shop = makeShop();
    await lease.leaseFor(ISSUER, 'AE', { till_id: 'A', want: 5 }, shop.deps());
    shop.chit('77', 'A');
    shop.chit('6', null);
    shop.chit('C1/0003', 'C1');
    const report = await lease.reportFor(shop.db, ISSUER, {}, NOW);
    assert.deepStrictEqual(report.outside, { numbers: [{ no: 77, till_id: 'A' }], more: false });
  });

  await t('H6 refill at 20 percent: 11 left → same block; 10 left → a new block; two open → no third', async () => {
    const shop = makeShop();
    const held = await lease.leaseFor(ISSUER, 'AE', { till_id: 'A' }, shop.deps());
    const same = await lease.leaseFor(ISSUER, 'AE', { till_id: 'A', remaining: 11 }, shop.deps());
    assert.deepStrictEqual([same.lease_id, same.reused, shop.nextNo], [held.lease_id, true, 51]);
    const next = await lease.leaseFor(ISSUER, 'AE', { till_id: 'A', remaining: 10 }, shop.deps());
    assert.deepStrictEqual([next.first_no, next.last_no, next.reused], [51, 100, false]);
    const again = await lease.leaseFor(ISSUER, 'AE', { till_id: 'A', remaining: 0 }, shop.deps());
    assert.deepStrictEqual([again.lease_id, again.reused, shop.nextNo], [next.lease_id, true, 101]);
    const noWord = await lease.leaseFor(ISSUER, 'AE', { till_id: 'B' }, shop.deps());
    assert.strictEqual(noWord.first_no, 101, 'another till is not held back by the first');
  });

  await t('H7 the lease runs under the lock a further invoice takes: note-series|invoice|<issuer>', async () => {
    const queries = [];
    const client = { query: async (text, params) => { queries.push([text.slice(0, 40), params && params[0]]); return { rows: [] }; }, release: () => {} };
    const original = Object.getOwnPropertyDescriptor(dbModule, 'pool');
    Object.defineProperty(dbModule, 'pool', { configurable: true, get: () => ({ connect: async () => client }) });
    try {
      const shop = makeShop();
      await lease.leaseFor(ISSUER, 'AE', { till_id: 'A' }, shop.deps());
    } finally {
      Object.defineProperty(dbModule, 'pool', original);
    }
    const key = 'note-series|invoice|' + ISSUER;
    assert.deepStrictEqual(queries.filter((row) => row[1] === key).map((row) => row[0].slice(0, 28)), ['SELECT pg_advisory_lock(hash', 'SELECT pg_advisory_unlock(ha']);
    assert.strictEqual(priceNote.underSeriesLock.length, 3, 'the same function a further invoice uses');
  });

  await t('H8 closing: reasons kept, a recorded number cannot be called unused, a number outside or a bad reason is refused', async () => {
    const shop = makeShop();
    const block = await lease.leaseFor(ISSUER, 'AE', { till_id: 'A' }, shop.deps());
    for (let number = 1; number <= 30; number++) shop.chit(number, 'A');
    const closed = await lease.closeLease(shop.db, ISSUER, { lease_id: block.lease_id, unused: [{ no: 31, reason: 'void' }] }, NOW.toISOString());
    assert.deepStrictEqual(closed.unused, [{ no: 31, reason: 'void' }]);
    const row = (await lease.reportFor(shop.db, ISSUER, {}, NOW)).leases[0];
    assert.deepStrictEqual([row.state, row.gaps, row.unused.length, row.unused[0], row.unused[1].reason], ['closed', [], 20, { no: 31, reason: 'void' }, 'unused']);
    await refusedWith('LEASE_NUMBER_WAS_USED', 409, () => lease.closeLease(shop.db, ISSUER, { lease_id: block.lease_id, unused: [{ no: 7, reason: 'void' }] }, NOW.toISOString()));
    await refusedWith('LEASE_NUMBER_NOT_IN_LEASE', 409, () => lease.closeLease(shop.db, ISSUER, { lease_id: block.lease_id, unused: [{ no: 99, reason: 'void' }] }, NOW.toISOString()));
    await refusedWith('LEASE_REASON_INVALID', 400, () => lease.closeLease(shop.db, ISSUER, { lease_id: block.lease_id, unused: [{ no: 40, reason: 'lost' }] }, NOW.toISOString()));
    await refusedWith('LEASE_NOT_FOUND', 404, () => lease.closeLease(shop.db, ISSUER, { lease_id: 'nope', unused: [] }, NOW.toISOString()));
    const twice = await lease.closeLease(shop.db, ISSUER, { lease_id: block.lease_id, unused: [{ no: 31, reason: 'void' }] }, NOW.toISOString());
    assert.deepStrictEqual(twice.unused, [{ no: 31, reason: 'void' }], 'saying it twice changes nothing');
  });

  await t('H9 a printed number maps to its leased integer in ONE function', () => {
    const cases = [['0043', 43], ['43', 43], ['C1/0043', null], ['', null], ['0', null], ['1e3', null], ['-5', null], ['1234567890123456', null], [null, null], ['000001', 1]];
    cases.forEach(([text, want]) => assert.strictEqual(lease.numberOfPrinted(text), want, String(text)));
  });

  await t('H10 only a pack whose further document is an invoice (AE) leases; IN, AU and no country are refused 409', async () => {
    const shop = makeShop();
    assert.ok(lease.leasesFor('AE'));
    for (const country of ['IN', 'AU', null, 'ZZ']) {
      assert.strictEqual(lease.leasesFor(country), false, String(country));
      await refusedWith('LEASE_NOT_FOR_COUNTRY', 409, () => lease.leaseFor(ISSUER, country, { till_id: 'A' }, shop.deps()));
    }
    assert.strictEqual(shop.counterTouches, 0, 'a refused country takes no number');
  });

  await t('H11 want is whole and 1..200, never clamped; an unknown till takes no number', async () => {
    assert.deepStrictEqual([lease.sizeOf(undefined).size, lease.sizeOf(200).size, lease.sizeOf('7').size], [50, 200, 7]);
    for (const bad of [0, -3, 'abc', 1.5, 201, true, 5000]) assert.ok(lease.sizeOf(bad).refused, 'want ' + bad);
    const shop = makeShop();
    await refusedWith('LEASE_WANT_INVALID', 400, () => lease.leaseFor(ISSUER, 'AE', { till_id: 'A', want: 0 }, shop.deps()));
    await refusedWith('LEASE_TILL_UNKNOWN', 404, () => lease.leaseFor(ISSUER, 'AE', { till_id: 'ZZ' }, shop.deps()));
    assert.strictEqual(shop.counterTouches, 0);
  });

  await t('H12 the report is a page: total, page, limit, with a server max', async () => {
    const shop = makeShop();
    for (let index = 0; index < 3; index++) await lease.leaseFor(ISSUER, 'AE', { till_id: 'A', want: 1 }, shop.deps(null, new Date(NOW.getTime() + index * 8 * 86400000)));
    const page = await lease.reportFor(shop.db, ISSUER, { limit: 2, page: 1 }, NOW);
    assert.deepStrictEqual([page.total, page.leases.length, page.page, page.limit], [3, 2, 1, 2]);
    assert.strictEqual((await lease.reportFor(shop.db, ISSUER, { limit: 100000 }, NOW)).limit, 100);
  });

  await t('H13 ONE counter row: the lease draws series invoice, fiscal key "-" — the same pair the further invoice reads in lib/price-note', async () => {
    const shop = makeShop();
    const seen = [];
    const inner = shop.db.query;
    shop.db.query = async (text, params) => { if (/INSERT INTO books_counter/.test(text)) seen.push([params[1], params[2]]); return inner(text, params); };
    await lease.leaseFor(ISSUER, 'AE', { till_id: 'A' }, shop.deps());
    assert.deepStrictEqual(seen, [['invoice', '-']]);
    const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'price-note.js'), 'utf8');
    assert.ok(source.includes("const INVOICE_SERIES = 'invoice'") && source.includes("INVOICE_SERIES, '-'"), 'price-note still reads the same row');
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
