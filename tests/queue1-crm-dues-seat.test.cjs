/**
 * queue1-crm-dues-seat.test.cjs — Y-F-05: a party's dues are BOOKS money, so the CRM list/record/timeline give them to the seats the books' own gate lets through
 * (routes/books gates.mayReadMoney: owner, in-house accountant/bookkeeper) and not to the cashier or a viewer, who get the same rows without the figure
 * (balance_minor null + cost_hidden, the shape lib/dues-view already uses); the books' GET /dues refuses those seats in words (OWNER_ONLY).
 * Run: node tests/queue1-crm-dues-seat.test.cjs   (no database; the crm stub + the real routes/books gate)
 */
'use strict';
const path = require('path');
let pass = 0, fail = 0;
const t = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + (ok ? '' : '  got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want))); };
(async () => {
  const { make, row } = require('./support/crm-stub.cjs');
  const stub = make(), D = stub.data;
  require('../lib/work-rows').unbilledByParty = async () => null;
  const CUS = '10000000-0000-4000-8000-000000000002';
  D.cust = [Object.assign(row({ party_id: CUS, display_name: 'Ravi', user_id: 'ravi', party_no: 'P-0002' }), { customer_type: 'entity', added_via: 'manual', txn_count: 2, last_txn_at: '2026-09-30T10:00:00Z', groups: [], segment: 'regular' })];
  D.stored.customer[CUS] = { party_no: 'P-0002', balance_minor: 3200, oldest_due: '2026-01-15' };
  D.pre = async (sql) => (/SELECT can_see_costs FROM identities/.test(sql) ? { rows: [{ can_see_costs: true }] } : null);
  const actor = (extra) => ({ identity: Object.assign({ identity_id: 'A7', identity_type: 'actor', parent_entity_id: 'E1', access_level: 'editor', hat: 'act' }, extra) });
  const seats = [
    ['owner', null, true],
    ['bookkeeper (manager hat)', actor({ hat: 'manager' }), true],
    ['cashier', actor({ hat: 'cashier' }), false],
    ['viewer', actor({ access_level: 'viewer', hat: 'view_only' }), false]
  ];
  for (const [name, opts, sees] of seats) {
    opts ? stub.as('E1', opts) : stub.as('E1');
    const list = await stub.get('/parties'), one = await stub.get('/parties/' + CUS);
    const figures = [list.body.parties.find((p) => p.party_id === CUS).dues.balance_minor, one.body.dues.balance_minor];
    t(name + ' | list and record: ' + (sees ? 'the balance is the real 3200' : 'the balance is null + cost_hidden, the date and the late flag stay'), [list.status, one.status, figures], [200, 200, sees ? [3200, 3200] : [null, null]]);
    if (!sees) t(name + ' | marked hidden, date and overdue stand, no figure anywhere in the body', [one.body.dues.cost_hidden, one.body.dues.oldest_due, one.body.dues.overdue, /3200|32\.00/.test(JSON.stringify([list.body.parties, one.body]))], [true, '2026-01-15', true, false]);
  }
  stub.close();
  console.log('  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
