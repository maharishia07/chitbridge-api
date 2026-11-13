/**
 * tests/rail146h-timeline-cost-blind.test.cjs — RAIL-146h: the party timeline never carries what the shop PAYS to a cost-blind co-assist.
 *
 * OWNS      the proof of GET /api/crm/parties/:id/timeline: per chit, lib/cost-view costSideOf decides (a supplier bill's `value` is null + cost_hidden:true; a sale stays);
 *           per ledger entry, lib/dues-view R8 blindLedgerEntry (amount_minor null + cost_hidden unless the party is a customer only). The owner and a cost-seeing
 *           actor answer byte for byte alike; the can_see_costs flag is read ONCE per request (the owner reads none); a missing flag row reads as blind.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: routes/crm.js over tests/support/crm-stub.cjs.
 * FLOW      planted bill / invoice / ledger rows → the timeline as owner · cost-allowed actor · blind actor → the hand-computed table below
 * CARD      16-finance/collections
 *
 * HAND-COMPUTED (value as stored; amount_minor in paise). Party BOTH (on both lists): supplier bill 1000, customer invoice 500, ledger bill 100000, ledger receipt 50000.
 *   reader        | bill value | invoice value | ledger (BOTH)  | ledger (customer-only CUS) | ledger (supplier-only SUP)
 *   owner         | 1000       | 500           | 100000 / 50000 | 25000                      | 70000
 *   cost-allowed  | 1000       | 500           | 100000 / 50000 | 25000                      | 70000   (bytes equal the owner's)
 *   blind         | null       | 500           | null / null    | 25000                      | null    (cost_hidden:true on each nulled entry)
 * Run: node tests/rail146h-timeline-cost-blind.test.cjs
 */
'use strict';
const { make, row } = require('./support/crm-stub.cjs');
let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(100) + (ok ? '' : JSON.stringify(got).slice(0, 300) + '   want ' + JSON.stringify(want).slice(0, 200)));
};
const P = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const CUS = P(2), SUP = P(3), BOTH = P(4), BILL = P(11), INV = P(12);
const FLAG = /SELECT can_see_costs FROM identities/, HEADER = /FROM chit_header h WHERE h.entity_id/, ROLES = /FROM unnest\(\$2::uuid\[\]\)/;

