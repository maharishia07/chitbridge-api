/**
 * tests/crm-d7-unbilled-by-currency.test.cjs — CRM-D7/CRM-D2: a party's "not billed yet" figure is one total PER CURRENCY, never added across, and the record door carries it.
 *
 * OWNS      the proof that lib/work-rows sumUnbilled (the ONE sum, over lib/money summarise, integer minor units) answers by_currency / no_currency / unpriced; that a currency-less
 *           order is counted but its money left out; that a blind reader hides the whole party (no by_currency); and that GET /api/crm/parties/:id carries the same `unbilled` as the list row.
 * CALLED BY scripts/guards.cjs · CI. No database, no network (tests/support/work-stub.cjs, crm-stub.cjs). Figures hand-computed in minor units.
 * CARD      11-crm-and-marketing/crm-routes
 *
 * Run: node tests/crm-d7-unbilled-by-currency.test.cjs
 */
'use strict';
let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(96) + (ok ? '' : JSON.stringify(got) + '   want ' + JSON.stringify(want)));
};
const P = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');

async function partOne() {
  const S = require('./support/work-stub.cjs');
  const { D, E1, copy, seed } = S;
  const W = require('../lib/work-rows');
  /** one party P(1) with these orders [value, currency]; answers what unbilledByParty says for it */
  const ask = async (orders, blind) => {
    seed();
    D.copies = orders.map(([value, currency], i) => copy(i + 1, { counterparty_id: P(1), sender_entity_id: P(1), value, currency }));
    D.detail = {}; D.marks = []; D.progress = []; D.assign = [];
    D.roles = { [P(1)]: blind ? { supplier: true } : { customer: true } }; /* a blind reader's hidden case: the party is a supplier (a purchase), not the reader's sale */
    D.bj = Object.fromEntries(D.copies.map((c) => [c.chit_id, {}]));
    D.canSeeCosts = !blind;
    return (await W.unbilledByParty({ entity: E1, actor: 'A7', blind: !!blind })).get(P(1));
  };
  console.log('\n== CRM-D7 part 1 · sumUnbilled by currency ==\n');
  /* A INR 500.00, B INR 340.00, C AUD 90.00, D AUD 60.00, E no currency 70.00 */
  const A = ['500.00', 'INR'], B = ['340.00', 'INR'], C = ['90.00', 'AUD'], Dd = ['60.00', 'AUD'], E = ['70.00', null];
  t('INR only: 50000 + 34000 = 84000', await ask([A, B]), { n: 2, minor: 84000, currency: 'INR', by_currency: [{ currency: 'INR', minor: 84000, n: 2 }], no_currency: 0, unpriced: 0 });
  t('AUD only: 9000 + 6000 = 15000', await ask([C, Dd]), { n: 2, minor: 15000, currency: 'AUD', by_currency: [{ currency: 'AUD', minor: 15000, n: 2 }], no_currency: 0, unpriced: 0 });
  const mixed = await ask([A, B, C, Dd]);
  t('INR + AUD: two buckets, biggest first, minor null (never 99000)', mixed, { n: 4, minor: null, currency: null, by_currency: [{ currency: 'INR', minor: 84000, n: 2 }, { currency: 'AUD', minor: 15000, n: 2 }], no_currency: 0, unpriced: 0 });
  t('INR + AUD: no figure of 99000 anywhere in the answer', JSON.stringify(mixed).includes('99000'), false);
  t('a missing currency: 7000 in no bucket, counted, the reader\'s currency never assumed (old answer: two currencies, minor null)', await ask([A, E]), { n: 2, minor: 50000, currency: 'INR', by_currency: [{ currency: 'INR', minor: 50000, n: 1 }], no_currency: 1, unpriced: 0 });
  t('only a currency-less order: no bucket, minor null (count alone), no_currency 1', await ask([E]), { n: 1, minor: null, currency: null, by_currency: [], no_currency: 1, unpriced: 0 });
  t('an unpriced order (currency, no value): counted, adds nothing, never a wrong 0', await ask([A, ['0', 'INR']]), { n: 2, minor: 50000, currency: 'INR', by_currency: [{ currency: 'INR', minor: 50000, n: 1 }], no_currency: 0, unpriced: 1 });
  t('only unpriced orders: minor null, not 0', (await ask([['0', 'INR']])).minor, null);
  t('JPY (0 decimals): 500 = 500 minor', (await ask([['500', 'JPY']])).by_currency, [{ currency: 'JPY', minor: 500, n: 1 }]);
  t('KWD (3 decimals): 12.345 = 12345 minor, + 0.005 = 12350', (await ask([['12.345', 'KWD'], ['0.005', 'KWD']])).by_currency, [{ currency: 'KWD', minor: 12350, n: 2 }]);
  const hidden = await ask([A, C], true);
  t('blind reader on a purchase mix: whole party hidden, no by_currency, no per-currency figure', hidden, { n: 2, minor: null, currency: null, cost_hidden: true });
  t('blind reader: no AUD, no 50000, no 9000 anywhere', /AUD|50000|9000/.test(JSON.stringify(hidden)), false);
}

async function partTwo() {
  const { make, row } = require('./support/crm-stub.cjs');
  const stub = make(), D = stub.data;
  const WR = require('../lib/work-rows');
  console.log('\n== CRM-D7 part 2 · GET /api/crm/parties/:id carries the list row\'s figure ==\n');
  D.cust = [Object.assign(row({ party_id: P(2), display_name: 'Mill', user_id: 'mill', party_no: 'P-0002' }), { customer_type: 'entity', added_via: 'manual', txn_count: 1, last_txn_at: '2026-09-30T10:00:00Z', groups: [], segment: 'regular' })];
  D.stored.customer[P(2)] = { party_no: 'P-0002', balance_minor: 0 };
  const figure = { n: 4, minor: null, currency: null, by_currency: [{ currency: 'INR', minor: 84000, n: 2 }, { currency: 'AUD', minor: 15000, n: 2 }], no_currency: 0, unpriced: 0 };
  let truncated = false;
  WR.unbilledByParty = async () => (truncated ? null : new Map([[P(2), figure]]));
  stub.as('E1');
  const list = await stub.get('/parties'), rec = await stub.get('/parties/' + P(2));
  t('record: 200, unbilled = the list row\'s (one source, two doors)', [rec.status, rec.body.unbilled], [200, list.body.parties.find((p) => p.party_id === P(2)).unbilled]);
  t('record: by_currency has both currencies', rec.body.unbilled.by_currency.map((b) => b.currency), ['INR', 'AUD']);
  truncated = true;
  const cut = await stub.get('/parties/' + P(2));
  t('truncated shop: unbilled absent, never a wrong 0', [cut.status, 'unbilled' in cut.body], [200, false]);
  stub.close();
}

(async () => {
  await partOne();
  await partTwo();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
