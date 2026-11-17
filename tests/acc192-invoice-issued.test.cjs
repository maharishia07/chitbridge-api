/**
 * tests/acc192-invoice-issued.test.cjs — ACC-192 slice 1a: an issued invoice is never rewritten by an amendment (lib/invoice-issued).
 *
 *   M  the marker: "issued" is one of the three markers that already exist (a books entry · invoice.frozen_at · a carried invoice that is not a quotation / pro-forma)
 *   E  which amend edits move money: a different quantity or price, a removal, a put-back; a comment or description fix does not
 *   R  the refusal: 409 INVOICE_MONEY_LOCKED in the registered words; the code is a row of docs/ERROR-CODES.md
 *
 * Offline, no database. Run: node tests/acc192-invoice-issued.test.cjs
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const root = (p) => path.join(__dirname, '..', p);

let pass = 0;
let fail = 0;
const t = async (name, fn) => {
  try {
    await fn();
    pass++;
    console.log('   ok   ' + name);
  } catch (e) {
    fail++;
    console.log('   FAIL ' + name + '\n          ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n          ') : e));
  }
};

const LINES = [
  { particulars: 'Pump seal', quantity: 10, unit: 'pc', price: 100 },
  { particulars: 'Gasket', quantity: 5, unit: 'pc', price: 20 }
];
let AMENDMENTS = [];
let HEADER = null;
const db = {
  query: async (sql) => {
    const s = String(sql).replace(/\s+/g, ' ');
    if (/AS has_invoice/.test(s)) return { rows: HEADER ? [HEADER] : [] };
    if (/^SELECT line_items FROM chit_detail/.test(s)) return { rows: [{ line_items: LINES }] };
    if (/FROM chit_line_amendment/.test(s)) return { rows: AMENDMENTS };
    return { rows: [] };
  }
};
const stub = (file, exp) => {
  const id = require.resolve(root(file));
  require.cache[id] = { id, filename: id, loaded: true, exports: exp };
};
stub('db/index.js', { query: db.query, pool: { query: db.query }, withEntity: async (id, fn) => fn(db), onEntity: async (id, d, fn) => fn(d || db) });
require(root('lib/schema')).hasTable = async () => true;
const issued = require(root('lib/invoice-issued'));

const edit = (idx, line) => ({ line_index: idx, line, reason_code: 'rate_agreed' });
const pump = (more) => Object.assign({ particulars: 'Pump seal', quantity: 10, unit: 'pc', price: 100 }, more);

(async () => {
  console.log('\n== M · the marker ==\n');
  const row = (o) => Object.assign({ has_invoice: false, frozen_at: null, document: null, posted: false }, o);
  await t('a books entry alone is issued (the strongest marker)', () => assert.strictEqual(issued.isIssuedRow(row({ posted: true })), true));
  await t('invoice.frozen_at alone is issued (freezeOnComplete stamped it)', () => assert.strictEqual(issued.isIssuedRow(row({ frozen_at: '2026-11-01' })), true));
  await t('a carried invoice with no jurisdiction (a domestic send) or a tax-invoice document is issued', () => {
    assert.strictEqual(issued.isIssuedRow(row({ has_invoice: true })), true);
    assert.strictEqual(issued.isIssuedRow(row({ has_invoice: true, document: 'tax_invoice' })), true);
  });
  await t('a quotation, a pro-forma, an RFQ with no invoice and a draft are NOT issued: re-issue is right there', () => {
    assert.strictEqual(issued.isIssuedRow(row({ has_invoice: true, document: 'quotation' })), false);
    assert.strictEqual(issued.isIssuedRow(row({ has_invoice: true, document: 'pro_forma' })), false);
    assert.strictEqual(issued.isIssuedRow(row({})), false);
    assert.strictEqual(issued.isIssuedRow(undefined), false);
  });
  await t('a pro-forma that the books HAVE posted is issued (the books marker wins)', () => assert.strictEqual(issued.isIssuedRow(row({ has_invoice: true, document: 'pro_forma', posted: true })), true));
  await t('issuedOn reads the copy in ONE statement', async () => {
    let calls = 0;
    const counting = { query: async () => (calls++, { rows: [row({ posted: true })] }) };
    assert.strictEqual(await issued.issuedOn(counting, 'e1', 'c1'), true);
    assert.strictEqual(calls, 1);
  });

  console.log('\n== E · which amend edits move money ==\n');
  AMENDMENTS = [];
  const moves = (edits) => issued.movesMoney('e1', 'c1', edits);
  await t('a different price, a different quantity and a removal move money', async () => {
    assert.strictEqual(await moves([edit(0, pump({ price: 96 }))]), true);
    assert.strictEqual(await moves([edit(0, pump({ quantity: 9 }))]), true);
    assert.strictEqual(await moves([edit(1, null)]), true);
  });
  await t('a comment or a description fix, with the money keys as they are, does not', async () => {
    assert.strictEqual(await moves([edit(0, pump({ comment: 'after 4pm' }))]), false);
    assert.strictEqual(await moves([edit(0, pump({ particulars: 'Pump seal (steel)' }))]), false);
    assert.strictEqual(await moves([edit(0, pump({ price: '100' }))]), false, 'an equal price typed as text is not a change');
  });
  await t('judged against the LIVE set: after a removal, removing again moves nothing, and putting the line back does', async () => {
    AMENDMENTS = [{ line_index: 1, seq: 1, line: null }];
    assert.strictEqual(await moves([edit(1, null)]), false);
    assert.strictEqual(await moves([edit(1, { particulars: 'Gasket', quantity: 5, unit: 'pc', price: 20 })]), true);
    AMENDMENTS = [{ line_index: 0, seq: 1, line: pump({ price: 96 }) }];
    assert.strictEqual(await moves([edit(0, pump({ price: 96 }))]), false, 'the live price is already 96');
    assert.strictEqual(await moves([edit(0, pump({ price: 100 }))]), true);
    AMENDMENTS = [];
  });

  console.log('\n== R · the refusal ==\n');
  await t('refuseMoneyAmend: issued + a money edit throws 409 INVOICE_MONEY_LOCKED in the registered words; issued + a comment passes; not issued + a price passes', async () => {
    HEADER = row({ posted: true });
    await assert.rejects(issued.refuseMoneyAmend('e1', 'c1', [edit(0, pump({ price: 96 }))]), (e) => e.status === 409 && e.code === 'INVOICE_MONEY_LOCKED' && e.refused === true && e.message === 'This bill is already invoiced. A change in price needs a credit or debit note. Propose the change; the note is issued when the other side accepts.');
    await issued.refuseMoneyAmend('e1', 'c1', [edit(0, pump({ comment: 'x' }))]);
    HEADER = row({ has_invoice: true, document: 'pro_forma' });
    await issued.refuseMoneyAmend('e1', 'c1', [edit(0, pump({ price: 96 }))]);
    await issued.refuseMoneyAmend('e1', 'c1', []);
  });
  await t('the code is a row of the register, with its sentence', () => {
    const md = fs.readFileSync(root('docs/ERROR-CODES.md'), 'utf8');
    assert.ok(/\| INVOICE_MONEY_LOCKED \| 409 \| [^|]+\| This bill is already invoiced\. A change in price needs a credit or debit note\. Propose the change; the note is issued when the other side accepts\. \|/.test(md));
    const reg = require(root('docs/error-codes.json')).codes.find((c) => c.code === 'INVOICE_MONEY_LOCKED');
    assert.ok(reg && reg.status === '409');
  });

  console.log('\n== T · ACC-281 parameter types (one parameter, one type; Postgres refuses uuid = text) ==\n');
  await t('issuedOn: every parameter has one type in each statement and the chit id is uuid (the offline stand-in cannot catch this; the real proof is a SIT rerun)', async () => {
    const seen = [];
    const spy = { query: async (sql) => { seen.push(String(sql).replace(/\s+/g, ' ')); return { rows: [] }; } };
    const hasTable = require(root('lib/schema')).hasTable;
    for (const books of [true, false]) {
      require(root('lib/schema')).hasTable = async () => books;
      await issued.issuedOn(spy, 'e1', 'c1');
    }
    require(root('lib/schema')).hasTable = hasTable;
    assert.strictEqual(seen.length, 2);
    for (const sql of seen) {
      for (const n of new Set(sql.match(/\$\d+/g) || [])) {
        const uses = sql.match(new RegExp('\\' + n + '(::\\w+)?(?!\\d)', 'g')) || [];
        const types = new Set(uses.map((u) => (u.match(/::(\w+)/) || [, 'bare'])[1]));
        assert.ok(types.size === 1, n + ' is used with more than one type (' + [...types] + '): ' + sql);
      }
      assert.ok(/chit_id = \$2::uuid/.test(sql), 'the uuid column is compared with a uuid parameter: ' + sql);
      assert.ok(!/\$2::text/.test(sql), '$2 must not be typed text: ' + sql);
    }
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
