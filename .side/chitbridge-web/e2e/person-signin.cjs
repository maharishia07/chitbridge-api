/* person-signin.cjs — ⭐⭐⭐ M08 · A PHONE IS A PERSON ON A DEVICE (MASTER-BUILD row 47 · SPEC-iam-build PR 8 · DESIGN-person-signin)
 *
 * DECIDED (2026-10 cycle): *"A phone is a person session (ID + PIN), not a device key."* Until M08 a browser counter spent
 * its sign-in on POST /api/till/enrol, became "Counter C1" (the shop PC's number), and the PC's next sign-in closed it —
 * the ping-pong behind Athi's phone showing "Due to maintenance" with its bills stuck (DESIGN §1.1).
 *
 * Driven through the screen at phone size (390×844, touch, typed code), against a stand-in ChitBridge that answers
 * /api/signin/ask·verify, /api/till/snapshot and /api/chits/send exactly as the M05/M06 server does (a listed session
 * bound to X-Device-Id; a key keeps working). Every state is photographed to e2e/shots/person-signin-*.png.
 *
 *   T0  ⚠️⚠️ A PHONE THAT ALREADY HOLDS A KEY (Athi's own phone, with UNSENT bills in its key store): after the M08 page
 *       loads, the same store is read, its bills are still listed, and they still go under the key. Nothing moved, renamed
 *       or cleared until the person signs in (M10, T7); the phone is asked once to sign in as itself.
 *   T1  a fresh phone signs in as a PERSON: no POST /api/till/enrol, no /api/counters, no key; a 30-day session bound to
 *       this device; the store is per shop + device.
 *   T2  the shop PC opens C1 while the phone bills 3 times: the phone never sees a 401, never hears COUNTER_HELD, its
 *       prefix is not C1, and the 3 bills land once (a second drain adds nothing).
 *   T3  a PC takes C1 over from another PC: the phone is untouched — same session, next bill lands.
 *   T4  words per code: SESSION_EXPIRED → "Sign in to send 1 bill" (never "maintenance"); signing in again keeps the queue
 *       and the same client_ref; DEVICE_REVOKED → "The shop removed this phone" + what is kept.
 *   T5  the page's own version check reloads ONCE and clears nothing — bills, session and device id survive.
 *   T6  ⭐⭐⭐ M09 (SPEC PR 9 "T4") OFFLINE FOR DAYS: the counter PIN locks and unlocks the phone with no line; 20 bills
 *       are taken; the session has EXPIRED meanwhile → "Sign in to send 20 bills" (never "maintenance"); a sign-in by code
 *       lands all 20 once, same client_refs, every bill stamped till.device_id = this phone and till.by = the person;
 *       the token issued a day+ ago is RENEWED after the next good snapshot (new jti, old one refused).
 *   T7  ⭐⭐⭐ M10 (SPEC PR 10) THE OLD KEY STORE COMES ALONG: a keyed phone with 1 sent + 3 unsent bills signs in → the
 *       page reloads as the person, copies every row into the person store, PROVES the copy (count + client_refs), marks
 *       the old store moved (never deletes it), sends the 3 once under their old prefix, and only then lets cb_till_key go.
 *       A store of another shop on the same phone is untouched. A second phone CRASHES (reload) between the copy and the
 *       mark → the next open re-runs the copy: no loss, no duplicate; a lost mark replays the same way (0 re-sent).
 *   T8  ⭐⭐ M09 (SPEC PR 9 "T5") ONE PERSON, TWO PHONES: two device ids, two prefixes, two stores, two listed sessions;
 *       each phone's bill lands under its own device; neither signs the other out.
 *
 * Run: node e2e/person-signin.cjs         (ports from the OS; never localhost:3000, never the live site)
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..', 'public');
const SHOTS = path.join(__dirname, 'shots');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(74) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, locale: 'en-IN',
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36' };
const TEA = { item_id: 't1', name: 'Tea', code: 'T1', category: 'Drinks', unit: 'cup', price: 15 };
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
/** djb2 of the key, base 36 — exactly tillStore()'s name for a KEY store (the one Athi's phone holds today) */
const keyStore = (k) => { let h = 5381; for (let i = 0; i < k.length; i++) h = (((h * 33) ^ k.charCodeAt(i)) >>> 0); return 'cb-till-' + h.toString(36); };

/**
 * ⭐ THE STAND-IN CHITBRIDGE. A person session is a token that names its jti + device; the server honours it only while
 * the jti is listed and X-Device-Id matches (M05). A key (KEY-OLD) is honoured as today. The shop PC's claims change
 * REG and close PC keys — a phone holds no key, so there is nothing of hers to close.
 */
