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
  let design = DESIGN('root_' + SUFFIX);
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
  const before = await api('/api/entities/lookup?user_id=' + ROOT_HANDLE + '.clothing', { token: op.token });
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
    // Clothing is the PUBLIC department. It needs stock, or the network storefront reports "no network" for the
    // same reason a shop with nothing in it does — which would look exactly like a missing tree.
    await api('/api/schemas/create-default', { method: 'POST', token: clothToken });
    await api('/api/products', { method: 'POST', token: clothToken,
      body: { item_data: { name: 'Cotton Shirt', unit: 'each', price: 899 } } });
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
    // Give the warehouse something to see. Without a product, step 8's "can a sibling read it" passes on an EMPTY
    // payload — a test that cannot fail is not a test, and this one is carrying the network tier.
    await api('/api/schemas/create-default', { method: 'POST', token: whToken });
    const made = await api('/api/products', { method: 'POST', token: whToken,
      body: { item_data: { name: 'Pallet — mixed stock', unit: 'each', price: 14500 } } });
    const mine = await api('/api/products', { token: whToken });
    // Asserted separately so a SETUP failure can never be read as a VISIBILITY failure. Step 8 is carrying the
    // network tier; it must not be able to fail for a reason that has nothing to do with visibility.
    ok('the warehouse has stock to be seen', (((mine.json || {}).items) || []).length > 0,
      'create ' + made.status + ' · list ' + (((mine.json || {}).items) || []).length
      + (made.status >= 400 ? ' · ' + JSON.stringify(made.json) : ''));
  } else { ok('★★ provisioning cap', false, 'no warehouse'); }

  // ── 8 · IT IS ON THE TREE ────────────────────────────────────────────────────────────────────────────────
  step(8, 'network visibility resolves — the reason the tree exists');
  // Does the TREE exist at all? The network storefront resolves members from cb_entity.path, so it separates
  // "the rows were never written" from "the rows are there and visibility said no".
  const netFront = await api('/api/catalogue/network/' + op.bridge);
  const depts = ((netFront.json || {}).departments) || [];
  // The PUBLIC department must actually reach a shopper. This is what caught the two-publish-gates bug: the
  // storefront 404'd for a store the operator had explicitly designed public, because the schema carried a second
  // `visibility` flag that defaults to private and nothing set it.
  ok('★★ the public department reaches a shopper on the network storefront',
    netFront.status === 200 && depts.length >= 1,
    netFront.status + ' · ' + depts.length + ' department(s)');
  ok('★★ the network-only and private departments are ABSENT from it',
    !JSON.stringify(netFront.json || {}).includes('Warehouse') && !JSON.stringify(netFront.json || {}).includes('"Mens"'));
  if (clothToken && wh) {
    await api('/api/relationships/suppliers', { method: 'POST', token: clothToken, body: { supplier_bridge_id: wh.bridge_id } });
    const sups = await api('/api/relationships/suppliers', { token: clothToken });
    const row = ((sups.json && (sups.json.suppliers || sups.json)) || []).find((x) => x.bridge_id === wh.bridge_id);
    const seen = row ? await api('/api/relationships/suppliers/' + row.supplier_entity_id + '/catalogue', { token: clothToken }) : { status: 0, json: {} };
    const items = ((seen.json || {}).items) || [];
    ok('★★ a sibling store READS the network-only warehouse\'s stock', seen.status === 200 && items.length > 0,
      seen.status + ' · ' + items.length + ' item(s)');

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

  // ── 11 · ENHANCING AN EXISTING NETWORK ───────────────────────────────────────────────────────────────────
  step(11, 'change a built store, and build again');
  // RE-READ before editing. The server draft now carries the `built` receipts; saving this script's older copy
  // would send a design that has forgotten its own network. The server re-attaches them defensively, and this
  // asserts that it does — the client being careful and the server not trusting it are two different guarantees.
  const reread = await api('/api/network-design', { token: op.token });
  const live = (reread.json || {}).draft;
  ok('the saved design carries what was built', !!live && (live.nodes || []).filter((n) => n.built).length === 3,
    (live && (live.nodes || []).filter((n) => n.built).length) + ' node(s) marked built');
  const stale = JSON.parse(JSON.stringify(design));   // deliberately WITHOUT the receipts
  stale.nodes.find((n) => n.key === 'n_wh').exposure = 'private';   // warehouse: network → private
  await api('/api/network-design', { method: 'PUT', token: op.token, body: { draft: stale } });
  const after = await api('/api/network-design', { token: op.token });
  ok('★★ a stale save cannot un-record what was built',
    (((after.json || {}).draft || {}).nodes || []).filter((n) => n.built).length === 3,
    (((after.json || {}).draft || {}).nodes || []).filter((n) => n.built).length + ' still marked built');
  design = (after.json || {}).draft || design;   // carry on from what the server actually holds
  const dry3 = await api('/api/network-design/build', { method: 'POST', token: op.token, body: { dry_run: true } });
  const upd = ((dry3.json || {}).update) || [];
  ok('★★ a built store whose visibility changed is offered as a CHANGE, not ignored',
    upd.length === 1 && upd[0].from === 'network' && upd[0].to === 'private',
    JSON.stringify(upd));
  const applied = await api('/api/network-design/build', { method: 'POST', token: op.token, body: {} });
  ok('★ the change is applied', (((applied.json || {}).updated) || []).length === 1, (applied.json || {}).message || '');
  if (whToken) {
    const meWh = await api('/api/entities/me', { token: whToken });
    const nowVis = ((meWh.json || {}).entity || meWh.json || {}).catalogue_visibility;
    ok('★★ the LIVE store actually moved', nowVis === 'private', 'catalogue_visibility=' + nowVis);
  }
  const dry4 = await api('/api/network-design/build', { method: 'POST', token: op.token, body: { dry_run: true } });
  ok('★ and a third run has nothing left to do', (((dry4.json || {}).update) || []).length === 0
    && (((dry4.json || {}).create) || []).length === 0, JSON.stringify((dry4.json || {}).counts || {}));

  // ── 12 · A PRIVATE NETWORK CANNOT CONTAIN A PUBLIC STORE ─────────────────────────────────────────────────
  step(12, 'close the network itself, then try to build a public store');
  await api('/api/entities/profile', { method: 'PATCH', token: op.token, body: { catalogue_visibility: 'private' } });
  design.nodes.push({ key: 'n_new', name: 'Pop Up', parent_key: 'root_' + SUFFIX, owned: true,
                      holds: ['catalogue'], exposure: 'public' });
  await api('/api/network-design', { method: 'PUT', token: op.token, body: { draft: design } });
  const dry5 = await api('/api/network-design/build', { method: 'POST', token: op.token, body: { dry_run: true } });
  const pop = (((dry5.json || {}).create) || []).find((c) => c.name === 'Pop Up');
  ok('★★ a private network caps its stores at network — public is refused, not granted',
    !!pop && pop.visibility !== 'public',
    pop ? 'designed public → planned ' + pop.visibility : 'Pop Up missing');
  ok('★ and the reason is reported, not silent', ((dry5.json || {}).notes || []).some((x) => /private|network/i.test(x)),
    JSON.stringify((dry5.json || {}).notes || []));

  console.log('\n' + '─'.repeat(72));
  console.log(`  ${pass} proved · ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('\n   ✗ harness error: ' + e.message + '\n'); process.exit(1); });
