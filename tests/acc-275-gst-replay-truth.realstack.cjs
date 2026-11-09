'use strict';
/**
 * tests/acc-275-gst-replay-truth.realstack.cjs — ACC-275 on REAL Postgres, the api running as cb_app: POST /api/books/gst/pay replays answer the STORED row,
 * a reused challan with another amount or head is refused (409 BOOKS_CONFLICT), and a pay is serialised against another pay and against POST /gst/close.
 *
 * owns: the proof the in-memory stand-in cannot give (it has no locks): the advisory lock `gst|<head>` (lib/books-period lockTaxHeads, shared by gstPay and gstClose).
 * FLOW  fresh IN shop, books on, October 2026 journals: Dr cash · Cr output CGST 10000 (and, for the close case, Dr input CGST · Cr cash 4000) → pays through the route,
 *       each its own Idempotency-Key (the harness j()) → the output CGST balance read back with SELECT (ledger_line, credit − debit; nothing is written here).
 *   GP-1  a replay of the same challan and amount: 200, replayed:true, paid_minor {cgst:6000} (the stored row), the same entry_no, ONE entry, owed stays 4000
 *   GP-2  the same challan with another amount (9000): 409 BOOKS_CONFLICT naming the stored 6000, nothing written, owed still 4000
 *   GP-3  the same challan with another head (sgst 6000): 409 BOOKS_CONFLICT, nothing written
 *   GP-4  overpay: 4001 against 4000 owed → 422 "more than the tax owed", nothing written; 4000 is paid, owed 0; the spent challan replays its 6000
 *   GP-5  two pays at once (7000 + 7000 against 10000): both WAIT while another transaction holds gst|cgst; after release one is 200, one is 422; owed 3000
 *   GP-6  a pay racing the close (pay 10000, close sets off 4000 of input): both WAIT; after release pay 200 and owed 0, or pay 422 and owed 6000 — never below 0
 * CARD 16-finance/books
 * Run: API_BASE=http://127.0.0.1:<port> node tests/acc-275-gst-replay-truth.realstack.cjs   ⚠️ LOCAL ONLY (the harness refuses anything else)
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { LOCK_SQL } = require('../lib/xact-lock');
const { DB, j, ok, kase, pause, expect, freshShop, finish } = H;

const RUN = 'g75' + (Date.now() % 1e10).toString(36);
const NOT_REGISTERED = { tax: { registered: false } };
const OCT = '2026-10-10';
const FY = '2026-27';
const OCTOBER = 7; /* April is 1 */

/** a fresh shop with 10000 of output CGST owed (and, when asked, 4000 of input CGST to set off) */
async function world(pg, tag, withInput) {
  const shop = await freshShop(RUN + tag, 'GST Replay', NOT_REGISTERED);
  ok(await j('/api/books/enable', { method: 'POST', token: shop.token }), 'books on');
  const code = {};
  (await pg.query("SELECT role, code FROM ledger_account WHERE entity_id = $1 AND role IN ('cash','output_cgst','input_cgst')", [shop.entity])).rows.forEach((row) => (code[row.role] = row.code));
  const journal = (lines, ref) => j('/api/books/events', { method: 'POST', token: shop.token, body: { event: { kind: 'journal', narration: 'GST ' + ref, date: OCT, lines, client_ref: RUN + tag + ref } } });
  ok(await journal([{ code: code.cash, dr_minor: 10000 }, { code: code.output_cgst, cr_minor: 10000 }], 'out'), 'output tax journal');
  if (withInput) ok(await journal([{ code: code.input_cgst, dr_minor: 4000 }, { code: code.cash, cr_minor: 4000 }], 'in'), 'input tax journal');
  return shop;
}
const pay = (shop, challan, amounts, date) => j('/api/books/gst/pay', { method: 'POST', token: shop.token, body: { fy: FY, period: OCTOBER, amounts, bank: 'bank', challan_no: challan, date: date || '2026-11-09' } });
/** what is still owed on a head: credit − debit of its output ledger, from the lines (SELECT only) */
async function owed(pg, shop, role) {
  const r = await pg.query(
    `SELECT COALESCE(SUM(l.cr_minor - l.dr_minor), 0)::bigint AS owed FROM journal_line l JOIN ledger_account a ON a.account_id = l.account_id AND a.entity_id = l.entity_id WHERE l.entity_id = $1 AND a.role = $2`,
    [shop.entity, role]
  );
  return Number(r.rows[0].owed);
}
const entriesOf = async (pg, shop, ref) => Number((await pg.query('SELECT COUNT(*)::int AS n FROM journal_entry WHERE entity_id = $1 AND source_ref = $2', [shop.entity, 'gstpay:' + ref])).rows[0].n);
const said = (reply) => JSON.stringify([reply.status, reply.b]);

/** start the doors while another transaction holds gst|cgst: none may answer until it is released */
async function whileHeld(lock, shop, doors, pg) {
  await lock.query('BEGIN');
  await lock.query(LOCK_SQL, [shop.entity, 'gst|cgst']);
  let released = false;
  const waiting = doors.map((door) => door().then((reply) => { expect(released, 'a door answered while gst|cgst was held: ' + said(reply)); return reply; }));
  await pause(900);
  const entries = Number((await pg.query("SELECT COUNT(*)::int AS n FROM journal_entry WHERE entity_id = $1 AND source_ref LIKE 'gst%'", [shop.entity])).rows[0].n);
  expect(entries === 0, entries + ' gst entries written while the lock was held');
  released = true;
  await lock.query('COMMIT');
  return Promise.all(waiting);
}

