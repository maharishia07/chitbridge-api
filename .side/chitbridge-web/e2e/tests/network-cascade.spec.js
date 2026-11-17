/** @covers FR-N8 — the cascade as a customer actually experiences it */
// network-cascade.spec.js — the parent/child visibility cascade, as a CUSTOMER actually experiences it.
//
// WHY THIS EXISTS
// Athi, 2026-08-08: *"make the cascade for parent and child… use the Playwright tool to test multiple
// combinations, and tell me what difference it makes."*
//
// The rule: a store can be no more open than what it sits inside. Until 2026-08-08 the ceiling came from the
// network ROOT only and never looked at a node's own parent — so a network-only Warehouse could hold a PUBLIC
// Outlet. `scripts/cascade-diff.js` shows 5 of the 27 combinations were leaking that way.
//
// THE SPLIT IS THE POINT (same as currency-matrix.spec.js): the API says what is true, the browser says what a
// customer sees. A unit test can prove the planner narrows a value; only this can prove the shop is not on the
// page. Every leak in that table is exactly "a store the operator had closed, with something still open inside
// it", and the only way to be sure is to go and look.
//
//   CB_WEB_BASE=https://chitbridge-web.vercel.app npx playwright test network-cascade --project=noauth

const { test, expect } = require('@playwright/test');

const API = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
const OTP = require('../fixtures').signinCode();   // SEC1: the tester code (E2E_TESTER_CODE) on a deployed api, the local code on a local one
require('../fixtures').needCode(test);   // no code → the file SKIPS with a CI warning naming the secret
const RUN = process.env.CB_CASCADE_RUN || String(Date.now()).slice(-6);

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(API + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}

/** Sign in (create-or-reuse) and return a token + bridge id. */
async function entity(email, name) {
  await call('/api/entities/register', { method: 'POST', body: { email, display_name: name, user_id: 'e' + Date.now() + Math.floor(Math.random()*1e6) } });
  const v = await call('/api/entities/verify', { method: 'POST', body: { email, otp: OTP } });
  const token = (v.json || {}).token;
  const me = await call('/api/entities/me', { token });
  const e = (me.json && (me.json.entity || me.json)) || {};
  return { token, bridge: e.bridge_id };
}

/**
 * THE COMBINATIONS. Each builds a real two-level network and records what a customer can reach.
 * `child` is the assertion that matters — it is the one the old rule got wrong.
 */
const CASES = [
  { key: 'aa', net: 'public',  parent: 'public',    child: 'public', childVisible: true,
    why: 'everything open — the baseline, and it must still work' },
  { key: 'ba', net: 'public',  parent: 'protected', child: 'public', childVisible: false,
    why: 'THE FIX — a public outlet inside a network-only warehouse' },
  { key: 'ca', net: 'public',  parent: 'private',   child: 'public', childVisible: false,
    why: 'THE FIX — a public outlet inside a private department' },
  { key: 'da', net: 'private', parent: 'public',    child: 'public', childVisible: false,
    why: 'a private network hides everything under it' },
];

test.describe('network cascade — a store is never more open than what contains it', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  for (const c of CASES) {
    test(`${c.net} network / ${c.parent} parent / ${c.child} child → child ${c.childVisible ? 'VISIBLE' : 'HIDDEN'} (${c.why})`, async ({ page }) => {
      const handle = `casc${RUN}${c.key}`;
      const op = await entity(`casc-${RUN}-${c.key}@test-cb.com`, `Cascade ${RUN} ${c.key}`);
      expect(op.token, 'operator signed in').toBeTruthy();

      await call('/api/entities/profile', { method: 'PATCH', token: op.token, body: { user_id: handle } });
      // THE FIRST QUESTION — the network's own visibility, which is the top of the cascade.
      await call('/api/entities/profile', { method: 'PATCH', token: op.token, body: { catalogue_visibility: c.net } });

      const rootKey = 'r' + c.key;
      await call('/api/network-design', { method: 'PUT', token: op.token, body: { draft: { nodes: [
        { key: rootKey, name: `Cascade ${RUN} ${c.key}`, parent_key: null, root: true, owned: true, holds: [] },
        { key: 'p', name: 'Depot',  parent_key: rootKey, owned: true, holds: ['catalogue'], exposure: c.parent },
        { key: 'k', name: 'Outlet', parent_key: 'p',     owned: true, holds: ['catalogue'], exposure: c.child },
      ] } } });

      const built = await call('/api/network-design/build', { method: 'POST', token: op.token, body: {} });
      expect(built.status, JSON.stringify(built.json)).toBe(200);
      const outlet = (built.json.created || []).find((x) => x.name === 'Outlet');
      expect(outlet, 'the outlet was created').toBeTruthy();

      // Give it stock, or "invisible" would be indistinguishable from "empty" — the trap that made an earlier
      // version of this assertion pass on nothing at all.
      const ot = (await call('/api/entities/verify', { method: 'POST', body: { user_id: outlet.handle, otp: outlet.claim_code } })).json.token;
      await call('/api/schemas/create-default', { method: 'POST', token: ot });
      await call('/api/products', { method: 'POST', token: ot, body: { item_data: { name: 'Outlet Widget ' + RUN, unit: 'each', price: 499 } } });

      // ── WHAT A CUSTOMER SEES ────────────────────────────────────────────────────────────────────────────
      await page.goto(`/shop.html?bridge=${outlet.bridge_id}`, { waitUntil: 'networkidle' });
      const shopText = await page.locator('body').innerText();
      if (c.childVisible) {
        expect(shopText, 'the outlet shop should be open').toContain('Outlet Widget');
      } else {
        // Not "closed" — INDISTINGUISHABLE from a shop that never existed. A different message is an oracle.
        expect(shopText).not.toContain('Outlet Widget');
        expect(shopText).toMatch(/not found|no public catalogue|does not exist|Shop not found/i);
      }

      await page.goto(`/network.html?bridge=${op.bridge}`, { waitUntil: 'networkidle' });
      const netText = await page.locator('body').innerText();
      if (c.childVisible) {
        expect(netText, 'the outlet should be on the network storefront').toContain('Outlet Widget');
      } else {
        expect(netText, 'a closed store must not appear on the network storefront').not.toContain('Outlet Widget');
      }
    });
  }
});
