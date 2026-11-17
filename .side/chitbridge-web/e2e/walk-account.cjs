#!/usr/bin/env node
/**
 * e2e/walk-account.cjs — CB SETTINGS › ACCOUNT and CB FINANCE › REPORTS, WALKED (T3-P4-ACCOUNT, 2026-10-14; app/cap-settings.js account · app/cap-mis.js).
 * Black box: it does what a person does — reads where they are signed in, signs a lost phone out, (the owner) removes a device, sees the keys count and the
 * one door to the keys list, saves the vault; opens Reports, changes the window, follows a number to the list that holds it — and what a CO-ASSIST sees
 * (Every device greyed with the server's sentence, nothing asked). Then RULE 13 on both screens (e2e/lib/rule13.cjs): Cream and Dark × 1366 and 390 px.
 *   default   a stand-in api answering inside the page (nothing leaves the runner)
 *   --real    the local api (e2e/lib/real-stack.cjs: ../chitbridge-api/server.js on CB_REAL_DB, DEV_OTP) signed in as simstores@test.example —
 *             the read paths and rule 13 on real routes; the writes that would change the sim shop (sign out · remove · save the vault) are not pressed
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-account.cjs [--real] [--show]
 * One line per path: "ID · path · PASS/FAIL (what it saw)". Screenshots: e2e/shots/walk-account-NN.png.
 */
'use strict';
const TD = require('./lib/today.cjs');   /* QW1-TODAY: the one injected today (CB_TODAY) — never the runner's clock */
const W = require('./lib/walk.cjs');
const REAL = process.argv.includes('--real');
const C = require('./lib/contract.cjs');   /* M43: every answer for a route in the API contract is held to it (the facts family) */
const J = C.json;
const crmApi = require('./lib/crm-api.cjs');   /* RAIL-LAB-SRV1: the rail card (GET /api/facts/rail) from its one builder */