(async () => {
  console.log('\n══ ACC-275 · GST pay replay + lock on real Postgres · ' + RUN + ' ══\n');
  const pg = new Client({ connectionString: DB });
  await pg.connect();
  const lock = new Client({ connectionString: DB });
  await lock.connect();
  try {
    const shop = await world(pg, 'a');

    await kase('GP-1', 'a replay of the same challan and amount answers the STORED row (replayed:true), posts nothing', async () => {
      const first = ok(await pay(shop, 'CH-1', { cgst_minor: 6000 }), 'first pay').b;
      expect(first.ok && first.paid_minor.cgst === 6000 && !first.duplicate, 'first ' + JSON.stringify(first));
      const again = await pay(shop, 'CH-1', { cgst_minor: 6000 });
      expect(again.status === 200 && again.b.replayed === true && again.b.duplicate === true, 'replay ' + said(again));
      expect(again.b.paid_minor.cgst === 6000 && Object.keys(again.b.paid_minor).length === 1 && again.b.entry_no === first.entry_no, 'replay figures ' + said(again));
      expect((await entriesOf(pg, shop, 'CH-1')) === 1 && (await owed(pg, shop, 'output_cgst')) === 4000, 'ledger moved: owed ' + (await owed(pg, shop, 'output_cgst')));
      return said(again);
    });

    await kase('GP-2', 'the same challan with another amount is refused: 409 BOOKS_CONFLICT, the stored 6000 named, nothing written', async () => {
      const other = await pay(shop, 'CH-1', { cgst_minor: 9000 });
      expect(other.status === 409 && other.b.code === 'BOOKS_CONFLICT', 'answer ' + said(other));
      expect(/CGST 60 /.test(JSON.stringify(other.b)) && !other.b.replayed, 'the sentence must name the stored amount, and not answer 9000 as paid: ' + said(other));
      expect((await entriesOf(pg, shop, 'CH-1')) === 1 && (await owed(pg, shop, 'output_cgst')) === 4000, 'ledger moved');
      return said(other);
    });

    await kase('GP-3', 'the same challan with another head is refused: 409 BOOKS_CONFLICT, nothing written', async () => {
      const other = await pay(shop, 'CH-1', { sgst_minor: 6000 });
      expect(other.status === 409 && other.b.code === 'BOOKS_CONFLICT', 'answer ' + said(other));
      expect((await entriesOf(pg, shop, 'CH-1')) === 1 && (await owed(pg, shop, 'output_cgst')) === 4000, 'ledger moved');
      return said(other);
    });

    await kase('GP-4', 'overpay (4001 of 4000 owed) is refused 422; 4000 is paid; the spent challan still replays its own 6000', async () => {
      const over = await pay(shop, 'CH-2', { cgst_minor: 4001 });
      expect(over.status === 422 && /more than the tax owed/.test(JSON.stringify(over.b)), 'overpay ' + said(over));
      expect((await entriesOf(pg, shop, 'CH-2')) === 0, 'an overpay was written');
      ok(await pay(shop, 'CH-2', { cgst_minor: 4000 }), 'exact pay');
      expect((await owed(pg, shop, 'output_cgst')) === 0, 'owed ' + (await owed(pg, shop, 'output_cgst')));
      const spent = await pay(shop, 'CH-1', { cgst_minor: 6000 });
      expect(spent.status === 200 && spent.b.replayed === true && spent.b.paid_minor.cgst === 6000, 'replay after the balance is spent ' + said(spent));
      return said(over);
    });

    await kase('GP-5', 'two pays at once (7000 + 7000 of 10000 owed) wait on gst|cgst; then one is 200, one is 422, owed 3000', async () => {
      const racers = await world(pg, 'b');
      const replies = await whileHeld(lock, racers, [() => pay(racers, 'RA-1', { cgst_minor: 7000 }), () => pay(racers, 'RA-2', { cgst_minor: 7000 })], pg);
      const statuses = replies.map((r) => r.status).sort();
      expect(statuses[0] === 200 && statuses[1] === 422, 'statuses ' + JSON.stringify(replies.map((r) => [r.status, r.b])));
      expect((await owed(pg, racers, 'output_cgst')) === 3000, 'owed ' + (await owed(pg, racers, 'output_cgst')));
      const open = await Promise.all([pay(racers, 'RB-1', { cgst_minor: 2000 }), pay(racers, 'RB-2', { cgst_minor: 2000 })]);
      expect(open.filter((r) => r.status === 200).length === 1 && (await owed(pg, racers, 'output_cgst')) === 1000, 'unheld race ' + JSON.stringify(open.map((r) => [r.status, r.b])));
      return JSON.stringify(statuses);
    });

    await kase('GP-6', 'a pay racing the close waits on gst|cgst; pay 200 with owed 0, or pay refused (the month is locked) with owed 6000; never below 0', async () => {
      const racers = await world(pg, 'c', true);
      const close = () => j('/api/books/gst/close', { method: 'POST', token: racers.token, body: { fy: FY, period: OCTOBER } });
      const replies = await whileHeld(lock, racers, [() => pay(racers, 'RC-1', { cgst_minor: 10000 }, '2026-10-20'), close], pg);
      const [paid, closed] = replies, left = await owed(pg, racers, 'output_cgst');
      expect(closed.status === 200, 'close ' + said(closed));
      expect((paid.status === 200 && left === 0) || (paid.status >= 400 && left === 6000), 'pay ' + said(paid) + ' but owed ' + left + ' (a negative figure is a payment past the set-off)');
      return said(paid) + ' owed ' + left;
    });
  } finally {
    await lock.end();
    await pg.end();
  }
  finish('ACC-275 gst replay');
})().catch((e) => { console.error(e); process.exit(2); });
