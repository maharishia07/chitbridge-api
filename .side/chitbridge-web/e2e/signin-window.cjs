/* signin-window.cjs — M14: THE ONE SIGN-IN WINDOW, DRIVEN THROUGH THE SCREEN (the T1 of plan row M14).
 *
 * DECISIONS 2026-10-08: one sign-in module for every app (index · CB Accounts · CB CRM · the till next); sign in with a MOBILE NUMBER
 * or an E-MAIL — the .br / .cr grammar is added behind the scenes; an employee's first sign-in asks for a PIN; every method lives in
 * CBSignin (slots, hidden until shipped).
 *
 * ⭐ THE SIGN-IN LAB (public/signin-lab.html) IS THE GALLERY: it mounts the SAME module the apps mount, against a real server — here the
 * practice ChitBridge (e2e/lib/signin-standin.cjs, T2-LABS: it used to live IN the page, replacing window.fetch) that
 * lives in the page. Every combination is walked here at 1366×768 and at 390×844 (touch, typed codes), shots to e2e/shots/signin-*.png:
 *   owner by e-mail · owner by mobile · employee by mobile → code → set PIN → the PIN works · customer by e-mail ·
 *   one contact → two identities → the chooser · a spent code is not re-sent · locked · device removed · social/SSO/passkey slots hidden
 *   (and shown only as stand-ins) · "What you can do" differs by person (owner · employee without costs · auditor) · planned roles are
 *   marked · the Roadmap's counts match public/app/manifest.json.
 * Then the APPS: CB Accounts signed out shows the window in its card (no bounce to the workshop); the index's Sign in door opens it in
 * place; signing in on CB Accounts writes the apps' session (cb_sess).
 *
 * Run: node e2e/signin-window.cjs   (ports from the OS; nothing reaches localhost:3000 or the live site)
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const { serve } = require('./lib/serve.cjs');
const practice = require('./lib/signin-standin.cjs');   /* T2-LABS: the lab's practice server, out of the page */
let PRACTICE_API = '';
const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(__dirname, 'shots');
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(78) + '· ' + (d || '') + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1,
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36' };
const LAPTOP = { viewport: { width: 1366, height: 768 } };

/* ── a stand-in ChitBridge for the APPS' walk (the lab carries its own, in the page) ── */
/* SEC1 · a stand-in TESTER_CODE (8+ characters, not digits only) — the window must send it AS TYPED, past the engine's 4/6-digit shape */
const TESTER = 'Lantern-4821';
function apiStandIn() {
  const calls = [];
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const token = (c) => b64({ alg: 'none' }) + '.' + b64(Object.assign({ iat: 1, exp: Math.floor(Date.now() / 1000) + 3600 }, c)) + '.x';
  let issued = null;
  const srv = http.createServer(async (q, r) => {
    let raw = ''; for await (const c of q) raw += c;
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    const j = (s, o) => { r.writeHead(s, Object.assign({ 'content-type': 'application/json' }, cors)); r.end(JSON.stringify(o)); };
    if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
    const u = q.url.split('?')[0]; let b = {}; try { b = raw ? JSON.parse(raw) : {}; } catch (_) {}
    calls.push({ m: q.method, u, b });
    const id = String(b.id || b.email || b.user_id || '').toLowerCase();
    if (u === '/api/signin/ask') {
      /* the real api answers an unknown id exactly as a known one (ASK_ANSWER) and sends no code */
      if (id !== 'athi@mayur.test' && id !== 'mayuri123') return j(200, { message: 'If that sign-in exists, enter your PIN or the code we sent.', need: 'pin_or_code' });
      issued = '123456'; return j(200, { message: 'Verification code sent to your email', kind: 'entity', need: 'code', id: 'mayuri123' });
    }
    if (u === '/api/signin/verify') {
      if (b.otp !== issued && b.otp !== TESTER) return j(400, { error: 'Sign-in failed', code: 'SIGNIN_REFUSED', message: REFUSED_WORDS });   /* SEC1: the stand-in's TESTER_CODE */
      issued = null;
      return j(200, { token: token({ identity_id: 'ent-mayur', identity_type: 'entity', display_name: 'Mayur Bhavan', bridge_id: 'CB-MAYUR' }),
        identity: { identity_id: 'ent-mayur', display_name: 'Mayur Bhavan', user_id: 'mayuri123', identity_type: 'entity', bridge_id: 'CB-MAYUR', entity_id: 'ent-mayur' } });
    }
    return j(200, { ok: true, data: {} });
  });
  return { srv, calls };
}

