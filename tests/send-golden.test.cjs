/**
 * tests/send-golden.test.cjs — POST /api/chits/send DOES EXACTLY WHAT IT DID BEFORE IT WAS SPLIT INTO NAMED STEPS.
 *
 * Round T2-SPLIT (2026-10-14). The send handler was one 1,408-line function (complexity 350 by scripts/fn-size.cjs) — every
 * counter bill, order, draft and self-chit goes through it. It is now a sequence of named steps (resolve the sender · the bill
 * number · the till claim and replay · the till gate · the body · recipients · money · copies · write · after-commit · answer),
 * each under 80 lines, REFACTOR-ONLY. This is the proof: 28 scenarios through the real router (db, auth and the deliverer
 * stubbed — tests/support/route-golden.cjs), every SQL statement, parameter, copy, post-commit hook and response recorded and
 * compared with tests/fixtures/send-golden.json, frozen from the code BEFORE the split.
 *
 *   node tests/send-golden.test.cjs           compare (the gate)
 *   node tests/send-golden.test.cjs --write   re-freeze — ONLY for a deliberate behaviour change, said in the PR
 * No DB, no network.
 */
'use strict';
const path = require('path');
const G = require('./support/route-golden.cjs');
const API = G.API;

const SHOP = '11111111-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222';
const OP = '33333333-3333-4333-8333-333333333333', CUST2 = '44444444-4444-4444-8444-444444444444';
const ACTOR = '55555555-5555-4555-8555-555555555555', PARENT = '66666666-6666-4666-8666-666666666666';
const DRAFT_ID = '77777777-7777-4777-8777-777777777777';
const ROWS = {
  [SHOP]: { identity_id: SHOP, bridge_id: 'CBSHOP0001', display_name: 'Mayur Traders', country: 'IN', currency_code: 'INR', gstn: '33AAAAA0000A1Z5', policy_flags: {}, status: 'active', user_id: 'mayur' },
  [CUST]: { identity_id: CUST, bridge_id: 'CBCUST0001', display_name: 'Chola Auto Care', country: 'IN', currency_code: 'INR', gstn: '29BBBBB0000B1Z5', policy_flags: {}, status: 'active', user_id: 'chola' },
  [CUST2]: { identity_id: CUST2, bridge_id: 'CBCUST0002', display_name: 'Ravi Stores', country: 'IN', currency_code: 'INR', gstn: null, policy_flags: {}, status: 'active', user_id: 'ravi' },
  [OP]: { identity_id: OP, bridge_id: 'CBOPER0001', display_name: 'The Operator', country: 'IN', currency_code: 'INR', status: 'active' },
};
const known = { [SHOP]: 'SHOP', [CUST]: 'CUST', [OP]: 'OP', [CUST2]: 'CUST2', [ACTOR]: 'ACTOR', [PARENT]: 'PARENT', [DRAFT_ID]: 'DRAFT' };

