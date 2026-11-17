#!/usr/bin/env node
/**
 * e2e/walk-firm-reply.cjs — THE FIRM'S REPLY BOX AND THE BELL ROW THAT OPENS IT, WALKED ON THE REAL STACK (UX-137 register pass, 17 Nov 2026).
 * Screens: the Saved sheet (CMP067: the reply box CMP067-T02 and its button CMP067-B09, cap-flag.js) and the bell row of a colleague's reply (CMP038-B01, kind note_reply, rail-bell.js).
 *
 * Proves, in real Chromium against the real api (server.js, b877 applied) over a throwaway Postgres: a firm colleague (acct1) opens the Day book of a client, opens the firm note
 * aud1 wrote, sees the reply box and its button by their register codes, writes a reply and sends it; aud1's bell then shows a row of kind note_reply, and PRESSING it opens that client's
 * Day book with the note's sheet open (the reply in its thread), and the address forgets the note. 1366x768 and 390x844 shots of the reply box; no sideways scroll at either width.
 * REAL AUTH: the api's own middleware verifies every request. The tokens are signed here with the api's JWT_SECRET (the way the api's *.realstack tests do), never printed or stored.
 * ⚠️ SERVER ONLY: needs CB_REAL_DB (an EMPTY-then-migrated localhost Postgres as cb_app, b877 applied) and CB_API_DIR (the api checkout with node_modules).
 *   CB_REAL_DB=postgres://cb_app:…@127.0.0.1:5432/x CB_API_DIR=/api node e2e/walk-firm-reply.cjs [--shots dir]
 */
'use strict';
const path = require('path'), fs = require('fs');
const API_DIR = process.env.CB_API_DIR || '', DB = process.env.CB_REAL_DB || '';
const SHOTS = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : '';
if (!DB || !API_DIR) { console.log('SKIP: CB_REAL_DB and CB_API_DIR are not set (this walk needs a throwaway Postgres and the api checkout)'); process.exit(0); }
process.env.DATABASE_URL = DB; process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'firm-reply-walk-secret-at-least-32-chars-padding';
const need = (m) => require(path.join(API_DIR, 'node_modules', m));
const { chromium } = require('playwright');
const TD = require('./lib/today.cjs');   /* QW1-TODAY: the one injected today (CB_TODAY) */
const S = require('./lib/serve.cjs'), R = require('./lib/real-stack.cjs');
const jsonWebToken = need('jsonwebtoken');
const net = require(path.join(API_DIR, 'src', 'services', 'network')), { query, withEntity } = require(path.join(API_DIR, 'db'));

let failures = 0;
const check = (ok, words, info) => { console.log((ok ? '  ok   ' : '  FAIL ') + words + (!ok && info ? '\n         ' + String(info).slice(0, 400) : '')); if (!ok) failures++; };
const RUN = 'fr' + (Date.now() % 1e10).toString(36);   // clock-ok: a unique run tag, not a business day
const sign = (claims) => jsonWebToken.sign(claims, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });

async function business(tag, name) {
  const bridgeId = 'CB' + RUN + tag;
  const { rows: [row] } = await query("INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1,$2,'entity','IN','INR',$3) RETURNING identity_id, display_name", [bridgeId, name, bridgeId.toLowerCase() + '@test.example']);
  return { bridgeId, id: row.identity_id, name: row.display_name, node: await net.nodeOf(row.identity_id, { ensure: true }) };
}
const ownerOf = (b) => ({ token: sign({ identity_id: b.id, identity_type: 'entity', bridge_id: b.bridgeId, display_name: b.name }), name: b.name, biz: b });
async function person(biz, tag, name, level) {
  const { rows: [row] } = await query("INSERT INTO identities (bridge_id, display_name, identity_type, parent_entity_id, country, currency_code, user_id, access_level, whole_entity, can_see_costs, hat) VALUES ($1,$2,'actor',$3,'IN','INR',$4,$5,true,true,'act') RETURNING identity_id, display_name", [biz.bridgeId + tag, name, biz.id, tag + '.' + biz.bridgeId.toLowerCase(), level]);
  return { id: row.identity_id, name: row.display_name, biz, token: sign({ identity_id: row.identity_id, identity_type: 'actor', bridge_id: biz.bridgeId, display_name: row.display_name, parent_entity_id: biz.id }) };
}

