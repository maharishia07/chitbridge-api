#!/usr/bin/env node
/**
 * prove-network-mint.js — the Build, walked end to end against a running API.
 *
 * Athi, 2026-08-07: *"start with build that mints, partner as invite-only… Athi is the root, then clothing is
 * athi.clothing and so on. Every member at whatever level will have the same naming convention."*
 *
 * `tests/network-build.test.js` proves the PLAN. This proves the SEAM — the part that has broken three times in a
 * week: built, tested, and not actually connected to anything. Specifically it insists on the four claims that
 * a passing unit suite cannot make:
 *
 *     1 · the store EXISTS and can LOG IN with the handle and the code the operator was handed
 *     2 · it is ON THE TREE — so `network` visibility resolves, which is the whole point of a network
 *     3 · it CANNOT PUBLISH ITSELF — the provisioning cap holds against the store's own profile screen
 *     4 · a second Build creates NOTHING
 *
 *   DEV_OTP=123456 node scripts/prove-network-mint.js
 *   CB_API=http://localhost:3000 node scripts/prove-network-mint.js
 *
 * Idempotent by design: the operator is a fixed test account and the build is a no-op the second time. To start
 * clean, change SUFFIX.
 */
'use strict';

const API = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
const OTP = process.env.DEV_OTP || '123456';
const SUFFIX = process.env.CB_SUFFIX || '1';          // bump for a fresh network
const ROOT_HANDLE = 'athitest' + SUFFIX;

let pass = 0, fail = 0;
const ok   = (c, cond, d) => { if (cond) { console.log('   ✓ ' + c + (d ? '  ' + d : '')); pass++; } else { console.log('   ✗ ' + c + (d ? '  ' + d : '')); fail++; } };
const note = (s) => console.log('     ' + s);
const step = (n, s) => console.log('\n── ' + n + ' · ' + s + ' ' + '─'.repeat(Math.max(0, 66 - s.length)));

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(API + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}
async function shop(key, name) {
  const email = `mint-${key}-${SUFFIX}@test-cb.com`;
  await api('/api/entities/register', { method: 'POST', body: { email, display_name: name } });
  const v = await api('/api/entities/verify', { method: 'POST', body: { email, otp: OTP } });
  const token = (v.json || {}).token;
  const me = await api('/api/entities/me', { token });
  const e = (me.json && (me.json.entity || me.json)) || {};
  return { key, name, email, token, bridge: e.bridge_id, id: e.identity_id };
}

const DESIGN = (rootKey) => ({
  nodes: [
    { key: rootKey, name: 'Athi Test Network', parent_key: null, root: true, owned: true, holds: [] },
    { key: 'n_cloth', name: 'Clothing',  parent_key: rootKey, owned: true, holds: ['catalogue', 'storefront'], exposure: 'public' },
    { key: 'n_wh',    name: 'Warehouse', parent_key: rootKey, owned: true, holds: ['catalogue', 'storefront'], exposure: 'protected' },
    { key: 'n_mens',  name: 'Mens',      parent_key: 'n_cloth', owned: true, holds: ['catalogue'] },
    { key: 'n_ptnr',  name: 'Ravi Timbers', parent_key: rootKey, owned: false, holds: ['catalogue'] },   // no ref yet
  ],
});

