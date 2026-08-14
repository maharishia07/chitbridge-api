'use strict';
/**
 * prove-partial.js — PARTIAL DELIVERY, and the unit bug that made it lie.
 *
 * Athi, 2026-08-14: *"once we complete full round of testing for the full delivery, then focus on partial
 * delivery … let us prove one at a time."*
 *
 * Full delivery is the easy half: one number equals another. PARTIAL is where a delivery record earns its keep,
 * because every interesting failure needs a remainder to hide in —
 *
 *   · a half delivery must leave the right amount owed, and say so
 *   · a second delivery must ADD to the first, not replace it
 *   · a correction is a NEGATIVE entry, never an edit — both stay on the record
 *   · ⭐ a delivery in a DIFFERENT UNIT must not be summed into the total
 *
 * That last one is why this file exists. `progress()` added every row's number whatever unit it carried, so:
 *
 *      ordered 10 kg  ·  recorded 12 pieces   →   delivered 12 ≥ 10   →   COMPLETE, 2 over
 *
 * A line that closes itself is the one nobody chases. It is invisible on a full same-unit delivery, which is
 * exactly why it survived until partial delivery was tested.
 *
 * Run:  node scripts/prove-partial.js
 */
const P = require('./_proof');
const deliverline = require('../lib/deliverline');

const T = [];
const ok = (cond, msg, detail) => { T.push({ ok: !!cond, msg, detail }); };

/**
 * ── PART A · THE UNIT RULE, WITH NO DATABASE ───────────────────────────────────────────────────────────────────
 *
 * ⭐ `progress()` already accepts pre-fetched rows (the one-shot CTE path passes them straight in), which makes
 * the arithmetic testable on its own. That matters more than convenience here: this rule must be provable on a
 * laptop with no credentials, in a second, or it will be verified rarely and drift quietly.
 */
async function pure() {
  const ME = 'e1', THEM = 'e2';
  const row = (o) => Object.assign({ line_id: 'L1', particulars: 'Groundnut Oil', ordered_unit: 'kg', ordered: 10,
    removed: false, delivery_id: null, dq: null, du: null, reference: null, note: null,
    recorded_by_entity_id: null, recorded_by_name: null, recorded_by_actor_name: null, delivered_at: new Date() }, o);
  const at = async (msg, rows, check) => {
    const e = (await deliverline.progress(ME, 'c1', null, rows)).get('L1');
    ok(check(e), msg, 'delivered=' + e.delivered + ' pending=' + e.pending + ' complete=' + e.complete
      + ' mismatch=' + !!e.unit_mismatch + ' other=' + JSON.stringify(e.other_units));
  };

  console.log('\nA · The unit rule (no database)');
  /* ⭐ THE ONE THAT WAS WRONG IN PRODUCTION: delivered 12, complete true, 2 over. */
  await at('12 PIECES against 10 KG does not close the line',
    [row({ delivery_id: 'd1', dq: 12, du: 'piece', recorded_by_entity_id: ME })],
    (e) => e.delivered === 0 && e.complete === false && e.pending === 10 && e.unit_mismatch === true
        && e.other_units.length === 1 && e.other_units[0].mine === 12);
  await at('a blank unit is read as the ordered unit — an omission is not a claim',
    [row({ delivery_id: 'd1', dq: 10, du: null, recorded_by_entity_id: ME })],
    (e) => e.delivered === 10 && e.complete === true && !e.unit_mismatch);
  await at('case and padding do not split a unit (" KG " is kg)',
    [row({ delivery_id: 'd1', dq: 4, du: ' KG ', recorded_by_entity_id: ME })],
    (e) => e.delivered === 4 && e.pending === 6 && !e.unit_mismatch);
  await at('mixed rows: only the ordered unit counts toward the total',
    [row({ delivery_id: 'd1', dq: 6, du: 'kg', recorded_by_entity_id: ME }),
     row({ delivery_id: 'd2', dq: 2, du: 'crate', recorded_by_entity_id: ME })],
    (e) => e.delivered === 6 && e.pending === 4 && e.complete === false && e.unit_mismatch === true);
  await at('two sides agreeing in the same unit still agree',
    [row({ delivery_id: 'd1', dq: 10, du: 'kg', recorded_by_entity_id: ME }),
     row({ delivery_id: 'd2', dq: 10, du: 'kg', recorded_by_entity_id: THEM })],
    (e) => e.both_agree === true && e.divergent === false);
  /* ⚠️ AGREEMENT IS THE STRONGEST SIGNAL ON THE RAIL, so it must not be forgeable by unit confusion: "10 crates"
     is not confirmation of "10 kg", and letting it read as one would put a false ✓ on a disputed delivery. */
  await at('an off-unit counterparty claim cannot forge agreement',
    [row({ delivery_id: 'd1', dq: 10, du: 'kg', recorded_by_entity_id: ME }),
     row({ delivery_id: 'd2', dq: 10, du: 'crate', recorded_by_entity_id: THEM })],
    (e) => e.both_agree === false && e.unit_mismatch === true);
}