function standIn() {
  const calls = [], chits = [], sessions = {}, devices = {};
  const REG = { C1: { held_by: 'Shop PC', key: 'KEY-PC' } };
  const KEYS = { 'KEY-OLD': { counter: 'C2', closed: false }, 'KEY-OLD2': { counter: 'C3', closed: false }, 'KEY-OLD3': { counter: 'C4', closed: false }, 'KEY-PC': { counter: 'C1', closed: false } };
  const PEOPLE = { athi: { identity_id: 'ent-a', user_id: 'athi', display_name: 'Athi', identity_type: 'entity', entity_id: 'ent-a', bridge_id: 'CB-A' } };
  let issued = null;
  const flag = { oldIat: false };                          /* M09 T6: issue the next token as if a day ago, so the page renews it */
  /** a listed session for this person on this device, as /api/signin/verify and /renew both mint it (M05) */
  const mint = (p, device_id, surface, iat) => {
    const jti = crypto.randomUUID();
    sessions[jti] = { device_id, surface, by: p.identity_id, iat, exp: iat + (surface === 'till' ? 30 : 7) * 86400 };
    devices[device_id] = devices[device_id] || { first_seen: iat, revoked_at: null, sessions: [] };
    devices[device_id].sessions.push(jti);
    const token = b64u({ alg: 'none' }) + '.' + b64u({ identity_id: p.identity_id, identity_type: 'entity', display_name: p.display_name, bridge_id: p.bridge_id,
                  kind: 'person', jti, device_id, surface, iat, exp: sessions[jti].exp }) + '.sig';
    return { jti, token };
  };
  const snap = (till) => ({ at: new Date().toISOString(), entity_id: 'ent-a', shop: { name: 'Athi Stores', bridge_id: 'CB-A', currency: 'INR', country: 'IN' },
    staff: [], items: [TEA], offers: [], till });
  const srv = http.createServer(async (q, r) => {
    let raw = ''; for await (const c of q) raw += c;
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    const u = q.url.split('?')[0];
    let b = {}; try { b = raw ? JSON.parse(raw) : {}; } catch (_) {}
    const rec = { m: q.method, u, b, dev: q.headers['x-device-id'] || null,
                  auth: q.headers.authorization ? 'bearer' : (q.headers['x-api-key'] ? 'key' : null), status: 0, code: null };
    const j = (c2, o) => { rec.status = c2; rec.code = (o && o.code) || null; r.writeHead(c2, Object.assign({ 'content-type': 'application/json' }, cors)); r.end(JSON.stringify(o)); };
    if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
    calls.push(rec);
    /* who is calling — a key, or a person session (verified like middleware/auth.js does) */
    const who = (() => {
      const key = q.headers['x-api-key'];
      if (key) { const k = KEYS[key]; if (!k) return { err: [401, { error: 'Unauthorised', message: 'API key revoked or unknown' }] };
                 if (k.closed) return { err: [401, { error: 'Unauthorised', code: 'COUNTER_CLOSED', message: 'closed' }] }; return { key, counter: k.counter }; }
      const tok = String(q.headers.authorization || '').replace(/^Bearer /, '');
      if (!tok) return null;
      let p = null; try { p = JSON.parse(Buffer.from(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()); } catch (_) {}
      if (!p || !p.jti) return { err: [401, { error: 'Unauthorised', message: 'bad token' }] };
      if (String(q.headers['x-device-id'] || '') !== String(p.device_id)) return { err: [401, { error: 'Unauthorised', code: 'DEVICE_MISMATCH', message: 'This sign-in belongs to another device. Sign in on this one.' }] };
      if (devices[p.device_id] && devices[p.device_id].revoked_at) return { err: [401, { error: 'Unauthorised', code: 'DEVICE_REVOKED', message: 'The shop removed this device. Your bills are kept here; ask the owner.' }] };
      if (!sessions[p.jti]) return { err: [401, { error: 'Unauthorised', code: 'SESSION_EXPIRED', message: 'Sign in to continue.' }] };
      /* M09: a session past its exp is refused exactly like a forgotten one (lib/person-session) */
      if (Number(sessions[p.jti].exp) <= Math.floor(Date.now() / 1000)) return { err: [401, { error: 'Unauthorised', code: 'SESSION_EXPIRED', message: 'Sign in to continue.' }] };
      return { person: p };
    })();
    if (u === '/api/signin/ask' || u === '/api/entities/register') {
      const p = PEOPLE[String(b.user_id || b.email || b.id || '').trim().toLowerCase()];
      if (!p) return j(404, { error: 'Not found', code: 'NO_ACCOUNT', message: 'That user ID is not known here.' });
      issued = p.user_id;                                   /* ⚠️ like production: the code is NOT echoed back */
      return j(200, { message: 'Verification code sent to your email', email: 'a***@example.com' });
    }
    if (u === '/api/signin/verify' || u === '/api/entities/verify') {
      const p = PEOPLE[String(b.user_id || b.email || b.id || '').trim().toLowerCase()];
      if (!p) return j(400, { error: 'Verification failed', message: 'That User ID is not recognised.' });
      if (issued !== p.user_id || b.otp !== '123456') return j(400, { error: 'Verification failed', message: 'Invalid or expired OTP' });
      issued = null;
      const device_id = b.device_id || q.headers['x-device-id'] || null;
      const now = Math.floor(Date.now() / 1000);
      let token;
      if (device_id) {                                       /* M05: a page that names its device gets a LISTED session */
        if (devices[device_id] && devices[device_id].revoked_at) return j(401, { error: 'Unauthorised', code: 'DEVICE_REVOKED', message: 'The shop removed this device.' });
        token = mint(p, device_id, b.surface || 'web', flag.oldIat ? now - 25 * 3600 : now).token;
      } else token = b64u({ alg: 'none' }) + '.' + b64u({ identity_id: p.identity_id, identity_type: 'entity', iat: now, exp: now + 7 * 86400 }) + '.sig';
      return j(200, { message: 'Verified successfully', token, entity: { identity_id: p.identity_id, bridge_id: p.bridge_id, display_name: p.display_name },
        identity: { identity_id: p.identity_id, user_id: p.user_id, display_name: p.display_name, identity_type: 'entity', entity_id: p.entity_id, bridge_id: p.bridge_id } });
    }
    /* ⚠️ a phone must never reach these — they are the counter-claim doors (the shop PC's) — but if it does, answer as the server would */
    if (u === '/api/till/enrol') { rec.code = 'ENROL'; return j(409, { error: 'Counter already open', code: 'COUNTER_HELD', counter: { id: 'C1', held_by: { name: 'Shop PC' } } }); }
    if (u.indexOf('/api/counters') === 0) return j(200, { counters: Object.keys(REG).map((id) => ({ id, state: REG[id].held_by ? 'open' : 'closed' })) });
    if (!who) return j(401, { error: 'Unauthorised', message: 'No token' });
    if (who.err) return j(who.err[0], who.err[1]);
    /* M09: renew — a new jti on the same device, the old one forgotten (routes/signin.js) */
    if (u === '/api/signin/renew') {
      if (!who.person) return j(403, { error: 'Refused', code: 'KEY_CANNOT_SIGN_IN', message: 'A key has no session to renew.' });
      const old = who.person.jti, s = sessions[old], pp = PEOPLE[Object.keys(PEOPLE).find((k) => PEOPLE[k].identity_id === who.person.identity_id)];
      const m = mint(pp, s.device_id, s.surface, Math.floor(Date.now() / 1000));
      delete sessions[old]; devices[s.device_id].sessions = devices[s.device_id].sessions.filter((x) => x !== old);
      return j(200, { token: m.token, jti: m.jti, exp: sessions[m.jti].exp, device_id: s.device_id, surface: s.surface });
    }
    if (u === '/api/till/snapshot')
      return j(200, snap(who.key ? { assigned_id: who.counter, counter: who.counter, counter_name: 'Counter ' + who.counter.slice(1), resume_next: 1 } : null));
    if (u === '/api/till/verify') return j(200, { ok: true, shop: 'Athi Stores' });
    if (u === '/api/chits/send') {
      const ref = b.client_ref || null;
      const dup = chits.find((c) => c.client_ref === ref);
      if (dup) return j(200, { ok: true, chit_id: dup.chit_id, duplicate: true, client_ref: ref });
      const chit_id = 'chit-' + (chits.length + 1);
      chits.push({ chit_id, client_ref: ref, till: (b.business_json && b.business_json.till) || null, by: who.person ? who.person.identity_id : 'key', at: Date.now() });
      return j(201, { ok: true, chit_id, client_ref: ref });
    }
    if (u === '/api/till/bills') return j(200, { bills: [] });
    if (u === '/api/till/tasks') return j(200, { tasks: [] });
    if (u === '/api/events/ticket') return j(200, { ticket: null });
    return j(200, { ok: true });
  });
  /* what the shop PC does to the register — a phone never calls these; they happen beside it */
  const pcClaim = (id, from, takeover) => { const c = REG[id] || (REG[id] = {}); if (c.key && takeover) KEYS[c.key].closed = true; c.held_by = from; c.key = 'KEY-' + from.replace(/\s+/g, '').toUpperCase(); KEYS[c.key] = { counter: id, closed: false }; };
  return { srv, calls, chits, sessions, devices, REG, KEYS, pcClaim, flag,
           revokeSession: (jti) => { delete sessions[jti]; }, revokeDevice: (d) => { (devices[d] = devices[d] || { sessions: [] }).revoked_at = Date.now(); },
           /** M09: the session reached its exp while the phone was away — still listed, no longer honoured */
           expireSession: (jti) => { if (sessions[jti]) sessions[jti].exp = Math.floor(Date.now() / 1000) - 1; } };
}

function webServer(flag) {
  return http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const f = path.join(ROOT, rel);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    if (rel === 'engine/versions.json' && flag.laterPage) {        /* T5: the server has a NEWER page than the one running */
      const j = JSON.parse(fs.readFileSync(f, 'utf8')); j.page = 'later-than-this';
      r.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); return r.end(JSON.stringify(j));
    }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
}

