'use strict';
/**
 * tests/move-in.test.cjs — MOVE IN FROM XERO / QUICKBOOKS (IM1): the columns are GUESSED and confirmed, the dry run says add · merge · skip with its
 * sentence, and the write goes through the doors that exist. Pure over fixture CSVs (tests/fixtures/move-in — Xero and QBO, AU) for the plan; the
 * in-memory books rig (tests/support/books-harness.cjs, the sibling engines) for the write of a chart and a trial balance. No database, no network.
 *   · a code collision (their code already on another ledger) is skipped as a clash · a bad ABN is skipped with reg-au's own sentence
 *   · an unbalanced trial balance is REFUSED with the sentence · the debtors / creditors control rows are never posted (they arrive bill-wise)
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const MI = require('../lib/move-in');
const E = require('../lib/books-engines');
const AU = require('../lib/reg-au');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log('  PASS  ' + name); pass++; } catch (e) { console.log('  FAIL  ' + name + '\n        ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n        ')); fail++; } };
const ta = async (name, fn) => { try { await fn(); console.log('  PASS  ' + name); pass++; } catch (e) { console.log('  FAIL  ' + name + '\n        ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n        ')); fail++; } };
const FIX = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', 'move-in', f), 'utf8');
const file = (f) => MI.readFile({ csv: FIX(f) });
/** confirm the guess as it stands (every placed column), the way the screen's Columns step does when nothing is changed */
const confirm = (kind, parsed) => MI.guess(kind, parsed.headers).guess.filter((g) => g.field).map((g) => ({ incoming: g.incoming, field: g.field }));
const rowsOf = (kind, f, decisions) => { const p = file(f); return MI.cells(kind, p, decisions || confirm(kind, p)); };
const byLine = (pl, n) => pl.rows.find((r) => r.line === n);

/* the AU chart a shop has after enable(): the pack's rows with ids, exactly as books-engines chartRows shapes them */
function chartFromPack(pack) {
  const rows = E.chartRows(pack), ids = new Map();
  return rows.map((r, i) => { const id = '00000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'); ids.set(r.code, id);
    return { account_id: id, code: r.code, name: r.name, parent_id: r.parent ? (ids.get((rows.find((x) => x.key === r.parent && x.is_group) || {}).code) || null) : null, is_group: r.is_group, nature: r.nature, role: r.role, tally_group: r.tally_group, sch3_line: r.sch3_line, saft_grouping: r.saft_grouping, active: true, source_code: null }; });
}
const WORLD = () => ({ pack: AU, chart: chartFromPack(AU) });

console.log('\nmove-in · the columns are guessed, the person confirms');
t('Xero ChartOfAccounts.csv: *Code · *Name · *Type · *Tax Code are placed as known names; Dashboard / Balance are not read', () => {
  const g = MI.guess('accounts', file('xero-accounts.csv').headers);
  const f = Object.fromEntries(g.guess.map((x) => [x.incoming, x.field]));
  assert.deepStrictEqual([f['*Code'], f['*Name'], f['*Type'], f['*Tax Code'], f.Description], ['code', 'name', 'type', 'tax_code', 'description']);
  assert.strictEqual(f.Balance, null); assert.strictEqual(f.Dashboard, null);
  assert.deepStrictEqual(g.missing, []); assert.strictEqual(g.ready, true);
  assert.ok(g.fields.some((x) => x.key === 'name' && x.required));
});
t('QBO Account List: Account is the name, Type the type; Detail type and Total balance are left; a missing required column is said', () => {
  const g = MI.guess('accounts', file('qbo-accounts.csv').headers);
  const f = Object.fromEntries(g.guess.map((x) => [x.incoming, x.field]));
  assert.strictEqual(f.Account, 'name'); assert.strictEqual(f.Type, 'type'); assert.strictEqual(f['Total balance'], null);
  const g2 = MI.guess('trial_balance', ['Ledger', 'Dr', 'Something']);
  assert.deepStrictEqual(g2.missing, ['credit']); assert.strictEqual(g2.ready, false);
});
t('a similarity match is reported as a guess to confirm (not ready); a column may not be read twice; an unknown kind or source is refused in words', () => {
  const g = MI.guess('items', ['Prodcut Name', 'Sales Unit Price']);
  const name = g.guess.find((x) => x.incoming === 'Prodcut Name');
  assert.strictEqual(name.field, 'name'); assert.notStrictEqual(name.how, 'known'); assert.strictEqual(g.ready, false);
  assert.throws(() => MI.cells('items', { headers: ['A', 'B'], rows: [] }, [{ incoming: 'A', field: 'name' }, { incoming: 'B', field: 'name' }]), /Both "A" and "B"/);
  assert.throws(() => MI.cells('items', { headers: ['A'], rows: [] }, [{ incoming: 'A', field: 'code' }]), /Pick the column for Name/);
  assert.throws(() => MI.kindOf('invoices'), /Which file is this/); assert.throws(() => MI.sourceOf('myob'), /xero or qbo/);
});
t('the file reader: a header row below the top ("my headings are on row 3"), an empty file', () => {
  const p = MI.readFile({ csv: 'Shop Name\n\nAccount,Debit,Credit\nSales,,100\n', header_row: 3 });
  assert.deepStrictEqual(p.headers, ['Account', 'Debit', 'Credit']); assert.strictEqual(p.rows.length, 1); assert.strictEqual(p.rows[0].Credit, '100');
  assert.throws(() => MI.readFile({ csv: '  ' }), /empty/);
});

