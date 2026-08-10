#!/usr/bin/env node
'use strict';
/**
 * prove-autoraise.js — a message becomes a chit with NOBODY PRESENT (b131).
 *
 * ⚠️ THE POINT OF THIS FILE IS THAT NOTHING IN IT PRESSES A BUTTON. Every other proof drives the pipeline by
 * calling /structure and /raise. Here the ONLY thing that happens is a signed webhook delivery, and then we watch.
 * If a chit appears, it appeared on its own.
 *
 * The claims worth failing on:
 *   · OFF by default — an existing line keeps waiting for a person
 *   · ON — the chit appears with no call but the webhook, and it is an INQUIRY in the TASK list
 *   · it still carries provenance and the original message, exactly as the human path does
 *   · a redelivery does NOT mint a second chit
 *   · an UNVERIFIED line raises nothing however the flag is set
 *   · a message with no order in it is LEFT IN INTAKE, not turned into an empty chit
 *
 * RUN:  node scripts/prove-autoraise.js
 */
const crypto = require('crypto');
/* ⚠️ ONE HARNESS (scripts/_proof.js): env loading, the API base, sign-in, and a j() that RETRIES a platform
   blip (502/503/504, socket errors) but never a real answer. A platform that never replies aborts as
   "could not test" (exit 2), never as a failed check (exit 1) — conflating those turned a Railway 502 into an
   overnight open defect on 2026-08-09. This was 9 copies of j() and 31 copies of the base URL. */
const { API, j, signIn } = require('./_proof');


