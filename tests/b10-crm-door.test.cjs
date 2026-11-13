/**
 * B10 (C10 CRM) - the door shape. Offline (tests/support/crm-stub.cjs for the CRM routes, plain units for the helpers). Each rule fails on main.
 *   CRM-246  a cheque held for a party (received, not cleared) refuses "remove" with a 409 in words; a cleared one does not; nothing is hidden
 *   CRM-244  the tax id on the customer door: bounded always (15 characters, letters and digits), the country's own check only for a STATED country
 *   CRM-243  the lead import matches a phone by its last 9 digits (stores.phoneMatchKey): "+91 98400 12321" and "9840012321" are one number, said by name, never merged silently
 *   CRM-227  a follow-up's due_at: a real day only, and a bare number is refused (BAD_DUE) - never a RangeError (500)
 *   CRM-237  a lead's name must be text
 *   party-live: hiddenSql is the mirror of liveSql (one spelling of hidden_at)
 * Run: node tests/b10-crm-door.test.cjs
 * CARD 11-crm-and-marketing/crm-parties
 */
'use strict';
const assert = require('assert'), path = require('path');
const API = path.join(__dirname, '..');
{ const p = require.resolve(path.join(API, 'lib/schema')); require.cache[p] = { id: p, filename: p, loaded: true, exports: { hasTable: async () => true, hasColumn: async () => true, hasColumns: async () => ({}), checkAllows: async () => true, _reset() {} } }; }
const { make, row } = require('./support/crm-stub.cjs');
const PF = require('../lib/party-fields');
const CL = require('../lib/crm-leads');
const PL = require('../lib/party-live');
const PR = require('../lib/party-restore'); // restore lives beside party-live, not in it (the till's DB-free groups reader shares party-live)
const t = make(), D = t.data;
const P = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
let pass = 0;
const ita = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + (e.stack || e.message).split('\n').slice(0, 5).join('\n      ')); process.exitCode = 1; } };
const cs = (r) => Object.assign(r, { customer_type: 'entity', added_via: 'manual', txn_count: 1, segment: 'new' });
D.cust = [cs(row({ party_id: P(1), display_name: 'Cheque Payer', user_id: 'cp' })), cs(row({ party_id: P(2), display_name: 'Cleared Payer', user_id: 'cl' })), cs(row({ party_id: P(3), display_name: 'Nothing Held', user_id: 'nh' })), cs(row({ party_id: P(4), display_name: 'Follow Me', user_id: 'fm' }))];
D.sup = [];
[1, 2, 3, 4].forEach((n) => { D.stored.customer[P(n)] = { balance_minor: 0 }; });
/* the books payment reader (books-store.cheques): a held cheque for P(1), a cleared one for P(2) - the reader answers by the party it is asked about */
D.pre = async (sql, p) => {
  if (/FROM books_payment p WHERE p\.entity_id = \$1 AND p\.mode = 'cheque'/.test(sql)) {
    const who = p[3];
    if (who === P(1)) return { rows: [{ payment_id: 'pay1', party_id: P(1), direction: 'in', amount_minor: 500000, cheque_no: '004512', status: 'received' }] };
    return { rows: [] }; /* P(2): its only cheque is cleared, so the reader's "still held" filter returns none */
  }
  return null;
};

