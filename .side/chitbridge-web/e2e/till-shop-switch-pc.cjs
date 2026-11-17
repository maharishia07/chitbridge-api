/* till-shop-switch-pc.cjs — ⭐⭐⭐ THE SHOP PC SIGNS IN THROUGH THE ONE DIALOG, AND SWITCHES SHOPS THROUGH THE ONE DOOR
 *
 * [SPEC-counter-identity.md §2] 2026-09-28. The shop PC had its own connect dialog — a second path to the key.
 * It is retired: the page proves the person (/api/entities/verify, forwarded by the program) and becomeShop()
 * hands the session to the program's /api/signin/finish, which enrols, saves the key and RESTARTS.
 *
 * ⚠️⚠️ DRIVES THE REAL PROGRAM (till.js) from a COPY of the kit in a temp folder — started from the repo folder,
 * its self-update writes the deployed till.html over the working copy ([[feedback-counter-self-update-eats-working-copy]]).
 * A small loop restarts it whenever it exits, exactly as counter.cmd does on a shop PC.
 * ⚠️ AND AN UNPAIRED PC HAS NO ENGINES (it fetches them WITH its key) — so the first sign-in must run on the
 * signin engine the KIT carries. That is proven here by starting with an empty folder.
 *
 * Run: node e2e/till-shop-switch-pc.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { spawn } = require('child_process');
const KIT = path.join(__dirname, '..', '..', 'chitbridge-api', 'tools', 'tally-connector');
const ENG = path.join(__dirname, '..', 'public', 'engine');
const SHOTS = path.join(__dirname, '..', 'test-results', 'till-shop-switch-pc');
/* ⚠️ a FREE port, asked of the OS — a fixed one once landed on a real counter left running from a simulation */
let PORT = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwt = (p) => b64({ alg: 'HS256' }) + '.' + b64(p) + '.stub';
const unjwt = (k) => { try { return JSON.parse(Buffer.from(String(k).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch (_) { return null; } };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(66) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

const SHOPS = {
  'ent-x': { identity_id: 'ent-x', bridge_id: 'CB-X', display_name: 'Shop X', item: 'XMANGO' },
  'ent-y': { identity_id: 'ent-y', bridge_id: 'CB-Y', display_name: 'Shop Y', item: 'YPANEER' },
};
const PEOPLE = {
  xclerk: { identity_id: 'p-x', user_id: 'xclerk', display_name: 'X Clerk', identity_type: 'actor', entity_id: 'ent-x' },
  yowner: { identity_id: 'ent-y', user_id: 'yowner', display_name: 'Y Owner', identity_type: 'entity', entity_id: 'ent-y' },
};

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  PORT = await new Promise((res) => { const t = require('net').createServer(); t.listen(0, '127.0.0.1', () => { const n = t.address().port; t.close(() => res(n)); }); });
  const snapEng = [];
  /* ── the stand-in ChitBridge ── */
  const api = http.createServer(async (q, r) => {
    let raw = ''; for await (const c of q) raw += c;
    const j = (c2, o) => { r.writeHead(c2, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
    const u = q.url.split('?')[0];
    const b = raw ? (() => { try { return JSON.parse(raw); } catch (_) { return {}; } })() : {};
    /* the kit passes the window's /api/signin/ask·verify through to the cloud (till.js) — the stand-in answers both names */
    if (u === '/api/entities/register' || u === '/api/signin/ask') return j(200, { message: 'sent', dev_otp: '123456' });
    if (u === '/api/entities/verify' || u === '/api/signin/verify') {
      const p = PEOPLE[b.id || b.user_id];   /* CBSignin posts { id, otp } */ if (!p) return j(404, { message: 'not found' });
      return j(200, { token: 'TOKEN-' + p.user_id, identity: Object.assign({ bridge_id: 'CB-P' }, p) });
    }
    if (u === '/api/till/enrol') {
      const p = PEOPLE[String(q.headers.authorization || '').replace('Bearer TOKEN-', '')];
      if (!p) return j(403, { message: 'no shop' });
      const s = SHOPS[p.entity_id];
      return j(200, { key: jwt({ identity_id: s.identity_id, bridge_id: s.bridge_id, display_name: s.display_name, kind: 'api_key', scopes: ['till'] }),
                      shop: { country: 'IN', name: s.display_name, bridge_id: s.bridge_id } });
    }
    if (u === '/api/till/snapshot') { const e = new URL(q.url, 'http://x').searchParams.get('eng'); if (e) snapEng.push(e); }
    const who = unjwt(q.headers['x-api-key']);
    const s = who && SHOPS[who.identity_id];
    if (u === '/api/till/snapshot') {
      if (!s) return j(401, { message: 'key refused' });
      return j(200, { at: new Date().toISOString(), version: s.bridge_id + '-1', entity_id: s.identity_id,
        shop: { country: 'IN', name: s.display_name, bridge_id: s.bridge_id },
        items: [{ id: s.item.toLowerCase(), name: s.item, price: 50, unit: 'nos', code: s.item }] });
    }
    if (u.indexOf('/api/till/engine/') === 0) {
      if (!s) return j(401, { message: 'key refused' });
      const f = path.join(ENG, u.split('/').pop().replace(/\.js$/, '') + '.js');
      if (!fs.existsSync(f)) return j(404, { message: 'no such engine' });
      r.writeHead(200, { 'content-type': 'application/javascript' }); return r.end(fs.readFileSync(f));
    }
    if (q.method === 'GET') return j(404, { message: 'not in this stand-in' });
    return j(200, { ok: true });
  });
  await new Promise((res) => api.listen(0, '127.0.0.1', res));
  const API = 'http://127.0.0.1:' + api.address().port;

  /* ── a shop PC: a copy of the kit, an unpaired connector.json, and counter.cmd's restart loop ── */
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cbswitchpc-'));
  const kit = path.join(home, 'kit'); fs.mkdirSync(kit);
  /* signin-ui.js: the kit's byte copy of the ONE sign-in window (#68) — till.js serves it at /app/signin-ui.js */
  ['till.js', 'till.html', 'core.js', 'printer.js', 'rollup.js', 'orders.js', 'orderhub.js', 'signin.js', 'signin-ui.js', 'money.js']
    .forEach((n) => fs.copyFileSync(path.join(KIT, n), path.join(kit, n)));
  const cfgFile = path.join(home, 'connector.json');
  fs.writeFileSync(cfgFile, JSON.stringify({ api: API, till: { id: 'C1' }, printer: 'KeepMe' }, null, 2));
  let proc = null, running = true, starts = 0, out = '';
  const start = () => {
    starts++;
    proc = spawn(process.execPath, [path.join(kit, 'till.js'), '--config', cfgFile, '--port', String(PORT)],
      { cwd: kit, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', (d) => { out += d; }); proc.stderr.on('data', (d) => { out += d; });
    proc.on('exit', () => { if (running) setTimeout(start, 300); });
  };
  start();
  const state = () => fetch('http://127.0.0.1:' + PORT + '/api/state').then((x) => x.json()).catch(() => null);
  for (let i = 0; i < 100 && !(await state()); i++) await sleep(150);

  const b = await chromium.launch();
  const ctx = await b.newContext();
  /* ⚠️ S1b: a parked bill left by the OLD page under the plain, device-wide name — it must land in the shop this PC holds */
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
    localStorage.setItem('cb_till_parked', JSON.stringify([{ at: new Date().toISOString(), name: 'LEGACY', phone: '', cart: [] }]));
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  const page = () => p.evaluate(() => ({ shop: (S && S.shop && S.shop.name) || null, items: ((S && S.items) || []).map((i) => i.name),
    who: (typeof WHO !== 'undefined' && WHO && WHO.name) || null, paired: paired() }));
  /* first = the device door (pairAgain, an unpaired PC); after that the PERSON door, after signing out — Athi's own steps */
  const signIn = async (who, first) => {
    if (first) await p.evaluate(() => pairAgain());
    else {
      await p.evaluate(() => usignOpen());
      if (await p.locator('[data-testid="till-usign-out"]').count()) await p.click('[data-testid="till-usign-out"]');
    }
    /* the one window (CBSignin, #68) through its own controls — the same steps e2e/lib/signin.cjs takes, after the door above */
    await p.waitForSelector('[data-testid="signin-id"]', { timeout: 15000 });
    await p.fill('[data-testid="signin-id"]', who);
    await p.click('[data-testid="signin-go"]');
    await p.waitForSelector('[data-testid="signin-code"]', { timeout: 15000 });
    await p.fill('[data-testid="signin-code"]', '123456');
    await p.click('[data-testid="signin-verify"]');
  };
  const reopened = async (shop) => {
    await p.waitForEvent('load', { timeout: 60000 });
    await p.waitForFunction((n) => typeof paired === 'function' && S && S.shop && S.shop.name === n, shop, { timeout: 60000 });
  };

  await p.goto('http://127.0.0.1:' + PORT + '/');
  await p.waitForFunction(() => typeof pairAgain === 'function' && typeof becomeShop === 'function', null, { timeout: 30000 });
  const s0 = await state();
  say('the PC starts unpaired', s0 && s0.paired === false, 'paired=' + (s0 && s0.paired));
  say('⚠️ and still has the signin engine — the KIT\'s own copy', await p.evaluate(() => !!window.CBSignin), 'CBSignin loaded=' + (await p.evaluate(() => !!window.CBSignin)));
  /* ⭐⭐ THE LOADER STEP (2026-09-28): versions are read off the files the program serves; money is in the kit too */
  const v0 = (s0 && s0.engines) || {};
  say('⭐ unpaired, /api/state names the KIT\'s releases — signin and money — and nothing it does not have',
    /^\d+\.\d+\.\d+$/.test(v0.signin) && /^\d+\.\d+\.\d+$/.test(v0.money) && v0.tax === false, JSON.stringify({ signin: v0.signin, money: v0.money, tax: v0.tax }));
  say('⭐ the page rounds with money straight away — the kit\'s money.js, no second copy of the rule', await p.evaluate(() => r2(1.005) === 1.01 && !!window.CBMoney), 'r2(1.005)=' + await p.evaluate(() => { try { return r2(1.005); } catch (e) { return e.message; } }));
  say('⚠️ and NO page errors on the unpaired sign-in screen (it threw "CBQty is not loaded")', errs.length === 0, errs.length ? errs.join(' | ').slice(0, 160) : 'none');

  console.log('\n── ⭐⭐ FIRST SIGN-IN on the shop PC — the shared dialog, the program enrols and restarts ' + '─'.repeat(0));
  const was = starts;
  const r1 = reopened('Shop X');
  await signIn('xclerk', true);
  await r1;
  /* ⭐ v1.6.0: the first sign-in here is the moment a counter PIN is offered — set one, on the shop PC's own page
     (the ONE window's own boxes, signin-pin1 · signin-pin2 · signin-pinsave, since #68) */
  await p.waitForSelector('[data-testid="signin-pin1"]', { timeout: 20000 });
  await p.fill('[data-testid="signin-pin1"]', '1357');
  await p.fill('[data-testid="signin-pin2"]', '1357');
  await p.click('[data-testid="signin-pinsave"]');
  await p.waitForSelector('[data-testid="till-usign-done"]', { timeout: 20000 });
  const book = await p.evaluate(() => pinBook());
  const pinx = book.xclerk || {};
  say('⭐ a counter PIN was set on the shop PC — a salt and a hash, never the PIN',
    !!(pinx.salt && pinx.hash) && JSON.stringify(book).indexOf('1357') < 0, 'ids=' + JSON.stringify(pinx.ids));
  await p.click('[data-testid="till-usign-done"]');
  const s1 = await state(), g1 = await page();
  await p.screenshot({ path: path.join(SHOTS, '1-shop-x.png') });
  say('the program RESTARTED (its folder is chosen at boot)', starts > was, 'starts=' + starts);
  say('it is paired to shop X', s1 && s1.paired && s1.shop && s1.shop.bridge_id === 'CB-X', JSON.stringify(s1 && s1.shop));
  say('the page shows X\'s own shelf', g1.shop === 'Shop X' && g1.items.indexOf('XMANGO') >= 0, JSON.stringify(g1.items));
  say('and the person who signed in is on the counter', g1.who === 'X Clerk', 'who=' + g1.who);
  console.log('\n── ⚠️⚠️ S1b · PARKED BILLS BELONG TO THE SHOP — on the PC too ' + '─'.repeat(0));
  const parked = () => p.evaluate(() => (PARKED || []).map((x) => x.name));
  say('the pre-upgrade parked bill MOVED into shop X (once, into an empty slot)', (await parked()).indexOf('LEGACY') >= 0
    && await p.evaluate(() => localStorage.getItem('cb_till_parked') === null), JSON.stringify(await parked()));
  await p.fill('#q', 'XMANGO').catch(() => {});
  await p.waitForSelector('[data-testid="till-add-0"]', { timeout: 20000 });
  await p.click('[data-testid="till-add-0"]');
  await p.fill('#cname', 'X CUSTOMER');
  await p.click('[data-testid="till-park"]');
  await p.waitForSelector('[data-testid="till-parked-1"]', { timeout: 10000 });
  await p.reload();
  await p.waitForFunction(() => S && S.shop && S.shop.name === 'Shop X', null, { timeout: 30000 });
  const px = await parked();
  say('⚠️⚠️ both parked bills SURVIVE A RELOAD (they were read before the key, then saved over)', px.indexOf('LEGACY') >= 0 && px.indexOf('X CUSTOMER') >= 0, JSON.stringify(px));
  const sent = snapEng.join(' | ');
  say('⭐ the program SENDS its engine releases with its snapshot call', /signin:\d+\.\d+\.\d+/.test(sent) && /money:\d+\.\d+\.\d+/.test(sent), sent.slice(0, 90));
  const vx = (s1 && s1.engines) || {};
  say('paired, /api/state names a release for every engine it fetched', /^\d+\.\d+\.\d+$/.test(vx.tax) && /^\d+\.\d+\.\d+$/.test(vx.signin), JSON.stringify({ tax: vx.tax, signin: vx.signin, qr: vx.qr }));
  const shown = await p.evaluate(() => { const w = whoAmI(); return w && w.engines && w.engines.signin; });
  say('and the "what is this counter" panel shows them', /^\d+\.\d+\.\d+$/.test(String(shown)), 'signin ' + shown);
  say('connector.json kept everything else (merge, not rewrite)', JSON.parse(fs.readFileSync(cfgFile, 'utf8')).printer === 'KeepMe', 'printer kept');

  console.log('\n── ⭐⭐⭐ SHOP Y signs in on X\'s PC and SWITCHES — through the one door, a restart ' + '─'.repeat(0));
  await signIn('yowner');
  await p.waitForSelector('#askdlg[open]', { timeout: 15000 });
  const r2 = reopened('Shop Y');
  await p.click('#askok');
  await r2;
  if (await p.locator('[data-testid="signin-later"]').count()) await p.click('[data-testid="signin-later"]');
  await p.evaluate(() => { try { usignClose(); } catch (_) {} });
  const s2 = await state(), g2 = await page();
  await p.screenshot({ path: path.join(SHOTS, '2-shop-y.png') });
  say('the program is shop Y now', s2 && s2.shop && s2.shop.bridge_id === 'CB-Y', JSON.stringify(s2 && s2.shop));
  say('shop Y\'s shelf, and NOTHING of shop X', g2.items.indexOf('YPANEER') >= 0 && g2.items.indexOf('XMANGO') < 0, JSON.stringify(g2.items));
  say('the person who switched it is signed in', g2.who === 'Y Owner', 'who=' + g2.who);
  const py = await parked();
  say("⚠️⚠️ S1b · NONE of X's parked bills on Y's counter", py.length === 0 && !(await p.locator('[data-testid="till-parked-0"]').count()), JSON.stringify(py));
  const kept = await p.evaluate(() => { try { return JSON.parse(localStorage.getItem('cb_till_parked@pc-CB-X') || '[]').map((x) => x.name); } catch (_) { return []; } });
  say("and X's are KEPT in X's own slot, for when X signs in here again", kept.length === 2, JSON.stringify(kept));
  const dirs = fs.readdirSync(path.join(home, 'till-data')).map((h) => fs.readdirSync(path.join(home, 'till-data', h))).flat();
  say('X\'s own folder is KEPT on this PC (its queue is money)', dirs.indexOf('CB-X') >= 0 && dirs.indexOf('CB-Y') >= 0, JSON.stringify(dirs));

  console.log('\nconsole/page errors:', errs.length ? errs.join(' | ').slice(0, 400) : 'none');
  running = false; try { proc.kill(); } catch (_) {}
  await b.close(); api.close();
  if (bad) console.log('\n── program log (tail) ──\n' + out.split('\n').slice(-25).join('\n'));
  console.log('\n' + (bad ? '✗ ' + bad + ' FAILED\n' : '✓ all good\n'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
