#!/usr/bin/env node
/* till-handoff.cjs — H20/T1/H21: the owner signed in on Home opens the Till SIGNED IN with that shop - no second code, no key, no counter.
 * The apps' session (cb_sess) is spent through becomeShop({ token }) once per sign-in: cb_till_person names the same shop, no cb_till_key is made,
 * /api/till/enrol is never called, the header names the PERSON (not "Counter 1"), and signing out here does not sign straight back in.
 * Stand-in API inside the page. Run: sh C:/dev/toolset/e2e.sh <checkout> e2e/till-handoff.cjs */
'use strict';
const { chromium } = require('@playwright/test');
const { serve } = require('./lib/serve.cjs');
const J = (r, status, o) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
(async () => {
  const out = { pass: 0, fail: 0 };
  const ok = (c, m) => { if (c) out.pass++; else out.fail++; console.log((c ? '  ok  ' : '  XX  ') + m); };
  const web = await serve(), b = await chromium.launch();
  const b64 = (x) => Buffer.from(JSON.stringify(x)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const mk = (id, extra) => b64({ alg: 'none' }) + '.' + b64(Object.assign({ identity_id: id, identity_type: 'entity', exp: Math.floor(Date.now() / 1000) + 3600 }, extra || {})) + '.x';
  const seen = [];
  const ctx = await b.newContext({ viewport: { width: 1200, height: 800 }, serviceWorkers: 'block' });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.route('**/api/**', (r) => { seen.push(new URL(r.request().url()).pathname); return J(r, 404, { error: 'not found' }); });
  const SESS = JSON.stringify({ token: mk('ent-home'), role: 'entity', name: 'Mayur', entity: 'Mayur Bhavan', bridgeId: 'CBHOME1234' });
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_till_api', location.origin); if (!sessionStorage.getItem('__s')) { sessionStorage.setItem('__s', '1'); localStorage.setItem('cb_sess', s); } } catch (_) {} }, SESS);
  const p = await ctx.newPage(), errs = [];
  p.on('pageerror', (e) => errs.push(String(e.message)));
  await p.goto(web.url('/till.html')); await p.waitForTimeout(3500);
  const ls = (k) => p.evaluate((k) => localStorage.getItem(k), k);
  const person = JSON.parse((await ls('cb_till_person')) || 'null');
  ok(person && person.entity_id === 'ent-home', 'the counter holds a person session for the shop the owner signed in to on Home (' + (person && person.entity_id) + ')');
  ok(!(await ls('cb_till_key')), 'no key was made - a phone is a person on a device');
  ok(!seen.includes('/api/till/enrol'), 'nothing was spent on /api/till/enrol');
  /* ⭐ M38 (walk 2026-10-10): one fact per pill — shop · counter · who. The PERSON is named on #whopill (paintWho);
     #tillpill is the counter's own label. Same intent: the header names the person who signed in on Home. */
  const whoPill = (await p.locator('#whopill').innerText()).trim();
  ok(/Mayur/.test(whoPill) && !/nobody signed in/i.test(whoPill), 'the header names the person who signed in on Home (' + whoPill + ')');
  ok(errs.length === 0, 'no script errors' + (errs.length ? ' - ' + errs[0] : ''));
  /* once per sign-in: forget the person here (a sign-out) and reload - the same app session must not sign them straight back in */
  await p.evaluate(() => { localStorage.removeItem('cb_till_person'); });
  await p.reload(); await p.waitForTimeout(2500);
  ok(!(await ls('cb_till_person')), 'after a sign-out here, the same app session is not spent again');
  /* a NEW app sign-in (another token) is handed over again, and a session for ANOTHER shop replaces the old one */
  await p.evaluate((t) => { localStorage.setItem('cb_sess', JSON.stringify({ token: t, role: 'entity', name: 'Veg', entity: 'Veg Shop', bridgeId: 'CBVEG00001' })); }, mk('ent-veg', { jti: 'j2' }));
  await p.reload(); await p.waitForTimeout(3500);
  const p2 = JSON.parse((await ls('cb_till_person')) || 'null');
  ok(p2 && p2.entity_id === 'ent-veg', 'a new sign-in on Home opens that shop on the counter');
  await b.close(); web.srv.close();
  console.log('\n  till-handoff: ' + out.pass + ' passed, ' + out.fail + ' failed');
  process.exit(out.fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
