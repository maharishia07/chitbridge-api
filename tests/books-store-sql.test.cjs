/**
 * books-store-sql.test.cjs — EVERY STATEMENT IN lib/books-store.js, CALLED ONCE, AGAINST A DB THAT CHECKS IT.
 *
 * The in-memory store proves the logic; this proves the real SQL the logic will send: each statement's bind parameters
 * match its placeholders ($1…$n — the bug combo-templates shipped live, "bind message supplies 1 parameters"), each one
 * names the shop ($1 is the entity: a second fence behind FORCE RLS), and none reads or writes a books table outside the
 * shop's own rows. No database: the statements are only inspected.
 * Run: node tests/books-store-sql.test.cjs
 */
'use strict';
const path = require('path');
process.env.DATABASE_URL = '';
const S = require(path.join(__dirname, '..', 'lib', 'books-store.js'));

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const E = '11111111-1111-4111-8111-111111111111', U = '22222222-2222-4222-8222-222222222222';
const seen = [];
const db = { query: async (text, params) => {
  const ph = (text.match(/\$(\d+)/g) || []).map((s) => Number(s.slice(1)));
  seen.push({ text, params: params || [], max: ph.length ? Math.max.apply(null, ph) : 0 });
  if (/RETURNING next_no - (1|\$4::int)/.test(text)) return { rows: [{ n: 1 }] };   /* L3: nextNo reserves a block of $4 (1 by default) */
  if (/RETURNING entry_id/.test(text)) return { rows: [{ entry_id: U, created_at: new Date() }] };
  if (/RETURNING payment_id/.test(text)) return { rows: [{ payment_id: U }] };
  if (/RETURNING pack_id/.test(text)) return { rows: [{ pack_id: U, created_at: new Date() }] };
  if (/COALESCE\(SUM\(dr_minor\), 0\) AS dr/.test(text)) return { rows: [{ dr: 0, cr: 0 }] };
  return { rows: [] };
} };

