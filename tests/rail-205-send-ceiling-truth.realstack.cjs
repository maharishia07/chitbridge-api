'use strict';
/**
 * tests/rail-205-send-ceiling-truth.realstack.cjs — RAIL-205 · RAIL-191 on a REAL Postgres, the api running as cb_app (RLS on), every write through the doors.
 *
 * OWNS     the proof that a chit total, line quantity or line price past the width of its column is a 400 CHIT_AMOUNT_TOO_LARGE with the maximum and the currency named, never the 500 of
 *          the 22003 inside chit_deliver, and that the limit just under it still sends
 * FLOW     fresh AU shop → POST /api/chits/send at 1e12 · 9,999,999,999,999.99 · 1e13 · 1e18 (total) and quantity 1e15 (line) → read chit_header back → POST /:id/amend quantity 1e15 · price 1e16
 * CARD     01-rail-core-the-chit/chits-routes
 *
 *   C-1  the three ceilings in lib/chit-ceiling are the precision and scale the database declares (information_schema), not a number written twice
 *   S-1  a total of 1e12 and of 9,999,999,999,999.99 (the largest numeric(15,2) holds) send: 200, and chit_detail.total_value reads back
 *   S-2  a total of 1e13 and of 1e18 are 400 CHIT_AMOUNT_TOO_LARGE, the sentence names 9,999,999,999,999.99 AUD, the field and the currency ride beside it, and no chit was written
 *   S-3  a quantity of 1e15 (numeric(18,3)) on a zero-priced line is the same 400, naming line 1 and no currency (a quantity is not money)
 *   A-1  amend: quantity 1e15 and price 1e16 are 400 CHIT_AMOUNT_TOO_LARGE with the chit's own currency, and the live line is unchanged
 *   A-2  amend: quantity 1e12 and price 1e12 are accepted (the control)
 * CI: picked up by the T2 loop over tests/*-truth.realstack.cjs (seeded api on :3000, TRUTH_DB cb_s41).
 * Run: API_BASE=http://127.0.0.1:3197 DATABASE_URL=postgres://cb_app:cblocal@127.0.0.1:55432/cb_local node tests/rail-205-send-ceiling-truth.realstack.cjs
 */
const H = require('./lib/truth-harness.cjs');
const { Client } = require('pg');
const { j, kase, expect, freshShop, finish, DB } = H;
const ceiling = require('../lib/chit-ceiling');
const RUN = 'r205' + (Date.now() % 1e9).toString(36);

