#!/usr/bin/env node
'use strict';
/**
 * prove-usecases.js — GOODS · PURE SERVICE · BOTH, the whole cycle, against the live API.
 *
 * Athi, 2026-08-23: *"we have to have some product in the catalogue, each of the complaint raised some product
 * to be used and labour to be added and the final cost to be arrived for the entire complaint… as we are
 * segregating engine complaint from door complaint, need to see partial status update, external messaging,
 * internal messaging — so the holistic picture of a service is known, with the total cost as of now and the
 * partial / full completion status."*
 *
 * ⭐⭐ ONE MECHANISM, TWO DIRECTIONS. `deliver` DRAWS DOWN against an ordered quantity; `add` ACCRUES and may
 * carry money with no quantity. Goods converge on zero; service has no target to converge on.
 *
 * ⭐⭐ AND THE TWO KINDS MEET ON THE SAME LINE, which is what makes "partial completion" work without a new
 * concept. `complete` is `delivered >= ordered` (lib/deliverline.js) — so a line that only ACCRUES can never
 * complete, and three of these four complaints are service. The resolution is that **a complaint IS one job**:
 * hours and parts accrue against it with `add`, and delivering that 1 job says the complaint is closed. The
 * outcome is the deliverable. Two closed of four is a partial job card, computed, not stored.
 *
 * ⚠️ THE CREW IS STABLE — three mechanics, reused. The first version suffixed each key with a timestamp, so
 * every run minted three more people and Athi found twelve. A workshop has three mechanics; a test that
 * invents new staff on every run is describing a different business each time.
 *
 * ⚠️ WRITES TO THE LIVE DATABASE. Run: node scripts/prove-usecases.js
 */
const P = require('./_proof');

const T = [];
const ok = (cond, msg, detail) => { T.push({ ok: !!cond, msg, detail }); console.log('  ' + (cond ? 'ok  ' : 'FAIL') + ' ' + msg + (detail ? '   ' + detail : '')); };
const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
const SHOP = 'Chola Auto Care';
const EMAIL = 'cholaauto@email.com';