function rows(s, p, ctx) {
  if (/to_regprocedure\('chit_deliver/.test(s)) return [{ ok: !ctx.legacy }];
  if (/business_json->>'client_ref' = \$2/.test(s)) return ctx.seen ? [ctx.seen] : [];
  if (/SELECT role, business_json->>'page' AS page FROM chit_header/.test(s)) return ctx.draft ? [ctx.draft] : [];
  if (/FROM chit_header WHERE chit_id = ANY\(\$1::uuid\[\]\) AND entity_id = \$2/.test(s)) return (ctx.held || []).map((c) => ({ chit_id: c }));
  if (/SELECT country, currency_code, timezone FROM identities/.test(s)) return [{ country: 'IN', currency_code: 'INR', timezone: null }];   /* N0: the document gate's one read */
  if (/SELECT self_copy_pref, currency_code FROM identities/.test(s)) return [{ self_copy_pref: ctx.pref || null, currency_code: ctx.noCurrency ? null : 'INR' }];
  if (/SELECT sectors FROM entity_profile/.test(s)) return ctx.sectors ? [{ sectors: ctx.sectors }] : [];
  if (/FROM entity_schemas/.test(s) && /is_default = true/.test(s) && /schema_version/.test(s)) return [{ schema_id: 'SCHEMA-1', schema_version: 3 }];
  if (/FROM customer_list c JOIN identities/.test(s)) return ctx.tradeOk ? [{ ok: 1 }] : [];
  if (/FROM customer_list WHERE owner_entity_id = \$1 AND customer_identity_id = \$2/.test(s)) return ctx.listed ? [{ ok: 1 }] : [];
  if (/SELECT bridge_id, display_name FROM identities WHERE identity_id = \$1/.test(s)) {
    if (ctx.noBridge) return [];
    const r = ROWS[p[0]]; return r ? [{ bridge_id: r.bridge_id, display_name: r.display_name }] : [];
  }
  if (/FROM identities WHERE identity_id = ANY\(\$1::uuid\[\]\)/.test(s)) return (p[0] || []).map((id) => ROWS[id]).filter(Boolean);
  if (/FROM identities/.test(s) && /identity_id = \$1/.test(s)) { const r = ROWS[p[0]]; return r ? [r] : []; }
  if (/FROM identities WHERE bridge_id = \$1/.test(s)) return Object.values(ROWS).filter((r) => r.bridge_id === p[0]);
  if (/FROM identities WHERE LOWER\(user_id\) = LOWER\(\$1\)/.test(s)) return Object.values(ROWS).filter((r) => (r.user_id || '') === String(p[0]).toLowerCase());
  if (/FROM identities WHERE \(LOWER\(user_id\) = LOWER\(\$1\) OR bridge_id = \$1\)/.test(s)) return Object.values(ROWS).filter((r) => (r.user_id || '') === String(p[0]).toLowerCase() || r.bridge_id === p[0]).slice(0, 1);
  if (/FROM identities/.test(s) && /LOWER\(display_name\) = LOWER\(\$1\)/.test(s)) return Object.values(ROWS).filter((r) => r.display_name.toLowerCase() === String(p[0]).toLowerCase());
  return [];
}

const h = G.harness({ rows, known });
require(path.join(API, 'lib', 'shop-clock')).set('2026-10-01T12:00:00.000Z');   /* the auto subject carries the day — one day, every run */

/* the deliverer and the post-commit hooks are recorded, never run (they own their own tests) */
const mint = require(path.join(API, 'lib', 'mint'));
mint.deliver = async (sender, chit_id, copies, opts) => {
  h.note('mint.deliver', { sender, chit_id, copies, opts });
  const ctx = h.state.ctx;
  if (ctx.deliverThrows) { const e = new Error(ctx.deliverThrows.message); Object.assign(e, ctx.deliverThrows); throw e; }
  return { ok: true };
};
require(path.join(API, 'lib', 'books-hooks')).afterChit = (eid, cid, who) => { h.note('books.afterChit', { eid, cid, who }); return Promise.resolve({}); };
require(path.join(API, 'lib', 'meter')).meter = async (eid, what, o) => { h.note('meter', { eid, what, o }); };
require(path.join(API, 'lib', 'tax-shelf')).readShelf = async (sellerId) => { h.note('readShelf', { sellerId }); return null; };
require(path.join(API, 'lib', 'stock-from-chit')).postFor = async (eid, chit) => { h.note('stock.postFor', { eid, chit }); return { failed: [], skipped: [] }; };
require(path.join(API, 'lib', 'events')).notifyAfter = (res, ids, ev) => { h.note('events.notifyAfter', { ids, ev }); };
const F = require(path.join(API, 'lib', 'finance-terms'));
const realCredit = F.creditSaleCheck;
F.creditSaleCheck = async (eid, bj) => (h.state.ctx.over ? { over: true, party_id: CUST, limit_minor: 1000, owed_minor: 900, after_minor: 1500 } : realCredit(eid, bj));
F.noteOverride = async (...a) => { h.note('credit.noteOverride', a); };
require(path.join(API, 'routes', 'counters')).noteBill = async (...a) => { h.note('counters.noteBill', a); };

const app = h.app('/api/chits', require(path.join(API, 'routes', 'chits')));

const ME = { identity_id: SHOP, identity_type: 'entity', bridge_id: 'CBSHOP0001', display_name: 'Mayur Traders' };
const LINES = [{ particulars: 'Brake pad', quantity: 2, unit: 'piece', price: 59, total: 118 }, { particulars: 'Oil', quantity: 1, price: 450, total: 450, list_price: 500 }];
const to = (id, extra) => Object.assign({ entity_id: id, role: 'to' }, extra || {});
const order = (extra) => Object.assign({ purpose: 'order', manual_subject: 'Brake pads', recipients: [to(CUST)], line_items: LINES }, extra || {});
const INVOICE = { ValDtls: { AssVal: 1000, CgstVal: 90, SgstVal: 90, IgstVal: 0, TotInvVal: 1180, RndOffAmt: 0 }, ItemList: [], DocDtls: { No: 'C1/26-27/0041' } };
const counterBj = (extra) => Object.assign({ till: { id: 'C1' }, bill_no: 'C1/26-27/0041', billed_at: '2026-10-01T10:00:00.000Z',
  customer: { entity_id: CUST, name: 'Chola Auto Care' }, payment: { parts: [{ mode: 'cash', amount: 1180 }] },
  series: { prefix: 'C1', period: '26-27', seq: 41 }, invoice: INVOICE }, extra || {});

/* ⚠️ ORDER MATTERS: definersReady() latches true the first time it sees the b50 functions, so the legacy fan-out scenarios run first */
const SCENARIOS = [
  ['legacy · order to a customer', { body: order(), ctx: { legacy: true } }],
  ['legacy · promote a draft (clears the draft rows)', { body: order({ promote_draft_id: DRAFT_ID }), ctx: { legacy: true, draft: { role: 'Draft', page: null } } }],
  ['legacy · counter bill to self + customer, one copy for the sender', { body: order({ client_ref: 'C1/26-27/0041', recipients: [{ self: true }, to(CUST)], business_json: counterBj() }), ctx: { legacy: true } }],
  ['order to a customer (definer path)', { body: order() }],
  ['order to two customers + cc, by bridge id, user id and typed name', { body: order({ recipients: [to(CUST), { bridge_id: 'CBCUST0002', name: 'by bridge', role: 'to' }, { user_id: 'ravi', name: 'by user id', role: 'cc' }, { name: 'Ravi Stores', role: 'for' }] }) }],
  ['invoice to a customer — the provisional money block with tax', { body: order({ purpose: 'invoice' }) }],
  ['draft with an unresolved recipient name', { body: order({ is_draft: true, recipients: [{ name: 'Nobody Known', role: 'to' }] }) }],
  ['self-chit, default pref (Task only)', { body: order({ purpose: 'general', recipients: [{ self: true }] }) }],
  ['self-chit, self_copy sent (Order only)', { body: order({ purpose: 'general', recipients: [{ name: 'me' }], self_copy: 'sent' }) }],
  ['self-chit, pref both + a numbered document', { body: order({ purpose: 'general', recipients: [{ self: true }], client_ref: 'R-1' }), ctx: { pref: 'both' } }],
  ['self-chit, pref both, no number', { body: order({ purpose: 'general', recipients: [{ entity_id: SHOP }] }), ctx: { pref: 'both' } }],
  ['counter bill to self + customer (two-sided, issued invoice)', { body: order({ client_ref: 'C1/26-27/0041', recipients: [{ self: true }, to(CUST)], business_json: counterBj() }) }],
  ['a replay of the same bill → the chit that exists', { body: order({ client_ref: 'C1/26-27/0041', recipients: [{ self: true }], business_json: counterBj() }), ctx: { seen: { chit_id: OP, till_id: 'C1', billed_at: '2026-10-01T10:00:00.000Z' } } }],
  ['two counters on one number → 409 collision', { body: order({ client_ref: 'C1/26-27/0041', recipients: [{ self: true }], business_json: counterBj() }), ctx: { seen: { chit_id: OP, till_id: 'C1', billed_at: '2026-10-01T09:00:00.000Z' } } }],
  ['an over-long counter number is recorded on the chit', { body: order({ client_ref: 'C1/26-27/00000000000000000000000041', recipients: [{ self: true }], business_json: counterBj() }) }],
  ['till key · bill to a customer not on the list → one-sided', { body: order({ client_ref: 'C1/26-27/0042', recipients: [to(CUST)], business_json: counterBj() }), till: { key: { scopes: ['till'] } } }],
  ['till key · two customers → 403 TILL_SEND_REFUSED', { body: order({ client_ref: 'C1/26-27/0043', recipients: [to(CUST), to(CUST2)], business_json: counterBj() }), till: { key: { scopes: ['till'] } } }],
  ['till key · listed, tradeable customer → both copies', { body: order({ client_ref: 'C1/26-27/0044', recipients: [to(CUST)], business_json: counterBj() }), till: { key: { scopes: ['till'] } }, ctx: { tradeOk: true } }],
  ['phone bill from another phone → 400 claim mismatch', { body: order({ recipients: [{ self: true }], business_json: counterBj({ till: { id: 'C1', device_id: 'other' } }) }), till: { device_id: 'mine', by: 'ravi' } }],
  ['over the credit limit, no override → 409 OVER_LIMIT', { body: order({ business_json: { customer: { entity_id: CUST } } }), ctx: { over: true } }],
  ['over the credit limit, owner override from a till', { body: order({ business_json: { customer: { entity_id: CUST }, credit_override: { by: 'owner' } } }), till: { key: { scopes: ['connector'] } }, ctx: { over: true } }],
  ['a despatch carries the sender\'s trade', { body: order({ purpose: 'delivery_note' }), ctx: { sectors: ['pharma'] } }],
  ['unknown page → 400', { body: order({ business_json: { page: 'sale.foo.bar@1.0' } }) }],
  ['bad role → 400', { body: order({ recipients: [{ entity_id: CUST, role: 'bcc' }] }) }],
  ['too many recipients → 400', { body: order({ recipients: [1, 2, 3, 4, 5, 6].map(() => to(CUST)) }) }],
  ['too many lines → 400', { body: order({ line_items: Array.from({ length: 51 }, (_, i) => ({ particulars: 'x' + i, quantity: 1, price: 1 })) }) }],
  ['a minted party → 404', { body: order({ recipients: [{ name: '~mayur.sup-0001', role: 'to' }] }) }],
  ['an unknown recipient → 404', { body: order({ recipients: [{ name: 'Nobody Known', role: 'to' }] }) }],
  ['a handoff whose parent is not held → 400', { body: order({ trace: { product: 'Rice', qty: 10, unit: 'kg', parents: [PARENT] } }) }],
  ['a handoff with a network operator → the redacted copy', { body: order({ trace: { product: 'Rice', qty: 10, unit: 'kg', parents: [PARENT], network: { id: 'net-1', operator: OP } } }), ctx: { held: [PARENT] } }],
  ['promote a draft that is not there → 404', { body: order({ promote_draft_id: DRAFT_ID }) }],
  ['promote a chit already sent → 400', { body: order({ promote_draft_id: DRAFT_ID }), ctx: { draft: { role: 'Act', page: null } } }],
  ['promote a draft — its page goes with it', { body: order({ promote_draft_id: DRAFT_ID }), ctx: { draft: { role: 'Draft', page: 'chit.base.detail' } } }],
  ['a shop with no bridge id → 409', { body: order(), identity: { identity_id: SHOP, identity_type: 'entity', bridge_id: null, display_name: null }, ctx: { noBridge: true } }],
  ['a co-assist sends for its business', { body: order(), identity: { identity_id: ACTOR, identity_type: 'actor', parent_entity_id: SHOP, bridge_id: 'X', display_name: 'Ravi' } }],
  ['a lost race on the bill number → the chit that exists', { body: order({ client_ref: 'C1/26-27/0050', recipients: [{ self: true }], business_json: counterBj() }), ctx: { deliverThrows: { code: '23505', constraint: 'chit_header_client_ref_uq', message: 'dup' }, seenAfter: true } }],
  ['a delivery that fails → 500 in words', { body: order(), ctx: { deliverThrows: { code: 'XX000', message: 'boom' } } }],
  ['retention and priority ride on the summary', { body: order({ retention_days: 30, external_priority: 'urgent', forwarded_from: 'abc' }) }],
  /* NET-40: the invitation to be a customer is an ordinary general chit with NO lines - this is the proof the one send path takes it (and it makes no customer row) */
  ['an invitation to be a customer — a general chit with no lines', { body: order({ purpose: 'general', manual_subject: 'Mayur Traders invites you to be their customer', line_items: [], business_json: { kind: 'customer_invite', invite: { for: 'customer', words: 'Mayur Traders invites you to be their customer.' } } }) }],
  ['a captured message carries its provenance', { body: order({ purpose: 'general', business_json: { via: { channel: 'whatsapp', from: '+9198', sender_verified: 'yes', priced: { from_catalogue: 3, ambiguous: [{ name: 'x', matches: 2 }] } } } }) }],
  ['no currency on the sender → the regional resolver', { body: order(), ctx: { noCurrency: true } }],
];

(async () => {
  console.log('\n══ T2-SPLIT · POST /api/chits/send — the same trace before and after the split ══\n');
  const recs = {};
  for (const [name, sc] of SCENARIOS) {
    /* a lost race: the first look sees nothing, the catch's second look sees the winner */
    if (sc.ctx && sc.ctx.seenAfter) {
      let n = 0;
      Object.defineProperty(sc.ctx, 'seen', { get() { n++; return n > 1 ? { chit_id: OP, till_id: 'C1', billed_at: '2026-10-01T10:00:00.000Z' } : null; } });
    }
    recs[name] = await h.run(app, { url: '/api/chits/send', body: sc.body, identity: sc.identity || ME, till: sc.till, ctx: sc.ctx || {} });
  }
  const bad = G.compare(recs, path.join(__dirname, 'fixtures', 'send-golden.json'));
  let pass = 0;
  for (const [name] of SCENARIOS) {
    const b = bad.find((x) => x.name === name);
    if (b) console.log('   FAIL ' + name + '\n          ' + G.firstDiff(b.got, b.want));
    else { pass++; console.log('   ok   ' + name + '  (' + recs[name].status + ', ' + recs[name].calls.length + ' calls)'); }
  }
  console.log('\n  ' + pass + ' passed, ' + bad.length + ' failed');
  console.log('  ' + pass + ' checks');
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