(async () => {
  console.log('\n╔' + '═'.repeat(70) + '╗');
  console.log('║  NETWORK BUILD — the design becomes real stores                      ║');
  console.log('╚' + '═'.repeat(70) + '╝');
  console.log('  ' + API + '   root: ' + ROOT_HANDLE);

  // ── 1 · an operator, and a partner who already exists ────────────────────────────────────────────────────
  step(1, 'the operator and one real outside business');
  const op = await shop('op', 'Athi Test Network');
  const partner = await shop('partner', 'Ravi Timbers ' + SUFFIX);
  ok('operator signed in', !!op.token, op.bridge || '');
  ok('partner business exists', !!partner.token, partner.bridge || '');
  if (!op.token) { console.log('\n   cannot continue without a token\n'); process.exit(1); }

  // Give the operator the root handle up front. The build would claim it too, but doing it here proves the build
  // works with an EXISTING handle — the ordinary case for anyone who already set a User ID.
  const setRoot = await api('/api/entities/profile', { method: 'PATCH', token: op.token, body: { user_id: ROOT_HANDLE } });
  ok('operator holds the root handle', setRoot.status === 200 || setRoot.status === 409, ROOT_HANDLE + '  (' + setRoot.status + ')');
  const partnerRef = 'ravitest' + SUFFIX;
  await api('/api/entities/profile', { method: 'PATCH', token: partner.token, body: { user_id: partnerRef } });

  // ── 2 · save the design ──────────────────────────────────────────────────────────────────────────────────
  step(2, 'save the design (nothing created yet)');
  const design = DESIGN('root_' + SUFFIX);
  const saved = await api('/api/network-design', { method: 'PUT', token: op.token, body: { draft: design } });
  ok('design saved', saved.status === 200);

  // ── 3 · DRY RUN ──────────────────────────────────────────────────────────────────────────────────────────
  step(3, 'dry run — what WOULD happen');
  const dry = await api('/api/network-design/build', { method: 'POST', token: op.token, body: { dry_run: true } });
  const d = dry.json || {};
  ok('dry run answered', dry.status === 200, JSON.stringify(d.counts || d.message || d));
  const handles = (d.create || []).map((c) => c.handle);
  ok('★★ handles are human readable and ALWAYS two levels — Mens sits under Clothing on the tree, not in the name',
    handles.includes(ROOT_HANDLE + '.clothing') && handles.includes(ROOT_HANDLE + '.mens')
    && !handles.some((h) => h.split('.').length > 2), handles.join('  '));
  ok('★ protected → network, no storefront → private',
    (d.create || []).find((c) => c.name === 'Warehouse')?.visibility === 'network'
    && (d.create || []).find((c) => c.name === 'Mens')?.visibility === 'private');
  ok('★★ a partner with no handle is NOT created — it is reported',
    !(d.create || []).some((c) => /Ravi/.test(c.name)) && (d.problems || []).some((p) => /Ravi/.test(p.name)));
  const before = await api('/api/entities/lookup?user_id=' + ROOT_HANDLE + '.clothing');
  ok('★★ dry run created NOTHING', before.status === 404, 'lookup → ' + before.status);

  // ── 4 · name the partner, then BUILD ─────────────────────────────────────────────────────────────────────
  step(4, 'name the partner and build for real');
  design.nodes.find((n) => n.key === 'n_ptnr').partner_ref = partnerRef;
  await api('/api/network-design', { method: 'PUT', token: op.token, body: { draft: design } });

  const build = await api('/api/network-design/build', { method: 'POST', token: op.token, body: {} });
  const b = build.json || {};
  ok('build ran', build.status === 200, b.message || JSON.stringify(b));
  const created = b.created || [];
  ok('three owned stores created', created.length === 3, created.map((c) => c.handle).join('  '));
  (b.problems || []).forEach((p) => note('⚠ not built: ' + p.name + ' — ' + p.reason));

  const cloth = created.find((c) => c.handle === ROOT_HANDLE + '.clothing');
  const wh    = created.find((c) => c.handle === ROOT_HANDLE + '.warehouse');
  const mens  = created.find((c) => c.handle === ROOT_HANDLE + '.mens');
  // The name is flat; the PLACEMENT is not. This is the half that would silently go missing if the flattening had
  // been done by dropping the parent rather than by only dropping it from the name.
  ok('★★ Mens is still placed UNDER Clothing on the tree', !!(mens && cloth && mens.path.indexOf(cloth.path + '.') === 0),
    mens ? mens.path : 'no Mens');
  ok('★ each store was handed a claim code, once', !!(cloth && cloth.claim_code), cloth ? cloth.handle + ' → ' + cloth.claim_code : '');

  // ── 5 · THE PARTNER WAS INVITED, NOT CREATED ─────────────────────────────────────────────────────────────
  step(5, 'the partner — invited, never absorbed');
  ok('★★ an invitation exists', (b.invited || []).some((i) => i.handle === partnerRef),
    JSON.stringify(b.invited || []));
  const pending = await api('/api/connections/pending', { token: partner.token });
  const reqs = (pending.json && (pending.json.requests || pending.json.pending || pending.json)) || [];
  ok('★★ THE PARTNER MUST ACCEPT — it is sitting in their inbox, not in the network',
    Array.isArray(reqs) && reqs.some((r) => r.from_bridge_id === op.bridge), 'pending: ' + (Array.isArray(reqs) ? reqs.length : '?'));

  // ── 6 · THE STORE CAN LOG IN ─────────────────────────────────────────────────────────────────────────────
  step(6, 'the store signs in with its handle and code');
  let clothToken = null;
  if (cloth) {
    const v = await api('/api/entities/verify', { method: 'POST', body: { user_id: cloth.handle, otp: cloth.claim_code } });
    clothToken = (v.json || {}).token;
    ok('★★ ' + cloth.handle + ' signed in', !!clothToken, v.status + ' ' + ((v.json || {}).message || ''));
  } else { ok('★★ store sign-in', false, 'no store to sign in'); }

  // ── 7 · THE CAP HOLDS ────────────────────────────────────────────────────────────────────────────────────
  step(7, 'the warehouse cannot publish itself');
  let whToken = null;
  if (wh) {
    const v = await api('/api/entities/verify', { method: 'POST', body: { user_id: wh.handle, otp: wh.claim_code } });
    whToken = (v.json || {}).token;
    const push = await api('/api/entities/profile', { method: 'PATCH', token: whToken, body: { catalogue_visibility: 'public' } });
    ok('★★ the operator\'s decision survives the store\'s own Settings screen', push.status === 403,
      push.status + ' ' + ((push.json || {}).message || ''));
  } else { ok('★★ provisioning cap', false, 'no warehouse'); }

  // ── 8 · IT IS ON THE TREE ────────────────────────────────────────────────────────────────────────────────
  step(8, 'network visibility resolves — the reason the tree exists');
  if (clothToken && wh) {
    await api('/api/relationships/suppliers', { method: 'POST', token: clothToken, body: { supplier_bridge_id: wh.bridge_id } });
    const sups = await api('/api/relationships/suppliers', { token: clothToken });
    const row = ((sups.json && (sups.json.suppliers || sups.json)) || []).find((x) => x.bridge_id === wh.bridge_id);
    const seen = row ? await api('/api/relationships/suppliers/' + row.supplier_entity_id + '/catalogue', { token: clothToken }) : { status: 0, json: {} };
    // The warehouse has no products yet, so `available` — not an item count — is what proves membership resolved.
    const avail = (seen.json || {}).available;
    ok('★★ a sibling store resolves the network-only warehouse', seen.status === 200 && avail !== false,
      'available=' + avail);

    const outsider = await shop('outsider', 'Random Outsider ' + SUFFIX);
    const oShop = await api('/api/shop/' + wh.handle);
    ok('★★ an outsider cannot even see that it exists', oShop.status === 404 || (oShop.json || {}).available === false,
      'storefront → ' + oShop.status);
    void outsider;
  } else { ok('★★ network membership', false, 'missing tokens'); }

  // ── 9 · RUN IT AGAIN ─────────────────────────────────────────────────────────────────────────────────────
  step(9, 'build a second time');
  const again = await api('/api/network-design/build', { method: 'POST', token: op.token, body: {} });
  const a2 = again.json || {};
  ok('★★ nothing is created twice', (a2.created || []).length === 0, a2.message || '');
  ok('the already-built stores are reported as such', (a2.skipped || []).length >= 3, (a2.skipped || []).length + ' skipped');

  // ── 10 · RE-ISSUE ────────────────────────────────────────────────────────────────────────────────────────
  step(10, 're-issue a code the operator can circulate');
  if (cloth) {
    const ri = await api('/api/network-design/reissue', { method: 'POST', token: op.token, body: { user_id: cloth.handle } });
    ok('★ the operator can issue a fresh code', ri.status === 200 && !!(ri.json || {}).claim_code,
      (ri.json || {}).message || ri.status);
    const notMine = await api('/api/network-design/reissue', { method: 'POST', token: partner.token, body: { user_id: cloth.handle } });
    ok('★★ but only for stores THEY minted', notMine.status === 404, notMine.status + '');
  }

  console.log('\n' + '─'.repeat(72));
  console.log(`  ${pass} proved · ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('\n   ✗ harness error: ' + e.message + '\n'); process.exit(1); });