(async () => {
  await ita('CRM-246: a held cheque refuses remove: 409 in words, nothing hidden', async () => {
    const r = await t.del('/parties/' + P(1));
    assert.strictEqual(r.status, 409, JSON.stringify(r.body));
    assert.strictEqual(r.body.code, 'HAS_DUES');
    assert.ok(/cheque/i.test(r.body.message || r.body.detail) && /004512/.test(r.body.message || r.body.detail), r.body.message);
    assert.strictEqual(D.cust.find((x) => x.party_id === P(1)).hidden_at, null);
  });
  await ita('CRM-246: a party whose cheque cleared (the reader returns none) is removed as before', async () => {
    const r = await t.del('/parties/' + P(2));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(D.cust.find((x) => x.party_id === P(2)).hidden_at);
  });
  await ita('CRM-246: the reader is asked about THIS party (the widened books-store.cheques, one statement)', async () => {
    D.queries.length = 0;
    await t.del('/parties/' + P(3));
    const asked = D.queries.filter((q) => /FROM books_payment p/.test(q));
    assert.strictEqual(asked.length, 1);
  });
  await ita('CRM-244: a 300-character tax id, a 16-character one and a shape with symbols are refused in words (the column holds 15)', async () => {
    for (const bad of ['A'.repeat(300), 'A'.repeat(16), 'AB<script>', '12 34;5']) assert.ok(PF.doorTaxId(bad).why, bad.slice(0, 20));
    assert.deepStrictEqual(PF.doorTaxId(' 29abcde1234f1z5 '), { value: '29ABCDE1234F1Z5' });
    assert.deepStrictEqual(PF.doorTaxId(''), { value: null });
  });
  await ita('CRM-244: the pack\'s own check runs for a STATED country only: a UAE TRN passes with the country unknown and is refused by a stated AU rule; a bad GSTIN is refused for a stated IN', async () => {
    assert.deepStrictEqual(PF.doorTaxId('784123456789012', undefined), { value: '784123456789012' }, 'unknown country: shape only, never the shop\'s');
    assert.deepStrictEqual(PF.doorTaxId('784123456789012', ''), { value: '784123456789012' });
    assert.ok(PF.doorTaxId('784123456789012', 'AU').why, 'stated AU: the ABN rule');
    assert.ok(PF.doorTaxId('29ABCDE1234F1Z0', 'IN').why, 'stated IN: the GSTIN checksum');
  });
  await ita('CRM-243: the import names a phone written another way ("+91 98400 12321" vs "9840012321") and skips it, never merges it silently', async () => {
    const rows = CL.normalise([{ name: 'A', phone: '98400 12321' }, { name: 'B', phone: '+91-98400-12321' }]);
    assert.strictEqual(rows[1].why, 'Same phone as row 1');
    const file = CL.normalise([{ name: 'New Name', phone: '9840012321' }]);
    CL.plan(file, [{ identity_id: 'x1', digits: '919840012321', name: 'Ravi Stores', name_fold: 'ravi stores', minted: true, on_customer: true, added_via: 'manual', txn_count: 0, supplier: false }]);
    assert.strictEqual(file[0].outcome, 'skip');
    assert.strictEqual(file[0].why, 'Same phone as Ravi Stores');
    assert.strictEqual(file[0].party_id, undefined, 'the matched party is not handed back');
    const exact = CL.normalise([{ name: 'New Name', phone: '9840012321' }]);
    CL.plan(exact, [{ identity_id: 'x1', digits: '9840012321', name: 'Ravi Stores', name_fold: 'ravi stores', minted: true, on_customer: true, added_via: 'manual', txn_count: 0, supplier: false }]);
    assert.strictEqual(exact[0].outcome, 'merge', 'the same number written the same way still merges, as reported');
  });
  await ita('CRM-227: due_at 2026-02-30 and 0001-01-01 are refused BAD_DUE (not a 500); a bare number is refused; a real day is made', async () => {
    for (const due_at of ['2026-02-30', '0001-01-01', '12345', 12345]) {
      const r = await t.post('/followups', { party_id: P(4), what: 'ring', due_at });
      assert.strictEqual(r.status, 400, due_at + ' ' + JSON.stringify(r.body));
      assert.strictEqual(r.body.code, 'BAD_DUE');
    }
    const ok = await t.post('/followups', { party_id: P(4), what: 'ring', due_at: '2026-12-31' });
    assert.strictEqual(ok.status, 201, JSON.stringify(ok.body));
  });
  await ita('CRM-237: a name that is not text (a number, an object, a list) is refused 400 at the door - a lead and a walk-in - and nothing is minted', async () => {
    const before = D.queries.length;
    for (const name of [123, { first: 'x' }, ['x']]) {
      for (const [url, body] of [['/leads', { name }], ['/walk-ins/add', { name, phone: '+919840012321' }]]) {
        const r = await t.post(url, body);
        assert.strictEqual(r.status, 400, url + ' ' + JSON.stringify(name) + ' ' + JSON.stringify(r.body));
      }
    }
    assert.ok(!D.queries.slice(before).some((q) => /^INSERT INTO identities/.test(q)), 'nothing minted');
  });
  await ita('party-live: hiddenSql is the mirror of liveSql (one spelling of hidden_at), and restore undoes removeParty on both lists', async () => {
    assert.strictEqual(PL.hiddenSql('cl'), "to_jsonb(cl)->>'hidden_at' IS NOT NULL");
    const seen = [];
    const back = await PR.restore({ query: async (sql) => { seen.push(sql); return { rows: [{ one: 1 }] }; } }, 'o', 'p');
    assert.strictEqual(back, 2);
    assert.ok(/UPDATE customer_list SET hidden_at = NULL/.test(seen[0]) && /UPDATE supplier_list SET hidden_at = NULL/.test(seen[1]));
  });
  console.log(pass + ' checks');
  process.exit(process.exitCode || 0);
})();
