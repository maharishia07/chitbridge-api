/* till-lock.cjs — ⭐⭐⭐ S3/S4: 🔒 LOCKS THE COUNTER WITH THE BILL KEPT; 🔓 IS THE ONE SIGN-IN OVER THE COVER
 *
 * Athi, 2026-09-28: *"simply if we lock the screen and ask for sign-in, that will be good … we need to have an icon
 * for lock screen for the application, and unlock screen."* [SPEC-counter-identity.md §4]
 *
 * ⭐ Through the real controls: the 🔒 pill, the cover's 🔓 button, the sign-in dialog. The keyboard is pressed at
 * the covered page on purpose — Escape, F6 and letters — because Escape under a dialog once cleared a bill
 * ([TILL-30]). The offline half runs with the browser really offline. [[feedback-shoot-the-screen-not-the-dom]]
 *
 * Run: node e2e/till-lock.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const SHOTS = path.join(__dirname, '..', 'test-results', 'till-lock');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(68) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };
const PEOPLE = {
  xclerk: { identity_id: 'p-x', display_name: 'X Clerk' },
  wclerk: { identity_id: 'p-w', display_name: 'W Clerk' },
};

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const web = http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  const api = http.createServer(async (q, r) => {
    let raw = ''; for await (const c of q) raw += c;
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    const j = (c2, o) => { r.writeHead(c2, Object.assign({ 'content-type': 'application/json' }, cors)); r.end(JSON.stringify(o)); };
    if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
    const u = q.url.split('?')[0];
    const b = raw ? JSON.parse(raw) : {};
    if ((u === '/api/entities/register' || u === '/api/signin/ask')) return j(200, { message: 'sent', dev_otp: '123456' });
    if ((u === '/api/entities/verify' || u === '/api/signin/verify')) {
      const id = b.id || b.user_id, p = PEOPLE[id]; if (!p) return j(404, { message: 'not found' });   /* CBSignin posts { id, otp } */
      return j(200, { token: 'TOKEN-' + id, identity: { identity_id: p.identity_id, bridge_id: 'CB-P', display_name: p.display_name,
                      user_id: id, identity_type: 'actor', entity_id: 'ent-x' } });
    }
    if (u === '/api/till/snapshot') {
      /* M10: after its first sign-in a browser bills as the PERSON (Bearer + X-Device-Id) — its key is retired; the key still opens the shop before that */
      const bearer = String(q.headers.authorization || '').replace('Bearer TOKEN-', '');
      const asPerson = !!PEOPLE[bearer] && !!q.headers['x-device-id'];
      if (!asPerson && q.headers['x-api-key'] !== 'KEY-X') return j(401, { message: 'key refused' });
      return j(200, { at: new Date().toISOString(), entity_id: 'ent-x', shop: { country: 'IN', name: 'Shop X', bridge_id: 'CB-X' },
        staff: [{ id: 'p-x', name: 'X Clerk' }, { id: 'p-w', name: 'W Clerk' }],
        items: [{ id: 'xmango', name: 'XMANGO', price: 50, unit: 'nos', code: 'XMANGO' }] });
    }
    return j(200, { ok: true });
  });
  await new Promise((res) => web.listen(0, '127.0.0.1', res));
  await new Promise((res) => api.listen(0, '127.0.0.1', res));
  const API = 'http://127.0.0.1:' + api.address().port;

  const b = await chromium.launch();
  const ctx = await b.newContext();
  await ctx.addInitScript((a) => {
    if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
    localStorage.setItem('cb_till_api', a); localStorage.setItem('cb_till_key', 'KEY-X');
  }, API);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  const st = () => p.evaluate(() => ({ locked: !document.getElementById('lockcover').hidden, who: (WHO && WHO.name) || null,
    since: (WHO && WHO.since) || null, cart: (CART || []).map((l) => l.name || (l.item && l.item.name) || '?'), q: document.getElementById('q').value }));
  const ready = async () => {
    await p.waitForFunction(() => typeof lockNow === 'function' && S && S.shop && S.shop.name === 'Shop X', null, { timeout: 30000 });
  };
  /* the one dialog: a user ID, then the code (online — typed, the window never prefills the stand-in's dev_otp) or the counter PIN */
  const signIn = async (id, pinOrNull) => {
    if (!(await p.locator('#usigndlg[open]').count())) await p.evaluate(() => usignOpen());
    await p.waitForSelector('[data-testid="signin-id"], [data-testid="signin-pin"]');
    /* an unlock goes straight to the PIN of whoever locked it — for anybody else, "Someone else" */
    const direct = await p.evaluate(() => (USIGN.win && USIGN.win.state().local && USIGN.win.state().local.ids) || []);
    if (direct.indexOf(id) < 0) {
      if (await p.locator('[data-testid="signin-back"]').count()) await p.click('[data-testid="signin-back"]');
      await p.fill('[data-testid="signin-id"]', id);
      await p.click('[data-testid="signin-go"]');
    }
    if (pinOrNull) { await p.waitForSelector('[data-testid="signin-pin"]'); await p.fill('[data-testid="signin-pin"]', pinOrNull); }
    else {
      await p.waitForSelector('[data-testid="signin-pin"], [data-testid="signin-code"]');
      if (await p.locator('[data-testid="signin-code"]').count()) await p.fill('[data-testid="signin-code"]', '123456');
    }
    await p.click('[data-testid="signin-verify"]');
  };

  await p.goto('http://127.0.0.1:' + web.address().port + '/till.html');
  await p.waitForFunction(() => typeof refresh === 'function', null, { timeout: 30000 });
  await p.evaluate(() => refresh().catch(function(){}));
  await ready();

  console.log('\n── set up: X Clerk signs in online and sets a counter PIN; a bill is in hand ' + '─'.repeat(0));
  await signIn('xclerk', null);
  await p.waitForSelector('[data-testid="signin-pin1"]');
  await p.fill('[data-testid="signin-pin1"]', '4826'); await p.fill('[data-testid="signin-pin2"]', '4826');
  await p.click('[data-testid="signin-pinsave"]');
  await p.waitForSelector('[data-testid="till-usign-done"]'); await p.click('[data-testid="till-usign-done"]');
  await p.fill('#q', 'XMANGO');
  await p.waitForSelector('[data-testid="till-add-0"]', { timeout: 20000 });
  await p.click('[data-testid="till-add-0"]');
  const s0 = await st();
  say('X Clerk is on, with XMANGO on the bill', s0.who === 'X Clerk' && s0.cart.length === 1, JSON.stringify(s0));

  console.log('\n── ⭐ 🔒 LOCK: the cover is up and the bill is KEPT ' + '─'.repeat(0));
  await p.click('[data-testid="till-lock"]');
  const s1 = await st();
  await p.screenshot({ path: path.join(SHOTS, '1-locked.png') });
  say('the 🔒 pill covers the counter', s1.locked, 'cover up');
  say('the bill is still in hand — not parked, not cleared', s1.cart.length === 1, JSON.stringify(s1.cart));

  console.log('\n── ⚠️⚠️ NOTHING BEHIND THE COVER IS REACHABLE ([TILL-30]) ' + '─'.repeat(0));
  await p.keyboard.press('Escape'); await p.keyboard.press('F6'); await p.keyboard.type('abc'); await p.keyboard.press('Enter');
  const s2 = await st();
  say('Escape, F6, typing and Enter do nothing to the bill', s2.cart.length === 1 && s2.locked, JSON.stringify(s2.cart));
  say('and nothing reaches the search box', s2.q === s1.q, 'q="' + s2.q + '"');
  const clickThrough = await p.evaluate(() => { const r = document.getElementById('q').getBoundingClientRect();
    const el = document.elementFromPoint(r.left + 5, r.top + 5); return el && el.closest('#lockcover') ? 'cover' : (el && el.id); });
  say('a click where the search box is lands on the cover', clickThrough === 'cover', 'hit=' + clickThrough);

  console.log('\n── ⭐ IT SURVIVES A RELOAD ' + '─'.repeat(0));
  await p.reload();
  await p.waitForFunction(() => typeof lockNow === 'function', null, { timeout: 30000 });
  await p.evaluate(() => refresh().catch(function(){}));
  await ready();
  if (await p.locator('#askdlg[open]').count()) await p.click('#askok');   /* R1: "continue that bill" */
  const s3 = await st();
  say('still locked after a reload', s3.locked, 'cover up');

  console.log('\n── ⭐⭐⭐ 🔓 UNLOCK OFFLINE, the same person: their shift and their bill come back ' + '─'.repeat(0));
  await ctx.setOffline(true);
  await p.click('[data-testid="till-unlock"]');
  await signIn('xclerk', '4826');
  await p.waitForFunction(() => document.getElementById('lockcover').hidden, null, { timeout: 10000 });
  const s4 = await st();
  await p.screenshot({ path: path.join(SHOTS, '2-unlocked.png') });
  say('the counter PIN unlocks it with the line down', !s4.locked, 'cover gone');
  say('the SAME shift carries on — not a new one', s4.who === 'X Clerk' && s4.since === s0.since, 'since ' + s4.since);
  say('the bill in hand is exactly as it was', s4.cart.length === 1 && s4.cart[0] === s0.cart[0], JSON.stringify(s4.cart));
  say('the sign-in dialog closed itself', !(await p.locator('#usigndlg[open]').count()), 'closed');

  console.log('\n── ⚠️ UNLOCK BY SOMEBODY WITH NO PIN, OFFLINE — refused, still locked ' + '─'.repeat(0));
  await p.click('[data-testid="till-lock"]');
  await p.click('[data-testid="till-unlock"]');
  const straight = await p.locator('[data-testid="signin-pin"]').count() && await p.evaluate(() => !!(USIGN.win && USIGN.win.state().local));
  say('🔓 goes straight to the PIN of whoever locked it', straight, 'PIN box for ' + await p.evaluate(() => USIGN.win && USIGN.win.state().resolved));
  await p.click('[data-testid="signin-back"]');
  await p.fill('[data-testid="signin-id"]', 'zed');
  await p.click('[data-testid="signin-go"]');
  await p.waitForSelector('[data-testid="signin-why"]');
  await p.keyboard.press('Escape');
  const s5 = await st();
  say('nobody got in, and Escape on the dialog leaves the cover up', s5.locked && s5.who === 'X Clerk', 'locked=' + s5.locked);
  await p.evaluate(() => usignClose());   /* the window's own Close — a modal still open would sit over the cover's 🔓 */

  console.log('\n── ⭐ ANOTHER PERSON OF THIS SHOP UNLOCKS (online) — a shift change ' + '─'.repeat(0));
  await ctx.setOffline(false);
  await p.waitForFunction(() => lineUp(), null, { timeout: 10000 });
  await p.click('[data-testid="till-unlock"]');
  await signIn('wclerk', null);
  await p.waitForSelector('[data-testid="signin-later"]', { timeout: 10000 });
  await p.click('[data-testid="signin-later"]');
  await p.waitForFunction(() => document.getElementById('lockcover').hidden, null, { timeout: 10000 });
  const s6 = await st();
  say('W Clerk is on now — a new shift, not X\'s', s6.who === 'W Clerk' && s6.since !== s0.since, 'who=' + s6.who);

  console.log('\n── ⭐ SIGNING OUT LOCKS THE COUNTER — nobody on it means nobody bills on it ' + '─'.repeat(0));
  /* T2i: Sign out lives on the rail's ONE avatar (CBAvatar, items ['signout']) — the sign-in window reopened fresh holds no Sign out */
  await p.click('[data-testid="till-avatar"]');
  await p.click('[data-testid="nav-signout"]');
  const s7 = await st();
  say('after sign out the cover is up and nobody is on', s7.locked && s7.who === null, JSON.stringify({ locked: s7.locked, who: s7.who }));
  await p.evaluate(() => usignClose());
  say('closing the dialog leaves it locked', (await st()).locked, 'cover up');

  console.log('\n── ☕ A BREAK IS A LOCK — Athi: "make break a lock too" ' + '─'.repeat(0));
  await ctx.setOffline(true);
  await p.click('[data-testid="till-unlock"]');
  await signIn('xclerk', '4826');
  await p.waitForFunction(() => document.getElementById('lockcover').hidden, null, { timeout: 10000 });
  await p.fill('#q', 'XMANGO');
  await p.waitForSelector('[data-testid="till-add-0"]', { timeout: 20000 });
  await p.click('[data-testid="till-add-0"]');
  await p.evaluate(() => openWho());
  await p.click('[data-testid="till-break"]');
  const b1 = await p.evaluate(() => ({ brk: !document.getElementById('breakcover').hidden, lock: !!LOCK, reason: LOCK && LOCK.reason,
    cart: CART.length, parked: PARKED.length }));
  await p.screenshot({ path: path.join(SHOTS, '3-break.png') });
  say('☕ covers the counter with the break\'s own cover, as a LOCK', b1.brk && b1.lock && b1.reason === 'break', JSON.stringify(b1));
  say('the bill in hand was parked, as a break always did', b1.cart === 0 && b1.parked >= 1, 'parked=' + b1.parked);
  const qBefore = await p.evaluate(() => document.getElementById('q').value);
  await p.keyboard.press('Escape'); await p.keyboard.type('zz');
  const qAfter = await p.evaluate(() => document.getElementById('q').value);
  say('⚠️ keys behind the break cover do nothing', qAfter === qBefore && await p.evaluate(() => !document.getElementById('breakcover').hidden && PARKED.length >= 1), 'q "' + qBefore + '" → "' + qAfter + '"');
  const tapOnly = await p.evaluate(() => { document.querySelector('[data-testid="till-break-end"]').click(); return !document.getElementById('breakcover').hidden; });
  say('⚠️⚠️ "Back to billing" alone does NOT end it — it asks who is back', tapOnly && await p.locator('#usigndlg[open]').count() > 0, 'cover still up, sign-in open');
  await signIn('xclerk', '4826');
  await p.waitForFunction(() => document.getElementById('breakcover').hidden && !LOCK, null, { timeout: 10000 });
  const b2 = await p.evaluate(() => ({ brk: BREAK, breaks: (WHO && WHO.breaks || []).length, who: WHO && WHO.name }));
  say('the PIN ends the break, and its minutes are on X Clerk\'s shift', !b2.brk && b2.breaks === 1 && b2.who === 'X Clerk', JSON.stringify(b2));

  console.log('\n── ⭐⭐ AUTO-LOCK — Athi: "add auto-lock after 5 idle minutes, keep it as editable" ' + '─'.repeat(0));
  say('the default is 5 minutes, before anybody chooses', await p.evaluate(() => autoLockMins()) === 5, 'minutes=' + await p.evaluate(() => autoLockMins()));
  /* the real control, through its own onchange; the minutes are shortened (0.05 min = 3 s) only so a test can wait for them */
  const setLock = (v) => p.evaluate((val) => { paintMenu(); const el = document.getElementById('mq_lock');
    let o = [...el.options].find((x) => x.value === String(val)); if (!o) { o = new Option('test', String(val)); el.add(o); }
    el.value = String(val); el.dispatchEvent(new Event('change')); return localStorage.getItem(shopLs('cb_till_autolock')); }, v);
  say('the ☰ 🔒 control saves the choice under the shop', (await setLock(10)) === '10', 'stored 10');
  await setLock(0.05);
  await p.fill('#q', 'XMANGO');
  await p.waitForSelector('[data-testid="till-add-0"]', { timeout: 20000 });
  await p.click('[data-testid="till-add-0"]');
  const inHand = (await st()).cart.length;
  await p.waitForFunction(() => !document.getElementById('lockcover').hidden, null, { timeout: 15000 });
  const a1 = await st();
  say('left alone, the counter LOCKS BY ITSELF', a1.locked, 'cover up');
  say('and the bill in hand is kept', a1.cart.length === inHand && inHand >= 1, JSON.stringify(a1.cart));
  await p.click('[data-testid="till-unlock"]');
  await signIn('xclerk', '4826');
  await p.waitForFunction(() => document.getElementById('lockcover').hidden, null, { timeout: 10000 });
  /* busy: a key every second for five seconds — the 3-second clock must keep restarting */
  for (let i = 0; i < 5; i++) { await p.keyboard.press('Shift'); await p.waitForTimeout(1000); }
  say('⭐ a counter in use never locks — every touch restarts the clock', !(await st()).locked, 'still open after 5 s of use');
  await p.evaluate(() => openWho());
  await p.waitForTimeout(4500);
  say('⚠️ it WAITS while a dialog is open (a dialog would sit above the cover)', !(await st()).locked, 'still open with the picker up');
  await p.evaluate(() => document.getElementById('whodlg').close());
  await setLock(0);
  await p.waitForTimeout(4500);
  say('"Never lock" means never', !(await st()).locked, 'open after 4.5 s');
  await setLock(5);

  console.log('\n── ⚠️⚠️ H1 (critic review): NEVER LOCK INTO A STATE NOBODY CAN LEAVE ' + '─'.repeat(0));
  /* a counter where nobody has a counter PIN — the state most shops are in on day one */
  await p.evaluate(() => { try { localStorage.removeItem(shopLs('cb_till_pins')); } catch (_) {} });
  await ctx.setOffline(true);
  await p.waitForFunction(() => !lineUp(), null, { timeout: 10000 });
  await setLock(0.05);
  await p.waitForTimeout(4500);
  say('offline with no PIN anywhere, auto-lock does NOT fire', !(await st()).locked, 'still open after 4.5 s');
  await p.click('[data-testid="till-lock"]');
  const refusedWhy = await p.evaluate(() => document.getElementById('lastnote').textContent);
  say('and 🔒 refuses — saying why and what to do', !(await st()).locked && /counter PIN/.test(refusedWhy), '"' + refusedWhy.slice(0, 80) + '…"');
  await setLock(5);

  /* locked while the line was up, then the line dropped — still nobody with a PIN */
  await ctx.setOffline(false);
  await p.waitForFunction(() => lineUp(), null, { timeout: 10000 });
  await p.click('[data-testid="till-lock"]');
  await ctx.setOffline(true);
  await p.waitForFunction(() => !lineUp(), null, { timeout: 10000 });
  await p.click('[data-testid="till-unlock"]');
  await p.waitForSelector('#askdlg[open]', { timeout: 10000 });
  const asked = await p.evaluate(() => document.getElementById('askbody').textContent + ' | ' + document.getElementById('askok').textContent);
  say('⚠️ stranded (locked, then offline, no PIN): it offers the one way out, and says why', /nobody can sign in/i.test(asked) && /Unlock anyway/.test(asked), '"' + asked.slice(0, 70) + '…"');
  await p.click('#askok');
  await p.waitForFunction(() => document.getElementById('lockcover').hidden, null, { timeout: 10000 });
  const noted = await p.evaluate(() => { try { return JSON.parse(localStorage.getItem(shopLs('cb_till_unproven')) || '[]').length; } catch (_) { return 0; } });
  say('it unlocks, and the unproven unlock is NOTED in the shop’s own log', !(await st()).locked && noted >= 1, 'log entries=' + noted);
  await ctx.setOffline(false);
  await p.waitForFunction(() => lineUp(), null, { timeout: 10000 });

  console.log('\n── ⚠️ M1 (critic review): A LOCKED COUNTER IS COVERED FROM THE FIRST MOMENT OF A RELOAD ' + '─'.repeat(0));
  await p.click('[data-testid="till-lock"]');
  /* slow the host probe (/api/state, what pickHost asks first — critic M1's own repro) so the old window (lock read before the key) would be wide open */
  await p.route('**/api/state', async (r) => { await new Promise((z) => setTimeout(z, 3000)); await r.continue(); });
  await p.reload({ waitUntil: 'domcontentloaded' });
  const early = await p.evaluate(() => ({ cover: !document.getElementById('lockcover').hidden, lock: !!(typeof LOCK !== 'undefined' && LOCK) }));
  say('covered at DOMContentLoaded, before the shop has answered', early.cover && early.lock, JSON.stringify(early));
  await p.unroute('**/api/state');

  console.log('\nconsole/page errors:', errs.length ? errs.join(' | ').slice(0, 300) : 'none');
  say('no page errors', errs.length === 0, errs.length + ' error(s)');
  await b.close(); web.close(); api.close();
  console.log('\n' + (bad ? '✗ ' + bad + ' FAILED\n' : '✓ all good\n'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
