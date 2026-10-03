/**
 * tests/support/contract-crm.cjs — the /api/crm routes the web reads, called through the REAL router over the CRM stub (tests/support/crm-stub.cjs), each
 * answer kept under "METHOD /api/crm/<route pattern>". Used by tests/web-api-contract.test.cjs, which holds each answer to docs/contracts/web-api.json.
 * The seed is the crm-read / crm-followups tests' own: a party on both lists, a local supplier, a shopper, a merged and a hidden one, a walk-in, chits,
 * a message, a dispute, ledger items, a change, an interaction and follow-ups.
 */
'use strict';
const { make, row } = require('./crm-stub.cjs');

const P = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const day = (n) => new Date(Date.now() + n * 86400000).toISOString();

async function captureCrm() {
  const t = make(), D = t.data, F = require('../../lib/crm-followups');
  const got = {};
  /** an answer under its route pattern; the same status MERGES into one example, another status gets its own entry ("#404") */
  const keep = (m, key, r) => { let k = m + ' /api/crm' + key; if (got[k] && got[k].status !== r.status) k += ' #' + r.status; got[k] = got[k] || { status: r.status, bodies: [] }; got[k].bodies.push(r.body); return r; };
  const cs = (r, o) => Object.assign({}, r, { customer_type: 'entity', added_via: 'manual', txn_count: 4, last_txn_at: '2026-09-30T10:00:00Z', groups: ['Dealers'], segment: 'regular' }, o);
  const ss = (r, o) => Object.assign({}, r, { category: 'Raw', preferred: false, supply_kind: 'goods', added_via: 'manual' }, o);
  const agro = row({ party_id: P(1), display_name: 'Agro Mills', user_id: 'agromills', party_no: 'P-0001' });
  const chola = row({ party_id: P(2), display_name: 'Chola Auto Care', user_id: 'chola', party_no: 'P-0002', city: 'Madurai' });
  const ravi = row({ party_id: P(3), display_name: 'Ravi Traders', user_id: '~shop.sup-0001', on_rail: false, party_no: 'P-0003' });
  const meena = row({ party_id: P(5), display_name: 'Meena', user_id: 'meena', entity_kind: 'shopper', on_rail: false, party_no: 'P-0005', phone: '+919840099999', email: 'meena@example.com' });
  const folded = row({ party_id: P(8), display_name: 'Folded', user_id: 'folded', merged_into: P(1), party_no: 'P-0008' });
  D.cust = [cs(chola, { customer_list_id: 'cl-2' }), cs(meena, { customer_list_id: 'cl-5', segment: 'inactive', customer_type: 'end_customer' }), cs(folded, { customer_list_id: 'cl-8' })];
  D.sup = [ss(agro, { supplier_list_id: 'sl-1' }), ss(chola, { supplier_list_id: 'sl-2' }), ss(ravi, { supplier_list_id: 'sl-3' }), ss(folded, { supplier_list_id: 'sl-8', merged_into: P(1) })];
  D.walk = [{ owner: 'E1', phone: '+919840012321', points: '120', last_at: '2026-09-29T00:00:00Z' }];
  D.stored.customer[P(2)] = { party_no: 'P-0002', balance_minor: 100000, oldest_due: '2026-09-01', tax_ids: [{ scheme: 'GSTIN', value: '33ABCDE1234F1Z5' }], nickname: 'Chola', legal_name: 'Chola Auto Care LLP', state_code: '33', credit_days: 15 };
  D.stored.supplier[P(2)] = { party_no: 'P-0002', balance_minor: -61835, oldest_due: '2026-08-15' };
  D.stored.supplier[P(1)] = { party_no: 'P-0001', balance_minor: -48165, oldest_due: '2026-08-20', legal_name: 'Agro Mills Pvt Ltd' };
  D.chits = [{ chit_id: 'c1', counterparty_id: P(2), direction: 'sent', current_status: 'completed', created_at: '2026-09-01T00:00:00.000Z', purpose: 'order', value: '48165', currency: 'INR', doc_kind: 'bill', bill_no: 'B-1', open_disputes: 1, manual_subject: 'Bill B-1' },
    { chit_id: 'c2', counterparty_id: P(2), direction: 'received', current_status: 'pending', created_at: '2026-09-05T00:00:00.000Z', purpose: 'order', value: null, currency: null, open_disputes: 0 }];
  D.messages = [{ chit_id: 'c2', message_text: 'Please send by Friday', sender_display_name: 'Chola', created_at: '2026-09-06T00:00:00.000Z' }];
  D.disputes = [{ chit_id: 'c1', dispute_id: 'd1', status: 'open', category: 'price', created_at: '2026-09-02T00:00:00.000Z' }];
  D.ledger = [{ entity: 'E1', party_id: P(2), item_id: 1, ref: 'B-1', ref_kind: 'bill', kind: 'sale', amount_minor: '48165', currency: 'INR', doc_date: '2026-09-01', created_at: '2026-09-01T00:00:01.000Z' }];
  D.changes = [{ entity: 'E1', row_id: P(2), at: '2026-09-07T00:00:00.000Z', by: 'E1', table_name: 'customer_list', field: 'credit_days', old: '0', new: '30' }];
  D.interactions = [{ owner: 'E1', party_id: P(2), interaction_id: 'i1', kind: 'call', direction: 'out', body: 'Asked about payment', at: '2026-09-08T00:00:00.000Z', by_user_id: 'E1' }];
  D.followups = [{ owner: 'E1', party_id: P(2), followup_id: 'f1', what: 'Call back', due_at: day(-2), created_at: '2026-09-08T01:00:00.000Z', done_at: '2026-09-09T00:00:00.000Z', assignee_user_id: 'E1' }];
  D.points = { programme: { name: 'Club' }, points: 120, worth: 60 };
  /* the walk-in mint reads and writes identities and customer_list: answered the way crm-remove-walkin.test.cjs answers them */
  const ids = [{ identity_id: 'E1', user_id: 'acme', bridge_id: 'B1' }];
  D.extra = async (sql, p) => {
    if (/^SELECT user_id, bridge_id FROM identities WHERE identity_id/.test(sql)) return { rows: ids.filter((i) => i.identity_id === p[0]) };
    if (/FROM identities WHERE parent_entity_id = \$1 AND user_id LIKE/.test(sql)) return { rows: ids.filter((i) => i.parent_entity_id === p[0] && i.user_id.startsWith(p[1].replace('%', '')) && i.display_name.toLowerCase() === p[2]) };
    if (/^SELECT user_id FROM identities WHERE user_id LIKE/.test(sql)) return { rows: ids.filter((i) => i.user_id.startsWith(p[0].replace('%', ''))).slice(-1) };
    if (/^INSERT INTO identities/.test(sql)) { const r = { identity_id: 'N' + ids.length, bridge_id: p[0], display_name: p[1], user_id: p[2], parent_entity_id: p[3] }; ids.push(r); return { rows: [r] }; }
    if (/^UPDATE identities SET otp_contact/.test(sql)) { ids.find((i) => i.identity_id === p[0]).otp_contact = p[1]; return { rows: [] }; }
    if (/^INSERT INTO customer_list/.test(sql)) return { rows: [{ customer_list_id: 'CL1' }] };
    return null;
  };
  F.forget();
  try {
    keep('GET', '/parties', await t.get('/parties'));
    keep('GET', '/parties/:id', await t.get('/parties/' + P(2)));
    keep('GET', '/parties/:id', await t.get('/parties/' + P(8)));
    keep('GET', '/parties/:id', await t.get('/parties/' + P(3)));
    keep('GET', '/parties/:id', await t.get('/parties/' + P(5)));
    keep('GET', '/parties/:id/timeline', await t.get('/parties/' + P(2) + '/timeline'));
    const ix = await t.post('/parties/' + P(2) + '/interactions', { kind: 'call', direction: 'out', body: 'Rang about the rate' });
    if (ix.body && ix.body.interaction) delete ix.body.interaction.owner;   /* the stand-in keeps the shop on the row; the real INSERT ... RETURNING does not */
    keep('POST', '/parties/:id/interactions', ix);
    keep('POST', '/followups', await t.post('/followups', { party_id: P(2), what: 'Ring about the quote', due_at: day(-1), source: 'manual' }));
    keep('POST', '/followups', await t.post('/followups', { party_id: P(2), what: 'Ask for the cheque', due_at: day(5), source: 'dues' }));
    const open = (await t.get('/followups?scope=all&done=0')).body;
    keep('GET', '/followups', { status: 200, body: open });
    const one = open.followups && open.followups[0];
    if (one) keep('PATCH', '/followups/:id', await t.patch('/followups/' + one.followup_id, { done: true }));
    const other = open.followups && open.followups[1];
    if (other) keep('DELETE', '/followups/:id', await t.del('/followups/' + other.followup_id));
    keep('GET', '/followups', await t.get('/followups?scope=all&done=1'));
    keep('POST', '/walk-ins/add', await t.post('/walk-ins/add', { phone: '+91 98400 55555', name: 'Corner shop' }));
    keep('DELETE', '/parties/:id', await t.del('/parties/' + P(3)));
    keep('GET', '/parties/:id', await t.get('/parties/' + P(77)));
    keep('DELETE', '/parties/:id', await t.del('/parties/' + P(2)));
    D.migrated = false; F.forget();
    keep('GET', '/parties/:id', await t.get('/parties/' + P(1)));
    keep('POST', '/followups', await t.post('/followups', { party_id: P(2), what: 'x', due_at: day(0) }));
    D.migrated = true; F.forget();
  } finally { t.close(); }
  return got;
}
module.exports = { captureCrm };