const walk = async (w) => {
  const { page, ctx, base } = w;
  const S = { calls: [], gets: [], coassist: false, sesFail: false, misFail: false, truncated: false };
  const now = Math.floor(TD.nowMs() / 1000);
  const ago = (min) => new Date(TD.nowMs() - min * 60000).toISOString();
  const DEV_WHY = 'Only the owner may see or remove every device.';
  const ok = { ok: true, code: null, why: null };
  const SESSIONS = () => [
    { jti: 'j-cur', device_id: 'dev-laptop-0001', surface: 'settings', iat: now - 3600, exp: now + 6 * 86400, current: true, device: { label: null, kind: 'web', seen: ago(1) } },
    { jti: 'j-phone', device_id: 'dev-phone-0002', surface: 'till', iat: now - 2 * 86400, exp: now + 20 * 86400, current: false, device: { label: null, kind: 'till', seen: ago(90) } }];
  const DEVICES = () => [
    { device_id: 'dev-laptop-0001', label: null, kind: 'web', by: 'e1', first_seen: '2026-10-01T09:00:00Z', seen: ago(1), revoked_at: null, till_prefix: null, sessions: 1 },
    { device_id: 'dev-phone-0002', label: null, kind: 'till', by: 'e1', first_seen: '2026-10-02T09:00:00Z', seen: ago(90), revoked_at: null, till_prefix: 'C1', sessions: 2 },
    { device_id: 'dev-old-0003', label: null, kind: 'web', by: 'e1', first_seen: '2026-09-02T09:00:00Z', seen: '2026-09-13T09:00:00Z', revoked_at: '2026-09-14T09:00:00Z', till_prefix: null, sessions: 0 }];
  const KEYS = [{ jti: 'k-till', name: 'counter C1 · Win32', scopes: ['till'], last4: 'a1b2', created_at: '2026-10-01T09:00:00Z', seen: { at: ago(2), ip: '10.0.0.4' } },
    { jti: 'k-svc', name: 'Price feed', scopes: ['services'], last4: 'c3d4', created_at: '2026-09-20T09:00:00Z', seen: null }];
  const VAULT = { sections: [{ type: 'identity', label: '', rows: [{ name: 'Legal name', value: 'Fixture Shop Pvt Ltd', tag: 'legal_name' }] }, { type: 'bank', label: 'HDFC', rows: [{ name: 'IFSC code', value: 'HDFC0001234' }] }] };
  const m = (count, open, overdue, unread, closed, disp, oldest, med) => ({ count, by_status: {}, by_direction: {}, open, closed, unread, overdue, overdue_days: 7,
    clock: { oldest_at: null, oldest_age_days: oldest, median_age_days: med, median_first_touch_days: null, median_to_close_days: null, never_read: unread },
    disputes: { open: disp, ever: disp, rate_pct: count ? 10 : null }, money: { by_currency: {}, unvalued: 0 } });
  const MIS = (since) => ({ overdue_days: 7, since: since || null, truncated: S.truncated, all: m(12, 5, 3, 2, 7, 1, 41.5, 9), received: m(8, 3, 2, 2, 5, 1, 41.5, 11), sent: m(4, 2, 1, 0, 2, 0, 20, 6) });
  let api = base;

  if (REAL) {
    const R = require('./lib/real-stack.cjs');
    S.stack = await R.up({ webBase: base }); api = S.stack.api;
    const owner = await R.signIn(api, 'simstores@test.example');
    ctx.on('request', (q) => { if (q.url().startsWith(api) && q.method() !== 'GET' && q.method() !== 'OPTIONS') S.calls.push(q.method() + ' ' + new URL(q.url()).pathname + ' ' + (q.postData() || '')); });
    await ctx.addInitScript((a) => { try { localStorage.setItem('cb_api_base', a.api); localStorage.setItem('cb_sess', a.s); } catch (_) {} }, { api, s: owner.session });
  } else {
    await ctx.route('**/api/**', async (r) => {
      const q = r.request(), u = new URL(q.url()), p = u.pathname, mth = q.method();
      let body = null; try { body = q.postData() ? JSON.parse(q.postData()) : null; } catch (_) {}
      if (mth !== 'GET') S.calls.push(mth + ' ' + p + (body ? ' ' + JSON.stringify(body) : '')); else S.gets.push(p + u.search);
      const may = S.coassist ? { ok: false, code: 'OWNER_ONLY', why: DEV_WHY } : ok;
      if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Fixture Shop', country_code: 'IN', currency_code: 'INR' } });
      if (p === '/api/signin/sessions' && mth === 'GET') return S.sesFail ? J(r, 500, { error: 'Failed' }) : J(r, 200, { sessions: SESSIONS(), legacy: false, may: { devices: may } });
      if (p === '/api/signin/devices') return S.coassist ? J(r, 403, { error: 'Forbidden', code: 'OWNER_ONLY', message: DEV_WHY }) : J(r, 200, { devices: DEVICES() });
      if (p === '/api/signin/sessions/revoke') return J(r, 200, { ok: true, revoked: body && body.device_id ? 'device' : 'session', removed: true });
      if (p === '/api/keys' && mth === 'GET') return J(r, 200, { keys: KEYS, scopes: ['till', 'services'] });
      if (p === '/api/governance/profile' && mth === 'GET') return J(r, 200, { invoice_party: { complete: true, missing: [] }, vault: VAULT, vault_version: 'v7', vault_encrypted: true });
      if (p === '/api/governance/profile/vault' && mth === 'PUT') return J(r, 200, { vault: VAULT, version: 'v8' });
      if (p === '/api/folders/mis') return S.misFail ? J(r, 500, { error: 'MIS failed' }) : J(r, 200, MIS(u.searchParams.get('since')));
      if (p === '/api/facts/rail') return J(r, 200, crmApi.railFacts({ suppliers: 0, customers: 0, in: 0, out: 0, stuck: 0 }));
      return J(r, 200, {});
    });
    await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', 'Fixture Shop'));
  }

  const txt = (sel) => page.locator(sel).first().innerText().then((s) => s.replace(/\s+/g, ' ').trim()).catch(() => '');
  const attr = (sel, a) => page.locator(sel).first().getAttribute(a).catch(() => null);
  const wrote = (re) => S.calls.filter((c) => re.test(c));
  const go = async (url, ready) => { await page.goto(base + url); await page.reload(); await page.waitForSelector(ready, { timeout: 20000 }); await page.waitForTimeout(300); };
  const openRow = async (tid) => { await page.click('[data-testid="' + tid + '"]'); await page.waitForTimeout(200); };
  const act = (a, id) => page.locator('[data-act="' + a + '"][data-actrow="' + id + '"]');
  const yes = async () => { await page.waitForSelector('[data-testid="confirm-ok"]', { timeout: 5000 }); await page.click('[data-testid="confirm-ok"]'); await page.waitForTimeout(500); };

  /* ── SETTINGS › ACCOUNT ── */
  await go('/settings.html#/account', '[data-testid="sx-ses-list"] .cbl-lrec, [data-testid="sx-ses-list"] .cbl-row, [data-testid="cbl-empty-set-sessions"], [data-testid="cbl-error-set-sessions"]');
  await w.step('A1', 'Account: Sessions is one CBList — this device marked "This one", the counter phone named as one; the count from the same answer; the sidebar marks Account', async () => {
    const n = await txt('[data-testid="sx-ses-count"]'), side = await txt('[data-testid="skel-side"]'), title = await txt('[data-testid="sx-title"]');
    if (REAL) return { ok: /sign-in/.test(n) && /Account/.test(side) && title === 'Account', saw: n + ' · ' + title };
    const cur = await txt('[data-testid="sx-ses-current-j-cur"]'), phone = await txt('[data-testid="sx-ses-j-phone"]');
    return { ok: /2 sign-ins/.test(n) && /This one/.test(cur) && /Counter phone or PC/.test(phone) && /Counter/.test(phone) && /Account/.test(side), saw: n + ' · "' + cur + '" · phone "' + phone.slice(0, 60) + '"' };
  });
  if (!REAL) {
    await w.step('A2', 'this device -> its next level -> "Sign out this device" SHOWN and greyed with why (the server says current); the phone -> Sign out -> confirm -> one POST revoke { jti }', async () => {
      await openRow('sx-ses-j-cur'); const dis = await act('signout', 'j-cur').isDisabled(), why = await txt('.cbl-next[data-next="j-cur"] .cbl-why');
      await openRow('sx-ses-j-phone'); await act('signout', 'j-phone').click(); await yes();
      const post = wrote(/POST \/api\/signin\/sessions\/revoke/), out = await txt('[data-testid="sx-ses-out"]');
      return { ok: dis && /device you are on/.test(why) && post.length === 1 && /"jti":"j-phone"/.test(post[0]) && /Signed out/.test(out), saw: 'current greyed ' + dis + ' "' + why + '" · ' + (post[0] || 'no POST') + ' · "' + out + '"' };
    });
    await w.step('A3', 'Every device (the owner): three devices, the removed one says Removed, the phone "Signed in · 2" and bills as C1; Remove this device -> confirm -> one POST revoke { device_id }', async () => {
      const n = await txt('[data-testid="sx-dev-count"]'), gone = await txt('[data-testid="sx-dev-state-dev-old-0003"]'), ph = await txt('[data-testid="sx-dev-state-dev-phone-0002"]');
      await openRow('sx-dev-dev-phone-0002'); const nx = await txt('[data-testid="sx-dev-next-dev-phone-0002"]');
      await act('remove', 'dev-phone-0002').click(); await yes();
      const post = wrote(/POST \/api\/signin\/sessions\/revoke .*device_id/), out = await txt('[data-testid="sx-dev-out"]');
      return { ok: /3 devices · 2 signed in now/.test(n) && /Removed/.test(gone) && /Signed in · 2/.test(ph) && /Bills as C1/.test(nx) && post.length === 1 && /"device_id":"dev-phone-0002"/.test(post[0]) && /Device removed/.test(out),
        saw: n + ' · "' + gone + '" · "' + ph + '" · ' + post.length + ' remove · "' + out + '"' };
    });
    await w.step('A4', 'a CO-ASSIST: Every device SHOWN and greyed with the server\'s sentence (may.devices, OWNER_ONLY) — GET /devices never asked; their own sessions still listed', async () => {
      S.coassist = true; S.gets.length = 0;
      await go('/settings.html#/account', '[data-testid="sx-ses-j-cur"]');
      const why = await txt('[data-testid="sx-dev-why"]'), err = await txt('[data-testid="cbl-error-set-devices"]'), asked = S.gets.filter((g) => /\/api\/signin\/devices/.test(g)).length;
      S.coassist = false;
      return { ok: why === DEV_WHY && err.indexOf(DEV_WHY) >= 0 && asked === 0, saw: '"' + why + '" · list says "' + err.slice(0, 70) + '" · devices asked ' + asked };
    });
    await w.step('A5', 'SET-34 (6 Nov 2026): the keys SHOW on Account - the list, Make a key, no door to an empty Connectors page', async () => {
      await go('/settings.html#/account', '[data-testid="sx-ses-list"]');
      const list = await page.locator('[data-testid="sx-key-list"]:visible').count(), mint = await page.locator('[data-testid="sx-key-mint"]:visible').count(), door = await page.locator('[data-testid="sx-keys-door"]').count();
      return { ok: list === 1 && mint === 1 && door === 0, saw: 'visible key lists ' + list + ' - mint buttons ' + mint + ' - doors ' + door };
    });
    /* SET-WALK1 W25: Save sends a MERGE-PATCH of what moved with the version - the bank row's change travels alone; the identity section is not re-sent */
    await w.step('A6', 'SET-34 (6 Nov 2026): the vault SHOWS on Account, each row with a Copy button', async () => {
      const shown = await page.locator('[data-testid="sx-vault-wrap"]:visible').count(), copies = await page.locator('[data-testid="sx-vault"] [data-testid="vault-copy"]').count();
      return { ok: shown === 1 && copies > 0, saw: 'vault visible ' + shown + ' - copy buttons ' + copies };
    });
    await w.step('A7', 'the sessions read fails -> "Could not read this" + Try again in the list, never "No listed sign-in"', async () => {
      S.sesFail = true; await go('/settings.html#/account', '[data-testid="cbl-error-set-sessions"]');
      const e = await txt('[data-testid="cbl-error-set-sessions"]'); S.sesFail = false;
      return { ok: /Could not read this/.test(e) && /Try again/.test(e) && !/No listed/.test(e), saw: '"' + e + '"' };
    });
  }

  /* ── FINANCE › REPORTS ── */
  await go('/finance.html#/reports', '[data-testid="fm-row-open"], [data-testid="cbl-error-fin-reports"]');
  await w.step('R1', 'Reports: one CBList of the server\'s measures × all · received · sent; Stuck = 3 is a door to CRM › Chits › Stuck, Open received opens the In tab, an age is no door; the rule said', async () => {
    const tab = await txt('[data-testid="fin-nav-reports"]'), rule = await txt('[data-testid="fm-rule"]');
    if (REAL) return { ok: /Reports/.test(tab) && /Stuck = open for more than/.test(rule), saw: tab + ' · "' + rule + '"' };
    const stuck = await txt('[data-testid="fm-overdue-all"]'), stuckHref = await attr('[data-testid="fm-overdue-all"]', 'href'), inHref = await attr('[data-testid="fm-open-received"]', 'href');
    const oldest = await txt('[data-testid="fm-oldest-all"]'), oldestIsLink = await page.locator('a[data-testid="fm-oldest-all"]').count();
    return { ok: stuck === '3' && stuckHref === '/crm.html#/chits?tab=stuck' && inHref === '/crm.html#/chits?tab=in' && oldest === '41.5' && oldestIsLink === 0 && /more than 7 days/.test(rule),
      saw: 'stuck ' + stuck + ' -> ' + stuckHref + ' · open received -> ' + inHref + ' · oldest ' + oldest + ' (link ' + oldestIsLink + ') · "' + rule + '"' };
  });
  if (!REAL) {
    await w.step('R2', '7 days -> one GET /folders/mis with `since` inside the last week (the one window rule); the page computes nothing, the figures are the answer\'s', async () => {
      S.gets.length = 0; await page.click('[data-testid="fm-period-7"]'); await page.waitForSelector('[data-testid="fm-row-open"]', { timeout: 8000 }); await page.waitForTimeout(400);
      const g = S.gets.filter((x) => /\/api\/folders\/mis/.test(x)), since = g.length ? decodeURIComponent((g[0].split('since=')[1] || '').split('&')[0]) : '';
      const days = since ? (TD.nowMs() - Date.parse(since)) / 864e5 : -1, pressed = await attr('[data-testid="fm-period-7"]', 'aria-pressed'), sent = await txt('[data-testid="fm-closed-sent"]');
      return { ok: g.length === 1 && days > 6.9 && days < 7.1 && pressed === 'true' && sent === '2', saw: g.length + ' read · since ' + days.toFixed(2) + ' days ago · closed sent ' + sent };
    });
    await w.step('R3', 'a stuck number -> CRM › Chits with the Stuck tab preset (the list that holds them), never the workshop', async () => {
      await page.click('[data-testid="fm-overdue-received"]'); await page.waitForTimeout(800);
      const url = page.url();
      return { ok: /\/crm\.html#\/chits\?tab=stuck/.test(url) && !/app\.html/.test(url), saw: url.replace(base, '') };
    });
    await w.step('R4', 'the read was cut at 5,000 -> the notice says the figures are partial; the read fails -> "Could not read the reports." + Try again', async () => {
      S.truncated = true; await go('/finance.html#/reports', '[data-testid="fm-row-open"]');
      const notes = await txt('[data-testid="fm-list"]'); S.truncated = false;
      S.misFail = true; await go('/finance.html#/reports', '[data-testid="cbl-error-fin-reports"]'); const e = await txt('[data-testid="cbl-error-fin-reports"]'); S.misFail = false;
      return { ok: /first 5,000 chits only/.test(notes) && /Could not read the reports/.test(e) && /Try again/.test(e), saw: 'cut: "' + (notes.match(/Counted over[^.]*\./) || [''])[0] + '" · fail: "' + e.slice(0, 60) + '"' };
    });
    await w.step('R5', 'Home: Account and Reports are built, each routes into its small app (never the workshop) and reads its own /api/facts card', async () => {
      const mf = await page.evaluate(() => fetch('/app/manifest.json').then((r) => r.json()));
      const e = (id) => mf.entries.filter((x) => x.id === id)[0] || {};
      const a = e('account'), r = e('reports');
      return { ok: a.state === 'built' && a.route === '/settings.html#/account' && a.facts === '/api/facts/account' && r.state === 'built' && r.route === '/finance.html#/reports' && r.facts === '/api/facts/reports',
        saw: [a, r].map((x) => x.id + ' ' + x.state + ' ' + x.route + ' ' + x.facts).join(' · ') };
    });
  }

  /* ── RULE 13: both screens, Cream and Dark × 1366 and 390 px ── */
  const rule13 = require('./lib/rule13.cjs').rule13;
  await page.setViewportSize({ width: 1366, height: 900 });
  await go('/settings.html#/account', '[data-testid="sx-ses-list"]');   /* WALK-REG 2026-10-16: the keys card is hidden */
  if (!REAL) await openRow('sx-ses-j-phone');   /* the next level and its action are measured too */
  await rule13(w, 'R13a', 'Settings › Account', 'set');
  await page.setViewportSize({ width: 1366, height: 900 });
  await go('/finance.html#/reports', '[data-testid="fm-row-open"], [data-testid="cbl-error-fin-reports"]');
  if (!REAL) await openRow('fm-row-overdue');
  await rule13(w, 'R13b', 'Finance › Reports', 'screen');
  if (S.stack) S.stack.stop();
  if (w.errs.length) w.note('T99', 'page errors seen during the walk', w.errs.slice(0, 3).join(' | '));
};
walk.opts = { viewport: { width: 1366, height: 900 } };
W.run('account', walk);
