'use strict';
/**
 * tests/rail-191-deliver-lines-truth.realstack.cjs — RAIL-191 (second half) · RAIL-192 · RAIL-193 on a REAL Postgres, the api running as cb_app (RLS on), every write through the doors.
 *
 * OWNS     the proof that POST /api/chits/:chit_id/deliver-lines (1) refuses a quantity past its column with a 400 CHIT_AMOUNT_TOO_LARGE instead of the 500 of the 22003, (2) refuses a
 *          correction that would take what a line delivered under zero (409 CHIT_CONFLICT), and (3) refuses a delivery on a copy that is rejected or cancelled (409 CHIT_CONFLICT, why
 *          wrong_step) — each BEFORE any row is written (chit_line_delivery is counted before and after)
 * FLOW     fresh AU shops S and R → S sends R an order of 10 kg at 100 → the delivery rows are read back as the owner (SELECT) after every door
 *          RAIL-H8 (toolset/sit-hunt/rail/run.cjs): 12 of 10 → -15 refused → 1e30 · RAIL-H9: R rejects, R delivers · the void: S withdraws, S delivers
 * CARD     01-rail-core-the-chit/chits-routes
 *
 *   Q-1  quantity 1e308 · 1e30 · 1e15 are 400 CHIT_AMOUNT_TOO_LARGE naming 999,999,999,999,999.999 and line 1, no currency; no delivery row is written; 1e12 records (the control)
 *   F-1  hand-computed: deliver 12 (of 10: over by 2) → net 12; -15 refused (12 - 15 = -3) and net stays 12; -12 → net 0; a further -1 refused (net stays 0)
 *   F-2  deliver 1, then -3: refused, net stays 1 (the case that read -2)
 *   F-3  one request of +5 then -8 is judged as stored (5 - 8 = -3 → refused, nothing written); +5 then -5 in one request nets 0 and records
 *   F-4  the floor is per unit: with 12 kg delivered, -2 piece is refused (pieces net 0), and a replayed client_ref of an accepted correction is a 200 replay, never a refusal
 *   W-1  R rejects → R delivers 5: 409 CHIT_CONFLICT why wrong_step, status still rejected, no row; R moves it back to accepted → the same delivery records (5)
 *   W-2  S withdraws (void → S's sent copy cancelled) → S delivers 5: 409, no row; R (whose copy was only asked) still delivers 5
 * CI: picked up by the T2 loop over tests/*-truth.realstack.cjs (seeded api on :3000, TRUTH_DB cb_s41).
 * Run: API_BASE=http://127.0.0.1:3291 TRUTH_DB=postgres://postgres:cblocal@127.0.0.1:55432/cb_local node tests/rail-191-deliver-lines-truth.realstack.cjs   (api started as cb_app)
 */
const H = require('./lib/truth-harness.cjs');
const { Client } = require('pg');
const { j, kase, expect, freshShop, finish, DB } = H;
const RUN = 'r191' + (Date.now() % 1e9).toString(36);

const asOwner = async (sql, args) => { const c = new Client({ connectionString: DB }); await c.connect(); try { return (await c.query(sql, args)).rows; } finally { await c.end(); } };
/** what a shop's own copy holds: the net delivered on its line (kg unless a unit is named) and the number of rows behind it */
const heldBy = async (shop, chit, unit) => (await asOwner(
  `SELECT COALESCE(sum(quantity) FILTER (WHERE lower(unit) = $3), 0)::float AS net, count(*)::int AS n
     FROM chit_line_delivery WHERE entity_id = $1 AND chit_id = $2 AND recorded_by_entity_id = $1`, [shop.entity, chit, unit || 'kg']))[0];
const statusOf = async (shop, chit) => (await asOwner('SELECT string_agg(direction || \':\' || current_status, \',\' ORDER BY direction) AS s FROM chit_status WHERE entity_id = $1 AND chit_id = $2', [shop.entity, chit]))[0].s;
const lineOf = async (shop, chit) => (await asOwner('SELECT line_id::text AS id FROM chit_line WHERE entity_id = $1 AND chit_id = $2', [shop.entity, chit]))[0].id;

