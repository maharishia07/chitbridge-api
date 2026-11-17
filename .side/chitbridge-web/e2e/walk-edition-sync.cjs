#!/usr/bin/env node
/**
 * e2e/walk-edition-sync.cjs - A CHOICE MADE ON TASKS IS SAVED (round FX-QA1, QA-W1 finding 2: tasks.html declared an empty endpoint list, so the
 * avatar's push had nowhere to go; the choice only landed when Employees loaded).
 * Black box, signed in as the FIXTURE shop; the site served from this checkout, the API a stand-in answering inside the page that KEEPS the person's
 * ui_prefs (PATCH /api/entities/me/prefs/ui merges, GET /api/entities/me answers them) - nothing is written anywhere.
 *   S1  Tasks -> a look choice (motion) -> it reaches the server through the page's own api door (core.js's savePrefs row, no per-page list)
 *   S2  Tasks -> Edition: Auditor view -> saved on the server; the mark (cb_prefs_pending) is cleared
 *   S3  Employees, on a machine that never saw the choice -> the edition is there (read from the server)
 *   S4  offline on Tasks -> Edition: Everything -> held as pending, not saved -> back online -> pushed, the server holds it, the mark is gone
 *
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-edition-sync.cjs
 */
'use strict';
const W = require('./lib/walk.cjs');
const J = (r, status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

W.run('edition-sync', async (w) => {
  const { page, ctx, base } = w;
  const S = { ui: {}, patches: [], cut: false };
  await ctx.route('**/api/**', (r) => {
    const q = r.request(), u = new URL(q.url());
    if (u.pathname === '/api/entities/me/prefs/ui' && q.method() === 'PATCH') {
      if (S.cut) return r.abort('internetdisconnected');
      let b = {}; try { b = JSON.parse(q.postData() || '{}'); } catch (_) {}
      S.patches.push(b); Object.keys(b).forEach((k) => { if (b[k] === '' || b[k] == null) delete S.ui[k]; else S.ui[k] = b[k]; });
      return J(r, 200, { ok: true, ui_prefs: S.ui });
    }
    if (u.pathname === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Fixture Shop', currency_code: 'INR', country: 'IN', ui_prefs: Object.assign({}, S.ui) } });
    return J(r, 404, { error: 'not found' });
  });
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', 'Fixture Shop'));
  const ls = () => page.evaluate(() => ({ edition: localStorage.getItem('cb_edition'), pending: localStorage.getItem('cb_prefs_pending') }));
  const until = async (fn, ms) => { for (let t = 0; t < (ms || 6000); t += 150) { if (await fn()) return true; await page.waitForTimeout(150); } return false; };
  const open = async (p) => { await page.goto(base + p); await page.waitForFunction(() => window.CBAvatar && document.readyState === 'complete', null, { timeout: 20000 }); await page.waitForTimeout(800); };

  await open('/tasks.html');
  await w.step('S1', 'Tasks -> Motion: reduce -> the choice reaches the server through the page\'s api door (no endpoint list on the page)', async () => {
    const n = S.patches.length;
    await page.evaluate(() => CBAvatar.set('motion', 'reduce'));
    const ok = await until(() => S.patches.length > n && S.ui.motion === 'reduce');
    return { ok, saw: (S.patches.length - n) + ' PATCH · server motion ' + S.ui.motion + ' · pending ' + (await ls()).pending };
  });

  await w.step('S2', 'Tasks -> Edition: Auditor view -> saved on the server, and the pending mark is cleared', async () => {
    await Promise.all([page.waitForEvent('load', { timeout: 15000 }).catch(() => null), page.evaluate(() => CBAvatar.set('edition', 'auditor'))]);
    const ok = await until(() => S.ui.edition === 'auditor');
    await page.waitForTimeout(600);
    const l = await ls();
    return { ok: ok && !(l.pending && /edition/.test(l.pending)), saw: 'server edition ' + S.ui.edition + ' · pending ' + l.pending };
  });

  await w.step('S3', 'Employees, on a machine that never saw the choice -> the edition is there (the server\'s)', async () => {
    await page.evaluate(() => { localStorage.removeItem('cb_edition'); localStorage.removeItem('cb_prefs_pending'); });
    await open('/employees.html');
    const ok = await until(async () => (await ls()).edition === 'auditor');
    return { ok, saw: 'cb_edition ' + (await ls()).edition };
  });

  await open('/tasks.html');
  await w.step('S4', 'Offline on Tasks -> Edition: Everything -> held as pending; online again -> pushed, the server holds it, the mark is gone', async () => {
    S.cut = true;
    await Promise.all([page.waitForEvent('load', { timeout: 15000 }).catch(() => null), page.evaluate(() => CBAvatar.set('edition', 'full'))]);
    await page.waitForTimeout(1500);
    const held = await ls(), serverWhileCut = S.ui.edition;
    S.cut = false;
    await ctx.setOffline(true); await page.waitForTimeout(200); await ctx.setOffline(false);   /* the browser's own 'online' event */
    const ok = await until(() => S.ui.edition === 'full');
    await page.waitForTimeout(600);
    const after = await ls();
    return { ok: ok && serverWhileCut === 'auditor' && /"edition":"full"/.test(held.pending || '') && !(after.pending && /edition/.test(after.pending)),
      saw: 'while offline: server ' + serverWhileCut + ' · pending ' + held.pending + ' -> online: server ' + S.ui.edition + ' · pending ' + after.pending };
  });
});
