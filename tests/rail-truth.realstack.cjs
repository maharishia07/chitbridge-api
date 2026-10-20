'use strict';
/**
 * tests/rail-truth.realstack.cjs — RAIL TRUTH, on the LOCAL stack (K-TRUTH-1 2026-10-19; the case list is PM/BOX-TRUTH-TESTS.md §4 "Chits / rail").
 *
 * The rail's decided truths, driven through the api's own routes on FRESH shops made for this run: freeze at send · one status
 * writer (moveStatus) · both parties hold their own copy · an attachment's audience is only the server's · a test entity never
 * trades with a production one. Cases RL-07..RL-10 and RL-14 are the box's five uncovered rows; RL-19/50/51 are TB-RAIL-6.
 * A case whose expected result is the PRINCIPLE (not today's code) carries `gap:` — a FAIL there is a RECORDED finding
 * (RAIL-BACKLOG, "K-TRUTH-1 2026-10-19"), never fixed inside this file. RL-11 (two real installations) stays with ctp-conformance.
 *
 * Shares tests/lib/truth-harness.cjs with stock-truth (one harness). Run: node tests/rail-truth.realstack.cjs   (one at a time on :3100)
 * ⚠️ RL-19 ARMS one precondition in the LOCAL database (a second shop's population set to 'live'); everything else only SELECTs.
 * CARD 01-rail-core-the-chit/README
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, results, j, ok, pause, kase, expect, near, receipt, bill, creditNote, freshShop, finish } = H;
const RUN = 'rl' + (Date.now() % 1e10).toString(36);
let pg = null;

async function shopWithStock(tag, label) {
  const shop = await freshShop(tag, label);
  for (const [key, name, price] of [['A', 'Rice', 60], ['B', 'Dal', 40], ['C', 'Oil', 30], ['D', 'Salt', 20], ['E', 'Tea', 50], ['F', 'Soap', 25]]) {
    const r = ok(await j('/api/products', { method: 'POST', token: shop.token, body: { item_data: { name, unit: 'piece', price } } }), 'product ' + name).b;
    shop.products[key] = { id: r.item.item_id, name, unit: 'piece', price };
  }
  return shop;
}
const sendAs = async (shop, body, what) => ok(await j('/api/chits/send', { method: 'POST', token: shop.token, body }), what).b;
const movesOf = async (shop, item) => (await pg.query(`SELECT reason, qty::float AS qty, ref, at FROM stock_movement WHERE entity_id = $1 AND item_id = $2 ORDER BY at, movement_id`, [shop.entity, item])).rows;
const onHand = async (shop, item) => { const b = ok(await j('/api/till/stock?detail=1', { token: shop.token }), 'stock').b.balances[item]; return b ? b.qty : null; };
async function settle(shop, item, n, ms = 4000) { const end = Date.now() + ms; for (;;) { const m = await movesOf(shop, item); if (m.length >= n || Date.now() > end) return m; await pause(150); } }
/** the status of MY copy, as the api reads it (chit_header has no status column: the rail's words live behind the one reader) */
const chitRead = async (shop, chit) => { const b = ok(await j('/api/chits/' + chit, { token: shop.token }), 'chit read').b; return b.chit || b; };
const statusOf = async (shop, chit) => { const c = await chitRead(shop, chit); const log = Array.isArray(c.state_log) ? c.state_log : []; const last = log[log.length - 1]; return c.status || (last && (last.to || last.status || last.state)) || JSON.stringify(last || c.state_log || null); };