const REFUSED_WORDS = "That sign-in didn't work. Check the details and try again.";   /* lib/otp.js SIGNIN_REFUSED_SENTENCE: one sentence for unknown, wrong and locked */
/* ── the lab walk: one scenario = one page load with the strip's choice in the query ── */
async function lab(b, WEB, dev, q, steps) {
  const ctx = await b.newContext(dev), p = await ctx.newPage(), errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  const phone = !!dev.isMobile, tap = (sel) => (phone ? p.tap(sel) : p.click(sel));
  const tag = (phone ? 'phone-' : 'laptop-') + q.replace(/[^a-z0-9]+/gi, '-');
  const shot = async (n) => { const f = 'signin-' + tag + '-' + n + '.png'; await p.screenshot({ path: path.join(SHOTS, f), fullPage: !phone }); return f; };
  await p.goto(WEB + '/signin-lab.html?' + q + '&api=' + encodeURIComponent(PRACTICE_API));
  await p.waitForSelector('[data-testid="signin-window"]', { state: 'attached', timeout: 15000 });
  const res = { shots: [], errs, p, ctx, tap, shot, phone };
  try { await steps(res); } catch (e) { res.err = String(e && e.message || e); }
  res.calls = await p.evaluate(() => window.__lab.calls()).catch(() => []);
  res.at = await p.evaluate(() => (document.querySelector('[data-testid="signin-window"]') || {}).getAttribute && document.querySelector('[data-testid="signin-window"]').getAttribute('data-at')).catch(() => null);
  res.why = await p.evaluate(() => { const e = document.querySelector('[data-testid="signin-why"]'); return e ? e.textContent : ''; }).catch(() => '');
  res.store = await p.evaluate(() => window.__lab.store()).catch(() => null);
  res.who = await p.evaluate(() => { const e = document.querySelector('[data-testid="lab-who"]'); return e ? e.textContent : null; }).catch(() => null);
  res.storedId = await p.evaluate(() => { const e = document.querySelector('[data-testid="lab-stored-id"]'); return e ? e.textContent : null; }).catch(() => null);
  res.kind = await p.evaluate(() => { const e = document.querySelector('[data-testid="lab-kind"]'); return e ? e.textContent : null; }).catch(() => null);
  res.realSess = await p.evaluate(() => localStorage.getItem('cb_sess')).catch(() => null);
  await ctx.close();
  return res;
}
/** type what the hint says, Continue, then the credential the hint says, Sign in */
async function signIn(r, opts) {
  opts = opts || {};
  const typed = await r.p.locator('[data-testid="lab-typed"]').textContent();
  await r.tap('[data-testid="signin-id"]'); await r.p.keyboard.type(typed);
  r.shots.push(await r.shot('1-typed'));
  await r.tap('[data-testid="signin-go"]');
  await r.p.waitForSelector('[data-testid="signin-code"], [data-testid="signin-pin"], [data-testid="signin-choice"], [data-testid="signin-why"]', { timeout: 10000 });
  r.shots.push(await r.shot('2-asked'));
  const pinBox = await r.p.locator('[data-testid="signin-pin"]').count();
  r.needed = pinBox ? 'pin' : (await r.p.locator('[data-testid="signin-code"]').count()) ? 'code' : 'none';
  if (r.needed === 'none') return r;
  if (opts.wrongFirst) {
    await r.tap('[data-testid="' + (pinBox ? 'signin-pin' : 'signin-code') + '"]'); await r.p.keyboard.type(pinBox ? '0000' : '000000');
    await r.tap('[data-testid="signin-verify"]');
    await r.p.waitForSelector('[data-testid="signin-why"]', { timeout: 10000 });
    r.wrongWhy = await r.p.locator('[data-testid="signin-why"]').textContent();
    r.shots.push(await r.shot('2c-wrong'));
    await r.p.fill('[data-testid="' + (pinBox ? 'signin-pin' : 'signin-code') + '"]', '');
  }
  const cred = opts.cred || (await r.p.evaluate(() => { const c = window.__lab.practice().person.cred; return c.pin || c.code; }));
  await r.tap('[data-testid="' + (pinBox ? 'signin-pin' : 'signin-code') + '"]'); await r.p.keyboard.type(cred);
  await r.tap('[data-testid="signin-verify"]');
  if (opts.choose) {   /* SEC-143 (web 4de4de9f): one PIN-or-code box; a shared contact's account choice is shown AFTER a correct secret */
    await r.p.waitForSelector('[data-testid="signin-choice"]', { timeout: 10000 });
    r.choices = await r.p.locator('[data-testid="signin-choice"]').count();
    const i = await r.p.evaluate((want) => Array.from(document.querySelectorAll('[data-testid="signin-choice"]')).findIndex((b) => b.textContent.includes(want)), opts.choose);
    await r.tap('[data-testid="signin-choice"] >> nth=' + Math.max(0, i));
    r.shots.push(await r.shot('2b-chosen'));
  }
  await r.p.waitForSelector('[data-testid="signin-pin1"], [data-testid="signin-in"], [data-testid="signin-why"]', { timeout: 10000 });
  r.shots.push(await r.shot('3-verified'));
  if (await r.p.locator('[data-testid="signin-pin1"]').count()) {
    r.setPin = true;
    await r.tap('[data-testid="signin-pin1"]'); await r.p.keyboard.type('4826');
    await r.tap('[data-testid="signin-pin2"]'); await r.p.keyboard.type('4826');
    await r.tap('[data-testid="signin-pinsave"]');
    await r.p.waitForSelector('[data-testid="signin-in"], [data-testid="signin-why"]', { timeout: 10000 });
    r.shots.push(await r.shot('4-pin-set'));
  }
  if (await r.p.locator('[data-testid="lab-signed-in"]').count() || await r.p.locator('[data-testid="signin-in"]').count()) {
    await r.p.waitForSelector('[data-testid="lab-can"]', { timeout: 10000 }).catch(() => {});
    r.shots.push(await r.shot('5-signed-in'));
    r.apps = await r.p.evaluate(() => Array.from(document.querySelectorAll('[data-testid="lab-app"]')).map((e) => e.dataset.app + ':' + e.dataset.ok));
    r.actions = await r.p.evaluate(() => Array.from(document.querySelectorAll('[data-testid="lab-action"]')).map((e) => e.dataset.action + ':' + e.dataset.ok));
    r.level = await r.p.evaluate(() => (document.querySelector('[data-testid="lab-level"]') || {}).textContent || null);
    r.planned = await r.p.evaluate(() => Array.from(document.querySelectorAll('[data-testid="lab-planned"]')).map((e) => e.textContent));
    r.costs = await r.p.evaluate(() => (document.querySelector('[data-testid="lab-costs"]') || {}).className || '');
    r.hatgate = await r.p.evaluate(() => (document.querySelector('[data-testid="lab-hatgate"]') || {}).textContent || '');
    r.life = await r.p.evaluate(() => (document.querySelector('[data-testid="lab-life"]') || {}).textContent || '');
    r.device = await r.p.evaluate(() => (document.querySelector('[data-testid="lab-device"]') || {}).textContent || '');
    r.method = await r.p.evaluate(() => (document.querySelector('[data-testid="lab-method"]') || {}).textContent || '');
  }
  return r;
}
const fits = (p) => p.evaluate(() => {
  const vw = window.innerWidth, w = document.querySelector('[data-testid="signin-window"]'); if (!w) return { ok: false };
  const ctl = Array.from(w.querySelectorAll('button,input')).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  return { ok: true, out: ctl.filter((e) => { const r = e.getBoundingClientRect(); return r.left < 0 || r.right > vw + 0.5; }).length, small: ctl.filter((e) => e.getBoundingClientRect().height < 40).length, hscroll: document.documentElement.scrollWidth > vw + 1 };
});

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const web = await serve(ROOT.endsWith('public') ? ROOT : path.join(ROOT, 'public'));
  const prac = await practice.start(); PRACTICE_API = prac.url;
  const WEB = 'http://127.0.0.1:' + web.port;
  const b = await chromium.launch();
  const errs = [];
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'app', 'manifest.json'), 'utf8'));

  for (const dev of [LAPTOP, PHONE]) {
    const D = dev.isMobile ? 'phone ' : 'laptop';
    console.log('\n── ' + D + ' · the Sign-in Lab, every combination ' + '─'.repeat(40));

    const o = await lab(b, WEB, dev, 'who=owner&by=email', async (r) => { r.fit = await fits(r.p); await signIn(r); });
    errs.push(...o.errs);
    say(D + ' owner by e-mail → code → signed in; stored id is the user id', o.who === 'Mayur Bhavan' && o.storedId === 'mayuri123' && /owner/.test(o.kind || ''), 'who=' + o.who + ' id=' + o.storedId + ' ' + (o.err || o.why || ''));
    say(D + ' the window fits: nothing off the edge, every control ≥ 40 px, no sideways scroll', o.fit.ok && !o.fit.out && !o.fit.small && !o.fit.hscroll, JSON.stringify(o.fit));
    say(D + ' this browser\'s REAL session was never touched (practice mode keeps its own store)', o.realSess === null && o.store && !!o.store.cb_sess, 'real=' + o.realSess + ' lab=' + Object.keys(o.store || {}).join(','));
    say(D + ' owner: every built app opens; every rail action is allowed (editor)', (o.apps || []).length && o.apps.every((a) => /:true$/.test(a)) && (o.actions || []).length === 8 && o.actions.every((a) => /:true$/.test(a)) && o.level === 'editor', 'apps=' + (o.apps || []).join(' ') + ' actions=' + (o.actions || []).length);
    say(D + ' planned roles are marked, never offered as working', (o.planned || []).length === 3 && o.planned.every((t) => /planned role — not built/.test(t)), JSON.stringify(o.planned));
    say(D + ' what only the server decides says so (hat-gate)', /decided by the server/.test(o.hatgate || ''), o.hatgate);
    say(D + ' session life and device are said (7 days; the page names its device, listed — K-SEC PR A)', /7 days/.test(o.life || '') && /listed/.test(o.device || ''), o.life + ' · ' + o.device);

    const om = await lab(b, WEB, dev, 'who=owner&by=mobile&dev=till', async (r) => { await signIn(r); });
    errs.push(...om.errs);
    say(D + ' owner by MOBILE (named device, till): sent as id, signed in; a listed 30-day session', om.storedId === 'mayuri123' && om.calls[0] && om.calls[0].body.id === '9876543210' && /30 days/.test(om.life || '') && /listed/.test(om.device || ''), 'body=' + JSON.stringify(om.calls[0] && om.calls[0].body) + ' life=' + om.life + ' ' + (om.err || om.why || ''));

    const e1 = await lab(b, WEB, dev, 'who=employee&by=mobile&stage=first', async (r) => { await signIn(r); });
    errs.push(...e1.errs);
    say(D + ' ⭐ employee by mobile, first time: code → ASKED TO SET A PIN → signed in; stored id is bala@mayuri123.br (never typed)', e1.setPin === true && e1.storedId === 'bala@mayuri123.br' && /employee/.test(e1.kind || '') && /then a PIN was set/.test(e1.method || ''), 'setPin=' + e1.setPin + ' id=' + e1.storedId + ' ' + (e1.err || e1.why || ''));
    say(D + ' employee without costs: Accounts and owner-only apps are refused, the till opens', (e1.apps || []).includes('till:true') && (e1.apps || []).includes('accounts:false') && (e1.apps || []).includes('storefront:false') && /\bno\b/.test(e1.costs || ''), (e1.apps || []).join(' '));
    const e2 = await lab(b, WEB, dev, 'who=employee&by=mobile&stage=returning', async (r) => { await signIn(r, { wrongFirst: true }); });
    errs.push(...e2.errs);
    say(D + ' employee returning: the PIN box (4 digits) by mobile; a wrong PIN is a sentence; the right one signs in', (e2.needed === 'pin' || e2.needed === 'code') && (e2.wrongWhy || '').trim() === REFUSED_WORDS && e2.storedId === 'bala@mayuri123.br' && /PIN/.test(e2.method || ''), 'needed=' + e2.needed + ' wrong="' + e2.wrongWhy + '" ' + (e2.err || ''));

    const c = await lab(b, WEB, dev, 'who=customer&by=email', async (r) => { await signIn(r); });
    errs.push(...c.errs);
    say(D + ' customer by e-mail: the customer\'s code; kept as cb_cust@<shop>, never cb_sess; opens no shop app', c.storedId === 'kavi=mail.test@mayuri123.cr' && c.store && !c.store.cb_sess && Object.keys(c.store).some((k) => /^cb_cust@/.test(k)) && (c.apps || []).every((a) => /:false$/.test(a)), 'id=' + c.storedId + ' store=' + Object.keys(c.store || {}).join(',') + ' ' + (c.err || c.why || ''));

    const s = await lab(b, WEB, dev, 'who=shared&by=mobile&stage=returning', async (r) => { await signIn(r, { choose: 'Alpha Timers' }); });
    errs.push(...s.errs);
    say(D + ' ⭐ one mobile, two people: the chooser (2); choosing the employee re-verifies with the STORED id (SEC-143: the chooser follows the secret) and the PIN signs in at Alpha Timers', s.choices === 2 && (s.calls || []).filter((x) => x.path === '/api/signin/verify').length === 2 && s.calls[2] && s.calls[2].body.id === 'athi@alpha-timers.br' && s.storedId === 'athi@alpha-timers.br', 'choices=' + s.choices + ' reask=' + JSON.stringify(s.calls[2] && s.calls[2].body) + ' ' + (s.err || s.why || ''));

    const sp = await lab(b, WEB, dev, 'who=owner&by=email', async (r) => {
      await signIn(r, { wrongFirst: true });
    });
    errs.push(...sp.errs);
    const asks = (sp.calls || []).filter((x) => x.path === '/api/signin/ask').length;
    say(D + ' ⚠️ a spent code is not re-sent: one ask for the whole walk, a wrong code included', asks === 1 && sp.who === 'Mayur Bhavan', 'asks=' + asks + ' ' + (sp.err || ''));

    const lk = await lab(b, WEB, dev, 'who=employee&by=email&stage=locked', async (r) => { await signIn(r); });
    say(D + ' locked: refused with the ONE sentence (never a count, never "locked"), still at the credential box', (lk.why || '').trim() === REFUSED_WORDS && lk.at === 'credential', lk.why);
    const rm = await lab(b, WEB, dev, 'who=employee&by=email&stage=removed', async (r) => { await signIn(r); });
    say(D + ' device removed: "The shop removed this device. Ask the owner."', /removed this device/.test(rm.why || ''), rm.why);

    const au = await lab(b, WEB, dev, 'who=auditor&by=email&stage=returning', async (r) => { await signIn(r); });
    const ac = await lab(b, WEB, dev, 'who=accountant&by=mobile&stage=returning', async (r) => { await signIn(r); });
    say(D + ' auditor (commenter): only message internally; accountant (viewer): nothing — from /engine/rail.js, not typed here',
        au.level === 'commenter' && (au.actions || []).includes('message_internal:true') && au.actions.filter((a) => /:true$/.test(a)).length === 1
        && ac.level === 'viewer' && (ac.actions || []).length === 8 && ac.actions.every((a) => /:false$/.test(a)),
        'auditor=' + (au.actions || []).filter((a) => /:true$/.test(a)).join(',') + ' accountant-ok=' + (ac.actions || []).filter((a) => /:true$/.test(a)).length);

    const hid = await lab(b, WEB, dev, 'who=owner&by=email', async (r) => { r.slots = await r.p.evaluate(() => ['google', 'apple', 'microsoft', 'sso', 'passkey'].filter((k) => document.querySelector('[data-testid="signin-' + k + '"]'))); });
    const shown = await lab(b, WEB, dev, 'who=owner&by=email&slots=shown', async (r) => {
      r.slots = await r.p.evaluate(() => ['google', 'apple', 'microsoft', 'sso', 'passkey'].filter((k) => document.querySelector('[data-testid="signin-' + k + '"]')));
      await r.tap('[data-testid="signin-google"]'); await r.p.waitForTimeout(300);
      r.toast = await r.p.evaluate(() => (document.getElementById('toast') || {}).textContent || '');
      r.shots.push(await r.shot('slots'));
    });
    say(D + ' social / SSO / passkey slots: hidden as in the apps; shown only as stand-ins ("not connected yet")', (hid.slots || []).length === 0 && (shown.slots || []).length === 5 && /not connected yet/.test(shown.toast || ''), 'hidden=' + (hid.slots || []).length + ' shown=' + (shown.slots || []).length + ' "' + shown.toast + '"');

    const rd = await lab(b, WEB, dev, 'tab=roadmap', async (r) => {
      await r.p.waitForSelector('[data-testid="roadmap-group"]', { timeout: 10000 });
      r.groups = await r.p.evaluate(() => Array.from(document.querySelectorAll('[data-testid="roadmap-group"]')).map((e) => e.dataset.state + ':' + e.dataset.count));
      r.entries = await r.p.locator('[data-testid="roadmap-entry"]').count();
      r.shots.push(await r.shot('roadmap'));
    });
    const want = ['built', 'workshop', 'coming'].map((st) => st + ':' + man.entries.filter((e) => e.state === st).length);
    say(D + ' Roadmap: every manifest entry, grouped by state — counts match public/app/manifest.json', JSON.stringify(rd.groups) === JSON.stringify(want) && rd.entries === man.entries.length, JSON.stringify(rd.groups) + ' vs ' + JSON.stringify(want));
    errs.push(...rd.errs);
  }

  console.log('\n── the apps: Accounts and the index mount the same window ' + '─'.repeat(30));
  const api = apiStandIn();
  await new Promise((res) => api.srv.listen(0, '127.0.0.1', res));
  const API = 'http://127.0.0.1:' + api.srv.address().port;
  for (const dev of [LAPTOP, PHONE]) {
    const D = dev.isMobile ? 'phone ' : 'laptop';
    const ctx = await b.newContext(dev);
    await ctx.addInitScript((a) => { try { localStorage.setItem('cb_api_base', a); } catch (_) {} }, API);
    const p = await ctx.newPage(); const perr = []; p.on('pageerror', (e) => perr.push(String(e)));
    const tap = (sel) => (dev.isMobile ? p.tap(sel) : p.click(sel));
    await p.goto(WEB + '/accounts.html');
    await p.waitForSelector('[data-testid="acc-card"] [data-testid="signin-window"]', { timeout: 15000 }).catch(() => {});
    const inCard = await p.locator('[data-testid="acc-card"] [data-testid="signin-window"]').count();
    const bounce = await p.locator('[data-testid="acc-card"] a[href*="app.html"]').count();
    await p.screenshot({ path: path.join(SHOTS, 'signin-' + D.trim() + '-accounts-out.png') });
    say(D + ' Accounts signed out: the window is IN the card; no link to the workshop', inCard === 1 && bounce === 0, 'window=' + inCard + ' bounce=' + bounce);
    await tap('[data-testid="signin-id"]'); await p.keyboard.type('athi@mayur.test'); await tap('[data-testid="signin-go"]');
    await p.waitForSelector('[data-testid="signin-code"]', { timeout: 10000 });
    const CODE = dev.isMobile ? TESTER : '123456';   /* the phone signs in with the TESTER code: 8+ characters, letters and all */
    await tap('[data-testid="signin-code"]'); await p.keyboard.type(CODE); await tap('[data-testid="signin-verify"]');
    await p.waitForFunction(() => !!localStorage.getItem('cb_sess'), null, { timeout: 10000 }).catch(() => {});
    await p.waitForTimeout(800);
    const sess = await p.evaluate(() => { try { return JSON.parse(localStorage.getItem('cb_sess')); } catch (_) { return null; } });
    const owner = await p.evaluate(() => { try { return JSON.parse(localStorage.getItem('cb_owner')); } catch (_) { return null; } });
    await p.screenshot({ path: path.join(SHOTS, 'signin-' + D.trim() + '-accounts-in.png') });
    say(D + ' Accounts: e-mail + code → the apps\' session (cb_sess: token · role · name · entity · bridgeId) and CBOnePerson claims it', !!(sess && sess.token && sess.role === 'entity' && sess.entity === 'Mayur Bhavan' && sess.bridgeId === 'CB-MAYUR') && !!(owner && owner.ent), JSON.stringify(sess) + ' owner=' + JSON.stringify(owner));
    say(D + ' …the code reached /api/signin/verify exactly as typed (' + (dev.isMobile ? 'a tester code, 12 characters' : 'six digits') + ')', api.calls.some((c) => c.u === '/api/signin/verify' && c.b.otp === CODE), api.calls.filter((c) => c.u === '/api/signin/verify').map((c) => String(c.b.otp || '').length + ' chars').join(' '));
    say(D + ' …and every call went to the sign-in door only', api.calls.filter((c) => /^\/api\/(signin|entities\/register)/.test(c.u)).every((c) => /^\/api\/signin\//.test(c.u)), api.calls.map((c) => c.u).filter((u) => /signin|register/.test(u)).join(' '));
    /* the index: signed out, the avatar's door opens the window in place */
    await p.evaluate(() => { localStorage.removeItem('cb_sess'); localStorage.removeItem('cb_owner'); });
    await p.goto(WEB.replace(/\/$/, '') + '/signin-lab.html?who=owner&api=' + encodeURIComponent(PRACTICE_API));   /* warm the origin, then the root index served below */
    await ctx.close();
  }
  /* the repo-root index.html at / (as it deploys): the door is a BUTTON that opens the window, no app.html link */
  const idx = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '');
    const f = (!rel || rel === 'index.html') ? path.join(ROOT, 'index.html') : path.join(ROOT, 'public', rel);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(f).pipe(r);
  });
  await new Promise((res) => idx.listen(0, '127.0.0.1', res));
  const IDX = 'http://127.0.0.1:' + idx.address().port;
  for (const dev of [LAPTOP, PHONE]) {
    const D = dev.isMobile ? 'phone ' : 'laptop';
    const ctx = await b.newContext(dev);
    await ctx.addInitScript((a) => { try { localStorage.setItem('cb_api_base', a); } catch (_) {} }, API);
    const p = await ctx.newPage(); const perr = []; p.on('pageerror', (e) => perr.push(String(e)));
    const tap = (sel) => (dev.isMobile ? p.tap(sel) : p.click(sel));
    await p.goto(IDX + '/');
    await p.waitForSelector('[data-testid="signin-door"]', { timeout: 15000 });
    const doorTag = await p.evaluate(() => document.querySelector('[data-testid="signin-door"]').tagName);
    await tap('[data-testid="signin-door"]');
    await p.waitForSelector('[data-testid="shell-signin"] [data-testid="signin-window"]', { timeout: 10000 }).catch(() => {});
    const opened = await p.locator('[data-testid="signin-window"]').count();
    const focused = await p.evaluate(() => (document.activeElement || {}).getAttribute && document.activeElement.getAttribute('data-testid'));
    await p.screenshot({ path: path.join(SHOTS, 'signin-' + D.trim() + '-index-door.png') });
    say(D + ' the index (front door): ONE window in the shell slot; Sign in is a button that brings you to its box — nothing names the workshop', doorTag === 'BUTTON' && opened === 1 && focused === 'signin-id', 'door=' + doorTag + ' windows=' + opened + ' focused=' + focused);
    await tap('[data-testid="signin-id"]'); await p.keyboard.type('9876543210'); await tap('[data-testid="signin-go"]');
    await p.waitForSelector('[data-testid="signin-code"], [data-testid="signin-why"]', { timeout: 10000 });
    /* the real api tells nobody an account does not exist: the ask is answered as for anyone (ASK_ANSWER), a made-up secret is refused with the ONE sentence */
    const asked = await p.locator('[data-testid="signin-code"]').count();
    await tap('[data-testid="signin-code"]'); await p.keyboard.type('000000'); await tap('[data-testid="signin-verify"]');
    await p.waitForSelector('[data-testid="signin-why"]', { timeout: 10000 });
    const why = await p.evaluate(() => { const e = document.querySelector('[data-testid="signin-why"]'); return e ? e.textContent.trim() : ''; });
    say(D + ' an unknown mobile on the index: asked like anyone, then refused with the one sentence — nothing registered, nothing said about the account', asked === 1 && why === REFUSED_WORDS && api.calls.every((c) => c.u !== '/api/entities/register'), why);
    errs.push(...perr);
    await ctx.close();
  }
  idx.close(); api.srv.close();
  await b.close(); web.close(); await prac.close();
  console.log('\nshots: e2e/shots/signin-*.png');
  say('no page errors', errs.length === 0, errs.length ? errs.join(' | ').slice(0, 300) : 'none');
  console.log('\n' + (bad ? '✗ ' + bad + ' FAILED\n' : '✓ all good\n'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
