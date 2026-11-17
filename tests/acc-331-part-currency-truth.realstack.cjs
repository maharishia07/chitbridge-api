'use strict';
/**
 * tests/acc-331-part-currency-truth.realstack.cjs — CUR-1: A MONEY CELL NAMES THE DOCUMENT'S CURRENCY, OR NONE (ACC-331 bill cells · ACC-332 journal lines), on the LOCAL stack.
 *
 * Hand figures (a shop NOT registered for tax, one product at 100.00, no tax, no discount): the bill total is 100.00 = 10000 minor of the shop's money.
 * P1 INR bill, payment.currency + payment.parts[0].currency USD  → 409 CURRENCY_MISMATCH naming payment.currency; nothing saved (no chit)
 * P2 INR bill, only payment.parts[0].currency USD                → 409 CURRENCY_MISMATCH naming payment.parts[0].currency
 * P3 INR bill, line_items[0].currency USD                        → 409 CURRENCY_MISMATCH naming line_items[0].currency
 * P4 AUD bill, payment.parts[0].currency INR                     → 409 CURRENCY_MISMATCH (the same check, another shop's money)
 * P5 control: cells say INR (and "inr"), or say nothing          → 200, each bill books Dr 10000 minor (the till sends no currency)
 * J1 INR journal, lines in USD (dr 100 / cr 100)                 → 409 CURRENCY_MISMATCH naming lines[0].currency; nothing posted
 * J2 control: lines say INR, or nothing                          → 200, each entry carries dr 100 = cr 100 minor
 * Red on main (P1-P4 and J1 answer 200), green with lib/currency-cells. LOCAL ONLY: node tests/acc-331-part-currency-truth.realstack.cjs  (API_BASE=http://127.0.0.1:<port>)
 * CARD 14-accounting/README
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, j, ok, pause, kase, expect, bill, freshShop, finish } = H;
const RUN = 'a331' + (Date.now() % 1e9).toString(36);
const NOT_REGISTERED = { tax: { registered: false } };
const AU = { country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: 'Australia/Sydney', tax: { registered: false } };
const dayAt = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
const day = dayAt(0);
let pg = null;
const lsum = (e, side) => (e.lines || []).reduce((a, l) => a + Number(l[side + '_minor'] || 0), 0);
const send = (shop, body) => j('/api/chits/send', { method: 'POST', token: shop.token, body });
/** a counter bill of one 100.00 product whose payment / lines are edited by `edit` before it is sent */
const billOf = (no, P, edit, customer) => { const b = bill(no, [[P, 1]], customer ? { customer } : undefined); if (edit) edit(b); return b; };
const refusedAs = (r, field) => expect(r.status === 409 && r.b.code === 'CURRENCY_MISMATCH' && JSON.stringify(r.b).includes(field), 'want 409 CURRENCY_MISMATCH on ' + field + ', got ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 260));
const chitsOf = async (shop, no) => Number((await pg.query('SELECT count(*) AS n FROM chit_header WHERE entity_id = $1 AND business_json ->> $3 = $2', [shop.entity, no, 'client_ref'])).rows[0].n);
const entriesOf = async (shop) => (await j('/api/books/daybook?from=' + dayAt(-2) + '&to=' + dayAt(2) + '&limit=500', { token: shop.token })).b.entries || [];
const srcOf = (e) => String(e.source_chit_id || (e.source && e.source.chit_id) || '');

(async () => {
  console.log('\n── acc-331/332 part currency on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  pg = new Client({ connectionString: DB }); await pg.connect();
  try {
    const A = await freshShop(RUN + 'i', 'Cur cells', NOT_REGISTERED);
    ok(await j('/api/books/enable', { method: 'POST', token: A.token }), 'books on');
    const U = await freshShop(RUN + 'u', 'Cur cells AU', AU);
    ok(await j('/api/books/enable', { method: 'POST', token: U.token }), 'books on AU');
    const mk = async (shop, name) => { const r = ok(await j('/api/products', { method: 'POST', token: shop.token, body: { item_data: { name, unit: 'piece', price: 100 } } }), 'product').b; return { id: r.item.item_id, name, unit: 'piece', price: 100 }; };
    const P = await mk(A, 'Rice'), PU = await mk(U, 'Rice');
    /* a bill to a NAMED customer posts its own sale entry at once; a walk-in cash bill waits for the day close (books-hooks walkin_day) */
    const walk = ok(await j('/api/crm/walk-ins/add', { method: 'POST', token: A.token, body: { name: 'Cur cells buyer', phone: '4' + String(Date.now()).slice(-8) } }), 'party').b;
    const buyer = { name: 'Cur cells buyer', party_id: walk.party_id || (walk.party && walk.party.party_id) };

    const n1 = RUN + '-p1', n2 = RUN + '-p2', n3 = RUN + '-p3', n4 = RUN + '-p4';
    await kase('P1', 'INR bill, payment and its part in USD: 409 CURRENCY_MISMATCH on payment.currency, nothing saved', async () => {
      refusedAs(await send(A, billOf(n1, P, (b) => { b.business_json.payment.currency = 'USD'; b.business_json.payment.parts[0].currency = 'USD'; })), 'payment.currency');
      expect((await chitsOf(A, n1)) === 0, 'a chit was written');
    });
    await kase('P2', 'INR bill, only the part in USD: the field is payment.parts[0].currency', async () => {
      refusedAs(await send(A, billOf(n2, P, (b) => { b.business_json.payment.parts[0].currency = 'USD'; })), 'payment.parts[0].currency');
      expect((await chitsOf(A, n2)) === 0, 'a chit was written');
    });
    await kase('P3', 'INR bill, a line priced in USD: the field is line_items[0].currency', async () => {
      refusedAs(await send(A, billOf(n3, P, (b) => { b.line_items[0].currency = 'USD'; })), 'line_items[0].currency');
      expect((await chitsOf(A, n3)) === 0, 'a chit was written');
    });
    await kase('P4', 'AUD bill, a part in INR: refused by the same check', async () => {
      refusedAs(await send(U, billOf(n4, PU, (b) => { b.business_json.payment.parts[0].currency = 'INR'; })), 'payment.parts[0].currency');
      expect((await chitsOf(U, n4)) === 0, 'a chit was written');
    });
    await kase('P5', 'control: INR, "inr" and no currency at all are the shop\'s own money: 200, each bill books Dr 10000', async () => {
      const ids = [];
      ids.push(ok(await send(A, billOf(RUN + '-c1', P, (b) => { b.business_json.payment.currency = 'INR'; b.business_json.payment.parts[0].currency = 'INR'; b.line_items[0].currency = 'INR'; }, buyer)), 'INR cells').b.chit_id);
      ids.push(ok(await send(A, billOf(RUN + '-c2', P, (b) => { b.business_json.payment.parts[0].currency = 'inr'; }, buyer)), 'lower-case').b.chit_id);
      ids.push(ok(await send(A, billOf(RUN + '-c3', P, null, buyer)), 'no currency').b.chit_id);
      await j('/api/books/outbox/retry', { method: 'POST', token: A.token }); await pause(3800);
      const es = await entriesOf(A);
      const seen = ids.map((id) => { const e = es.find((x) => srcOf(x) === String(id)); return e ? lsum(e, 'dr') : 'no entry'; });
      expect(seen.every((dr) => dr === 10000), 'Dr per bill: ' + seen.join(', '));
    });

    /* the journal */
    const accs = ok(await j('/api/books/accounts', { token: A.token }), 'accounts').b; const list = accs.accounts || accs.rows || accs || [];
    const cash = (list.find((a) => /cash/i.test(a.name || '')) || {}).code || '1000', sales = (list.find((a) => /^sales/i.test(a.name || '')) || {}).code || '4000';
    const post = (lines, tag) => j('/api/books/entries', { method: 'POST', token: A.token, body: { narration: 'acc332 ' + RUN + tag, date: day, lines } });
    await kase('J1', 'INR journal with lines in USD: 409 CURRENCY_MISMATCH on lines[0].currency, nothing posted', async () => {
      refusedAs(await post([{ code: cash, dr_minor: 100, currency: 'USD' }, { code: sales, cr_minor: 100, currency: 'USD' }], 'usd'), 'lines[0].currency');
      expect(!(await entriesOf(A)).some((e) => String(e.narration || '').endsWith(RUN + 'usd')), 'the USD journal was posted');
    });
    await kase('J2', 'control: lines saying INR, or nothing, post dr 100 = cr 100 minor', async () => {
      const a = ok(await post([{ code: cash, dr_minor: 100, currency: 'INR' }, { code: sales, cr_minor: 100, currency: 'INR' }], 'inr'), 'INR lines').b;
      const b = ok(await post([{ code: cash, dr_minor: 100 }, { code: sales, cr_minor: 100 }], 'none'), 'no currency').b;
      const mine = (await entriesOf(A)).filter((e) => [a.entry_id, b.entry_id].includes(e.entry_id || e.id));
      expect(mine.length === 2 && mine.every((e) => lsum(e, 'dr') === 100 && lsum(e, 'cr') === 100), 'entries ' + JSON.stringify(mine.map((e) => [lsum(e, 'dr'), lsum(e, 'cr')])));
    });
  } finally { await pg.end(); }
  finish('acc-331-part-currency');
})().catch((e) => { console.error(e); process.exitCode = 1; });
