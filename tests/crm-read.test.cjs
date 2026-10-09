/**
 * CB CRM, Phase 3 — the read model: GET /api/crm/parties · /parties/:id · /parties/:id/timeline. Offline (tests/support/crm-stub.cjs):
 * the real router and lib/crm over an in-memory stand-in for the database.
 *   · a party on BOTH lists is ONE row (two roles, one netted dues figure)        · a merged party is never listed; its id opens the survivor
 *   · another population is never listed                                           · a removed (hidden) party is never listed
 *   · the dues are the STORED figures, byte for byte (nothing recomputed)          · on ChitBridge is the one verdict (local-identity)
 *   · high_value comes from the segment SQL, with the fall-back before b273        · no per-row fetch: the statement count does not grow with the list
 * Run: node tests/crm-read.test.cjs
 */
'use strict';
const assert = require('assert');
const { make, row } = require('./support/crm-stub.cjs');
const t = make();
const F = require('../lib/crm-followups');   /* a positive "migrated" answer is remembered; the tests flip the stand-in, so they forget it */
const D = t.data;
const P = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
let pass = 0;
const ita = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n      ')); process.exitCode = 1; } };

/* the seed (PLAN.md "golden-parties", the API-side rows) */
const agro = row({ party_id: P(1), display_name: 'Agro Mills', user_id: 'agromills', party_no: 'P-0001' });
const chola = row({ party_id: P(2), display_name: 'Chola Auto Care', user_id: 'chola', party_no: 'P-0002' });
const ravi = row({ party_id: P(3), display_name: 'Ravi Traders', user_id: '~shop.sup-0001', on_rail: false, party_no: 'P-0003' });
const meena = row({ party_id: P(5), display_name: 'Meena', user_id: 'meena', entity_kind: 'shopper', on_rail: false, party_no: 'P-0005' });
const big = row({ party_id: P(6), display_name: 'Big Buyer', user_id: 'bigbuyer', party_no: 'P-0006' });
const test = row({ party_id: P(7), display_name: 'Test Co', user_id: 'testco', same_world: false });
const folded = row({ party_id: P(8), display_name: 'Folded', user_id: 'folded', merged_into: P(1), party_no: 'P-0008' });
const gone = row({ party_id: P(9), display_name: 'Removed One', user_id: 'removed', hidden_at: '2026-10-01T00:00:00Z' });
const cs = (r, o) => Object.assign({}, r, { customer_type: 'entity', added_via: 'manual', txn_count: 4, last_txn_at: '2026-09-30T10:00:00Z', groups: ['Dealers'], segment: 'regular' }, o);
const ss = (r, o) => Object.assign({}, r, { category: 'Raw', preferred: false, supply_kind: 'goods', added_via: 'manual' }, o);
D.cust = [cs(chola), cs(meena, { segment: 'inactive', customer_type: 'end_customer' }), cs(big, { segment: 'high_value' }), cs(test), cs(folded), cs(gone), cs(ravi, { party_id: P(4), display_name: 'Ravi Trdrs', user_id: '~shop.cus-0001', party_no: 'P-0004' })];
D.sup = [ss(agro), ss(chola), ss(ravi), ss(folded, { merged_into: P(1) })];
D.walk = [{ owner: 'E1', phone: '+919840012321', points: '120', last_at: '2026-09-29T00:00:00Z' }];
D.stored.customer[P(2)] = { party_no: 'P-0002', balance_minor: 100000, oldest_due: '2026-09-01', tax_ids: [{ scheme: 'GSTIN', value: '33ABCDE1234F1Z5' }] };
D.stored.supplier[P(2)] = { party_no: 'P-0002', balance_minor: -61835, oldest_due: '2026-08-15' };
D.stored.supplier[P(1)] = { party_no: 'P-0001', balance_minor: -48165, oldest_due: '2026-08-20', legal_name: 'Agro Mills Pvt Ltd' };
D.stored.customer[P(6)] = { party_no: 'P-0006', balance_minor: 0 };
D.stored.customer[P(4)] = { party_no: 'P-0004', balance_minor: 7550 };
const byId = (list, id) => list.parties.filter((p) => p.party_id === id);

