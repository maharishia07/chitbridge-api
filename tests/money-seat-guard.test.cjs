'use strict';
/**
 * tests/money-seat-guard.test.cjs — DRIFT 19b + 35a (28 Nov 2026): a route that is not the Books page may not return books money to a seat the books refuse.
 * The enforcer is lib/money-seat.noMoney (= not routes/books gates.mayReadMoney); the masks are lib/dues-view noMoneyRow / noMoneyRisk (null + cost_hidden:true).
 * Hand expectations (written before the code, from the proof rows): customer row {balance_minor 72586, oldest_due 2026-11-18} for a refused seat -> balance_minor null, cost_hidden true, oldest_due kept;
 *   a risk answer with top.value 34317.4 and total 46696.8 -> every `value` and `total` null at every depth, pct 73.5 and the counterparty name kept, cost_hidden true, the input untouched.
 * The guard: (1) every MONEY_SEAT_ROUTES handler calls noMoney; (2) any routes/ or lib/ file that decorates customer balances or reads kyb.risk is a listed file (lib/crm.js is read only through routes/crm.js, listed) — a new door fails here.
 * No DB, no network. Run: node --test tests/money-seat-guard.test.cjs
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const { MONEY_SEAT_ROUTES } = require('../lib/money-seat');
const view = require('../lib/dues-view');

test('noMoneyRow: the balance goes, the date stays; a ledger-off row is left alone', () => {
  const row = { balance_minor: 72586, oldest_due: '2026-11-18' };
  assert.deepEqual(view.noMoneyRow(row), { balance_minor: null, cost_hidden: true, oldest_due: '2026-11-18' });
  assert.deepEqual(view.noMoneyRow({ display_name: 'x' }), { display_name: 'x' });
});

test('noMoneyRisk: every amount at every depth is null, names and percentages stand, input untouched', () => {
  const party = { counterparty: 'CBT Australia Retailer', value: 34317.4, pct: 73.5 };
  const answer = { section: 'risk', facts: { exposures: [{ fact: '73.5% of your AUD business sits with one buyer (CBT Australia Retailer).' }], concentration: { top: party, parties: [party], chits: 498, by_currency: [{ currency: 'AUD', total: 46696.8, chits: 498, top: party, parties: [party] }], excluded: { non_monetary: 0 } }, expiring: [] } };
  const before = JSON.stringify(answer);
  const out = view.noMoneyRisk(answer);
  assert.equal(JSON.stringify(answer), before);
  const text = JSON.stringify(out);
  assert.ok(!/34317|46696/.test(text), 'no amount survives');
  assert.equal(out.facts.concentration.top.value, null);
  assert.equal(out.facts.concentration.by_currency[0].total, null);
  assert.equal(out.facts.concentration.by_currency[0].parties[0].value, null);
  assert.equal(out.facts.concentration.top.pct, 73.5);
  assert.equal(out.facts.concentration.top.counterparty, 'CBT Australia Retailer');
  assert.equal(out.facts.concentration.chits, 498);
  assert.equal(out.facts.concentration.cost_hidden, true);
});

const handlerOf = (src, marker) => {
  const at = src.indexOf(marker);
  assert.ok(at >= 0, 'route not found: ' + marker);
  const next = src.indexOf('\nrouter.', at + marker.length);
  return src.slice(at, next < 0 ? undefined : next);
};

test('every route in MONEY_SEAT_ROUTES asks lib/money-seat noMoney', () => {
  for (const { file, route } of MONEY_SEAT_ROUTES) {
    const h = handlerOf(fs.readFileSync(path.join(root, file), 'utf8'), route);
    assert.ok(/noMoney/.test(h), file + ' ' + route + ' returns books money without lib/money-seat.noMoney (drift 19b/35a)');
  }
});

test('no other route or lib file decorates customer balances or reads the KYB risk', () => {
  const listed = new Set(MONEY_SEAT_ROUTES.map((item) => item.file));
  listed.add('lib/crm.js'); // reached only through routes/crm.js GET /parties, listed
  listed.add('lib/party-fields.js'); // the decorator itself
  listed.add('lib/kyb.js'); // the risk reader itself
  const hits = [];
  for (const dir of ['routes', 'lib']) {
    for (const name of fs.readdirSync(path.join(root, dir)).filter((item) => item.endsWith('.js'))) {
      const rel = dir + '/' + name;
      if (listed.has(rel)) continue;
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      if (/decorate\([^)]*'customer'\)/.test(src) || /kyb\.risk\(/.test(src)) hits.push(rel);
    }
  }
  assert.deepEqual(hits, [], 'a new door to customer balances or trade totals must join MONEY_SEAT_ROUTES and call noMoney: ' + hits.join(', '));
});

test('a routes/ file that names balance_minor is the books, a listed money-seat file, or exempt with a reason', () => {
  const exempt = {
    'routes/books.js': 'the Books page: its own gate (moneyReader / mayReadMoney) and blindDues',
    'routes/till.js': 'DECIDED 28 Nov (cb-counter): GET /snapshot hands the counter each customer balance + open bills ONLY so it can enforce the credit limit offline (DEC-051: credit limit warns, owner PIN-overrides offline; SPEC-books-v2 C2/D1). Device-scoped (till key), ledger-on only, not a books screen; hiding it would make the till fail open on credit. Re-open if a view-only seat can pair a till'
  };
  const listed = new Set(MONEY_SEAT_ROUTES.map((item) => item.file));
  const hits = fs.readdirSync(path.join(root, 'routes')).filter((n) => n.endsWith('.js')).map((n) => 'routes/' + n).filter((rel) => !listed.has(rel) && !exempt[rel] && /balance_minor/.test(fs.readFileSync(path.join(root, rel), 'utf8')));
  assert.deepEqual(hits, [], 'a route returning balance_minor must call lib/money-seat.noMoney (and join MONEY_SEAT_ROUTES) or be exempt with a reason: ' + hits.join(', '));
});
