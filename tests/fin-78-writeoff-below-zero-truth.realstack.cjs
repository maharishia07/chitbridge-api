'use strict';
/**
 * tests/fin-78-writeoff-below-zero-truth.realstack.cjs — FIN-78 on REAL Postgres: a write-off never takes a due below zero (POST /api/books/write-off).
 *
 * owns: the proof that the write-off door judges the party's carried balance inside the transaction that writes, so a second write-off after
 *       a settled bill, an over-sized one, and two fired at once cannot leave the customer owed a minus figure.
 * FLOW  fresh IN shop (INR), books on, a walk-in customer, a bill posted as a manual journal (Dr debtors · Cr sales) → payments and write-offs
 *       through the routes → the due read back from /dues (the carried balance) and the write-off entries counted in journal_entry (SELECT only).
 *   WO-1  bill 100000, paid 100000, write-off 100000 → 409 BOOKS_CONFLICT naming ₹0 still owed; due stays 0; no write-off entry
 *   WO-2  bill 100000, write-off 100000 → 200, due 0; a second write-off of 100000 (new client_ref) → 409; due stays 0; ONE entry
 *   WO-3  bill 100000: 100001 → 409; 40000 → 200 (due 60000); 60001 → 409; 60000 → 200 (due 0)
 *   WO-4  CONCURRENT: bill 100000, two write-offs of 100000 at once → one 200, one 409; due 0; ONE entry
 *   WO-5  CONCURRENT: bill 100000, three of 60000 at once → one 200, two 409; due 40000; ONE entry
 *   WO-6  the same client_ref after the due is 0 is still a replay (200 duplicate: true), never a 409; still ONE entry
 *   WO-7  a customer who owes nothing: write-off 100 → 409; no entry
 * Hand-computed expectations are in each case's comment; money is minor units (paise).
 * CARD 16-finance/collections
 * Run: node tests/fin-78-writeoff-below-zero-truth.realstack.cjs   (API_BASE=http://127.0.0.1:<port> for the api to test)
 * ⚠️ LOCAL ONLY (the harness refuses anything else). Writes go through the routes; the database is only SELECTed.
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, j, ok, kase, expect, freshShop, finish } = H;

const RUN = 'f78' + (Date.now() % 1e10).toString(36);
const NOT_REGISTERED = { tax: { registered: false } };
let phoneN = Date.now() % 1e7;

/** a fresh walk-in customer */
async function customer(shop, tag) {
  const r = ok(await j('/api/crm/walk-ins/add', { method: 'POST', token: shop.token, body: { name: 'F78 ' + tag + ' ' + RUN, phone: '6' + String(1e7 + (phoneN++ % 9e6)).slice(-8) } }), 'party').b;
  return r.party_id || (r.party && r.party.party_id) || r.id;
}
/** the customer's carried due (minor) from /dues — the same figure the Collections list shows */
async function due(shop, party) {
  const d = ok(await j('/api/books/dues?side=customer', { token: shop.token }), 'dues').b;
  const row = (d.parties || []).find((p) => p.party_id === party);
  return row ? row.balance_minor : 0;
}
/** a bill of `minor` for the customer, as a manual journal: Dr debtors (the party) · Cr sales */
async function bill(shop, roles, party, minor) {
  const body = { narration: 'F78 bill', lines: [{ code: roles.debtors, dr_minor: minor, party_id: party }, { code: roles.sales, cr_minor: minor }] };
  return ok(await j('/api/books/entries', { method: 'POST', token: shop.token, body }), 'bill');
}
const writeOff = (shop, party, minor, ref) => j('/api/books/write-off', { method: 'POST', token: shop.token, body: { party_id: party, amount_minor: minor, reason: 'F78', client_ref: ref } });
const ref = (tag) => RUN + '-' + tag + '-' + Math.random().toString(36).slice(2, 8);
const sentence = (r) => String(r.b.detail || r.b.message || r.b.error || '');
/** how many write-off entries the shop holds for this customer's narration — the books' own count */
async function entries(pg, shop, party) {
  const r = await pg.query("SELECT count(*)::int AS n FROM journal_entry e WHERE e.entity_id = $1 AND e.event_type = 'write_off' AND EXISTS (SELECT 1 FROM journal_line l WHERE l.entry_id = e.entry_id AND l.party_id = $2)", [shop.entity, party]);
  return r.rows[0].n;
}
const refused = (r) => r.status === 409 && r.b.code === 'BOOKS_CONFLICT';

