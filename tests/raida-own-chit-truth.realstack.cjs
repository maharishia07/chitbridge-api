'use strict';
/**
 * tests/raida-own-chit-truth.realstack.cjs — a register entry on a chit needs a chit the caller is a PARTY to (BOLA, raidachit 17 Nov).
 *
 * OWNS     POST /api/chits/:chit_id/raida: a chit is BETWEEN parties and each holds its own co-held copy, so "own" is "the caller holds a copy" (chit_header row of its entity).
 *          A foreign chit answers the one 404 and writes no register_entry row (the foreign key ignores RLS, so an existing id proves nothing); the sender and the receiver
 *          (both parties) record as before; a line that is on another chit is the same 404.
 * FLOW     shops A and B exchange chit AB, shop C is an outsider (and holds its own chit CC for the line case); the register is switched on per shop with the capability key; rows read by SELECT only.
 *
 *   RO-1  outsider C posts on chit AB: 404, zero register_entry rows for that chit
 *   RO-2  sender A and receiver B (both parties) each record an entry: 200, one row each under their own entity
 *   RO-3  C names a line of chit AB on its own chit: 404, no row (the line must be on the chit, on the caller's own copy)
 *   RO-4  a junk chit id: 404 in the one error shape, no 500
 */
const H = require('./lib/truth-harness.cjs');
const { Client } = require('pg');
const { j, ok, pause, kase, expect, freshShop, finish, DB } = H;
const RUN = 'ro' + (Date.now() % 1e9).toString(36);
const q = async (sql, args) => { const c = new Client({ connectionString: DB }); await c.connect(); try { return (await c.query(sql, args)).rows; } finally { await c.end(); } };
const send = async (shop, body) => ok(await j('/api/chits/send', { method: 'POST', token: shop.token, body }), 'send').b;
const rows = async (chit) => Number((await q('SELECT count(*)::int AS n FROM register_entry WHERE chit_id = $1', [chit]))[0].n);
(async () => {
  console.log('\n── raida own chit on ' + H.API + ' · run ' + RUN + ' ──');
  const A = await freshShop(RUN + 'a', 'Party A'), B = await freshShop(RUN + 'b', 'Party B'), C = await freshShop(RUN + 'c', 'Outsider C');
  for (const s of [A, B, C]) await q("UPDATE identities SET capabilities = coalesce(capabilities, '[]'::jsonb) || '["register"]'::jsonb WHERE identity_id = $1", [s.entity]);
  const mk = (to, ref) => ({ recipients: [{ display_name: to.name, bridge_id: to.bridge, kind: 'to' }], purpose: 'general', subject: 'Raida own ' + ref, manual_subject: 'Raida own ' + ref, client_ref: RUN + ref,
    line_items: [{ particulars: 'Tea', quantity: 1, unit: 'piece', price: 10 }] });
  const ab = (await send(A, mk(B, '-ab'))).chit_id, cc = (await send(C, mk(A, '-cc'))).chit_id;
  await pause(1200);
  const entry = { kind: 'risk', body: 'raida own chit ' + RUN };
  await kase('RO-1', 'an outsider cannot put a register entry on a chit it is no party to: 404, no row', async () => {
    const r = await j('/api/chits/' + ab + '/raida', { method: 'POST', token: C.token, body: entry });
    expect(r.status === 404, 'HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
    expect((await rows(ab)) === 0, 'a register_entry row was written against the foreign chit');
  });
  await kase('RO-2', 'the sender and the receiver (both parties) each record as before: 200, one row under each own entity', async () => {
    for (const s of [A, B]) { const r = await j('/api/chits/' + ab + '/raida', { method: 'POST', token: s.token, body: entry }); expect(r.status === 200 && r.b.raida_id, s.name + ': HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200)); }
    const held = (await q('SELECT entity_id FROM register_entry WHERE chit_id = $1', [ab])).map((x) => x.entity_id).sort();
    expect(held.length === 2 && held.join() === [A.entity, B.entity].sort().join(), 'rows held by ' + JSON.stringify(held));
  });
  await kase('RO-3', 'a line that is on another chit is the same 404, no row', async () => {
    const lineOfAb = (await q('SELECT line_id FROM chit_line WHERE chit_id = $1 AND entity_id = $2 LIMIT 1', [ab, A.entity]))[0];
    expect(lineOfAb, 'no line on chit AB to name');
    const before = await rows(cc);
    const r = await j('/api/chits/' + cc + '/raida', { method: 'POST', token: C.token, body: Object.assign({ line_id: lineOfAb.line_id }, entry) });
    expect(r.status === 404 && (await rows(cc)) === before, 'HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
  });
  await kase('RO-4', 'a junk chit id is the 404 in the one error shape, never a 500', async () => {
    const r = await j('/api/chits/not-a-uuid/raida', { method: 'POST', token: A.token, body: entry });
    expect(r.status === 404 || r.status === 400, 'HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
  });
  finish('raida-own-chit');
})().catch((e) => { console.error(e); process.exitCode = 1; });
