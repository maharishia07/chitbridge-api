#!/usr/bin/env node
'use strict';
/**
 * prove-usecases.js — GOODS · PURE SERVICE · BOTH, run end to end against the live API.
 *
 * Athi, 2026-08-23: *"we are currently working with use cases mostly of type goods. Now create a use case for
 * service, and then goods and services… a car servicing company receives a complaint regarding engine, door, AC
 * and tyre… for each complaint a co-assist will work, materials will be assembled, hours will be locked…
 * finally we should be able to showcase: this many people worked, this many parts serviced, this many materials
 * changed, these many hours spent, and the total cost."*
 *
 * ⭐⭐ ONE MECHANISM, TWO DIRECTIONS, AND THAT IS THE WHOLE ANSWER. `b152` gave a line event two kinds:
 * `deliver` DRAWS DOWN against an ordered quantity, `add` ACCRUES against the line and may carry money with no
 * quantity at all. Goods converge on zero; service has no target to converge on. Everything below is those two
 * verbs — no third model, no service-specific table.
 *
 * ⚠️ THE PEOPLE ARE REAL. "Three people worked" is recorded by three co-assists who each logged in and posted
 * their own hours, not by three strings in a note. A count of names in free text would have proved nothing,
 * and it is exactly the kind of number a showcase is tempted to fake.
 *
 * ⚠️ WRITES TO THE LIVE DATABASE. It registers an entity, creates co-assists and sends chits — a test.proof, not
 * a unit test. Run: node scripts/prove-usecases.js
 */
const P = require('./_proof');

const T = [];
const ok = (cond, msg, detail) => { T.push({ ok: !!cond, msg, detail }); console.log('  ' + (cond ? 'ok  ' : 'FAIL') + ' ' + msg + (detail ? '   ' + detail : '')); };
const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