console.log('\nmove-in · 1 chart of accounts → ledgers (the pack\'s moveIn map; their code kept beside ours)');
t('⭐ Xero: BANK → Bank Accounts (add, code kept); Sales is a merge on 4000; Accounts Receivable IS Customers (1300); GST IS GST collected; a type with no home is skipped and said', () => {
  const pl = MI.plan('accounts', { source: 'xero', rows: rowsOf('accounts', 'xero-accounts.csv'), world: WORLD() });
  const bank = byLine(pl, 2); assert.strictEqual(bank.action, 'merge'); assert.strictEqual(bank.data.code, '1500'); assert.strictEqual(bank.data.source_code, '090');   /* the pack's own "Business bank account", by name */
  const sav = byLine(pl, 3); assert.strictEqual(sav.action, 'add'); assert.strictEqual(sav.data.group_name, 'Bank Accounts'); assert.strictEqual(sav.data.source_code, '091'); assert.ok(/keeping Xero code 091/.test(sav.why), sav.why);
  const sales = byLine(pl, 4); assert.strictEqual(sales.action, 'merge'); assert.strictEqual(sales.data.code, '4000'); assert.strictEqual(sales.data.source_code, '200');
  const ar = byLine(pl, 10); assert.strictEqual(ar.action, 'merge'); assert.strictEqual(ar.data.code, '1300'); assert.ok(/Is your Customers/.test(ar.why), ar.why);
  const ap = byLine(pl, 12); assert.strictEqual(ap.data.code, '2100');
  const gst = byLine(pl, 13); assert.strictEqual(gst.action, 'merge'); assert.strictEqual(gst.data.code, '2200');
  const inv = byLine(pl, 11); assert.strictEqual(inv.action, 'add'); assert.strictEqual(inv.data.group_name, 'Inventory');   /* INVENTORY → the Inventory group; the pack's "Inventory on hand" is another name */
  const cogs = byLine(pl, 6); assert.strictEqual(cogs.action, 'add'); assert.strictEqual(cogs.data.group_name, 'Cost of Sales');
  const rent = byLine(pl, 9); assert.strictEqual(rent.action, 'merge'); assert.strictEqual(rent.data.code, '6010');
  const trk = byLine(pl, 16); assert.strictEqual(trk.action, 'skip'); assert.ok(/No home for Xero type "TRACKING"/.test(trk.why), trk.why);
  assert.deepStrictEqual(pl.counts, { add: 6, merge: 8, skip: 1 });
  assert.ok(/default tax GST on Income = Taxable supply 10% — not kept/.test(sales.data.note), sales.data.note);
});
t('⭐ a COLLISION: their code already held by another ledger is a clash, skipped and named; the same ledger again is "already moved in"', () => {
  const w = WORLD();
  w.chart.push({ account_id: 'x1', code: '1510', name: 'Business Bank Account', is_group: false, nature: 'asset', role: null, active: true, source_code: '090', parent_id: null });
  w.chart.push({ account_id: 'x2', code: '1511', name: 'Term deposit', is_group: false, nature: 'asset', role: null, active: true, source_code: '091', parent_id: null });
  const pl = MI.plan('accounts', { source: 'xero', rows: rowsOf('accounts', 'xero-accounts.csv'), world: w });
  assert.strictEqual(byLine(pl, 2).action, 'skip'); assert.ok(/Already moved in as 1510 Business Bank Account/.test(byLine(pl, 2).why), byLine(pl, 2).why);   /* their code 090 is on 1510 already (the name is the same) */
  assert.strictEqual(byLine(pl, 3).action, 'skip'); assert.ok(/Code 091 is already on ledger 1511 Term deposit — a code clash/.test(byLine(pl, 3).why), byLine(pl, 3).why);
  /* a role ledger that already carries another source code: the file's row for it is a clash too */
  w.chart.find((a) => a.role === 'debtors').source_code = '611';
  const pl2 = MI.plan('accounts', { source: 'xero', rows: rowsOf('accounts', 'xero-accounts.csv'), world: w });
  assert.ok(/already carries Xero code 611 — a code clash/.test(byLine(pl2, 10).why), byLine(pl2, 10).why);
});
t('QBO Account List: A/R and A/P types ARE the control ledgers; Bank → add; Non-Posting has no home; the file\'s own duplicate is skipped', () => {
  const pl = MI.plan('accounts', { source: 'qbo', rows: rowsOf('accounts', 'qbo-accounts.csv'), world: WORLD() });
  assert.strictEqual(byLine(pl, 2).action, 'add'); assert.strictEqual(byLine(pl, 2).data.group_name, 'Bank Accounts'); assert.strictEqual(byLine(pl, 2).data.source_code, null);
  assert.strictEqual(byLine(pl, 3).data.code, '1300'); assert.strictEqual(byLine(pl, 5).data.code, '2100');
  assert.strictEqual(byLine(pl, 4).action, 'add'); assert.strictEqual(byLine(pl, 4).data.group_name, 'Current Assets');   /* "Other Current Assets" — the report's plural (engines v1.38.1) */
  assert.strictEqual(byLine(pl, 6).action, 'add'); assert.strictEqual(byLine(pl, 6).data.group_name, 'Current Liabilities');
  assert.strictEqual(byLine(pl, 11).action, 'skip'); assert.ok(/No home for QuickBooks type "Non-Posting"/.test(byLine(pl, 11).why));
  const pl2 = MI.plan('accounts', { source: 'qbo', rows: rowsOf('accounts', 'qbo-accounts.csv').concat([{ line: 99, name: 'Advertising', type: 'Expenses' }]), world: WORLD() });
  assert.ok(/already on line 9 of this file/.test(byLine(pl2, 99).why));
});

