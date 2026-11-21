'use strict';
/**
 * tests/samecount-accounts-state.test.cjs - SAMECOUNT A-F-59: Home's Accounts card and the books agree on "is Accounts in use".
 * Opening balances posted (a journal entry exists) but no check run and nothing waiting: the card says in_use, never not_started.
 * Offline. Run: node tests/samecount-accounts-state.test.cjs
 * CARD 26-reporting-mis-and-bi/home-facts
 */
const assert = require('assert'), path = require('path');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';
const stub = (rel, exports) => { const p = require.resolve(path.join(API, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
let entries = 1;
const handle = { query: async (sql) => (/FROM journal_entry/.test(sql) ? { rows: entries ? [{ '?column?': 1 }] : [] } : { rows: [] }) };
stub('db', { query: async () => ({ rows: [] }), withEntity: async (o, fn) => fn(handle), readBatch: async () => [] });
const real = require('../lib/books.js');
stub('lib/books', Object.assign({}, real, { settingOf: async () => ({ enabled: true, last_check: null }) }));
stub('lib/home-waiting', Object.assign({}, require('../lib/home-waiting.js'), { waitingWithHeld: async () => ({ total: 0, accept: 0, add_supplier: 0, record: 0, held: 0 }) }));
const Home = require('../lib/home-facts.js');
(async () => {
  let card = await Home.BUILD.accounts({ entity: 'e1', actor: 'e1' });
  assert.strictEqual(card.state, 'in_use');
  entries = 0;
  card = await Home.BUILD.accounts({ entity: 'e1', actor: 'e1' });
  assert.strictEqual(card.state, 'not_started');
  console.log('  ok  Accounts card: an entry posted (opening balances) = in_use; none = not_started');
})().catch((e) => { console.log('  FAIL ' + e.message); process.exit(1); });
