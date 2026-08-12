'use strict';
// prove-delivery-live.js — b144 on the live rail. Partial delivery, shared, either side may record.
//
// The claims: partial is normal and SUMMED not stored · a delivery I record lands on THEIR copy too ·
// "both agree" means two independent claims matched · divergence is surfaced and blocks nothing ·
// excess is recorded not refused · a negative quantity corrects instead of deleting.
//
// Run: node scripts/prove-delivery-live.js
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

  console.log('\n── b144 live · per-line delivery ────────────────────────────────────────────\n');
  const snd = await j('/api/chits/send', { method: 'POST', token: A, body: {
    recipients: [{ entity_id: eid(B), role: 'to' }], manual_subject: 'deliver ' + stamp, purpose: 'order',
    line_items: [
      { particulars: 'Onion',  quantity: 10, unit: 'kg', price: 40 },
      { particulars: 'Potato', quantity: 20, unit: 'kg', price: 30 },
      { particulars: 'Tomato', quantity: 9,  unit: 'crate', price: 474 },
    ] } });
  const id = snd.b && (snd.b.chit_id || (snd.b.chit && snd.b.chit.chit_id));
  ok('chit created', !!id, JSON.stringify(snd.b).slice(0, 180));
  if (!id) { process.exitCode = 1; return; }
  const get = async (tok) => (await j('/api/chits/' + id, { token: tok })).b || {};
  const L = (await get(A)).live_set.map((e) => e.line_id);
  const dl = async (tok, rows) => j('/api/chits/' + id + '/deliver-lines', { method: 'POST', token: tok, body: { rows } });

  console.log('1 · ⭐ PARTIAL IS NORMAL — two rows, summed, never stored');
  await dl(A, [{ line_id: L[0], quantity: 6, unit: 'kg', reference: 'signed by their boy' }]);
  let p = (await get(A)).line_delivery || {};
  eq('★★ 6 of 10 delivered', (p[L[0]] || {}).delivered, 6);
  eq('★★ …4 pending, DERIVED', (p[L[0]] || {}).pending, 4);
  ok('  not complete yet', (p[L[0]] || {}).complete === false);
  await dl(A, [{ line_id: L[0], quantity: 4, unit: 'kg', note: 'balance Saturday' }]);
  p = (await get(A)).line_delivery || {};
  eq('★★ two rows sum to 10', (p[L[0]] || {}).delivered, 10);
  eq('★★ …now complete, and nothing was ever stored as a total', (p[L[0]] || {}).complete, true);
  eq('  both events remain readable', ((p[L[0]] || {}).events || []).map((e) => e.quantity), [6, 4]);

  console.log('\n2 · ⭐⭐ SHARED — my claim lands on THEIR copy');
  const theirs = (await get(B)).line_delivery || {};
  eq('★★ the counterparty sees the same 10 kg', ((theirs[L[0]] || {}).events || []).map((e) => e.quantity), [6, 4]);
  ok('★★ …attributed to me, not to them', ((theirs[L[0]] || {}).events || []).every((e) => e.mine === false),
     JSON.stringify((theirs[L[0]] || {}).events));
  /* ⚠️ Their `delivered` headline is their OWN claim, which is zero — they have not confirmed anything yet.
     If mine counted as theirs, a seller could move the buyer's number by asserting it. */
  eq('★★ …but their own delivered figure is still 0 — I cannot move their number', (theirs[L[0]] || {}).delivered, 0);
  eq('  they can see what I claim, separately', (theirs[L[0]] || {}).theirs, 10);

  console.log('\n3 · ⭐ BOTH AGREE — two independent claims that match');
  await dl(B, [{ line_id: L[0], quantity: 10, unit: 'kg', reference: 'received ok' }]);
  const bAfter = (await get(B)).line_delivery || {};
  const aAfter = (await get(A)).line_delivery || {};
  ok('★★ both sides now read both_agree', (bAfter[L[0]] || {}).both_agree === true && (aAfter[L[0]] || {}).both_agree === true,
     'B=' + JSON.stringify((bAfter[L[0]] || {}).both_agree) + ' A=' + JSON.stringify((aAfter[L[0]] || {}).both_agree));
  /* ⚠️ Compared on TOTALS, not rows: I recorded 6+4, they recorded 10. Identical row sets never happen. */
  ok('  …even though the SPLITS differ (6+4 vs 10)', ((aAfter[L[0]] || {}).events || []).length === 3);

  console.log('\n4 · ⭐ DIVERGENCE is surfaced, and blocks nothing');
  await dl(A, [{ line_id: L[1], quantity: 20, unit: 'kg' }]);
  await dl(B, [{ line_id: L[1], quantity: 15, unit: 'kg', note: 'only 15 arrived' }]);
  const dv = (await get(A)).line_delivery || {};
  ok('★★ flagged divergent', (dv[L[1]] || {}).divergent === true, JSON.stringify(dv[L[1]]));
  eq('★★ …my claim stands at 20', (dv[L[1]] || {}).delivered, 20);
  eq('★★ …theirs is shown BESIDE it at 15, not merged', (dv[L[1]] || {}).theirs, 15);
  ok('  neither side was corrected and nothing was blocked', (dv[L[1]] || {}).both_agree === false);

  console.log('\n5 · excess is RECORDED, never refused');
  await dl(A, [{ line_id: L[2], quantity: 11, unit: 'crate', note: 'round number, extra crate' }]);
  const ex = (await get(A)).line_delivery || {};
  eq('★★ 11 against an order of 9 is accepted', (ex[L[2]] || {}).delivered, 11);
  eq('★★ …and the excess is shown', (ex[L[2]] || {}).over, 2);
  eq('  pending floors at 0, never negative', (ex[L[2]] || {}).pending, 0);

  console.log('\n6 · a NEGATIVE quantity corrects — nothing is edited or deleted');
  await dl(A, [{ line_id: L[2], quantity: -2, unit: 'crate', note: 'took two back' }]);
  const cor = (await get(A)).line_delivery || {};
  eq('★★ back to 9', (cor[L[2]] || {}).delivered, 9);
  eq('★★ …and BOTH rows are still on the record', ((cor[L[2]] || {}).events || []).map((e) => e.quantity), [11, -2]);
  const zero = await j('/api/chits/' + id + '/deliver-lines', { method: 'POST', token: A, body: { rows: [{ line_id: L[2], quantity: 0 }] } });
  ok('  a zero-quantity delivery is refused as meaningless', zero.status === 400, 'status ' + zero.status);

  console.log('\n7 · the header roll-up is derived');
  const sum = (await get(A)).delivery_summary || {};
  eq('★ 3 lines, 2 complete', [sum.lines, sum.complete], [3, 2]);
  eq('★ …1 divergent, surfaced at chit level', sum.divergent, 1);

  console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + pass + ' passed, ' + fail + ' failed\x1b[0m');
  console.log('  chit left for inspection: ' + id + '  (subject "deliver ' + stamp + '")\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
