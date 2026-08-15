'use strict';
/**
 * prove-line-threads.js — THE BOUNDARY, ON A REAL TWO-PARTY CHIT.
 *
 * Athi, 2026-08-15: *"can we add the external message tab as well … create two party chit and check the external
 * messaging."*
 *
 * ⚠️ EVERY OTHER TEST IN THIS REPO USES A SELF-CHIT, where one entity is both sides. That is fine for arithmetic
 * and useless for CONFIDENTIALITY: when sender and receiver are the same entity, an internal message and an
 * external one land in the same place and both look correct. The one thing this file exists to prove — that the
 * counterparty cannot see an internal note — is invisible without a genuine second party.
 *
 * Run:  node scripts/prove-line-threads.js
 */
const P = require('./_proof');
const T = [];
const ok = (c, m, d) => T.push({ ok: !!c, m, d });

const login = async (email, name) => {
  const r = await P.j('/api/entities/register', { method: 'POST', body: { email, display_name: name } });
  const v = await P.j('/api/entities/verify', { method: 'POST', body: { email, otp: (r.b && r.b.dev_otp) || '123456' } });
  const me = await P.j('/api/entities/me', { token: v.b.token });
  return { token: v.b.token, id: (me.b && (me.b.identity_id || (me.b.entity || {}).identity_id)), name };
};

(async () => {
  const seller = await login('threadseller@email.com', 'Thread Seller');
  const buyer  = await login('threadbuyer@email.com',  'Thread Buyer');

  const s = await P.j('/api/chits/send', { method: 'POST', token: seller.token, body: {
    purpose: 'order', manual_subject: 'THREADS two-party',
    line_items: [{ particulars: 'Rice', quantity: 80, unit: 'kg', price: 60 },
                 { particulars: 'Dal',  quantity: 20, unit: 'kg', price: 140 }],
    recipients: [{ entity_id: buyer.id, role: 'to' }], send_to_self: false } });
  const id = s.b.chit_id;
  const det = await P.j('/api/chits/' + id, { token: seller.token });
  const ls = (det.b.live_set || []).map((x) => x.line_id);
  const A = ls[0], B = ls[1];
  ok(ls.length === 2, 'a real two-party chit with two lines', ls.length + ' lines');

  const post = (tok, text, type, line) => P.j('/api/chits/' + id + '/messages',
    { method: 'POST', token: tok, body: { message_text: text, thread_type: type, line_id: line } });
  const read = async (tok, type, line) => {
    const r = await P.j('/api/chits/' + id + '/messages?thread_type=' + type + (line ? '&line_id=' + line : ''), { token: tok });
    const b = r.b; return ((b && (b.messages || b.items || (Array.isArray(b) ? b : []))) || []).map((m) => m.message_text);
  };

  await post(seller.token, 'Rice is 2 days late — mill is down', 'external', A);
  await post(seller.token, 'do not tell them we oversold',       'internal', A);
  await post(buyer.token,  'That is fine, deliver Wednesday',    'external', A);
  await post(seller.token, 'Dal is on the same lorry',           'external', B);

  const sX = await read(seller.token, 'external', A), sI = await read(seller.token, 'internal', A);
  const bX = await read(buyer.token,  'external', A), bI = await read(buyer.token,  'internal', A);
  const bB = await read(buyer.token,  'external', B);

  ok(bX.some((t) => /mill is down/.test(t)), '⭐ the buyer SEES the seller external message');
  ok(sX.some((t) => /deliver Wednesday/.test(t)), '⭐ the seller sees the reply — a real two-way thread');
  /* ⚠️⚠️ THE ONE THAT MATTERS. Checked in BOTH threads, because a leak that put the note in the buyer's external
     thread would pass a test that only looked at their internal one. */
  ok(!bX.concat(bI).some((t) => /oversold/.test(t)), '⭐⭐ the buyer NEVER sees the internal note, in either thread');
  ok(sI.some((t) => /oversold/.test(t)), 'and the seller keeps their own note');
  ok(bI.length === 0, 'the buyer internal thread is empty — internal is per-entity, not per-chit');
  /* Line scoping has to hold across the boundary too: B's message must not appear under A for either party. */
  ok(!bX.some((t) => /same lorry/.test(t)) && bB.some((t) => /same lorry/.test(t)),
     'line scoping holds for the counterparty as well — B stays on B');

  let p = 0, f = 0;
  console.log('');
  T.forEach((t) => { if (t.ok) { p++; console.log('  ✓ ' + t.m + (t.d ? '  ' + t.d : '')); } else { f++; console.log('  ✗ ' + t.m + (t.d ? '  → ' + t.d : '')); } });
  console.log('\n== RESULT ==  PASS ' + p + '  ·  FAIL ' + f);
  process.exit(f ? 1 : 0);
})().catch((e) => { console.log('ERR', e.message); process.exit(1); });