(async () => {
  console.log('\n══ FIN-78 · write-off never below zero · ' + RUN + ' ══\n');
  const pg = new Client({ connectionString: DB });
  await pg.connect();
  try {
    const shop = await freshShop(RUN, 'Writeoff Books', NOT_REGISTERED);
    ok(await j('/api/books/enable', { method: 'POST', token: shop.token }), 'books on');
    const chart = ok(await j('/api/books/accounts', { token: shop.token }), 'accounts').b.accounts;
    const roles = { debtors: String(chart.find((a) => a.role === 'debtors').code), sales: String(chart.find((a) => a.role === 'sales').code) };

    await kase('WO-1', 'bill 100000, paid 100000, write-off 100000 → 409, ₹0 still owed, due 0, no entry', async () => {
      const p = await customer(shop, 'one');
      await bill(shop, roles, p, 100000);
      ok(await j('/api/books/payments', { method: 'POST', token: shop.token, body: { party_id: p, direction: 'in', amount_minor: 100000, currency: 'INR', mode: 'cash', allocate: 'oldest_first' } }), 'payment');
      expect((await due(shop, p)) === 0, 'after the payment the due is 0 (100000 - 100000)');
      const r = await writeOff(shop, p, 100000, ref('1'));
      expect(refused(r), 'expected 409 BOOKS_CONFLICT, got ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 240));
      expect(/₹0 INR is still owed/.test(sentence(r)) && /₹1,000 INR/.test(sentence(r)), 'the sentence names what is still owed and the currency: ' + sentence(r));
      expect((await due(shop, p)) === 0, 'the due is 0, never -100000');
      expect((await entries(pg, shop, p)) === 0, 'no write-off entry was written');
    });

    await kase('WO-2', 'bill 100000, write-off 100000 → 200 due 0; a second of 100000 (new ref) → 409; one entry', async () => {
      const p = await customer(shop, 'two');
      await bill(shop, roles, p, 100000);
      const a = await writeOff(shop, p, 100000, ref('2a'));
      expect(a.status === 200 && (await due(shop, p)) === 0, 'first write-off 200 and due 0: ' + a.status);
      const b = await writeOff(shop, p, 100000, ref('2b'));
      expect(refused(b), 'second write-off must be 409, got ' + b.status + ' ' + sentence(b));
      expect((await due(shop, p)) === 0, 'due stays 0 (not -100000)');
      expect((await entries(pg, shop, p)) === 1, 'one write-off entry');
    });

    await kase('WO-3', 'bill 100000: 100001 → 409; 40000 → 200 (60000 due); 60001 → 409; 60000 → 200 (0)', async () => {
      const p = await customer(shop, 'three');
      await bill(shop, roles, p, 100000);
      const over = await writeOff(shop, p, 100001, ref('3a'));
      expect(refused(over) && (await due(shop, p)) === 100000, 'one over the due is refused, due 100000: ' + over.status);
      const part = await writeOff(shop, p, 40000, ref('3b'));
      expect(part.status === 200 && (await due(shop, p)) === 60000, 'a part write-off leaves 60000 (100000 - 40000): ' + part.status);
      const over2 = await writeOff(shop, p, 60001, ref('3c'));
      expect(refused(over2) && (await due(shop, p)) === 60000, 'one over what is left is refused: ' + over2.status);
      expect(/₹600 INR is still owed/.test(sentence(over2)), 'names ₹600 still owed: ' + sentence(over2));
      const rest = await writeOff(shop, p, 60000, ref('3d'));
      expect(rest.status === 200 && (await due(shop, p)) === 0, 'the exact rest closes it to 0: ' + rest.status);
      expect((await entries(pg, shop, p)) === 2, 'two write-off entries (40000 and 60000)');
    });

    await kase('WO-4', 'CONCURRENT: two write-offs of 100000 on a 100000 due → one 200, one 409, due 0, one entry', async () => {
      const p = await customer(shop, 'four');
      await bill(shop, roles, p, 100000);
      const rs = await Promise.all([writeOff(shop, p, 100000, ref('4a')), writeOff(shop, p, 100000, ref('4b'))]);
      const codes = rs.map((r) => r.status).sort();
      expect(codes.join() === '200,409', 'statuses must be 200 and 409, got ' + codes + ' ' + JSON.stringify(rs.map((r) => r.b)).slice(0, 300));
      expect((await due(shop, p)) === 0, 'due is 0, never -100000');
      expect((await entries(pg, shop, p)) === 1, 'ONE write-off entry');
    });

    await kase('WO-5', 'CONCURRENT: three write-offs of 60000 on a 100000 due → one 200, two 409, due 40000, one entry', async () => {
      const p = await customer(shop, 'five');
      await bill(shop, roles, p, 100000);
      const rs = await Promise.all([writeOff(shop, p, 60000, ref('5a')), writeOff(shop, p, 60000, ref('5b')), writeOff(shop, p, 60000, ref('5c'))]);
      const codes = rs.map((r) => r.status).sort();
      expect(codes.join() === '200,409,409', 'statuses must be 200,409,409, got ' + codes + ' ' + JSON.stringify(rs.map((r) => r.b)).slice(0, 300));
      expect((await due(shop, p)) === 40000, 'due is 40000 (100000 - 60000)');
      expect((await entries(pg, shop, p)) === 1, 'ONE write-off entry');
    });

    await kase('WO-6', 'the same client_ref again after the due is 0 is a replay (200 duplicate:true), not a 409', async () => {
      const p = await customer(shop, 'six');
      await bill(shop, roles, p, 100000);
      const same = ref('6');
      const a = await writeOff(shop, p, 100000, same);
      const b = await writeOff(shop, p, 100000, same);
      expect(a.status === 200 && b.status === 200 && b.b.duplicate === true, 'replay answers 200 duplicate: ' + a.status + '/' + b.status + ' ' + JSON.stringify(b.b).slice(0, 200));
      expect((await due(shop, p)) === 0 && (await entries(pg, shop, p)) === 1, 'due 0 and ONE entry');
    });

    await kase('WO-7', 'a customer who owes nothing: write-off 100 → 409, no entry', async () => {
      const p = await customer(shop, 'seven');
      const r = await writeOff(shop, p, 100, ref('7'));
      expect(refused(r), 'expected 409, got ' + r.status + ' ' + sentence(r));
      expect((await entries(pg, shop, p)) === 0 && (await due(shop, p)) === 0, 'nothing written; due 0');
    });
  } finally {
    await pg.end();
  }
  finish('fin-78-writeoff-below-zero');
})().catch((e) => {
  console.error('FATAL', e.stack || e);
  process.exit(1);
});
