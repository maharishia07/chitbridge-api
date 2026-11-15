/**
 * CARD  11-crm-and-marketing/follow-ups
 * L16 small CRM lines through the real router over the stand-in (tests/support/crm-stub.cjs). Offline. Run: node tests/crm-l16-validation.test.cjs
 *   CRM-232  a group name over 40 letters is 400 BAD_NAME, never cut to 40 and saved (also the first half of CRM-245)
 *   CRM-238  a text field that is an object, list or true is 400 BAD_TEXT (interaction body, follow-up what on add and patch), never "[object Object]"
 *   CRM-250  a call or note dated before 1900 is 400 BAD_AT
 *   CRM-240  the one-name fold is Unicode-safe: composed and decomposed "Zoë Müller" fold to one key
 *   CRM-228 / CRM-242  (already fixed by CRM-227): 2026-02-30 and the bare numbers "1" and "12" are 400 on a follow-up
 */
'use strict';
const assert = require('assert');
const { make, row } = require('./support/crm-stub.cjs');
const t = make(), D = t.data;
const P = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
let pass = 0;
const ita = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n      ')); process.exitCode = 1; } };
D.cust = [Object.assign(row({ party_id: P(2), display_name: 'Chola' }), { customer_type: 'entity', added_via: 'manual', txn_count: 1, segment: 'new', groups: [] })];
D.country = 'IN'; t.as('E1');
const note = (extra) => Object.assign({ kind: 'note', body: 'x' }, extra);
const noteUrl = '/parties/' + P(2) + '/interactions';
(async () => {
  await ita('CRM-232: a 41-letter group name is 400 BAD_NAME and nothing is saved; 40 letters is fine', async () => {
    const r = await t.post('/groups', { name: 'G'.repeat(41), add: [P(2)] });
    assert.strictEqual(r.status, 400, JSON.stringify(r.body)); assert.strictEqual(r.body.code, 'BAD_NAME');
    assert.deepStrictEqual(D.cust[0].groups || [], []);
    assert.strictEqual(require('../lib/customer-groups').cleanName('G'.repeat(40)), 'G'.repeat(40));
  });
  await ita('CRM-238: interaction body as object / list / true is 400, text is 201', async () => {
    const n = D.interactions.length;
    for (const bad of [{ a: 1 }, ['x', 'y'], true]) {
      const r = await t.post(noteUrl, note({ body: bad }));
      assert.strictEqual(r.status, 400, JSON.stringify(bad) + ' → ' + JSON.stringify(r.body));
    }
    assert.strictEqual(D.interactions.length, n);
    assert.strictEqual((await t.post(noteUrl, note())).status, 201);
  });
  await ita('CRM-238: follow-up what as an object is 400 on add and on patch', async () => {
    const r = await t.post('/followups', { party_id: P(2), what: { a: 1 }, due_at: '2030-01-05' });
    assert.strictEqual(r.status, 400, JSON.stringify(r.body));
    const good = await t.post('/followups', { party_id: P(2), what: 'ring', due_at: '2030-01-05' });
    assert.strictEqual(good.status, 201, JSON.stringify(good.body));
    const p = await t.patch('/followups/' + good.body.followup.followup_id, { what: { a: 1 } });
    assert.strictEqual(p.status, 400, JSON.stringify(p.body));
  });
  await ita('CRM-250: an interaction dated 1800-01-01 is 400; 1900-01-01 is accepted', async () => {
    const r = await t.post(noteUrl, note({ at: '1800-01-01' }));
    assert.strictEqual(r.status, 400, JSON.stringify(r.body));
    assert.strictEqual((await t.post(noteUrl, note({ at: '1900-01-01' }))).status, 201);
  });
  await ita('CRM-228 / CRM-242: 2026-02-30, "1" and "12" are refused as follow-up days', async () => {
    for (const due of ['2026-02-30', '1', '12']) {
      const r = await t.post('/followups', { party_id: P(2), what: 'ring', due_at: due });
      assert.strictEqual(r.status, 400, due + ' → ' + JSON.stringify(r.body));
    }
  });
  await ita('CRM-240: composed and decomposed "Zoë Müller" fold to the one key', () => {
    const { fold } = require('../lib/local-identity');
    const composed = 'Zoë Müller', decomposed = 'Zoë Müller';
    assert.notStrictEqual(composed, decomposed);
    assert.strictEqual(fold(composed), fold(decomposed));
    assert.strictEqual(fold('ZOË MÜLLER'), fold(decomposed));
  });
  t.close(); console.log(pass + ' passed' + (process.exitCode ? ' — with failures' : ''));
})();
