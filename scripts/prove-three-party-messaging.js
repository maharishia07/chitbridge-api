'use strict';
/**
 * prove-three-party-messaging.js — ONE ORDER, THREE PARTIES, THEIR ACTORS, ONE FULL CYCLE.
 *
 * Athi, 2026-08-15: *"are you confident it works perfect for two party? Can we elevate for three party, one
 * cycle, complete … create one order item, a sequence of meaningful messages from three parties and their
 * actors, one or two responses each."*
 *
 * ⚠️ TWO PARTIES CANNOT PROVE THE THING THAT MATTERS. With a sender and one receiver, "everyone in the audience"
 * and "the other side" are the same set, so a message that leaked to the wrong party would look identical to one
 * delivered correctly. It takes a THIRD party — a CC who is a full participant but not the counterparty — before
 * the audience rules have anything to get wrong.
 *
 * The cycle:
 *   mytest (supplier) sends an order   →  Karpagam (buyer, TO)  +  Speedy Transport (carrier, CC)
 *   buyer asks · supplier's ACTOR answers · carrier adds · buyer's ACTOR answers
 *   and the supplier writes an INTERNAL note that must reach nobody else at all.
 *
 * Run:  node scripts/prove-three-party-messaging.js
 */
const P = require('./_proof');

const T = [];
const ok = (c, m, d) => T.push({ ok: !!c, m, d });

const entity = async (email, name) => {
  const r = await P.j('/api/entities/register', { method: 'POST', body: { email, display_name: name } });
  const v = await P.j('/api/entities/verify', { method: 'POST', body: { email, otp: (r.b && r.b.dev_otp) || '123456' } });
  const me = await P.j('/api/entities/me', { token: v.b.token });
  return { name, token: v.b.token, id: me.b && (me.b.identity_id || (me.b.entity || {}).identity_id) };
};
/**
 * A fresh actor each run: the creation OTP is consumed at first login, so a reused one cannot sign in again.
 *
 * ⚠️ USE login_format AND otp FROM THE CREATE RESPONSE, never rebuild them. My first version composed
 * `key + '@' + owner.name` — which is right for "mytest" and wrong for "Karpagam Caterers", because the entity
 * segment is a handle and that name has a space in it. Every actor on that side 401'd, and the assertions that
 * depended on them reported a messaging failure that did not exist. The server already tells you the answer.
 */
const actor = async (owner, label) => {
  /* ⚠️ LOWERCASE. An actor_key with capitals is stored lowercased, so a username rebuilt from the original
     casing never matches and every login 401s — which then reads as "messaging is broken for actors". */
  const key = (label + String(Date.now()).slice(-5)).toLowerCase();
  const mk = await P.j('/api/actors', { method: 'POST', token: owner.token,
    body: { display_name: label, actor_key: key } });
  const a = (mk.b && mk.b.actor) || {};
  const lg = await P.j('/api/actors/login', { method: 'POST',
    body: { username: a.login_format || (key + '@' + owner.name), otp: (mk.b && (mk.b.otp || mk.b.dev_otp)) || '123456' } });
  return { name: label, key, id: a.identity_id, token: lg.b && lg.b.token, login: a.login_format };
};

