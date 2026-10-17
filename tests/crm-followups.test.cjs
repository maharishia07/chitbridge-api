/**
 * CB CRM, Phase 4 — /api/crm/followups CRUD with party_followup STUBBED (b276 is a draft Athi runs): add · list (mine / everyone, open / done)
 * · done · snooze · reopen · reassign (owner or assignee only) · delete · "late" in the SHOP's day · and the 503 before the table exists.
 * Offline (tests/support/crm-stub.cjs). Run: node tests/crm-followups.test.cjs
 */
'use strict';
const assert = require('assert');
const { make, row } = require('./support/crm-stub.cjs');
const t = make(), D = t.data, F = require('../lib/crm-followups'), H = require('../lib/books-hooks');
const P = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
let pass = 0;
const ita = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n      ')); process.exitCode = 1; } };
D.cust = [Object.assign(row({ party_id: P(2), display_name: 'Chola' }), { customer_type: 'entity', added_via: 'manual', txn_count: 1, segment: 'new' })];
D.sup = [Object.assign(row({ party_id: P(1), display_name: 'Agro' }), {})];
/* INT6d-GREEN: the shop STATES its country — since T2-NATDEF an unstated country means the UTC day, and this test's days are India's (day() below).
 * Between 18:30 and 00:00 UTC (the 04:00 IST batch) the two days differ, so "late" went red by the clock, not by the code. */
D.country = 'IN';
const day = (n) => H.dayOf(new Date(Date.now() + n * 86400000).toISOString(), 'IN');   /* the shop's calendar day, n days from today */
const asCo = (id) => t.as('E1', { identity: { identity_id: id, parent_entity_id: 'E1' } });

