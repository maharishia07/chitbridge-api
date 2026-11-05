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
 * BOX-TRUTH 24 Oct (RL-01..RL-14): the rows the file lacked are added as partyCases (RL-01 · RL-01s · RL-02r · RL-03 · RL-04 · RL-04b · RL-05 ·
 * RL-06 · RL-12). Left off on purpose: RL-02 (a code scan: rail-status.test.cjs), RL-11 (two installations: ctp-conformance), RL-13 (the books' own close
 * after a posting: stuck-close.test.cjs; a ledger setup is not provable offline), RL-05's viewer half (an actor sign-in: rail-actions.test.cjs).
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

/* ═══ THE PARTY CASES (BOX-TRUTH 24 Oct): two and four shops exchange chits, the database is only READ ═══ */
const LINE_ONE = { particulars: 'Rail truth item one', quantity: 3, unit: 'piece', price: 12.34, total: 37.02 };
const LINE_TWO = { particulars: 'Rail truth item two', quantity: 3, unit: 'piece', price: 0.1, total: 0.3 };
const LINES_SENT = [LINE_ONE, LINE_TWO];
const LINE_SWAPPED = [{ particulars: 'Rail truth swapped', quantity: 99, unit: 'piece', price: 1, total: 99 }];
const DISPUTE_REASON = 'two boxes were short on delivery';
const NOT_A_HOLDER = [403, 404];

const toOf = (shops) => shops.map((s) => ({ display_name: s.name, bridge_id: s.bridge, kind: 'to' }));
/** a general chit from one shop to others, carrying priced lines; client_ref is the sender's replay key */
const generalBody = (ref, shops, lines) => ({ recipients: toOf(shops), purpose: 'general', subject: 'Rail truth ' + ref, manual_subject: 'Rail truth ' + ref, client_ref: ref, business_json: {}, line_items: lines });
const sendLines = async (from, shops, ref, lines) => (await sendAs(from, generalBody(ref, shops, lines || LINES_SENT), 'chit ' + ref)).chit_id;
/** the lines of MY copy, as the api reads them: [particulars, quantity, price, total] */
const linesOf = async (shop, chit) => {
  const d = (await chitRead(shop, chit)).detail || {};
  return (Array.isArray(d.line_items) ? d.line_items : []).map((l) => [l.particulars, Number(l.quantity), Number(l.price), Number(l.total)]);
};
const minorOf = (rows) => rows.reduce((a, r) => a + Math.round(r[3] * 100), 0);
const statusIn = async (shop, chit) => (await pg.query('SELECT current_status FROM chit_status WHERE chit_id = $1 AND entity_id = $2', [chit, shop.entity])).rows.map((r) => r.current_status);
const actionsOf = async (shop, chit) => (await chitRead(shop, chit)).actions || {};
const putStatus = (shop, chit, status) => j('/api/chits/' + chit + '/status', { method: 'PUT', token: shop.token, body: { status } });
const countOf = async (sql, args) => (await pg.query(sql, args)).rows[0].n;
const is4xx = (r) => r.status >= 400 && r.status < 500;