(async () => {
  const supplier = await entity('mytest@email.com', 'mytest');
  const buyer    = await entity('karpagam@email.com', 'Karpagam Caterers');
  const carrier  = await entity('speedy@email.com', 'Speedy Transport');
  ok(supplier.id && buyer.id && carrier.id, 'three real entities', [supplier, buyer, carrier].map(x => x.name).join(' · '));

  // ── the order: TO the buyer, CC the carrier — three participants, one chit ────────────────────────────────
  const sent = await P.j('/api/chits/send', { method: 'POST', token: supplier.token, body: {
    purpose: 'order', manual_subject: '3P — Rice for Karpagam',
    line_items: [{ particulars: 'Rice Ponni Boiled', quantity: 80, unit: 'kg', price: 60 },
                 { particulars: 'Toor Dal', quantity: 20, unit: 'kg', price: 140 }],
    recipients: [{ entity_id: buyer.id, role: 'to' }, { entity_id: carrier.id, role: 'cc' }],
    send_to_self: false } });
  const chit = sent.b.chit_id;
  ok(sent.status === 200 && chit, 'one order, three participants', 'status ' + sent.status);

  const det = await P.j('/api/chits/' + chit, { token: supplier.token });
  const LINE = (det.b.live_set || [])[0].line_id;
  ok(!!LINE, 'the rice line exists on the order');

  // ── an actor on each side ────────────────────────────────────────────────────────────────────────────────
  const sAct = await actor(supplier, 'SupplierHand');
  const bAct = await actor(buyer,    'BuyerHand');
  ok(sAct.token && bAct.token, 'an actor signed in on each side', sAct.name + ' · ' + bAct.name);

  /* ⚠️ ASSIGNMENT IS PER COPY AND PRIVATE. Each side assigns the line on ITS OWN copy — the supplier cannot put
     the buyer's co-assist on anything, and neither can see the other's roster. That is also what makes the actor
     message scope testable: each actor is scoped by their own entity's assignments. */
  await P.j('/api/chits/' + chit + '/assign-lines', { method: 'POST', token: supplier.token,
    body: { edits: [{ line_id: LINE, assignee_actor_id: sAct.id, assignee_name: sAct.name, due_date: '2026-08-26' }] } });
  await P.j('/api/chits/' + chit + '/assign-lines', { method: 'POST', token: buyer.token,
    body: { edits: [{ line_id: LINE, assignee_actor_id: bAct.id, assignee_name: bAct.name, due_date: '2026-08-26' }] } });

  // ── the conversation ─────────────────────────────────────────────────────────────────────────────────────
  const say = (who, text) => P.j('/api/chits/' + chit + '/messages', { method: 'POST', token: who.token,
    body: { message_text: text, thread_type: 'external', line_id: LINE } });

  const seq = [
    [buyer,   'Can you deliver Wednesday instead of Tuesday?'],
    [sAct,    'Wednesday works — lorry loads 6am, arrives by noon.'],
    [carrier, 'We can collect Tuesday night and hold overnight.'],
    [bAct,    'Our gate shuts at 7pm — please arrive before that.'],
    [supplier,'Agreed: collect Tuesday night, deliver Wednesday noon.'],
  ];
  for (const [who, text] of seq) {
    const r = await say(who, text);
    ok(r.status === 200, 'posted: ' + who.name + ' — "' + text.slice(0, 34) + '…"', 'status ' + r.status);
  }

  /* ⚠️ THE ONE THAT MUST REACH NOBODY. An internal note on a THREE-party chit is the strongest test of the
     audience rule: it has two ways to leak, not one. */
  const secret = 'margin is thin here — do not offer any discount';
  await P.j('/api/chits/' + chit + '/messages', { method: 'POST', token: supplier.token,
    body: { message_text: secret, thread_type: 'internal', line_id: LINE } });

  // ── what each side can see ───────────────────────────────────────────────────────────────────────────────
  const inbox = async (who, q) => {
    const r = await P.j('/api/folders/messages?all=1' + (q || ''), { token: who.token });
    return ((r.b && r.b.messages) || []).map((m) => m.message_text);
  };
  const thread = async (who, type) => {
    const r = await P.j('/api/chits/' + chit + '/messages?thread_type=' + type + '&line_id=' + LINE, { token: who.token });
    const b = r.b; return ((b && (b.messages || b.items || (Array.isArray(b) ? b : []))) || []).map((m) => m.message_text);
  };

  const sX = await thread(supplier, 'external'), bX = await thread(buyer, 'external'), cX = await thread(carrier, 'external');
  ok(sX.length === 5 && bX.length === 5 && cX.length === 5,
    '⭐ ALL FIVE messages reached ALL THREE parties', 'supplier ' + sX.length + ' · buyer ' + bX.length + ' · carrier ' + cX.length);
  ok(cX.some((t) => /gate shuts/.test(t)),
    'the CARRIER sees what the buyer\'s co-assist said — a CC is a full participant, not a bystander');
  ok(bX.some((t) => /lorry loads 6am/.test(t)),
    'and the buyer sees what the supplier\'s co-assist said');

  const sI = await thread(supplier, 'internal'), bI = await thread(buyer, 'internal'), cI = await thread(carrier, 'internal');
  ok(sI.some((t) => t === secret), 'the supplier keeps their own internal note');
  /* ⭐⭐ THE HEADLINE. Two other parties, two chances to leak, checked in BOTH threads for each. */
  ok(!bI.concat(bX).some((t) => /margin is thin/.test(t)), '⭐⭐ the BUYER never sees the internal note, in either thread');
  ok(!cI.concat(cX).some((t) => /margin is thin/.test(t)), '⭐⭐ the CARRIER never sees it either');

  // ── the actors ───────────────────────────────────────────────────────────────────────────────────────────
  const sa = await inbox(sAct), ba = await inbox(bAct);
  ok(sa.length > 0, 'the supplier\'s co-assist sees the conversation on the line they hold', sa.length + ' message(s)');
  ok(ba.length > 0, 'the buyer\'s co-assist sees it on their own copy', ba.length + ' message(s)');
  ok(!sa.some((t) => /margin is thin/.test(t)),
    '⚠️ and an INTERNAL note does not reach an actor through this inbox either — it lists external only');

  /* An actor holding NOTHING on this chit must see none of it, even inside the same business. */
  const sNone = await actor(supplier, 'IdleHand');
  const idle = await inbox(sNone);
  ok(idle.length === 0, '⭐ a co-assist with no line on this order sees none of its conversation', idle.length + ' message(s)');

  let p = 0, f = 0;
  console.log('');
  T.forEach((t) => { if (t.ok) { p++; console.log('  ✓ ' + t.m + (t.d ? '  ' + t.d : '')); }
                     else { f++; console.log('  ✗ ' + t.m + (t.d ? '  → ' + t.d : '')); } });
  console.log('\n== RESULT ==  PASS ' + p + '  ·  FAIL ' + f);
  console.log('\nchit: ' + chit + '\nline: ' + LINE);
  process.exit(f ? 1 : 0);
})().catch((e) => { console.log('ERR', e.message); process.exit(1); });
