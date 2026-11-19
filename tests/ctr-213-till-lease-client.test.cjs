/**
 * ctr-213-till-lease-client.test.cjs — CTR-213 (ACC-192 S2), THE TILL HALF: an AE counter prints its invoice numbers from a block the server leased.
 *
 * The till's lease client is cut out of tools/tally-connector/till.html (the master; web's public/till.html is a byte copy) and run here in a vm with a
 * fake server that does what lib/invoice-lease does: ONE counter, blocks that never overlap, a further invoice drawing one number from the same counter.
 * Every expectation is HAND-COMPUTED (input -> expected), not read back from the code.
 *
 * Hand figures (block 50, refill at 20 percent left = 10 numbers):
 *   two tills ask at the same counter start 1:  A 1-50, B 51-100, the counter then stands at 101.
 *   A prints 41 numbers (1-41): 9 are left, 9 <= 10, so A asks again and gets 101-150 (the counter was at 101); the counter then stands at 151.
 *   one further invoice (the server's own, as lib/price-note draws) takes 151.
 *   Every number printed by A (1-50, then 101..), B (51..) and the further invoice (151) is DIFFERENT; nothing printed is missing from its block.
 *   offline with 7-9 held: prints 0007, 0008, 0009; the 4th is refused in words and NO number is invented.
 * Run: node tests/ctr-213-till-lease-client.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8');
const from = SRC.indexOf('var LEASE_KEY =');
const upTo = SRC.indexOf('async function nextNumber(');
assert.ok(from > 0 && upTo > from, 'the lease client is not on the page');
const CLIENT = SRC.slice(from, upTo);
const NEXT = SRC.slice(upTo, SRC.indexOf('\n}\n', upTo) + 3);

let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); } };

/** the ONE server counter: blocks and further invoices draw from it, atomically (lib/books-store nextNo) */
function server() {
  const s = { counter: 1, leases: [], calls: [] };
  s.lease = async (body) => {
    s.calls.push(body);
    if (s.country) return { ok: false, code: s.country };
    const open = s.leases.filter((l) => l.till_id === body.till_id && !l.closed);
    const last = open[open.length - 1];
    if (last && body.remaining != null && body.remaining > (last.last_no - last.first_no + 1) * 0.2) return Object.assign({ ok: true, reused: true }, last);
    const size = body.want || 50, first = s.counter; s.counter += size;
    const row = { lease_id: 'L' + (s.leases.length + 1), till_id: body.till_id, first_no: first, last_no: first + size - 1, expires_at: '2099-01-01T00:00:00Z' };
    s.leases.push(row);
    return Object.assign({ ok: true, reused: false }, row);
  };
  s.leaseClose = async (b) => { const l = s.leases.find((x) => x.lease_id === b.lease_id); if (l) l.closed = true; return { ok: true }; };
  s.further = () => s.counter++;
  return s;
}
/** one counter (till) with its own device store, on a given server */
function till(srv, id, opts) {
  const o = opts || {};
  const boxes = o.boxes || {};
  let turn = Promise.resolve();
  const ctx = {
    console, JSON, Object, Math, Date, String, Number, Array, Promise, Error, setTimeout,
    DB: { get: async (k) => (boxes[k] === undefined ? undefined : JSON.parse(JSON.stringify(boxes[k]))), set: async (k, v) => { boxes[k] = JSON.parse(JSON.stringify(v)); } },
    docCountry: () => o.country || 'AE', tillId: () => id, cbQuiet() {}, throwIfFrozen() {},
    DOC_TAGS: { GRN: 'receipt', DC: 'despatch', CN: 'credit', EXP: 'expense', SUB: 'subscription', R: 'payment' },
    underSeriesLock: (task) => { const run = turn.then(task); turn = run.catch(() => {}); return run; },
    takeNumber: async () => 'OLD/' + (ctx.oldNo = (ctx.oldNo || 0) + 1)
  };
  ctx.CloudHost = { lease: async (b) => (o.offline ? { ok: false, why: 'this needs the internet' } : srv.lease(b)), leaseClose: async (b) => srv.leaseClose(b) };
  ctx.HOST = ctx.CloudHost;
  vm.createContext(ctx);
  vm.runInContext(CLIENT + '\n' + NEXT + '\nthis.nextNumber = nextNumber; this.leaseRefill = leaseRefill;', ctx);
  ctx.boxes = boxes;
  ctx.settle = () => new Promise((r) => setTimeout(r, 20));
  return ctx;
}

