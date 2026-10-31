/**
 * tests/ctp-repair.test.cjs — lib/ctp-repair.js (RAIL-107 repair of copies that name their sender by an id from the SENDER's database), offline on injected deps: a dry run changes nothing and says
 * "would repair"; --apply repoints a header to the sender's stub (made or reused) as that business; a copy that does not say which installation sent it, and a stub the door refuses (RAIL-102),
 * are reported and left alone; a business with nothing orphaned adds no rows. Run: node tests/ctp-repair.test.cjs
 */
'use strict';
const assert = require('assert');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const { repairSenders } = require(path.join(__dirname, '..', 'lib', 'ctp-repair'));

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

const MINE = '11111111-1111-4111-8111-111111111111';
const EMPTY = '22222222-2222-4222-8222-222222222222';
const STUB = '33333333-3333-4333-8333-333333333333';
const arrival = { sender_bridge_id: 'CBIN01-root', from_installation: 'sit-in', from_domain: 'in.example' };
const orphan = (extra) => Object.assign({ chit_id: 'c-1', sender_entity_id: 'foreign', sender_entity_bridge_id: 'CBIN01-root', sender_entity_display_name: 'Chennai Pumps', all_recipients: [{ bridge_id: 'CBAU01-root', entity_id: 'x' }], arrival }, extra || {});

/** deps: one business with `orphans`, one with none; records the updates it was asked to make */
function world(orphans, stub) {
  const updates = [];
  const db = {
    query: async () => ({ rows: [{ identity_id: MINE, bridge_id: 'CBAU01-root' }, { identity_id: EMPTY, bridge_id: 'CBAU02-root' }] }),
    withEntity: async (entityId, work) =>
      work({
        query: async (sql, params) => {
          if (/^UPDATE chit_header/.test(sql)) {
            updates.push({ entityId, params });
            return { rows: [] };
          }
          return { rows: entityId === MINE ? orphans : [] };
        }
      })
  };
  const party = {
    stubFor: async () => stub,
    holdersOf: async () => new Map(),
    localizeParties: (header, ids) => ({ sender_entity_id: ids.senderId, all_recipients: header.all_recipients })
  };
  return { deps: { db, party }, updates };
}

(async () => {
  await t('a dry run reports "would repair" and writes nothing', async () => {
    const w = world([orphan()], { ok: true, identity_id: STUB, created: true });
    const report = await repairSenders(w.deps, {});
    assert.deepStrictEqual([report.apply, report.found, report.repaired, report.refused], [false, 1, 0, 0]);
    assert.strictEqual(report.rows[0].result, 'would repair');
    assert.strictEqual(w.updates.length, 0);
  });
  await t('--apply repoints the header to the stub as that business, and says whether the stub was made or reused', async () => {
    const made = world([orphan()], { ok: true, identity_id: STUB, created: true });
    const report = await repairSenders(made.deps, { apply: true });
    assert.deepStrictEqual([report.found, report.repaired, report.refused], [1, 1, 0]);
    assert.strictEqual(report.rows[0].result, 'repaired (stub made)');
    assert.strictEqual(report.rows[0].stub, STUB);
    assert.strictEqual(made.updates.length, 1);
    assert.strictEqual(made.updates[0].entityId, MINE, 'written as the business that holds the copy (RLS)');
    assert.strictEqual(made.updates[0].params[2], STUB);
    const reused = await repairSenders(world([orphan()], { ok: true, identity_id: STUB, created: false }).deps, { apply: true });
    assert.strictEqual(reused.rows[0].result, 'repaired (stub reused)');
  });
  await t('a copy that does not say which installation sent it is reported and left alone', async () => {
    const w = world([orphan({ arrival: {} })], { ok: true, identity_id: STUB });
    const report = await repairSenders(w.deps, { apply: true });
    assert.deepStrictEqual([report.found, report.repaired, report.refused], [1, 0, 1]);
    assert.match(report.rows[0].result, /^skipped/);
    assert.strictEqual(w.updates.length, 0);
  });
  await t('a stub the door refuses (the bridge id belongs to a different local business) is reported, not written', async () => {
    const w = world([orphan()], { ok: false, why: 'that id belongs to another business here' });
    const report = await repairSenders(w.deps, { apply: true });
    assert.deepStrictEqual([report.repaired, report.refused], [0, 1]);
    assert.strictEqual(report.rows[0].result, 'refused: that id belongs to another business here');
    assert.strictEqual(w.updates.length, 0);
  });

  await t('the tool tools/ctp-repair-senders.cjs prints one JSON object and exits 1 when the database cannot be reached (no secret, no stack)', async () => {
    const ran = require('child_process').spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'ctp-repair-senders.cjs')], { env: Object.assign({}, process.env, { DATABASE_URL: '' }), encoding: 'utf8', timeout: 60000 });
    assert.strictEqual(ran.status, 1);
    const lastLine = ran.stdout.trim().split('\n').pop();
    assert.strictEqual(JSON.parse(lastLine).ok, false);
    assert.ok(!/postgres:\/\//.test(ran.stdout), 'no connection string is printed');
  });

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
