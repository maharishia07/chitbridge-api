#!/usr/bin/env node
'use strict';
/**
 * prove-whatsapp-live.js — the REAL loop, on a REAL phone. The one thing no stub can do.
 *
 * ⚠️ WHY THERE IS NO STUB FOR THIS. A stub can prove the shape of the request we would send Meta — and
 * tests/whatsapp-out.test.js already does. What it cannot do is put a message on your phone, because only a
 * WhatsApp Business sender can, and being one is the whole thing we are missing. So this script does not simulate:
 * it uses a real sender and reports honestly at each step which side failed.
 *
 * ── WHAT YOU NEED (free, ~20 minutes, no BSP) ───────────────────────────────────────────────────────────────────
 * Meta's Cloud API gives every new app a TEST business number and lets you add a handful of test recipients, with
 * free messages. That is exactly this situation. From developers.facebook.com:
 *   1. Create an app → add the WhatsApp product
 *   2. Copy the TEST number's `phone_number_id` and the temporary access token
 *   3. Add YOUR OWN WhatsApp number as a test recipient (Meta sends you a code)
 * ⚠️ Meta changes these details; treat the above as a map, not a manual, and follow what their console says.
 *
 * Then in .env.proof(.txt):
 *   WHATSAPP_TOKEN=EAAG...            ← the access token
 *   WA_PHONE_NUMBER_ID=123456789      ← the TEST number's id (NOT the number itself)
 *   WA_TEST_TO=+9198xxxxxxx           ← YOUR number, added as a test recipient
 *
 *   node scripts/prove-whatsapp-live.js
 *
 * ⚠️ THIS SENDS A REAL MESSAGE. On a Cloud API test number it is free; on a production number it is billed.
 */
const fs = require('fs');
const path = require('path');

(function loadEnvFile() {
  for (const name of ['.env.proof', '.env.proof.txt', '.env']) {
    const f = path.join(__dirname, '..', name);
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const v = m[2].trim().replace(/^['"]|['"]$/g, '').trim();
      if (!process.env[m[1]] && v) process.env[m[1]] = v;
    }
  }
})();

const GRAPH = process.env.WHATSAPP_GRAPH_BASE || 'https://graph.facebook.com/v21.0';
const TOKEN = process.env.WHATSAPP_TOKEN;
const PNID = process.env.WA_PHONE_NUMBER_ID;
const TO = process.env.WA_TEST_TO;
const API = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';

const need = [];
if (!TOKEN) need.push('WHATSAPP_TOKEN');
if (!PNID) need.push('WA_PHONE_NUMBER_ID');
if (!TO) need.push('WA_TEST_TO');

(async () => {
  if (need.length) {
    console.log('\n  Missing: ' + need.join(', '));
    console.log('  Add them to ' + path.join(__dirname, '..', '.env.proof.txt') + ' — see the header of this file.\n');
    process.exitCode = 2; return;
  }

  console.log('\n── STEP 1 · are YOUR credentials good? (talks to Meta directly, not through our code) ──');
  /**
   * ⚠️ CREDENTIALS FIRST, OUR CODE SECOND. If this is conflated and the message does not arrive, there is no way
   * to tell a bad token from a bug in the pipeline — and that ambiguity is what turns a ten-minute check into an
   * afternoon. `hello_world` is Meta's own pre-approved template, so nothing of ours is involved yet.
   */
  const r1 = await fetch(GRAPH + '/' + encodeURIComponent(PNID) + '/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: String(TO).replace(/^\+/, ''), type: 'template',
                           template: { name: 'hello_world', language: { code: 'en_US' } } }),
  });
  let j1 = null; try { j1 = await r1.json(); } catch (_) {}
  if (!r1.ok) {
    console.log('  \x1b[31mXX\x1b[0m  Meta refused: ' + r1.status + ' ' + JSON.stringify(j1 && j1.error ? j1.error.message : j1));
    console.log('\n  That is your ACCOUNT, not our code — nothing of ours ran. Common causes:');
    console.log('   · the access token expired (the temporary one lasts ~24h — make a System User token to stop that)');
    console.log('   · WA_TEST_TO is not added as a test recipient on that app');
    console.log('   · WA_PHONE_NUMBER_ID is the phone NUMBER instead of its id\n');
    process.exitCode = 1; return;
  }
  console.log('  \x1b[32mok\x1b[0m  Meta accepted it — check your phone. Message id: ' + ((j1.messages || [{}])[0].id || '?'));
  console.log('      \x1b[36m→ if nothing arrives, the problem is Meta-side (recipient not verified), still not our code\x1b[0m');

  console.log('\n── STEP 2 · now reply to that message on your phone, then run:  node scripts/prove-whatsapp-live.js --inbound ──');
  if (!process.argv.includes('--inbound')) {
    console.log('\n  Stopping here so you can reply. Step 2 checks the message reached YOUR intake inbox,');
    console.log('  which proves the webhook, the signature check and the number→entity map on real traffic.\n');
    return;
  }

  console.log('\n── STEP 2 · did your reply reach the intake inbox? ──');
  async function j(p, o = {}) {
    const r = await fetch(API + p, { method: o.method || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' }, o.token ? { Authorization: 'Bearer ' + o.token } : {}),
      body: o.body === undefined ? undefined : JSON.stringify(o.body) });
    let b = null; try { b = await r.json(); } catch (_) {}
    return { status: r.status, b };
  }
  const email = process.env.WA_TEST_ENTITY_EMAIL || 'beta@test-cb.com';
  await j('/api/entities/register', { method: 'POST', body: { email, display_name: 'Beta Fresh' } });
  const v = await j('/api/entities/verify', { method: 'POST', body: { email, otp: process.env.DEV_OTP || '123456' } });
  const tok = (v.b && (v.b.token || (v.b.entity && v.b.entity.token))) || null;
  const caps = (await j('/api/capture/pending', { token: tok })).b.captures || [];
  const mine = caps.filter((c) => c.channel === 'whatsapp');
  if (!mine.length) {
    console.log('  \x1b[31mXX\x1b[0m  nothing from WhatsApp in the intake inbox.');
    console.log('\n  Work down these in order — each rules out one layer:');
    console.log('   1. is the webhook URL set in Meta to  ' + API + '/api/capture/webhook/whatsapp  ?');
    console.log('   2. is WHATSAPP_VERIFY_TOKEN on Railway the same string you gave Meta?');
    console.log('   3. is WHATSAPP_APP_SECRET on Railway the app secret from the SAME Meta app?');
    console.log('   4. is the TEST number bound in Settings → Channels, and APPROVED (verified, not declared)?');
    console.log('      ⚠️ a declared binding receives nothing — that is deliberate, and it looks exactly like this.\n');
    process.exitCode = 1; return;
  }
  console.log('  \x1b[32mok\x1b[0m  ' + mine.length + ' WhatsApp capture(s) in the inbox. Newest: "' + String(mine[0].raw_text || '').slice(0, 60) + '"');
  console.log('      from ' + mine[0].sender_ref + ' → to our line ' + (mine[0].to_ref || '(to_ref missing!)'));
  console.log('\n  \x1b[32mBOTH DIRECTIONS PROVEN ON REAL TRAFFIC.\x1b[0m Outbound reached your phone; inbound reached your inbox.');
  console.log('  Next: open Intake → ✨ Structure it → Make this a chit, and change its status to see the reply come back.\n');
})().catch((e) => { console.error('\nprove-whatsapp-live crashed:', e && e.message, '\n'); process.exitCode = 1; });
