'use strict';
/**
 * tests/move-in-bulk.test.cjs — CON-164 (batch 1136): a contacts file lands as a SET of statements, not a dozen per row.
 * 40 customers + 40 suppliers (bare names and phones) are applied through MI.apply on a fake handle that counts the statements:
 *   · the count does not grow with the rows (the same for 2 rows and 80) · every row is added · added_via is the one the CHECKs allow
 *   · a name the shop already holds is NOT landed by the set: it falls to the per-row path and is skipped with its sentence
 *   · a row with an e-mail still gets its one e-mail write (per row, only where the row carries it)
 */
const assert = require('assert');
const path = require('path');
const MI = require(path.join(__dirname, '..', 'lib', 'move-in'));
const BULK = require(path.join(__dirname, '..', 'lib', 'move-in-bulk')); /* the module under test: the set, and the rules it keeps */
const SHOP = '00000000-0000-0000-0000-0000000000aa';
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('  PASS  ' + name); } catch (e) { fail++; console.error('  FAIL  ' + name + '\n        ' + (e && e.message)); } };

function fakeDb(opts) {
  const o = opts || {}, log = [];
  let n = 0;
  const query = async (sql, params) => {
    const s = String(sql).replace(/\s+/g, ' ');
    log.push({ s, params });
    if (/SELECT user_id, bridge_id FROM identities WHERE identity_id/.test(s)) return { rows: [{ user_id: 'testshop', bridge_id: 'BSHOP' }] };
    if (/FROM identities WHERE parent_entity_id = \$1 AND user_id LIKE \$2 AND lower\(btrim\(display_name\)\) = ANY/.test(s))
      return { rows: (o.have || []).map((name, i) => ({ identity_id: 'old-' + i, bridge_id: 'BO' + i, display_name: name, user_id: '~old' + i })) };
    if (o.clash && /INSERT INTO identities .* unnest/.test(s)) { const e = new Error('duplicate key'); e.code = '23505'; throw e; }
    if (/INSERT INTO identities .* unnest/.test(s)) return { rows: params[2].map((name, i) => ({ identity_id: 'p' + (++n), bridge_id: params[1][i], display_name: name, user_id: params[3][i] })) };
    if (/INSERT INTO (customer_list|supplier_list) .* unnest/.test(s)) {
      const ids = params[2];
      return { rows: ids.map((id, i) => ({ id: 'l' + id, party_id: id })) };
    }
    return { rows: [] };
  };
  return { log, h: { query } };
}
const people = (side, count, extra) => Array.from({ length: count }, (_, i) => ({ line: i + 2, what: side + i, action: 'add', data: Object.assign({ side, name: side + ' number ' + i, phone: '+6140000' + String(1000 + i) }, extra && extra(i)) }));
const file = (rows) => ({ kind: 'contacts', source: 'xero', rows });
const ctx = { world: { listIds: [] }, by: 'u1' };

(async () => {
  const small = fakeDb(), big = fakeDb();
  const outSmall = await MI.apply(small.h, SHOP, file(people('customer', 1).concat(people('supplier', 1))), ctx);
  const outBig = await MI.apply(big.h, SHOP, file(people('customer', 40).concat(people('supplier', 40))), ctx);
  await t('every row is added', () => { assert.strictEqual(outSmall.added, 2); assert.strictEqual(outBig.added, 80, JSON.stringify(outBig)); });
  await t('⭐ the number of statements does not grow with the rows (2 rows and 80 rows ask the database the same number of times)', () => {
    assert.ok(big.log.length <= small.log.length, 'small ' + small.log.length + ' vs big ' + big.log.length);
    assert.ok(big.log.length < 30, 'statements: ' + big.log.length);
  });
  await t('the list rows carry the added_via the CHECKs allow, as one parameter', () => {
    const lists = big.log.filter((x) => /INSERT INTO (customer_list|supplier_list)/.test(x.s));
    assert.strictEqual(lists.length, 2);
    lists.forEach((x) => assert.strictEqual(x.params[1], MI.ADDED_VIA));
  });
  const held = fakeDb({ have: ['customer number 0'] });
  const outHeld = await MI.apply(held.h, SHOP, file(people('customer', 2)), ctx);
  await t('a name the shop already holds is left to the per-row path (not landed twice)', () => {
    assert.strictEqual(outHeld.added, 1, JSON.stringify(outHeld));
    assert.strictEqual(outHeld.skipped, 1, JSON.stringify(outHeld));
  });
  const mail = fakeDb();
  await MI.apply(mail.h, SHOP, file(people('customer', 3, (i) => (i === 1 ? { email: 'a@example.com' } : {}))), ctx);
  await t('an e-mail is written for the row that has one, and for no other', () => {
    const writes = mail.log.filter((x) => /party_contact/i.test(x.s) && /INSERT|UPDATE/i.test(x.s));
    assert.ok(writes.length <= 1, 'e-mail writes: ' + writes.length);
  });
  const clash = fakeDb({ clash: true });
  let refused = null;
  try { await MI.apply(clash.h, SHOP, file(people('customer', 3)), ctx); } catch (e) { refused = e; }
  await t('a handle clash refuses the whole file in words (409, MOVE_IN_MINT_BUSY): nothing is imported, the transaction fails closed', () => {
    assert.ok(refused && refused.refused, 'no refusal thrown');
    assert.strictEqual(refused.status, 409); assert.strictEqual(refused.code, 'MOVE_IN_MINT_BUSY');
    assert.ok(/^Nothing was imported/.test(refused.message), refused.message);
  });
  await t('after the refusal no list row is written (the refusal is never retried inside the set)', () => {
    assert.strictEqual(clash.log.filter((x) => /INSERT INTO (customer_list|supplier_list)/.test(x.s)).length, 0);
  });
  await t('an empty file asks the database nothing and lands nothing (closed: no statement without a row)', async () => {
    const quiet = fakeDb();
    const none = await BULK.addContactsAsSet(quiet.h, SHOP, [], MI.ADDED_VIA);
    assert.strictEqual(none.size, 0); assert.strictEqual(quiet.log.length, 0);
  });
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
