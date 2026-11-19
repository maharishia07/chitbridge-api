/**
 * tests/books-split-modules.test.cjs — the three small modules split out of big files in batch 1123: lib/policy-books.js, lib/home-waiting.js, lib/books-action-queue.js. Offline, no database.
 * OWNS      one unit per rule of each: the flag row keeps the owner-only words and defaults off, a bad value is refused; the waiting words; the queue's asked shape, and a queue read that is closed (empty) when the table is not there.
 * CALLED BY scripts/guards.cjs
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 */
'use strict';
const assert = require('assert');
process.env.DATABASE_URL = '';
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n         ' + String((e && e.message) || e).slice(0, 300)); } };

(async () => {
  const policy = require('../lib/policy');
  const books = require('../lib/policy-books');
  await t('policy-books: the flag row defaults off, takes only off|on and carries the owner-only words policy.js passes in', () => {
    const row = books.flagsFor({ may: 'owner', may_why: 'only the owner' }).books_owner_approves;
    assert.deepStrictEqual(row.options, ['off', 'on']);
    assert.strictEqual(row.def, 'off');
    assert.strictEqual(row.may, 'owner');
    assert.strictEqual(policy.FLAGS.books_owner_approves.may, 'owner');
  });
  await t('policy-books: a value outside off|on is refused (400), never stored', () => {
    let threw = null;
    try { policy.patchSql([], { books_owner_approves: 'maybe' }, { op: 'merge' }); } catch (e) { threw = e; }
    assert.ok(threw && threw.status === 400);
  });
  await t('policy-books: the card row is the policy card\'s (label, level, gov, order)', () => {
    const ui = policy.FLAGS.books_owner_approves.ui;
    assert.ok(ui && ui.label && ui.level === 'entity' && ui.gov === 'entity' && ui.order > 0);
  });

  const words = require('../lib/home-waiting');
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');
  await t('home-waiting: the words name each waiting kind, and the held entries last', () => {
    assert.deepStrictEqual(words.waitingWords({ accept: 2, add_supplier: 1, record: 3, held: 1 }, plural),
      ['2 supplier bills to accept', '1 supplier to add', '3 waiting to be recorded', '1 entry waiting for your OK']);
    assert.deepStrictEqual(words.waitingWords({}, plural), []);
  });

  const queue = require('../lib/books-action-queue');
  await t('books-action-queue: an unknown state asks for the open ones, the limit is clamped, nothing is asked as another person', () => {
    const asked = queue.queueAsked({ state: 'bogus', limit: '9999', mine: 'false' }, { identity_id: 'p1' });
    assert.deepStrictEqual(asked.states, ['prepared', 'reviewed']);
    assert.strictEqual(asked.limit, 100);
    assert.strictEqual(asked.mine, null);
    assert.strictEqual(queue.queueAsked({ state: 'all', mine: 'true' }, { identity_id: 'p1' }).mine, 'p1');
  });
  await t('books-action-queue: no person named is refused an empty answer, never every action', async () => {
    assert.deepStrictEqual(await queue.returnedFor({}, 'shop', null, 5), { total: 0, actions: [] });
  });
  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})();
