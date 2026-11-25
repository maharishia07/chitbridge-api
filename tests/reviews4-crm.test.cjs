/**
 * reviews4-crm.test.cjs — batch 1129, EL-crm-01 M1 (storedText lost its backslash), M2 (credit limit x100 ignores the currency exponent),
 * M3 (a failed dues read shows 0 and removal trusts it). Run: node tests/reviews4-crm.test.cjs (no DB).
 */
'use strict';
const assert = require('assert'), path = require('path');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://cb@127.0.0.1:5432/cb_test';
const stub = (rel, exports) => { const id = require.resolve(path.join(API, rel)); require.cache[id] = { id, filename: id, loaded: true, exports }; };
let itemsThrow = true;
stub('db', { ...require(path.join(API, 'db')), trySavepoint: async (db, fn, fb) => { try { return await fn(); } catch (e) { return fb; } } });
const realStore = require(path.join(API, 'lib', 'books-store'));
stub('lib/books-store', { ...realStore, setting: async () => ({ enabled: true }), accounts: async () => [{ role: 'debtors', account_id: 'acc' }], items: async () => { if (itemsThrow) throw new Error('statement timeout'); return []; } });
const pf = require(path.join(API, 'lib', 'party-fields'));
const crm = require(path.join(API, 'lib', 'crm'));
let pass = 0, fail = 0;
const it = async (n, f) => { try { await f(); pass++; console.log('  ok  ' + n); } catch (e) { fail++; console.log('  XX  ' + n + ' — ' + e.message); } };
(async () => {
  await it('M1 a legal name keeps its letter s ("Sasi Stores") and single-spaces real whitespace', () => {
    assert.strictEqual(pf.clean('customer', { legal_name: 'Sasi Stores' }).legal_name, 'Sasi Stores');
    assert.strictEqual(pf.clean('customer', { legal_name: '  Joshi   Traders\t Ltd ' }).legal_name, 'Joshi Traders Ltd');
    assert.strictEqual(pf.clean('customer', { state_code: 'nsw' }).state_code, 'NSW');
  });
  await it('M2 credit_limit in major units follows the currency exponent (KWD 3, JPY 0, INR 2); Infinity is refused', () => {
    assert.strictEqual(pf.clean('customer', { credit_limit: 500 }, 'KWD').credit_limit_minor, 500000);
    assert.strictEqual(pf.clean('customer', { credit_limit: 500 }, 'JPY').credit_limit_minor, 500);
    assert.strictEqual(pf.clean('customer', { credit_limit: 50 }, 'INR').credit_limit_minor, 5000);
    assert.throws(() => pf.clean('customer', { credit_limit: '1e400' }, 'INR'), (e) => e.status === 400);
    assert.throws(() => pf.clean('customer', { credit_limit: 5 }, null), (e) => e.status === 400);
  });
  await it('M3 a failed dues read is UNKNOWN (balance_minor null), not 0; net() says unknown and a good read still reads 0', async () => {
    const withEntity = async (o, fn) => fn({ query: async (sql) => (/FROM customer_list/.test(sql) ? { rows: [{ pid: '11111111-1111-4111-8111-111111111111' }] } : { rows: [] }) });
    const rows = [{ customer_identity_id: '11111111-1111-4111-8111-111111111111' }];
    itemsThrow = true; await pf.decorate(withEntity, 'owner', rows, 'customer_identity_id', 'customer');
    assert.strictEqual(rows[0].balance_minor, null);
    const n = crm.net(rows[0], null); assert.strictEqual(n.unknown, true); assert.strictEqual(n.open_side, false);
    const ok = [{ customer_identity_id: '11111111-1111-4111-8111-111111111111' }];
    itemsThrow = false; await pf.decorate(withEntity, 'owner', ok, 'customer_identity_id', 'customer');
    assert.strictEqual(ok[0].balance_minor, 0);
  });
  console.log('\n' + (fail ? 'FAIL ' + fail + ', ' : 'ok ') + pass + ' passed'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERROR ' + (e && e.stack || e)); process.exit(1); });
