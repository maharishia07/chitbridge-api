#!/usr/bin/env node
'use strict';
/**
 * send-test-message.js — put a message into YOUR intake inbox, so you can WATCH it become a chit in the app.
 *
 * Athi, 2026-08-09: *"how do i test the message given to that number becomes the chit, i wanted to see that"*.
 * The other scripts assert; this one just delivers, then gets out of the way so you can do the rest on screen.
 *
 * ── ⚠️ WHICH NUMBER IS WHICH ────────────────────────────────────────────────────────────────────────────────────
 * Two different numbers, and mixing them up is the commonest confusion here:
 *   --to    YOUR BUSINESS LINE  — the number a customer writes TO. This is what gets BOUND in Settings → Channels.
 *   --from  THE CUSTOMER        — who wrote in. If you want to see YOUR OWN phone as the sender, put it here.
 * Binding your personal number as the business line and then "sending from" it would be you messaging yourself,
 * which is not the shape a real order has.
 *
 * ── ⚠️ WHAT THIS IS AND IS NOT ──────────────────────────────────────────────────────────────────────────────────
 * It delivers a properly SIGNED, Meta-shaped payload to the real webhook on production. Everything after that
 * point is genuinely the product: the signature check, the number→entity map, the capture, the AI, the chit.
 * What is simulated is only the TRANSPORT — that Meta carried it. Without a WhatsApp Business account nothing can
 * carry a real message, and no script changes that.
 *
 * ── RUN ─────────────────────────────────────────────────────────────────────────────────────────────────────────
 *   node scripts/send-test-message.js "please send 2 boxes of bolts by friday"
 *   node scripts/send-test-message.js "..." --from=+919876543210 --to=+919000000001 --entity=beta@test-cb.com
 *
 * Defaults: --to a demo business line it binds and approves for you; --from a demo customer;
 *           --entity beta@test-cb.com (the test business you sign into).
 */
const crypto = require('crypto');
/* ⚠️ ONE HARNESS (scripts/_proof.js): env loading, the API base, sign-in, and a j() that RETRIES a platform
   blip (502/503/504, socket errors) but never a real answer. A platform that never replies aborts as
   "could not test" (exit 2), never as a failed check (exit 1) — conflating those turned a Railway 502 into an
   overnight open defect on 2026-08-09. This was 9 copies of j() and 31 copies of the base URL. */
const { API, j, signIn } = require('./_proof');


const WEB = process.env.CB_WEB || 'https://chitbridge-web.vercel.app';
const SECRET = process.env.WHATSAPP_APP_SECRET;
const ADMIN = process.env.CB_ADMIN_KEY;

const args = process.argv.slice(2);
const flag = (n, d) => { const a = args.find((x) => x.startsWith('--' + n + '=')); return a ? a.split('=').slice(1).join('=') : d; };
const MESSAGE = args.filter((a) => !a.startsWith('--')).join(' ')
  || 'Hi, please send 2 boxes of bolts and 5 metres of cable to the Ramnagar site by Friday. Thanks';
const TO = flag('to', '+919000000111');       // the business line (bound)
const FROM = flag('from', '+919000000222');   // the customer
const EMAIL = flag('entity', 'beta@test-cb.com');


(async () => {
  if (!SECRET || !ADMIN) {
    console.log('\n  Missing WHATSAPP_APP_SECRET / CB_ADMIN_KEY in .env.proof.txt — see prove-channels.js.\n');
    process.exitCode = 2; return;
  }
  console.log('\n  business line (bound) : ' + TO);
  console.log('  customer (sender)     : ' + FROM);
  console.log('  into entity           : ' + EMAIL);
  console.log('  message               : "' + MESSAGE + '"\n');

  await j('/api/entities/register', { method: 'POST', body: { email: EMAIL, display_name: 'Beta Fresh' } });
  const v = await j('/api/entities/verify', { method: 'POST', body: { email: EMAIL, otp: process.env.DEV_OTP || '123456' } });
  const tok = (v.b && (v.b.token || (v.b.entity && v.b.entity.token))) || null;
  if (!tok) { console.log('  could not sign in as ' + EMAIL + '\n'); process.exitCode = 1; return; }

  /* Bind + approve the business line if it is not already. ⚠️ A DECLARED binding receives nothing — that is
     deliberate, and it is exactly what an unexplained "my message never arrived" looks like. */
  const list = await j('/api/channels', { token: tok });
  const wa = (list.b.channels || []).find((c) => c.key === 'whatsapp') || { bindings: [] };
  let bind = (wa.bindings || []).find((b) => b.address === TO.replace(/[^\d]/g, '').replace(/^/, '+'));
  if (!bind) {
    const made = await j('/api/channels', { method: 'POST', token: tok, body: { channel: 'whatsapp', address: TO, label: 'test line' } });
    if (made.status === 409) { console.log('  ⚠️ ' + TO + ' is already bound to a DIFFERENT business — pick another --to\n'); process.exitCode = 1; return; }
    bind = made.b;
    console.log('  · bound ' + bind.address);
  }
  if (bind.status !== 'verified') {
    await j('/api/channels/' + bind.id + '/approve', { method: 'POST', headers: { 'x-cb-admin-key': ADMIN }, body: {} });
    console.log('  · approved it (a declared binding receives nothing, by design)');
  }

  const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: {
    metadata: { display_phone_number: TO, phone_number_id: '000' },
    contacts: [{ wa_id: FROM.replace(/^\+/, ''), profile: { name: 'Test customer' } }],
    messages: [{ from: FROM.replace(/^\+/, ''), id: 'wamid.MANUAL.' + Date.now(), type: 'text', text: { body: MESSAGE } }],
  } }] }] });
  const sig = 'sha256=' + crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  const hook = await j('/api/capture/webhook/whatsapp', { method: 'POST', body: payload, headers: { 'X-Hub-Signature-256': sig } });

  if (hook.status !== 200 || !(hook.b && hook.b.captured)) {
    console.log('\n  \x1b[31mnot delivered\x1b[0m — ' + hook.status + ' ' + JSON.stringify(hook.b));
    console.log('  If this says captured:0, the number is bound to nobody or the binding is not approved.\n');
    process.exitCode = 1; return;
  }

  console.log('\n  \x1b[32m✓ delivered — it is in the intake inbox now.\x1b[0m\n');
  console.log('  NOW WATCH IT BECOME A CHIT, on screen:');
  console.log('   1. open ' + WEB + '/app.html  and sign in as ' + EMAIL + ' (OTP 123456)');
  console.log('   2. left menu → 📨 Intake — your message is there, raw, from ' + FROM);
  console.log('   3. ✨ Structure it        — the co-assist reads it into line items (a proposal, not evidence)');
  console.log('   4. Make this a chit →     — Compose opens with the lines already in it');
  console.log('   5. walk Items → To → Details → Review, then Send chit');
  console.log('   6. 📤 Order — there it is, as a real chit\n');
  console.log('  \x1b[33m⚠️\x1b[0m  Everything from step 2 on is the real product. Only the TRANSPORT was simulated —');
  console.log('     that Meta carried it. Nothing can carry a real WhatsApp message without an account.\n');
})().catch((e) => { console.error('\nsend-test-message crashed:', e && e.message, '\n'); process.exitCode = 1; });