(async () => {
  const stub = make(), D = stub.data;
  require('../lib/work-rows').unbilledByParty = async () => null;
  const cust = (id, name) => Object.assign(row({ party_id: id, display_name: name, user_id: name.toLowerCase(), party_no: 'P-' + id.slice(-4) }), { customer_type: 'entity', added_via: 'manual', txn_count: 2, last_txn_at: '2026-09-30T10:00:00Z', groups: [], segment: 'regular' });
  const sup = (id, name) => Object.assign(row({ party_id: id, display_name: name, user_id: name.toLowerCase(), party_no: 'P-' + id.slice(-4), entity_kind: 'business' }), { category: 'goods', preferred: false, added_via: 'manual' });
  D.cust = [cust(CUS, 'Ravi'), cust(BOTH, 'Mill')];
  D.sup = [sup(SUP, 'Anand'), sup(BOTH, 'Mill')];
  D.chits = [
    { chit_id: BILL, counterparty_id: BOTH, direction: 'received', current_status: 'pending', created_at: '2026-09-01T00:00:00.000Z', purpose: 'invoice', value: '1000', currency: 'INR', doc_kind: 'bill', bill_no: 'SB-1', open_disputes: 0, manual_subject: 'Bill SB-1', sender_entity_id: BOTH, all_recipients: [{ entity_id: 'E1' }] },
    { chit_id: INV, counterparty_id: BOTH, direction: 'sent', current_status: 'completed', created_at: '2026-09-02T00:00:00.000Z', purpose: 'invoice', value: '500', currency: 'INR', doc_kind: 'invoice', bill_no: 'INV-1', open_disputes: 0, manual_subject: 'Invoice INV-1', sender_entity_id: 'E1', all_recipients: [{ entity_id: BOTH }] }
  ];
  const led = (party, ref, kind, amount, at) => ({ entity: 'E1', party_id: party, item_id: ref, ref, ref_kind: kind, kind: 'x', amount_minor: String(amount), currency: 'INR', doc_date: '2026-09-01', created_at: at });
  D.ledger = [led(BOTH, 'SB-1', 'bill', 100000, '2026-09-03T00:00:00.000Z'), led(BOTH, 'R-1', 'advance', 50000, '2026-09-04T00:00:00.000Z'), led(CUS, 'INV-9', 'bill', 25000, '2026-09-05T00:00:00.000Z'), led(SUP, 'SB-9', 'bill', 70000, '2026-09-06T00:00:00.000Z')];
  let flagReads = 0, flag = false;
  /* the stand-in answers the two small reads costSideOf needs: the chit's small business_json, and the counterparty's role on the lists */
  const sideReads = (sql, p) => (HEADER.test(sql) ? { rows: p[1].map((id) => ({ chit_id: id, business_json: {} })) } : ROLES.test(sql) ? { rows: p[1].map((id) => ({ id, customer: id === BOTH, supplier: id === BOTH })) } : null);
  D.pre = async (sql, p) => {
    if (FLAG.test(sql)) { flagReads++; return { rows: [{ can_see_costs: flag }] }; }
    return sideReads(sql, p);
  };
  const entry = (r, kind, key, val) => r.body.entries.find((e) => e.kind === kind && e[key] === val);
  const bill = (r) => entry(r, 'chit', 'chit_id', BILL), inv = (r) => entry(r, 'chit', 'chit_id', INV);
  const ledgerOf = (r) => r.body.entries.filter((e) => e.kind === 'ledger').map((e) => [e.ref, e.amount_minor, e.cost_hidden === true]);
  console.log('\n== RAIL-146h · GET /api/crm/parties/:id/timeline ==\n');

  stub.as('E1');
  const oBoth = await stub.get('/parties/' + BOTH + '/timeline'), oCus = await stub.get('/parties/' + CUS + '/timeline'), oSup = await stub.get('/parties/' + SUP + '/timeline');
  t('owner | supplier bill 1000, invoice 500; ledger 100000 / 50000; no marker; no flag read', [bill(oBoth).value, inv(oBoth).value, ledgerOf(oBoth), JSON.stringify(oBoth.body).includes('cost_hidden'), flagReads],
    [1000, 500, [['R-1', 50000, false], ['SB-1', 100000, false]], false, 0]);
  t('owner | the customer-only and supplier-only ledger rows are priced', [ledgerOf(oCus), ledgerOf(oSup)], [[['INV-9', 25000, false]], [['SB-9', 70000, false]]]);

  stub.as('E1', { identity: { identity_id: 'A7', identity_type: 'actor', parent_entity_id: 'E1' } });
  flag = true; flagReads = 0;
  const aBoth = await stub.get('/parties/' + BOTH + '/timeline'), aCus = await stub.get('/parties/' + CUS + '/timeline'), aSup = await stub.get('/parties/' + SUP + '/timeline');
  t('cost-allowed actor | byte-identical to the owner on all three timelines', [JSON.stringify(aBoth.body) === JSON.stringify(oBoth.body), JSON.stringify(aCus.body) === JSON.stringify(oCus.body), JSON.stringify(aSup.body) === JSON.stringify(oSup.body)], [true, true, true]);
  t('cost-allowed actor | can_see_costs read ONCE per request (three requests)', flagReads, 3);

  flag = false; flagReads = 0;
  const bBoth = await stub.get('/parties/' + BOTH + '/timeline'), bCus = await stub.get('/parties/' + CUS + '/timeline'), bSup = await stub.get('/parties/' + SUP + '/timeline');
  t('blind actor | 200 on all three, flag read once per request', [bBoth.status, bCus.status, bSup.status, flagReads], [200, 200, 200, 3]);
  t('blind actor | the supplier bill: value null + cost_hidden, the key stays, bill no / status / title stand', [bill(bBoth).value, bill(bBoth).cost_hidden, 'value' in bill(bBoth), bill(bBoth).bill_no, bill(bBoth).status, bill(bBoth).title], [null, true, true, 'SB-1', 'pending', 'Bill SB-1']);
  t('blind actor | the customer invoice stays 500, no marker (R1)', [inv(bBoth).value, 'cost_hidden' in inv(bBoth)], [500, false]);
  t('blind actor | both-sides party: both ledger entries null + cost_hidden (R3), ref and date stand', [ledgerOf(bBoth), bBoth.body.entries.filter((e) => e.kind === 'ledger').map((e) => e.doc_date)], [[['R-1', null, true], ['SB-1', null, true]], ['2026-09-01', '2026-09-01']]);
  t('blind actor | customer-only party: ledger 25000 stays, no marker', ledgerOf(bCus), [['INV-9', 25000, false]]);
  t('blind actor | supplier-only party: ledger null + cost_hidden', ledgerOf(bSup), [['SB-9', null, true]]);
  const planted = JSON.stringify([bill(bBoth), ledgerOf(bBoth), ledgerOf(bSup)]);
  t('blind actor | whole-body scan of the hidden rows: no planted figure, no rupee sign', [/(^|[^0-9-])(100000|50000|70000)([^0-9-]|$)|"value":1000[,}]/.test(planted), /₹/.test(planted)], [false, false]);
  t('blind actor | the rest of the envelope is the owner\'s (kinds, order, total, next_before)', [bBoth.body.entries.map((e) => e.kind + e.at), bBoth.body.total, bBoth.body.next_before], [oBoth.body.entries.map((e) => e.kind + e.at), oBoth.body.total, oBoth.body.next_before]);

  /* fail closed: no can_see_costs row reads as blind */
  D.pre = async (sql, p) => (FLAG.test(sql) ? { rows: [] } : sideReads(sql, p));
  const closed = await stub.get('/parties/' + BOTH + '/timeline');
  t('fail-closed | no flag row: the supplier bill and the ledger are hidden, 200', [closed.status, bill(closed).value, ledgerOf(closed).map((x) => x[1])], [200, null, [null, null]]);
  /* fail closed: the side read fails → every chit unknown → hidden */
  D.pre = async (sql, p) => {
    if (FLAG.test(sql)) return { rows: [{ can_see_costs: false }] };
    if (HEADER.test(sql)) throw new Error('down');
    return sideReads(sql, p);
  };
  const down = await stub.get('/parties/' + BOTH + '/timeline');
  t('fail-closed | the side read is down: every chit value null, even the invoice', [down.status, bill(down).value, inv(down).value], [200, null, null]);
  stub.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