(async () => {
  console.log('\n══ A SERVICE BUSINESS, END TO END ════════════════════════════════════════\n');

  /* ── the workshop ──────────────────────────────────────────────────────────────────────────────────────── */
  const reg = await P.j('/api/entities/register', { method: 'POST', body: { email: EMAIL, display_name: SHOP } });
  const v = await P.j('/api/entities/verify', { method: 'POST', body: { email: EMAIL, otp: (reg.b && reg.b.dev_otp) || '123456' } });
  if (!(v.b && v.b.token)) { console.log('sign-in failed: ' + JSON.stringify(reg.b).slice(0, 200)); process.exit(1); }
  const auth = { token: v.b.token };
  const me = await P.j('/api/entities/me', auth);
  const E = (me.b && me.b.entity) || {};
  ok(!!E.user_id, 'workshop signed in', SHOP + '  ·  ' + E.user_id);

  const send = async (lines, subject) => {
    const s = await P.j('/api/chits/send', { method: 'POST', ...auth, body: {
      purpose: 'order', manual_subject: subject, line_items: lines,
      recipients: [{ entity_id: E.identity_id, role: 'to' }], send_to_self: true } });
    const det = await P.j('/api/chits/' + s.b.chit_id, auth);
    return { id: s.b.chit_id, lines: det.b.live_set || [] };
  };
  /**
   * ⚠️ `(who && who.token) ? who : auth` — NOT `(who || auth)`. A crew member whose login failed is still a
   * truthy object with an undefined token, so the old form sent the request with **no Authorization header at
   * all**. Every event silently did nothing and the job card printed four NOT STARTED rows, which read as a
   * product that had lost the data rather than a harness that had lost its token.
   */
  const event = (id, rows, who) => P.j('/api/chits/' + id + '/deliver-lines',
    { method: 'POST', token: (who && who.token) ? who.token : auth.token, body: { rows } });
  const say = (id, text, type, line_id, who) => P.j('/api/chits/' + id + '/messages', { method: 'POST',
    token: (who && who.token) ? who.token : auth.token, body: { message_text: text, thread_type: type, line_id: line_id || undefined } });
  const linesOf = async (id) => (await P.j('/api/chits/' + id, auth)).b.line_delivery || {};

  /* ── the crew: three mechanics, reused every run ───────────────────────────────────────────────────────── */
  /**
   * ⚠️⚠️ REUSING A PERSON IS A DIFFERENT ACT FROM HIRING ONE, and the first version conflated them. It created
   * an actor, and on a re-run the create failed as a duplicate, so it fell back to a guessed code and got
   * *"Incorrect code — 2 attempts left"* — burning login attempts on three real people, three at a time. The
   * previous OTP had already been consumed; a code is not a password.
   *
   * ⭐ So: create if absent, otherwise RESET the code the way an operator would when someone cannot get in
   * (`POST /actors/:id/otp` — the "resend" an employer performs), then sign in. Reuse is the normal path here,
   * not the exception, because a workshop has three mechanics and keeps them.
   */
  const crewFor = async (key, name) => {
    const made = await P.j('/api/actors', { method: 'POST', ...auth, body: { display_name: name, actor_key: key, hat: 'act' } });
    let otp = made.b && (made.b.otp || made.b.dev_otp || (made.b.actor && made.b.actor.otp));
    if (!otp) {
      const list = await P.j('/api/actors', auth);
      const found = ((list.b && list.b.actors) || []).find((x) => x.actor_key === key);
      if (!found) return { name, key, err: 'actor not found and could not be created' };
      const reset = await P.j('/api/actors/' + found.identity_id + '/otp', { method: 'POST', ...auth });
      otp = reset.b && (reset.b.otp || reset.b.dev_otp);
      if (!otp) return { name, key, err: 'no code issued — is DEV_OTP unset here?' };
    }
    const l = await P.j('/api/actors/login', { method: 'POST', body: { username: key + '@' + E.user_id, otp } });
    return { name, key, token: l.b && l.b.token, err: l.b && l.b.message };
  };
  const ramesh = await crewFor('ramesh', 'Ramesh');
  const kavya  = await crewFor('kavya',  'Kavya');
  const suresh = await crewFor('suresh', 'Suresh');
  const crew = [ramesh, kavya, suresh];
  ok(crew.every((c) => c.token), 'the same three mechanics, reused — no new staff on a re-run',
    crew.map((c) => c.name).join(' · ') + (crew.find((c) => !c.token) ? '  ' + crew.find((c) => !c.token).err : ''));

  /* ── the catalogue: what this workshop sells ───────────────────────────────────────────────────────────── */
  console.log('\n0 · THE CATALOGUE — parts and labour, both of them priced');
  const put = async (d) => (await P.j('/api/products', { method: 'POST', ...auth, body: { item_data: d } })).b;
  const CAT = {
    oil:        await put({ name: 'Engine oil 5W-30', unit: 'litre', price: 520,  code: '27101981' }),
    filter:     await put({ name: 'Oil filter',       unit: 'piece', price: 420,  code: '84212300' }),
    compressor: await put({ name: 'AC compressor',    unit: 'piece', price: 8400, code: '84143020' }),
    gas:        await put({ name: 'Refrigerant R134a', unit: 'kg',   price: 1150, code: '29033970' }),
    tyre:       await put({ name: 'Tyre 195/65 R15',  unit: 'piece', price: 5800, code: '40111000' }),
    /* ⭐ LABOUR IS A CATALOGUE LINE TOO — the service vertical's shape: a RATE, sold by the hour, with a SAC
       code rather than an HSN because India's GST classifies services separately. */
    labour:     await put({ name: 'Workshop labour',  unit: 'hour',  price: 750,  code: '998714' }),
    diagnosis:  await put({ name: 'Diagnostic charge', unit: 'hour', price: 750,  code: '998714' }),
  };
  const priced = Object.entries(CAT).filter(([, x]) => x && (x.item_id || x.item));
  ok(priced.length === 7, 'seven catalogue items — five parts, two labour rates', priced.length + ' created');
  const idOf = (x) => (x && (x.item_id || (x.item && x.item.item_id))) || null;
  ok(!!idOf(CAT.labour), '⭐ labour sits in the SAME catalogue as the parts — sold by the hour, SAC 998714');

  /* ══ 1 · GOODS ════════════════════════════════════════════════════════════════════════════════════════ */
  console.log('\n1 · GOODS — a quantity promised, drawn down');
  const G = await send([{ particulars: 'Engine oil 5W-30', quantity: 10, unit: 'litre', price: 520, item_id: idOf(CAT.oil) }], 'Parts order');
  const gl = G.lines[0].line_id;
  await event(G.id, [{ line_id: gl, kind: 'deliver', quantity: 3, unit: 'litre' }]);
  await event(G.id, [{ line_id: gl, kind: 'deliver', quantity: 4, unit: 'litre' }]);
  const g = (await linesOf(G.id))[gl];
  ok(Number(g.delivered) === 7 && Number(g.pending) === 3, 'ordered 10 · delivered 7 · 3 still owed', 'complete=' + g.complete);

  /* ══ 2 · PURE SERVICE ═════════════════════════════════════════════════════════════════════════════════ */
  console.log('\n2 · PURE SERVICE — an inspection. Nothing consumed, nothing delivered.');
  const S = await send([{ particulars: 'Pre-purchase inspection (est. 2 h)', quantity: 1, unit: 'job', price: 1500 }], 'Inspection');
  const sl = S.lines[0].line_id;
  await event(S.id, [{ line_id: sl, kind: 'add', particulars: 'Inspection — body and underbody', quantity: 2, unit: 'hour', amount: 1500, reference: idOf(CAT.diagnosis) }], ramesh);
  await event(S.id, [{ line_id: sl, kind: 'add', particulars: 'Extra time on the chassis',       quantity: 1.5, unit: 'hour', amount: 1125, reference: idOf(CAT.diagnosis) }], ramesh);
  await event(S.id, [{ line_id: sl, kind: 'deliver', quantity: 1, unit: 'job' }], ramesh);
  const s2 = (await linesOf(S.id))[sl];
  const sh = (s2.added || []).filter((a) => a.unit === 'hour').reduce((t, a) => t + Number(a.quantity), 0);
  ok(sh === 3.5 && Number(s2.charged) === 2625, 'estimated 2 h, accrued 3.5 h — the overrun is chargeable', money(s2.charged));
  ok(s2.complete === true, '⭐⭐ COMPLETE without anything being shipped — the FINDING was the deliverable');

  /* ══ 3 · BOTH — the job card ══════════════════════════════════════════════════════════════════════════ */
  console.log('\n3 · GOODS + SERVICE — one car, four complaints, three mechanics');
  const J = await send([
    { particulars: 'Complaint 1 — engine noise',    quantity: 1, unit: 'job', price: 0 },
    { particulars: 'Complaint 2 — driver door',     quantity: 1, unit: 'job', price: 0 },
    { particulars: 'Complaint 3 — AC not cooling',  quantity: 1, unit: 'job', price: 0 },
    { particulars: 'Complaint 4 — front tyre wear', quantity: 1, unit: 'job', price: 0 },
  ], 'Job card — TN 09 BX 4471');
  const [c1, c2, c3, c4] = J.lines.map((l) => l.line_id);
  const NAME = { [c1]: 'engine noise', [c2]: 'driver door', [c3]: 'AC not cooling', [c4]: 'front tyre wear' };

  /* Complaint 1 — Ramesh. Parts from the catalogue, labour by the hour. DONE. */
  await event(J.id, [
    { line_id: c1, kind: 'add', particulars: 'Diagnose + tappet adjustment', quantity: 2.5, unit: 'hour',  amount: 1875, reference: idOf(CAT.labour) },
    { line_id: c1, kind: 'add', particulars: 'Engine oil 5W-30',             quantity: 4,   unit: 'litre', amount: 2080, reference: idOf(CAT.oil) },
    { line_id: c1, kind: 'add', particulars: 'Oil filter',                   quantity: 1,   unit: 'piece', amount: 420,  reference: idOf(CAT.filter) },
    { line_id: c1, kind: 'deliver', quantity: 1, unit: 'job' },
  ], ramesh);

  /* Complaint 2 — Kavya. Diagnosed, found fine, NOTHING fitted, time still owed. DONE. */
  await event(J.id, [
    { line_id: c2, kind: 'add', particulars: 'Checked door alignment — within tolerance', quantity: 0.5, unit: 'hour', amount: 375, reference: idOf(CAT.diagnosis) },
    { line_id: c2, kind: 'deliver', quantity: 1, unit: 'job' },
  ], kavya);

  /* Complaint 3 — Kavya. Compressor on order: work started, NOT finished. */
  await event(J.id, [
    { line_id: c3, kind: 'add', particulars: 'AC diagnosis',    quantity: 1.5, unit: 'hour',  amount: 1125, reference: idOf(CAT.diagnosis) },
    { line_id: c3, kind: 'add', particulars: 'Refrigerant R134a', quantity: 1, unit: 'kg',    amount: 1150, reference: idOf(CAT.gas) },
  ], kavya);

  /* Complaint 4 — Suresh. Not started. */

  /* ── the two conversations ─────────────────────────────────────────────────────────────────────────────── */
  console.log('\n   messaging — one thread the customer sees, one they never do');
  const ext = await say(J.id, 'Engine and door are done. AC needs a compressor — it arrives Tuesday, so the car is ready Wednesday. Tyres not started yet.', 'external');
  const int1 = await say(J.id, 'Compressor is on back-order. Do not promise Tuesday to the customer until the part is in.', 'internal', c3, kavya);
  const int2 = await say(J.id, 'Tyres — waiting for the customer to choose between the 195 and the 205.', 'internal', c4, suresh);
  /* ⚠ Assert the RECEIPT, not the status code: this helper does not set .s on every path, and 'undefined < 300'
     is false — a green call reported as a failure. The message_id is the server saying it stored the thing. */
  ok(!!(ext.b && ext.b.message_id), 'EXTERNAL update posted — the customer sees this one');
  ok(!!(int1.b && int1.b.message_id) && !!(int2.b && int2.b.message_id), '⭐ INTERNAL notes posted against a SPECIFIC complaint — the customer never sees these',
    'threaded to AC + tyres');

  /* ── the holistic picture ──────────────────────────────────────────────────────────────────────────────── */
  const L = await linesOf(J.id);
  const rows = [c1, c2, c3, c4].map((id) => {
    const l = L[id] || {};
    const ev = l.added || [];
    const hours = ev.filter((a) => a.unit === 'hour').reduce((t, a) => t + Number(a.quantity || 0), 0);
    const parts = ev.filter((a) => a.unit !== 'hour');
    const labour = ev.filter((a) => a.unit === 'hour').reduce((t, a) => t + Number(a.amount || 0), 0);
    const mats = parts.reduce((t, a) => t + Number(a.amount || 0), 0);
    const who = [...new Set(ev.map((a) => a.by_actor).filter(Boolean))];
    return { id, name: NAME[id], done: l.complete === true, hours, parts: parts.length, labour, mats, who, started: ev.length > 0 };
  });

  console.log('\n── JOB CARD · TN 09 BX 4471 ' + '─'.repeat(38));
  rows.forEach((r) => {
    const state = r.done ? 'DONE     ' : (r.started ? 'IN PROGRESS' : 'NOT STARTED');
    console.log('   ' + r.name.padEnd(18) + state.padEnd(13)
      + (r.hours ? (r.hours + ' h').padEnd(7) : '—'.padEnd(7))
      + (r.parts + ' parts').padEnd(10)
      + money(r.labour + r.mats).padStart(10)
      + '   ' + (r.who.join(', ') || '—'));
  });
  const done = rows.filter((r) => r.done).length;
  const hours = rows.reduce((t, r) => t + r.hours, 0);
  const labour = rows.reduce((t, r) => t + r.labour, 0);
  const mats = rows.reduce((t, r) => t + r.mats, 0);
  const people = new Set(rows.flatMap((r) => r.who));
  console.log('   ' + '─'.repeat(62));
  console.log('   ' + String(done) + ' of 4 complaints closed'.padEnd(24)
    + ('  ' + people.size + ' people   ' + hours + ' h   ' + rows.reduce((t, r) => t + r.parts, 0) + ' parts'));
  console.log('   labour ' + money(labour) + '   ·   materials ' + money(mats) + '   ·   TOTAL SO FAR ' + money(labour + mats));
  console.log('─'.repeat(66));

  ok(done === 2, '⭐⭐ PARTIAL: 2 of 4 complaints closed, computed from the lines, never stored', done + '/4');
  ok(rows[2].started && !rows[2].done, 'AC is IN PROGRESS — work recorded, complaint still open', money(rows[2].labour + rows[2].mats));
  ok(!rows[3].started, 'tyres NOT STARTED — no events, and the job card says so');
  /* ⭐ TWO, not three, and the job card is more honest for it: Suresh is on the tyres and the tyres have not
     started, so he has recorded nothing. A showcase that said 'three people worked' would be counting the
     ROSTER, not the work — the same error as counting the entity instead of the actor. */
  ok(people.size === 2, 'two mechanics have recorded work; the third is assigned to a complaint not yet started',
    [...people].join(' · ') + '  (crew of ' + crew.length + ')');
  ok(labour + mats === 7025, 'the running total is SUMMED from events — it rises as work happens', money(labour + mats));
  ok(rows.every((r) => (L[r.id].added || []).every((a) => a.unit === 'hour' || a.reference)),
    '⭐ every PART carries its catalogue reference — "6 materials changed" reconciles against the catalogue');

  const fails = T.filter((t) => !t.ok);
  console.log('\n══ ' + (T.length - fails.length) + ' passed · ' + fails.length + ' failed ══\n');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e && e.message); process.exit(1); });