(async () => {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const P = await business('p', 'Firm Walk ' + RUN), C = await business('c', 'Client Walk ' + RUN);
  const asked = await net.requestConnect({ parentId: P.node.id, childId: C.node.id }, P.node); await net.approve({ edgeId: asked.id }, C.node);
  const aud1 = await person(P, 'a', 'Aud One', 'commenter'), acct1 = await person(P, 'b', 'Acct One', 'editor');
  const web = await S.serve(), stack = await R.up({ webBase: web.url('') }), api = stack.api;
  const call = async (token, method, route, body) => R.j(api + route, { method, token, body });
  const cOwner = ownerOf(C);
  await withEntity(C.id, (h) => require(path.join(API_DIR, 'lib', 'country-setup.js')).save(h, C.id, { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: true, number: '33AAAAA0000A1Z9', scheme: 'regular' }, source: { tax: 'typed' } }, C.id));
  const on = await call(cOwner.token, 'POST', '/api/books/enable', {});
  const gA = await call(cOwner.token, 'POST', '/api/books-grants', { grantee: P.id, purpose: 'audit of the books', consent: true });
  const gV = await call(cOwner.token, 'POST', '/api/books-grants', { grantee: P.id, purpose: 'adviser of the books', consent: true, preset: 'adviser', posting: 'owner_approves' });
  check(on.status === 200 && gA.status === 201 && gV.status === 201, 'setup: the client\'s books are on and the firm holds an auditor and an adviser grant', JSON.stringify([on.status, gA.status, gV.status]));
  const acc = (await call(cOwner.token, 'GET', '/api/books/accounts')).b, list = acc.accounts || acc.rows || acc || [];
  const cash = (list.find((a) => /cash/i.test(a.name || '')) || {}).code || '1000', sales = (list.find((a) => /^sales/i.test(a.name || '')) || {}).code || '4000';
  const day = TD.TODAY;
  const E1 = (await call(cOwner.token, 'POST', '/api/books/entries', { narration: 'walk ' + RUN, date: day, client_ref: RUN + 'e1', lines: [{ code: cash, dr_minor: 10000 }, { code: sales, cr_minor: 10000 }] })).b;
  const w = await call(aud1.token, 'POST', '/api/flags', { kind: 'note', visibility: 'org', subject_kind: 'posting', subject_entity: C.id, items: [{ id: E1.entry_id, label: E1.entry_no + ' · walk' }], note: 'Check the cash slip before sign-off' });
  const flagId = w.b && w.b.flags && w.b.flags[0] && w.b.flags[0].flag_id;
  check(w.status === 201 && !!flagId && !!E1.entry_id, 'setup: aud1 wrote a My firm note on the entry');

  const browser = await chromium.launch();
  const open = async (who, size) => {
    const ctx = await browser.newContext({ viewport: size });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
    await ctx.addInitScript((a) => { try { localStorage.setItem('cb_sess', JSON.stringify({ token: a.t, role: 'actor', name: a.n })); localStorage.setItem('cb_api_base', a.api); } catch (_) {} }, { t: who.token, n: who.name, api });
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
    return { ctx, page, errors };
  };
  const dayBook = (extra) => web.url('/network.html?open=' + C.id + '&view=daybook&api=' + encodeURIComponent(api) + (extra || ''));
  const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  /* 1 · acct1 (a colleague) opens the firm note and replies */
  for (const size of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    const { ctx, page, errors } = await open(acct1, size), tag = size.width + ' ';
    await page.goto(dayBook(), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="bv-list"] [data-row]', { timeout: 30000 });
    await page.waitForSelector('[data-fl]', { timeout: 15000 });
    await page.click('[data-fl]');
    await page.waitForSelector('dialog[data-testid="fl-sheet"][open]');
    await page.waitForSelector('[data-testid="fl-reply"]', { timeout: 15000 });
    const reply = page.locator('[data-testid="fl-reply"]'), send = page.locator('[data-testid="fl-send-reply"]');
    check((await reply.getAttribute('data-cbsid')) === 'CMP067-T02' && (await send.getAttribute('data-cbsid')) === 'CMP067-B09', tag + 'the reply box wears CMP067-T02 and its button CMP067-B09');
    check(!!(await reply.getAttribute('aria-label')) && (await send.innerText()).trim().length > 0, tag + 'the reply box has an accessible name and the button says what it does');
    const inside = await page.evaluate(() => { const d = document.querySelector('dialog[data-testid="fl-sheet"]').getBoundingClientRect(); return d.left >= -1 && d.right <= window.innerWidth + 1; });
    check(inside && await noSideways(page), tag + 'the sheet sits inside the screen and nothing scrolls sideways');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'reply-box-' + size.width + '.png') });
    if (size.width === 1366) {
      await reply.fill('I will ring the client on Monday.');
      await send.click();
      await page.waitForFunction(() => /ring the client on Monday/.test(document.querySelector('dialog[data-testid="fl-sheet"]').innerText), null, { timeout: 15000 });
      check(true, tag + 'the reply is sent and appears in the thread');
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'reply-sent-' + size.width + '.png') });
    }
    check(errors.length === 0, tag + 'no page error' + (errors.length ? ': ' + errors[0] : ''));
    await ctx.close();
  }

  /* 2 · aud1's bell: the row of kind note_reply opens the note */
  {
    const { ctx, page, errors } = await open(aud1, { width: 1366, height: 768 });
    await page.goto(dayBook().replace('&view=daybook', '').replace('open=' + C.id, 'open=' + C.id), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="bell-btn"]', { timeout: 30000 });
    await page.click('[data-testid="bell-btn"]');
    await page.waitForSelector('[data-testid="bell-row"][data-note-id]', { timeout: 15000 });
    const row = page.locator('[data-testid="bell-row"][data-note-id]').first();
    check((await row.getAttribute('data-note-id')) === String(E1.entry_id) && /Acct One/.test(await row.innerText()) && /replied on your firm note/.test(await row.innerText()), 'the bell shows the colleague\'s reply as a row that carries its entry (CMP038-B01, note_reply)');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'bell-note-reply-1366.png') });
    await row.click();
    const sheetOpen = await page.waitForSelector('dialog[data-testid="fl-sheet"][open]', { timeout: 20000 }).then(() => true, () => false);
    if (!sheetOpen) {
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'bell-no-sheet.png') });
      console.log('  DEBUG url ' + page.url().replace(/(open=)[^&]+/, '$1…') + ' · text ' + (await page.evaluate(() => document.body.innerText.replace(/s+/g, ' ').slice(0, 300))));
    }
    check(sheetOpen, 'the note sheet opens after the press');
    check(/view=daybook/.test(page.url()) && !/note=/.test(page.url()), 'pressing the row opens the client\'s Day book and the address forgets the note: ' + page.url().replace(/(open=)[^&]+/, '$1…'));
    await page.waitForFunction(() => /ring the client on Monday/.test(document.querySelector('dialog[data-testid="fl-sheet"]').innerText), null, { timeout: 15000 });
    check(true, 'the note\'s sheet is open with the colleague\'s reply in its thread');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'bell-opened-note-1366.png') });
    check(errors.length === 0, 'no page error' + (errors.length ? ': ' + errors[0] : ''));
    await ctx.close();
  }
  /* 3 · F1 (17 Nov): a Query notice is never a dead button. The auditor raises a Query; the OWNER's bell on HOME (no cap-mark.js there) shows it pressable, and the press lands on the Accounts Day book with that thread open */
  {
    const Q = 'Please send the cash slip for this entry ' + RUN;
    const q = await R.j(api + '/api/marks', { method: 'POST', token: aud1.token, headers: { 'X-Books-For': C.id, 'X-Books-Role': 'auditor', 'Idempotency-Key': RUN + 'q1' }, body: { adopter: 'acc.audit', subject_id: E1.entry_id, kind: 'query', note: Q } });
    check(q.status === 200 || q.status === 201, 'setup: the auditor raised a Query on the entry', JSON.stringify([q.status, q.b]).slice(0, 200));
    for (const size of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
      const ctx = await browser.newContext({ viewport: size }), tag = size.width + ' ';
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
      await ctx.addInitScript((a2) => { try { localStorage.setItem('cb_sess', JSON.stringify({ token: a2.t, role: 'entity', name: a2.n })); localStorage.setItem('cb_api_base', a2.api); } catch (_) {} }, { t: cOwner.token, n: cOwner.name, api });
      const page = await ctx.newPage(), errors = [];
      page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
      await page.goto(web.url('/?api=' + encodeURIComponent(api)), { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-testid="bell-btn"]', { timeout: 30000 });
      await page.click('[data-testid="bell-btn"]');
      await page.waitForSelector('[data-testid="bell-row"]', { timeout: 15000 });
      const row = page.locator('[data-testid="bell-row"]').first();
      check(!(await row.isDisabled()) && /raised a Query/.test(await row.innerText()), tag + 'on Home the Query notice is a pressable row (CMP038-B01), not a disabled button');
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'home-query-row-' + size.width + '.png') });
      await row.click();
      const sheet = await page.waitForSelector('dialog[data-testid="mk-sheet"][open]', { timeout: 30000 }).then(() => true, () => false);
      check(sheet && /accounts\.html/.test(page.url()) && !/mark=/.test(page.url()), tag + 'the press lands on the Accounts Day book with the thread open and the address forgets the mark: ' + page.url().replace(/(api=)[^&#]+/, '$1…'));
      check(sheet && (await page.evaluate((t) => document.querySelector('dialog[data-testid="mk-sheet"]').innerText.indexOf(t) >= 0, Q)), tag + 'the thread shows the question');
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'home-query-opened-' + size.width + '.png') });
      check(errors.length === 0, tag + 'no page error' + (errors.length ? ': ' + errors[0] : ''));
      await ctx.close();
    }
  }
  await browser.close(); stack.stop(); web.close();
  console.log('\n' + (failures ? failures + ' FAILED' : 'ALL PASS'));
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('ERROR ' + (e && e.stack)); process.exit(1); });
