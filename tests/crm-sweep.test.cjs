/**
 * CB CRM, Phase 4 — the nightly follow-up sweep → the bell. lib/crm-followups.sweep() with party_followup STUBBED: one `followup` event per
 * shop per assignee for what is due today or late; nothing for done or future ones; a second run the same day rings nothing; a snooze or a
 * reopen puts it back; a shop's failure never stops the others; before b276 it does nothing and says so. Offline. Run: node tests/crm-sweep.test.cjs
 */
'use strict';
const assert = require('assert');
const { make } = require('./support/crm-stub.cjs');
const t = make(), D = t.data, F = require('../lib/crm-followups'), H = require('../lib/books-hooks');
const P = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
let pass = 0;
const ita = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n      ')); process.exitCode = 1; } };
const day = (n) => H.dayOf(new Date(Date.now() + n * 86400000).toISOString(), 'IN');
const f = (owner, due, who, o) => Object.assign({ followup_id: t.uid(), owner, party_id: P(2), what: 'x', due_at: H.dayBounds(due, 'IN').from, assignee_user_id: who, done_at: null, bell_day: null, source: 'manual', created_at: new Date().toISOString() }, o);
const run = async () => { const ev = []; const out = await F.sweep({ emit: (ids, e) => ev.push([ids, e]) }); return { out, ev }; };

(async () => {
  await ita('before b276 the sweep does nothing and says so (never throws)', async () => {
    D.migrated = false; const { out, ev } = await run(); assert.strictEqual(out.notMigrated, true); assert.strictEqual(ev.length, 0); D.migrated = true;
  });
  D.followups = [f('E1', day(-1), 'A1'), f('E1', day(0), 'A1'), f('E1', day(0), 'E1'), f('E1', day(5), 'A1'), f('E1', day(-3), 'A1', { done_at: new Date().toISOString() }), f('E2', day(0), 'E2')];
  await ita('rings once per shop per assignee: today and late counted, done and future ones left alone', async () => {
    const { out, ev } = await run();
    assert.strictEqual(out.shops, 2); assert.strictEqual(out.rang, 3);
    const byWho = {}; ev.forEach(([ids, e]) => { assert.strictEqual(e.kind, 'followup'); byWho[ids[0] + '/' + e.for] = e; });
    assert.deepStrictEqual(Object.keys(byWho).sort(), ['E1/A1', 'E1/E1', 'E2/E2']);
    assert.strictEqual(byWho['E1/A1'].today, 1); assert.strictEqual(byWho['E1/A1'].late, 1); assert.strictEqual(byWho['E1/E1'].today, 1); assert.strictEqual(byWho['E1/E1'].late, 0);
  });
  await ita('nothing sensitive rides the event: kind · for · counts — no party, no text', async () => {
    D.followups.forEach((x) => { x.bell_day = null; }); const { ev } = await run();
    ev.forEach(([, e]) => assert.deepStrictEqual(Object.keys(e).sort(), ['for', 'kind', 'late', 'today']));
  });
  await ita('a second run the same day rings nothing (bell_day is marked)', async () => {
    const { out, ev } = await run(); assert.strictEqual(ev.length, 0); assert.strictEqual(out.rang, 0);
  });
  await ita('a new follow-up due today rings on the next run, the old ones do not repeat', async () => {
    D.followups.push(f('E1', day(0), 'A1')); const { ev } = await run(); assert.strictEqual(ev.length, 1); assert.strictEqual(ev[0][1].today, 1); assert.strictEqual(ev[0][1].late, 0);
  });
  await ita('a snooze puts it back on the bell (bell_day cleared) — through the route, then the sweep', async () => {
    const x = D.followups.find((r) => r.owner === 'E1' && r.assignee_user_id === 'E1');
    const r = await t.patch('/followups/' + x.followup_id, { due_at: day(0) }); assert.strictEqual(r.status, 200); assert.strictEqual(x.bell_day, null);
    const { ev } = await run(); assert.strictEqual(ev.length, 1); assert.strictEqual(ev[0][1].for, 'E1');
  });
  await ita('one shop failing does not stop the next', async () => {
    D.followups.forEach((x) => { x.bell_day = null; });
    const ev = [], real = D.extra; let n = 0;
    D.extra = null;
    const out = await F.sweep({ emit: (ids, e) => ev.push(ids[0]), withEntity: async (o, fn) => { if (o === 'E1' && !n++) throw new Error('boom'); return require('../db').withEntity(o, fn); } });
    assert.strictEqual(out.skipped >= 1, true); assert.ok(ev.indexOf('E2') >= 0, 'E2 still rang'); D.extra = real;
  });
  await ita('the shop\'s day: due at the start of today (India) is "today", not late, even when UTC is still yesterday', async () => {
    D.followups = [f('E1', '2026-10-03', 'E1')];
    const ev = []; await F.sweep({ now: '2026-10-02T18:45:00Z', emit: (ids, e) => ev.push(e) });          /* 00:15 on 3 Oct in India */
    assert.strictEqual(ev.length, 1); assert.strictEqual(ev[0].today, 1); assert.strictEqual(ev[0].late, 0);
  });
  t.close(); console.log('  ' + pass + ' checks');
})();