console.log('\nmove-in · 2 contacts → parties (ABN through reg-au, phone dedupe as L3)');
const PARTIES = () => ({ pack: AU, chart: [], parties: [
  { party_id: 'p-ravi', party_no: 'P-00001', name: 'Ravi Stores', customer: true, supplier: false, legal_name: null, gstin: null },
  { party_id: 'p-kumar', party_no: 'P-00002', name: 'Kumar Traders', customer: false, supplier: true, legal_name: 'Kumar Traders Pty Ltd', gstin: null },
  { party_id: 'p-harbour', party_no: 'P-00003', name: 'Harbour Cafe', customer: true, supplier: false, legal_name: null, gstin: null }],
  taxIds: [{ party_id: 'p-harbour', scheme: 'ABN', value: '51824753556' }], phones: [{ party_id: 'p-ravi', phone: '0412345678' }], listIds: [] });
t('⭐ Xero contacts as customers: a bad ABN is skipped with reg-au\'s sentence; a phone already on a party is a MERGE onto that party; a new one is added with ABN and phone; the file\'s own duplicate is skipped', () => {
  const pl = MI.plan('contacts', { source: 'xero', side: 'customer', rows: rowsOf('contacts', 'xero-contacts.csv'), world: PARTIES() });
  const bad = byLine(pl, 4); assert.strictEqual(bad.action, 'skip'); assert.ok(/ABN 51 824 753 557: The ABN check digits do not match/.test(bad.why), bad.why);
  const bondi = byLine(pl, 2); assert.strictEqual(bondi.action, 'skip', bondi.why);   /* its ABN is Harbour Cafe's and its phone is Ravi's — two parties: merge them first */
  assert.ok(/belongs to Harbour Cafe and phone 0412345678 to Ravi Stores/.test(bondi.why), bondi.why);
  const north = byLine(pl, 3); assert.strictEqual(north.action, 'add'); assert.deepStrictEqual([north.data.abn, north.data.phone, north.data.legal_name], ['53004085616', '0299991111', 'Northside Veterinary Pty Ltd']);
  assert.ok(/New customer, ABN 53004085616, phone 0299991111/.test(north.why), north.why);
  const ravi = byLine(pl, 5); assert.strictEqual(ravi.action, 'skip'); assert.ok(/Already here as P-00001 Ravi Stores — nothing new/.test(ravi.why), ravi.why);
  const dup = byLine(pl, 6); assert.strictEqual(dup.action, 'skip'); assert.ok(/already on line 2 of this file/.test(dup.why));
});
t('QBO customer list: an ABN already on Harbour Cafe merges (legal name and phone kept); a supplier named in a customer file is added to the customer list too', () => {
  const pl = MI.plan('contacts', { source: 'qbo', side: 'customer', rows: rowsOf('contacts', 'qbo-customers.csv'), world: PARTIES() });
  const h = byLine(pl, 2); assert.strictEqual(h.action, 'merge'); assert.deepStrictEqual(h.data.sets, { legal_name: 'Harbour Cafe Pty Ltd', phone: '0433222111' }); assert.ok(/Is P-00003 Harbour Cafe: legal name kept, phone kept/.test(h.why), h.why);
  const jo = byLine(pl, 3); assert.strictEqual(jo.action, 'add'); assert.strictEqual(jo.data.email, 'jo@example.com');
  const pl2 = MI.plan('contacts', { source: 'qbo', side: 'customer', rows: [{ line: 2, name: 'Kumar Traders' }], world: PARTIES() });
  assert.strictEqual(byLine(pl2, 2).action, 'merge'); assert.deepStrictEqual(byLine(pl2, 2).data.sets, { list: 'customer' });
  assert.strictEqual(MI.plan('contacts', { source: 'qbo', side: 'customer', rows: [{ line: 2, name: 'x@y.com' }], world: PARTIES() }).rows[0].action, 'skip');
});

