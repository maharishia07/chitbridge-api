#!/usr/bin/env node
// @type: unit
/**
 * tests/books-action-date.test.cjs — a Day book event held for the owner's OK (SHOPBK-B) keeps its date: one typed with no date is frozen to the shop's TODAY when it is prepared, never left to post on the day of the accept. No database, no network.
 * OWNS      withTheDate: no date → the day the shop's clock gave it · a date on the body or inside body.event is kept · a built day that is not YYYY-MM-DD is not written (the regex is the real one: a lost backslash once made it match nothing)
 * CALLED BY scripts/guards.cjs · CI
 */
'use strict';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.DATABASE_URL = '';
const path = require('path');
const assert = require('assert');

const HERE = path.join(__dirname, '..');
/** the shop's clock: eventOf builds the event with today's date when the body has none; the stub answers what it was given, or this day */
const TODAY = '2026-11-19';
const manual = require(path.join(HERE, 'lib', 'books-manual'));
let built = null;
manual.eventOf = async () => built;
const action = require(path.join(HERE, 'lib', 'books-action'));

let pass = 0;
let fail = 0;
const t = async (name, fn) => {
  try {
    await fn();
    pass++;
    console.log('  ok   ' + name);
  } catch (e) {
    fail++;
    console.log('  FAIL ' + name + '\n         ' + String((e && e.message) || e).slice(0, 400));
  }
};

(async () => {
  await t('an event with no date is frozen to today (the real YYYY-MM-DD test)', async () => {
    built = { ev: { date: TODAY + 'T09:30:00+05:30' } };
    const body = { kind: 'expense', amount: 5000 };
    const out = await action.withTheDate('s1', {}, body);
    assert.strictEqual(out.date, TODAY);
    assert.strictEqual(out.kind, 'expense');
    assert.strictEqual(body.date, undefined, 'the caller\'s body is not changed');
  });
  await t('a date on the body is kept', async () => {
    built = { ev: { date: TODAY } };
    const body = { kind: 'expense', date: '2026-11-01' };
    assert.strictEqual((await action.withTheDate('s1', {}, body)).date, '2026-11-01');
  });
  await t('a date inside body.event is kept (nothing is added beside it)', async () => {
    built = { ev: { date: TODAY } };
    const out = await action.withTheDate('s1', {}, { event: { kind: 'expense', date: '2026-10-31' } });
    assert.strictEqual(out.date, undefined);
  });
  await t('a built day that is not a date is not written', async () => {
    for (const bad of [undefined, 'today', '19-11-2026', 'dddd-dd-dd']) {
      built = { ev: { date: bad } };
      assert.strictEqual((await action.withTheDate('s1', {}, { kind: 'expense' })).date, undefined, String(bad));
    }
  });
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
