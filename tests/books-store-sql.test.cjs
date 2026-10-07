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
  if (/RETURNING next_no - 1/.test(text)) return { rows: [{ n: 1 }] };
  if (/RETURNING entry_id/.test(text)) return { rows: [{ entry_id: U, created_at: new Date() }] };
  if (/RETURNING payment_id/.test(text)) return { rows: [{ payment_id: U }] };
  if (/RETURNING pack_id/.test(text)) return { rows: [{ pack_id: U, created_at: new Date() }] };
  if (/COALESCE\(SUM\(dr_minor\), 0\) AS dr/.test(text)) return { rows: [{ dr: 0, cr: 0 }] };
  return { rows: [] };
} };

const CALLS = {
  setting: [E], saveSetting: [E, { enabled: true }], saveCheck: [E, { ok: true }], accounts: [E], insertAccount: [E, { code: '1300', name: 'x', nature: 'asset' }],
  periods: [E, '2026-27'], insertPeriod: [E, { fiscal_year: '2026-27', period: 1, start_date: '2026-04-01', end_date: '2026-04-30' }], setPeriodStatus: [E, '2026-27', 1, 'soft_locked', U, 'r'],
  nextNo: [E, 'JV', '2026-27'], entryBySource: [E, 'chit:x'], postedSources: [E, ['bill:x', 'walkin-late:x']], entry: [E, U], entryLines: [E, '2026-04-01', '2026-04-30', U, U], entries: [E, '2026-04-01', '2026-04-30'],
  yearRows: [E, '2026-27'], ledgerLines: [E, '2026-04-01', '2026-04-30', U], years: [E],
  insertEntry: [E, { entry_no: 'JV/2026-27/000001', posting_date: '2026-04-01', fiscal_year: '2026-27', period: 1, event_type: 'manual', currency: 'INR', total_minor: 1 }],
  insertLines: [E, U, [{ line_no: 1, account_id: U, dr_minor: 1, cr_minor: 0, currency: 'INR' }, { line_no: 2, account_id: U, dr_minor: 0, cr_minor: 1, currency: 'INR' }]],
  addBalances: [E, [{ account_id: U, currency: 'INR', fiscal_year: '2026-27', period: 1, dr_minor: 1, cr_minor: 0, line_count: 1 }]],
  insertItems: [E, [{ party_id: U, account_id: U, side: 'receivable', ref: 'r', against_ref: 'r', ref_kind: 'bill', amount_minor: 1, currency: 'INR' }]],
  periodSums: [E, '2026-27', 0, 5, true], lineSums: [E, '2026-04-01', '2026-04-30', true], firstYear: [E], balanceDrift: [E], unbalancedEntries: [E],
  items: [E, U, U], itemOwners: [E, U, ['r1', 'r2']], itemTotals: [E, U], accountNet: [E, U],
  insertPayment: [E, { party_id: U, direction: 'in', amount_minor: 1, currency: 'INR', mode: 'cash', received_at: '2026-04-01', client_ref: 'c1' }], payment: [E, U], paymentByRef: [E, 'c1'], cheques: [E, false, 200],
  queue: [E, { event: {}, why: 'x' }], waiting: [E, 10], waitingCount: [E], outboxDone: [E, 1, false, 'why'], logChange: [E, { table_name: 't', field: 'f' }], changes: [E, '2026-04-01', '2026-04-30'],
  terms: [E, U, 'customer'], parties: [E], partyOn: [E, U], partyNoOf: [E, U], setPartyNo: [E, U, 'P-00001'], billNos: [E, [U]],
  lastPack: [E], insertPack: [E, { pack_id: U, kind: 'month', sha256: 'x', manifest: {} }], packs: [E], pack: [E, U], ackPack: [E, U, U],
  counterBills: [E, 'C1', '2026-04-01T00:00:00Z', '2026-04-02T00:00:00Z'], countersBilling: [E, '2026-04-01T00:00:00Z', '2026-04-02T00:00:00Z'],
  unpostedChits: [E, '2026-04-01T00:00:00Z', '2026-04-02T00:00:00Z', 200], openDisputes: [E, U],
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
  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks (' + seen.length + ' statements)\n');
  process.exit(fail ? 1 : 0);
})();