(async () => {
  await pure();
  if (process.argv.includes('--pure')) { report(); return; }
  console.log('\nB · Against the API (' + (process.env.CB_API || 'production') + ')');
  /* ⚠️ ONLY AN INPUT CONTAINING "@" CREATES. A bare word is read as a handle or display name and must already
     exist — so registering "partialtest" returns "Entity not found", which reads like a broken endpoint rather
     than the lookup it actually is. Register with the ADDRESS. */
  const EMAIL = 'partialtest@email.com';
  const reg = await P.j('/api/entities/register', { method: 'POST',
    body: { email: EMAIL, display_name: 'Partial Test Co' } });
  const otp = (reg.b && reg.b.dev_otp) || '123456';
  const v = await P.j('/api/entities/verify', { method: 'POST', body: { email: EMAIL, otp } });
  if (!(v.b && v.b.token)) { console.log('sign-in failed', reg.status, JSON.stringify(reg.b).slice(0, 200)); process.exit(1); }
  const auth = { token: v.b.token };
  const me = await P.j('/api/entities/me', auth);
  const myId = (me.b && (me.b.identity_id || (me.b.entity || {}).identity_id)) || null;

  const send = async (lines, subject) => {
    const s = await P.j('/api/chits/send', { method: 'POST', ...auth, body: {
      purpose: 'order', manual_subject: subject,
      line_items: lines, recipients: myId ? [{ entity_id: myId, role: 'to' }] : [], send_to_self: true } });
    const det = await P.j('/api/chits/' + s.b.chit_id, auth);
    return { id: s.b.chit_id, lines: det.b.live_set || [] };
  };
  const deliver = (id, rows) => P.j('/api/chits/' + id + '/deliver-lines', { method: 'POST', ...auth, body: { rows } });
  /* The route returns `line_delivery` keyed by line_id, plus a derived `delivery_summary`. */
  const prog = async (id) => {
    const d = await P.j('/api/chits/' + id, auth);
    return { byLine: d.b.line_delivery || {}, summary: d.b.delivery_summary || null };
  };
  const lineOf = (p, line_id) => (p.byLine || {})[line_id] || null;

  // ══ 1 · A HALF DELIVERY LEAVES THE RIGHT REMAINDER ══════════════════════════════════════════════════════════
  console.log('\n1 · Partial — half of one line');
  const A = await send([{ particulars: 'Rice Ponni', quantity: 100, unit: 'kg', price: 60 },
                        { particulars: 'Toor Dal', quantity: 20, unit: 'kg', price: 140 }], 'PARTIAL half');
  await deliver(A.id, [{ line_id: A.lines[0].line_id, quantity: 40, unit: 'kg', reference: 'DC-1' }]);
  let p = await prog(A.id);
  let l0 = lineOf(p, A.lines[0].line_id);
  ok(l0 && Number(l0.delivered) === 40, '40 of 100 recorded', l0 && ('delivered ' + l0.delivered));
  ok(l0 && Number(l0.pending) === 60, '60 kg still owed', l0 && ('pending ' + l0.pending));
  ok(l0 && l0.complete === false, 'the line is NOT complete', l0 && ('complete ' + l0.complete));
  const l1 = lineOf(p, A.lines[1].line_id);
  ok(l1 && Number(l1.delivered) === 0 && l1.complete === false,
    'the untouched line is untouched — a delivery is per LINE, not per chit', l1 && ('delivered ' + l1.delivered));
  ok(p.summary && p.summary.partial === 1, 'the header can say ONE line is partial',
    p.summary && JSON.stringify(p.summary));

  // ══ 2 · A SECOND DELIVERY ADDS ═════════════════════════════════════════════════════════════════════════════
  console.log('\n2 · Partial — the rest arrives');
  await deliver(A.id, [{ line_id: A.lines[0].line_id, quantity: 60, unit: 'kg', reference: 'DC-2' }]);
  p = await prog(A.id); l0 = lineOf(p, A.lines[0].line_id);
  ok(l0 && Number(l0.delivered) === 100, 'two deliveries ADD to 100 — the second did not replace the first',
    l0 && ('delivered ' + l0.delivered));
  ok(l0 && Number(l0.pending) === 0 && l0.complete === true, 'nothing owed, the line is complete');
  ok(l0 && (l0.events || []).length === 2, 'BOTH deliveries remain on the record — a total is derived, never stored',
    l0 && ((l0.events || []).length + ' events'));

  // ══ 3 · A CORRECTION IS A NEGATIVE ENTRY ═══════════════════════════════════════════════════════════════════
  console.log('\n3 · Over-delivery, then a correcting entry');
  const B = await send([{ particulars: 'Sugar', quantity: 50, unit: 'kg', price: 45 }], 'PARTIAL correct');
  await deliver(B.id, [{ line_id: B.lines[0].line_id, quantity: 58, unit: 'kg', reference: 'DC-3' }]);
  p = await prog(B.id); let b0 = lineOf(p, B.lines[0].line_id);
  ok(b0 && Number(b0.over) === 8, 'excess is RECORDED, not rejected — the lorry brought 58', b0 && ('over ' + b0.over));
  await deliver(B.id, [{ line_id: B.lines[0].line_id, quantity: -8, unit: 'kg', note: '8 kg returned' }]);
  p = await prog(B.id); b0 = lineOf(p, B.lines[0].line_id);
  ok(b0 && Number(b0.delivered) === 50 && Number(b0.over) === 0, 'the correction brings it back to 50',
    b0 && ('delivered ' + b0.delivered + ' over ' + b0.over));
  ok(b0 && (b0.events || []).length === 2,
    'the 58 AND the -8 both stay — a claim is corrected, never erased', b0 && ((b0.events || []).length + ' events'));

  // ══ 4 · ⭐ THE UNIT BUG ════════════════════════════════════════════════════════════════════════════════════
  console.log('\n4 · ⭐ A delivery in a different unit must NOT close the line');
  const C = await send([{ particulars: 'Groundnut Oil', quantity: 10, unit: 'kg', price: 180 }], 'PARTIAL units');
  await deliver(C.id, [{ line_id: C.lines[0].line_id, quantity: 12, unit: 'piece', reference: 'DC-4' }]);
  p = await prog(C.id); let c0 = lineOf(p, C.lines[0].line_id);
  /* ⚠️ THE OLD BEHAVIOUR WAS: delivered 12, complete true, over 2. Every assertion below is the inverse. */
  ok(c0 && Number(c0.delivered) === 0,
    '12 PIECES do not count toward 10 KG', c0 && ('delivered ' + c0.delivered));
  ok(c0 && c0.complete === false,
    '⭐ the line is NOT complete — the old sum closed it and nobody would have chased it',
    c0 && ('complete ' + c0.complete));
  ok(c0 && Number(c0.pending) === 10, 'all 10 kg still owed', c0 && ('pending ' + c0.pending));
  ok(c0 && c0.unit_mismatch === true, 'and it is FLAGGED, not silently ignored', c0 && ('unit_mismatch ' + c0.unit_mismatch));
  ok(c0 && (c0.other_units || []).length === 1 && Number(c0.other_units[0].mine) === 12,
    'the 12 pieces are carried BESIDE the total — recorded, visible, never converted',
    c0 && JSON.stringify(c0.other_units));
  ok(c0 && (c0.events || []).length === 1 && c0.events[0].off_unit === true,
    'the event itself is marked off-unit so a screen can say why');

  console.log('\n5 · A blank unit is an omission, not a different unit');
  const D = await send([{ particulars: 'Salt', quantity: 20, unit: 'kg', price: 20 }], 'PARTIAL blank unit');
  await deliver(D.id, [{ line_id: D.lines[0].line_id, quantity: 20 }]);
  p = await prog(D.id); const d0 = lineOf(p, D.lines[0].line_id);
  ok(d0 && Number(d0.delivered) === 20 && d0.complete === true && !d0.unit_mismatch,
    'recording "20" against a line ordered in kg is a claim about THAT line',
    d0 && ('delivered ' + d0.delivered + ' mismatch ' + d0.unit_mismatch));

  report();
})().catch((e) => { console.log('ERR', e.message); process.exit(1); });

function report() {
  let pass = 0, fail = 0;
  console.log('');
  T.forEach((t) => { if (t.ok) { pass++; console.log('  ✓ ' + t.msg + (t.detail ? '  ' + t.detail : '')); }
                     else { fail++; console.log('  ✗ ' + t.msg + (t.detail ? '  → got ' + t.detail : '')); } });
  console.log('\n== RESULT ==  PASS ' + pass + '  ·  FAIL ' + fail);
  process.exit(fail ? 1 : 0);
}
