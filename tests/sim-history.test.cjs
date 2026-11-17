#!/usr/bin/env node
/**
 * tests/sim-history.test.cjs — tools/sim-history.cjs as units: the demo entry builders, the month readings, and a recorded run of the day loop over stand-in doors (what posts, what is refused, what is reversed, which months close).
 * OWNS      the unit-per-rule, refusal-path and fail-closed proof of creditSale, purchaseBill, soldByMonth, soldMismatches and load (every refusal is counted and said in a RED line, never dropped).
 * CALLED BY scripts/guards.cjs · by hand: node tests/sim-history.test.cjs
 * FLOW      builders ──▶ month readings ──▶ load over a recording books / api / clock (the posting engine stood in by a temp lib/books-engines.js) ──▶ "<n> checks"
 * CARD      qa/sim-load
 * No database, no network.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require(path.join(__dirname, '..', 'tools', 'sim-history.cjs'));

let passed = 0,
  failed = 0;
const ok = (label, condition) => {
  if (condition) passed++;
  else {
    failed++;
    console.log('   FAIL ' + label);
  }
};
const dayAdd = (day, days) => new Date(Date.parse(day) + days * 86400000).toISOString().slice(0, 10);
const taxRow = (rate, taxable) => ({ rate, taxable });
const base = { CUST: 'cust-1', SUPPS: ['sup-0', 'sup-1'], CURRENCY: 'AUD', taxRow, dayAdd, HIST: { gst_rate: 10, rent: { paid_from: 'bank' } } };

/* the builders: marked demo:, on the right party, due on the right day, the pack's money */
const sale = H.creditSale(base, { day: '2026-09-10', kind: 'incl', ref: 'DEMO-INC-', taxable: 100, narration: 'n' });
ok('a credit sale is a sale_bill on the credit customer', sale.type === 'sale_bill' && sale.party === 'cust-1' && sale.currency === 'AUD');
ok('a credit sale is demo-marked by kind and day', sale.source_ref === 'demo:incl:2026-09-10' && H.markOf('incl', '2026-09-10') === sale.source_ref);
ok('a credit sale falls due in 14 days and carries the pack rate on its taxable', sale.due_date === '2026-09-24' && sale.by_rate[0].rate === 10 && sale.by_rate[0].taxable === 100);
ok('a credit sale ref carries its month, so two months never share a ref', sale.ref === 'DEMO-INC-2026-09');
const bill = H.purchaseBill(base, { s: 1, taxable: 200 }, '2026-09-04');
ok('a purchase bill is on the named supplier, on credit, due in 30 days', bill.type === 'purchase_bill' && bill.party === 'sup-1' && bill.due_date === '2026-10-04' && Object.keys(bill.paid).length === 0);
ok('a purchase bill narrates its gross: taxable plus the rate', /220/.test(bill.narration) && bill.source_ref === 'demo:buy1:2026-09-04');

/* the month readings */
const moneyOps = { addMinor: (total, minor) => total + (minor === null ? 0 : minor) };
const sold = H.soldByMonth([{ day: '2026-09-01', sold: { minor: 100 } }, { day: '2026-09-02', sold: { minor: 50 } }, { day: '2026-10-01', sold: { minor: 7 } }], 'AUD', moneyOps);
ok('SOLD adds a month\'s days and keeps months apart', sold['2026-09'] === 150 && sold['2026-10'] === 7);
ok('a day of two currencies (minor null) adds nothing, never NaN', H.soldByMonth([{ day: '2026-09-01', sold: { minor: null } }], 'AUD', moneyOps)['2026-09'] === 0);
const wrong = H.soldMismatches({ '2026-09': 150, '2026-10': 8 }, { '2026-09': { sold: 150 }, '2026-10': { sold: 7 }, '2026-11': { sold: 3 } });
ok('a month whose SOLD differs, and a month with no SOLD at all, are both named', wrong.months.join() === '2026-10,2026-11');
ok('a mismatch is said as got / want', /2026-10 got 8 want 7/.test(wrong.text) && /2026-11 got 0 want 3/.test(wrong.text));
ok('equal months give no mismatch', H.soldMismatches({ a: 1 }, { a: { sold: 1 } }).months.length === 0);