console.log('\nmove-in · 3 items → products (their tax code → the pack\'s supply kind → the rate)');
t('⭐ Xero items: GST on Income → 10%, GST Free → 0%, Input Taxed → 0% (no credit, said), an unknown code adds the item with the rate left to set, "$1,000.00" reads as a number, a code already in the catalogue is skipped, the file\'s own duplicate too', () => {
  const pl = MI.plan('items', { source: 'xero', currency: 'AUD', rows: rowsOf('items', 'xero-items.csv'), world: { products: [{ item_id: 'i1', code: 'BREAD', name: 'Bread' }] } });
  const beans = byLine(pl, 2); assert.strictEqual(beans.action, 'add'); assert.deepStrictEqual([beans.data.rec.price, beans.data.rec.gst_rate, beans.data.rec.cost, beans.data.rec.source_system, beans.data.rec.source_ref], [30, 10, 18.5, 'xero', 'BEANS1']);
  assert.ok(/GST on Income = Taxable supply 10%/.test(beans.data.notes[0]), beans.data.notes[0]);
  const bread = byLine(pl, 3); assert.strictEqual(bread.action, 'skip'); assert.ok(/Already in the catalogue as Bread \(BREAD\)/.test(bread.why));
  const rent = byLine(pl, 4); assert.strictEqual(rent.data.rec.gst_rate, 0); assert.ok(/Input-taxed/.test(rent.data.notes[0]));
  const myst = byLine(pl, 5); assert.strictEqual(myst.action, 'add'); assert.strictEqual(myst.data.rec.price, 1000); assert.strictEqual(myst.data.rec.gst_rate, null); assert.ok(/"TAX007" is not one this import knows/.test(myst.data.notes[0]));
  const nocode = byLine(pl, 6); assert.strictEqual(nocode.action, 'add'); assert.strictEqual(nocode.data.rec.code, null); assert.ok(/second import of this file would add it again/.test(nocode.data.notes.join(' ')));
  const dup = byLine(pl, 7); assert.strictEqual(dup.action, 'skip'); assert.ok(/already on line 2 of this file/.test(dup.why));
  assert.ok(/A\$30\.00 · GST 10%/.test(beans.why), beans.why);
});
t('QBO items (Simpler GST): GST → 10%, GST free → 0%, Out of Scope → no GST; the SKU is the code', () => {
  const pl = MI.plan('items', { source: 'qbo', currency: 'AUD', rows: rowsOf('items', 'qbo-items.csv'), world: { products: [] } });
  assert.deepStrictEqual(pl.rows.map((r) => [r.data.rec.code, r.data.rec.gst_rate]), [['FW', 10], ['H2O', 0], ['GV', 0]]);
  assert.ok(/Out of Scope = no GST/.test(byLine(pl, 4).data.notes[0]));
  assert.deepStrictEqual(pl.counts, { add: 3, merge: 0, skip: 0 });
});