const CALLS = {
  setting: [E], saveSetting: [E, { enabled: true, fy_start_month: 7, functional_currency: 'AUD', country: 'AU' }]   /* STD2: money and year stated, or refused */, saveCheck: [E, { ok: true }], accounts: [E], insertAccount: [E, { code: '1300', name: 'x', nature: 'asset' }], setSourceCode: [E, U, '090'], compareReady: [], fxLinesReady: [], fxRatesReady: [], fxRates: [E, { from: 'USD', limit: 10 }], insertFxRates: [E, [{ rate_date: '2026-10-14', from_ccy: 'USD', to_ccy: 'INR', rate: '83.25', source: 'manual', source_ref: null }], U],
  fxRateOn: [E, 'USD', 'INR', '2026-10-31', '2026-10-01'], foreignBalances: [E, { asOf: '2026-10-31', functional: 'INR', party: U, account_ids: [U], currency: 'USD' }], partyNames: [E, [U]], compareSnapshots: [E], compareParts: [E, U], insertComparePart: [E, { snapshot_id: U, label: 'Tally H1', source: 'tally', part: 'tb', period_to: '2026-09-30', currency: 'INR', rows: [] }],
  periods: [E, '2026-27'], periodFigures: [E, '2026-27'], insertPeriod: [E, { fiscal_year: '2026-27', period: 1, start_date: '2026-04-01', end_date: '2026-04-30' }], setPeriodStatus: [E, '2026-27', 1, 'soft_locked', U, 'r'],
  /* CS2: a never-posted ledger re-charted in place (no DELETE on the setup tables) */
  parkChart: [E], rechart: [E, [{ code: '2200', name: 'GST collected', is_group: false, nature: 'liability', role: 'gst_collected', parent_code: '2200', tally_group: 'GST and Statutory Liabilities', sch3_line: 'x', saft_grouping: 'LIABILITY:x' }], { pack_code: 'AU', pack_version: null }],
  relabelPeriods: [E, '2026-27', [{ period: 1, fiscal_year: '2026', start_date: '2026-01-01', end_date: '2026-01-31' }]],
  nextNo: [E, 'JV', '2026-27'], entryBySource: [E, 'chit:x'], postedSources: [E, ['bill:x', 'walkin-late:x']], entry: [E, U], entryLines: [E, '2026-04-01', '2026-04-30', U, U, { limit: 50, after: { date: '2026-04-03', no: 'SV/2026-27/000009' }, noOpening: true }], entries: [E, '2026-04-01', '2026-04-30'], taxEntryLines: [E, '2026-04-01', '2026-04-30', ['tax_setoff', 'tax_payment']],
  /* PERF1: a keyset page and the figures it stands on */
  entryPage: [E, '2026-04-01', '2026-04-30', U, null, { limit: 100, after: null }], pageSums: [E, '2026-04-01', '2026-04-30', U, null, { date: '2026-04-03', no: 'SV/2026-27/000009' }, true],
  yearRows: [E, '2026-27'], ledgerLines: [E, '2026-04-01', '2026-04-30', U], years: [E],
  insertEntry: [E, { entry_no: 'JV/2026-27/000001', posting_date: '2026-04-01', fiscal_year: '2026-27', period: 1, event_type: 'manual', currency: 'INR', total_minor: 1 }],
  insertLines: [E, U, [{ line_no: 1, account_id: U, dr_minor: 1, cr_minor: 0, currency: 'INR' }, { line_no: 2, account_id: U, dr_minor: 0, cr_minor: 1, currency: 'INR' }]],
  addBalances: [E, [{ account_id: U, currency: 'INR', fiscal_year: '2026-27', period: 1, dr_minor: 1, cr_minor: 0, line_count: 1 }]],
  insertItems: [E, [{ party_id: U, account_id: U, side: 'receivable', ref: 'r', against_ref: 'r', ref_kind: 'bill', amount_minor: 1, currency: 'INR' }]],
  periodSums: [E, '2026-27', 0, 5, true], lineSums: [E, '2026-04-01', '2026-04-30', true], firstYear: [E], balanceDrift: [E], unbalancedEntries: [E],
  items: [E, U, U], itemOwners: [E, U, ['r1', 'r2']], itemTotals: [E, U], accountNet: [E, U],
  insertPayment: [E, { party_id: U, direction: 'in', amount_minor: 1, currency: 'INR', mode: 'cash', received_at: '2026-04-01', client_ref: 'c1' }], payment: [E, U], paymentByRef: [E, 'c1'], paymentsSince: [E, U, 'in', '2026-04-01T00:00:00Z'], cheques: [E, false, 200],
  queue: [E, { event: {}, why: 'x' }], waiting: [E, 10], waitingCount: [E], backfillTodo: [E], outboxDone: [E, 1, false, 'why', { todo: 'accept', candidates: [] }], outboxClose: [E, [U], 'Rejected — not posted'], waitOfChitSql: [], logChange: [E, { table_name: 't', field: 'f' }], changes: [E, '2026-04-01', '2026-04-30'],
  terms: [E, U, 'customer'], parties: [E], partyOn: [E, U], supplierByName: [E, { name: 'Sri 50%_Ganesh' }], partyNoOf: [E, U], setPartyNo: [E, U, 'P-00001'], billNos: [E, [U]],
  lastPack: [E], insertPack: [E, { pack_id: U, kind: 'month', sha256: 'x', manifest: {} }], packs: [E], pack: [E, U], ackPack: [E, U, U],
  counterBills: [E, 'C1', '2026-04-01T00:00:00Z', '2026-04-02T00:00:00Z'], countersBilling: [E, '2026-04-01T00:00:00Z', '2026-04-02T00:00:00Z'],
  unpostedChits: [E, '2026-04-01T00:00:00Z', '2026-04-02T00:00:00Z', 200], openDisputes: [E, U],
  /* M30 · the payment advice (b285) */
  adviceReady: [E], paymentsAdvice: [E, [U]], setAdvice: [E, U, { advice_chit_id: U, advice_shared_at: null }], adviceStates: [E, [U]], paymentsNeedingAdvice: [E, 50], shopName: [E], bankRailChits: [E, '2026-10-01', '2026-10-31', 500],
};