(async () => {
  let list;
  await ita('list → 200, one call', async () => { const r = await t.get('/parties'); assert.strictEqual(r.status, 200, JSON.stringify(r.body)); list = r.body; });
  await ita('a party on BOTH lists is ONE row, both role chips, one party number', async () => {
    const rows = byId(list, P(2)); assert.strictEqual(rows.length, 1);
    assert.deepStrictEqual(rows[0].roles, { customer: true, supplier: true }); assert.strictEqual(rows[0].party_no, 'P-0002');
    assert.ok(rows[0].customer && rows[0].supplier, 'both sides of the record');
  });
  await ita('…and ONE netted dues figure — the two STORED figures added once (100000 − 61835), side "both"', async () => {
    const d = byId(list, P(2))[0].dues; assert.strictEqual(d.balance_minor, 38165); assert.strictEqual(d.side, 'both'); assert.strictEqual(d.oldest_due, '2026-08-15');
  });
  await ita('dues equal the stored figures (a supplier alone: exactly the Ledger\'s −48165; nothing recomputed)', async () => {
    assert.strictEqual(byId(list, P(1))[0].dues.balance_minor, D.stored.supplier[P(1)].balance_minor); assert.strictEqual(byId(list, P(1))[0].dues.side, 'supplier');
    assert.strictEqual(byId(list, P(4))[0].dues.balance_minor, 7550); assert.strictEqual(byId(list, P(6))[0].dues.balance_minor, 0);
  });
  await ita('a merged party is never listed (either list row carrying merged_into)', async () => { assert.strictEqual(byId(list, P(8)).length, 0); });
  await ita('another population is never listed', async () => { assert.strictEqual(byId(list, P(7)).length, 0); });
  await ita('a removed (hidden) party is never listed', async () => { assert.strictEqual(byId(list, P(9)).length, 0); });
  await ita('the count says what is shown: 6 parties (Agro, Chola, Ravi sup, Meena, Big Buyer, Ravi cus)', async () => { assert.strictEqual(list.count, 6); assert.strictEqual(list.parties.length, 6); });
  await ita('on ChitBridge is the one verdict: on-rail business ok · minted → why "local" · shopper → why "shopper"', async () => {
    assert.deepStrictEqual(byId(list, P(1))[0].may_trade, { ok: true }); assert.strictEqual(byId(list, P(1))[0].on_chitbridge, true);
    assert.deepStrictEqual(byId(list, P(3))[0].may_trade, { ok: false, why: 'local' }); assert.strictEqual(byId(list, P(3))[0].kind, 'local');
    assert.deepStrictEqual(byId(list, P(5))[0].may_trade, { ok: false, why: 'shopper' }); assert.strictEqual(byId(list, P(5))[0].kind, 'person');
  });
  await ita('the segment is the SQL\'s word (high_value passes through); a pure supplier has none', async () => {
    assert.strictEqual(byId(list, P(6))[0].customer.segment, 'high_value'); assert.strictEqual(byId(list, P(5))[0].customer.segment, 'inactive');
    assert.strictEqual(byId(list, P(1))[0].customer, undefined);
  });
  await ita('walk-in rows: a phone that holds points, with no party id', async () => {
    assert.strictEqual(list.walk_ins.length, 1); assert.strictEqual(list.walk_ins[0].phone, '+919840012321'); assert.strictEqual(list.walk_ins[0].points, 120); assert.strictEqual(list.walk_ins[0].party_id, null);
  });
  await ita('the readers\' rules: the shop\'s GSTIN wins, theirs shows only when it has none, a difference is flagged', async () => {
    const c = byId(list, P(2))[0]; assert.strictEqual(c.gstin.value, '33ABCDE1234F1Z5'); assert.strictEqual(c.gstin.source, 'shop');
    D.cust.find((r) => r.party_id === P(2)).gstn = '33ZZZZZ9999Z1Z1';
    const again = (await t.get('/parties')).body; const g = byId(again, P(2))[0].gstin; assert.strictEqual(g.differs, true); assert.strictEqual(g.theirs, '33ZZZZZ9999Z1Z1');
    D.cust.find((r) => r.party_id === P(2)).gstn = null;
  });
  await ita('no per-row fetch: the statement count is the same for 6 parties as for 506', async () => {
    D.queries.length = 0; await t.get('/parties'); const small = D.queries.length;
    const keep = D.cust, extra = [];
    for (let i = 0; i < 500; i++) extra.push(cs(row({ party_id: P(1000 + i), display_name: 'Bulk ' + i, user_id: 'bulk' + i })));
    D.cust = D.cust.concat(extra);
    D.queries.length = 0; const r = await t.get('/parties'); assert.strictEqual(r.body.count, 506); assert.strictEqual(D.queries.length, small, 'statements grew with the list');
    D.cust = keep;
  });
  await ita('before b273 (no party_item) the segment falls back and the list still answers', async () => {
    D.hvMissing = true; const r = await t.get('/parties'); assert.strictEqual(r.status, 200); assert.strictEqual(r.body.count, 6); D.hvMissing = false;
  });
  await ita('ledger off (no decorator figures) → dues is null, never a made-up zero', async () => {
    D.ledgerOn = false; const r = (await t.get('/parties')).body; assert.strictEqual(byId(r, P(1))[0].dues, null); D.ledgerOn = true;
  });
  await ita('another shop\'s parties are not mine (the owner scopes every row)', async () => {
    t.as('E2'); const r = (await t.get('/parties')).body; assert.strictEqual(r.count, 0); t.as('E1');
  });

  /* the record */
  await ita('record: the list row + the relationship line + points + follow-ups', async () => {
    D.chits = [{ counterparty_id: P(2), direction: 'sent', current_status: 'completed', created_at: '2026-09-01T00:00:00Z', purpose: 'order' }, { counterparty_id: P(2), direction: 'received', current_status: 'completed', created_at: '2026-09-10T00:00:00Z', purpose: 'order' }];
    D.points = { programme: { name: 'Club' }, points: 120, worth: 60 };
    const r = await t.get('/parties/' + P(2)); assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.party_no, 'P-0002'); assert.strictEqual(r.body.dues.balance_minor, 38165);
    assert.strictEqual(r.body.relationship.relationship.shape, 'both ways'); assert.strictEqual(r.body.relationship.completion.completed, 2);
    assert.deepStrictEqual(r.body.points, { programme: 'Club', points: 120, worth: 60 }); assert.strictEqual(r.body.migrated, true); assert.deepStrictEqual(r.body.followups, []);
  });
  await ita('record: the id of a merged party opens the survivor, with "merged from"', async () => {
    const r = await t.get('/parties/' + P(8)); assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.party_id, P(1)); assert.deepStrictEqual(r.body.merged_from, { party_id: P(8), party_no: 'P-0008' });
  });
  await ita('record: a local party has no chit history (relationship null) — and is not offered Message (may_trade says why)', async () => {
    const r = await t.get('/parties/' + P(3)); assert.strictEqual(r.body.relationship, null); assert.strictEqual(r.body.may_trade.why, 'local');
  });
  await ita('record: another population\'s id is 404, an id that is no party is 404, junk is 400', async () => {
    assert.strictEqual((await t.get('/parties/' + P(7))).status, 404); assert.strictEqual((await t.get('/parties/' + P(77))).status, 404); const j = await t.get('/parties/nope'); assert.strictEqual(j.status, 400); assert.strictEqual(j.body.code, 'BAD_ID');
  });
  await ita('record before b276: complete, with migrated:false (never a 500)', async () => {
    D.migrated = false; F.forget(); const r = await t.get('/parties/' + P(1)); assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.migrated, false); assert.deepStrictEqual(r.body.followups, []); D.migrated = true; F.forget();
  });

  /* the timeline */
  await ita('timeline: newest first across sources, kinds named, money is the stored figure', async () => {
    const C = P(2);
    D.chits = [{ chit_id: 'c1', counterparty_id: C, direction: 'sent', current_status: 'completed', created_at: '2026-09-01T00:00:00.000Z', purpose: 'order', value: '48165', currency: 'INR', doc_kind: 'bill', bill_no: 'B-1', open_disputes: 1, manual_subject: 'Bill B-1' },
               { chit_id: 'c2', counterparty_id: C, direction: 'received', current_status: 'pending', created_at: '2026-09-05T00:00:00.000Z', purpose: 'order', value: null, currency: null, open_disputes: 0 }];
    D.messages = [{ chit_id: 'c2', message_text: 'Please send by Friday', sender_display_name: 'Chola', created_at: '2026-09-06T00:00:00.000Z' }];
    D.disputes = [{ chit_id: 'c1', dispute_id: 'd1', status: 'open', category: 'price', created_at: '2026-09-02T00:00:00.000Z' }];
    D.ledger = [{ entity: 'E1', party_id: C, item_id: 1, ref: 'B-1', ref_kind: 'bill', kind: 'sale', amount_minor: '48165', currency: 'INR', doc_date: '2026-09-01', created_at: '2026-09-01T00:00:01.000Z' }];
    D.changes = [{ entity: 'E1', row_id: C, at: '2026-09-07T00:00:00.000Z', by: 'E1', table_name: 'customer_list', field: 'credit_days', old: '0', new: '30' }];
    D.interactions = [{ owner: 'E1', party_id: C, interaction_id: 'i1', kind: 'call', direction: 'out', body: 'Asked about payment', at: '2026-09-08T00:00:00.000Z', by_user_id: 'E1' }];
    D.followups = [{ owner: 'E1', party_id: C, followup_id: 'f1', what: 'Call back', due_at: '2026-09-12T00:00:00.000Z', created_at: '2026-09-08T01:00:00.000Z', done_at: '2026-09-09T00:00:00.000Z', assignee_user_id: 'E1' }];
    const r = await t.get('/parties/' + C + '/timeline'); assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const kinds = r.body.entries.map((e) => e.kind);
    assert.deepStrictEqual(kinds, ['followup_done', 'followup', 'interaction', 'change', 'message', 'chit', 'dispute', 'ledger', 'chit'], kinds.join());
    const bill = r.body.entries.find((e) => e.chit_id === 'c1' && e.kind === 'chit'); assert.strictEqual(bill.value, 48165); assert.strictEqual(bill.currency, 'INR'); assert.strictEqual(bill.bill_no, 'B-1');
    assert.strictEqual(r.body.entries.find((e) => e.kind === 'ledger').amount_minor, 48165); assert.strictEqual(r.body.migrated, true); assert.strictEqual(r.body.next_before, null);
  });
  await ita('timeline pages: limit + next_before walk the whole list with no repeats', async () => {
    const C = P(2), seen = []; let before = null, guard = 0;
    do { const r = await t.get('/parties/' + C + '/timeline?limit=3' + (before ? '&before=' + encodeURIComponent(before) : '')); assert.strictEqual(r.status, 200); r.body.entries.forEach((e) => seen.push(e.kind + '@' + e.at)); before = r.body.next_before; } while (before && ++guard < 10);
    assert.strictEqual(seen.length, 9); assert.strictEqual(new Set(seen).size, 9);
  });
  await ita('timeline: "History of changes" is the owner\'s only (a co-assist sees none)', async () => {
    t.as('E1', { identity: { identity_id: 'A1', parent_entity_id: 'E1' } });
    const r = await t.get('/parties/' + P(2) + '/timeline'); assert.ok(!r.body.entries.some((e) => e.kind === 'change')); t.as('E1');
  });
  await ita('timeline before b276: chits and the ledger still come, interactions are simply absent, migrated:false', async () => {
    D.migrated = false; F.forget(); const r = await t.get('/parties/' + P(2) + '/timeline'); assert.strictEqual(r.status, 200); assert.strictEqual(r.body.migrated, false);
    assert.ok(r.body.entries.some((e) => e.kind === 'chit') && !r.body.entries.some((e) => e.kind === 'interaction')); D.migrated = true; F.forget();
  });
  await ita('an API key reaches nothing here (403)', async () => { t.as('E1', { key: true }); const r = await t.get('/parties'); assert.strictEqual(r.status, 403); t.as('E1'); });

  await ita('an internal sign-in handle is never sent as an e-mail (O6/C9): a phone handle → null, a handle that carries an e-mail gives it back, a real address is untouched', async () => {
    const H = require('../lib/handle');
    assert.strictEqual(require('../lib/resolveuserid').realEmail('9876512345@mayuri123.cr'), null);
    assert.strictEqual(require('../lib/resolveuserid').realEmail('meena.s=outlook.com@mayuri123.cr'), 'meena.s@outlook.com');
    assert.strictEqual(require('../lib/resolveuserid').realEmail('ravi@acmetraders.br'), null);
    assert.strictEqual(require('../lib/resolveuserid').realEmail('someone@firm.co.cr'), 'someone@firm.co.cr');
    assert.strictEqual(require('../lib/resolveuserid').realEmail('a@b.com'), 'a@b.com'); assert.strictEqual(require('../lib/resolveuserid').realEmail(''), null); assert.strictEqual(require('../lib/resolveuserid').realEmail(null), null);
    const A = require('../lib/crm').assemble({ cust: [cs(row({ party_id: P(41), display_name: 'Handle Guest', user_id: '~shop.cus-0041', on_rail: false, party_no: 'P-0041', email: '9876512345@mayuri123.cr' }))], sup: [], walk: [] }, null);
    assert.strictEqual(A.parties[0].email, null);
  });

  t.close();
  console.log('  ' + pass + ' checks'); if (process.exitCode) console.log('FAILED');
})();