(async () => {
  await ita('before b276: every follow-up route answers 503 CRM_NOT_MIGRATED (never a 500)', async () => {
    D.migrated = false; F.forget();
    for (const [m, p, b] of [['get', '/followups'], ['post', '/followups', { party_id: P(2), what: 'x', due_at: day(0) }], ['patch', '/followups/' + P(50), { done: true }], ['del', '/followups/' + P(50)]]) {
      const r = await t[m](p, b); assert.strictEqual(r.status, 503, m + ' ' + p + ' → ' + r.status); assert.strictEqual(r.body.code, 'CRM_NOT_MIGRATED');
    }
    D.migrated = true; F.forget();
  });
  let a, b, c;
  await ita('add: a date writes the start of the shop day; assignee defaults to me; source manual; the server says late / today', async () => {
    a = await t.post('/followups', { party_id: P(2), what: '  Call   back about the quote ', due_at: day(-1) });
    assert.strictEqual(a.status, 201, JSON.stringify(a.body)); const f = a.body.followup;
    assert.strictEqual(f.what, 'Call back about the quote'); assert.strictEqual(f.source, 'manual'); assert.strictEqual(f.assignee_user_id, 'E1'); assert.strictEqual(f.due_day, day(-1));
    assert.strictEqual(f.late, true); assert.strictEqual(f.today, false); assert.strictEqual(f.party_no.startsWith('P-'), true);
    b = (await t.post('/followups', { party_id: P(1), what: 'Collect payment', due_at: day(0), source: 'dues' })).body.followup; assert.strictEqual(b.today, true); assert.strictEqual(b.late, false);
    c = (await t.post('/followups', { party_id: P(1), what: 'Next month', due_at: day(30), assignee_user_id: 'A1' })).body.followup; assert.strictEqual(c.late, false); assert.strictEqual(c.today, false); assert.strictEqual(c.assignee_user_id, 'A1');
    a = a.body.followup;
  });
  await ita('list: everyone / mine, with the late and today counts from the server', async () => {
    const all = (await t.get('/followups?scope=all')).body; assert.strictEqual(all.followups.length, 3); assert.strictEqual(all.late, 1); assert.strictEqual(all.today, 1);
    assert.deepStrictEqual(all.followups.map((x) => x.what), ['Call back about the quote', 'Collect payment', 'Next month'], 'soonest first');
    const mine = (await t.get('/followups?scope=mine')).body; assert.strictEqual(mine.followups.length, 2);
    asCo('A1'); assert.strictEqual((await t.get('/followups?scope=mine')).body.followups.length, 1); t.as('E1');
  });
  await ita('refused in words with a code: no what, a bad date, a bad source, no party, a stranger as assignee, a party that is not mine', async () => {
    const n = D.followups.length;
    for (const [bd, st] of [[{ party_id: P(2), what: ' ', due_at: day(0) }, 400], [{ party_id: P(2), what: 'x', due_at: 'soon' }, 400], [{ party_id: P(2), what: 'x', due_at: day(0), source: 'bell' }, 400],
                            [{ what: 'x', due_at: day(0) }, 400], [{ party_id: P(2), what: 'x', due_at: day(0), assignee_user_id: 'STRANGER' }, 400], [{ party_id: P(9), what: 'x', due_at: day(0) }, 404]]) {
      const r = await t.post('/followups', bd); assert.strictEqual(r.status, st, JSON.stringify(bd) + ' → ' + JSON.stringify(r.body)); assert.ok(r.body.code);
    }
    assert.strictEqual(D.followups.length, n);
  });
  await ita('done: leaves the open list, stamps who and when, shows under done=1; reopen puts it back', async () => {
    asCo('A2'); const r = await t.patch('/followups/' + a.followup_id, { done: true }); t.as('E1');
    assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.ok(r.body.followup.done_at); assert.strictEqual(r.body.followup.late, false, 'a done one is never late');
    assert.strictEqual(D.followups.find((x) => x.followup_id === a.followup_id).done_by, 'A2');
    assert.strictEqual((await t.get('/followups')).body.followups.length, 2); assert.strictEqual((await t.get('/followups?done=1')).body.followups.length, 1);
    const tl = (await t.get('/parties/' + P(2) + '/timeline')).body.entries; assert.ok(tl.some((e) => e.kind === 'followup_done'), 'the timeline says "Follow-up done"');
    const re = await t.patch('/followups/' + a.followup_id, { done: false }); assert.strictEqual(re.body.followup.done_at, null); assert.strictEqual(re.body.followup.late, true);
  });
  await ita('snooze: a new date, and it goes back on the bell (bell_day cleared)', async () => {
    D.followups.find((x) => x.followup_id === b.followup_id).bell_day = day(0);
    const r = await t.patch('/followups/' + b.followup_id, { due_at: day(1) }); assert.strictEqual(r.status, 200); assert.strictEqual(r.body.followup.due_day, day(1)); assert.strictEqual(r.body.followup.today, false);
    assert.strictEqual(D.followups.find((x) => x.followup_id === b.followup_id).bell_day, null);
  });
  await ita('W2-CRM (CRM-DAY): snooze by a WORD — { after: tomorrow } lands on the SHOP\'s next day (start of day), { after: week } +7; a foreign word → 400 BAD_AFTER, nothing changed', async () => {
    let r = await t.patch('/followups/' + b.followup_id, { after: 'tomorrow' }); assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.followup.due_day, day(1)); assert.strictEqual(r.body.followup.due_at, H.dayBounds(day(1), 'IN').from, 'the start of the shop\'s day, never a phone\'s 09:00');
    r = await t.patch('/followups/' + b.followup_id, { after: 'week' }); assert.strictEqual(r.body.followup.due_day, day(7)); assert.strictEqual(r.body.followup.bucket, 'later');
    r = await t.patch('/followups/' + b.followup_id, { after: 'someday' }); assert.strictEqual(r.status, 400); assert.strictEqual(r.body.code, 'BAD_AFTER');
    assert.strictEqual((await t.get('/followups?scope=all')).body.followups.find((x) => x.followup_id === b.followup_id).due_day, day(7), 'the bad word changed nothing');
    assert.deepStrictEqual(F.AFTER, { today: 0, tomorrow: 1, '3days': 3, week: 7 }, 'the ONE table the call desk reads too');
    r = await t.patch('/followups/' + b.followup_id, { after: 'today' }); assert.strictEqual(r.body.followup.today, true);   /* back to today for the tests below */
  });
  await ita('W2-CRM (CRM-PAGE): the one pager — ?page=2&limit=1 → one row, total 3, page 2, limit 1; late · today count the WHOLE set; shop_day is the shop\'s day; no page asked = every row with its total', async () => {
    const pg = (await t.get('/followups?scope=all&page=2&limit=1')).body;
    assert.strictEqual(pg.followups.length, 1); assert.strictEqual(pg.total, 3); assert.strictEqual(pg.page, 2); assert.strictEqual(pg.limit, 1);
    assert.strictEqual(pg.late, 1); assert.strictEqual(pg.today, 1); assert.strictEqual(pg.shop_day, day(0));
    const all = (await t.get('/followups?scope=all')).body; assert.strictEqual(all.followups.length, 3); assert.strictEqual(all.total, 3); assert.strictEqual(all.limit, 3); assert.strictEqual(all.page, 1);
    const past = (await t.get('/followups?scope=all&page=5&limit=2')).body; assert.strictEqual(past.followups.length, 0); assert.strictEqual(past.total, 3, 'a page past the end still says the true total');
    assert.strictEqual((await t.get('/followups?scope=all&limit=1000000')).body.limit, 1000, 'the server\'s max, never the client\'s word');
    assert.ok(all.may && all.may.write && all.may.write.may === true, 'the owner may write (may rides the list)');
  });
  await ita('reassign: the owner may; the current assignee may; anyone else is refused 403 NOT_ASSIGNEE; a stranger is 400', async () => {
    let r = await t.patch('/followups/' + a.followup_id, { assignee_user_id: 'A1' }); assert.strictEqual(r.status, 200); assert.strictEqual(r.body.followup.assignee_user_id, 'A1');
    asCo('A2'); r = await t.patch('/followups/' + a.followup_id, { assignee_user_id: 'A2' }); assert.strictEqual(r.status, 403); assert.strictEqual(r.body.code, 'NOT_ASSIGNEE');
    asCo('A1'); r = await t.patch('/followups/' + a.followup_id, { assignee_user_id: 'A2' }); assert.strictEqual(r.status, 200); assert.strictEqual(r.body.followup.assignee_user_id, 'A2'); t.as('E1');
    r = await t.patch('/followups/' + a.followup_id, { assignee_user_id: 'STRANGER' }); assert.strictEqual(r.status, 400); assert.strictEqual(r.body.code, 'BAD_ASSIGNEE');
  });
  await ita('anyone may add, finish or snooze (a co-assist is not the owner) and edit the line', async () => {
    asCo('A2'); let r = await t.patch('/followups/' + c.followup_id, { what: 'Next month, ring Ravi', due_at: day(7) }); t.as('E1');
    assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.followup.what, 'Next month, ring Ravi');
  });
  await ita('nothing to change → 400; an unknown id → 404; junk → 400', async () => {
    assert.strictEqual((await t.patch('/followups/' + a.followup_id, {})).status, 400); assert.strictEqual((await t.patch('/followups/' + P(50), { done: true })).status, 404); assert.strictEqual((await t.patch('/followups/nope', { done: true })).status, 400);
  });
  await ita('delete → 200, then 404; another shop cannot see or touch mine', async () => {
    t.as('E2'); assert.strictEqual((await t.get('/followups')).body.followups.length, 0); assert.strictEqual((await t.del('/followups/' + c.followup_id)).status, 404); t.as('E1');
    assert.strictEqual((await t.del('/followups/' + c.followup_id)).status, 200); assert.strictEqual((await t.del('/followups/' + c.followup_id)).status, 404);
  });
  await ita('the shop\'s day, not the server\'s: 18:45 UTC is already tomorrow in India, so it is not late until India\'s midnight has passed', async () => {
    const s = require('../lib/crm-followups');
    const due = H.dayBounds('2026-10-03', 'IN').from;                       /* the start of 3 Oct, India */
    const eve = s.shape({ due_at: due, what: 'x', source: 'manual', followup_id: 'f' }, 'IN', s.dayOf('2026-10-02T18:45:00Z', 'IN'));   /* 00:15 on 3 Oct, India */
    assert.strictEqual(eve.today, true); assert.strictEqual(eve.late, false);
    const next = s.shape({ due_at: due, what: 'x', source: 'manual', followup_id: 'f' }, 'IN', s.dayOf('2026-10-03T18:45:00Z', 'IN'));   /* 4 Oct, India */
    assert.strictEqual(next.late, true);
  });
  await ita('an API key cannot touch follow-ups (403)', async () => { t.as('E1', { key: true }); assert.strictEqual((await t.get('/followups')).status, 403); t.as('E1'); });
  await ita('an EMPTY list reads clean: the page SQL puts its window counts before FROM (never a trailing ", count(*) OVER ()" after the joins — Postgres 42601), and no row means no party read', async () => {
    F.forget(); const seen = [];
    const fake = { query: async (sql) => { seen.push(String(sql)); return { rows: /to_regclass/.test(sql) ? [{ i: true, f: true }] : [] }; } };
    const out = await F.page(fake, 'E1', { scope: 'all', done: 0 });
    assert.deepStrictEqual(out.followups, []); assert.strictEqual(out.late, 0);
    const page = seen.find((q) => /party_followup f/.test(q) && /OVER ()/.test(q)); assert.ok(page, 'the page statement ran');
    assert.ok(page.indexOf('count(*) OVER') < page.indexOf('FROM party_followup'), 'window counts sit in the select list, before FROM');
    assert.strictEqual(seen.some((q) => q.includes("= ANY")), false, 'no party lookups for an empty page');
    assert.deepStrictEqual(await F.list(fake, 'E1', { party_id: P(2) }), []);
    F.forget();
  });
  t.close(); console.log('  ' + pass + ' checks');
})();