/** ring one bill through the screen: Tea → Pay → Cash. Returns once the page has a new last bill. */
async function ringBill(p) {
  const before = await p.evaluate(async () => ((await DB.all('bills')) || []).length);
  /* a phone sells in steps — Pick first, where the shelf and the search box are */
  await p.evaluate(() => { try { usignClose(); } catch (_) {} });
  /* the counter must have been GIVEN its number (tillClaim, after the first snapshot) — a bill before that is refused with a dialog */
  await p.waitForFunction(async () => { try { return (await tillGivenOK()) && shopReady().stops.length === 0; } catch (_) { return false; } }, null, { timeout: 20000 }).catch(() => {});
  if (await p.locator('[data-testid="till-step-pick"]').count()) await p.tap('[data-testid="till-step-pick"]');
  await p.waitForSelector('#q', { state: 'visible', timeout: 10000 });
  await p.fill('#q', 'Tea');
  await p.waitForSelector('[data-testid="till-hit-0"][data-item="t1"]', { timeout: 10000 });
  await p.tap('[data-testid="till-add-0"]');
  await p.tap('[data-testid="till-step-pay"]');
  await p.tap('[data-testid="till-pay-cash"]');
  await p.tap('#save');                                           /* Save & print · F9 — the bill is written here */
  await p.waitForFunction(async (n) => ((await DB.all('bills')) || []).length > n, before, { timeout: 15000 });
  await p.waitForTimeout(300);
  await p.evaluate(() => { Array.prototype.slice.call(document.querySelectorAll('dialog[open]')).forEach(function(d){ try { d.close(); } catch (_) {} }); });
}
/** the stand-in's chit count, once it stops moving (drain is asynchronous on the page) */
async function settle(api, want, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 12000)) { if (api.chits.length >= want) break; await new Promise((r) => setTimeout(r, 200)); }
  return api.chits.length;
}
/** the real dialog, as a person: user id → Send me a code → 123456 → Sign in */
async function signIn(p, who) {
  if (!(await p.locator('#usigndlg[open]').count())) {
    /* M112: on a phone the who pill is hidden; who lives in the ☰ menu (hubWhoRow) */
    if (await p.locator('[data-testid="till-who"]').isVisible()) await p.tap('[data-testid="till-who"]');
    else { await p.tap('[data-testid="till-menu"]'); await p.tap('[data-testid="till-hub-who-act"]'); }
  }
  await p.waitForSelector('#usigndlg[open] [data-testid="signin-id"]', { timeout: 10000 });
  await p.fill('[data-testid="signin-id"]', who);
  await p.tap('[data-testid="signin-go"]');
  await p.waitForSelector('[data-testid="signin-code"], [data-testid="signin-why"]', { timeout: 10000 });
  await p.fill('[data-testid="signin-code"]', '123456');
  await p.tap('[data-testid="signin-verify"]');
}
/** after a sign-in: choose a counter PIN if offered, then Done */
async function afterIn(p, pin) {
  await p.waitForSelector('[data-testid="signin-pin1"], [data-testid="till-usign-in"], [data-testid="signin-why"]', { timeout: 20000 }).catch(() => {});
  if (await p.locator('[data-testid="signin-pin1"]').count()) {
    if (pin) { await p.fill('[data-testid="signin-pin1"]', pin); await p.fill('[data-testid="signin-pin2"]', pin); await p.tap('[data-testid="signin-pinsave"]'); }
    else await p.tap('[data-testid="signin-later"]');
    await p.waitForSelector('[data-testid="till-usign-in"]', { timeout: 10000 }).catch(() => {});
  }
  if (await p.locator('[data-testid="till-usign-done"]').count()) await p.tap('[data-testid="till-usign-done"]');
  await p.waitForTimeout(300);
}
const facts = (p) => p.evaluate(async () => ({
  who: (typeof WHO !== 'undefined' && WHO && WHO.name) || null,
  key: localStorage.getItem('cb_till_key'),
  person: (function(){ try { return JSON.parse(localStorage.getItem('cb_till_person') || 'null'); } catch (_) { return null; } })(),
  device: localStorage.getItem('cb_device_id'),
  store: tillStore(), prefix: tillId(), shop: (S && S.shop && S.shop.name) || null,
  bills: ((await DB.all('bills')) || []).length, queue: ((await DB.all('queue')) || []).length,
  given: ls.get(tillGivenKey(), ''), flash: ((document.getElementById('flash') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
  keyOk: typeof KEY_OK !== 'undefined' ? KEY_OK : null, build: typeof TILL_BUILD !== 'undefined' ? TILL_BUILD : null,
}));

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const flag = { laterPage: false };
  const web = webServer(flag);
  await new Promise((res) => web.listen(0, '127.0.0.1', res));
  const WEB = 'http://127.0.0.1:' + web.address().port;
  const api = standIn();
  await new Promise((res) => api.srv.listen(0, '127.0.0.1', res));
  const API = 'http://127.0.0.1:' + api.srv.address().port;
  const b = await chromium.launch();
  const errs = [];
  const shot = (p, n) => p.screenshot({ path: path.join(SHOTS, 'person-signin-' + n + '.png') });

  /* ── T0 ───────────────────────────────────────────────────────────────────────────────────────────────────── */
  console.log('\n── T0 ⚠️⚠️ A PHONE THAT ALREADY HOLDS A KEY, WITH UNSENT BILLS — the M08 page must read the same store, list them, send them');
  {
    const ctx = await b.newContext(PHONE);
    await ctx.addInitScript((a) => { try { if (!localStorage.getItem('cb_till_api')) { localStorage.setItem('cb_till_api', a); localStorage.setItem('cb_till_key', 'KEY-OLD'); } } catch (_) {} }, API);
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push('T0 ' + e));
    await p.goto(WEB + '/till.html');
    await p.waitForFunction(() => typeof usignOpen === 'function' && S && S.shop && S.shop.name === 'Athi Stores', null, { timeout: 30000 });
    const k0 = await facts(p);
    say('the keyed phone opens its shop by its KEY, in the key-named store', k0.key === 'KEY-OLD' && k0.store === keyStore('KEY-OLD') && !k0.person, 'store=' + k0.store + ' person=' + JSON.stringify(k0.person));
    /* ⭐ M10: a keyed phone is asked ONCE to sign in as itself (the key path ends with M13) — and keeps billing under the key meanwhile */
    const nudge0 = await p.evaluate(() => ((document.getElementById('flash') || {}).innerText || '').replace(/\s+/g, ' ').trim());
    say('the keyed phone is asked once: "Sign in once with your user ID" — never "maintenance", nothing moved yet', /Sign in once with your user ID/.test(nudge0) && !/maintenance/i.test(nudge0) && k0.key === 'KEY-OLD', JSON.stringify(nudge0).slice(0, 90));
    if (await p.locator('[data-testid="till-flash-x"]').count()) await p.tap('[data-testid="till-flash-x"]');
    /* the phone as it is TODAY: a person signed in at the counter — identity only, no session (pre-M08) — under a KEY (G2's writer) */
    await p.evaluate(() => usignAdopt({ id: 'athi', name: 'Athi', kind: 'entity', entity: 'ent-a' }));
    const callsBefore = api.calls.length;
    await ctx.setOffline(true);
    await ringBill(p); await ringBill(p);
    const k2 = await facts(p);
    say('two bills taken with the line down sit in the key store\'s queue', k2.bills === 2 && k2.queue === 2 && k2.prefix === 'C2', 'bills=' + k2.bills + ' queue=' + k2.queue + ' prefix=' + k2.prefix);
    await shot(p, 't0-queued');
    /* ⭐ THE M08 PAGE LOADS AGAIN over that store (same page, same code — exactly what a deploy does to Athi's phone) */
    await ctx.setOffline(false);
    await p.reload();
    await p.waitForFunction(() => typeof usignOpen === 'function' && S && S.shop && S.shop.name === 'Athi Stores', null, { timeout: 30000 });
    const k3 = await facts(p);
    /* (the line is back, so load() may already have started sending — the queue is 2 or fewer, never more, never re-stamped) */
    say('⭐⭐⭐ after the reload the SAME key store is read: both bills still listed, still queued/sending', k3.store === keyStore('KEY-OLD') && k3.bills === 2 && k3.queue <= 2 && !k3.person, 'store=' + k3.store + ' bills=' + k3.bills + ' queue=' + k3.queue);
    if (await p.locator('[data-testid="till-flash-x"]').count()) await p.tap('[data-testid="till-flash-x"]');
    await p.evaluate(() => HOST.drain());
    const landed = await settle(api, 2);
    await p.waitForFunction(async () => ((await DB.all('queue')) || []).length === 0, null, { timeout: 8000 }).catch(() => {});   /* the chits land before the queue rows are cleared: wait for the clear, a race otherwise */
    const k4 = await facts(p);
    say('⭐⭐⭐ and they still go — under the key, once each', landed === 2 && k4.queue === 0 && api.chits.every((c) => c.by === 'key' && /^C2\//.test(c.client_ref)), 'landed=' + landed + ' queue=' + k4.queue + ' refs=' + api.chits.map((c) => c.client_ref).join(','));
    const t0calls = api.calls.slice(callsBefore);
    say('every call the keyed phone made was signed with its KEY (the key path is byte-for-byte as before)', t0calls.filter((c) => c.u.indexOf('/api/till') === 0 || c.u === '/api/chits/send').every((c) => c.auth === 'key'), t0calls.map((c) => c.auth + ':' + c.u).filter((x, i, a) => a.indexOf(x) === i).join(' '));
    say('no sign-in session was asked for and no enrol happened', !api.calls.some((c) => c.u === '/api/till/enrol' || c.u.indexOf('/api/counters') === 0), api.calls.filter((c) => c.u.indexOf('/api/till') < 0).map((c) => c.u).join(' '));
    await shot(p, 't0-sent');
    await ctx.close();
  }
  const chitsAfterT0 = api.chits.length;

  /* ── T1 ───────────────────────────────────────────────────────────────────────────────────────────────────── */
  console.log('\n── T1 ⭐⭐⭐ A FRESH PHONE SIGNS IN AS A PERSON — no key, no counter claimed, a session bound to this device');
  const ctx = await b.newContext(PHONE);
  await ctx.addInitScript((a) => { try { if (!localStorage.getItem('cb_till_api')) localStorage.setItem('cb_till_api', a); } catch (_) {} }, API);
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push('T1+ ' + e));
  let loads = 0; p.on('load', () => loads++);
  await p.goto(WEB + '/till.html');
  await p.waitForFunction(() => typeof usignOpen === 'function' && typeof becomeShop === 'function', null, { timeout: 30000 });
  await p.waitForTimeout(500);
  const f0 = await facts(p);
  await shot(p, 't1-fresh');
  const stop0 = await p.evaluate(() => (shopReady().stops[0] || {}));
  say('a fresh phone says "nobody has signed in", never "maintenance" and never "key"', /signed in/i.test(stop0.why || '') && !/maintenance|key/i.test((stop0.why || '') + (stop0.means || '')), JSON.stringify(stop0.why));
  const callsT1 = api.calls.length;
  await signIn(p, 'athi');
  await p.waitForFunction(() => typeof S !== 'undefined' && S && S.shop && S.shop.name === 'Athi Stores', null, { timeout: 30000 }).catch(() => {});
  await afterIn(p, '4826');
  await shot(p, 't1-signed-in');
  const f1 = await facts(p);
  const verifyCall = api.calls.slice(callsT1).find((c) => c.u === '/api/signin/verify');
  say('⭐ user id + 123456 → the phone reloads into the shop, signed in', f1.who === 'Athi' && f1.shop === 'Athi Stores', 'who=' + f1.who + ' shop=' + f1.shop + ' loads=' + loads);
  say('⭐⭐⭐ no POST /api/till/enrol, no /api/counters — a phone claims no counter', !api.calls.some((c) => c.u === '/api/till/enrol' || c.u.indexOf('/api/counters') === 0), api.calls.slice(callsT1).map((c) => c.u).filter((x, i, a) => a.indexOf(x) === i).join(' '));
  say('⭐⭐ no key on the phone; a person session is kept instead, naming its shop', f1.key === null && f1.person && f1.person.entity_id === 'ent-a' && f1.person.by === 'athi' && !!f1.person.jti, 'key=' + f1.key + ' person=' + JSON.stringify(f1.person && { entity_id: f1.person.entity_id, by: f1.person.by }));
  say('the sign-in named this device and the surface (a 30-day listed session, D3)', verifyCall && verifyCall.b.device_id === f1.device && verifyCall.b.surface === 'till' && verifyCall.dev === f1.device && api.sessions[f1.person.jti] && api.sessions[f1.person.jti].exp - api.sessions[f1.person.jti].iat === 30 * 86400, JSON.stringify(verifyCall && { device_id: verifyCall.b.device_id, surface: verifyCall.b.surface }));
  say('the device id was made once (at the first cloud call), device-wide, and is the same after the reload', !!f1.device && verifyCall && verifyCall.b.device_id === f1.device && f1.device === f1.person.device_id && (f0.device === null || f0.device === f1.device), f1.device);
  say('⭐⭐ the store is per SHOP + DEVICE (never per token)', f1.store === 'cb-till-ent-a-' + String(f1.device).replace(/[^A-Za-z0-9_-]/g, ''), f1.store);
  const snaps = api.calls.filter((c) => c.u === '/api/till/snapshot' && c.auth === 'bearer');
  say('the snapshot was read with the session as Bearer + X-Device-Id (no key header)', snaps.length >= 1 && snaps.every((c) => c.dev === f1.device && c.status === 200), 'snapshots=' + snaps.length);
  say('the phone has its own bill prefix — not C1, the shop PC\'s', /^D[0-9A-Z]{3}$/.test(f1.prefix) && !!f1.given, 'prefix=' + f1.prefix + ' given=' + f1.given);

  /* ── T2 ───────────────────────────────────────────────────────────────────────────────────────────────────── */
  console.log('\n── T2 ⭐⭐⭐ THE SHOP PC OPENS C1 WHILE THE PHONE BILLS — 0×401 on the phone, prefix ≠ C1, 3 bills land once');
  const t2from = api.calls.length;
  await ringBill(p);
  await p.waitForTimeout(1500);
  console.log('     probe after bill 1: ' + JSON.stringify(await p.evaluate(async () => ({ last: HOST.last, line: lineUp(), onLine: navigator.onLine, st: lineState().state,
    queued: STATE && STATE.queued, q: ((await DB.all('queue')) || []).length, bills: ((await DB.all('bills')) || []).length, busy: HOST._busy, cred: HOST.cred(), owner: OWNER, mem: MEM.on }))).slice(0, 600));
  api.pcClaim('C1', 'Shop PC', false);          /* the PC signs in again and opens C1 — beside the phone */
  await ringBill(p);
  api.pcClaim('C1', 'Shop PC', true);           /* …and once with takeover, as its morning enrol does */
  await ringBill(p);
  const t2land = await settle(api, chitsAfterT0 + 3);
  const t2calls = api.calls.slice(t2from);
  const f2 = await facts(p);
  await shot(p, 't2-three-bills');
  say('⭐⭐⭐ the phone never received a 401 while the PC opened C1', t2calls.every((c) => c.status < 400), 'statuses=' + t2calls.map((c) => c.status).filter((x, i, a) => a.indexOf(x) === i).join(','));
  say('⭐⭐⭐ the phone never heard COUNTER_HELD and never asked for a counter', !api.calls.some((c) => c.code === 'COUNTER_HELD' || c.code === 'ENROL' || c.u.indexOf('/api/counters') === 0), 'codes=' + api.calls.map((c) => c.code).filter(Boolean).join(',') || 'none');
  const mine = api.chits.slice(chitsAfterT0);
  say('⭐⭐ all 3 bills landed, once each, as the person on this device', t2land === chitsAfterT0 + 3 && mine.length === 3 && mine.every((c) => c.by === 'ent-a') && f2.queue === 0, 'landed=' + mine.length + ' queue=' + f2.queue);
  say('⭐⭐ their prefix is the phone\'s own — not C1', mine.every((c) => c.client_ref.indexOf(f1.prefix + '/') === 0 && c.client_ref.indexOf('C1/') !== 0), mine.map((c) => c.client_ref).join(' '));
  say('the bill records the counter label it was billed under', mine.every((c) => c.till && c.till.id === f1.prefix), JSON.stringify(mine[0] && mine[0].till));
  await p.evaluate(() => HOST.drain());
  await p.waitForTimeout(800);
  say('a second drain adds nothing (client_ref makes a retry harmless)', api.chits.length === chitsAfterT0 + 3, 'chits=' + api.chits.length);
  say('and the shop PC still holds C1 — nothing of the PC was touched by the phone', api.REG.C1.held_by === 'Shop PC', JSON.stringify(api.REG.C1));

  /* ── T3 ───────────────────────────────────────────────────────────────────────────────────────────────────── */
  console.log('\n── T3 ⭐⭐ A PC TAKES C1 OVER FROM ANOTHER PC — the phone\'s session is untouched');
  const t3from = api.calls.length, jtiBefore = f2.person.jti;
  api.pcClaim('C1', 'Other PC', true);          /* closes KEY-SHOPPC; the phone holds no key */
  await p.evaluate(() => refresh().catch(function(){}));
  await p.waitForTimeout(800);
  await ringBill(p);
  const t3land = await settle(api, chitsAfterT0 + 4);
  const f3 = await facts(p);
  say('⭐⭐ the phone read its shop and billed again — no 401, same session', api.calls.slice(t3from).every((c) => c.status < 400) && t3land === chitsAfterT0 + 4 && f3.person.jti === jtiBefore, 'statuses=' + api.calls.slice(t3from).map((c) => c.status).filter((x, i, a) => a.indexOf(x) === i).join(',') + ' chits=' + t3land);
  say('nothing on the phone says "maintenance"', !/maintenance/i.test(f3.flash), JSON.stringify(f3.flash));

  /* ── T4 ───────────────────────────────────────────────────────────────────────────────────────────────────── */
  console.log('\n── T4 ⭐⭐ WORDS PER CODE — SESSION_EXPIRED is "Sign in to send 1 bill", never "maintenance"; the queue survives the new sign-in');
  await ctx.setOffline(true);
  await ringBill(p);                                      /* a bill with the line down — queued */
  api.revokeSession(f3.person.jti);                       /* …and while it waited, the session ended (logout elsewhere / expiry) */
  await ctx.setOffline(false);
  await p.evaluate(() => HOST.drain());
  await p.waitForFunction(() => HOST && HOST.last && /Sign in to send/.test(String(HOST.last.why || '')), null, { timeout: 15000 }).catch(() => {});
  const f4 = await facts(p);
  const last = await p.evaluate(() => HOST.last);
  const qb = await p.evaluate(() => queueBlock());
  say('⭐⭐ drain says "Sign in to send 1 bill" — the code decides, the row is kept', /Sign in to send 1 bill/.test(String(last && last.why)) && last.code === 'SESSION_EXPIRED' && f4.queue === 1, JSON.stringify(last && last.why).slice(0, 90) + ' queue=' + f4.queue);
  say('the queue card says the same words and offers the sign-in', qb && /Sign in to send 1 bill/.test(qb.line) && qb.act === 'pairAgain' && qb.fix === 'Sign in', JSON.stringify(qb));
  await p.evaluate(() => refresh().catch(function(){}));
  await p.waitForFunction(() => /Sign in/.test((document.getElementById('flash') || {}).innerText || ''), null, { timeout: 10000 }).catch(() => {});
  const f4b = await facts(p);
  await shot(p, 't4-expired');
  say('⭐ the flash over the shelf says "Sign in to send 1 bill" and never "Due to maintenance"', /Sign in to send 1 bill/.test(f4b.flash) && !/maintenance/i.test(f4b.flash) && f4b.keyOk === false, JSON.stringify(f4b.flash));
  /* the person signs in again on the same phone, same shop → the fresh session replaces the old one IN PLACE */
  const loadsBefore = loads, callsT4 = api.calls.length;
  await p.evaluate(() => pairAgain());
  await signIn(p, 'athi'); await afterIn(p, null);
  const landedT4 = await settle(api, chitsAfterT0 + 5);
  const f5 = await facts(p);
  await shot(p, 't4-signed-in-again');
  say('⭐⭐⭐ after signing in again the queued bill lands, once, under the SAME client_ref — nothing was re-stamped', landedT4 === chitsAfterT0 + 5 && f5.queue === 0 && api.chits.length === chitsAfterT0 + 5, 'chits=' + api.chits.length + ' queue=' + f5.queue + ' last=' + (api.chits[api.chits.length - 1] || {}).client_ref);
  say('a new session for the same shop replaced the old one in place — no reload, same store, no enrol', loads === loadsBefore && f5.person.jti !== jtiBefore && f5.store === f1.store && f5.who === 'Athi' && !api.calls.slice(callsT4).some((c) => c.u === '/api/till/enrol'), 'loads=' + loads + '/' + loadsBefore + ' jti changed=' + (f5.person.jti !== jtiBefore) + ' flash=' + JSON.stringify(f5.flash));
  /* DEVICE_REVOKED: the owner removed this phone */
  api.revokeDevice(f5.device);
  await p.evaluate(() => refresh().catch(function(){}));
  await p.waitForFunction(() => /removed/.test((document.getElementById('flash') || {}).innerText || ''), null, { timeout: 10000 }).catch(() => {});
  const f6 = await facts(p);
  await shot(p, 't4-revoked');
  say('⭐ DEVICE_REVOKED → "The shop removed this phone" + what is kept here (never "maintenance")', /removed this phone/.test(f6.flash) && /kept/i.test(f6.flash) && !/maintenance/i.test(f6.flash) && f6.bills === 5 && f6.queue === 0, JSON.stringify(f6.flash) + ' bills=' + f6.bills);
  api.devices[f5.device].revoked_at = null;               /* the owner undoes it — the next refresh is ordinary again */

  /* ── T5 ───────────────────────────────────────────────────────────────────────────────────────────────────── */
  console.log('\n── T5 ⭐ THE PAGE CHECKS ITS OWN VERSION — reloads once for a newer page, and clears nothing');
  flag.laterPage = true;
  const loads5 = loads;
  await p.reload();
  await p.waitForFunction(() => typeof usignOpen === 'function', null, { timeout: 30000 });
  await p.waitForTimeout(2500);                            /* the check runs once the shop is read; the reload follows ~0.6 s later */
  await p.waitForFunction(() => typeof usignOpen === 'function' && S && S.shop, null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(1500);
  const f7 = await facts(p);
  const mark = await p.evaluate(() => sessionStorage.getItem('cb_till_reloaded_for'));
  say('⭐ a newer page on the server → the page reloaded itself exactly once more', loads - loads5 === 2 && mark === 'later-than-this', 'loads=' + (loads - loads5) + ' mark=' + mark);
  say('⭐⭐⭐ history is never cleared by a version check: bills, session, device id, prefix all intact', f7.bills === 5 && f7.person && f7.person.jti === f5.person.jti && f7.device === f1.device && f7.prefix === f1.prefix && f7.who === 'Athi', 'bills=' + f7.bills + ' who=' + f7.who + ' prefix=' + f7.prefix);
  flag.laterPage = false;
  await shot(p, 't5-after-version-check');

  /* ── T6 ───────────────────────────────────────────────────────────────────────────────────────────────────── */
  console.log('\n── T6 ⭐⭐⭐ M09 · OFFLINE FOR DAYS — the counter PIN unlocks with no line, 20 bills wait, the session expires, one sign-in sends them all once; a day-old token is renewed');
  await p.evaluate(() => { try { usignClose(); } catch (_) {} Array.prototype.slice.call(document.querySelectorAll('dialog[open]')).forEach(function(d){ try { d.close(); } catch (_) {} }); });
  await ctx.setOffline(true);
  const callsT6 = api.calls.length;
  await p.evaluate(() => lockNow());
  const locked = await p.evaluate(() => ({ lock: !!LOCK, cover: !(document.getElementById('lockcover') || {}).hidden }));
  await shot(p, 't6-locked-offline');
  await p.evaluate(() => lockOpen());                        /* 🔓 → the one sign-in, started at the counter PIN of who locked it */
  await p.waitForSelector('#usigndlg[open] [data-testid="signin-pin"]', { timeout: 10000 });
  await p.fill('[data-testid="signin-pin"]', '4826');
  await p.tap('[data-testid="signin-verify"]');
  await p.waitForFunction(() => !LOCK, null, { timeout: 10000 }).catch(() => {});
  const unlocked = await p.evaluate(() => ({ lock: !!LOCK, who: WHO && WHO.name, dlg: !!document.querySelector('#usigndlg[open]') }));
  say('⭐⭐ with the line down the phone locks, and the counter PIN unlocks it — no network, same person', locked.lock && locked.cover && !unlocked.lock && unlocked.who === 'Athi' && api.calls.length === callsT6, JSON.stringify(unlocked) + ' calls=' + (api.calls.length - callsT6));
  for (let i = 0; i < 20; i++) await ringBill(p);
  const f8 = await facts(p);
  const refsT6 = await p.evaluate(async () => ((await DB.all('queue')) || []).map((q) => q.no).sort());
  say('20 bills taken with the line down sit in the queue, each under this phone\'s prefix', f8.queue === 20 && refsT6.length === 20 && refsT6.every((r) => r.indexOf(f1.prefix + '/') === 0), 'queue=' + f8.queue + ' first=' + refsT6[0] + ' last=' + refsT6[19]);
  await shot(p, 't6-twenty-queued');
  api.expireSession(f7.person.jti);                        /* …and the 30 days ran out while it was away */
  await ctx.setOffline(false);
  await p.evaluate(() => HOST.drain());
  await p.waitForFunction(() => HOST && HOST.last && /Sign in to send/.test(String(HOST.last.why || '')), null, { timeout: 15000 }).catch(() => {});
  const last6 = await p.evaluate(() => HOST.last);
  const f9 = await facts(p);
  say('⭐⭐⭐ the line is back, the session is past its exp → "Sign in to send 20 bills" (never "maintenance"); all 20 kept', /Sign in to send 20 bills/.test(String(last6 && last6.why)) && last6.code === 'SESSION_EXPIRED' && f9.queue === 20 && api.chits.length === chitsAfterT0 + 5, JSON.stringify(last6 && last6.why).slice(0, 80) + ' queue=' + f9.queue);
  await p.evaluate(() => refresh().catch(function(){}));
  await p.waitForFunction(() => /Sign in/.test((document.getElementById('flash') || {}).innerText || ''), null, { timeout: 10000 }).catch(() => {});
  await shot(p, 't6-expired-twenty');
  /* a sign-in by code (the PIN names a person; only the LINE can issue a session) — the token comes back a day old */
  api.flag.oldIat = true;
  const callsRenew = api.calls.length, jtiExpired = f7.person.jti;
  await p.evaluate(() => pairAgain());
  await signIn(p, 'athi'); await afterIn(p, null);
  const landed6 = await settle(api, chitsAfterT0 + 25, 40000);
  const f10 = await facts(p);
  const mine6 = api.chits.slice(chitsAfterT0 + 5);
  const allRefs = api.chits.map((c) => c.client_ref);
  say('⭐⭐⭐ after the sign-in all 20 land — once each, the SAME client_refs the queue held, 0 duplicates', landed6 === chitsAfterT0 + 25 && f10.queue === 0 && mine6.map((c) => c.client_ref).sort().join() === refsT6.join() && new Set(allRefs).size === allRefs.length, 'landed=' + mine6.length + ' queue=' + f10.queue + ' distinct=' + new Set(allRefs).size + '/' + allRefs.length);
  say('⭐⭐⭐ every bill carries till.device_id = this phone and till.by = the signed-in person, with the name beside it (M11 checks these)', mine6.every((c) => c.till && c.till.device_id === f1.device && c.till.by === 'ent-a' && c.till.by_name === 'Athi' && c.till.id === f1.prefix), JSON.stringify(mine6[0] && mine6[0].till));
  const renews = api.calls.slice(callsRenew).filter((c) => c.u === '/api/signin/renew');
  say('⭐⭐ a token issued a day+ ago was RENEWED after the next good snapshot: one call, a new jti kept in place, the old one gone', renews.length === 1 && renews[0].status === 200 && f10.person && f10.person.jti !== jtiExpired && !!api.sessions[f10.person.jti] && f10.store === f1.store && f10.who === 'Athi', 'renews=' + renews.length + ' jti new=' + (f10.person && f10.person.jti !== jtiExpired) + ' listed=' + !!(f10.person && api.sessions[f10.person.jti]));
  api.flag.oldIat = false;
  await p.evaluate(() => refresh().catch(function(){}));
  await p.waitForTimeout(800);
  say('a fresh token is not renewed again (once a day, not once a snapshot)', api.calls.filter((c) => c.u === '/api/signin/renew').length === 1, 'renews=' + api.calls.filter((c) => c.u === '/api/signin/renew').length);
  await shot(p, 't6-sent-and-renewed');

  /* ── T7 ───────────────────────────────────────────────────────────────────────────────────────────────────── */
  console.log('\n── T7 ⭐⭐⭐ M10 · A PHONE THAT HELD A KEY, WITH UNSENT BILLS — the sign-in moves its store: copy · prove · mark; sent once; key gone; nothing deleted');
  /** a keyed phone with 1 sent + 3 unsent bills and a stranger store beside them; then the person signs in on it */
  const keyedPhone = async (key, tag, crash) => {
    const c = await b.newContext(PHONE);
    await c.addInitScript((o) => { try { if (!localStorage.getItem('cb_till_api')) { localStorage.setItem('cb_till_api', o.a); localStorage.setItem('cb_till_key', o.k); } } catch (_) {} }, { a: API, k: key });
    const q = await c.newPage(); q.on('pageerror', (e) => errs.push(tag + ' ' + e));
    const copies = []; let crashed = false;
    const moveLog = [];
    q.on('console', (m) => { const t = m.text(); if (/^till-move:/.test(t)) moveLog.push(t); if (/^till-move: copied/.test(t)) { copies.push(t); if (crash && !crashed) { crashed = true; q.reload().catch(() => {}); } } });
    const open = async () => { await q.waitForFunction(() => typeof usignOpen === 'function' && S && S.shop && S.shop.name === 'Athi Stores', null, { timeout: 30000 }); await q.waitForTimeout(400); };
    await q.goto(WEB + '/till.html'); await open();
    if (await q.locator('[data-testid="till-flash-x"]').count()) await q.tap('[data-testid="till-flash-x"]');
    await q.evaluate(() => usignAdopt({ id: 'athi', name: 'Athi', kind: 'entity', entity: 'ent-a' }));   /* as today: identity, no session */
    const before = api.chits.length;
    await ringBill(q); await q.evaluate(() => HOST.drain()); await settle(api, before + 1);   /* one bill with the line up — sent under the key, acknowledged */
    if (api.chits.length < before + 1) throw new Error(tag + ': the keyed phone\'s first bill never reached the stand-in — ' + JSON.stringify(await q.evaluate(async () => ({ last: HOST.last, cred: HOST.cred(), line: lineUp(), q: ((await DB.all('queue')) || []).length, qraw: ((await DB.allRaw('queue')) || []).length, bills: ((await DB.allRaw('bills')) || []).map((x) => x.no + ':' + (x._shop || '-') + ':' + (x._sent ? 'sent' : 'unsent')), owner: OWNER, busy: HOST._busy }))) + ' calls=' + api.calls.slice(-6).map((c) => c.status + ':' + c.u).join(','));
    await q.waitForFunction(async () => ((await DB.all('bills')) || []).some((x) => x && x._sent), null, { timeout: 10000 }).catch(() => {});
    await c.setOffline(true);
    await ringBill(q); await ringBill(q); await ringBill(q);
    const seeded = await facts(q);
    const refs = await q.evaluate(async () => ((await DB.all('queue')) || []).map((x) => x.no).sort());
    const sentRef = api.chits[before].client_ref;
    /* a store of ANOTHER shop on the same phone — the page's own schema, owner ent-z, 2 bills, 2 queued */
    await q.evaluate((name) => new Promise((res) => { const rq = indexedDB.open(name, 1);
      rq.onupgradeneeded = () => { const db = rq.result; db.createObjectStore('kv'); db.createObjectStore('bills', { keyPath: 'no' }); db.createObjectStore('queue', { keyPath: 'no' }); };
      rq.onsuccess = () => { const db = rq.result, tx = db.transaction(['kv', 'bills', 'queue'], 'readwrite'); tx.objectStore('kv').put('ent-z', 'owner');
        ['Z9/26-27/0001', 'Z9/26-27/0002'].forEach((n) => { tx.objectStore('bills').put({ no: n, at: new Date().toISOString(), total: 5, _shop: 'ent-z' }); tx.objectStore('queue').put({ no: n, at: new Date().toISOString(), _shop: 'ent-z' }); });
        tx.oncomplete = () => { db.close(); res(true); }; }; }), 'cb-till-' + tag + 'z');
    /* ⚠️ meanwhile the shop CLOSED this counter's key (Athi's phone, 2026-10-04): the line returns, the drain is refused, the 3 rows are kept */
    api.KEYS[key].closed = true;
    await c.setOffline(false);
    await q.evaluate(() => HOST.drain()); await q.waitForTimeout(800);
    const refused = await facts(q);
    const callsIn = api.calls.length;
    /* ⭐ the person signs in on the keyed phone — the session is KEPT, the page reloads as the person, the move follows */
    const nav = q.waitForEvent('load', { timeout: 30000 });
    await q.evaluate(() => pairAgain());                      /* the nudge's own button: the user-ID box, whoever is on */
    await signIn(q, 'athi');
    await nav; await open();
    await afterIn(q, null);
    await q.waitForFunction((n) => !!localStorage.getItem('cb_till_moved@' + n), keyStore(key), { timeout: 30000 }).catch(() => {});
    await settle(api, before + 4, 20000);
    await q.waitForFunction(() => localStorage.getItem('cb_till_key') === null, null, { timeout: 15000 }).catch(() => {});
    await q.waitForTimeout(500);
    const peek = (n) => q.evaluate(async (nm) => { const r = await peekStore(nm); return r ? { bills: r.bills, queue: r.queue, owner: r.owner, note: JSON.parse(localStorage.getItem('cb_till_moved@' + nm) || 'null') } : null; }, n);
    return { c, q, copies, moveLog, before, seeded, refused, refs, sentRef, callsIn, after: await facts(q), old: await peek(keyStore(key)), stranger: await peek('cb-till-' + tag + 'z'),
             stores: await q.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).filter((n) => /^cb-till-/.test(n)).sort()) };
  };
  const landedFrom = (r) => api.chits.slice(r.before + 1);
  {
    const r = await keyedPhone('KEY-OLD3', 't7', false);   /* its own key: T0 already numbered C2 under KEY-OLD */
    say('the keyed phone had 1 bill sent under its key and 3 unsent in the KEY store (prefix C4)', r.seeded.key === 'KEY-OLD3' && r.seeded.store === keyStore('KEY-OLD3') && r.seeded.bills === 4 && r.seeded.queue === 3 && r.refs.every((x) => x.indexOf('C4/') === 0), 'bills=' + r.seeded.bills + ' queue=' + r.seeded.queue + ' refs=' + r.refs.join(','));
    say('the key was refused when the line came back — the 3 rows stayed exactly where they were (never deleted on a 4xx)', r.refused.queue === 3 && r.refused.bills === 4 && r.refused.key === r.seeded.key, 'queue=' + r.refused.queue + ' key=' + r.refused.key);
    say('⭐⭐⭐ the sign-in kept a person session and reloaded into the PERSON store; cb_till_key is GONE', r.after.person && r.after.person.entity_id === 'ent-a' && r.after.store === 'cb-till-ent-a-' + String(r.after.device).replace(/[^A-Za-z0-9_-]/g, '') && r.after.key === null && r.after.who === 'Athi', 'store=' + r.after.store + ' key=' + r.after.key);
    const got = landedFrom(r);
    say('⭐⭐⭐ the 3 unsent bills landed ONCE each, under the SAME client_refs and their old C4 prefix, stamped with this device and person', got.length === 3 && got.map((x) => x.client_ref).sort().join() === r.refs.join() && got.every((x) => x.till && x.till.device_id === r.after.device && x.till.by === 'ent-a' && x.till.id === 'C4') && new Set(api.chits.map((x) => x.client_ref)).size === api.chits.length, got.map((x) => x.client_ref).join(' '));
    say('⭐⭐ the bill already sent under the key was NOT sent again (no POST for its client_ref after the sign-in)', !api.calls.slice(r.callsIn).some((x) => x.u === '/api/chits/send' && x.b.client_ref === r.sentRef), 'sent earlier as ' + r.sentRef);
    say('⭐⭐⭐ PROVED, THEN MARKED: the note beside the old store names this store and what was copied (4 bills, 3 queued)', r.old && r.old.note && r.old.note.to === r.after.store && r.old.note.copied.bills === 4 && r.old.note.copied.queue === 3, JSON.stringify(r.old && r.old.note));
    say('⭐⭐⭐ bills before = bills after: the person store holds all 4 (0 queued); the old store is KEPT, untouched (4 bills, 3 queued rows)', r.after.bills === 4 && r.after.queue === 0 && r.old && r.old.bills === 4 && r.old.queue === 3, 'new=' + r.after.bills + '/' + r.after.queue + ' old=' + (r.old && r.old.bills + '/' + r.old.queue));
    say('⭐⭐ the other shop\'s store is untouched: 2 bills, 2 queued, owner ent-z, no moved note', r.stranger && r.stranger.bills === 2 && r.stranger.queue === 2 && r.stranger.owner === 'ent-z' && !r.stranger.note, JSON.stringify(r.stranger));
    say('nothing was deleted: the old key store, the person store and the other shop\'s store are all still on the phone', r.stores.length === 3 && r.stores.indexOf(keyStore('KEY-OLD3')) >= 0 && r.stores.indexOf(r.after.store) >= 0 && r.stores.indexOf('cb-till-t7z') >= 0, JSON.stringify(r.stores));
    await r.q.evaluate(() => openStorage());
    await r.q.waitForTimeout(800);
    const panel = await r.q.evaluate(() => ((document.getElementById('billsbody') || {}).innerText || '').replace(/\s+/g, ' '));
    say('🩺 "What is kept here" says the old copy was moved into this counter and the other shop\'s copy is another shop\'s', /moved into this counter/.test(panel) && /another shop/.test(panel) && !/NOT SENT/.test(panel), panel.slice(panel.indexOf('Counters on this device'), panel.indexOf('Counters on this device') + 240));
    await shot(r.q, 't7-moved');
    await r.c.close();
  }
  console.log('     ⚠️ and the CRASH: a second keyed phone reloads the moment the copy is written, before the mark');
  {
    const r = await keyedPhone('KEY-OLD2', 't7c', true);
    const got = landedFrom(r);
    say('⭐⭐⭐ reloaded mid-move, the next open re-ran the copy: the 3 bills landed ONCE (same refs, C3), no duplicate anywhere', r.copies.length >= 1 && got.length === 3 && got.map((x) => x.client_ref).sort().join() === r.refs.join() && new Set(api.chits.map((x) => x.client_ref)).size === api.chits.length, 'copies=' + r.copies.length + ' (1 = the mark had landed before the reload; 2 = it had not) ' + got.map((x) => x.client_ref).join(' '));
    const probe = await r.q.evaluate(async () => ({ store: tillStore(), moved: CloudHost._moved, key: CloudHost.key, last: HOST.last && HOST.last.why, mem: MEM.on, lastslot: localStorage.getItem('cb_till_lastslot') }));
    say('⭐⭐⭐ no loss: person store 4 bills / 0 queued; old store kept at 4 / 3; note written; key gone', r.after.bills === 4 && r.after.queue === 0 && r.old && r.old.bills === 4 && r.old.queue === 3 && r.old.note && r.old.note.to === r.after.store && r.after.key === null, 'new=' + r.after.bills + '/' + r.after.queue + ' old=' + (r.old && r.old.bills + '/' + r.old.queue) + ' key=' + r.after.key + ' probe=' + JSON.stringify(probe));
    console.log('     move log: ' + r.moveLog.map((l) => l.replace(/cb-till-ent-a-[0-9a-f-]+/g, 'PERSON').slice(0, 150)).join(' | '));
    /* and a mark that never landed at all (the worst case: the rows had already been sent from here) — replayed on the next open */
    const chitsBefore = api.chits.length, copiesBefore = r.copies.length;
    await r.q.evaluate((n) => localStorage.removeItem('cb_till_moved@' + n), keyStore('KEY-OLD2'));
    await r.q.reload();
    await r.q.waitForFunction(() => typeof usignOpen === 'function' && S && S.shop && S.shop.name === 'Athi Stores', null, { timeout: 30000 });
    await r.q.waitForFunction((n) => !!localStorage.getItem('cb_till_moved@' + n), keyStore('KEY-OLD2'), { timeout: 30000 }).catch(() => {});
    await r.q.waitForTimeout(1500);
    const again = await facts(r.q);
    say('⭐⭐ a lost mark is replayed: the copy ran again, queued NOTHING (every row already sent from here), re-sent nothing, and the mark is back', r.copies.length === copiesBefore + 1 && / 0 queued/.test(r.copies[r.copies.length - 1]) && api.chits.length === chitsBefore && again.bills === 4 && again.queue === 0 && !!(await r.q.evaluate((n) => localStorage.getItem('cb_till_moved@' + n), keyStore('KEY-OLD2'))), r.copies[r.copies.length - 1] + ' chits=' + api.chits.length + '/' + chitsBefore);
    await shot(r.q, 't7-after-crash');
    await r.c.close();
  }

  /* ── T8 ───────────────────────────────────────────────────────────────────────────────────────────────────── */
  console.log('\n── T8 ⭐⭐ M09 · ONE PERSON, TWO PHONES — two device ids, two prefixes, two stores; each bills under its own device');
  const ctx2 = await b.newContext(PHONE);
  await ctx2.addInitScript((a) => { try { if (!localStorage.getItem('cb_till_api')) localStorage.setItem('cb_till_api', a); } catch (_) {} }, API);
  const p2 = await ctx2.newPage(); p2.on('pageerror', (e) => errs.push('T8 ' + e));
  await p2.goto(WEB + '/till.html');
  await p2.waitForFunction(() => typeof usignOpen === 'function' && typeof becomeShop === 'function', null, { timeout: 30000 });
  await signIn(p2, 'athi');
  await p2.waitForFunction(() => typeof S !== 'undefined' && S && S.shop && S.shop.name === 'Athi Stores', null, { timeout: 30000 }).catch(() => {});
  await afterIn(p2, null);
  const g1 = await facts(p2);
  say('⭐⭐ the second phone is its own device: another device id, another prefix, another store, the same person', g1.who === 'Athi' && g1.device && g1.device !== f1.device && /^D[0-9A-Z]{3}$/.test(g1.prefix) && g1.prefix !== f1.prefix && g1.store !== f1.store && g1.person && g1.person.jti !== f10.person.jti, 'device2=' + g1.device + ' prefix2=' + g1.prefix + ' prefix1=' + f1.prefix);
  const before8 = api.chits.length;
  await ringBill(p2);
  await ringBill(p);
  const landed8 = await settle(api, before8 + 2);
  const two = api.chits.slice(before8);
  const f11 = await facts(p);
  say('⭐⭐ each phone\'s bill lands under ITS device and prefix; neither phone was signed out', landed8 === before8 + 2 && two.some((c) => c.till.device_id === g1.device && c.client_ref.indexOf(g1.prefix + '/') === 0) && two.some((c) => c.till.device_id === f1.device && c.client_ref.indexOf(f1.prefix + '/') === 0) && f11.person.jti === f10.person.jti && !!api.sessions[f11.person.jti] && !!api.sessions[g1.person.jti], two.map((c) => c.client_ref + '@' + String(c.till.device_id).slice(0, 8)).join(' '));
  const live = (d) => !!(api.devices[d] && !api.devices[d].revoked_at && api.devices[d].sessions.some((j) => api.sessions[j]));
  say('the shop lists both phones as live devices of one person (T7\'s two keyed phones signed in as well)', live(f1.device) && live(g1.device), 'live=' + Object.keys(api.devices).filter(live).length + ' of ' + Object.keys(api.devices).length);
  await shot(p2, 't8-second-phone');
  await ctx2.close();

  /* ('cb-till' is the unscoped shelf a never-paired page opens before anything names a shop — as before M08) */
  const stores = await p.evaluate(async () => (indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name).filter((n) => /^cb-till-/.test(n)) : []));
  say('this phone holds exactly its one person store (no key store was created beside it)', stores.length === 1 && stores[0] === f1.store, JSON.stringify(stores));
  const fin = await facts(p);
  say('every bill this phone ever took is still on it (5 + 20 + 1), all sent, none queued', fin.bills === 26 && fin.queue === 0, 'bills=' + fin.bills + ' queue=' + fin.queue);
  say('no page errors', errs.length === 0, errs.length ? errs.join(' | ').slice(0, 300) : 'none');
  console.log('\nshots: e2e/shots/person-signin-*.png');
  await ctx.close(); await b.close(); web.close(); api.srv.close();
  console.log('\n' + (bad ? '✗ ' + bad + ' FAILED\n' : '✓ all good\n'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