let S, R, seq = 0;
/** S sends R an order of 10 kg of rice at 100; → { chit, sLine, rLine } */
async function order(tag) {
  const no = tag + RUN + ++seq;
  const sent = await j('/api/chits/send', { method: 'POST', token: S.token, body: { recipients: [{ bridge_id: R.bridge, display_name: R.name, kind: 'to' }], purpose: 'order', subject: no, manual_subject: no, client_ref: no, business_json: { order_no: no }, line_items: [{ particulars: 'Rice sack', quantity: 10, unit: 'kg', price: 100, total: 1000 }] } });
  expect(sent.status === 200, 'the order did not send: HTTP ' + sent.status + ' ' + JSON.stringify(sent.b).slice(0, 200));
  const chit = sent.b.chit_id || (sent.b.chit && sent.b.chit.chit_id);
  return { chit, sLine: await lineOf(S, chit), rLine: await lineOf(R, chit) };
}
const deliver = (shop, o, rows) => j('/api/chits/' + o.chit + '/deliver-lines', { method: 'POST', token: shop.token, body: { rows } });
const row = (lineId, quantity, extra) => Object.assign({ line_id: lineId, quantity, unit: 'kg' }, extra);
/** a refusal: the status, the register code, a plain sentence, and nothing stored (the row count held) */
async function refused(shop, o, rows, status, code, before) {
  const r = await deliver(shop, o, rows);
  expect(r.status === status && r.b.code === code, 'expected ' + status + ' ' + code + ', got HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 300));
  expect(typeof (r.b.message || r.b.detail) === 'string' && /[a-z]{3,} [a-z]{2,}/.test(r.b.message || r.b.detail), 'no plain sentence: ' + JSON.stringify(r.b).slice(0, 200));
  expect((await heldBy(shop, o.chit)).n === before, 'a row was written by a refused delivery');
  return r;
}

(async () => {
  console.log('\n── RAIL-191/192/193 deliver-lines on ' + H.API + ' · run ' + RUN + ' ──');
  const au = { country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: 'Australia/Sydney', tax: { registered: false } };
  S = await freshShop(RUN + 's', 'Seller', au);
  R = await freshShop(RUN + 'r', 'Receiver', au);

  await kase('Q-1', 'a quantity past its column is a 400 with the maximum, nothing is written; 1e12 records', async () => {
    const o = await order('q');
    for (const big of [1e308, 1e30, 1e15]) {
      const r = await refused(S, o, [row(o.sLine, big)], 400, 'CHIT_AMOUNT_TOO_LARGE', 0);
      expect(r.b.field === 'quantity' && r.b.line === 1 && String(r.b.message).includes('999,999,999,999,999.999'), 'the sentence or field: ' + JSON.stringify(r.b).slice(0, 300));
      expect(r.b.currency_code === null || r.b.currency_code === undefined, 'a quantity carries no currency: ' + JSON.stringify(r.b).slice(0, 200));
    }
    const fits = await deliver(S, o, [row(o.sLine, 1e12)]);
    expect(fits.status === 200, 'the control 1e12: HTTP ' + fits.status + ' ' + JSON.stringify(fits.b).slice(0, 200));
    expect((await heldBy(S, o.chit)).net === 1e12, 'net ' + JSON.stringify(await heldBy(S, o.chit)));
  });

  await kase('F-1', 'deliver 12 of 10, a -15 is refused (12 - 15 = -3), -12 nets 0, a further -1 is refused', async () => {
    const o = await order('f1');
    expect((await deliver(S, o, [row(o.sLine, 12)])).status === 200, 'deliver 12');
    expect((await heldBy(S, o.chit)).net === 12, 'net 12');
    await refused(S, o, [row(o.sLine, -15)], 409, 'CHIT_CONFLICT', 1);
    expect((await heldBy(S, o.chit)).net === 12, 'net after the refused -15 must stay 12, not -3: ' + JSON.stringify(await heldBy(S, o.chit)));
    expect((await deliver(S, o, [row(o.sLine, -12)])).status === 200, 'correct by exactly 12');
    expect((await heldBy(S, o.chit)).net === 0, 'net 0');
    await refused(S, o, [row(o.sLine, -1)], 409, 'CHIT_CONFLICT', 2);
    expect((await heldBy(S, o.chit)).net === 0, 'net stays 0');
  });

  await kase('F-2', 'deliver 1 then -3: refused, net stays 1 (it read -2)', async () => {
    const o = await order('f2');
    expect((await deliver(S, o, [row(o.sLine, 1)])).status === 200, 'deliver 1');
    const r = await refused(S, o, [row(o.sLine, -3)], 409, 'CHIT_CONFLICT', 1);
    expect(String(r.b.message).includes('only 1 kg delivered'), 'the sentence names what was delivered: ' + r.b.message);
    expect((await heldBy(S, o.chit)).net === 1, 'net ' + JSON.stringify(await heldBy(S, o.chit)));
  });

  await kase('F-3', 'one request of +5 then -8 is judged as stored (refused, nothing written); +5 then -5 nets 0', async () => {
    const o = await order('f3');
    await refused(S, o, [row(o.sLine, 5), row(o.sLine, -8)], 409, 'CHIT_CONFLICT', 0);
    const both = await deliver(S, o, [row(o.sLine, 5), row(o.sLine, -5)]);
    expect(both.status === 200, 'HTTP ' + both.status + ' ' + JSON.stringify(both.b).slice(0, 200));
    const held = await heldBy(S, o.chit);
    expect(held.net === 0 && held.n === 2, 'net ' + JSON.stringify(held));
  });

  await kase('F-4', 'the floor is per unit, and a replayed correction is a replay, not a refusal', async () => {
    const o = await order('f4');
    expect((await deliver(S, o, [row(o.sLine, 12)])).status === 200, 'deliver 12 kg');
    await refused(S, o, [row(o.sLine, -2, { unit: 'piece' })], 409, 'CHIT_CONFLICT', 1);
    expect((await deliver(S, o, [row(o.sLine, 5, { client_ref: 'a' + RUN })])).status === 200, 'deliver 5 more');
    const fix = row(o.sLine, -5, { client_ref: 'z' + RUN });
    expect((await deliver(S, o, [fix])).status === 200, 'the correction of -5 (17 → 12)');
    const again = await deliver(S, o, [fix]);
    expect(again.status === 200 && again.b.replayed === true, 'the replay: HTTP ' + again.status + ' ' + JSON.stringify(again.b).slice(0, 200));
    const held = await heldBy(S, o.chit);
    expect(held.net === 12 && held.n === 3, 'net ' + JSON.stringify(held));
  });

  await kase('W-1', 'R rejects, R delivers: 409 wrong_step, no row; back to accepted, the delivery records', async () => {
    const o = await order('w1');
    expect((await j('/api/chits/' + o.chit + '/status', { method: 'PUT', token: R.token, body: { status: 'rejected', note: 'not our line' } })).status === 200, 'R rejects');
    const r = await refused(R, o, [row(o.rLine, 5)], 409, 'CHIT_CONFLICT', 0);
    expect(r.b.why === 'wrong_step' && /rejected/.test(r.b.message), 'the word and the sentence: ' + JSON.stringify(r.b).slice(0, 300));
    expect(/received:rejected/.test(await statusOf(R, o.chit)), 'status ' + await statusOf(R, o.chit));
    expect((await j('/api/chits/' + o.chit + '/status', { method: 'PUT', token: R.token, body: { status: 'accepted' } })).status === 200, 'R reopens');
    expect((await deliver(R, o, [row(o.rLine, 5)])).status === 200, 'the delivery after reopening');
    expect((await heldBy(R, o.chit)).net === 5, 'net 5');
  });

  await kase('W-2', 'S withdraws, S delivers: 409, no row; R, whose copy was only asked, still delivers', async () => {
    const o = await order('w2');
    expect((await j('/api/chits/' + o.chit + '/void', { method: 'PUT', token: S.token, body: { reason: 'W-2 withdrawn' } })).status === 200, 'S withdraws');
    expect(/sent:cancelled/.test(await statusOf(S, o.chit)), 'S status ' + await statusOf(S, o.chit));
    const r = await refused(S, o, [row(o.sLine, 5)], 409, 'CHIT_CONFLICT', 0);
    expect(r.b.why === 'wrong_step' && /cancelled/.test(r.b.message), 'the word and the sentence: ' + JSON.stringify(r.b).slice(0, 300));
    expect((await deliver(R, o, [row(o.rLine, 5)])).status === 200, 'R delivers on its own live copy');
  });

  finish('rail-191-deliver-lines');
})().catch((e) => { console.error(e); process.exit(1); });
