// @type: unit
/**
 * books-other-side.test.cjs — W15-89b: a ledger line says who was paid and for what. The entry's other side is PICKED from the entry's own lines (lib/books-other-side), read in the same statement as the line (books-store.entryLines { others: true }).
 * Proves: one other ledger → { code, name } · tax lines stay out of the choice · several → Split with a count · a ledger used twice counts once · an entry of tax only names the tax ledger · a one-sided entry → null · the party is the entry's first named one ·
 * the statement reads the entry's lines IN the one query (no read per row) and only when asked.
 * Run: node tests/books-other-side.test.cjs        CARD 16-finance/books-ledger
 */
'use strict';
const assert = require('assert');
const path = require('path');
const O = require(path.join(__dirname, '..', 'lib', 'books-other-side.js'));
let fail = 0;
const t = (name, fn) => { try { fn(); console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n         ' + String((e && e.message) || e).slice(0, 300)); } };
const L = (no, code, name, dr, cr, extra) => Object.assign({ line_no: no, code, name, dr_minor: dr, cr_minor: cr, tax: false, party_name: null }, extra);
const rent = [L(1, '6300', 'Rent', 100000, 0), L(2, '1010', 'Bank', 0, 100000)];

t('a bank payment of rent: the bank line says Rent, the rent line says Bank', () => {
  assert.deepStrictEqual(O.otherOf(rent, rent[1]), { code: '6300', name: 'Rent' });
  assert.deepStrictEqual(O.otherOf(rent, rent[0]), { code: '1010', name: 'Bank' });
});
t('the tax line is left out: rent with its tax is still the one ledger Rent', () => {
  const taxed = [L(1, '6300', 'Rent', 90909, 0), L(2, '2310', 'Tax paid', 9091, 0, { tax: true }), L(3, '1010', 'Bank', 0, 100000)];
  assert.deepStrictEqual(O.otherOf(taxed, taxed[2]), { code: '6300', name: 'Rent' });
});
t('the tax ledgers of the pack (any country names) stay out: a bill tax line, found by its role, is not a second ledger', () => {
  const roles = O.taxRolesOf({ taxLedgers: { gst: { input: 'gst_paid', output: 'gst_collected' }, vat: { input: 'vat_in', rcm: 'vat_rcm' } } });
  assert.deepStrictEqual([...roles].sort(), ['gst_collected', 'gst_paid', 'vat_in', 'vat_rcm']);
  const bill = [L(1, '6030', 'Electricity', 22000, 0, { role: 'electricity' }), L(2, '2210', 'GST paid', 2200, 0, { role: 'gst_paid' }), L(3, '1500', 'Bank', 0, 24200, { role: 'bank' })];
  assert.deepStrictEqual(O.otherOf(bill, bill[2], roles), { code: '6030', name: 'Electricity' });
  assert.deepStrictEqual(O.otherOf(bill, bill[2]), { code: null, name: 'Split', count: 2 }, 'without the pack it cannot tell, and says Split');
  assert.strictEqual(O.taxRolesOf(null).size, 0);
});
t('several ledgers: Split, with how many', () => {
  const split = [L(1, '6300', 'Rent', 60000, 0), L(2, '6400', 'Power', 40000, 0), L(3, '1010', 'Bank', 0, 100000)];
  assert.deepStrictEqual(O.otherOf(split, split[2]), { code: null, name: 'Split', count: 2 });
});
t('the same ledger on two lines counts once', () => {
  const twice = [L(1, '6300', 'Rent', 60000, 0), L(2, '6300', 'Rent', 40000, 0), L(3, '1010', 'Bank', 0, 100000)];
  assert.deepStrictEqual(O.otherOf(twice, twice[2]), { code: '6300', name: 'Rent' });
});
t('an entry that is only tax on the other side names the tax ledger (nothing else is there)', () => {
  const only = [L(1, '2310', 'Tax paid', 5000, 0, { tax: true }), L(2, '1010', 'Bank', 0, 5000)];
  assert.deepStrictEqual(O.otherOf(only, only[1]), { code: '2310', name: 'Tax paid' });
});
t('a one-sided entry has no other side', () => {
  const one = [L(1, '1010', 'Bank', 0, 0)];
  assert.strictEqual(O.otherOf(one, one[0]), null);
  assert.strictEqual(O.otherOf(null, one[0]), null);
});
t('the party is the entry\'s first named one, null when none', () => {
  const paid = [L(1, '2000', 'Suppliers', 50000, 0, { party_name: 'Metro Trade Supplies' }), L(2, '1010', 'Bank', 0, 50000)];
  assert.strictEqual(O.partyNameOf(paid), 'Metro Trade Supplies');
  assert.strictEqual(O.partyNameOf(rent), null);
  assert.strictEqual(O.partyNameOf(undefined), null);
});
t('the statement reads the entry\'s lines inside the one query, and only when asked', () => {
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'lib', 'books-store.js'), 'utf8');
  assert.ok(/\$\{opt && opt\.others \? OTHERS_SQL : ''\}/.test(src), 'entryLines adds the sub-select only for { others: true }');
  const sql = /const OTHERS_SQL = `([\s\S]*?)`;/.exec(src)[1];
  assert.ok(/jsonb_agg/.test(sql) && /journal_line ol/.test(sql) && /customer_list ocl/.test(sql) && /supplier_list osl/.test(sql), 'one aggregate over the entry\'s lines, the party named from the shop\'s own lists');
  const route = require('fs').readFileSync(path.join(__dirname, '..', 'routes', 'books.js'), 'utf8');
  assert.ok(/others: true/.test(route) && !/partyNames\(h, e, lines/.test(/GET \/ledger\/:account[\s\S]*?router\.get\('\/ledger[\s\S]*?\n\}\);/.exec(route)[0]), 'the ledger asks for it and makes no per-line read');
});
console.log(fail ? '\n' + fail + ' failed' : '\nall ok');
process.exit(fail ? 1 : 0);
