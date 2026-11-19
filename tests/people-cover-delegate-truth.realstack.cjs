'use strict';
/**
 * tests/people-cover-delegate-truth.realstack.cjs — PEOPLE cover / delegate / break on a REAL Postgres, the api running as cb_app (RLS on).
 *
 * OWNS     the behaviour the card named missing ("PUT /:id/delegate success path (set cover, self refused, both-away) has no behaviour test"):
 *          the owner sets a person's leave-cover and clears it (identities.delegate_actor_id), a person cannot cover themselves (400),
 *          another shop's person or an unknown id is not a cover (400), an unknown subject is 404, and two people in a cover pair cannot be away at once
 *          (PUT /break 400, both directions) while ending the leave works and the cover pair can go off one after the other.
 * FLOW     fresh shop S with two people A and B (POST /api/actors) and a second shop X with one person; every door is a route, the
 *          database is read with SELECT only (the delegate column and break_status are the proof).
 * CARD     17-people-employees-hr-and-payroll/cover-delegate-break
 *
 *   D-1  set cover: PUT /:A/delegate {B} gives 200 "Delegate set", identities.delegate_actor_id of A = B
 *   D-2  self: PUT /:A/delegate {A} gives 400, nothing written
 *   D-3  another shop's person as cover gives 400 (not assignable); an unknown subject gives 404; X's person is not changed by S's owner
 *   D-4  A is covered by B and B is on leave: A cannot go on leave (400, break_status stays active)
 *   D-5  the other direction: A on leave covered by B, so B cannot go on leave (400, B is covering someone who is away)
 *   D-6  end leave: A back (200), then B may go off (200) and come back; the pair is never both away
 *   D-7  clear cover: PUT /:A/delegate {delegate_actor_id: null} gives 200 "Delegate cleared", column null
 * CI: picked up by the T2 loop over tests/*-truth.realstack.cjs.
 */
const H = require('./lib/truth-harness.cjs');
const { Client } = require('pg');
const { j, ok, kase, expect, freshShop, finish, DB } = H;
const RUN = 'cd' + (Date.now() % 1e9).toString(36).padStart(6, '0');
const asOwner = async (sql, args) => { const c = new Client({ connectionString: DB }); await c.connect(); try { return (await c.query(sql, args)).rows; } finally { await c.end(); } };
const row = async (id) => (await asOwner('SELECT delegate_actor_id AS d, break_status AS b FROM identities WHERE identity_id = $1', [id]))[0];
let S, X, A, B, XP;
async function person(shop, label) {
  const key = (label + RUN).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
  const r = ok(await j('/api/actors', { method: 'POST', token: shop.token, body: { display_name: 'Person ' + label + ' ' + RUN, actor_key: key, email: key + '@' + H.TARGET.emailDomain, hat: 'act', max_tasks: 5 } }), 'create ' + label);
  return r.b.actor.identity_id;
}
const delegate = (id, to) => j('/api/actors/' + id + '/delegate', { method: 'PUT', token: S.token, body: { delegate_actor_id: to } });
const brk = (id, type) => j('/api/actors/break', { method: 'PUT', token: S.token, body: { break_type: type, actor_id: id } });

(async () => {
  console.log('\n── PEOPLE cover / delegate on ' + H.API + ' · run ' + RUN + ' ──');
  const au = { country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: 'Australia/Sydney', tax: { registered: false } };
  S = await freshShop(RUN + 's', 'Shop', au);
  X = await freshShop(RUN + 'x', 'Other', au);
  A = await person(S, 'aa'); B = await person(S, 'bb'); XP = await person(X, 'xx');

  await kase('D-1', "the owner sets A's cover to B: 200 and the column holds B", async () => {
    const r = await delegate(A, B);
    expect(r.status === 200 && /set/i.test(r.b.message || ''), 'HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
    expect(r.b.actor && r.b.actor.delegate_actor_id === B, 'the reply does not name B: ' + JSON.stringify(r.b.actor));
    expect((await row(A)).d === B, 'identities.delegate_actor_id of A is not B');
  });
  await kase('D-2', 'a person cannot cover themselves: 400, the column is unchanged', async () => {
    const r = await delegate(B, B);
    expect(r.status === 400, 'HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
    expect((await row(B)).d === null, "B's cover was written");
  });
  await kase('D-3', "another shop's person is not a cover (400); an unknown subject is 404; the other shop is untouched", async () => {
    const r = await delegate(B, XP);
    expect(r.status === 400, 'foreign cover: HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
    const gone = await delegate('99999999-9999-4999-8999-999999999999', B);
    expect(gone.status === 404, 'unknown subject: HTTP ' + gone.status);
    const foreign = await delegate(XP, A);   /* S's owner naming X's person as the subject */
    expect(foreign.status === 404 || foreign.status === 400, "another shop's subject answered " + foreign.status);
    expect((await row(XP)).d === null, "X's person was changed by S's owner");
  });
  await kase('D-4', 'A is covered by B; B is on leave, so A cannot go on leave (both away refused)', async () => {
    const b1 = await brk(B, 'leave');
    expect(b1.status === 200, 'B on leave: HTTP ' + b1.status + ' ' + JSON.stringify(b1.b).slice(0, 200));
    const r = await brk(A, 'leave');
    expect(r.status === 400, 'A on leave while B is away: HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
    expect((await row(A)).b === 'active', 'A went off anyway: ' + (await row(A)).b);
    ok(await brk(B, 'end_break'), 'B back');
  });
  await kase('D-5', 'A on leave (covered by B), so B cannot go on leave: B is covering someone who is away', async () => {
    const a1 = await brk(A, 'leave');
    expect(a1.status === 200, 'A on leave: HTTP ' + a1.status + ' ' + JSON.stringify(a1.b).slice(0, 200));
    const r = await brk(B, 'leave');
    expect(r.status === 400, 'B on leave while covering A: HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
    expect((await row(B)).b === 'active', 'B went off anyway');
  });
  await kase('D-6', 'A is back; then B may go off and come back: the pair is never both away', async () => {
    ok(await brk(A, 'end_break'), 'A back');
    expect((await row(A)).b === 'active', 'A is not active after end_break');
    const b1 = await brk(B, 'leave');
    expect(b1.status === 200, 'B on leave after A is back: HTTP ' + b1.status);
    ok(await brk(B, 'end_break'), 'B back');
    expect((await row(B)).b === 'active', 'B is not active after end_break');
  });
  await kase('D-7', 'the owner clears the cover: 200 "Delegate cleared", the column is null', async () => {
    const r = await delegate(A, null);
    expect(r.status === 200 && /cleared/i.test(r.b.message || ''), 'HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
    expect((await row(A)).d === null, 'the column still holds a cover');
  });
  finish('people-cover-delegate', process.env.TRUTH_JSON);
})().catch((e) => { console.error(e); process.exit(1); });