(async () => {
  const ts = String(Date.now()).slice(-6);
  const SHOP = 'Chola Auto Care';
  const EMAIL = 'cholaauto@email.com';

  console.log('\n══ GOODS · PURE SERVICE · BOTH ═══════════════════════════════════════════\n');

  /* ── setup ─────────────────────────────────────────────────────────────────────────────────────────────── */
  const reg = await P.j('/api/entities/register', { method: 'POST', body: { email: EMAIL, display_name: SHOP } });
  const otp = (reg.b && reg.b.dev_otp) || '123456';
  const v = await P.j('/api/entities/verify', { method: 'POST', body: { email: EMAIL, otp } });
  if (!(v.b && v.b.token)) { console.log('sign-in failed: ' + JSON.stringify(reg.b).slice(0, 200)); process.exit(1); }
  const auth = { token: v.b.token };
  const me = await P.j('/api/entities/me', auth);
  const myId = (me.b && (me.b.identity_id || (me.b.entity || {}).identity_id)) || null;
  /* ⚠ The handle is the entity's user_id, NOT its display name — '@' is the employee separator and the
     part after it is the login people actually type. Spelling it from the display name failed with
     'Entity not found', which is the right refusal to a wrong handle. */
  const myHandle = (me.b && (me.b.user_id || (me.b.entity || {}).user_id)) || SHOP.toLowerCase().replace(/\s+/g, '');
  ok(!!myId, 'the workshop entity exists and is signed in', SHOP);

  const send = async (lines, subject) => {
    const s = await P.j('/api/chits/send', { method: 'POST', ...auth, body: {
      purpose: 'order', manual_subject: subject, line_items: lines,
      recipients: myId ? [{ entity_id: myId, role: 'to' }] : [], send_to_self: true } });
    const det = await P.j('/api/chits/' + s.b.chit_id, auth);
    return { id: s.b.chit_id, lines: det.b.live_set || [] };
  };
  const event = (id, rows, who) => P.j('/api/chits/' + id + '/deliver-lines', { method: 'POST', token: (who || auth).token, body: { rows } });
  const lineOf = async (id, line_id) => {
    const d = await P.j('/api/chits/' + id, auth);
    return (d.b.line_delivery || {})[line_id] || null;
  };

  /* Three co-assists, each with their own login, so the attribution below is real. */
  const mkActor = async (key, name) => {
    const c = await P.j('/api/actors', { method: 'POST', ...auth, body: { display_name: name, actor_key: key, hat: 'act' } });
    const o = c.b && (c.b.otp || c.b.dev_otp || (c.b.actor && c.b.actor.otp));
    if (!o) return { name, err: 'no otp' };
    const l = await P.j('/api/actors/login', { method: 'POST', body: { username: key + '@' + myHandle, otp: o } });
    return { name, token: l.b && l.b.token, err: l.b && l.b.message };
  };
  const ramesh = await mkActor('ramesh' + ts, 'Ramesh');
  const kavya  = await mkActor('kavya' + ts,  'Kavya');
  const suresh = await mkActor('suresh' + ts, 'Suresh');
  const crew = [ramesh, kavya, suresh].filter((a) => a.token);
  ok(crew.length === 3, 'three co-assists created and signed in', crew.map((a) => a.name).join(' · ') || (ramesh.err || ''));

  /* ══ 1 · GOODS — a quantity promised, drawn down ═══════════════════════════════════════════════════════ */
  console.log('\n1 · GOODS — the line is a QUANTITY, and events draw it down');
  const G = await send([{ particulars: 'Engine oil 5W-30', quantity: 10, unit: 'litre', price: 520 }], 'Parts order ' + ts);
  const gl = G.lines[0].line_id;
  await event(G.id, [{ line_id: gl, kind: 'deliver', quantity: 3, unit: 'litre' }]);
  await event(G.id, [{ line_id: gl, kind: 'deliver', quantity: 4, unit: 'litre' }]);
  const g = await lineOf(G.id, gl);
  ok(g && Number(g.delivered) === 7, 'ordered 10, delivered 3 + 4 = 7', g && ('delivered ' + g.delivered));
  ok(g && Number(g.pending) === 3, '⭐ 3 still owed — a goods line CONVERGES on zero', g && ('pending ' + g.pending));

  /* ══ 2 · PURE SERVICE — an outcome promised, accrued ═══════════════════════════════════════════════════ */
  console.log('\n2 · PURE SERVICE — an INSPECTION. Nothing delivered, nothing consumed.');
  const S = await send([{ particulars: 'Pre-purchase inspection (est. 2 hours)', quantity: 1, unit: 'job', price: 1600 }], 'Inspection ' + ts);
  const sl = S.lines[0].line_id;
  await event(S.id, [{ line_id: sl, kind: 'add', particulars: 'Inspection — bodywork and underbody', quantity: 2, unit: 'hour', amount: 1600 }], crew[0]);
  await event(S.id, [{ line_id: sl, kind: 'add', particulars: 'Inspection — extra time on the chassis', quantity: 1.5, unit: 'hour', amount: 1200 }], crew[0]);
  const s2 = await lineOf(S.id, sl);
  const sHours = ((s2 && s2.added) || []).filter((a) => a.unit === 'hour').reduce((t, a) => t + Number(a.quantity || 0), 0);
  ok(sHours === 3.5, 'estimated 2 hours, accrued 3.5', sHours + ' hours');
  ok(s2 && Number(s2.delivered) === 0,
    '⭐⭐ NOTHING WAS DELIVERED — an inspection produces a finding, not a thing', s2 && ('delivered ' + s2.delivered));
  ok(s2 && Number(s2.charged) === 2800, '⭐ the OVERRUN is visible and chargeable — 1600 + 1200', s2 && money(s2.charged));

  /* ══ 3 · BOTH — the car job Athi described ════════════════════════════════════════════════════════════ */
  console.log('\n3 · GOODS + SERVICE — one car, one visit, FOUR complaints');
  console.log('    "Engine noise, driver door won\'t close, AC not cooling, front tyres wearing unevenly."');
  const J = await send([
    { particulars: 'Complaint 1 — engine noise',     quantity: 1, unit: 'job', price: 0 },
    { particulars: 'Complaint 2 — driver door',      quantity: 1, unit: 'job', price: 0 },
    { particulars: 'Complaint 3 — AC not cooling',   quantity: 1, unit: 'job', price: 0 },
    { particulars: 'Complaint 4 — front tyre wear',  quantity: 1, unit: 'job', price: 0 },
  ], 'Job card ' + ts + ' — TN 09 BX 4471');
  ok(J.lines.length === 4, '⭐ ONE chit, FOUR lines — one car, one visit, one invoice', J.lines.length + ' lines');
  const [c1, c2, c3, c4] = J.lines.map((l) => l.line_id);

  /* Each complaint: its own person, its own hours, its own parts. */
  await event(J.id, [
    { line_id: c1, kind: 'add', particulars: 'Diagnose + tappet adjustment', quantity: 2.5, unit: 'hour', amount: 1875 },
    { line_id: c1, kind: 'add', particulars: 'Engine oil 5W-30',             quantity: 4,   unit: 'litre', amount: 2080 },
    { line_id: c1, kind: 'add', particulars: 'Oil filter',                   quantity: 1,   unit: 'piece', amount: 420 },
  ], crew[0]);

  /* ⚠️ THE CASE A GOODS SYSTEM CANNOT EXPRESS: diagnosed, found fine, nothing fitted, time still owed. */
  await event(J.id, [
    { line_id: c2, kind: 'add', particulars: 'Checked door alignment — within tolerance, no repair needed', quantity: 0.5, unit: 'hour', amount: 375 },
  ], crew[1]);

  await event(J.id, [
    { line_id: c3, kind: 'add', particulars: 'AC diagnosis + regas',   quantity: 3, unit: 'hour',  amount: 2250 },
    { line_id: c3, kind: 'add', particulars: 'AC compressor',          quantity: 1, unit: 'piece', amount: 8400 },
    { line_id: c3, kind: 'add', particulars: 'Refrigerant R134a',      quantity: 1, unit: 'kg',    amount: 1150 },
  ], crew[1]);

  await event(J.id, [
    { line_id: c4, kind: 'add', particulars: 'Wheel alignment + balancing', quantity: 1.5, unit: 'hour',  amount: 1125 },
    { line_id: c4, kind: 'add', particulars: 'Front tyre 195/65 R15',       quantity: 2,   unit: 'piece', amount: 11600 },
  ], crew[2]);

  const lines = [];
  for (const id of [c1, c2, c3, c4]) lines.push(await lineOf(J.id, id));

  const all = lines.flatMap((l) => (l && l.added) || []);
  const hours = all.filter((a) => a.unit === 'hour');
  const parts = all.filter((a) => a.unit !== 'hour');
  const totalHours = hours.reduce((t, a) => t + Number(a.quantity || 0), 0);
  const labour = hours.reduce((t, a) => t + Number(a.amount || 0), 0);
  const materials = parts.reduce((t, a) => t + Number(a.amount || 0), 0);
  /**
   * ⚠️ `by_actor`, NOT `by`. An event records BOTH — `by` is the entity that holds the copy ("Chola Auto
   * Care"), `by_actor` is the person who did the work ("Ramesh"). Reading `by` gave "1 person worked" on a job
   * three people had touched, and it was convincing: the number was small, plausible, and wrong. The division
   * of labour is per-copy AND per-actor, and a showcase that reads the entity is counting companies.
   */
  const people = new Set(all.map((a) => a.by_actor || '').filter(Boolean));
  const repaired = lines.filter((l) => ((l && l.added) || []).some((a) => a.unit !== 'hour')).length;

  ok(all.length === 9, 'nine events recorded across the four complaints', all.length + ' events');
  ok(lines.every((l) => Number(l.delivered) === 0),
    '⭐ not one line is "delivered" — fitting a compressor is not 2 of a complaint');
  ok(Number(lines[1].charged) === 375 && ((lines[1].added || []).every((a) => a.unit === 'hour')),
    '⭐⭐ COMPLAINT 2: diagnosed, found fine, NOTHING fitted — and the time is still owed', money(375));

  /* ── the showcase Athi asked for ─────────────────────────────────────────────────────────────────────── */
  console.log('\n── THE JOB CARD ────────────────────────────────────────────────');
  console.log('   complaints          4   (' + repaired + ' repaired, ' + (4 - repaired) + ' diagnosed only)');
  console.log('   people worked       ' + people.size + '   ' + [...people].join(' · '));
  console.log('   hours spent         ' + totalHours);
  console.log('   parts / materials   ' + parts.length + ' items');
  console.log('   materials           ' + money(materials));
  console.log('   labour              ' + money(labour));
  console.log('   TOTAL               ' + money(materials + labour));
  console.log('────────────────────────────────────────────────────────────────');

  ok(people.size === 3, '⭐⭐ THREE PEOPLE, counted from the events they each signed', [...people].join(' · '));
  ok(totalHours === 7.5, 'hours sum across people and complaints', totalHours + ' h');
  ok(materials + labour === 29275, 'the total is SUMMED from events, never stored', money(materials + labour));
  /**
   * ⚠️ THE MIXED-UNIT RULE, WHICH IS WHY THIS IS SAFE: 4 litre + 1 piece + 1 kg + 2.5 hour is not 8.5 of
   * anything. Each event keeps its own unit and only the MONEY is added — the same rule that stops a rename
   * becoming a conversion in the goods world.
   */
  ok(new Set(all.map((a) => a.unit)).size >= 4, 'four different units coexist on one job — none summed together',
    [...new Set(all.map((a) => a.unit))].join(' · '));

  const fails = T.filter((t) => !t.ok);
  console.log('\n══ ' + (T.length - fails.length) + ' passed · ' + fails.length + ' failed ══\n');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e && e.message); process.exit(1); });