async function ledgerCases(A) {
  const { A: p1, B: p2, C: p3, D: p4, E: p5, F: p6 } = A.products;
  await kase('RL-07', 'voiding a sent bill: status voided, stock reversed exactly once (a second void adds nothing)', async () => {
    await sendAs(A, receipt(RUN + '-G7', [[p1, 10, 40]]), 'receipt'); await settle(A, p1.id, 1);
    const id = (await sendAs(A, bill(RUN + '-B7', [[p1, 4]]), 'bill')).chit_id; await settle(A, p1.id, 2);
    ok(await j('/api/chits/' + id + '/void', { method: 'PUT', token: A.token, body: { reason: 'rail truth: wrong bill' } }), 'void');
    await pause(1000);
    const again = await j('/api/chits/' + id + '/void', { method: 'PUT', token: A.token, body: { reason: 'rail truth: twice' } });
    await pause(800);
    const m = await movesOf(A, p1.id), st = await statusOf(A, id);
    expect(/void/i.test(String(st)), 'status ' + st);
    expect(m.length === 3 && near(await onHand(A, p1.id), 10), 'movements ' + m.map((x) => x.reason + ' ' + x.qty).join(', ') + ' · on hand ' + await onHand(A, p1.id) + ' · second void HTTP ' + again.status);
  }, 'void never reaches the stock writer (ST-16)');
  await kase('RL-08', 'amending a sent bill line 3 → 1: accepted as a new version, stock adjusts once', async () => {
    await sendAs(A, receipt(RUN + '-G8', [[p6, 10, 10]]), 'receipt'); await settle(A, p6.id, 1);
    const id = (await sendAs(A, bill(RUN + '-B8', [[p6, 3]]), 'bill')).chit_id; await settle(A, p6.id, 2);
    const a = await j('/api/chits/' + id + '/amend', { method: 'POST', token: A.token, body: { edits: [{ line_index: 0, line: { particulars: p6.name, quantity: 1, unit: 'piece' }, reason_code: 'other', note: 'rail truth' }] } });
    await pause(1000);
    const h = await onHand(A, p6.id);
    expect(a.status < 300 && near(h, 9), 'amend HTTP ' + a.status + ', on hand ' + h + ' (expected 9)');
  }, 'an amendment never reaches the stock writer (ST-18)');
  await kase('RL-09', 'an offline bill synced 3 h late is dated billed_at (within a minute), not the arrival time', async () => {
    await sendAs(A, receipt(RUN + '-G9', [[p4, 5, 10]], new Date(Date.now() - 6 * 3600e3).toISOString()), 'receipt'); await settle(A, p4.id, 1);
    const billedAt = new Date(Date.now() - 3 * 3600e3).toISOString();
    await sendAs(A, bill(RUN + '-B9', [[p4, 1]], billedAt), 'late bill');
    const sale = (await settle(A, p4.id, 2)).find((x) => x.reason === 'sale');
    const gapMin = sale ? Math.round((new Date(sale.at) - new Date(billedAt)) / 60000) : 'no sale movement';
    expect(sale && Math.abs(gapMin) <= 1, 'movement ' + (sale && new Date(sale.at).toISOString()) + ' vs billed ' + billedAt + ' (' + gapMin + ' min). Books dating is the accounts box (AC-04)');
  }, 'sendStock dates the movement at arrival, not billed_at (ST-14)');
  await kase('RL-10', 'a credit note for more than the bill sold is refused (3 sold, 2 back, 5 more)', async () => {
    await sendAs(A, receipt(RUN + '-G10', [[p2, 10, 20]]), 'receipt'); await settle(A, p2.id, 1);
    await sendAs(A, bill(RUN + '-B10', [[p2, 3]]), 'bill'); await settle(A, p2.id, 2);
    await sendAs(A, creditNote(RUN + '-C10a', RUN + '-B10', [[p2, 2]]), 'first credit note'); await pause(800);
    const r = await j('/api/chits/send', { method: 'POST', token: A.token, body: creditNote(RUN + '-C10b', RUN + '-B10', [[p2, 5]]) });
    await pause(800);
    expect(r.status >= 400 || near(await onHand(A, p2.id), 9), 'HTTP ' + r.status + ', on hand ' + await onHand(A, p2.id) + ' (expected refusal, or held at 9)');
  }, 'no check of a return against what the bill sold (ST-07)');
  await kase('RL-14', 'a line with no product of mine: the send answer names the skipped line, with a code', async () => {
    const r = await sendAs(A, { ...receipt(RUN + '-G14', [[p3, 1, 40]]), line_items: [{ particulars: 'Loose provisions', quantity: 4, unit: 'kg', price: 50, total: 200 }] }, 'free-text receipt');
    const named = r.stock_skipped || (r.stock && r.stock.skipped);
    expect(named && JSON.stringify(named).length > 2 && /code/.test(JSON.stringify(named)), 'send answered keys ' + JSON.stringify(Object.keys(r)) + ' (no skipped-line list with a code)');
  }, 'skips are logged on the server only (ST-20)');
  void p5;
}