/** RL-01 the frozen chit · RL-01s the seal · RL-06 the replay: what a send leaves behind and what cannot change it */
async function freezeCases(A, B) {
  await kase('RL-01', 'a sent chit is frozen: a direct edit is refused (4xx), a delete is refused with its word, a resend does not replace the lines', async () => {
    const ref = RUN + '-fz', id = await sendLines(A, [B], ref);
    const put = await j('/api/chits/' + id, { method: 'PUT', token: A.token, body: { line_items: LINE_SWAPPED } });
    const patch = await j('/api/chits/' + id, { method: 'PATCH', token: A.token, body: { line_items: LINE_SWAPPED } });
    const del = await j('/api/chits/' + id, { method: 'DELETE', token: A.token });
    const again = await j('/api/chits/send', { method: 'POST', token: A.token, body: generalBody(ref, [B], LINE_SWAPPED) });
    expect(is4xx(put) && is4xx(patch), 'edit answered PUT ' + put.status + ' · PATCH ' + patch.status);
    expect(del.status === 409 && del.b.why === 'co_held_record', 'delete of a sent chit: HTTP ' + del.status + ' ' + JSON.stringify(del.b).slice(0, 160));
    expect(again.status < 300 && again.b.duplicate === true && again.b.chit_id === id, 'resend: HTTP ' + again.status + ' ' + JSON.stringify(again.b).slice(0, 160));
    const [mine, theirs] = [await linesOf(A, id), await linesOf(B, id)];
    expect(mine.length === 2 && JSON.stringify(mine) === JSON.stringify(theirs) && mine[0][1] === 3, 'lines after the attempts: A ' + JSON.stringify(mine) + ' · B ' + JSON.stringify(theirs));
  });
  await kase('RL-01s', 'the sent header carries a seal (a hash of what was sent) on the table that holds it', async () => {
    const cols = (await pg.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'chit_header' AND column_name IN ('chit_hash', 'seal_hash', 'header_hash', 'sealed_at')")).rows;
    expect(cols.length > 0, 'chit_header has no seal column (only the retired cb_chit had chit_hash)');
  }, 'RAIL-69 (TB-RAIL-4): the live chit_header has no seal or hash; freeze today is schema_version; the migration is Athi-run SQL');
  await kase('RL-06', 'the same client_ref sent twice is one chit: the second answer names the first; one sender row, one copy for B', async () => {
    const ref = RUN + '-rp', first = (await sendAs(A, generalBody(ref, [B], LINES_SENT), 'first send')).chit_id;
    const second = await j('/api/chits/send', { method: 'POST', token: A.token, body: generalBody(ref, [B], LINES_SENT) });
    const mine = await countOf("SELECT count(*)::int AS n FROM chit_header WHERE entity_id = $1 AND business_json->>'client_ref' = $2", [A.entity, ref]);
    const held = await countOf('SELECT count(*)::int AS n FROM chit_header WHERE entity_id = $1 AND chit_id = $2', [B.entity, first]);
    expect(second.status < 300 && second.b.duplicate === true && second.b.chit_id === first, 'second send: HTTP ' + second.status + ' ' + JSON.stringify(second.b).slice(0, 160));
    expect(mine === 1 && held === 1, 'copies: sender rows ' + mine + ' · B rows of this chit ' + held);
  });
}

/** RL-03 equal copies · RL-05 may = door · RL-02r the status door moves one copy */
async function copyCases(A, B) {
  await kase('RL-03', 'B reads its copy and it equals A\'s to the paisa: the lines, their sum in minor units, the header total', async () => {
    const id = await sendLines(A, [B], RUN + '-eq');
    const [a, b] = [await linesOf(A, id), await linesOf(B, id)];
    const [ha, hb] = [(await chitRead(A, id)).header || {}, (await chitRead(B, id)).header || {}];
    expect(a.length === 2 && JSON.stringify(a) === JSON.stringify(b), 'lines differ: A ' + JSON.stringify(a) + ' · B ' + JSON.stringify(b));
    expect(minorOf(a) === minorOf(b), 'sum in minor units A ' + minorOf(a) + ' · B ' + minorOf(b));
    expect(String(ha.total_value) === String(hb.total_value), 'header total A ' + ha.total_value + ' · B ' + hb.total_value);
    return 'sum ' + minorOf(a) + ' minor · header ' + ha.total_value;
  });
  await kase('RL-05', 'may and the door agree: the sender may not accept its own chit (not_received, 404 with that word); the receiver may; a step the table lacks is refused wrong_step', async () => {
    const id = await sendLines(A, [B], RUN + '-mv');
    const mayA = (await actionsOf(A, id)).accept || {}, mayB = (await actionsOf(B, id)).accept || {};
    const doorA = await putStatus(A, id, 'accepted'), skip = await putStatus(B, id, 'partial'), doorB = await putStatus(B, id, 'accepted');
    expect(mayA.ok === false && mayA.why === 'not_received' && doorA.status === 404 && doorA.b.why === mayA.why, 'sender: may ' + JSON.stringify(mayA) + ' · door HTTP ' + doorA.status + ' ' + JSON.stringify(doorA.b).slice(0, 120));
    expect(mayB.ok === true && doorB.status < 300, 'receiver: may ' + JSON.stringify(mayB) + ' · door HTTP ' + doorB.status);
    expect(skip.status === 400 && skip.b.why === 'wrong_step' && Array.isArray(skip.b.allowed_transitions) && !skip.b.allowed_transitions.includes('partial'), 'pending to partial: HTTP ' + skip.status + ' ' + JSON.stringify(skip.b).slice(0, 160));
  });
  await kase('RL-02r', 'a status change moves ONLY the copy of the shop that asked, through the status door; the other party\'s copy is untouched', async () => {
    const id = await sendLines(A, [B], RUN + '-st'), before = await statusIn(A, id);
    ok(await putStatus(B, id, 'accepted'), 'accept');
    ok(await putStatus(B, id, 'completed'), 'complete');
    const [mineB, mineA] = [await statusIn(B, id), await statusIn(A, id)];
    expect(JSON.stringify(mineB) === '["completed"]', 'B copy ' + JSON.stringify(mineB));
    expect(JSON.stringify(mineA) === JSON.stringify(before), 'A copy moved: before ' + JSON.stringify(before) + ' · after ' + JSON.stringify(mineA));
  });
}

/** RL-04 the roster holds the dispute · RL-04b a non-roster participant reads nothing (RLS-only reads: a recorded gap on the local postgres role) */
async function disputeCases(A, B, C, D) {
  const mark = 'RLTRUTH' + RUN, reason = mark + ' ' + DISPUTE_REASON;
  const id = await sendLines(A, [B, C], RUN + '-dp');
  const raised = await j('/api/chits/' + id + '/disputes', { method: 'POST', token: A.token, body: { category: 'quantity', reason, target_entity_id: B.entity } });
  const dispute = raised.b.dispute_id;
  const say = await j('/api/chits/' + id + '/messages', { method: 'POST', token: A.token, body: { message_text: mark + ' dispute thread', thread_type: 'external', is_dispute: true, dispute_id: dispute } });
  const holders = async (sql) => JSON.stringify((await pg.query(sql, [id, mark + '%'])).rows.map((r) => r.entity_id).sort());
  const roster = JSON.stringify([A.entity, B.entity].sort());
  await kase('RL-04', 'a dispute raised at B is held only by A and B: no copy, no message, no timeline row for C, and the outsider is refused at every door', async () => {
    expect(raised.status < 300 && dispute && say.status < 300, 'raise HTTP ' + raised.status + ' ' + JSON.stringify(raised.b).slice(0, 160) + ' · message HTTP ' + say.status);
    const copies = await holders('SELECT entity_id FROM chit_disputes WHERE chit_id = $1 AND reason LIKE $2');
    const msgs = await holders('SELECT entity_id FROM chit_messages WHERE chit_id = $1 AND is_dispute AND message_text LIKE $2');
    expect(copies === roster && msgs === roster, 'dispute copies held by ' + copies + ' · message copies by ' + msgs + ' · roster ' + roster);
    const logged = await countOf('SELECT count(*)::int AS n FROM state_log WHERE chit_id = $1 AND entity_id = $2 AND detail LIKE $3', [id, C.entity, '%' + mark + '%']);
    expect(logged === 0, logged + ' timeline rows about the dispute reached C');
    const asD = [await j('/api/chits/' + id + '/disputes', { token: D.token }), await j('/api/chits/' + id + '/disputes', { method: 'POST', token: D.token, body: { category: 'other', reason: DISPUTE_REASON } }), await j('/api/chits/' + id + '/messages', { method: 'POST', token: D.token, body: { message_text: 'intruder', thread_type: 'external', is_dispute: true, dispute_id: dispute } })];
    expect(asD.every((r) => NOT_A_HOLDER.includes(r.status)), 'outsider answered ' + asD.map((r) => r.status).join(' · '));
    const asC = await j('/api/chits/' + id + '/disputes/' + dispute + '/resolve', { method: 'PUT', token: C.token, body: { resolution_note: 'rail truth: not mine to resolve' } });
    const mineOpen = (await pg.query('SELECT status FROM chit_disputes WHERE dispute_id = $1 AND entity_id = $2', [dispute, A.entity])).rows[0];
    expect(is4xx(asC) && mineOpen && mineOpen.status === 'open', 'C resolve HTTP ' + asC.status + ' · A copy ' + JSON.stringify(mineOpen));
  });
  await kase('RL-04b', 'C, a participant of the chit but not of the dispute, READS nothing of it: list, queue and thread are empty', async () => {
    const list = ok(await j('/api/chits/' + id + '/disputes', { token: C.token }), 'C disputes').b;
    const queue = ok(await j('/api/chits/disputes/queue?status=all', { token: C.token }), 'C queue').b;
    const thread = ok(await j('/api/chits/' + id + '/messages', { token: C.token }), 'C thread').b;
    const seen = JSON.stringify([list.disputes, queue, thread.messages]);
    expect(!seen.includes(mark) && !seen.includes(dispute) && (list.disputes || []).length === 0, 'C read: ' + (list.disputes || []).length + ' disputes · ' + seen.slice(0, 160));
    const asB = ok(await j('/api/chits/' + id + '/disputes', { token: B.token }), 'B disputes').b;
    expect((asB.disputes || []).some((x) => x.dispute_id === dispute), 'B (on the roster) does not see its own dispute');
  }, 'RAIL-80/88: these three reads rely on RLS alone (no entity_id predicate of their own) and the local api connects as postgres, which bypasses it');
  await kase('RL-04c', 'RAIL-162: a CHIT-WIDE dispute that names nobody is held by every holder of the chit: the sender sees it, answers inside it, and sees it resolved', async () => {
    const wid = await sendLines(A, [B], RUN + '-dw'), wmark = 'RLWIDE' + RUN;
    const wr = await j('/api/chits/' + wid + '/disputes', { method: 'POST', token: B.token, body: { category: 'payment', reason: wmark + ' ' + DISPUTE_REASON, chit_wide: true } });
    const wd = wr.b.dispute_id;
    expect(wr.status < 300 && wd, 'recipient raise HTTP ' + wr.status + ' ' + JSON.stringify(wr.b).slice(0, 160));
    const held = JSON.stringify((await pg.query('SELECT entity_id FROM chit_disputes WHERE chit_id = $1 AND dispute_id = $2', [wid, wd])).rows.map((r) => r.entity_id).sort());
    expect(held === JSON.stringify([A.entity, B.entity].sort()), 'copies held by ' + held);
    const aList = ok(await j('/api/chits/' + wid + '/disputes', { token: A.token }), 'sender list').b;
    expect((aList.disputes || []).some((x) => x.dispute_id === wd), 'the sender does not see the dispute');
    const aSay = await j('/api/chits/' + wid + '/messages', { method: 'POST', token: A.token, body: { message_text: wmark + ' answer', thread_type: 'external', is_dispute: true, dispute_id: wd } });
    expect(aSay.status < 300, 'the sender answered HTTP ' + aSay.status + ' ' + JSON.stringify(aSay.b).slice(0, 120));
    const res = await j('/api/chits/' + wid + '/disputes/' + wd + '/resolve', { method: 'PUT', token: B.token, body: { resolution_note: 'rail truth: settled' } });
    expect(res.status < 300, 'the raiser resolve HTTP ' + res.status);
    const aAfter = ok(await j('/api/chits/' + wid + '/disputes', { token: A.token }), 'sender list after').b;
    const seen = (aAfter.disputes || []).find((x) => x.dispute_id === wd);
    expect(seen && seen.status === 'resolved', 'the sender reads the dispute as ' + (seen && seen.status));
  });
}

/** RL-12 a bill's steps stay with the shop that took them */
async function billPrivacyCase(A, B) {
  await kase('RL-12', 'a bill the buyer steps through on its own copy: the seller\'s read carries no buyer step and no log row by the buyer; the buyer sees its own step', async () => {
    const p = A.products.E;
    await sendAs(A, receipt(RUN + '-G12', [[p, 5, 20]]), 'receipt');
    const sale = bill(RUN + '-B12', [[p, 1]]);
    const sent = await sendAs(A, { ...sale, recipients: [{ self: true, name: 'self' }].concat(toOf([B])), business_json: { ...sale.business_json, customer: { name: B.name, entity_id: B.entity } } }, 'bill to B');
    ok(await putStatus(B, sent.chit_id, 'accepted'), 'B accepts its bill');
    const seller = await chitRead(A, sent.chit_id), buyer = await chitRead(B, sent.chit_id);
    const byB = (seller.state_log || []).filter((l) => l.action_by_identity_id === B.entity);
    const stored = await countOf('SELECT count(*)::int AS n FROM state_log WHERE chit_id = $1 AND entity_id = $2 AND action_by_identity_id = $3', [sent.chit_id, A.entity, B.entity]);
    expect(seller.bill_private === true && byB.length === 0 && stored === 0, 'seller read: bill_private ' + seller.bill_private + ' · rows by B in the read ' + byB.length + ' · in the table ' + stored);
    expect((buyer.state_log || []).some((l) => l.action === 'bill_step'), 'the buyer\'s own copy holds no bill_step: ' + JSON.stringify((buyer.state_log || []).map((l) => l.action)));
  });
}

/** the shops the party cases share: B and C trade with A, D holds no copy of anything */
/** RL-52: an id that is no uuid names no chit — the door answers the unknown chit's 404, never a 500 from the uuid cast */
async function idCases(A) {
  const door = async (method, url, body) => {
    const seen = await j(url, { method, token: A.token, body });
    expect(seen.status === 404 && seen.b && seen.b.code === 'NOT_FOUND', method + ' ' + url + ' answered HTTP ' + seen.status + ' ' + JSON.stringify(seen.b).slice(0, 120));
  };
  await kase('RL-52', 'Mark paid on a chit id that is not a uuid is a 404 NOT_FOUND, never a 500 (api #499)', async () => {
    await door('POST', '/api/chits/not-a-bill-1/payment', { method: 'cash', amount: 10 });
    return '404';
  });
  await kase('RL-52b', 'the other /:chit_id doors (read · archive) answer a non-uuid id with the 404, never a 500', async () => {
    await door('GET', '/api/chits/not-a-bill-1');
    await door('POST', '/api/chits/not-a-bill-1/archive');
    return '404 each';
  }, 'RAIL-144 · the id reaches the uuid cast (500) at GET /:chit_id, archive and the raida routes');
}

async function partyCases(A) {
  const B = await freshShop(RUN + 'p1', 'Party one'), C = await freshShop(RUN + 'p2', 'Party two'), D = await freshShop(RUN + 'p3', 'Party three');
  await freezeCases(A, B);
  await copyCases(A, B);
  await disputeCases(A, B, C, D);
  await billPrivacyCase(A, B);
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
    await partyCases(A);
    await idCases(A);
  } finally { await pg.end(); }
  finish('rail-truth', process.env.RAIL_TRUTH_JSON, { run: RUN });
})().catch((e) => { console.error('rail truth could not run:', e && e.message); process.exit(2); });
