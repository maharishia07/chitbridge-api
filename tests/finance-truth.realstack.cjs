'use strict';
/**
 * tests/finance-truth.realstack.cjs — FINANCE ROUTES TRUTH (folders · Home facts · pricing), on the REAL stack: real Postgres, real api (API-4 stage 2, R2-10).
 *
 * OWNS      one T2 case per id route of routes/folders.js · routes/facts.js · routes/pricing.js and per money figure they answer: the offline sweep
 *           (tests/api-problem-finance.test.cjs) runs the same routes over a stand-in db, and a stand-in answers what the row policy and the foreign keys never would
 *           (the paid-for lesson of api #321 and #356). Here shop B (and an outsider C) ask shop A's ids on a real database, and the database is READ afterwards to see
 *           that nothing of A's moved.
 * CALLED BY the S41 job of .github/workflows/ci.yml (every tests/*-truth.realstack.cjs, one file at a time); locally: node tests/finance-truth.realstack.cjs (one realstack file at a time on :3100).
 * FLOW      three fresh shops (A owns the records, B asks as another shop, C is an outsider to every chit) → A's folder, rule, filed chit, message → B / C ask by id
 *           → the answer equals an unknown id's answer → the database rows are read back, untouched.
 * CARD      16-finance/README
 *
 * Money: none of these routes WRITES money. POST /api/pricing/price prices lines and stores nothing; the folders hold counts and ages, never an amount. So the money cases are
 * reads: FN-11 the price of a tiered line (quantity x unit price, the engine's one rounding). A money WRITE of finance (collections, terms, the payment path) belongs to the books, not to these three files.
 *
 * FN-01 PATCH /api/folders/:id · FN-02 DELETE /api/folders/:id · FN-03 PATCH /api/folders/rules/:rule_id · FN-04 DELETE /api/folders/rules/:rule_id · FN-05 GET /api/folders/:id/rules
 * FN-06 POST /api/folders/:id/rules · FN-07 PATCH /api/folders/:id with a parent_id in the body · FN-08 GET /api/folders/:id/chits · FN-09 GET /api/folders/:id/metrics
 * FN-10 POST /api/folders/messages/:message_id/mark · FN-11 POST /api/pricing/price · FN-12 PUT /api/folders/inventory/:code (a name, the same for every shop)
 * FN-13 GET /api/facts/:card (a name: every shop reads its OWN figures).
 *
 * A `gap:` FAIL is a RECORDED finding, never fixed here. Today these are the gaps (each proved offline on a stand-in and to be CONFIRMED by this file on the real stack):
 *   FN-02b · FN-04b · FN-05b · FN-08b · FN-09b  an unknown id answers 200 (no row touched), not 404 (API-4c (2b), owner cb-finance): another shop's id gets that same 200, nothing leaks.
 *   FN-06 · FN-07  P1 for cb-security: a folder id of ANOTHER shop is accepted as the folder of a new rule (routes/folders.js:518, lib/folder-rules.js:49) and as the parent of one's own folder
 *                  (routes/folders.js:271-284): the foreign key checks that the folder EXISTS whoever owns it, so the answer differs from an unknown id's (200 / 500) and a reference across shops is stored.
 * NOT RUN where this was written (no Docker there): it is read against the routes, and the S41 job is its first run. LOCAL ONLY.
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, j, ok, pause, kase, expect, bill, freshShop, finish } = H;
const RUN = 'fn' + (Date.now() % 1e10).toString(36);
const GHOST = '00000000-0000-4000-8000-000000000001'; /* a well-formed id nobody owns */
const GHOST_MESSAGE = '00000000-0000-4000-8000-000000000002';
let pg = null;

/** an answer without the request id (it differs on every request), to compare two answers word for word */
const plain = (reply) => JSON.stringify({ status: reply.status, body: Object.assign({}, reply.b, { request_id: null }) });
const sameAnswer = (left, right) => plain(left) === plain(right);
const folderOf = async (shop, name) => ok(await j('/api/folders', { method: 'POST', token: shop.token, body: { name } }), 'folder ' + name).b.folder.folder_id;
const ruleOf = async (shop, folder) => ok(await j('/api/folders/' + folder + '/rules', { method: 'POST', token: shop.token, body: { name: 'Invoices', when: { doc: 'invoice' } } }), 'rule').b.rule_id;
const rowsOf = async (sql, args) => (await pg.query(sql, args)).rows;

