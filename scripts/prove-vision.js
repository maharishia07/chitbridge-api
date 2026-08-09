#!/usr/bin/env node
'use strict';
/**
 * prove-vision.js — PROVE the multimodal branch against the LIVE API and a REAL model (b127).
 *
 * ⚠️ THIS ONE COSTS MONEY. Every image call is a real vision call on the shared Anthropic key. It is deliberately
 * kept to two small images on the cheap model — but it is not free, unlike the channel proofs. Do not loop it.
 *
 * It covers the spec's regression cases that do NOT require a human to look at a photograph:
 *   1 · text skills unchanged        — the live text path still works after the engine change
 *   4 · nothing readable             — an unreadable image returns an EMPTY list, never invented rows
 *   6 · caps enforced                — >4 images and an oversize payload are refused, not silently billed
 *
 * ⚠️ WHAT IT CANNOT COVER: cases 2, 3 and 5 need a real photograph — a legible label, a five-row price list, and
 * a label carrying an injection string. Those are Athi's live run (capability review-gate), and no amount of
 * scripting substitutes for a person holding up a real picture.
 *
 * Run:  node scripts/prove-vision.js
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

const API = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { console.log('  \x1b[32mok\x1b[0m  ' + n); pass++; } else { console.log('  \x1b[31mXX\x1b[0m  ' + n + (x ? ' — ' + x : '')); fail++; } };

async function j(p, o = {}) {
  const r = await fetch(API + p, { method: o.method || 'GET',
    headers: Object.assign({ 'Content-Type': 'application/json' }, o.token ? { Authorization: 'Bearer ' + o.token } : {}),
    body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  let b = null; try { b = await r.json(); } catch (_) {}
  return { status: r.status, b };
}
async function login(email, name) {
  await j('/api/entities/register', { method: 'POST', body: { email, display_name: name } });
  const v = await j('/api/entities/verify', { method: 'POST', body: { email, otp: '123456' } });
  return (v.b && (v.b.token || (v.b.entity && v.b.entity.token))) || null;
}

/** A 1×1 transparent PNG — legitimately an image, and legitimately unreadable. Spec case 4. */
const BLANK_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

(async () => {
  const A = await login('beta@test-cb.com', 'Beta Fresh');
  if (!A) { console.log('\n  could not sign in\n'); process.exitCode = 2; return; }

  console.log('\nvision · ⚠️ case 1 — the TEXT path still works after the engine change');
  /**
   * The engine is locked; the whole licence for editing it was that nothing existing moves. This asserts that on
   * the LIVE server, not just in a unit test with a stubbed fetch.
   */
  const capRes = await j('/api/capture/simulate', { method: 'POST', token: A, body: {
    channel: 'web', sender_ref: 'proof', raw_text: 'need 2 boxes of bolts and 5 m cable by friday' } });
  const st = await j('/api/capture/' + capRes.b.id + '/structure', { method: 'POST', token: A, body: {} });
  const lines = (st.b && st.b.structured && st.b.structured.line_items) || [];
  ok('★★ a text message still structures into line items', st.status === 200 && lines.length >= 2,
     'status ' + st.status + ' lines ' + lines.length);
  ok('★ …and it read what was actually written', JSON.stringify(lines).toLowerCase().includes('bolt'));
  await j('/api/capture/' + capRes.b.id + '/dismiss', { method: 'POST', token: A, body: {} });

  console.log('\nvision · ⚠️ caps are refusals, not silent bills (case 6)');
  const many = Array.from({ length: 5 }, () => ({ mime: 'image/png', b64: BLANK_PNG }));
  const tooMany = await j('/api/catalogue/photo-extract', { method: 'POST', token: A, body: { images: many } });
  ok('★★ more than 4 images is REFUSED before any spend', tooMany.status === 400 && /At most 4/.test(tooMany.b.message || ''),
     tooMany.status + ': ' + (tooMany.b && tooMany.b.message));
  const huge = await j('/api/catalogue/photo-extract', { method: 'POST', token: A, body: { images: [{ mime: 'image/png', b64: 'A'.repeat(1500000) }] } });
  ok('★★ an oversize image is REFUSED — a count cap is not a spend cap', huge.status === 413, 'status ' + huge.status);
  const notImage = await j('/api/catalogue/photo-extract', { method: 'POST', token: A, body: { images: [{ mime: 'application/pdf', b64: 'x' }] } });
  ok('★ a non-image is refused rather than sent', notImage.status === 400);

  console.log('\nvision · ⚠️ case 4 — nothing readable must produce NOTHING  \x1b[33m(this call costs)\x1b[0m');
  /**
   * The dangerous failure for a vision feature is not silence — it is invention. A model that answers a blank
   * image with a plausible product and a plausible price has produced a fabricated number that looks exactly
   * like evidence, and a human confirming a screenful of them will not catch it.
   */
  const blank = await j('/api/catalogue/photo-extract', { method: 'POST', token: A, body: { images: [{ mime: 'image/png', b64: BLANK_PNG }] } });
  if (blank.status === 503) {
    console.log('  \x1b[33m--\x1b[0m  AI not connected on this server (503) — case 4 not run');
  } else {
    ok('★★ the multimodal call was ACCEPTED by the model', blank.status === 200, blank.status + ': ' + JSON.stringify(blank.b).slice(0, 160));
    const items = (blank.b && blank.b.data && blank.b.data.items) || [];
    ok('★★ an unreadable image invents NOTHING', Array.isArray(items) && items.length === 0, 'got ' + JSON.stringify(items).slice(0, 160));
    ok('★ it still comes back gated as a proposal', blank.b && blank.b.gate === 'confirm', 'gate=' + (blank.b && blank.b.gate));
    if (blank.b && blank.b.usage) console.log('  \x1b[36m--\x1b[0m  cost of that call: $' + blank.b.usage.est_cost_usd);
  }

  console.log('\n  ' + (fail ? '\x1b[31m' + fail + ' FAILED\x1b[0m' : '\x1b[32mall passed\x1b[0m') + '  (' + pass + ' checks)');
  console.log('  \x1b[33m⚠️\x1b[0m  Cases 2, 3 and 5 (a legible label · a 5-row price list · an injection string written');
  console.log('     INTO a photo) need a real photograph and are ATHI\'S LIVE RUN. Nothing here substitutes.\n');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('\nprove-vision crashed:', e && e.message, '\n'); process.exitCode = 1; });
