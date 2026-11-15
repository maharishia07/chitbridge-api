/**
 * con-98-connector-bill-total.test.cjs — CON-98 (ACC-206): the Tally connector books a bill at the ONE pick of its total
 * (lib/counter-bill.pickOf, carried into the kit as a byte copy), never at a raw summary_json.total_value or a sum of lines.
 * A chit with no total is refused out loud (receipt 'failed' + write-back + log line), never booked at a guess.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const core = require('../tools/tally-connector/core.js');

let pass = 0;
const norm = (text) => text.replace(/\r\n/g, '\n');
async function check(what, body) { try { await body(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } }

const line = { name: 'Rice', quantity: 2, price: 50, total: 100 };
/* the engine's figure (invoice 118) differs from the legacy header total (999) and from the line sum (100): only the pick may win */
const chitWith = (summary, business) => ({ header: { chit_id: 'aaaaaaaa-1111', purpose: 'order', current_status: 'accepted', summary_json: summary, business_json: business || {} }, detail: { line_items: [line] } });
const stamped = chitWith({ total_value: 999, money: { total: 118 } }, { invoice: { ValDtls: { TotInvVal: 118 } } });
const bare = chitWith({}, {});

function world(chit, payment) {
  const rows = []; const told = []; const logs = []; const pushed = [];
  const stored = payment ? chitWith({}, { payment }) : chit; if (payment) { stored.header.summary_json = chit.header.summary_json; stored.header.business_json = Object.assign({}, chit.header.business_json, { payment }); }
  const cb = { policy: { books_at: 'received' }, owns: () => true, chit: async () => stored, invoice: async () => ({}), call: async (method, url, body) => { told.push(body); return {}; }, log: () => {} };
  const receipts = { last: () => null, add: (row) => rows.push(row) };
  const adapter = { name: 'fake', pushOrder: async (order) => { pushed.push(order); return { ref: 'V1' }; }, pushReceipt: async (p) => { pushed.push(p); return { ref: 'R1' }; } };
  return { cb, receipts, adapter, rows, told, logs, pushed, log: (line) => logs.push(line) };
}

(async () => {
  await check('orderOf reads the engine total (118), not total_value (999) nor the line sum', async () => {
    assert.strictEqual(core.orderOf(stamped).total, 118);
  });
  await check('a chit with no total gets total null and a named reason, never the line sum', async () => {
    const order = core.orderOf(bare);
    assert.strictEqual(order.total, null);
    assert.ok(/no bill total/.test(order.total_why), order.total_why);
  });
  await check('an oversight-withheld chit is refused with the cost-view reason', async () => {
    const order = core.orderOf(chitWith({ oversight: true, total_value: 50 }, {}));
    assert.strictEqual(order.total, null);
    assert.ok(/withheld/.test(order.total_why));
  });
  await check('pushOrder exports a stamped voucher at 118', async () => {
    const w = world(stamped);
    const out = await core.pushOrder({ cb: w.cb, adapter: w.adapter, receipts: w.receipts, log: w.log, chit_id: 'aaaaaaaa-1111' });
    assert.strictEqual(out.outcome, 'ok', JSON.stringify(out));
    assert.strictEqual(w.pushed[0].total, 118);
  });
  await check('pushOrder refuses a chit with no total in words: nothing pushed, a failed receipt, a write-back, a log line', async () => {
    const w = world(bare);
    const out = await core.pushOrder({ cb: w.cb, adapter: w.adapter, receipts: w.receipts, log: w.log, chit_id: 'aaaaaaaa-1111' });
    assert.strictEqual(out.outcome, 'failed');
    assert.ok(/^refused: the chit carries no bill total/.test(out.why), out.why);
    assert.strictEqual(w.pushed.length, 0, 'a voucher was exported without a total');
    assert.strictEqual(w.rows[0].outcome, 'failed');
    assert.ok(w.told.some((body) => body && /refused/.test(body.why)), 'the books were not told why');
    assert.ok(w.logs.some((text) => /refused/.test(text)), 'nothing was said');
  });
  await check('pushReceipt with no payment amount and no total is refused, with an amount it goes', async () => {
    const refused = world(bare, { at: 'now', method: 'cash' });
    const out = await core.pushReceipt({ cb: refused.cb, adapter: refused.adapter, receipts: refused.receipts, log: refused.log, chit_id: 'aaaaaaaa-1111' });
    assert.strictEqual(out.outcome, 'failed'); assert.strictEqual(refused.pushed.length, 0);
    const paid = world(bare, { at: 'now', method: 'cash', amount: 40 });
    const ok = await core.pushReceipt({ cb: paid.cb, adapter: paid.adapter, receipts: paid.receipts, log: paid.log, chit_id: 'aaaaaaaa-1111' });
    assert.strictEqual(ok.outcome, 'ok'); assert.strictEqual(paid.pushed[0].amount, 40);
  });
  await check('the kit copy of the pick is byte-identical to lib/counter-bill.js and the kit ships it', async () => {
    const kit = path.join(__dirname, '..', 'tools', 'tally-connector');
    assert.strictEqual(norm(fs.readFileSync(path.join(kit, 'counter-bill.js'), 'utf8')), norm(fs.readFileSync(path.join(__dirname, '..', 'lib', 'counter-bill.js'), 'utf8')), 'drifted: run scripts/vendor-till.cjs');
    assert.ok(/'counter-bill\.js'/.test(fs.readFileSync(path.join(__dirname, '..', 'routes', 'integrations.js'), 'utf8')), 'KIT_NAMES lacks counter-bill.js');
    assert.ok(/live: \[[^\]]*'counter-bill\.js'/.test(fs.readFileSync(path.join(kit, 'till.js'), 'utf8')), 'the kit update does not refresh counter-bill.js');
  });
  await check('MUTANT: core.js has no raw total_value fallback (a source scan; the fallback turns this red)', async () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'core.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
    assert.ok(!/summary_json\.total_value/.test(code), 'core.js reads summary_json.total_value again');
  });
  console.log(pass + ' checks');
})();
