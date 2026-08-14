'use strict';
/**
 * prove-line-events.js — ONE MECHANISM, BOTH DIRECTIONS (b152).
 *
 * Athi, 2026-08-14: *"assume a car service and it breaks down into multiple lines of service, then it adds more
 * information like adding brake oil, brake shoe and so on, all should be accumulated under a line item. Here it is
 * the reverse, both are nothing but the same… I am just creating the ways and means."*
 *
 * A line is a SPINE. Events hang off it and accumulate. The only thing that differs is what the line's own
 * quantity MEANS:
 *
 *     GOODS    a COMMITMENT.  Events draw it down.        100 kg ordered → 40 + 60 → nothing owed.
 *     SERVICE  an ESTIMATE.   Events accrue upward.       brake job → oil, shoe, labour, each in its own unit.
 *
 * This proves both readings off the same table, and the three guards that make "partial delivery stays amendable"
 * safe rather than a hole.
 *
 * Run:  node scripts/prove-line-events.js        (needs b152 applied)
 */
const P = require('./_proof');

const T = [];
const ok = (cond, msg, detail) => { T.push({ ok: !!cond, msg, detail }); };

(async () => {
  const EMAIL = 'eventtest@email.com';
  const reg = await P.j('/api/entities/register', { method: 'POST',
    body: { email: EMAIL, display_name: 'Event Test Co' } });
  const otp = (reg.b && reg.b.dev_otp) || '123456';
  const v = await P.j('/api/entities/verify', { method: 'POST', body: { email: EMAIL, otp } });
  if (!(v.b && v.b.token)) { console.log('sign-in failed', JSON.stringify(reg.b).slice(0, 200)); process.exit(1); }
  const auth = { token: v.b.token };
  const me = await P.j('/api/entities/me', auth);
  const myId = (me.b && (me.b.identity_id || (me.b.entity || {}).identity_id)) || null;

  const send = async (lines, subject) => {
    const s = await P.j('/api/chits/send', { method: 'POST', ...auth, body: {
      purpose: 'order', manual_subject: subject, line_items: lines,
      recipients: myId ? [{ entity_id: myId, role: 'to' }] : [], send_to_self: true } });
    const det = await P.j('/api/chits/' + s.b.chit_id, auth);
    return { id: s.b.chit_id, lines: det.b.live_set || [] };
  };
  const event = (id, rows) => P.j('/api/chits/' + id + '/deliver-lines', { method: 'POST', ...auth, body: { rows } });
  const amend = (id, edits) => P.j('/api/chits/' + id + '/amend', { method: 'POST', ...auth, body: { edits } });
  const lineOf = async (id, line_id) => {
    const d = await P.j('/api/chits/' + id, auth);
    return { line: (d.b.line_delivery || {})[line_id] || null, summary: d.b.delivery_summary || null };
  };

  // ══ A · THE REVERSE DIRECTION — a car service accumulating under one line ═══════════════════════════════════
  console.log('\nA · Service — one line, many events, mixed units');
  const S = await send([{ particulars: 'Brake service', quantity: 1, unit: 'job', price: 2000 }], 'CAR service');
  const job = S.lines[0].line_id;

  await event(S.id, [
    { line_id: job, kind: 'add', particulars: 'Brake oil DOT4', quantity: 1, unit: 'litre', amount: 650 },
    { line_id: job, kind: 'add', particulars: 'Brake shoe (pair)', quantity: 2, unit: 'piece', amount: 1200 },
    { line_id: job, kind: 'add', particulars: 'Labour', quantity: 1.5, unit: 'hour', amount: 900 },
  ]);
  let r = await lineOf(S.id, job);
  const added = (r.line && r.line.added) || [];
  ok(added.length === 3, 'three events accumulated under ONE line', added.length + ' added');
  ok(r.line && Number(r.line.charged) === 2750, '⭐ money DOES sum across events — 650+1200+900 = 2750',
    r.line && ('charged ' + r.line.charged));
  /* ⚠️ THE WHOLE POINT OF THE MIXED-UNIT RULE, seen from the other side: 1 litre + 2 piece + 1.5 hour is not 4.5
     of anything. Each stays in its own unit; only the money is added. */
  ok(added.map((a) => a.unit).sort().join(',') === 'hour,litre,piece',
    'each event keeps its OWN unit — litre, piece, hour, never summed',
    added.map((a) => a.quantity + ' ' + a.unit).join(' · '));
  ok(r.line && Number(r.line.delivered) === 0,
    '⭐ an added event does NOT deliver the job — fitting a shoe is not 2 of a brake service',
    r.line && ('delivered ' + r.line.delivered));
  ok(r.line && r.line.complete === false, 'so the job is still open');
  ok(r.summary && r.summary.accruing === 1 && Number(r.summary.charged) === 2750,
    'the header can say: 1 line accruing, 2750 charged', r.summary && JSON.stringify(r.summary));

  console.log('\nA2 · Then the job itself is delivered — the forward direction, same line');
  await event(S.id, [{ line_id: job, quantity: 1, unit: 'job', reference: 'JC-9' }]);
  r = await lineOf(S.id, job);
  ok(r.line && Number(r.line.delivered) === 1 && r.line.complete === true,
    'the JOB completes on its own quantity, independent of what accrued under it',
    r.line && ('delivered ' + r.line.delivered + ' complete ' + r.line.complete));
  ok(r.line && (r.line.added || []).length === 3 && Number(r.line.charged) === 2750,
    'and the parts and labour are all still there', r.line && ((r.line.added || []).length + ' added'));

  console.log('\nA3 · A money-only event — a fee with no thing attached');
  await event(S.id, [{ line_id: job, kind: 'add', particulars: 'Diagnostic fee', quantity: 0, amount: 500 }]);
  r = await lineOf(S.id, job);
  ok(r.line && Number(r.line.charged) === 3250, 'quantity 0 is legal for an add when it carries money',
    r.line && ('charged ' + r.line.charged));

  console.log('\nA4 · An event that records nothing is refused');
  let bad = await event(S.id, [{ line_id: job, kind: 'add', particulars: 'Nothing', quantity: 0, amount: 0 }]);
  ok(bad.status === 400, 'no quantity and no amount → refused', 'status ' + bad.status);
  bad = await event(S.id, [{ line_id: job, kind: 'add', quantity: 1, unit: 'piece', amount: 100 }]);
  ok(bad.status === 400, 'an add with no particulars → refused (it could not be read back)', 'status ' + bad.status);
  bad = await event(S.id, [{ line_id: job, quantity: 0, unit: 'job' }]);
  ok(bad.status === 400, '⚠️ and the DELIVER rule is unchanged — a delivery of nothing is still refused',
    'status ' + bad.status);

  // ══ B · PARTIAL DELIVERY STAYS AMENDABLE — and the three guards ═════════════════════════════════════════════
  console.log('\nB · Partial delivery is amendable, within limits');
  const G = await send([{ particulars: 'Rice Ponni', quantity: 100, unit: 'kg', price: 60 }], 'GOODS amendable');
  const ln = G.lines[0].line_id;
  await event(G.id, [{ line_id: ln, quantity: 40, unit: 'kg', reference: 'DC-A' }]);

  /* ⭐ THE DECISION: 40 of 100 out, and the 60 still owed must remain changeable. The old rule froze it. */
  let a = await amend(G.id, [{ line_index: 0, line_id: ln,
    line: { particulars: 'Rice Ponni', quantity: 80, unit: 'kg', price: 60 }, reason_code: 'quantity_change' }]);
  ok(a.status === 200, '⭐ 100 → 80 with 40 delivered: ALLOWED. Partial delivery stays amendable',
    'status ' + a.status + ' ' + JSON.stringify(a.b).slice(0, 90));
  r = await lineOf(G.id, ln);
  ok(r.line && Number(r.line.pending) === 40, 'and the remainder re-reads correctly — 80 ordered, 40 out, 40 owed',
    r.line && ('ordered ' + r.line.ordered + ' pending ' + r.line.pending));

  console.log('\nB2 · The three guards');
  a = await amend(G.id, [{ line_index: 0, line_id: ln,
    line: { particulars: 'Rice Ponni', quantity: 20, unit: 'kg', price: 60 }, reason_code: 'quantity_change' }]);
  ok(a.status === 409 && a.b.code === 'LINE_BELOW_DELIVERED',
    '⭐ 80 → 20 with 40 delivered: REFUSED. That is a return, not an amendment',
    'status ' + a.status + ' ' + (a.b && a.b.code));

  a = await amend(G.id, [{ line_index: 0, line_id: ln,
    line: { particulars: 'Rice Ponni', quantity: 80, unit: 'bag', price: 60 }, reason_code: 'quantity_change' }]);
  ok(a.status === 409 && a.b.code === 'LINE_UNIT_LOCKED',
    '⭐ kg → bag with 40 kg delivered: REFUSED. The delivery would count against nothing',
    'status ' + a.status + ' ' + (a.b && a.b.code));

  a = await amend(G.id, [{ line_index: 0, line_id: ln, line: null, reason_code: 'removed' }]);
  ok(a.status === 409 && a.b.code === 'LINE_DELIVERED',
    'removal with 40 delivered: REFUSED. You cannot un-order what was handed over',
    'status ' + a.status + ' ' + (a.b && a.b.code));

  console.log('\nB3 · A negative event is the way back — and then the reduction is legal');
  await event(G.id, [{ line_id: ln, quantity: -40, unit: 'kg', note: '40 kg returned' }]);
  r = await lineOf(G.id, ln);
  ok(r.line && Number(r.line.delivered) === 0, 'the return brings delivered back to 0',
    r.line && ('delivered ' + r.line.delivered));
  ok(r.line && (r.line.events || []).length === 2, 'both the 40 and the -40 stay on the record');
  a = await amend(G.id, [{ line_index: 0, line_id: ln,
    line: { particulars: 'Rice Ponni', quantity: 20, unit: 'kg', price: 60 }, reason_code: 'quantity_change' }]);
  ok(a.status === 200, '⭐ now 80 → 20 is ALLOWED — the guard tracks the signed total, not "was ever touched"',
    'status ' + a.status);

  console.log('\nB4 · An untouched line is never guarded');
  const U = await send([{ particulars: 'Sugar', quantity: 50, unit: 'kg', price: 45 },
                        { particulars: 'Salt', quantity: 10, unit: 'kg', price: 20 }], 'GOODS untouched');
  await event(U.id, [{ line_id: U.lines[0].line_id, quantity: 50, unit: 'kg' }]);
  a = await amend(U.id, [{ line_index: 1, line_id: U.lines[1].line_id, line: null, reason_code: 'removed' }]);
  ok(a.status === 200, 'a delivered NEIGHBOUR does not freeze this line — the guard is per line',
    'status ' + a.status);

  let pass = 0, fail = 0;
  console.log('');
  T.forEach((t) => { if (t.ok) { pass++; console.log('  ✓ ' + t.msg + (t.detail ? '  ' + t.detail : '')); }
                     else { fail++; console.log('  ✗ ' + t.msg + (t.detail ? '  → got ' + t.detail : '')); } });
  console.log('\n== RESULT ==  PASS ' + pass + '  ·  FAIL ' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERR', e.message); process.exit(1); });