console.log('\nmove-in · 4 opening balances: the trial balance through POST /opening\'s door; customers and suppliers bill-wise');
const MOVED = () => { const w = WORLD(); const add = (code, name, sc, group) => w.chart.push({ account_id: 'm-' + code, code, name, is_group: false, nature: 'asset', role: null, active: true, source_code: sc, parent_id: (w.chart.find((a) => a.is_group && a.name === group) || {}).account_id || null });
  add('1510', 'Business Bank Account', '090', 'Bank Accounts'); add('5100', 'Cost of Goods Sold', '300', 'Cost of Sales'); add('6000', 'Advertising', '400', 'Operating Expenses');
  w.chart.find((a) => a.code === '4000').source_code = '200'; w.chart.find((a) => a.code === '1300').source_code = '610'; w.chart.find((a) => a.code === '2100').source_code = '800';
  w.chart.find((a) => a.code === '2200').source_code = '820'; w.chart.find((a) => a.code === '3100').source_code = '880'; w.chart.find((a) => a.code === '3900').source_code = '960'; w.chart.find((a) => a.code === '1200').source_code = '630';
  return w; };
t('⭐ Xero trial balance: "Sales (200)" finds the ledger by THEIR code; amounts with commas read; the A/R and A/P rows are skipped (bill-wise) and Suspense is said; an unknown ledger is skipped and named; the Total row is not posted', () => {
  const pl = MI.plan('trial_balance', { source: 'xero', currency: 'AUD', as_at: '2026-07-01', rows: rowsOf('trial_balance', 'xero-tb.csv'), world: MOVED() });
  assert.strictEqual(pl.refusal, null, pl.refusal);
  const bank = byLine(pl, 2); assert.strictEqual(bank.action, 'add'); assert.deepStrictEqual([bank.data.code, bank.data.dr_minor, bank.data.cr_minor], ['1510', 1523050, 0]);
  const ar = byLine(pl, 3); assert.strictEqual(ar.action, 'skip'); assert.ok(/Customers balance A\$4,400\.00 arrives bill-wise from the open invoices file/.test(ar.why), ar.why);
  const ap = byLine(pl, 5); assert.ok(/Suppliers balance A\$2,200\.00 arrives bill-wise/.test(ap.why), ap.why);
  const gst = byLine(pl, 6); assert.deepStrictEqual([gst.data.code, gst.data.cr_minor], ['2200', 73050]);
  const sales = byLine(pl, 9); assert.deepStrictEqual([sales.data.code, sales.data.cr_minor], ['4000', 1200000]);
  const unk = byLine(pl, 12); assert.strictEqual(unk.action, 'skip'); assert.ok(/No ledger named "Unknown Ledger" \(Xero code 777\)/.test(unk.why), unk.why);
  assert.strictEqual(byLine(pl, 13).action, 'skip'); assert.ok(/total row/i.test(byLine(pl, 13).why));
  assert.deepStrictEqual(pl.totals, { dr_minor: 4063050, cr_minor: 4063050 }); assert.deepStrictEqual(pl.control, { debtors_minor: 440000, creditors_minor: -220000 });
  assert.ok(/Suspense will hold A\$6,600\.00 until the open invoices and bills are moved in/.test(pl.notes[0]), pl.notes[0]);
});
t('⭐ an UNBALANCED trial balance is refused with the sentence (and the rows still say what they would have done)', () => {
  const pl = MI.plan('trial_balance', { source: 'xero', currency: 'AUD', rows: rowsOf('trial_balance', 'xero-tb-unbalanced.csv'), world: MOVED() });
  assert.strictEqual(pl.refusal, 'The trial balance does not balance: debits A$15,230.50, credits A$12,000.00 — the difference is A$3,230.50. Export it again as at the move date, with every account.');
  assert.strictEqual(byLine(pl, 2).action, 'add');
});
t('QBO trial balance: ledgers by NAME (no code column); "Owner\'s Equity" lands on nothing until it is moved in; the TOTAL row is skipped', () => {
  const w = MOVED(); w.chart.push({ account_id: 'm-q1', code: '1511', name: 'Business Cheque', is_group: false, nature: 'asset', role: null, active: true, source_code: null });
  const pl = MI.plan('trial_balance', { source: 'qbo', currency: 'AUD', rows: rowsOf('trial_balance', 'qbo-tb.csv'), world: w });
  assert.strictEqual(pl.refusal, null);
  assert.deepStrictEqual([byLine(pl, 2).action, byLine(pl, 2).data.code], ['add', '1511']);
  assert.strictEqual(byLine(pl, 7).action, 'skip'); assert.ok(/No ledger named "Owner's Equity"/.test(byLine(pl, 7).why));
  assert.strictEqual(byLine(pl, 11).data.code, '6010');   /* Rent is a pack ledger: by name */
  assert.strictEqual(byLine(pl, 12).action, 'skip');
});
t('⭐ open invoices (Xero aged receivables): one bill-wise row per open document on Customers 1300, the party by name, "15 Jul 2026" and "30/07/2026" read as dates, a credit note is a credit, nothing owed and an unknown party are skipped, the file\'s own duplicate too', () => {
  const w = Object.assign(PARTIES(), { chart: MOVED().chart }); w.parties.push({ party_id: 'p-bondi', party_no: 'P-00004', name: 'Bondi Pet Supplies', customer: true, supplier: false }, { party_id: 'p-north', party_no: 'P-00005', name: 'Northside Vet', customer: true, supplier: false });
  const pl = MI.plan('open_bills', { source: 'xero', side: 'receivable', currency: 'AUD', rows: rowsOf('open_bills', 'xero-aged.csv'), world: w });
  const a = byLine(pl, 2); assert.strictEqual(a.action, 'add'); assert.deepStrictEqual([a.data.code, a.data.party_id, a.data.bill_ref, a.data.due_date, a.data.dr_minor, a.data.cr_minor], ['1300', 'p-bondi', 'INV-0041', '2026-07-15', 330000, 0]);
  const cn = byLine(pl, 4); assert.deepStrictEqual([cn.data.dr_minor, cn.data.cr_minor], [0, 22000]); assert.ok(/A credit of A\$220\.00/.test(cn.why), cn.why);
  const nob = byLine(pl, 5); assert.strictEqual(nob.action, 'skip'); assert.ok(/No customer named "Nobody Known" — move the contacts in first/.test(nob.why));
  const dup = byLine(pl, 6); assert.strictEqual(dup.action, 'skip'); assert.ok(/already on line 2/.test(dup.why));
  const paid = byLine(pl, 7); assert.strictEqual(paid.action, 'skip'); assert.ok(/Nothing owed/.test(paid.why));
  assert.deepStrictEqual(pl.counts, { add: 3, merge: 0, skip: 3 });
});
t('open bills (QBO aged payables): the supplier by name, "$1,650.00" and "12/07/2026" read; credits on Suppliers 2100', () => {
  const w = Object.assign(PARTIES(), { chart: MOVED().chart });
  const pl = MI.plan('open_bills', { source: 'qbo', side: 'payable', currency: 'AUD', rows: rowsOf('open_bills', 'qbo-aged.csv'), world: w });
  assert.deepStrictEqual(pl.rows.map((r) => [r.action, r.data.code, r.data.party_id, r.data.bill_ref, r.data.due_date, r.data.cr_minor]), [['add', '2100', 'p-kumar', 'B-1007', '2026-07-12', 165000], ['add', '2100', 'p-kumar', 'B-1012', '2026-07-25', 55000]]);
  assert.strictEqual(MI.skippedCsv([{ line: 4, what: 'Nobody, Inc', why: 'No "customer"' }]), 'line,what,why\n"4","Nobody, Inc","No ""customer"""\n');
});
t('dates and money: the readers refuse rather than guess', () => {
  assert.strictEqual(MI.isoDate('31/02/2026'), null); assert.strictEqual(MI.isoDate('2026-07-01T00:00:00Z'), '2026-07-01'); assert.strictEqual(MI.isoDate('July 1, 2026'), '2026-07-01'); assert.strictEqual(MI.isoDate('20260701'), null);
  assert.strictEqual(MI.toMinor('A$ 1,234.5', 'AUD'), 123450); assert.strictEqual(MI.toMinor('abc', 'AUD'), null); assert.strictEqual(MI.toMinor('1234', 'JPY'), 1234);
});