/* a recorded run of the day loop: the posting engine is stood in by a temp API tree */
const API = fs.mkdtempSync(path.join(os.tmpdir(), 'simhist-'));
fs.mkdirSync(path.join(API, 'lib'));
fs.writeFileSync(path.join(API, 'lib', 'books-engines.js'), "module.exports = { posting: () => ({ daySummary: (bills, meta) => ({ type: 'walkin_day', ref: meta.ref, date: meta.date }) }) };\n");
const rig = (refuseKinds) => {
  const log = { posted: [], reversed: [], api: [], closed: [], clock: [], drained: 0 };
  const x = Object.assign({}, base, {
    API, path, PACK: {}, TILL: 'C1', shopId: 'shop-1', token: 't', months: 4, AT: (day) => day + 'T12:00:00', dayAdd, drain: async () => { log.drained++; },
    CLOCK: { set: (at) => log.clock.push(at) },
    closeMonth: async (last) => { log.closed.push(last); },
    books: {
      postEntry: async (db, shop, event) => { log.posted.push(event.source_ref || event.type); return refuseKinds.some((kind) => (event.source_ref || '').includes(kind)) ? { ok: false, why: 'locked' } : { ok: true, entry_id: 'E' + log.posted.length }; },
      reverseEntry: async (db, shop, id) => { log.reversed.push(id); return { ok: true }; }
    },
    callApi: async (url, opt) => { log.api.push({ url, key: opt.headers && opt.headers['Idempotency-Key'] }); return { status: 200, b: {} }; },
    PLAN: {
      start: '2026-09-01',
      days: [
        { day: '2026-09-01', walkin: 100 },
        { day: '2026-09-05', walkin: 100, rent: 500, buys: [{ s: 0, taxable: 50 }], pays: [{ s: 0, cents: 100 }] },
        { day: '2026-09-10', walkin: 100, inclusive: { taxable: 90, total: 99 }, receipt: 300 },
        { day: '2026-09-20', walkin: 100, reversed: { taxable: 40 } },
        { day: '2026-10-01', walkin: 100 }
      ]
    }
  });
  return { x, log };
};
const quiet = console.log;
const silent = async (run) => { const lines = []; console.log = (text) => lines.push(String(text)); try { return { result: await run(), lines }; } finally { console.log = quiet; } };

(async () => {
  const good = rig([]);
  const { result, lines } = await silent(() => H.load(good.x));
  ok('every planned day sets the shop clock to that day', good.log.clock.length === 5 && good.log.clock[0] === '2026-09-01T12:00:00');
  ok('a full run posts walk-ins, the bill, the inclusive sale, the sale to reverse and nothing refused', result.refused === 0 && good.log.posted.filter((ref) => /walkin/.test(ref)).length === 5 && good.log.posted.some((ref) => ref === 'demo:buy0:2026-09-05') && good.log.posted.some((ref) => ref === 'demo:incl:2026-09-10'));
  ok('the sale entered in error is reversed once, by its own entry id', good.log.reversed.length === 1 && /^E/.test(good.log.reversed[0]));
  ok('rent goes through the events door once; payments through the payments door with an Idempotency-Key each', good.log.api.filter((call) => call.url === '/api/books/events').length === 1 && good.log.api.filter((call) => call.url === '/api/books/payments').every((call) => /^demo:pay-/.test(call.key)) && good.log.api.filter((call) => call.url === '/api/books/payments').length === 2);
  ok('the count is every posting, payment, reversal and rent', result.rent === 1 && result.entries === good.log.posted.length + 2 + 1 + 1);
  ok('the month before the last two closes on its last day; the last two stay open', good.log.closed.join() === '2026-09-30');
  ok('the hooks are drained once at the end', good.log.drained === 1);

  /* refusal path: a refused posting is counted and said, and the run carries on */
  const bad = rig(['buy0', 'rev']);
  const refusedRun = await silent(() => H.load(bad.x));
  ok('refused postings are counted, not dropped', refusedRun.result.refused === 2);
  ok('each refusal is said in a RED line with what and why', refusedRun.lines.filter((text) => /RED/.test(text)).length === 2 && refusedRun.lines.some((text) => /purchase bill 0 2026-09-05 refused/.test(text) && /locked/.test(text)));
  ok('a sale that was refused is not reversed (nothing to reverse)', bad.log.reversed.length === 0);
  ok('the run still reaches the end: later days post and the hooks drain', bad.log.posted.some((ref) => /walkin:2026-10-01/.test(ref)) && bad.log.drained === 1);

  /* fail closed: the payments door answering 409 is a counted refusal */
  const refusedPay = rig([]);
  refusedPay.x.callApi = async (url) => ({ status: url === '/api/books/payments' ? 409 : 200, b: { code: 'X' } });
  const payRun = await silent(() => H.load(refusedPay.x));
  ok('a payment the door refuses is counted and said', payRun.result.refused === 2 && payRun.lines.some((text) => /payment customer receipt 2026-09-10 refused — HTTP 409/.test(text)));

  fs.rmSync(API, { recursive: true, force: true });
  console.log('\n  ' + (passed + failed) + ' checks' + (failed ? ', ' + failed + ' failed' : ', all ok'));
  process.exit(failed ? 1 : 0);
})();
