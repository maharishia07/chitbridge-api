'use strict';
/**
 * tests/acc-328-opening-twice.realstack.cjs — ACC-328 + ACC-329 on REAL Postgres, the api running as cb_app: an opening is posted once, and not in the future.
 *
 * owns: the proof the in-memory stand-in cannot give (it has no locks): the advisory lock `opening|<day>` (lib/books-store lockOpening, taken by lib/books
 *       refuseOpeningTwice). The offline twin (tests/acc-328-opening-twice.test.cjs) proves the rule; this proves the race.
 * FLOW  fresh IN shop, books on → POST /api/books/opening, each its own Idempotency-Key (the harness j()); the journal read back with SELECT (nothing is written here).
 *   OP-1  Dr 1400 100000 / Cr 3000 100000 on 2026-04-01 ref "a": 200. Same rows ref "b": 409 BOOKS_CONFLICT; ref "a" again: 200 duplicate:true; ONE opening in the journal
 *   OP-2  two posts at once of the same rows (ref "x", ref "y") WAIT while another transaction holds opening|2026-04-01; after release one is 200, one is 409; ONE entry
 *   OP-3  a date years ahead is 422 "That date is in the future." and no journal entry exists for it
 * CARD 14-accounting/ledger-accounts-day-book-entries-reverse
 * Run: API_BASE=http://127.0.0.1:<port> node tests/acc-328-opening-twice.realstack.cjs   ⚠️ LOCAL ONLY (the harness refuses anything else)
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { LOCK_SQL } = require('../lib/xact-lock');
const { DB, j, ok, kase, pause, expect, freshShop, finish } = H;

const RUN = 'o28' + (Date.now() % 1e10).toString(36);
const DAY = '2026-04-01';
const NOT_REGISTERED = { tax: { registered: false } };
const said = (reply) => JSON.stringify([reply.status, reply.b]);
const body = (ref, amount, date) => ({ date: date || DAY, client_ref: RUN + ref, rows: [{ code: '1400', dr_minor: amount }, { code: '3000', cr_minor: amount }] });
const post = (shop, b) => j('/api/books/opening', { method: 'POST', token: shop.token, body: b });
const openings = async (pg, shop) => Number((await pg.query('SELECT COUNT(*)::int AS n FROM journal_entry WHERE entity_id = $1 AND is_opening AND reverses_entry_id IS NULL', [shop.entity])).rows[0].n);
const cash = async (pg, shop) =>
  Number((await pg.query("SELECT COALESCE(SUM(l.dr_minor - l.cr_minor), 0)::bigint AS n FROM journal_line l JOIN ledger_account a ON a.account_id = l.account_id AND a.entity_id = l.entity_id WHERE l.entity_id = $1 AND a.code = '1400'", [shop.entity])).rows[0].n);

(async () => {
  console.log('\n══ ACC-328 / ACC-329 · opening once, not in the future, on real Postgres · ' + RUN + ' ══\n');
  const pg = new Client({ connectionString: DB });
  await pg.connect();
  const lock = new Client({ connectionString: DB });
  await lock.connect();
  try {
    const fresh = async (tag) => {
      const shop = await freshShop(RUN + tag, 'Opening Once', NOT_REGISTERED);
      ok(await j('/api/books/enable', { method: 'POST', token: shop.token }), 'books on');
      return shop;
    };
    const shop = await fresh('a');

    await kase('OP-1', 'the same rows under another ref are refused 409; the same ref is a 200 retry; cash stays 100000', async () => {
      const first = ok(await post(shop, body('a', 100000)), 'first opening').b;
      expect(first.ok && !first.duplicate, 'first ' + JSON.stringify(first));
      const second = await post(shop, body('b', 100000));
      expect(second.status === 409 && second.b.code === 'BOOKS_CONFLICT', 'second ' + said(second));
      const retry = await post(shop, body('a', 100000));
      expect(retry.status === 200 && retry.b.duplicate === true && retry.b.entry_no === first.entry_no, 'retry ' + said(retry));
      expect((await openings(pg, shop)) === 1 && (await cash(pg, shop)) === 100000, 'books: ' + (await openings(pg, shop)) + ' openings, cash ' + (await cash(pg, shop)));
      return said(second);
    });

    await kase('OP-2', 'two posts of the same rows at once wait on opening|day; then one is 200, one is 409; one entry', async () => {
      const racers = await fresh('b');
      await lock.query('BEGIN');
      await lock.query(LOCK_SQL, [racers.entity, 'opening|' + DAY]);
      let released = false;
      const early = [];
      const waiting = ['x', 'y'].map((ref) => post(racers, body(ref, 250000)).then((reply) => { if (!released) early.push(said(reply)); return reply; }));
      await pause(900);
      const written = await openings(pg, racers);
      released = true;
      await lock.query('COMMIT');
      const replies = await Promise.all(waiting);
      expect(!early.length && written === 0, 'while opening|day was held: ' + written + ' written; answered early: ' + early.join(' | '));
      const statuses = replies.map((r) => r.status).sort();
      expect(statuses[0] === 200 && statuses[1] === 409, 'statuses ' + JSON.stringify(replies.map((r) => [r.status, r.b])));
      expect((await openings(pg, racers)) === 1 && (await cash(pg, racers)) === 250000, 'books: ' + (await openings(pg, racers)) + ' openings, cash ' + (await cash(pg, racers)));
      return JSON.stringify(statuses);
    });

    await kase('OP-3', 'an opening dated years ahead is 422 "That date is in the future." and writes nothing', async () => {
      const future = await post(shop, body('f', 5000, '2031-03-31'));
      expect(future.status === 422 && /That date is in the future\./.test(JSON.stringify(future.b)), 'answer ' + said(future));
      const n = Number((await pg.query("SELECT COUNT(*)::int AS n FROM journal_entry WHERE entity_id = $1 AND posting_date >= '2027-04-01'", [shop.entity])).rows[0].n);
      expect(n === 0, n + ' entries dated after 2027-03-31');
      return said(future);
    });
  } finally {
    await lock.end();
    await pg.end();
  }
  finish('ACC-328 opening twice');
})().catch((e) => { console.error(e); process.exit(2); });
