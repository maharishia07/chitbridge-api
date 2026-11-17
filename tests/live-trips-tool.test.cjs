'use strict';
/**
 * tests/live-trips-tool.test.cjs - the live-trips harness (SPD-39) puts sit-in back as it found it when a run throws, and a re-run tolerates what an earlier run left.
 * Run: node tests/live-trips-tool.test.cjs - offline: a FAKE sit-in client records every call and every SQL line; nothing is sent anywhere.
 */
const assert = require('assert');
const tool = require('../tools/live-trips.cjs');
const hints = require('../tools/live-trips-hints.cjs');
let pass = 0;
const t = async (name, fn) => { await fn(); pass += 1; console.log('  ok   ' + name); };
/** a fake client with the same face as the tool's API: it records, it answers 200 */
function fakeApi(seeds) {
  const sql = []; const calls = []; let cleared = 0;
  return { sql: (x) => { sql.push(x); return []; }, call: async (m, u) => { calls.push(m + ' ' + u); return { status: 200, body: {} }; }, seeds, save() {}, clearState() { cleared += 1; }, log: { sql, calls, cleared: () => cleared } };
}
const allSetUp = () => ({ registerOn: true, unclaimed: true, periods: true, counter: 'c-1', screens: ['j-1', 'j-2'] });

(async () => {
  await t('a thrown error in the run still restores every set-up, and the error is kept', async () => {
    const api = fakeApi(allSetUp());
    await assert.rejects(tool.guarded(async () => { throw new Error('boom mid-run'); }, () => tool.restoreAll(api)), /boom mid-run/);
    const sql = api.log.sql.join('\n');
    assert.ok(/capabilities = null/.test(sql), 'register capability back to NULL');
    assert.ok(/set claimed = true/.test(sql), 'cb_entity claimed back to true');
    assert.ok(api.log.calls.includes('POST /api/books/periods/2026-27/1/unlock') && api.log.calls.includes('POST /api/books/periods/2026-27/2/unlock'), 'periods unlocked');
    assert.ok(api.log.calls.includes('POST /api/till/screens/revoke') && api.log.calls.includes('POST /api/counters/c-1/release'), 'screens revoked, counter released');
    assert.strictEqual(api.log.cleared(), 1, 'state file cleared after the restore');
  });
  await t('a run that changed nothing restores nothing (no SQL, no calls)', async () => {
    const api = fakeApi({});
    await tool.guarded(async () => 'ok', () => tool.restoreAll(api));
    assert.deepStrictEqual([api.log.sql, api.log.calls], [[], []]);
  });
  await t('a restore step that fails is told and does not hide the run error', async () => {
    const api = fakeApi(allSetUp());
    api.sql = () => { throw new Error('ssh down'); };
    await assert.rejects(tool.guarded(async () => { throw new Error('first error'); }, () => tool.restoreAll(api)), /first error/);
  });
  await t('the work result is returned when nothing throws', async () => {
    assert.strictEqual(await tool.guarded(async () => 42, async () => {}), 42);
  });
  const cleanup = require('../tools/live-trips-cleanup.cjs');
  const T1 = '11111111-1111-4111-8111-111111111111'; const U1 = '22222222-2222-4222-8222-222222222222'; const E1 = '33333333-3333-4333-8333-333333333333';
  const cleanApi = () => { const log = { sql: [], calls: [] }; return { log, sql: (x) => { log.sql.push(x); return /not like/.test(x) ? [[U1]] : [[T1]]; }, call: async (m, u) => { log.calls.push(m + ' ' + u); if (u === '/api/keys') return { status: 200, body: { keys: [{ jti: 'abc12345', name: 'kit csv · 2026-11-06' }, { jti: 'keep0000', name: 'kit tally · 2026-11-06' }] } }; if (/daybook/.test(u)) return { status: 200, body: { entries: [{ entry_id: E1, entry_no: 'WO/1', event_type: 'write_off', narration: 'lt- live-trips probe' }, { entry_id: U1, event_type: 'write_off', narration: 'real' }] } }; return { status: 200, body: {} }; } }; };
  await t('--cleanup without --apply only prints the plan: no delete, no revoke, no reversal', async () => {
    const api = cleanApi();
    await cleanup.cleanup(api, { apply: false, at: '2026-11-06', day: '2026-11-06', loadId: 'L' });
    assert.ok(!api.log.sql.some((x) => /delete/.test(x)) && api.log.calls.every((c) => c.startsWith('GET ')));
  });
  await t('--cleanup --apply takes back only the tagged rows, the csv kit key and the lt- write-off', async () => {
    const api = cleanApi();
    const out = await cleanup.cleanup(api, { apply: true, at: '2026-11-06', day: '2026-11-06', loadId: 'L' });
    const del = api.log.sql.filter((x) => /^delete/.test(x));
    assert.strictEqual(del.length, 1);
    assert.ok(del[0].includes(T1) && !del[0].includes(U1), 'the untagged row is left');
    assert.ok(api.log.calls.includes('DELETE /api/keys/abc12345') && !api.log.calls.includes('DELETE /api/keys/keep0000'));
    assert.ok(api.log.calls.includes('POST /api/books/entries/' + E1 + '/reverse') && !api.log.calls.some((c) => c.includes(U1 + '/reverse')));
    assert.ok(out.some((l) => /GST close/.test(l)), 'the GST fallback is said');
  });
  console.log('\n  ' + pass + ' checks · 0 failed');
})().catch((e) => { console.error(e); process.exit(1); });
