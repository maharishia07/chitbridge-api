'use strict';
// prove-cost-live.js — b145 on the live rail. Cost, margin, and WRITE-WITHOUT-READ.
//
// ⭐ THE ASSERTION THAT MATTERS: an actor without the grant can RECORD a cost and then read back their OWN row —
// and gets no totals, no margin, no other person's rows. Not zeroed totals. Not a masked string. Absent.
//
// Run: node scripts/prove-cost-live.js
const { j, signIn } = require('./_proof');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { console.log('  \x1b[32mok\x1b[0m  ' + n); pass++; } else { console.log('  \x1b[31mXX\x1b[0m  ' + n + (x ? '\n        ' + x : '')); fail++; } };
const eq = (n, g, w) => ok(n, JSON.stringify(g) === JSON.stringify(w), 'got  ' + JSON.stringify(g) + '\n        want ' + JSON.stringify(w));

(async () => {
  const stamp = Date.now().toString().slice(-6);
  const A = await signIn('beta@test-cb.com', 'Beta Fresh');
  const B = await signIn('gamma@test-cb.com', 'Gamma Document Services');
  if (!A || !B) { console.log('\n  could not sign in\n'); process.exitCode = 2; return; }
  const eid = (t) => { try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64').toString()).identity_id; } catch (_) { return null; } };

  console.log('\n── b145 live · cost, margin, write-without-read ─────────────────────────────\n');
  console.log('0 · a chit worth ₹1,000');
  const snd = await j('/api/chits/send', { method: 'POST', token: A, body: {
    recipients: [{ entity_id: eid(B), role: 'to' }], manual_subject: 'cost ' + stamp, purpose: 'order',
    line_items: [{ particulars: 'Onion', quantity: 25, unit: 'kg', price: 40 }] } });
  const id = snd.b && (snd.b.chit_id || (snd.b.chit && snd.b.chit.chit_id));
  ok('chit created', !!id, JSON.stringify(snd.b).slice(0, 180));
  if (!id) { process.exitCode = 1; return; }
  const L = ((await j('/api/chits/' + id, { token: A })).b.live_set || []).map((e) => e.line_id);

  console.log('\n1 · costs attach at TWO levels');
  const c1 = await j('/api/chits/' + id + '/costs', { method: 'POST', token: A, body: { rows: [
    { line_id: L[0], kind: 'goods', amount: 700, note: '25 kg at 28 bought' },
    { line_id: L[0], kind: 'labour', minutes: 80, rate_per_hour: 150, note: 'packing' },
    { kind: 'transport', amount: 250, note: 'one auto trip' },   // ⚠️ no line_id — a whole-chit cost
  ] } });
  ok('accepted', c1.status === 200, 'status ' + c1.status + ' ' + JSON.stringify(c1.b).slice(0, 200));
  eq('★★ labour derived from minutes × rate — 80/60 × 150', (c1.b.costs || [])[1] && Number(c1.b.costs[1].amount), 200);
  ok('★ the transport row carries NO line_id — one trip, not an invented allocation',
     (c1.b.costs || [])[2] && c1.b.costs[2].line_id === null, JSON.stringify((c1.b.costs || [])[2]));

  console.log('\n2 · ⭐ margin, computed');
  const r = await j('/api/chits/' + id + '/costs', { token: A });
  eq('★ the entity login may see totals', r.b.can_see_totals, true);
  eq('★★ spent = 700 + 200 + 250', r.b.spent, 1150);
  eq('★ by kind', [r.b.by_kind.goods, r.b.by_kind.labour, r.b.by_kind.transport], [700, 200, 250]);
  eq('★★ invoiced 1000 − spent 1150 = −150', r.b.margin, -150);
  eq('  …and the percentage says so too', r.b.margin_pct, -15);
  /* ⚠️ A LOSS IS SHOWN AS A LOSS. Flooring at zero, or hiding a negative, would make the one chit worth looking
     at look like every other chit. */
  ok('★★ a negative margin is reported, not floored', r.b.margin < 0);

  console.log('\n3 · a negative row corrects, nothing is edited');
  await j('/api/chits/' + id + '/costs', { method: 'POST', token: A, body: { rows: [
    { kind: 'transport', amount: -250, note: 'the auto was not used' } ] } });
  const r2 = await j('/api/chits/' + id + '/costs', { token: A });
  eq('★★ spent back to 900', r2.b.spent, 900);
  eq('★★ …and BOTH transport rows remain on the record',
     (r2.b.costs || []).filter((c) => c.kind === 'transport').map((c) => Number(c.amount)), [250, -250]);
  eq('  margin follows: 1000 − 900', r2.b.margin, 100);
  const zero = await j('/api/chits/' + id + '/costs', { method: 'POST', token: A, body: { rows: [{ kind: 'other', amount: 0 }] } });
  ok('  a zero-amount cost is refused as meaningless', zero.status === 400, 'status ' + zero.status);

  console.log('\n4 · ⭐⭐ WRITE-WITHOUT-READ — the assertion this whole feature exists for');
  /* A co-assist of Beta, created fresh, so can_see_costs is at its default. */
  const mk = await j('/api/actors', { method: 'POST', token: A, body: {
    display_name: 'Murugan ' + stamp, actor_key: 'murugan' + stamp, actor_role: 'packer', actor_type: 'human' } });
  /* The OTP is top-level on the response, and the username is actor_key@entity — read from the actual
     payload rather than guessed a third time. */
  const act = (mk.b && mk.b.actor) || {};
  const uname = act.login_format;
  const otp = mk.b && (mk.b.otp || mk.b.dev_otp);
  ok('a co-assist was created', !!uname && !!otp, JSON.stringify(mk.b).slice(0, 300));
  if (!uname || !otp) { console.log('\n  cannot test the gate without an actor login\n'); }
  else {
    const lg = await j('/api/actors/login', { method: 'POST', body: { username: uname, otp } });
    const M = lg.b && (lg.b.token || (lg.b.actor && lg.b.actor.token));
    ok('…and can sign in', !!M, JSON.stringify(lg.b).slice(0, 200));
    if (M) {
      const w = await j('/api/chits/' + id + '/costs', { method: 'POST', token: M, body: { rows: [
        { line_id: L[0], kind: 'labour', minutes: 30, rate_per_hour: 150, note: 'loading' } ] } });
      ok('★★ he CAN record his own labour', w.status === 200, 'status ' + w.status + ' ' + JSON.stringify(w.b).slice(0, 160));

      const mine = await j('/api/chits/' + id + '/costs', { token: M });
      eq('★★ …and reads back HIS OWN row', (mine.b.costs || []).length, 1);
      eq('★★ …which is his 30 minutes', (mine.b.costs || [])[0] && Number(mine.b.costs[0].amount), 75);
      /* ⭐ THE POINT. Not zeroed totals, not a masked string — ABSENT. An empty margin key would still tell him a
         margin exists and roughly when it moved. */
      eq('★★★ NO totals flag', mine.b.can_see_totals, false);
      ok('★★★ margin is ABSENT, not zero', !('margin' in mine.b), JSON.stringify(Object.keys(mine.b)));
      ok('★★★ spent is ABSENT', !('spent' in mine.b));
      ok('★★★ invoiced is ABSENT', !('invoiced' in mine.b));
      ok('★★★ by_kind is ABSENT', !('by_kind' in mine.b));
      ok('★★ …and he cannot see the goods cost anyone else entered',
         !(mine.b.costs || []).some((c) => c.kind === 'goods'), JSON.stringify(mine.b.costs));

      console.log('\n5 · the owner sees everything, including his row');
      const all = await j('/api/chits/' + id + '/costs', { token: A });
      eq('★ 5 rows now', (all.b.costs || []).length, 5);
      eq('★★ spent includes his 75', all.b.spent, 975);
      ok('★ …and his row is attributed to him',
         (all.b.costs || []).some((c) => Number(c.amount) === 75 && /Murugan/.test(c.recorded_by_actor_name || '')),
         JSON.stringify((all.b.costs || []).map((c) => [c.amount, c.recorded_by_actor_name])));
    }
  }

  console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + pass + ' passed, ' + fail + ' failed\x1b[0m');
  console.log('  chit left for inspection: ' + id + '  (subject "cost ' + stamp + '")\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