async function crossWorldCase(A) {
  /* RAIL-19: b247 is a TRIGGER on chit_header, so only a real database proves it. The PRECONDITION is armed in the LOCAL db: a second shop moved to
     the OTHER world (every local sign-up is 'live', so the arm is population = 'test'; is_test is GENERATED, b249). Control first: a same-world send must go through. */
  await kase('RL-19', 'b247 on a real database: a shop cannot send into another world (test ↔ production) (409 in words, no copy lands); same-world still works', async () => {
    const same = await freshShop(RUN + 's', 'Same world');
    const other = await freshShop(RUN + 'l', 'Other world');
    const to = (s) => [{ display_name: s.name, bridge_id: s.bridge, kind: 'to' }];
    const mk = (s, no) => ({ recipients: to(s), purpose: 'general', subject: 'World check ' + no, manual_subject: 'World check ' + no, client_ref: RUN + no, line_items: [] });
    const control = await j('/api/chits/send', { method: 'POST', token: A.token, body: mk(same, '-w1') });
    expect(control.status < 300, 'same-world control refused: HTTP ' + control.status + ' ' + JSON.stringify(control.b).slice(0, 160));
    const armed = await pg.query(`UPDATE identities SET population = 'test' WHERE identity_id = $1 RETURNING population, is_test`, [other.entity]);
    const mine = await pg.query(`SELECT is_test FROM identities WHERE identity_id = $1`, [A.entity]);
    expect(armed.rows.length === 1 && armed.rows[0].is_test !== mine.rows[0].is_test, 'could not put the second shop in another world: ' + JSON.stringify([armed.rows, mine.rows]));
    const cross = await j('/api/chits/send', { method: 'POST', token: A.token, body: mk(other, '-w2') });
    const landed = await pg.query(`SELECT count(*)::int AS n FROM chit_header WHERE entity_id = $1 AND sender_entity_id = $2`, [other.entity, A.entity]);
    expect(cross.status === 409, 'cross-world send answered HTTP ' + cross.status + ' ' + JSON.stringify(cross.b).slice(0, 200));
    expect(/test|production|live/i.test(JSON.stringify(cross.b)), 'refusal carries no sentence: ' + JSON.stringify(cross.b).slice(0, 160));
    expect(landed.rows[0].n === 0, landed.rows[0].n + ' copies landed in the other-world shop');
    return 'control ' + control.status + ' · cross ' + cross.status;
  });
}

