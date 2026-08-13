'use strict';
// seed-livewalk.js — ONE chit in Beta's TASK track carrying every state worth looking at.
//
// Built for Athi's live run of Design 2. A received order (Gamma the shop → Beta the wholesaler), which is the
// shape the real WhatsApp case takes: the order ARRIVES at you.
//
// Everything the walk needs on one screen:
//   · an amended line (struck through) and a removed one (greyed, with its reason)
//   · deliveries in all THREE states — both agree · disagreed · not confirmed yet — plus a partial
//   · lines assigned to two different co-assists, and one reassigned so the trail shows
//   · costs including a row entered by a co-assist who cannot read the totals
//
// ⚠️ CREATES DATA. Safe to re-run; each run makes a new chit and new co-assists (stamped), nothing is overwritten.
//
// Run: node scripts/seed-livewalk.js
const { j, signIn } = require('./_proof');

const eid = (t) => { try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64').toString()).identity_id; } catch (_) { return null; } };
const step = (s) => console.log('  · ' + s);

(async () => {
  const stamp = Date.now().toString().slice(-6);
  const BETA = await signIn('beta@test-cb.com', 'Beta Fresh');
  const GAMMA = await signIn('gamma@test-cb.com', 'Gamma Document Services');
  if (!BETA || !GAMMA) { console.log('could not sign in'); process.exit(1); }

  console.log('\n── seeding a walk-through chit ──────────────────────────────────────────────\n');

  /* ⚠️ SENT BY GAMMA, SO IT LANDS IN BETA'S **TASK** TRACK. Every earlier proof chit was sent BY Beta and sat in
     Order, which is why Athi could not find them where he was told to look. */
  const snd = await j('/api/chits/send', { method: 'POST', token: GAMMA, body: {
    recipients: [{ entity_id: eid(BETA), role: 'to' }],
    manual_subject: 'WALK ' + stamp + ' — Kumar, Friday vegetables', purpose: 'order',
    line_items: [
      { particulars: 'Onion big',   quantity: 25, unit: 'kg',    price: 40, comment: 'pack separately from small' },
      { particulars: 'Onion small', quantity: 10, unit: 'kg',    price: 45, comment: 'pack separately from big' },
      { particulars: 'Potato',      quantity: 20, unit: 'kg',    price: 30, comment: 'new stock only, not old' },
      { particulars: 'Beans',       quantity: 5,  unit: 'kg',    price: 60 },
      { particulars: 'Tomato',      quantity: 9,  unit: 'crate', price: 474, comment: 'nattu variety' },
    ] } });
  const id = snd.b && (snd.b.chit_id || (snd.b.chit && snd.b.chit.chit_id));
  if (!id) { console.log('send failed:', JSON.stringify(snd.b).slice(0, 300)); process.exit(1); }
  step('chit created, sent Gamma → Beta');

  const det = (await j('/api/chits/' + id, { token: BETA })).b;
  const L = (det.live_set || []).map((e) => e.line_id);
  if (L.length !== 5) { console.log('unexpected line count:', L.length); process.exit(1); }

  // ── amendments, on BETA's copy ────────────────────────────────────────────────────────────────────────────
  await j('/api/chits/' + id + '/amend', { method: 'POST', token: BETA, body: { edits: [
    { line_index: 0, line_id: L[0], line: { particulars: 'Onion big', quantity: 18, unit: 'kg', price: 35,
      comment: 'pack separately from small' }, reason_code: 'rate_agreed', reason: 'stock short, rate agreed on call' } ] } });
  step('Onion big amended 25 kg × ₹40 → 18 kg × ₹35  (will render struck through)');

  await j('/api/chits/' + id + '/amend', { method: 'POST', token: BETA, body: { edits: [
    { line_index: 3, line_id: L[3], line: null, reason_code: 'stock_unavailable' } ] } });
  step('Beans REMOVED, stock unavailable  (stays visible, greyed, counts nowhere)');

  // ── co-assists ────────────────────────────────────────────────────────────────────────────────────────────
  const mkActor = async (name, key) => {
    const r = await j('/api/actors', { method: 'POST', token: BETA, body: {
      display_name: name, actor_key: key, actor_role: 'field', actor_type: 'human' } });
    return { id: r.b && r.b.actor && r.b.actor.identity_id, login: r.b && r.b.actor && r.b.actor.login_format,
             otp: r.b && (r.b.otp || r.b.dev_otp), name };
  };
  const murugan = await mkActor('Murugan', 'murugan' + stamp);
  const selvam  = await mkActor('Selvam',  'selvam' + stamp);
  step('two co-assists created');

  // ── assignment (PRIVATE to Beta) ──────────────────────────────────────────────────────────────────────────
  const due = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  await j('/api/chits/' + id + '/assign-lines', { method: 'POST', token: BETA, body: { edits: [
    { line_id: L[0], assignee_actor_id: murugan.id, assignee_name: 'Murugan', assignee_type: 'human', task: 'packing', due_date: due },
    { line_id: L[1], assignee_actor_id: murugan.id, assignee_name: 'Murugan', assignee_type: 'human', task: 'packing', due_date: due },
    { line_id: L[2], assignee_actor_id: selvam.id,  assignee_name: 'Selvam',  assignee_type: 'human', task: 'loading', due_date: due },
  ] } });
  /* Reassigned so the "was Murugan → Selvam" trail has something to show. */
  await j('/api/chits/' + id + '/assign-lines', { method: 'POST', token: BETA, body: { edits: [
    { line_id: L[1], assignee_actor_id: selvam.id, assignee_name: 'Selvam', assignee_type: 'human', task: 'packing', due_date: due, note: 'Murugan on the other lorry' } ] } });
  step('lines assigned; Onion small REASSIGNED Murugan → Selvam (trail visible)');

  // ── deliveries — all three states ─────────────────────────────────────────────────────────────────────────
  await j('/api/chits/' + id + '/deliver-lines', { method: 'POST', token: BETA, body: { rows: [
    { line_id: L[0], quantity: 18, unit: 'kg', reference: 'signed by their boy' } ] } });
  await j('/api/chits/' + id + '/deliver-lines', { method: 'POST', token: GAMMA, body: { rows: [
    { line_id: L[0], quantity: 18, unit: 'kg', reference: 'received ok' } ] } });
  step('Onion big  → BOTH AGREE (18 each)');

  await j('/api/chits/' + id + '/deliver-lines', { method: 'POST', token: BETA, body: { rows: [
    { line_id: L[2], quantity: 20, unit: 'kg' } ] } });
  await j('/api/chits/' + id + '/deliver-lines', { method: 'POST', token: GAMMA, body: { rows: [
    { line_id: L[2], quantity: 15, unit: 'kg', note: 'only 15 arrived' } ] } });
  step('Potato     → DISAGREED (you 20, they 15) — both shown, neither corrected');

  await j('/api/chits/' + id + '/deliver-lines', { method: 'POST', token: BETA, body: { rows: [
    { line_id: L[4], quantity: 5, unit: 'crate', note: 'balance Saturday' } ] } });
  step('Tomato     → PARTIAL 5 of 9, and NOT CONFIRMED by them (the normal case)');
  step('Onion small→ nothing delivered yet (not started)');

  // ── costs ─────────────────────────────────────────────────────────────────────────────────────────────────
  await j('/api/chits/' + id + '/costs', { method: 'POST', token: BETA, body: { rows: [
    { line_id: L[0], kind: 'goods', amount: 504, note: '18 kg at 28 bought' },
    { line_id: L[4], kind: 'goods', amount: 1950, note: '5 crates at 390' },
    { kind: 'transport', amount: 250, note: 'one auto trip' },
  ] } });
  const mlog = await j('/api/actors/login', { method: 'POST', body: { username: murugan.login, otp: murugan.otp } });
  const MT = mlog.b && (mlog.b.token || (mlog.b.actor && mlog.b.actor.token));
  if (MT) {
    await j('/api/chits/' + id + '/costs', { method: 'POST', token: MT, body: { rows: [
      { line_id: L[0], kind: 'labour', minutes: 80, rate_per_hour: 150, note: 'packing' } ] } });
    step('Murugan recorded his own 80 minutes — and CANNOT read the totals');
  }

  const fin = (await j('/api/chits/' + id + '/costs', { token: BETA })).b;

  console.log('\n────────────────────────────────────────────────────────────────────────────');
  console.log('  Sign in : beta@test-cb.com   OTP 123456');
  console.log('  Look in : 📥 TASK  (this one is RECEIVED, unlike the earlier proof chits)');
  console.log('  Subject : WALK ' + stamp + ' — Kumar, Friday vegetables');
  console.log('  Then    : open it → ⧉ Lines');
  console.log('');
  console.log('  Co-assist login (to check write-without-read):');
  console.log('    ' + murugan.login + '   OTP ' + murugan.otp);
  console.log('    ⚠️ he should see ONLY his own labour row and be told totals are not shown');
  console.log('');
  console.log('  Owner sees: invoiced ' + fin.invoiced + ' · spent ' + fin.spent + ' · margin ' + fin.margin);
  console.log('  chit_id : ' + id + '\n');
})().catch((e) => { console.error('SEED ERROR', e); process.exit(1); });
