#!/usr/bin/env node
// @type: unit
/**
 * tests/wages-moved-1126.test.cjs — F-66 (batch 1126): wages moved 5100 -> 6015 (engines v1.102.0). A shop seeded before keeps its 5100 ledger (insert-only books);
 * a wages posting now lands on 6015 (the role is unique per shop, so the old ledger is unseated, never deleted or renamed), the P&L reads the old 5100 rows as
 * operating expenses on the SAME statement line as 6015, and the old ledger is never mistaken for a ledger the shop added (it would clash with the pack).
 * Hand figures: wages 5100 = 100.00, 6015 = 50.00 -> one line "employee_benefits" 150.00 in operating expenses; the gross profit is not touched.
 * OWNS      the F-66 api half        CALLED BY npm test        CARD  26-reporting-mis-and-bi
 */
'use strict';
process.env.NODE_ENV = 'test';
const path = require('path');
const assert = require('assert');
const lib = (n) => require(path.join(__dirname, '..', 'lib', n));
const B = lib('books'), E = lib('books-engines'), R = lib('books-report-period');
const pack = lib('accounts-packs').packFor('AU');
const old = { account_id: 'a-5100', code: '5100', role: 'wages', name: 'Wages', is_group: false };
const index = () => ({ byRole: new Map([['wages', Object.assign({}, old)]]), byCode: new Map([['5100', old]]) });
const line = { account: 'wages', code: '6015' };
/* 1 · a wages line for 6015 finds no ledger while the shop holds the role on 5100 (retired): first use adds 6015 */
assert.strictEqual(B.movedLedgerHolder({ country: 'AU' }, index(), line), null);
/* a shop whose OWN code holds a role (move-in role ledgers) is untouched; a line without a code still goes by role; the same code is itself */
assert.strictEqual(B.movedLedgerHolder({ country: 'AU' }, index(), { account: 'wages' }).code, '5100');
assert.strictEqual(B.movedLedgerHolder({ country: 'AU' }, index(), { account: 'wages', code: '5100' }).code, '5100');
const own = { byRole: new Map([['bank', { code: 'B-1', role: 'bank' }]]), byCode: new Map() };
assert.strictEqual(B.movedLedgerHolder({ country: 'AU' }, own, { account: 'bank', code: '1200' }).code, 'B-1');
/* 2 · first use unseats the old role holder (UPDATE role = NULL on 5100 only) and the role is free for 6015 */
(async () => {
  const sql = [];
  const db = { query: async (text, args) => { sql.push([text, args]); return { rowCount: 1, rows: [{ account_id: 'x' }] }; } };
  const idx = index();
  await B.handBackRole(db, 'e1', idx.byRole, { code: '6015', role: 'wages' });
  assert.ok(/UPDATE ledger_account SET role = NULL/.test(sql[0][0]) && sql[0][1][1] === 'a-5100', 'the old ledger is unseated, by id');
  assert.ok(!idx.byRole.has('wages'), 'the role is free');
  const none = [];
  await B.handBackRole({ query: async (t) => { none.push(t); return { rowCount: 0, rows: [] }; } }, 'e1', new Map([['wages', { code: '6015', account_id: 'b' }]]), { code: '6015', role: 'wages' });
  assert.strictEqual(none.length, 0, 'the same code holding the role: nothing written');
  /* 3 · the unseated 5100 (role null, parked under cost of sales) is NOT a shop-added ledger (withAccounts would refuse its clash with the retired code) */
  const chart = [{ account_id: 'g', code: 'G5100', is_group: true, name: 'Cost of sales' }, { account_id: 'g6', code: 'G6000', is_group: true, name: 'Operating expenses' }, { account_id: 'a-5100', code: '5100', role: null, is_group: false, active: true, parent_id: 'g', name: 'Wages' }, { account_id: 'a-7', code: '6999', role: null, is_group: false, active: true, parent_id: 'g6', name: 'Shop own' }];
  const own2 = E.shopAccounts(pack, chart);
  assert.deepStrictEqual(own2.map((x) => x.code), ['6999']);
  assert.ok(E.packWith(pack, chart), 'the pack plus the shop ledgers builds');
  /* 4 · the P&L: 5100 (old rows) and 6015 land on ONE operating line; gross profit does not take wages off */
  const L = lib('ledger');
  const lines = [
    { entry_id: 1, jv_no: 'JV1', line_no: 1, date: '2026-10-05', fiscal_year: '2026-27', period: 4, code: '5100', dr_minor: 10000, cr_minor: 0 },
    { entry_id: 1, jv_no: 'JV1', line_no: 2, date: '2026-10-05', fiscal_year: '2026-27', period: 4, code: '1200', dr_minor: 0, cr_minor: 10000 },
    { entry_id: 2, jv_no: 'JV2', line_no: 1, date: '2026-11-05', fiscal_year: '2026-27', period: 5, code: '6015', dr_minor: 5000, cr_minor: 0 },
    { entry_id: 2, jv_no: 'JV2', line_no: 2, date: '2026-11-05', fiscal_year: '2026-27', period: 5, code: '1200', dr_minor: 0, cr_minor: 5000 }
  ];
  const pl = L.profitAndLoss({ pack, lines, from: '2026-07-01', to: '2026-11-30' });
  assert.strictEqual(pl.total_expenses_minor, 15000);
  const wages = pl.expenses.filter((x) => /employee_benefits/.test(JSON.stringify(x)) || x.role === 'wages');
  assert.strictEqual(wages.length, 1, 'one wages line: ' + JSON.stringify(pl.expenses));
  assert.strictEqual(wages[0].amount_minor, 15000);
  assert.ok(!R.COST_OF_SALES_ROLES.includes('wages'), 'wages are not a direct cost');
  console.log('wages-moved-1126: ok (150.00 on one operating line)');
})().catch((e) => { console.error(e); process.exit(1); });