async function attachmentCases(A) {
  /* RAIL-50 + RAIL-51 (the server half): A and B share a chit, C is an outsider. */
  const B = await freshShop(RUN + 'b', 'Party B'), C = await freshShop(RUN + 'c', 'Outsider C');
  const chit = (await sendAs(A, { recipients: [{ display_name: B.name, bridge_id: B.bridge, kind: 'to' }], purpose: 'general', subject: 'Attach truth ' + RUN, manual_subject: 'Attach truth ' + RUN, client_ref: RUN + '-at', line_items: [] }, 'chit A→B')).chit_id;
  await pause(1200);
  const bytes = Buffer.from('rail truth bytes ' + RUN), b64 = bytes.toString('base64');
  let up = null;
  const copies = async () => (await pg.query(`SELECT entity_id FROM cb_attachment WHERE chit_id = $1 AND name = $2`, [chit, 'truth.txt'])).rows.map((r) => r.entity_id);
  const read = async (shop) => { const r = ok(await j('/api/chits/' + chit, { token: shop.token }), 'chit read').b; return r.attachments || (r.chit && r.chit.attachments) || []; };

  await kase('RL-51', 'attach round-trips on the server: upload → listed on the sender\'s own copy → opens with the same bytes', async () => {
    up = ok(await j('/api/attachments', { method: 'POST', token: A.token, body: { chit_id: chit, name: 'truth.txt', mime: 'text/plain', data_base64: b64 } }), 'upload').b;
    const listed = (await read(A)).find((a) => String(a.id) === String(up.id));
    expect(listed, 'upload ' + up.id + ' is not on the chit read: ' + JSON.stringify((await read(A)).map((a) => a.id)));
    const got = await fetch(H.API + '/api/attachments/' + up.id, { headers: { authorization: 'Bearer ' + A.token } });
    const body = Buffer.from(await got.arrayBuffer());
    expect(got.status === 200 && body.equals(bytes), 'open HTTP ' + got.status + ', ' + body.length + ' bytes back of ' + bytes.length);
  });
  await kase('RL-50a', 'the audience is the chit\'s own participants: one copy each for A and B, none for an outsider; bytes only to the holder', async () => {
    const holders = await copies();
    expect(holders.length === 2 && holders.includes(A.entity) && holders.includes(B.entity) && !holders.includes(C.entity), 'copies held by ' + JSON.stringify(holders));
    const asC = await j('/api/attachments/' + up.id, { token: C.token }), asB = await j('/api/attachments/' + up.id, { token: B.token });
    expect(asC.status === 404 || asC.status === 403, 'outsider read A\'s copy: HTTP ' + asC.status);
    expect(asB.status === 404 || asB.status === 403, 'B read A\'s copy by id (shared read): HTTP ' + asB.status + ' — B must open ITS OWN copy');
    expect((await read(B)).some((a) => a.name === 'truth.txt'), 'B\'s own chit read does not list its copy');
  }, 'getBlob relies on RLS alone and the local api runs as postgres, which bypasses it (RAIL-80); the query has no entity_id predicate of its own');
  await kase('RL-50b', 'no widening move: an outsider cannot attach to the chit, and an audience named in the body is ignored', async () => {
    const asC = await j('/api/attachments', { method: 'POST', token: C.token, body: { chit_id: chit, name: 'intruder.txt', mime: 'text/plain', data_base64: b64 } });
    expect(asC.status === 403, 'outsider upload answered HTTP ' + asC.status);
    ok(await j('/api/attachments', { method: 'POST', token: A.token, body: { chit_id: chit, name: 'widen.txt', mime: 'text/plain', data_base64: b64, participants: [C.entity], audience: [C.entity], entity_ids: [C.entity] } }), 'upload with audience');
    const rows = (await pg.query(`SELECT entity_id FROM cb_attachment WHERE chit_id = $1 AND name = 'widen.txt'`, [chit])).rows.map((r) => r.entity_id);
    expect(!rows.includes(C.entity) && rows.length === 2, 'copies for widen.txt held by ' + JSON.stringify(rows));
  });
  await kase('RL-50c', 'an empty file and an oversize file are refused by the door', async () => {
    const empty = await j('/api/attachments', { method: 'POST', token: A.token, body: { chit_id: chit, name: 'empty.txt', mime: 'text/plain', data_base64: '' } });
    const big = await j('/api/attachments', { method: 'POST', token: A.token, body: { chit_id: chit, name: 'big.bin', mime: 'application/octet-stream', data_base64: Buffer.alloc(6 * 1024 * 1024 + 1).toString('base64') } });
    expect(empty.status === 400 && big.status === 413, 'empty HTTP ' + empty.status + ' · oversize HTTP ' + big.status);
  });
}

(async () => {
  console.log('\n── rail truth on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  pg = new Client({ connectionString: DB }); await pg.connect();
  try {
    const A = await shopWithStock(RUN + 'a', 'Rail truth');
    console.log('  shop ' + A.bridge + ' · entity ' + A.entity);
    await ledgerCases(A);
    await crossWorldCase(A);
    await attachmentCases(A);
  } finally { await pg.end(); }
  finish('rail-truth', process.env.RAIL_TRUTH_JSON, { run: RUN });
})().catch((e) => { console.error('rail truth could not run:', e && e.message); process.exit(2); });