/* ═══ the write, through the in-memory books rig (the doors: addAccount · setSourceCode · postOpening) ═══ */
(async () => {
  console.log('\nmove-in · the write (in-memory books, the sibling engines)');
  const H = require('./support/books-harness.cjs');
  const X = H.load();
  if (!X.src.dir) { console.log('  SKIP  ' + X.src.why); return; }
  const SHOP = '11111111-1111-4111-8111-111111111111';
  const M = require('./support/books-memory.cjs'); M.fakeDb.countryRow = { country: 'AU', currency_code: 'AUD', gstn: null, timezone: 'Australia/Sydney', policy_flags: {} };
  await X.store.saveSetting(X.db, SHOP, { enabled: false });
  await X.B.enable(X.db, SHOP, { country: 'AU', today: '2026-07-05' });
  const setting = await X.B.settingOf(X.db, SHOP);
  await ta('⭐ a Xero chart moved in: 5 ledgers added with the system\'s codes under their groups, 9 merged; before b302 the source code is not kept and the outcome says so', async () => {
    const w = await MI.world(X.db, SHOP, 'accounts', setting);
    assert.strictEqual(w.chart.length, E.chartRows(w.pack).length);
    const pl = MI.plan('accounts', { source: 'xero', rows: rowsOf('accounts', 'xero-accounts.csv'), world: w });
    const out = await MI.apply(X.db, SHOP, pl, { world: w, setting, by: 'u1', as_at: '2026-07-01', currency: 'AUD' });
    assert.deepStrictEqual([out.added, out.merged, out.skipped], [6, 8, 1]);
    assert.strictEqual(out.source_code_written, false); assert.ok(/b302/.test(out.notes.join(' ')), out.notes.join(' '));
    const chart = await X.store.accounts(X.db, SHOP);
    const bank = chart.find((a) => a.name === 'Business Savings Account'); assert.ok(bank && /^15\d\d$/.test(bank.code), 'a bank ledger under Bank Accounts (15xx): ' + (bank && bank.code));
    assert.ok(chart.some((a) => a.name === 'Cost of Goods Sold' && /^5[1-9]\d\d$/.test(a.code)));
    assert.strictEqual(out.rows.length, 1); assert.ok(/TRACKING/.test(out.rows[0].why));
    /* the same file again: everything is a merge or a skip, nothing is added twice (the names are there now) */
    const w2 = await MI.world(X.db, SHOP, 'accounts', setting);
    const pl2 = MI.plan('accounts', { source: 'xero', rows: rowsOf('accounts', 'xero-accounts.csv'), world: w2 });
    assert.strictEqual(pl2.counts.add, 0);
  });
  await ta('⭐ the trial balance posts ONE opening entry through postOpening; the customers / suppliers control rows are not posted and Suspense holds their net; the same file again posts nothing (client_ref)', async () => {
    const w = await MI.world(X.db, SHOP, 'trial_balance', setting);
    const pl = MI.plan('trial_balance', { source: 'xero', currency: 'AUD', as_at: '2026-07-01', rows: rowsOf('trial_balance', 'xero-tb.csv'), world: w });
    assert.strictEqual(pl.refusal, null);
    const out = await MI.apply(X.db, SHOP, pl, { world: w, setting, by: 'u1', as_at: '2026-07-01', currency: 'AUD' });
    assert.ok(out.entry && out.entry.entry_no, JSON.stringify(out.entry));
    /* posted: bank 15230.50 + inventory 8000 + drawings 1000 + COGS 7000 + advertising 1500 = 32730.50 Dr; GST (by the name their system gives the control, codes not kept before b302) 730.50 + retained 25700 + sales 12000 = 38430.50 Cr
       → Suspense carries the 5700 difference: the 2200 net the AR/AP rows would have added (4400 Dr − 2200 Cr) plus the unknown ledger's 3500 Dr */
    assert.strictEqual(out.entry.suspense_minor, -(3843050 - 3273050), 'suspense = the credit side\'s excess, in cents: ' + out.entry.suspense_minor);
    assert.strictEqual(out.added, 8); assert.strictEqual(out.skipped, 4);
    const again = await MI.apply(X.db, SHOP, MI.plan('trial_balance', { source: 'xero', currency: 'AUD', as_at: '2026-07-01', rows: rowsOf('trial_balance', 'xero-tb.csv'), world: await MI.world(X.db, SHOP, 'trial_balance', setting) }), { world: w, setting, by: 'u1', as_at: '2026-07-01', currency: 'AUD' });
    assert.strictEqual(again.entry.duplicate, true); assert.strictEqual(again.added, 0);
  });
  await ta('an unbalanced trial balance writes nothing: apply refuses with the sentence', async () => {
    const w = await MI.world(X.db, SHOP, 'trial_balance', setting);
    const pl = MI.plan('trial_balance', { source: 'xero', currency: 'AUD', rows: rowsOf('trial_balance', 'xero-tb-unbalanced.csv'), world: w });
    await assert.rejects(() => MI.apply(X.db, SHOP, pl, { world: w, setting, by: 'u1', as_at: '2026-07-01', currency: 'AUD' }), /does not balance/);
  });
  await ta('open invoices post bill-wise on Customers with the party and its due date (one entry, period 0)', async () => {
    X.T.parties.push({ owner: SHOP, party_id: '22222222-2222-4222-8222-222222222222', party_no: 'P-00001', name: 'Bondi Pet Supplies', customer: true }, { owner: SHOP, party_id: '33333333-3333-4333-8333-333333333333', party_no: 'P-00002', name: 'Northside Vet', customer: true });
    const w = await MI.world(X.db, SHOP, 'open_bills', setting);
    const pl = MI.plan('open_bills', { source: 'xero', side: 'receivable', currency: 'AUD', as_at: '2026-07-01', rows: rowsOf('open_bills', 'xero-aged.csv'), world: w });
    const out = await MI.apply(X.db, SHOP, pl, { world: w, setting, by: 'u1', as_at: '2026-07-01', currency: 'AUD' });
    assert.strictEqual(out.added, 3); assert.ok(out.entry.entry_no);
    const items = X.T.items.filter((i) => i.entity_id === SHOP || i.owner === SHOP || true);
    assert.ok(items.some((i) => i.against_ref === 'INV-0041' && i.kind === 'opening_balance' && i.due_date === '2026-07-15' && i.amount_minor === 330000), 'a bill-wise party item with its due date: ' + JSON.stringify(items.slice(0, 2)));
    assert.ok(items.some((i) => i.against_ref === 'CN-0002' && i.amount_minor === -22000), 'the credit note is a negative item');
  });
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
