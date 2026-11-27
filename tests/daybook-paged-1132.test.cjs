'use strict';
/**
 * tests/daybook-paged-1132.test.cjs — batch 1132 (Athi, 26 Nov 2026: "any read is a handful of records, lazy-load the rest"): GET /daybook answers ONE page when nothing is asked, never the whole range.
 * Run: node tests/daybook-paged-1132.test.cjs
 * MIN fail-closed: the route reads its page through daybookPageQ (the old pageQ answered null = every row) and the register column holds.
 * MIN refusal-path: an unasked, a page-only and an order-only read all get a size; a size past the maximum is clamped.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const D = require('../lib/books-daybook');
const S = require('../lib/books-store');
const { factsOf, causesOf } = require('../lib/paged-read');
let pass = 0, fail = 0;
const check = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { fail++; console.log('  FAIL ' + what + '\n      ' + e.message); } };

check('nothing asked: ONE default page (never null = the whole range)', () => {
  const pg = D.daybookPageQ({});
  assert.ok(pg && pg.limit === S.PAGE_DEFAULT && pg.after === null && pg.desc === false);
});
check('only an order or only a page number asked: still one page of the default size', () => {
  assert.strictEqual(D.daybookPageQ({ order: 'desc' }).limit, S.PAGE_DEFAULT);
  assert.strictEqual(D.daybookPageQ({ order: 'desc' }).desc, true);
  assert.strictEqual(D.daybookPageQ({ page: '2' }).limit, S.PAGE_DEFAULT);
});
check('a size past the server maximum is clamped; a cursor is read', () => {
  assert.strictEqual(D.daybookPageQ({ limit: '99999' }).limit, S.PAGE_MAX);
  assert.deepStrictEqual(D.daybookPageQ({ after: '2026-10-01|JV/1' }).after, { date: '2026-10-01', no: 'JV/1' });
});
check('the entries read (a ledger line opening its journal) is still exactly those entries', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  assert.deepStrictEqual(D.daybookPageQ({ entries: id }), { entries: [id] });
});
check('the Ledger keeps pageQ (its running balance reads the whole range from the opening): null when nothing asked', () => {
  assert.strictEqual(D.pageQ({}), null);
});
check('the route reads GET /daybook through daybookPageQ, never pageQ (fails on the old route)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'books.js'), 'utf8');
  const at = src.indexOf("router.get('/daybook'");
  const body = src.slice(at, src.indexOf("router.get('/ledger/:account'"));
  assert.ok(/Daybook\.daybookPageQ\(req\.query\)/.test(body), 'GET /daybook no longer reads daybookPageQ');
  assert.ok(!/[^.\w]pageQ\(req\.query\)/.test(body), 'GET /daybook reads pageQ again (null = every row)');
});
check('register column 21 for GET /daybook: bounded when nothing is asked, with a server maximum, no causes', () => {
  const reg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'api-register.json'), 'utf8'));
  const row = (reg.routes || reg.rows).find((x) => x.key === 'GET /api/books/daybook');
  const facts = row.reported_facts.paged_read;
  assert.deepStrictEqual([facts.kind, facts.unasked, facts.default, facts.max], ['list', 'bounded', 100, 500]);
  assert.strictEqual(row.columns ? row.columns.paged_read !== false : true, true);
  assert.deepStrictEqual(causesOf(facts), []);
});
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) process.exitCode = 1;