const send = (shop, no, line, purpose) => j('/api/chits/send', { method: 'POST', token: shop.token, body: { recipients: [{ self: true, name: 'self' }], purpose: purpose || 'order', subject: no, manual_subject: no, client_ref: no, business_json: { customer: { name: 'Walk-in' } }, line_items: [Object.assign({ particulars: 'Big', quantity: 1, unit: 'piece' }, line)] } });
const asOwner = async (sql, args) => { const c = new Client({ connectionString: DB }); await c.connect(); try { return (await c.query(sql, args)).rows; } finally { await c.end(); } };
const chitsNamed = async (shop, no) => (await asOwner('SELECT count(*)::int AS n FROM chit_header WHERE entity_id = $1 AND manual_subject = $2', [shop.entity, no]))[0].n;
const refusedFor = (r, field, text) => {
  expect(r.status === 400 && r.b.code === 'CHIT_AMOUNT_TOO_LARGE', 'expected 400 CHIT_AMOUNT_TOO_LARGE, got HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 260));
  expect(r.b.field === field, 'field ' + r.b.field);
  expect(String(r.b.message || r.b.detail).includes(text), 'the sentence does not name ' + text + ': ' + JSON.stringify(r.b).slice(0, 260));
};

(async () => {
  console.log('\n── RAIL-205 chit ceiling on ' + H.API + ' · run ' + RUN + ' ──');
  const S = await freshShop(RUN, 'Ceiling', { country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: 'Australia/Sydney', tax: { registered: false } });

  await kase('C-1', 'the ceilings are the columns own precision and scale', async () => {
    for (const [field, spec] of Object.entries(ceiling.COLUMNS)) {
      const [table, column] = spec.column.split('.');
      const col = (await asOwner('SELECT numeric_precision AS p, numeric_scale AS s FROM information_schema.columns WHERE table_name = $1 AND column_name = $2 AND table_schema = $3', [table, column, 'public']))[0];
      expect(col && col.p === spec.precision && col.s === spec.scale, field + ' (' + spec.column + ') declared ' + JSON.stringify(spec) + ', database says ' + JSON.stringify(col));
    }
  });

  await kase('S-1', 'a total of 1e12 and of the largest the column holds send', async () => {
    for (const p of [1e12, 9999999999999.99]) {
      const no = 'ok' + p + RUN, r = await send(S, no, { price: p, total: p });
      expect(r.status === 200, 'total ' + p + ' → HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
      const rows = await asOwner('SELECT d.total_value::text AS t FROM chit_detail d JOIN chit_header h ON h.chit_id = d.chit_id AND h.entity_id = d.entity_id WHERE h.entity_id = $1 AND h.manual_subject = $2', [S.entity, no]);
      expect(rows.length && Number(rows[0].t) === p, 'chit_detail.total_value reads ' + JSON.stringify(rows));
    }
  });

  await kase('S-2', 'a total of 1e13 and of 1e18 are a 400 with the maximum and the currency, and nothing is written', async () => {
    for (const p of [1e13, 1e18]) {
      const no = 'big' + p + RUN, r = await send(S, no, { price: p, total: p });
      refusedFor(r, 'total', '9,999,999,999,999.99 AUD');
      expect(r.b.currency_code === 'AUD' && r.b.max === '9999999999999.99', 'detail ' + JSON.stringify(r.b).slice(0, 260));
      expect((await chitsNamed(S, no)) === 0, 'a chit was written for ' + p);
    }
  });

  await kase('S-3', 'a quantity of 1e15 is the same 400, naming the line', async () => {
    const no = 'qty' + RUN, r = await send(S, no, { quantity: 1e15, price: 0, total: 0 });
    refusedFor(r, 'quantity', 'line 1');
    expect(r.b.currency_code === null || r.b.currency_code === undefined, 'a quantity carries no currency: ' + JSON.stringify(r.b).slice(0, 200));
    expect((await chitsNamed(S, no)) === 0, 'a chit was written');
  });

  let held = null;
  await kase('A-1', 'amend: a quantity of 1e15 and a price of 1e16 are a 400 with the chit currency, and the live line is unchanged', async () => {
    const no = 'amd' + RUN, first = await send(S, no, { price: 5, quantity: 2, total: 10 }, 'general');
    expect(first.status === 200, 'the chit to amend: HTTP ' + first.status + ' ' + JSON.stringify(first.b).slice(0, 200));
    held = first.b.chit_id || (first.b.chit && first.b.chit.chit_id) || first.b.id;
    expect(held, 'no chit id in ' + JSON.stringify(first.b).slice(0, 200));
    const amend = (line) => j('/api/chits/' + held + '/amend', { method: 'POST', token: S.token, body: { edits: [{ line_index: 0, line: Object.assign({ particulars: 'Big', unit: 'piece' }, line), reason_code: 'other', reason: 'ceiling' }] } });
    refusedFor(await amend({ quantity: 1e15, price: 5 }), 'quantity', '999,999,999,999,999.999');
    const price = await amend({ quantity: 1, price: 1e16 });
    refusedFor(price, 'price', '9,999,999,999,999,999.99 AUD');
    expect(price.b.currency_code === 'AUD', 'currency beside the maximum: ' + JSON.stringify(price.b).slice(0, 200));
    const live = await asOwner('SELECT quantity::text AS q, price::text AS p FROM chit_line WHERE chit_id = $1 AND entity_id = $2', [held, S.entity]);
    expect(live.length === 1 && Number(live[0].q) === 2 && Number(live[0].p) === 5, 'the live line moved: ' + JSON.stringify(live));
  });

  await kase('A-2', 'amend: a quantity of 1e12 and a price of 1e12 are accepted', async () => {
    expect(held, 'A-1 made no chit');
    const r = await j('/api/chits/' + held + '/amend', { method: 'POST', token: S.token, body: { edits: [{ line_index: 0, line: { particulars: 'Big', unit: 'piece', quantity: 1e12, price: 1e12 }, reason_code: 'other', reason: 'ceiling' }] } });
    expect(r.status === 200, 'HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
  });

  finish('rail-205-send-ceiling');
})().catch((e) => { console.error(e); process.exit(1); });
