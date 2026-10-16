/**
 * tests/ord-fix.test.cjs — ORD-FIX (16 Oct 2026): the Claude review's O1–O7 (orders: order to cash), offline.
 *   O1  the till queues delivery from the SAVED BILL's lines; an order with quantity left stays open after a partial bill
 *   O2  cancelled / rejected orders are never listed (the read itself leaves them out)
 *   O3  billing reads the AMENDED lines (chit_line): new quantity, new price, removed lines gone
 *   O4  a supplier bill accepted, then rejected / cancelled → its posted entry is reversed (once)
 *   O5  the table is "settled" only when finish() saved the bill (page side; the hub's own state rules are an engines change)
 *   O6  a status write is compare-and-set: the loser of a race is refused, not silently overwritten
 *   O7  a shopper code is spent once: the second confirm finds no live code
 * Run: node tests/ord-fix.test.cjs · no DB, no network.
 */
'use strict';
const fs = require('fs'), path = require('path');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };
const src = (f) => fs.readFileSync(path.join(API, f), 'utf8');
const one = (s) => String(s).replace(/\s+/g, ' ').trim();

(async () => {
  console.log('\n— O6 · a status write is compare-and-set —');
  const railStatus = require(path.join(API, 'lib', 'rail-status'));
  const sent = [];
  const mkDb = (updateRows) => ({ query: async (sql, p) => { sent.push({ sql: one(sql), p });
    if (/^SELECT current_status/.test(one(sql))) return { rows: [{ current_status: 'accepted' }], rowCount: 1 };
    return { rows: updateRows, rowCount: updateRows.length }; } });
  let g = await railStatus.statusGate(mkDb([{ chit_id: 'c' }]), 'e', 'c', 'rejected', { level: 'editor' });
  t('the winner writes (accepted → rejected)', g.ok && (await g.write()) === true);
  const upd = sent.filter((s) => /^UPDATE chit_status/.test(s.sql)).pop();
  t('the UPDATE names the status it read (AND current_status = …)', !!upd && /current_status = \$4/.test(upd.sql) && upd.p[3] === 'accepted', JSON.stringify(upd));
  g = await railStatus.statusGate(mkDb([]), 'e', 'c', 'rejected', { level: 'editor' });
  let err = null; try { await g.write(); } catch (e) { err = e; }
  t('the loser (no row changed) is refused with a 409 status_conflict', !!err && err.status === 409 && err.code === 'status_conflict', String(err));

  console.log('\n— O2 · cancelled / rejected orders are never listed —');
  const select = require(path.join(API, 'lib', 'select'));
  const asked = [];
  const realRows = select.rows; select.rows = async (e, sel) => { asked.push(sel); return []; };
  const openOrders = require(path.join(API, 'lib', 'open-orders'));
  await openOrders.tasks('e1', 'despatch', 50);
  select.rows = realRows;
  t('open-orders asks select to leave the closed states out', asked.length > 0 && Array.isArray(asked[0].status_not) && ['rejected', 'cancelled'].every((s) => asked[0].status_not.includes(s)), JSON.stringify(asked[0]));
  t('select.js turns status_not into one SQL clause', /sel\.status_not[\s\S]{0,200}cs\.current_status <> ALL/.test(src('lib/select.js')));

  console.log('\n— O3 · billing reads the amended lines —');
  const live = openOrders.liveLines;
  t('liveLines is exported', typeof live === 'function');
  if (typeof live === 'function') {
    const dl = require(path.join(API, 'lib', 'deliverline'));
    const CH = '11111111-1111-4111-8111-111111111111';
    const frozen = [{ particulars: 'Rice', quantity: 10, price: 40 }, { particulars: 'Dal', quantity: 2, price: 90 }];
    const id1 = dl.lineIdOf(CH, frozen[0], 1), id2 = dl.lineIdOf(CH, frozen[1], 2);
    const prog = (a, b) => new Map([[id1, a], [id2, b]]);
    const out = live(CH, frozen, prog({ ordered: 8, price: 40, removed: false }, { ordered: 2, price: 90, removed: true }));
    t('quantity 10 amended to 8 reads 8, the removed Dal is gone', out.length === 1 && Number(out[0].quantity) === 8 && out[0].particulars === 'Rice', JSON.stringify(out));
    t('a repriced line reads the new price', live(CH, frozen, prog({ ordered: 10, price: 35 }, { ordered: 2, price: 90 }))[0].price === 35);
    t('a line left in place keeps its id when one above is removed', live(CH, [frozen[0], frozen[1]], new Map([[id1, { ordered: 10, removed: true }]]))[0].line_id === id2);
    t('no progress (chit_line not migrated) → the frozen lines, unchanged', live(CH, frozen, null) === frozen);
  }
  t('work-rows measures against the same live lines', /liveLines/.test(src('lib/work-rows.js')));
  t('billed-with-movement stays open while quantity is left (O1 server half)', /billed\.has\(String\(h\.chit_id\)\) && lines\.every\(\(l\) => !\(l\.moved > 0\)\)/.test(src('lib/open-orders.js')));

  console.log('\n— O4 · accepted, then rejected: the purchase is reversed —');
  const store = require(path.join(API, 'lib', 'books-store')), asked4 = [];
  const dbm = require(path.join(API, 'db'));
  dbm.withEntity = async (id, fn) => fn({ query: async (sql, p) => { asked4.push({ sql: one(sql), p }); return { rows: [{ entry_id: 'E1' }, { entry_id: 'E2' }], rowCount: 2 }; } });
  const hooks = require(path.join(API, 'lib', 'books-hooks'));
  t('books-hooks exports reverseIfPosted', typeof hooks.reverseIfPosted === 'function');
  t('postChit calls it on the refused branch', /reverseIfPosted\(entity, chit_id/.test(src('lib/books-hooks.js')));
  if (typeof hooks.reverseIfPosted === 'function') {
    const books = require(path.join(API, 'lib', 'books')), calls = [];
    books.reverseEntry = async (db, entity, entry_id, o) => { calls.push({ entry_id, reason: o.reason }); return { ok: true }; };
    const n = await hooks.reverseIfPosted('shop1', 'chit9', 'Rejected — not posted', 'u1');
    t('every posted, not-yet-reversed entry of the bill is reversed, once each, with the reason', n === 2 && calls.map((c) => c.entry_id).join() === 'E1,E2' && /Rejected/.test(calls[0].reason));
    t('the read leaves out entries already reversed and the reversals themselves', /reverses_entry_id IS NULL/.test(asked4[0].sql) && /NOT EXISTS/.test(asked4[0].sql) && /LIKE 'chit:'/.test(asked4[0].sql));
  }

  console.log('\n— O7 · a shopper code is spent once —');
  const otp = require(path.join(API, 'lib', 'otp'));
  const runs = [];
  const spent = await otp.spendShopperOtp(async (sql, p) => { runs.push({ sql: one(sql), p }); return { rows: [], rowCount: 0 }; }, 'id1', '123456');
  t('spend names the code and says whether it spent one', spent === false && /otp_code = \$2/.test(runs[0].sql) && /RETURNING/.test(runs[0].sql));
  const won = await otp.spendShopperOtp(async () => ({ rows: [{ identity_id: 'id1' }], rowCount: 1 }), 'id1', '123456');
  t('a live code spends once (true)', won === true);
  t('the order/confirm transaction refuses when nothing was spent', /const spendOnce[\s\S]{0,500}code_already_used/.test(src('routes/catalogue.js')));

  console.log('\n— O1 / O5 · the counter page —');
  const till = src('tools/tally-connector/till.html');
  const fnSrc = (till.match(/function orderRowsOfBill\(bo, bill\)\{[\s\S]*?\n\}\n/) || [''])[0];
  const rowsOf = fnSrc ? new Function(fnSrc + '; return orderRowsOfBill;')() : null;
  t('O1 orderBilled asks orderRowsOfBill (the saved bill), not the loaded order', /async orderBilled\(bo, bill\)\{\s*var rows = orderRowsOfBill\(bo, bill\)/.test(till));
  if (rowsOf) {
    const bo = { lines: [{ line_id: 'LA', item_id: 'A', quantity: 5, unit: 'kg' }, { line_id: 'LB', item_id: 'B', quantity: 2, unit: 'kg' }] };
    const rows = rowsOf(bo, { lines: [{ item_id: 'A', qty: 3 }] });
    t('O1 5 × A + 2 × B collected as 3 × A → only 3 × A is recorded delivered', rows.length === 1 && rows[0].line_id === 'LA' && rows[0].quantity === 3, JSON.stringify(rows));
    t('O1 a bill of MORE than the order asked never delivers more than ordered', rowsOf(bo, { lines: [{ item_id: 'A', qty: 9 }, { item_id: 'B', qty: 2 }] }).map((r) => r.quantity).join() === '5,2');
  }
  t('O1 the order lines remember their item_id for that match', /got\.push\(\{ line_id: l\.line_id \|\| null, item_id:/.test(till));
  t('O5 finish() answers { ok, bill }', /return \{ ok: false \}/.test(till) && /return \{ ok: true, bill: r\.bill \}/.test(till));
  t('O5 orderSettle sends settled only on ok, else reopen', /var done = await finish\(\);[\s\S]{0,300}done && done\.ok[\s\S]{0,200}do: 'settled'[\s\S]{0,200}do: 'reopen'/.test(till));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
