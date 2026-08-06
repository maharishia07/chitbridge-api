#!/usr/bin/env node
/**
 * prove-network-cap.js — a network provisions a node, and the node cannot open itself.
 *
 * Athi, 2026-08-06: *"even a private catalogue can be made public. How do we protect a private catalogue — say it
 * is done from the networking side, the entity should be private not public. We have to confirm how it works."*
 * Then: *"can we create a network model and see how it behaves, the private catalogue?"*
 *
 * This provisions a real entity through the GOVERNED MINT with an operator cap, then tries every way there is to
 * open it — from its own profile, and by reading its storefront as the world does.
 *
 *   node scripts/prove-network-cap.js
 *
 * ⚠️ The governed mint is PLATFORM-SCOPE ONLY (`owner_scope === 'platform'`), so this needs a platform token. With
 * an ordinary account it will say so and fall back to proving the CAP LOGIC alone, which is still the load-bearing
 * half. It never pretends the provisioning half ran when it did not.
 */
'use strict';

const API = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
const OTP = process.env.DEV_OTP || '123456';
const PLATFORM_TOKEN = process.env.CB_PLATFORM_TOKEN || '';

let pass = 0, fail = 0, skip = 0;
const ok   = (c, cond, d) => { if (cond) { console.log('   ✓ ' + c + (d ? '  ' + d : '')); pass++; } else { console.log('   ✗ ' + c + (d ? '  ' + d : '')); fail++; } };
const note = (s) => console.log('     ' + s);
const skipped = (c, why) => { console.log('   – ' + c + '   (' + why + ')'); skip++; };
const step = (n, s) => console.log('\n── ' + n + ' · ' + s + ' ' + '─'.repeat(Math.max(0, 72 - s.length)));

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(API + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}
async function signIn(email, name) {
  await api('/api/entities/register', { method: 'POST', body: { email, display_name: name } });
  const v = await api('/api/entities/verify', { method: 'POST', body: { email, otp: OTP } });
  return (v.json || {}).token || null;
}

(async () => {
  console.log('\n╔' + '═'.repeat(74) + '╗');
  console.log('║  NETWORK CAP — a provisioned node cannot open its own catalogue          ║');
  console.log('╚' + '═'.repeat(74) + '╝');
  console.log('  ' + API);

  // ── 1 · the rule itself, with no network involved ───────────────────────────────────────────────────────────
  step(1, 'the RULE — cap vs choice');
  const V = require('../lib/visibility-cap');
  const capped = V.capOf({ plan: 'free', paramsOverride: { caps: { catalogue_visibility: 'private' } } });
  const free   = V.capOf({ plan: 'free', paramsOverride: {} });

  ok('a capped node is refused when it asks for public', V.check('public', capped).status === 403,
    V.check('public', capped).message);
  ok('…and the refusal names WHO capped it', capped.by === 'operator');
  ok('a capped node may still go private — a cap bounds how OPEN, never how closed', V.check('private', capped).ok);
  ok('★ a flag set BEFORE the cap still reads as private', V.effective('public', capped) === 'private',
    'the cap wins at READ time, not only at write');
  ok('an ordinary shop is unaffected', V.check('public', free).ok === true);
  ok('…and says so honestly when nothing is declared', free.enforced === false, free.reason);

  // ── 2 · the governance resolver accepts the cap as a KNOWN key ──────────────────────────────────────────────
  step(2, 'the CONSTITUTION — a cap is governance, not an unknown key');
  const { resolve } = require('../governance/resolver');
  const c = { version: 'v1', defaults: { currency_code: 'INR', exposure_default: 'private' },
              allowed: { exposure_tiers: ['private', 'public'], languages: ['en'] } };
  const r1 = resolve(c, { caps: { catalogue_visibility: 'private' } });
  ok('a private cap resolves clean, with no spurious exception', r1.exceptions.length === 0,
    'effective.cap = ' + r1.effective.cap_catalogue_visibility);
  let widened = false;
  try { resolve(c, { caps: { catalogue_visibility: 'public' } }); widened = true; } catch (_) {}
  ok('★ a cap may only TIGHTEN — one that would widen is refused', !widened,
    'a cap that can loosen what the constitution permits is not a cap');

  // ── 3 · a REAL provisioned node ─────────────────────────────────────────────────────────────────────────────
  step(3, 'the NETWORK — provision a node with the cap, then try to open it');
  const stamp = Date.now().toString().slice(-6);
  const NODE = { email: `netnode-${stamp}@test-cb.com`, name: `Net Node ${stamp}` };

  let provisioned = false;
  if (PLATFORM_TOKEN) {
    const mint = await api('/api/governance/entities', { method: 'POST', token: PLATFORM_TOKEN, body: {
      display_name: NODE.name, email: NODE.email, plan: 'free',
      params_override: { caps: { catalogue_visibility: 'private' } } } });
    provisioned = mint.status === 200 || mint.status === 201;
    ok('node provisioned through the governed mint', provisioned, JSON.stringify(mint.json).slice(0, 140));
  } else {
    skipped('node provisioned through the governed mint', 'no CB_PLATFORM_TOKEN — the mint is platform-scope only');
    note('Set CB_PLATFORM_TOKEN to a platform-scope token to run this half.');
  }

  if (provisioned) {
    const tok = await signIn(NODE.email, NODE.name);
    const me = await api('/api/entities/me', { token: tok });
    const ent = (me.json && (me.json.entity || me.json)) || {};
    ok('★ its own profile REPORTS the cap', ent.visibility_cap && ent.visibility_cap.max === 'private',
      JSON.stringify(ent.visibility_cap));
    ok('…and reports its EFFECTIVE visibility as private', ent.catalogue_visibility === 'private');

    const tryOpen = await api('/api/entities/profile', { method: 'PATCH', token: tok, body: { catalogue_visibility: 'public' } });
    ok('★ the node CANNOT open itself from its own profile', tryOpen.status === 403,
      (tryOpen.json && tryOpen.json.message) || String(tryOpen.status));

    const pub = await api('/api/catalogue/' + (ent.bridge_id || ''));
    ok('★ and the world sees nothing', pub.status === 404 || (pub.json && pub.json.available === false),
      (pub.json && pub.json.message) || String(pub.status));
  } else {
    skipped('the node cannot open itself', 'needs the provisioning half');
    skipped('the world sees nothing', 'needs the provisioning half');
  }

  console.log('\n' + '═'.repeat(76));
  console.log(`  ${pass} proved · ${fail} failed${skip ? ' · ' + skip + ' skipped (stated, not hidden)' : ''}`);
  console.log('═'.repeat(76) + '\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('\n  threw: ' + e.message + '\n'); process.exit(1); });