const SECRET = process.env.WHATSAPP_APP_SECRET;
const ADMIN = process.env.CB_ADMIN_KEY;
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + m); } else { fail++; console.log('  \x1b[31m✗ ' + m + '\x1b[0m' + (x ? '\n      ' + x : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


(async () => {
  console.log('\n  prove-autoraise — nothing in this file presses a button (b131)\n');
  if (!SECRET || !ADMIN) { console.log('  Missing WHATSAPP_APP_SECRET / CB_ADMIN_KEY.\n'); process.exitCode = 2; return; }

  const unsigned = await j('/api/capture/webhook/whatsapp', { method: 'POST', body: '{}', headers: { 'X-Hub-Signature-256': 'sha256=deadbeef' } });
  if (unsigned.status !== 401) { console.log('  \x1b[31mABORT\x1b[0m — unsigned webhook not rejected (' + unsigned.status + ').\n'); process.exitCode = 2; return; }

  const email = 'autoraise-proof@test-cb.com';
  await j('/api/entities/register', { method: 'POST', body: { email, display_name: 'Autoraise Proof Co' } });
  const v = await j('/api/entities/verify', { method: 'POST', body: { email, otp: process.env.DEV_OTP || '123456' } });
  const tok = (v.b && (v.b.token || (v.b.entity && v.b.entity.token))) || null;
  if (!tok) { console.log('  could not sign in\n'); process.exitCode = 1; return; }

    /**
   * ⚠️ EVERY RUN GETS ITS OWN LINE AND ITS OWN WORDS.
   *
   * The first version reused one number and one message text. A SECOND run therefore started with the binding
   * already approved — so the 'an unverified line raises nothing' case could never fail — and matched the
   * PREVIOUS run's chit by text, moving on before this run's had even landed. Three red ticks that were about
   * the script and not the code.
   *
   * That is the same class of lie as a false green, and harder to catch: a failure looks like diligence. RUN goes
   * into the number, the message and the provider id, so a run can only ever see its own work.
   */
  const RUN = String(process.pid).slice(-5).padStart(5, '0');
  const LINE = '+9190' + RUN + '00', CUST = '+919000002222';
  const bindFor = async (addr) => {
    const list = await j('/api/channels', { token: tok });
    const wa = (list.b.channels || []).find((c) => c.key === 'whatsapp') || { bindings: [] };
    return (wa.bindings || []).find((b) => b.address === addr) || null;
  };
  let bind = await bindFor(LINE);
  if (!bind) { const made = await j('/api/channels', { method: 'POST', token: tok, body: { channel: 'whatsapp', address: LINE, label: 'auto line' } }); bind = made.b; }

  /* ⚠️ PRECONDITION. Pre-b131 the toggle 503s and every "it did not auto-raise" check below would pass for the
     wrong reason — an OFF that is really an ABSENT. Abort rather than print a green wall. */
  const probe = await j('/api/channels/' + bind.id + '/auto-raise', { method: 'POST', token: tok, body: { on: false } });
  if (probe.status === 503) { console.log('\n  \x1b[31mABORT\x1b[0m — b131 is not applied. Run migrations/b131_auto_raise.sql.\n'); process.exitCode = 2; return; }
  ok(probe.status === 200, 'the auto-raise switch answers (b131 applied)', JSON.stringify(probe.b).slice(0, 140));
  console.log('  precondition: b131 is applied — "it did not auto-raise" means OFF, not ABSENT\n');

  const deliver = async (text, tag, line) => {
    const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: {
      metadata: { display_phone_number: line || LINE, phone_number_id: '000' },
      contacts: [{ wa_id: CUST.replace(/^\+/, ''), profile: { name: 'Auto sender' } }],
      messages: [{ from: CUST.replace(/^\+/, ''), id: 'wamid.AUTO.' + tag + '.' + process.pid, type: 'text', text: { body: text } }],
    } }] }] });
    return j('/api/capture/webhook/whatsapp', { method: 'POST', body: payload,
      headers: { 'X-Hub-Signature-256': 'sha256=' + crypto.createHmac('sha256', SECRET).update(payload).digest('hex') } });
  };
  const inbox = async () => ((await j('/api/chits/inbox?limit=50', { token: tok })).b || {}).chits || [];
  const pending = async () => ((await j('/api/capture/pending', { token: tok })).b || {}).captures || [];
  // Watch, don't drive. Returns the matching chit or null after the window.
  const waitForChit = async (needle, secs) => {
    for (let i = 0; i < (secs || 45); i++) {
      const hit = (await inbox()).find((c) => new RegExp(needle, 'i').test((c.manual_subject || c.auto_subject || '') + JSON.stringify(c.summary_json || {})));
      if (hit) return hit;
      await sleep(1000);
    }
    return null;
  };

  // ── 1. UNVERIFIED + flag ON → nothing at all. The switch is not the permission.
  await j('/api/channels/' + bind.id + '/auto-raise', { method: 'POST', token: tok, body: { on: true } });
  const unver = await deliver('20 bags of cement UNVER-' + RUN, 'UNVER');
  ok(unver.status === 200 && !(unver.b && unver.b.captured), '★★★ an UNVERIFIED line raises nothing, however the flag is set',
    JSON.stringify(unver.b));

  await j('/api/channels/' + bind.id + '/approve', { method: 'POST', headers: { 'x-cb-admin-key': ADMIN }, body: {} });

  // ── 2. OFF → it waits for a person, exactly as before.
  await j('/api/channels/' + bind.id + '/auto-raise', { method: 'POST', token: tok, body: { on: false } });
  const offRes = await deliver('12 bags of cement OFF-' + RUN + ' please', 'OFF');
  ok(offRes.b && offRes.b.captured >= 1, 'with the switch OFF the message is still captured');
  await sleep(20000);                                   // generous: if it were going to raise, it would have by now
  ok(!(await waitForChit('OFF-' + RUN, 2)), '★★★ OFF means OFF — no chit appeared without a person',
    'a chit was raised while the switch was off');
  ok((await pending()).some((c) => new RegExp('OFF-' + RUN).test(c.raw_text || '')), '★ and it is waiting in Intake, as it always was');

  // ── 3. ON → the chit appears, and NOTHING here asked for it.
  await j('/api/channels/' + bind.id + '/auto-raise', { method: 'POST', token: tok, body: { on: true } });
  const onRes = await deliver('8 bags of cement and 15 kg nails ON-' + RUN + ' by friday', 'ON');
  ok(onRes.b && onRes.b.captured >= 1, 'the message was captured');
  const chit = await waitForChit('ON-' + RUN, 60);
  ok(!!chit, '★★★ A CHIT APPEARED WITH NOBODY PRESENT — the only call made was the webhook',
    'no chit within 60s');
  if (chit) {
    const sum = chit.summary_json || {};
    ok(chit.purpose === 'inquiry', '★★ it is an inquiry — hands-free does not mean an obligation', 'purpose=' + chit.purpose);
    ok(sum.via && sum.via.channel === 'whatsapp' && sum.via.sender_verified === false,
      '★★ it carries the same provenance the human path produces', JSON.stringify(sum.via).slice(0, 160));
    ok(sum.via && new RegExp('ON-' + RUN).test(sum.via.raw_excerpt || ''), '★ their own words are on it');
    ok(sum.copy_policy && sum.copy_policy.suppressed && sum.copy_policy.suppressed.indexOf('sent') >= 0,
      '★★★ Task only — no Order copy, unattended or not', JSON.stringify(sum.copy_policy));
    const sent = ((await j('/api/chits/sent?limit=50', { token: tok })).b || {}).chits || [];
    ok(!sent.some((c) => c.chit_id === chit.chit_id), '★★★ and it is NOT in the Order list');

    const full = await j('/api/chits/' + chit.chit_id, { token: tok });
    const atts = (full.b && (full.b.attachments || (full.b.detail || {}).attachments)) || [];
    ok(atts.some((a) => /original-message/.test(a.name || '')),
      '★★ the ORIGINAL message was attached unattended — evidence is not a property of which button was pressed',
      JSON.stringify(atts.map((a) => a.name)));
    ok(!(await pending()).some((c) => new RegExp('ON-' + RUN).test(c.raw_text || '')), '★ and it left the intake queue');
  }

  // ── 4. A REDELIVERY must not mint a second chit. Meta retries; a retry is not a second order.
  const before = (await inbox()).length;
  await deliver('8 bags of cement and 15 kg nails ON-' + RUN + ' by friday', 'ON');   // same provider_msg_id
  await sleep(20000);
  ok((await inbox()).length === before, '★★★ a redelivery raised NOTHING — one message, one chit',
    'inbox went ' + before + ' → ' + (await inbox()).length);

  /**
   * ── 5. A message with no order in it is LEFT IN INTAKE. This was the open decision: a chit with no lines looks
   * handled, sits in the Task list claiming to be an order for nothing, and buries the real request.
   *
   * ⚠️ THIS ALSO TESTS THE CO-ASSIST'S JUDGEMENT, not just the plumbing. If a chit appears for "ok thanks", the
   * reading step invented an order out of a greeting — which is worth failing on in its own right.
   */
  await deliver('ok thanks NOISE-' + RUN, 'NOISE');
  await sleep(30000);
  ok(!(await waitForChit('NOISE-' + RUN, 3)), '★★★ a message with no order in it did NOT become a chit');
  ok((await pending()).some((c) => new RegExp('NOISE-' + RUN).test(c.raw_text || '')), '★★ it is waiting in Intake for a person');

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  console.log('  \x1b[33m⚠️\x1b[0m  transport is stood in for — that Meta carried it needs a WhatsApp Business account.\n');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('\nprove-autoraise crashed:', e && e.message, '\n'); process.exitCode = 1; });
