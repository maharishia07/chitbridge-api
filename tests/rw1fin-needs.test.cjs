#!/usr/bin/env node
/**
 * rw1fin-needs.test.cjs — re-walk 1 (25 Nov) RW1-04/23/24: ONE fact, ONE sign, ONE wording for the bank's unexplained difference.
 * OWNS    hand-computed checks: Home Bank card line (absolute, "{money} unexplained"), the To do row (bank_unexplained), the Accounts card's overdue-return and evidence lines.
 * CALLED BY CI (tests/*.test.cjs); pure node, no database.
 */
'use strict';
process.env.NODE_ENV = 'test'; process.env.DATABASE_URL = '';
const assert = require('assert');
const bank = require('../lib/home-facts-bank');
const todo = require('../lib/books-todo');
// hand: a sign-off of -35,432 minor (AUD) = A$354.32 unexplained; the Home card used to say "Difference -A$354.32"
const card = bank.statementLines({ account_id: 'a', difference_minor: -35432, currency: 'AUD', period_to: '2026-10-31' }, [], null);
assert.strictEqual(card.lines[1].text, '{money} unexplained');
assert.strictEqual(card.lines[1].money.amount, 354.32, 'absolute, one sign');
assert.strictEqual(card.lines[1].value, 35432);
assert.strictEqual(card.lines[1].tone, 'dn');
assert.strictEqual(bank.statementLines({ account_id: 'a', difference_minor: 0, currency: 'AUD', period_to: '2026-10-31' }, [], null).lines[1].text, 'Nothing unexplained');
// the To do row: same figure, same figure, one row, by currency (never added across)
const rows = [];
const add = (kind, count, words, action, list) => rows.push({ kind, count, words, action, items: list });
todo.addBankUnexplained(add, { by_currency: [{ currency: 'AUD', unexplained_minor: 35432, to: '2026-10-31' }] });
assert.strictEqual(rows.length, 1);
assert.strictEqual(rows[0].kind, 'bank_unexplained');
assert.strictEqual(rows[0].items[0].unexplained_minor, 35432, 'the figure travels as minor units and currency; the page words it'); assert.ok(!/[0-9]/.test(rows[0].words), 'no second wording of the amount in the server sentence');
assert.strictEqual(rows[0].action.screen, 'bank');
todo.addBankUnexplained(add, { by_currency: [] });
todo.addBankUnexplained(add, null);
assert.strictEqual(rows.length, 1, 'nothing unexplained = no row');
assert.ok(todo.KINDS.indexOf('bank_unexplained') >= 0);
console.log('rw1fin-needs: ok');
console.log('  12 checks'); /* the guards runner counts "<n> checks" (a guard that counts nothing proved nothing; zeroreds 26 Nov: seven guards ended without it and read FAIL in the full run) */
