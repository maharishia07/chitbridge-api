#!/usr/bin/env node
/**
 * acc-75-cost-ledger-only.test.cjs — ACC-75 (proof 2026-11-14): cost lives ONLY in the ledger (chit_line_cost); chit_header has no cost column, and cost.read answers from the ledger.
 * @type regression
 * OWNS      the proof that (1) no migration gives chit_header a cost column (baseline CREATE TABLE + every ALTER TABLE chit_header ADD COLUMN), (2) lib/cost.read gets its figures from
 *           chit_line_cost rows, sums them PER CURRENCY (never across), and takes the margin from the chit's TAXABLE value (tax is not income): invoiced - spent, an unknown figure stays null.
 * CALLED BY scripts/guards.cjs · CI. No database: a stand-in db answers the two statements cost.read asks.
 * FLOW      migrations text -> column names of chit_header | stand-in db (chit_line_cost rows + the chit's money block) -> cost.read -> carried totals
 *
 * THE HAND CASE (INR chit, 18% tax): taxable 2000.00 + tax 360.00 = total 2360.00. Costs: goods 1000.50 + goods 249.50 + labour 500.00 (INR) and transport 10.00 (USD).
 *   by_kind  goods 1250.00 · labour 500.00 · transport 10.00        by_currency  INR 1750.00 · USD 10.00 (USD never added to INR; mixed_currency true)
 *   spent = INR 1750.00 ; margin = 2000.00 - 1750.00 = 250.00 (NOT 2360 - 1750 = 610: tax is not income) ; margin_pct = 250 / 2000 x 100 = 12.5
 * Run: node tests/acc-75-cost-ledger-only.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
process.env.NODE_ENV = 'test';
const { API, ok, done, mock, standInDb } = require('./lib/cat-proof-kit.cjs');

/* 1 - the columns of chit_header, from the schema files */
const sqlFiles = [];
const addDir = (dir) => fs.existsSync(dir) && fs.readdirSync(dir).filter((n) => /\.sql$/.test(n)).forEach((n) => sqlFiles.push(path.join(dir, n)));
addDir(API); addDir(path.join(API, 'migrations')); addDir(path.join(API, 'db'));
const columns = new Set();
for (const f of sqlFiles) {
  const text = fs.readFileSync(f, 'utf8');
  const create = text.match(/CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?chit_header \(([\s\S]*?)\n\);/);
  if (create) create[1].split('\n').forEach((l) => { const m = l.match(/^\s+([a-z_0-9]+)\s+[a-z]/); if (m && !/^(constraint|primary|unique|check|foreign)$/.test(m[1])) columns.add(m[1]); });
  const alter = /ALTER TABLE\s+(?:ONLY\s+)?(?:IF EXISTS\s+)?(?:public\.)?chit_header\b([^;]*);/gi;
  let a;
  while ((a = alter.exec(text))) { const add = /ADD COLUMN\s+(?:IF NOT EXISTS\s+)?([a-z_0-9]+)/gi; let c; while ((c = add.exec(a[1]))) columns.add(c[1].toLowerCase()); }
}
ok('the schema files give chit_header its columns (found ' + columns.size + ', incl. summary_json and currency_code)', columns.size > 15 && columns.has('summary_json') && columns.has('currency_code'), [...columns].join());
ok('no chit_header column is a cost (cost is ledger-only)', ![...columns].some((c) => /cost/.test(c)), [...columns].filter((c) => /cost/.test(c)).join());

/* 2 - cost.read answers from the ledger */
const rowsLedger = [
  { cost_id: 'c1', kind: 'goods', amount: '1000.50', currency: 'INR' },
  { cost_id: 'c2', kind: 'goods', amount: '249.50', currency: 'INR' },
  { cost_id: 'c3', kind: 'labour', amount: '500.00', currency: 'INR' },
  { cost_id: 'c4', kind: 'transport', amount: '10.00', currency: 'USD' }
];
const header = { total_value: '2360.00', currency_code: 'INR', summary_json: { money: { taxable: 2000, tax: 360, total: 2360 } }, business_json: null };
const { db, calls } = standInDb((sql) => (/FROM chit_line_cost/.test(sql) ? { rows: rowsLedger } : /FROM chit_detail/.test(sql) ? { rows: [header] } : null));
mock('db/index.js', db);
const cost = require(path.join(API, 'lib', 'cost'));
const UUID = '11111111-1111-4111-8111-111111111111';
(async () => {
  const r = await cost.read(UUID, UUID, { permitted: true });
  ok('by_kind: goods 1250 (1000.50 + 249.50), labour 500, transport 10', r && r.by_kind.goods === 1250 && r.by_kind.labour === 500 && r.by_kind.transport === 10, JSON.stringify(r && r.by_kind));
  ok('by_currency: INR 1750, USD 10 - never added across currencies', r && r.by_currency.INR === 1750 && r.by_currency.USD === 10 && r.mixed_currency === true, JSON.stringify(r && r.by_currency));
  ok('invoiced is the TAXABLE 2000 (not the 2360 total), in the chit currency INR', r && r.invoiced === 2000 && r.currency === 'INR', JSON.stringify(r && [r.invoiced, r.currency]));
  ok('spent 1750, margin 250 (2000 - 1750), margin_pct 12.5', r && r.spent === 1750 && r.margin === 250 && r.margin_pct === 12.5, JSON.stringify(r && [r.spent, r.margin, r.margin_pct]));
  ok('the costs came from chit_line_cost and no statement asked chit_header for a cost column', calls.some((c) => /FROM chit_line_cost/.test(c.sql)) && !calls.some((c) => /h\.[a-z_]*cost/i.test(c.sql)), calls.map((c) => c.sql.slice(0, 60)).join(' | '));
  const blind = await cost.read(UUID, UUID, { permitted: false, actor_id: UUID });
  ok('a cost-blind reader gets rows only: no totals, no margin key at all', blind && blind.mine_only === true && blind.can_see_totals === false && !('margin' in blind) && !('spent' in blind), JSON.stringify(blind && Object.keys(blind)));
  done();
})();