(async () => {
  console.log('— CTR-213 · the till half —');

  await t('two tills at counter 1: A 1-50, B 51-100; the counter stands at 101; a further invoice takes 101', async () => {
    const srv = server(), A = till(srv, 'C1'), B = till(srv, 'C2');
    await A.leaseRefill(true); await B.leaseRefill(true);
    assert.deepStrictEqual([srv.leases[0].first_no, srv.leases[0].last_no, srv.leases[1].first_no, srv.leases[1].last_no, srv.counter], [1, 50, 51, 100, 101]);
    assert.strictEqual(await A.nextNumber(), '0001');
    assert.strictEqual(await B.nextNumber(), '0051');
    assert.strictEqual(await A.nextNumber(), '0002');
    assert.strictEqual(srv.further(), 101);
  });

  await t('A prints 41 numbers: 9 left (<= 20 percent) so A asks again and gets 101-150; the further invoice then takes 151; every number is different', async () => {
    const srv = server(), A = till(srv, 'C1'), B = till(srv, 'C2');
    await A.leaseRefill(true); await B.leaseRefill(true);
    const printed = [];
    for (let i = 0; i < 41; i++) printed.push(await A.nextNumber());
    await A.settle();
    assert.strictEqual(printed[40], '0041');
    assert.strictEqual(srv.leases.length, 3, 'a third block was asked for at 9 left');
    assert.deepStrictEqual([srv.leases[2].first_no, srv.leases[2].last_no, srv.counter], [101, 150, 151]);
    for (let i = 0; i < 12; i++) printed.push(await A.nextNumber());      /* 42..50 then 101, 102, 103 */
    printed.push(await B.nextNumber());
    printed.push(String(srv.further()).padStart(4, '0'));
    assert.deepStrictEqual(printed.slice(41, 53), ['0042', '0043', '0044', '0045', '0046', '0047', '0048', '0049', '0050', '0101', '0102', '0103']);
    assert.strictEqual(printed[53], '0051');
    assert.strictEqual(printed[54], '0151');
    assert.strictEqual(new Set(printed).size, printed.length, 'a number was handed out twice');
  });

  await t('a block used up is told to the server (closed, nothing unused)', async () => {
    const srv = server(), A = till(srv, 'C1');
    await A.leaseRefill(true);
    for (let i = 0; i < 50; i++) await A.nextNumber();
    await A.settle();
    assert.strictEqual(srv.leases[0].closed, true);
  });

  await t('offline with 7-9 held: 0007, 0008, 0009, then the 4th is REFUSED in words and no number is invented', async () => {
    const srv = server();
    const A = till(srv, 'C1', { offline: true, boxes: { 'invoice-lease': { till: 'C1', leased: true, used: 6, blocks: [{ lease_id: 'L1', first_no: 1, last_no: 9, expires_at: '2099-01-01T00:00:00Z' }] } } });
    assert.deepStrictEqual([await A.nextNumber(), await A.nextNumber(), await A.nextNumber()], ['0007', '0008', '0009']);
    await assert.rejects(() => A.nextNumber(), /used all its invoice numbers/);
    assert.strictEqual(A.oldNo, undefined, 'the old prefixed series was NOT used as a fallback');
  });

  await t('the pointer is saved before the number is handed out: a restarted counter does not print it again', async () => {
    const srv = server(), A = till(srv, 'C1');
    await A.leaseRefill(true);
    assert.strictEqual(await A.nextNumber(), '0001');
    const restarted = till(srv, 'C1', { boxes: A.boxes, offline: true });
    assert.strictEqual(await restarted.nextNumber(), '0002');
  });

  await t('an expired block is never printed from', async () => {
    const srv = server();
    const A = till(srv, 'C1', { offline: true, boxes: { 'invoice-lease': { till: 'C1', leased: true, used: 0, blocks: [{ lease_id: 'L1', first_no: 1, last_no: 50, expires_at: '2020-01-01T00:00:00Z' }] } } });
    await assert.rejects(() => A.nextNumber(), /used all its invoice numbers/);
  });

  await t('a shop whose server says LEASE_NOT_FOR_COUNTRY (or has no table yet) numbers as before; so do other countries; so does a credit note', async () => {
    const srv = server(); srv.country = 'LEASE_NOT_FOR_COUNTRY';
    const A = till(srv, 'C1');
    assert.strictEqual(await A.nextNumber(), 'OLD/1');
    assert.strictEqual(await A.nextNumber(), 'OLD/2');
    const IN = till(server(), 'C1', { country: 'IN' });
    assert.strictEqual(await IN.nextNumber(), 'OLD/1');
    const AE = till(server(), 'C1'); await AE.leaseRefill(true);
    assert.strictEqual(await AE.nextNumber('CN'), 'OLD/1', 'a credit note keeps its own series');
  });

  await t('the Ask for a block is made with the counter id and the numbers left (the server decides)', async () => {
    const srv = server(), A = till(srv, 'C1');
    await A.leaseRefill(true);
    assert.deepStrictEqual(srv.calls[0], { till_id: 'C1', want: 50, remaining: 0 });
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
