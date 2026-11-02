/**
 * tests/amend-guard.test.cjs — the receipt lock and its three narrower rules (lib/amend.js guard), offline, on a fake database. The guard read what went out in one statement and checked each edit
 * inline; it is now three steps (deliveredAgainst · refuseDisturbingDelivered · lineLocked), and this pins that every refusal still carries its status, its registered code and a sentence that
 * names the line, and that nothing delivered means nothing refused. Run: node tests/amend-guard.test.cjs
 */
'use strict';
const assert = require('assert');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const amend = require(path.join(__dirname, '..', 'lib', 'amend'));

let pass = 0,
  fail = 0;
const t = async (name, fn) => {
  try {
    await fn();
    pass++;
    console.log('   ok   ' + name);
  } catch (e) {
    fail++;
    console.log('   FAIL ' + name + '\n          ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n          ') : e));
  }
};

const LINE = '11111111-1111-4111-8111-111111111111';
/** a database that has delivered `delivered` of a line ordered in `unit`, and counts the statements it was asked */
function dbWith(delivered, unit = 'kg', fail42P01 = false) {
  const db = { asked: 0 };
  db.query = async () => {
    db.asked++;
    if (fail42P01) throw Object.assign(new Error('relation does not exist'), { code: '42P01' });
    return { rows: [{ line_id: LINE, particulars: 'Basmati', ordered_unit: unit, delivered }] };
  };
  return db;
}
const edit = (line) => [{ line_id: LINE, line }];
const refusal = async (promise) => {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  return null;
};

(async () => {
  console.log('\n== the receipt lock ==\n');
  await t('a line with nothing delivered is amended freely (and the check is ONE statement)', async () => {
    const db = dbWith(0);
    assert.strictEqual(await refusal(amend.guard(db, 'e', 'c', edit({ quantity: 1, unit: 'kg' }))), null);
    assert.strictEqual(db.asked, 1);
  });
  await t('edits that name no existing line ask the database nothing', async () => {
    const db = dbWith(40);
    assert.strictEqual(await refusal(amend.guard(db, 'e', 'c', [{ line: { quantity: 1 } }])), null);
    assert.strictEqual(db.asked, 0);
  });
  await t('removing a delivered line: 409 LINE_DELIVERED, naming the line and what went out', async () => {
    const e = await refusal(amend.guard(dbWith(40), 'e', 'c', edit(null)));
    assert.ok(e && e.status === 409 && e.code === 'LINE_DELIVERED');
    assert.ok(/Basmati/.test(e.message) && /40 kg/.test(e.message), e.message);
  });
  await t('changing the unit of a delivered line, or omitting it: 409 LINE_UNIT_LOCKED', async () => {
    const changed = await refusal(amend.guard(dbWith(40), 'e', 'c', edit({ quantity: 100, unit: 'piece' })));
    assert.ok(changed && changed.status === 409 && changed.code === 'LINE_UNIT_LOCKED');
    const omitted = await refusal(amend.guard(dbWith(40), 'e', 'c', edit({ quantity: 100 })));
    assert.ok(omitted && omitted.code === 'LINE_UNIT_LOCKED', 'an omitted unit is a change to nothing, not "leave it alone"');
    const sameUnitSpelled = await refusal(amend.guard(dbWith(40), 'e', 'c', edit({ quantity: 100, unit: ' KG ' })));
    assert.strictEqual(sameUnitSpelled, null, 'case and spaces do not make a different unit');
  });
  await t('reducing a delivered line below what went out: 409 LINE_BELOW_DELIVERED; to exactly that is allowed', async () => {
    const e = await refusal(amend.guard(dbWith(40), 'e', 'c', edit({ quantity: 20, unit: 'kg' })));
    assert.ok(e && e.status === 409 && e.code === 'LINE_BELOW_DELIVERED' && /reduced to 20/.test(e.message));
    assert.strictEqual(await refusal(amend.guard(dbWith(40), 'e', 'c', edit({ quantity: 40, unit: 'kg' }))), null);
    assert.strictEqual(await refusal(amend.guard(dbWith(40), 'e', 'c', edit({ quantity: 70, unit: 'kg' }))), null, 'partial delivery stays amendable upward');
  });
  await t('an environment that has not run b144 refuses nothing (the relation is missing: no deliveries)', async () => {
    assert.strictEqual(await refusal(amend.guard(dbWith(0, 'kg', true), 'e', 'c', edit(null))), null);
  });

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log('   FAIL the test itself threw: ' + e.message);
  process.exit(1);
});
