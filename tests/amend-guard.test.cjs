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
  await t('an edit that names a position the chit holds no id for asks the payload once and refuses nothing (nothing can be delivered against it)', async () => {
    const db = dbWith(40);
    db.query = async () => { db.asked++; return { rows: [{ line_items: [{ particulars: 'Rice' }] }] }; };
    assert.strictEqual(await refusal(amend.guard(db, 'e', 'c', amend.prepare([{ line_index: 0, line: { particulars: 'Rice', quantity: 1 } }]))), null);
    assert.strictEqual(db.asked, 1);
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

  console.log('\n== RAIL-174: an omitted quantity on a delivered line is refused ==\n');
  await t('40 kg delivered, the correction omits quantity: 409 LINE_BELOW_DELIVERED naming the line; quantity 40 passes; nothing delivered passes', async () => {
    const e = await refusal(amend.guard(dbWith(40), 'e', 'c', edit({ particulars: 'Basmati', unit: 'kg' })));
    assert.ok(e && e.status === 409 && e.code === 'LINE_BELOW_DELIVERED', String(e && e.code));
    assert.ok(/Basmati/.test(e.message) && /needs its quantity/.test(e.message) && /40 kg/.test(e.message) && /at least 40/.test(e.message), e.message);
    const nul = await refusal(amend.guard(dbWith(40), 'e', 'c', amend.prepare([{ line_index: 0, line_id: LINE, line: { particulars: 'Basmati', unit: 'kg', quantity: null } }])));
    assert.ok(nul && nul.code === 'LINE_BELOW_DELIVERED', 'a null quantity is the same erasure');
    assert.strictEqual(await refusal(amend.guard(dbWith(40), 'e', 'c', edit({ particulars: 'Basmati', unit: 'kg', quantity: 40 }))), null);
    assert.strictEqual(await refusal(amend.guard(dbWith(0), 'e', 'c', edit({ particulars: 'Basmati', unit: 'kg' }))), null, 'nothing delivered: free as before');
  });

  console.log('\n== RAIL-175: a line named by position is judged like one named by id ==\n');
  const OTHER_ID = '33333333-3333-4333-8333-333333333333';
  const byPosition = (delivered, ids) => ({
    asked: [],
    query: async function (sql) {
      this.asked.push(/chit_detail/.test(sql) ? 'payload' : 'delivered');
      if (/chit_detail/.test(sql)) return { rows: [{ line_items: ids.map((id) => ({ line_id: id })) }] };
      return { rows: [{ line_id: LINE, particulars: 'Basmati', ordered_unit: 'kg', delivered }] };
    }
  });
  await t('removing a delivered line by line_index alone: 409 LINE_DELIVERED (it used to pass the lock and reach the audit)', async () => {
    const db = byPosition(40, [OTHER_ID, LINE]);
    const e = await refusal(amend.guard(db, 'e', 'c', amend.prepare([{ line_index: 1, line: null }])));
    assert.ok(e && e.status === 409 && e.code === 'LINE_DELIVERED' && /Basmati/.test(e.message), String(e && e.message));
    assert.deepStrictEqual(db.asked, ['payload', 'delivered']);
  });
  await t('the position fills the prepared edit in place, so the live row and the audit row get the line_id too', async () => {
    const prepared = amend.prepare([{ line_index: 1, line: { particulars: 'Basmati', quantity: 50, unit: 'kg' } }]);
    assert.strictEqual(await refusal(amend.guard(byPosition(40, [OTHER_ID, LINE]), 'e', 'c', prepared)), null);
    assert.strictEqual(prepared[0].line_id, LINE);
  });
  await t('an edit that already has its line_id costs no payload read', async () => {
    const db = byPosition(0, [LINE]);
    await amend.guard(db, 'e', 'c', amend.prepare([{ line_index: 0, line_id: LINE, line: { particulars: 'Basmati', quantity: 1, unit: 'kg' } }]));
    assert.deepStrictEqual(db.asked, ['delivered']);
  });

  console.log('\n== RAIL-148: line_id and line_index must name the same line, for every caller ==\n');
  const OTHER = '22222222-2222-4222-8222-222222222222';
  const frozen = (ids) => ({ asked: 0, query: async function () { this.asked++; return { rows: [{ line_items: ids.map((id) => ({ line_id: id })) }] }; } });
  const both = (idx, id) => amend.prepare([{ line_index: idx, line_id: id, line: { particulars: 'Rice', quantity: 1 } }]);
  await t('a pair naming two lines: 400, the sentence says so, before anything is written', async () => {
    const e = await refusal(amend.refuseMismatch(frozen([OTHER, LINE]), 'e', 'c', both(0, LINE)));
    assert.ok(e && e.status === 400 && e.code === 'AMEND_LINE_INDEX' && /two different lines/.test(e.message));
  });
  await t('a pair naming the same line passes (and costs one read)', async () => {
    const db = frozen([LINE, OTHER]);
    assert.strictEqual(await refusal(amend.refuseMismatch(db, 'e', 'c', both(0, LINE))), null);
    assert.strictEqual(db.asked, 1);
  });
  await t('an edit with no line_id, or a position the payload holds no id for, is not judged', async () => {
    const none = frozen([LINE]);
    assert.strictEqual(await refusal(amend.refuseMismatch(none, 'e', 'c', amend.prepare([{ line_index: 0, line: { particulars: 'Rice', quantity: 1 } }]))), null);
    assert.strictEqual(none.asked, 0, 'no line_id, no read');
    assert.strictEqual(await refusal(amend.refuseMismatch(frozen([]), 'e', 'c', both(5, LINE))), null);
  });

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log('   FAIL the test itself threw: ' + e.message);
  process.exit(1);
});
