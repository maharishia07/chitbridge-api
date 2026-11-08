'use strict';
/**
 * tests/cmp-54-55-ppl-45-swallowed-sql-truth.realstack.cjs — three statements that named a column that does not exist, each in a catch that turned the
 * error into "empty" (night hunt 5, 9 Nov). On a real Postgres as cb_app (RLS on), through the routes; the database is only read.
 *   CMP-54  POST /api/forms/:key/resolve   a form fills its invoice number (the chit's subject) and total from the order named in context_ref
 *   CMP-55  GET  /api/kyb/risk             the risk section reads the shop's trade (chit_detail.total_value, currency) — never "no trade" for a shop that traded
 *   PPL-45  PUT  /api/actors/:id/status    removing the shop's dispute handler clears identities.dispute_handler_actor_id (the shop's own row)
 * Before the fix each case reads the empty answer the swallowed error gave; after it, the real one. LOCAL ONLY. Run: node tests/cmp-54-55-ppl-45-swallowed-sql-truth.realstack.cjs
 * CARD 21-compliance-attestation-and-trade/README · 17-people-employees-hr-and-payroll/README
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { j, ok, kase, expect, freshShop, bill, finish } = H;
const RUN = 'sq' + (Date.now() % 1e8).toString(36);
const PRICE = 250, QTY = 4; /* hand-computed: 4 x 250 = 1000 */

/** the counter's invoice for the one line, tax-free (CBTax.determine()'s form), so the chit carries its money: total_value 1000 on chit_detail */
const counterInvoice = (no) => ({ DocDtls: { No: no }, ItemList: [{ SlNo: '1', PrdDesc: 'Jute bag', Qty: QTY, UnitPrice: PRICE, TotAmt: PRICE * QTY, AssAmt: PRICE * QTY, TotItemVal: PRICE * QTY }], ValDtls: { AssVal: PRICE * QTY, CgstVal: 0, SgstVal: 0, IgstVal: 0, TotInvVal: PRICE * QTY, RndOffAmt: 0 } });

/** a read of one column of the shop's own rows, as the owner role (the truth harness only SELECTs) */
async function select(sql, args) {
  const c = new Client({ connectionString: H.DB });
  await c.connect();
  try { return (await c.query(sql, args)).rows; } finally { await c.end(); }
}

(async () => {
  console.log('\n── swallowed sql truth on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  const A = await freshShop(RUN, 'Swallowed sql');
  const item = { name: 'Jute bag ' + RUN, unit: 'nos', price: PRICE };
  const sent = ok(await j('/api/chits/send', { method: 'POST', token: A.token, body: bill(RUN + '-B1', [[item, QTY]], { invoice: counterInvoice(RUN + '-B1') }) }), 'a bill').b;
  const chitId = sent.chit_id || (sent.chit && sent.chit.chit_id);
  expect(chitId, 'premise: the bill has a chit id, saw ' + JSON.stringify(sent).slice(0, 160));

  await kase('CMP-54', 'a form fills its invoice number and total from the order named', async () => {
    const forms = ok(await j('/api/forms', { token: A.token }), 'forms').b.forms;
    const keyOf = (forms.find((f) => /invoice|export|commercial/i.test(f.key + f.title)) || forms[0]).key;
    const r = ok(await j('/api/forms/' + keyOf + '/resolve', { method: 'POST', token: A.token, body: { context_ref: chitId } }), 'resolve').b;
    const field = (id) => (r.fields || []).find((f) => f.id === id) || {};
    expect(String(field('invoice_no').value || '') === 'Counter sale ' + RUN + '-B1', 'invoice_no was ' + JSON.stringify(field('invoice_no')));
  });

  await kase('CMP-55', 'the risk section sees the trade the shop did (a bill of 1000 in its currency)', async () => {
    const r = ok(await j('/api/kyb/risk', { token: A.token }), 'risk').b;
    const c = (r.facts && r.facts.concentration) || r.concentration || {};
    const cur = (c.by_currency || [])[0];
    expect(c.chits >= 1 && cur && Number(cur.total) === PRICE * QTY, 'concentration read ' + JSON.stringify(c).slice(0, 240));
  });

  await kase('PPL-45', 'removing the dispute handler clears the shop\'s handler (identities.dispute_handler_actor_id)', async () => {
    const key = ('k' + RUN).slice(0, 12);
    const added = ok(await j('/api/actors', { method: 'POST', token: A.token, body: { display_name: 'Handler ' + RUN, actor_key: key, email: key + '@local.test', access_level: 'editor' } }), 'add').b.actor;
    ok(await j('/api/entities/profile', { method: 'PATCH', token: A.token, body: { dispute_handler_actor_id: added.identity_id || added.actor_id } }), 'set handler');
    const before = await select('SELECT dispute_handler_actor_id AS h FROM identities WHERE identity_id = $1', [A.entity]);
    expect(before[0].h, 'premise: the handler was set, saw ' + JSON.stringify(before));
    const gone = ok(await j('/api/actors/' + (added.identity_id || added.actor_id) + '/status', { method: 'PUT', token: A.token, body: { action: 'remove', confirm: 'REMOVE' } }), 'remove').b;
    const after = await select('SELECT dispute_handler_actor_id AS h FROM identities WHERE identity_id = $1', [A.entity]);
    expect(after[0].h === null && gone.disputes_cleared === 1, 'handler after remove ' + JSON.stringify(after) + ', disputes_cleared ' + gone.disputes_cleared);
  });

  finish('cmp-54-55-ppl-45');
})().catch((e) => { console.error(e); process.exit(1); });