(async () => {
  console.log('\n── finance truth on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  pg = new Client({ connectionString: DB });
  await pg.connect();
  try {
    const A = await freshShop(RUN + 'a', 'Finance truth A');
    const B = await freshShop(RUN + 'b', 'Finance truth B');
    const C = await freshShop(RUN + 'c', 'Finance truth C');
    const product = ok(await j('/api/products', { method: 'POST', token: A.token, body: { item_data: { name: 'Rice', unit: 'piece', price: 60 } } }), 'product').b;
    const P = { id: product.item.item_id, name: 'Rice', unit: 'piece', price: 60 };

    /* ── folders: rename, delete ── */
    const f1 = await folderOf(A, 'A only ' + RUN);
    await kase('FN-01', "PATCH /api/folders/:id: another shop's folder id is the unknown id's 404, word for word; the folder is not renamed; the owner's own rename works", async () => {
      const asB = await j('/api/folders/' + f1, { method: 'PATCH', token: B.token, body: { name: 'Hijack' } });
      const asGhost = await j('/api/folders/' + GHOST, { method: 'PATCH', token: B.token, body: { name: 'Hijack' } });
      const name = (await rowsOf('SELECT name FROM folder WHERE folder_id = $1', [f1]))[0].name;
      expect(asB.status === 404 && sameAnswer(asB, asGhost) && name === 'A only ' + RUN, 'B ' + plain(asB) + ' · unknown ' + plain(asGhost) + ' · the name now ' + name);
      const own = await j('/api/folders/' + f1, { method: 'PATCH', token: A.token, body: { name: 'Renamed ' + RUN } });
      expect(own.status === 200 && own.b.folder.name === 'Renamed ' + RUN, 'owner PATCH ' + own.status + ' ' + JSON.stringify(own.b).slice(0, 160));
    });

    const f2 = await folderOf(A, 'A to delete ' + RUN);
    await kase('FN-02a', "DELETE /api/folders/:id: another shop's folder id deletes nothing and answers what an unknown id answers; the owner's own delete removes the row", async () => {
      const asB = await j('/api/folders/' + f2, { method: 'DELETE', token: B.token });
      const asGhost = await j('/api/folders/' + GHOST, { method: 'DELETE', token: B.token });
      const stays = (await rowsOf('SELECT 1 FROM folder WHERE folder_id = $1', [f2])).length;
      expect(stays === 1 && sameAnswer(asB, asGhost), 'B ' + plain(asB) + ' · unknown ' + plain(asGhost) + ' · A folder rows after B asked: ' + stays);
      const own = await j('/api/folders/' + f2, { method: 'DELETE', token: A.token });
      const gone = (await rowsOf('SELECT 1 FROM folder WHERE folder_id = $1', [f2])).length;
      expect(own.status === 200 && Number(own.b.deleted) === 1 && gone === 0, 'owner DELETE ' + own.status + ' ' + JSON.stringify(own.b) + ' · rows left ' + gone);
    });
    await kase('FN-02b', 'DELETE /api/folders/:id: an unknown id is a 404 (a delete that matched nothing is said, not reported as done)', async () => {
      const asGhost = await j('/api/folders/' + GHOST, { method: 'DELETE', token: B.token });
      expect(asGhost.status === 404, 'an unknown folder id answered ' + asGhost.status + ' ' + JSON.stringify(asGhost.b).slice(0, 120));
    }, 'API-4c (2b), owner cb-finance: the route answers 200 { deleted: 0 } for an id that does not exist');

    /* ── folders: rules ── */
    const f3 = await folderOf(A, 'A rules ' + RUN);
    const rule = await ruleOf(A, f3);
    await kase('FN-03', "PATCH /api/folders/rules/:rule_id: another shop's rule id is the unknown id's 404, word for word; the rule is not changed; the owner's own change works", async () => {
      const asB = await j('/api/folders/rules/' + rule, { method: 'PATCH', token: B.token, body: { name: 'Hijack' } });
      const asGhost = await j('/api/folders/rules/' + GHOST, { method: 'PATCH', token: B.token, body: { name: 'Hijack' } });
      const name = (await rowsOf('SELECT name FROM folder_rule WHERE rule_id = $1', [rule]))[0].name;
      expect(asB.status === 404 && sameAnswer(asB, asGhost) && name === 'Invoices', 'B ' + plain(asB) + ' · unknown ' + plain(asGhost) + ' · the rule name now ' + name);
      const own = await j('/api/folders/rules/' + rule, { method: 'PATCH', token: A.token, body: { name: 'Invoices 2' } });
      expect(own.status === 200, 'owner PATCH ' + own.status + ' ' + JSON.stringify(own.b).slice(0, 160));
    });
    await kase('FN-04a', "DELETE /api/folders/rules/:rule_id: another shop's rule id deletes nothing and answers what an unknown id answers", async () => {
      const asB = await j('/api/folders/rules/' + rule, { method: 'DELETE', token: B.token });
      const asGhost = await j('/api/folders/rules/' + GHOST, { method: 'DELETE', token: B.token });
      const stays = (await rowsOf('SELECT 1 FROM folder_rule WHERE rule_id = $1', [rule])).length;
      expect(stays === 1 && sameAnswer(asB, asGhost), 'B ' + plain(asB) + ' · unknown ' + plain(asGhost) + ' · A rule rows after B asked: ' + stays);
    });
    await kase('FN-04b', 'DELETE /api/folders/rules/:rule_id: an unknown rule id is a 404', async () => {
      const asGhost = await j('/api/folders/rules/' + GHOST, { method: 'DELETE', token: B.token });
      expect(asGhost.status === 404, 'an unknown rule id answered ' + asGhost.status + ' ' + JSON.stringify(asGhost.b).slice(0, 120));
    }, 'API-4c (2b), owner cb-finance: answers 200 { deleted: 0 }');
    await kase('FN-05a', "GET /api/folders/:id/rules: another shop's folder shows B no rule of A's; the owner sees it", async () => {
      const asB = await j('/api/folders/' + f3 + '/rules', { token: B.token });
      const own = await j('/api/folders/' + f3 + '/rules', { token: A.token });
      expect(asB.status === 200 && (asB.b.rules || []).length === 0 && own.status === 200 && (own.b.rules || []).length === 1, 'B ' + plain(asB) + ' · A ' + JSON.stringify(own.b).slice(0, 200));
    });
    await kase('FN-05b', 'GET /api/folders/:id/rules: an unknown folder id is a 404', async () => {
      const asGhost = await j('/api/folders/' + GHOST + '/rules', { token: B.token });
      expect(asGhost.status === 404, 'an unknown folder id answered ' + asGhost.status);
    }, 'API-4c (2b), owner cb-finance: answers 200 { rules: [] }');

    const f4 = await folderOf(A, 'A foreign rule ' + RUN);
    await kase('FN-06', "POST /api/folders/:id/rules: another shop's folder id is refused as an unknown folder is, and no rule of B's is stored against A's folder", async () => {
      const asB = await j('/api/folders/' + f4 + '/rules', { method: 'POST', token: B.token, body: { name: 'Cross', when: { doc: 'invoice' } } });
      const asGhost = await j('/api/folders/' + GHOST + '/rules', { method: 'POST', token: B.token, body: { name: 'Cross', when: { doc: 'invoice' } } });
      const stored = (await rowsOf('SELECT 1 FROM folder_rule WHERE entity_id = $1 AND folder_id = $2', [B.entity, f4])).length;
      expect(stored === 0 && asB.status === asGhost.status, "B's rule stored against A's folder: " + stored + ' · B asked A folder ' + asB.status + ' · B asked an unknown folder ' + asGhost.status);
    }, 'P1 for cb-security: folder_rule.folder_id has a foreign key to folder, which checks the folder exists under ANY owner; routes/folders.js:518 and lib/folder-rules.js:49 never check the folder is the caller\'s');

    /* ── folders: a parent named in a body ── */
    const f5 = await folderOf(B, 'B own ' + RUN);
    const f6 = await folderOf(B, 'B second ' + RUN);
    await kase('FN-07', "PATCH /api/folders/:id parent_id: another shop's folder as the parent is refused as an unknown parent is; B's own second folder is accepted", async () => {
      const own = await j('/api/folders/' + f5, { method: 'PATCH', token: B.token, body: { parent_id: f6 } });
      expect(own.status === 200, "B's own second folder as the parent answered " + own.status + ' ' + JSON.stringify(own.b).slice(0, 160));
      const asForeign = await j('/api/folders/' + f6, { method: 'PATCH', token: B.token, body: { parent_id: f1 } });
      const asGhost = await j('/api/folders/' + f6, { method: 'PATCH', token: B.token, body: { parent_id: GHOST } });
      const parent = (await rowsOf('SELECT parent_id FROM folder WHERE folder_id = $1', [f6]))[0].parent_id;
      expect(parent === null && asForeign.status === asGhost.status, 'parent now ' + parent + ' · another shop\'s folder ' + asForeign.status + ' · unknown folder ' + asGhost.status);
    }, 'P1 for cb-security: routes/folders.js:271-284 sets parent_id with no look-up of the folder; the foreign key accepts any folder that exists, and ON DELETE CASCADE then reaches across shops');

    /* ── folders: a filed chit, its list and its numbers ── */
    const sent = ok(await j('/api/chits/send', { method: 'POST', token: A.token, body: bill(RUN + '-f1', [[P, 1]]) }), 'bill').b;
    await pause(1200);
    const f7 = await folderOf(A, 'A filed ' + RUN);
    ok(await j('/api/folders/move', { method: 'POST', token: A.token, body: { chit_id: sent.chit_id, folder_id: f7 } }), 'file the bill');
    await kase('FN-08a', "GET /api/folders/:id/chits: another shop's folder lists nothing of A's; the owner lists the filed chit", async () => {
      const asB = await j('/api/folders/' + f7 + '/chits', { token: B.token });
      const own = await j('/api/folders/' + f7 + '/chits', { token: A.token });
      expect(asB.status === 200 && (asB.b.chits || []).length === 0 && own.status === 200 && (own.b.chits || []).length === 1, 'B ' + plain(asB).slice(0, 200) + ' · A ' + JSON.stringify(own.b).slice(0, 200));
    });
    await kase('FN-08b', 'GET /api/folders/:id/chits: an unknown folder id is a 404', async () => {
      const asGhost = await j('/api/folders/' + GHOST + '/chits', { token: B.token });
      expect(asGhost.status === 404, 'an unknown folder id answered ' + asGhost.status);
    }, 'API-4c (2b), owner cb-finance: answers 200 with an empty page');
    await kase('FN-09a', "GET /api/folders/:id/metrics: another shop's folder counts nothing of A's; the owner's folder counts the filed chit", async () => {
      const asB = await j('/api/folders/' + f7 + '/metrics', { token: B.token });
      const own = await j('/api/folders/' + f7 + '/metrics', { token: A.token });
      expect(asB.status === 200 && asB.b.count === 0 && own.status === 200 && own.b.count === 1, 'B count ' + asB.b.count + ' · A count ' + own.b.count);
    });
    await kase('FN-09b', 'GET /api/folders/:id/metrics: an unknown folder id is a 404', async () => {
      const asGhost = await j('/api/folders/' + GHOST + '/metrics', { token: B.token });
      expect(asGhost.status === 404, 'an unknown folder id answered ' + asGhost.status);
    }, 'API-4c (2b), owner cb-finance: answers 200 with zero counts');

    /* ── folders: a message's read mark (A receives a chit from B and B writes on it; C is an outsider) ── */
    const thread = ok(await j('/api/chits/send', { method: 'POST', token: B.token, body: { recipients: [{ display_name: A.name, bridge_id: A.bridge, kind: 'to' }], purpose: 'general', subject: 'Mark truth ' + RUN, manual_subject: 'Mark truth ' + RUN, client_ref: RUN + '-m1', line_items: [] } }), 'chit B to A').b;
    await pause(1200);
    ok(await j('/api/chits/' + thread.chit_id + '/messages', { method: 'POST', token: B.token, body: { message_text: 'Please confirm ' + RUN, thread_type: 'external' } }), 'external message');
    await pause(800);
    await kase('FN-10', "POST /api/folders/messages/:message_id/mark: an outsider's mark of A's message id is the unknown id's 404, word for word, and the message stays unread; A's own mark works", async () => {
      const inbox = ok(await j('/api/folders/messages', { token: A.token }), 'inbox').b;
      const message = (inbox.messages || []).find((one) => String(one.chit_id) === String(thread.chit_id));
      expect(message, "A's inbox does not list the external message: " + JSON.stringify(inbox).slice(0, 200));
      const asC = await j('/api/folders/messages/' + message.message_id + '/mark', { method: 'POST', token: C.token, body: { read: true } });
      const asGhost = await j('/api/folders/messages/' + GHOST_MESSAGE + '/mark', { method: 'POST', token: C.token, body: { read: true } });
      const unread = (await rowsOf("SELECT to_jsonb(m)->>'read_at' AS read_at FROM chit_messages m WHERE message_id = $1 AND entity_id = $2", [message.message_id, A.entity]))[0];
      expect(asC.status === 404 && sameAnswer(asC, asGhost) && unread && unread.read_at === null, 'C ' + plain(asC) + ' · unknown ' + plain(asGhost) + ' · read_at now ' + JSON.stringify(unread));
      const own = await j('/api/folders/messages/' + message.message_id + '/mark', { method: 'POST', token: A.token, body: { read: true } });
      expect(own.status === 200 && Number(own.b.updated) >= 1, 'owner mark ' + own.status + ' ' + JSON.stringify(own.b));
    });

    /* ── pricing: the one money figure (a read) ── */
    await kase('FN-11', 'POST /api/pricing/price: a tiered line prices at the break its quantity reaches, and the total is quantity x unit price (the engine\'s one rounding)', async () => {
      const line = { qty: 12, listPrice: 10, pricing: { kind: 'tiered', tiers: [{ qty: 1, price: 10 }, { qty: 10, price: 8 }] } };
      const priced = ok(await j('/api/pricing/price', { method: 'POST', token: A.token, body: { lines: [line] } }), 'price').b;
      expect(priced.lines.length === 1 && Number(priced.lines[0].unit_price) === 8 && Number(priced.total) === 96, 'priced ' + JSON.stringify(priced).slice(0, 300) + ' (12 at the 10-break price 8 = 96)');
    });

    /* ── names: the same for every shop, so there is no foreign id; what must hold is that one shop's change never moves another's ── */
    await kase('FN-12', "PUT /api/folders/inventory/:code: A switching a folder off leaves B's inventory as it was (the code is a name, the switch is the shop's own)", async () => {
      const read = async (shop) => ((await j('/api/folders/inventory', { token: shop.token })).b.rows || []).find((one) => one.code === 'B-2100');
      const before = await read(B);
      expect(before, "the inventory has no folder B-2100: it is not read for B");
      const off = await j('/api/folders/inventory/B-2100', { method: 'PUT', token: A.token, body: { on: !before.on } });
      expect(off.status === 200, 'A switched B-2100: ' + off.status + ' ' + JSON.stringify(off.b).slice(0, 160));
      const mine = await read(A), theirs = await read(B);
      expect(mine.on === !before.on && theirs.on === before.on, 'A now ' + mine.on + ' (was ' + before.on + ') · B now ' + theirs.on);
    });
    await kase('FN-13', 'GET /api/facts/:card: a card name is the same for every shop and each shop reads its OWN figures (A has a customer, B has none)', async () => {
      const phone = '9' + String(Date.now()).slice(-9);
      ok(await j('/api/relationships/customers', { method: 'POST', token: A.token, body: { name: 'Facts Customer ' + RUN, phone } }), 'customer');
      const total = (card) => Number((card.b.figures || {}).customers || 0) + Number((card.b.figures || {}).suppliers || 0);
      const asA = await j('/api/facts/crm', { token: A.token }), asB = await j('/api/facts/crm', { token: B.token });
      expect(asA.status === 200 && asB.status === 200 && total(asA) >= 1 && total(asB) === 0, 'A ' + JSON.stringify(asA.b.figures) + ' · B ' + JSON.stringify(asB.b.figures));
      const nope = await j('/api/facts/nope-' + RUN, { token: A.token });
      expect(nope.status === 404, 'an unknown card answered ' + nope.status);
    });
  } finally {
    await pg.end();
  }
  finish('finance-truth', process.env.FINANCE_TRUTH_JSON, { run: RUN });
})().catch((failure) => {
  console.error('finance truth could not run:', failure && failure.message);
  process.exit(2);
});