(async () => {
  console.log('\n══ lib/books-store.js — every statement, inspected ══\n');
  const fns = Object.keys(S).filter((k) => typeof S[k] === 'function');
  const untested = fns.filter((k) => !CALLS[k]);
  ok('every store function is called by this test', untested.length === 0, 'not called: ' + untested.join(', '));
  const bad = [], unscoped = [];
  for (const k of fns) {
    if (!CALLS[k]) continue;
    const from = seen.length;
    try { await S[k].apply(null, [db].concat(CALLS[k])); } catch (e) { bad.push(k + ': threw ' + e.message); continue; }
    seen.slice(from).forEach((q) => {
      if (q.params.length !== q.max) bad.push(k + ': $' + q.max + ' in the SQL, ' + q.params.length + ' params');
      if (q.params[0] !== E) unscoped.push(k);
    });
  }
  ok('every statement binds exactly the parameters its SQL names', bad.length === 0, bad.join(' · '));
  ok('every statement names the shop as $1 (a fence behind RLS)', unscoped.length === 0, 'unscoped: ' + Array.from(new Set(unscoped)).join(', '));
  ok('no statement reaches another shop through a books table without entity_id / owner_entity_id', seen.every((q) => !/\b(journal_entry|journal_line|account_balance|party_item|ledger_account|books_\w+|fiscal_period)\b/.test(q.text)
    || /(entity_id|owner_entity_id)\s*=\s*\$1|VALUES \(\$1|INSERT INTO \w+ \((pack_id, )?entity_id/.test(q.text) || /WHERE \w+\.entity_id = \$1|WHERE l\.entity_id = \$1|WHERE b\.entity_id = \$1|WHERE h\.entity_id = \$1/.test(q.text)),
    seen.filter((q) => /\b(journal_entry|journal_line|account_balance|party_item)\b/.test(q.text) && !/entity_id/.test(q.text)).map((q) => q.text.slice(0, 80)).join(' | '));
  /* ── STD1: the wait kind is data; old rows classified by ONE fragment; one count; one resolver ── */
  {
    seen.length = 0;
    await S.waitingCount(db, E); const cnt = seen[0].text;
    ok('STD1 · waitingCount: ONE GROUP BY over every open row (no LIMIT) by TODO_SQL', /GROUP BY 1/.test(cnt) && !/LIMIT/.test(cnt) && cnt.indexOf(S.TODO_SQL) >= 0, cnt);
    seen.length = 0; await S.waiting(db, E, 50); const wq = seen[0].text;
    ok('STD1 · waiting(): each row carries todo + name from the SAME fragments', wq.indexOf(S.TODO_SQL + ' AS todo') >= 0 && wq.indexOf(S.NAME_SQL + ' AS name') >= 0, wq.slice(0, 200));
    seen.length = 0; await S.backfillTodo(db, E); const bf = seen[0].text;
    ok('STD1 · backfillTodo: writes todo (+ name) ONCE, only on open rows that lack it, from the same fragment', /UPDATE books_outbox SET event/.test(bf) && /NOT \(COALESCE\(event, '\{\}'::jsonb\) \? 'todo'\)/.test(bf) && /done_at IS NULL/.test(bf) && bf.indexOf(S.TODO_SQL) >= 0, bf);
    ok('STD1 · TODO_SQL: the row\'s own todo first; an old row by its parked kind (acceptance → accept · party "Who is" → add_supplier · else record)',
      /^COALESCE\(event->>'todo'/.test(S.TODO_SQL) && /'acceptance' THEN 'accept'/.test(S.TODO_SQL) && /'party' AND why LIKE 'Who is %' THEN 'add_supplier' ELSE 'record'/.test(S.TODO_SQL), S.TODO_SQL);
    ok('STD1 · the chit read\'s wait is the same fragments, for one chit', S.waitOfChitSql('$1', '$2').indexOf(S.TODO_SQL) >= 0 && /source_chit_id = \$2 AND done_at IS NULL/.test(S.waitOfChitSql('$1', '$2')));
    seen.length = 0; await S.supplierByName(db, E, { name: ' Sri 50%_Ganesh ' }); const sb = seen[0];
    ok('STD1 · supplierByName by name: ONE statement — exact name/nickname (trimmed) + near matches, LIKE escaped, prefix first', seen.length === 1 && sb.params[1] === 'Sri 50%_Ganesh'
      && sb.params[2] === '%sri 50\\%\\_ganesh%' && sb.params[3] === 'sri 50\\%\\_ganesh%' && /AS exact/.test(sb.text) && /LIMIT 5/.test(sb.text), JSON.stringify(sb.params));
    seen.length = 0; await S.supplierByName(db, E, { party_no: 'P-00001' });
    ok('STD1 · supplierByName by party no.: that number on MY list only', seen.length === 1 && /s\.party_no = \$2/.test(seen[0].text) && seen[0].params[1] === 'P-00001');
    const dbq = { query: async () => ({ rows: [{ party_id: U, name: 'Sri Ganesh Provisions', party_no: 'P-1', exact: true }, { party_id: 'x', name: 'Sri Ganesh Traders', party_no: 'P-2', exact: false }] }) };
    const r1 = await S.supplierByName(dbq, E, { name: 'Sri Ganesh Provisions' });
    const dbq2 = { query: async () => ({ rows: [{ party_id: U, name: 'Sri Ganesh', party_no: 'P-1', exact: true }, { party_id: 'x', name: 'Sri Ganesh', party_no: 'P-2', exact: true }, { party_id: 'y', name: 'Sri Ganesh Provisions', party_no: null, exact: false }] }) };
    const r2 = await S.supplierByName(dbq2, E, { name: 'Sri Ganesh' });
    ok('STD1 · exactly one exact → the party, no near list; two exact → nobody, the near list (≤ 3, names + party_no only)',
      JSON.stringify([r1, r2]) === JSON.stringify([{ one: { party_id: U, name: 'Sri Ganesh Provisions', party_no: 'P-1' }, near: [] },
        { one: null, near: [{ name: 'Sri Ganesh', party_no: 'P-1' }, { name: 'Sri Ganesh', party_no: 'P-2' }, { name: 'Sri Ganesh Provisions', party_no: null }] }]), JSON.stringify([r1, r2]));
  }
  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks (' + seen.length + ' statements)\n');
  process.exit(fail ? 1 : 0);
})();
